// ============================================================================
// EXECUTORS — the far side of the wire.
//
// The command bus hands over an envelope; an executor either carries it out or
// says why it cannot. These adapters are the seam where OTTO-Q stops and the
// world begins, and they are deliberately thin: an executor translates and
// delegates, it does not decide.
//
// Two exist today:
//   motionSubscriber  → TwinMotionDriver. OTTO-Q names a stall and a deadline;
//                       the motion stack owns route, speed, spacing, heading.
//   energySubscriber  → SiteEnergyController. OTTO-Q names an average power and
//                       a window; the controller owns the ramp.
//
// Both REFUSE honestly. A refusal names the missing capability, which is what a
// real fleet API or energy management system does, and is far more useful in a
// demo than a silent no-op that looks like success.
// ============================================================================

import { twinMotionDriver } from "@/engine/TwinMotionDriver";
import type { TwinSubscribers } from "./commandBus";
import type { CommandOutcome, EnergyParams, OttoQCommand, VehicleParams } from "./commands";
import type { SiteEnergyController } from "./energyController";

// ── vehicles ────────────────────────────────────────────────────────────────

/**
 * Route `assign_stall` to the motion driver. Every other vehicle intent is
 * refused by name rather than swallowed — `hold`, `depart` and `requeue` are
 * real gaps, and pretending to honour them would make the ledger lie.
 */
export function motionSubscriber(): NonNullable<TwinSubscribers["vehicle"]> {
  return (cmd: OttoQCommand): boolean | string => {
    if (cmd.intent !== "assign_stall") {
      return `motion system has no handler for '${cmd.intent}' yet — only assign_stall is wired`;
    }
    const p = cmd.params as VehicleParams;
    return twinMotionDriver.acceptStallCommand({
      command_id: cmd.command_id,
      vehicle_id: cmd.target.id,
      twin_stall_id: p.stall_id,
      not_after_sim: cmd.window.not_after_sim,
    });
  };
}

/**
 * Collect arrival reports the driver has queued since the last tick and shape
 * them as bus outcomes. Called once per pass, after transmit.
 */
export function drainMotionOutcomes(atSim: string, executorId = "twin.motion"): CommandOutcome[] {
  return twinMotionDriver.drainMotionOutcomes().map((o) => ({
    command_id: o.command_id,
    status: o.status,
    executor: executorId,
    at_sim: atSim,
    reason: o.reason,
    deviation_s: o.transit_s,
  }));
}

// ── energy ──────────────────────────────────────────────────────────────────

export function energySubscriber(
  controller: SiteEnergyController,
): NonNullable<TwinSubscribers["energy"]> {
  return (cmd: OttoQCommand): boolean | string =>
    controller.accept({
      command_id: cmd.command_id,
      intent: cmd.intent as EnergyIntentSubset,
      params: cmd.params as EnergyParams,
      not_before_sim: cmd.window.not_before_sim,
      not_after_sim: cmd.window.not_after_sim,
    });
}

export type EnergyIntentSubset =
  | "charge_bess" | "discharge_bess" | "hold_bess"
  | "curtail_site" | "release_curtailment";

export function drainEnergyOutcomes(
  controller: SiteEnergyController,
  atSim: string,
  executorId = "twin.energy",
): CommandOutcome[] {
  return controller.drainOutcomes().map((o) => ({
    command_id: o.command_id,
    status: o.status,
    executor: executorId,
    at_sim: atSim,
    reason: o.reason,
    deviation_s: null,
  }));
}
