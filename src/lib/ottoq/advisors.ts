// ============================================================================
// L3 ADVISORS — the layer that thinks.
//
// Everything that reasons about what the depot should do lives here, behind one
// interface. cuOpt, Nemotron, and the deterministic heuristics below are peers:
// none of them can emit a command, all of them are outranked by the arbiter,
// and all of them are gated by the shield.
//
// Two built-in advisors ship with no network dependency, so the funnel produces
// a real plan even when NVIDIA is unreachable — and so the shield and the bus
// are testable without mocking a GPU solver.
//
// ── THE ENERGY ADVISOR IS THE REFERENCE IMPLEMENTATION ──────────────────────
// It expresses exactly the three sentences the product promises:
//
//   "start pulling because grid price is low"      → charge_bess,  price_low
//   "discharge because it's expensive and demand
//    is high"                                      → discharge_bess, price_high
//   "demand is really high — discharge in 20 min"  → discharge_bess with
//                                                    start_offset_s = 1200
//
// Note what it does NOT do: it never names a converter setpoint, a ramp rate,
// or a contactor. It states an average power over a window and a reason. The
// site energy controller owns the rest. That is the doctrine, in code.
// ============================================================================

import type { Advisor, Proposal } from "./pipeline";
import type { ChannelBundle } from "./contracts";
import type { EnergyParams, VehicleParams, ChargerParams } from "./commands";

// ── tunables ────────────────────────────────────────────────────────────────
// Defaults are the shape of a typical wholesale day, not a fitted model. When
// the twin publishes a run's own price distribution these should become
// percentiles of it rather than fixed dollars — see docs backlog.

export interface EnergyPolicy {
  /** at or below this $/MWh, buying is cheap enough to fill the battery */
  cheapUsdMwh: number;
  /** at or above this $/MWh, buying is expensive enough to lean on the battery */
  expensiveUsdMwh: number;
  /** site draw above this fraction of the 15-min peak counts as "high demand" */
  highDemandFraction: number;
  /** how far ahead to schedule a pre-emptive discharge, seconds */
  preemptiveLeadS: number;
  /** average power the battery is asked for, kW */
  chargeKw: number;
  dischargeKw: number;
  /** SoC below which we top up regardless of price (reserve for a DR call) */
  reserveFloorPct: number;
}

export const DEFAULT_ENERGY_POLICY: EnergyPolicy = {
  cheapUsdMwh: 25,
  expensiveUsdMwh: 60,
  highDemandFraction: 0.85,
  preemptiveLeadS: 20 * 60,
  chargeKw: 250,
  dischargeKw: 400,
  reserveFloorPct: 35,
};

export interface ChargePolicy {
  /** vehicles at or below this SoC are candidates for a charge stall */
  needySocPct: number;
  /** below this, prefer a DCFC stall even if an L2 is free */
  urgentSocPct: number;
  /** SoC to request on departure */
  targetSocPct: number;
  /** most assignments to propose in one tick */
  maxAssignments: number;
}

export const DEFAULT_CHARGE_POLICY: ChargePolicy = {
  needySocPct: 70,
  urgentSocPct: 25,
  targetSocPct: 90,
  maxAssignments: 12,
};

// ── energy advisor ──────────────────────────────────────────────────────────

/**
 * Battery and site-load orchestration driven by price, demand, and DR state.
 *
 * Precedence is deliberate and is itself the policy:
 *   1. an active DR call outranks price — compliance first
 *   2. a depleted reserve outranks price — you cannot answer a DR call with an
 *      empty battery, so rebuilding reserve is worth paying a bad price for
 *   3. only then does arbitrage apply
 */
