// ============================================================================
// SiteEnergyController — the thing that receives OTTO-Q's battery directives
// and owns everything OTTO-Q deliberately does not say.
//
// OTTO-Q sends: "discharge at an average 400 kW, starting in 20 minutes,
// because demand is peaking, and do not go below 20% state of charge."
//
// It does NOT send a converter setpoint, a ramp rate, or a contactor position —
// and this controller is where you can see why that separation is the right
// one. Everything below is a decision only the site can make:
//
//   · RAMP. Power moves at a bounded rate. A 400 kW step commanded instantly
//     would be a fault on real hardware; here it takes ~13s at 30 kW/s.
//   · SOC BOUNDS. The controller stops at the floor the command declared, or
//     its own hard limits, whichever binds first. A command cannot talk the
//     battery past its own physics.
//   · DERATE. A hot pack cannot deliver nameplate power. The controller cuts
//     the target and REPORTS it, rather than silently under-delivering.
//   · ARBITRATION. One active battery directive at a time. A new one supersedes
//     the old and the old is closed in the ledger, never left dangling.
//
// The controller is a MODEL, not a passthrough: it integrates state of charge
// over the sim clock, so a discharge actually drains the battery and the next
// world frame reflects it. That closes the loop — OTTO-Q's decision changes the
// world it will read on the following tick.
// ============================================================================

import type { EnergyParams } from "./commands";
import type { EnergyIntentSubset } from "./executors";

export interface EnergyControllerConfig {
  /** how fast commanded power may change, kW per second */
  rampKwPerS: number;
  /** hard state-of-charge limits, independent of what any command asks for */
  hardFloorPct: number;
  hardCeilingPct: number;
  /** usable capacity, kWh — sets how fast SoC actually moves */
  capacityKwh: number;
  /** above this pack temperature, available power is derated */
  derateAboveC: number;
  /** fraction of nameplate power available when fully derated */
  derateFloorFraction: number;
  /** round-trip efficiency applied on the charge direction */
  chargeEfficiency: number;
}

export const DEFAULT_ENERGY_CONTROLLER: EnergyControllerConfig = {
  rampKwPerS: 30,
  hardFloorPct: 10,
  hardCeilingPct: 98,
  capacityKwh: 2000,
  derateAboveC: 40,
  derateFloorFraction: 0.5,
  chargeEfficiency: 0.92,
};

export interface EnergyOutcomeReport {
  command_id: string;
  status: "completed" | "rejected";
  reason: string | null;
}

interface ActiveDirective {
  command_id: string;
  intent: EnergyIntentSubset;
  /** signed target: positive = charge, negative = discharge */
  targetKw: number;
  socBoundPct: number | null;
  notBeforeMs: number | null;
  notAfterMs: number | null;
  reason: string | null;
}

/** What the controller is doing right now — read by the operator trace. */
export interface EnergyControllerState {
  /** signed power actually being delivered after ramp and derate, kW */
  actualKw: number;
  /** signed power the active directive is aiming for, kW */
  targetKw: number;
  socPct: number;
  /** site draw ceiling in force, kW; null = uncapped */
  siteCapKw: number | null;
  activeCommandId: string | null;
  /** set when the controller is delivering less than commanded, and why */
  derateReason: string | null;
}

export class SiteEnergyController {
  private cfg: EnergyControllerConfig;
  private active: ActiveDirective | null = null;
  private outcomes: EnergyOutcomeReport[] = [];
  private actualKw = 0;
  private socPct: number;
  private siteCapKw: number | null = null;
  private derateReason: string | null = null;
  private lastStepMs: number | null = null;
  /** bounds that outlive their directive until power is back at zero (see step) */
  private guardFloorPct: number | null = null;
  private guardCeilingPct: number | null = null;

  constructor(initialSocPct = 60, cfg: Partial<EnergyControllerConfig> = {}) {
    this.cfg = { ...DEFAULT_ENERGY_CONTROLLER, ...cfg };
    this.socPct = initialSocPct;
  }

  get state(): EnergyControllerState {
    return {
      actualKw: Math.round(this.actualKw * 10) / 10,
      targetKw: this.active?.targetKw ?? 0,
      socPct: Math.round(this.socPct * 100) / 100,
      siteCapKw: this.siteCapKw,
      activeCommandId: this.active?.command_id ?? null,
      derateReason: this.derateReason,
    };
  }

