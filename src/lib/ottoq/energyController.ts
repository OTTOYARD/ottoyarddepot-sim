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

/** Internal integration resolution. The controller's physics must not change
 *  because the caller's tick size did — see the sub-stepping note in step(). */
const MAX_SLICE_S = 60;
/** Backstop on a single step() call: 8 sim-hours at 60s resolution. A jump
 *  larger than this is a fast-forward, not a tick, and should not spin. */
const MAX_SLICES = 480;

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
  /** other site load, kW — what a curtailment cap has to be shared with */
  private siteLoadKw = 0;

  /**
   * `anchorClock` seeds the integration clock so the FIRST step() integrates
   * instead of merely establishing a reference point. Without it the first
   * interval after construction is silently lost — invisible at a 1s tick,
   * but a whole sim-hour at the coarse ticks the twin actually uses.
   */
  constructor(initialSocPct = 60, cfg: Partial<EnergyControllerConfig> = {}, anchorClock?: string | null) {
    this.cfg = { ...DEFAULT_ENERGY_CONTROLLER, ...cfg };
    this.socPct = initialSocPct;
    this.lastStepMs = parseMs(anchorClock ?? null);
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
    const totalS = Math.max(0, (nowMs - this.lastStepMs) / 1000);
    const fromMs = this.lastStepMs;
    this.lastStepMs = nowMs;
    if (totalS === 0) return;

    // ── SUB-STEPPING. This is the fix for the worst bug this file has had.
    //
    // The twin advances on BIG ticks — time_scale runs to 480 sim-minutes per
    // tick. The old code computed one dt for the whole interval and sampled
    // `started`/`finished` only at the END instant. So a one-hour directive
    // issued at tick N was, at the very next step, already past `not_after`:
    // it closed as {status:"completed", reason:null} — "ran its full window" —
    // having integrated ZERO seconds and delivered ZERO kWh. Every one of the
    // three flagship energy behaviours collapsed that way, and the unit tests
    // missed it because they advance in 1-second slices, a resolution the live
    // loop never uses.
    //
    // The controller now integrates at its OWN fixed resolution regardless of
    // how coarse the caller's clock is. Window boundaries, SoC bounds and the
    // ramp are all re-evaluated every slice, so behaviour no longer depends on
    // how often step() happens to be called. That independence is the property
    // worth having: the physics must not change because the renderer changed
    // its frame rate.
    const slices = Math.min(Math.ceil(totalS / MAX_SLICE_S), MAX_SLICES);
    const sliceS = totalS / slices;
    for (let i = 0; i < slices; i++) {
      // instant at the END of this slice — what the window test is evaluated at
      this.advanceSlice(sliceS, fromMs + (i + 1) * sliceS * 1000, packTempC);
    }
  }

  /** One fixed-resolution integration slice. All window/bound/ramp logic lives
   *  here so it is applied at a resolution the caller cannot distort. */
  private advanceSlice(dtS: number, nowMs: number, packTempC: number | null): void {
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

        // SITE CAP. A curtailment used to store `siteCapKw` and constrain
        // nothing — step() never read it — so the World tab showed a cap in
        // force while the battery went on importing straight through it.
        // A cap limits what the SITE may draw, so it binds on CHARGING only;
        // discharging reduces site draw and is always permitted under a cap.
        if (target > 0 && this.siteCapKw !== null) {
          const headroom = this.siteCapKw - this.siteLoadKw;
          if (target > headroom) {
            const limited = Math.max(0, headroom);
            this.derateReason =
              `site cap ${this.siteCapKw}kW with ${Math.round(this.siteLoadKw)}kW of other load — charge limited to ${Math.round(limited)}kW`;
            target = limited;
          }
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
    const deltaPct = (stored / this.cfg.capacityKwh) * 100;

    // BOUNDS LIMIT FLOW; THEY DO NOT TELEPORT STATE.
    //
    // The old clamp was two-sided and unconditional, so it could move SoC
    // AGAINST the energy flow: a discharge accepted at SoC 15% with a declared
    // floor of 20% clamped state of charge UP to 20 while delivering 0 kW, and
    // reported "reached the 20% discharge bound / completed". That fabricates
    // energy out of nothing and then claims success for it — in a model whose
    // entire job is to be a truthful account of what the world did.
    //
    // A bound may only ever STOP movement, never reverse it. If SoC already
    // sits beyond a bound, that is the world's state and the controller's job
    // is to refrain from making it worse, not to rewrite it.
    let next = this.socPct + deltaPct;
    if (deltaPct < 0) next = Math.max(next, Math.min(this.socPct, effFloor));
    else if (deltaPct > 0) next = Math.min(next, Math.max(this.socPct, effCeiling));
    // physical limits always apply, and likewise never move SoC backwards
    this.socPct = Math.min(
      Math.max(next, Math.min(this.socPct, this.cfg.hardFloorPct)),
      Math.max(this.socPct, this.cfg.hardCeilingPct),
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

  /**
   * Reconcile the model against the world before deciding.
   *
   * The controller was seeded from the twin's battery ONCE per run and then
   * diverged forever. In a measured run it pinned at its own floor and
   * delivered 0 kW for the rest of the session while still acking every
   * directive — 663 commands "completed", zero kWh moved. A model that has
   * stopped tracking the thing it models is worse than no model: it keeps
   * answering confidently.
   *
   * The twin owns the battery. Call this each tick with the observed state.
   * `null` means the world did not report — keep the model's own value rather
   * than snapping to a guess.
   */
  syncFromWorld(observedSocPct: number | null, siteLoadKw: number | null): void {
    if (observedSocPct !== null && Number.isFinite(observedSocPct)) {
      this.socPct = clamp(observedSocPct, 0, 100);
    }
    if (siteLoadKw !== null && Number.isFinite(siteLoadKw)) {
      this.siteLoadKw = Math.max(0, siteLoadKw);
    }
  }

  /**
   * Drop a curtailment when the condition that justified it has cleared.
   *
   * No advisor emits `release_curtailment` — the energy advisor returns early
   * during a DR call and never reaches a release branch — so a cap set once
   * latched for the rest of the run and the cockpit went on displaying it long
   * after the event ended. A constraint nobody can lift is a permanent lie
   * about the site's operating envelope.
   */
  releaseCurtailmentIfClear(drActive: boolean): void {
    if (!drActive && this.siteCapKw !== null) {
      this.siteCapKw = null;
      this.derateReason = null;
    }
  }

  /** Terminal reports for the bus. */
  drainOutcomes(): EnergyOutcomeReport[] {
    const out = this.outcomes;
    this.outcomes = [];
    return out;
  }

  reset(socPct = 60, anchorClock?: string | null): void {
    this.active = null;
    this.outcomes = [];
    this.actualKw = 0;
    this.socPct = socPct;
    this.siteCapKw = null;
    this.derateReason = null;
    this.lastStepMs = parseMs(anchorClock ?? null);
    this.guardFloorPct = null;
    this.guardCeilingPct = null;
    this.siteLoadKw = 0;
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