export function energyAdvisor(policy: Partial<EnergyPolicy> = {}): Advisor {
  const p: EnergyPolicy = { ...DEFAULT_ENERGY_POLICY, ...policy };

  return {
    id: "energy_policy",
    description: "BESS arbitrage, reserve management, and DR compliance",
    propose: (bundle: ChannelBundle): Proposal[] => {
      const eg = bundle.channels.energy_grid.payload;
      const out: Proposal[] = [];

      const soc = eg.bess.soc_pct;
      const lmp = eg.grid.lmp_usd_mwh;
      const dr = eg.demand_response;
      const site = eg.site;

      // A battery whose state of charge we cannot read is a battery we do not
      // command. Silence is the correct output here.
      if (soc === null) return out;

      const bessTarget = { kind: "bess" as const, id: "site_bess", label: "Site BESS" };

      // ── 1. demand response ──────────────────────────────────────────────
      if (dr.active) {
        const over = dr.headroom_kw !== null && dr.headroom_kw < 0;
        out.push({
          intent: "discharge_bess",
          target: bessTarget,
          params: {
            power_kw: -Math.min(p.dischargeKw, Math.abs(dr.headroom_kw ?? p.dischargeKw)),
            soc_bound_pct: 15,
            signal_reason: "dr_call",
            lmp_usd_mwh: lmp,
          } satisfies EnergyParams,
          score: 1000,
          confidence: 1,
          rationale: over
            ? `Demand-response call active and the site is ${Math.abs(dr.headroom_kw!)}kW over the ${dr.cap_kw}kW cap — discharge to get under it.`
            : `Demand-response call active with a ${dr.cap_kw}kW cap — lean on the battery to hold the site under it.`,
          duration_s: 60 * 60,
        });

        if (dr.cap_kw !== null) {
          out.push({
            intent: "curtail_site",
            target: { kind: "site", id: bundle.sim_run_id, label: "Depot site" },
            params: { site_cap_kw: dr.cap_kw, signal_reason: "dr_call" } satisfies EnergyParams,
            score: 990,
            confidence: 1,
            rationale: `Hold total site draw at or under the ${dr.cap_kw}kW demand-response cap.`,
            duration_s: 60 * 60,
          });
        }
        return out; // compliance mode: nothing else competes
      }

      // ── 2. reserve ──────────────────────────────────────────────────────
      if (soc < p.reserveFloorPct) {
        out.push({
          intent: "charge_bess",
          target: bessTarget,
          params: {
            power_kw: p.chargeKw,
            soc_bound_pct: p.reserveFloorPct + 20,
            signal_reason: "reserve_build",
            lmp_usd_mwh: lmp,
          } satisfies EnergyParams,
          score: 800,
          confidence: 0.9,
          rationale: `Battery at ${soc}% is below the ${p.reserveFloorPct}% reserve floor — rebuild it now so a demand-response call can be answered.`,
          duration_s: 90 * 60,
        });
        return out;
      }

      // ── 3. arbitrage ────────────────────────────────────────────────────
      if (lmp === null) return out; // no price signal, no arbitrage opinion

      const peak = site.peak_15min_kw;
      const load = (site.ev_charging_kw ?? 0) + (site.building_kw ?? 0);
      const highDemand = peak !== null && peak > 0 && load / peak >= p.highDemandFraction;
      const solarSurplus = (site.solar_kw ?? 0) > load;

      if (lmp <= p.cheapUsdMwh) {
        out.push({
          intent: "charge_bess",
          target: bessTarget,
          params: {
            power_kw: p.chargeKw,
            soc_bound_pct: 95,
            signal_reason: solarSurplus ? "solar_surplus" : "price_low",
            lmp_usd_mwh: lmp,
          } satisfies EnergyParams,
          score: 300 + (p.cheapUsdMwh - lmp),
          confidence: 0.85,
          rationale: solarSurplus
            ? `Solar is producing ${site.solar_kw}kW against ${Math.round(load)}kW of load and power is $${lmp}/MWh — store the surplus.`
            : `Grid price is $${lmp}/MWh, below the $${p.cheapUsdMwh} threshold — start pulling to fill the battery.`,
          duration_s: 60 * 60,
        });
      } else if (lmp >= p.expensiveUsdMwh) {
        out.push({
          intent: "discharge_bess",
          target: bessTarget,
          params: {
            power_kw: -p.dischargeKw,
            soc_bound_pct: 20,
            signal_reason: highDemand ? "peak_demand" : "price_high",
            lmp_usd_mwh: lmp,
          } satisfies EnergyParams,
          score: 400 + (lmp - p.expensiveUsdMwh),
          confidence: 0.85,
          rationale: highDemand
            ? `Grid price is $${lmp}/MWh and the site is at ${Math.round((load / (peak || 1)) * 100)}% of its 15-minute peak — discharge instead of buying.`
            : `Grid price is $${lmp}/MWh, above the $${p.expensiveUsdMwh} threshold — discharge instead of buying.`,
          duration_s: 60 * 60,
        });
      } else if (highDemand) {
        // The "discharge in 20 minutes" case: price is ordinary but demand is
        // climbing toward the peak that sets the monthly demand charge. Act
        // BEFORE the peak, not after it.
        out.push({
          intent: "discharge_bess",
          target: bessTarget,
          params: {
            power_kw: -Math.round(p.dischargeKw * 0.6),
            soc_bound_pct: 25,
            signal_reason: "peak_demand",
            lmp_usd_mwh: lmp,
          } satisfies EnergyParams,
          score: 250,
          confidence: 0.7,
          rationale: `Site load is at ${Math.round((load / (peak || 1)) * 100)}% of the 15-minute peak — discharge in ${Math.round(p.preemptiveLeadS / 60)} minutes to shave it before it sets the demand charge.`,
          start_offset_s: p.preemptiveLeadS,
          duration_s: 45 * 60,
        });
      }

      return out;
    },
  };
}

// ── charge assignment advisor ───────────────────────────────────────────────

/**
 * Deterministic stall assignment — the fallback that keeps the depot running
 * when cuOpt is unavailable, and the baseline any solver must beat.
 *
 * Neediest vehicle first; urgent vehicles get DCFC, the rest take whatever is
 * free with a preference for L2 (leaving fast chargers for who needs them).
 */