  /**
   * Accept or refuse a directive. Returns `true`, or a refusal reason.
   *
   * Refusals here are the controller asserting physics over policy — a battery
   * at 12% cannot be talked into a discharge, no matter how good the price is.
   */
  accept(input: {
    command_id: string;
    intent: EnergyIntentSubset;
    params: EnergyParams;
    not_before_sim: string | null;
    not_after_sim: string | null;
  }): true | string {
    const { command_id, intent, params } = input;

    // Site curtailment is a ceiling, not a battery action — it does not occupy
    // the single active-directive slot.
    if (intent === "curtail_site") {
      const cap = params.site_cap_kw;
      if (cap === null || cap === undefined) return "curtail_site carries no site_cap_kw";
      if (cap <= 0) return "a site cap of zero or less would be a shutdown, not a curtailment";
      this.siteCapKw = cap;
      this.outcomes.push({ command_id, status: "completed", reason: null });
      return true;
    }
    if (intent === "release_curtailment") {
      if (this.siteCapKw === null) return "no curtailment is in force";
      this.siteCapKw = null;
      this.outcomes.push({ command_id, status: "completed", reason: null });
      return true;
    }

    if (intent === "hold_bess") {
      this.closeActive("superseded by a hold");
      this.active = {
        command_id, intent, targetKw: 0, socBoundPct: null,
        notBeforeMs: parseMs(input.not_before_sim), notAfterMs: parseMs(input.not_after_sim),
        reason: params.signal_reason ?? null,
      };
      return true;
    }

    const requested = params.power_kw;
    if (requested === null || requested === undefined) {
      return `${intent} carries no power_kw`;
    }

    // Direction must match intent. A `charge_bess` with negative power is a bug
    // upstream, and accepting it would discharge a battery someone asked to
    // fill — the exact class of mistake this contract exists to make impossible.
    if (intent === "charge_bess" && requested <= 0) {
      return `charge_bess asked for ${requested}kW; charging requires positive power`;
    }
    if (intent === "discharge_bess" && requested >= 0) {
      return `discharge_bess asked for ${requested}kW; discharging requires negative power`;
    }

    // Physics gate — independent of, and stricter than, whatever the command says.
    if (intent === "discharge_bess" && this.socPct <= this.cfg.hardFloorPct) {
      return `battery at ${this.socPct.toFixed(1)}% is at the ${this.cfg.hardFloorPct}% hard floor`;
    }
    if (intent === "charge_bess" && this.socPct >= this.cfg.hardCeilingPct) {
      return `battery at ${this.socPct.toFixed(1)}% is at the ${this.cfg.hardCeilingPct}% hard ceiling`;
    }

    this.closeActive(`superseded by ${command_id}`);
    this.active = {
      command_id, intent,
      targetKw: requested,
      socBoundPct: params.soc_bound_pct ?? null,
      notBeforeMs: parseMs(input.not_before_sim),
      notAfterMs: parseMs(input.not_after_sim),
      reason: params.signal_reason ?? null,
    };
    return true;
  }