export function chargeAssignmentAdvisor(policy: Partial<ChargePolicy> = {}): Advisor {
  const p: ChargePolicy = { ...DEFAULT_CHARGE_POLICY, ...policy };

  return {
    id: "charge_heuristic",
    description: "SoC-priority stall assignment (deterministic baseline)",
    propose: (bundle: ChannelBundle): Proposal[] => {
      const fleet = bundle.channels.fleet_telemetry.payload;
      const depot = bundle.channels.depot_ops.payload;
      const out: Proposal[] = [];

      // Only vehicles that are actually waiting and actually need charge.
      const waiting = fleet.vehicles
        .filter((v) => (v.stage === "at_gate" || v.stage === "queued"))
        .filter((v) => v.soc_pct !== null && v.soc_pct <= p.needySocPct)
        .sort((a, b) => (a.soc_pct ?? 100) - (b.soc_pct ?? 100));

      const free = depot.stalls
        .filter((s) => !s.vehicle_id)
        .filter((s) => ["available", "reserved"].includes(s.status.toLowerCase()))
        .filter((s) => s.type === "dcfc" || s.type === "l2");

      const dcfc = free.filter((s) => s.type === "dcfc").sort((a, b) => a.id.localeCompare(b.id));
      const l2 = free.filter((s) => s.type === "l2").sort((a, b) => a.id.localeCompare(b.id));

      for (const v of waiting.slice(0, p.maxAssignments)) {
        const soc = v.soc_pct!;
        const urgent = soc <= p.urgentSocPct;
        // Urgent takes DCFC then falls back; non-urgent takes L2 then falls back.
        const pool = urgent ? [dcfc, l2] : [l2, dcfc];
        const stall = pool[0].shift() ?? pool[1].shift();
        if (!stall) break; // depot is full — say nothing rather than queue noise

        out.push({
          intent: "assign_stall",
          target: { kind: "vehicle", id: v.id, label: v.av_id },
          params: {
            stall_id: stall.id,
            stall_code: stall.code,
            service: stall.type === "dcfc" ? "dcfc_charge" : "l2_charge",
            target_soc_pct: p.targetSocPct,
          } satisfies VehicleParams,
          // Neediest scores highest, so the arbiter's total order matches the
          // policy without a second sort.
          score: 500 + (100 - soc) + (urgent ? 50 : 0),
          confidence: 0.8,
          rationale: urgent
            ? `${v.av_id ?? v.id} is at ${soc}% — urgent, assigned fast charger ${stall.code ?? stall.id}.`
            : `${v.av_id ?? v.id} is at ${soc}% and waiting — assigned ${stall.code ?? stall.id}.`,
          duration_s: 20 * 60,
        });
      }

      return out;
    },
  };
}

// ── charger health advisor ──────────────────────────────────────────────────

/**
 * Take faulted chargers out of the assignment pool without interrupting a
 * session already running on them. Cheap, high-value, and impossible today
 * because charger health is not on any frame — see backlog 4.2. Until then this
 * advisor proposes from the coarse stall status the snapshot does carry.
 */
export function chargerHealthAdvisor(): Advisor {
  return {
    id: "charger_health",
    description: "Quarantine faulted chargers, leave live sessions alone",
    propose: (bundle: ChannelBundle): Proposal[] =>
      bundle.channels.charger_systems.payload.chargers
        .filter((c) => c.faulted && !c.vehicle_id)
        .map((c) => ({
          intent: "quarantine" as const,
          target: { kind: "charger" as const, id: c.stall_id, label: c.code },
          params: { reason_code: c.status } satisfies ChargerParams,
          score: 600,
          confidence: 0.95,
          rationale: `Charger ${c.code ?? c.stall_id} reports ${c.status} with no vehicle attached — stop assigning to it.`,
          duration_s: 2 * 60 * 60,
        })),
  };
}

// ── external advisor adapter (cuOpt, Nemotron, anything else) ───────────────

export interface ExternalAdvisorSpec {
  id: string;
  description: string;
  /**
   * Called with the bundle; returns proposals. Any transport is fine — a
   * Supabase edge function, a direct NVIDIA call, a local model. The pipeline
   * enforces the timeout and isolates the failure, so this may throw freely.
   */
  fetchProposals: (bundle: ChannelBundle) => Promise<Proposal[]>;
}

/**
 * Wrap any external reasoner as an L3 advisor.
 *
 * This is how cuOpt and Nemotron enter the funnel: as peers of the heuristics,
 * with no privileged path to the wire. `ottoq-cuopt-propose` already writes to
 * `ottoq_external_proposals` on the backend; pointing this adapter at that seam
 * puts the GPU solver behind the same shield as everything else.
 */
export function externalAdvisor(spec: ExternalAdvisorSpec): Advisor {
  return {
    id: spec.id,
    description: spec.description,
    propose: (bundle) => spec.fetchProposals(bundle),
  };
}

/**
 * The default advisor stack, in fixed order. Order affects only tie-breaking
 * (the arbiter sorts by score first), but it is fixed so replays are exact.
 */
export function defaultAdvisors(external: Advisor[] = []): Advisor[] {
  return [
    energyAdvisor(),
    chargerHealthAdvisor(),
    chargeAssignmentAdvisor(),
    ...external,
  ];
}