  /**
   * Advance the controller to `simClock`.
   *
   * This is where the ramp lives, and where OTTO-Q's decision actually changes
   * the world: state of charge integrates, so the next world frame the funnel
   * reads back reflects what it asked for on the previous one.
   */
  step(simClock: string | null, packTempC: number | null = null): void {
    const nowMs = parseMs(simClock);
    if (nowMs === null) return;
    if (this.lastStepMs === null) { this.lastStepMs = nowMs; return; }
    const dtS = Math.max(0, (nowMs - this.lastStepMs) / 1000);
    this.lastStepMs = nowMs;
    if (dtS === 0) return;

    // What are we aiming for this instant?
    let target = 0;
    this.derateReason = null;
    // Effective bounds for THIS step. A declared bound is honoured to the
    // percent, so the integration below clamps against these rather than only
    // against the hardware limits.
    //
    // The guard PERSISTS after the directive closes. Power cannot stop
    // instantly, so a discharge that ends exactly at the floor keeps draining
    // all the way down the ramp — a command that said "not below 20%" got 19%.
    // The guard holds the bound until power is actually back at zero.
    const a = this.active;
    if (a?.socBoundPct !== null && a !== null) {
      if (a.targetKw < 0) this.guardFloorPct = Math.max(this.cfg.hardFloorPct, a.socBoundPct!);
      else if (a.targetKw > 0) this.guardCeilingPct = Math.min(this.cfg.hardCeilingPct, a.socBoundPct!);
    }
    const effFloor = Math.max(this.cfg.hardFloorPct, this.guardFloorPct ?? this.cfg.hardFloorPct);
    const effCeiling = Math.min(this.cfg.hardCeilingPct, this.guardCeilingPct ?? this.cfg.hardCeilingPct);

    if (a) {
      const started = a.notBeforeMs === null || nowMs >= a.notBeforeMs;
      const finished = a.notAfterMs !== null && nowMs >= a.notAfterMs;
      if (finished) {
        this.closeActive(null); // ran its full window — a completed directive
      } else if (started) {
        target = a.targetKw;

        // Thermal derate: a hot pack cannot deliver nameplate. Reported, not hidden.
        if (packTempC !== null && packTempC > this.cfg.derateAboveC) {
          const over = packTempC - this.cfg.derateAboveC;
          const frac = Math.max(this.cfg.derateFloorFraction, 1 - over * 0.05);
          if (frac < 1) {
            target *= frac;
            this.derateReason = `pack at ${packTempC}°C — power derated to ${Math.round(frac * 100)}% of commanded`;
          }
        }

        // STOPPING DISTANCE. Begin ramping down early enough that the energy
        // still delivered on the way to zero lands ON the bound rather than
        // through it. Ramping from |p| kW to zero at r kW/s takes |p|/r seconds
        // and delivers 0.5·|p|·(|p|/r) kJ-equivalent — the triangle under the
        // ramp. This is the controller reasoning about its own dynamics, which
        // is exactly the class of decision the orchestrator must not make.
        const rampDownPct = this.socPctForRampDown();
        if (target < 0 && this.socPct - rampDownPct <= effFloor) {
          target = 0;
          this.closeActive(`reached the ${effFloor}% discharge bound`);
        } else if (target > 0 && this.socPct + rampDownPct >= effCeiling) {
          target = 0;
          this.closeActive(`reached the ${effCeiling}% charge bound`);
        }
      }
    }

    // RAMP — the controller's own decision, never the orchestrator's.
    const maxStep = this.cfg.rampKwPerS * dtS;
    const delta = target - this.actualKw;
    this.actualKw += Math.abs(delta) <= maxStep ? delta : Math.sign(delta) * maxStep;

    // Integrate state of charge. Charging pays the efficiency penalty; the
    // battery stores less than the site draws.
    const energyKwh = (this.actualKw * dtS) / 3600;
    const stored = energyKwh > 0 ? energyKwh * this.cfg.chargeEfficiency : energyKwh;
    this.socPct = clamp(
      this.socPct + (stored / this.cfg.capacityKwh) * 100,
      effFloor,
      effCeiling,
    );

    // Power is back at zero and nothing is commanded — the guard has done its
    // job and must not constrain the NEXT directive.
    if (this.actualKw === 0 && !this.active) {
      this.guardFloorPct = null;
      this.guardCeilingPct = null;
    }
  }

  /**
   * State-of-charge that will still move while power ramps from where it is now
   * to zero — the controller's stopping distance, in percent.
   */
  private socPctForRampDown(): number {
    const p = Math.abs(this.actualKw);
    if (p === 0) return 0;
    const rampS = p / this.cfg.rampKwPerS;
    const kwh = (0.5 * p * rampS) / 3600; // area under the linear ramp-down
    return (kwh / this.cfg.capacityKwh) * 100;
  }

  /** Terminal reports for the bus. */
  drainOutcomes(): EnergyOutcomeReport[] {
    const out = this.outcomes;
    this.outcomes = [];
    return out;
  }

  reset(socPct = 60): void {
    this.active = null;
    this.outcomes = [];
    this.actualKw = 0;
    this.socPct = socPct;
    this.siteCapKw = null;
    this.derateReason = null;
    this.lastStepMs = null;
    this.guardFloorPct = null;
    this.guardCeilingPct = null;
  }

  /**
   * Close the active directive. `reason === null` means it ran its window to
   * completion; anything else is why it ended early. Either way it becomes a
   * terminal ledger entry rather than a directive that quietly stops mattering.
   */
  private closeActive(reason: string | null): void {
    if (!this.active) return;
    this.outcomes.push({
      command_id: this.active.command_id,
      status: "completed",
      reason,
    });
    this.active = null;
  }
}

const parseMs = (iso: string | null): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
