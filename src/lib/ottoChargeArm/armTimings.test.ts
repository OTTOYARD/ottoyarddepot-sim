// ============================================================================
// THE ARM TIMING SEAM.
//
// The acceptance criterion for this contract is one sentence: changing the
// number in ONE place provably changes BOTH worlds. The backend half is asserted
// inside the migration `arm_motion_timings_have_exactly_one_home` (it moves
// robotic_arm_retract_seconds 6.5 -> 9.0, requires the derived demate window to
// read 14.0, then restores it). This file is the renderer half: given what that
// backend serves, do the numbers this repo runs on actually move?
//
// The bug being fenced off is not hypothetical. `PHASE_SECONDS` was a const
// literal here and `v_demate_s` was 11.5 in twin.ottoq_sim_stop_charge_session,
// with nothing linking them. Retuning the arm in either repo left the other
// reserving the plug for a window the robot no longer takes.
// ============================================================================
import { describe, it, expect, afterEach } from "vitest";
import {
  PHASE_SECONDS, ARM_TIMING_DEFAULTS, CONNECT_SECONDS, DISCONNECT_SECONDS,
  CYCLE_OVERHEAD_SECONDS, applyArmTimings, resetArmTimings, armTimingProvenance,
} from "./armStateMachine";
import * as arm from "./armStateMachine";

afterEach(() => resetArmTimings());

/** Exactly what `public.ottoq_arm_timings(NULL)` returns on a default database. */
const SERVED_DEFAULTS = {
  phase_seconds: {
    unstow: 3.0, approach: 6.0, align: 4.5, insert: 3.0, latch: 2.0,
    unlatch: 2.0, extract: 3.0, retract: 6.5,
  },
  connect_seconds: 18.5,
  demate_seconds: 11.5,
  cycle_overhead_seconds: 30.0,
  demate_source: "derived",
  source: "ottoq_policy_params",
};

describe("shipped defaults", () => {
  it("reproduce the documented cycle", () => {
    expect(CONNECT_SECONDS).toBe(18.5);
    expect(DISCONNECT_SECONDS).toBe(11.5);
    expect(CYCLE_OVERHEAD_SECONDS).toBe(30.0);
  });

  it("agree byte-for-byte with what the backend serves by default", () => {
    // If this fails, the two floors have drifted: someone changed a literal in
    // one repo without moving the ottoq_policy_params seed in the other.
    expect(PHASE_SECONDS).toEqual(SERVED_DEFAULTS.phase_seconds);
    expect(CONNECT_SECONDS).toBe(SERVED_DEFAULTS.connect_seconds);
    expect(DISCONNECT_SECONDS).toBe(SERVED_DEFAULTS.demate_seconds);
  });

  it("start out flagged as local, not backend-sourced", () => {
    expect(armTimingProvenance().source).toBe("defaults");
  });
});

describe("adopting served timings", () => {
  it("reports no change when the backend serves exactly the defaults", () => {
    expect(applyArmTimings(SERVED_DEFAULTS)).toBe(false);
    expect(arm.DISCONNECT_SECONDS).toBe(11.5);
    // ...but we HAVE now heard from the backend, and that is not the same state
    // as never having heard from it.
    expect(armTimingProvenance().source).toBe("backend");
  });

  it("THE ACCEPTANCE TEST: retract 6.5 -> 9.0 at the backend moves the demate window to 14.0", () => {
    // This payload is what ottoq_arm_timings() returns after a single
    // ottoq_policy_set('global', null, 'robotic_arm_retract_seconds', 9.0).
    const adopted = applyArmTimings({
      ...SERVED_DEFAULTS,
      phase_seconds: { ...SERVED_DEFAULTS.phase_seconds, retract: 9.0 },
      demate_seconds: 14.0,
      cycle_overhead_seconds: 32.5,
    });

    expect(adopted).toBe(true);
    expect(arm.PHASE_SECONDS.retract).toBe(9.0);
    expect(arm.DISCONNECT_SECONDS).toBe(14.0);
    expect(arm.CYCLE_OVERHEAD_SECONDS).toBe(32.5);
    expect(arm.CONNECT_SECONDS).toBe(18.5); // the mate side is untouched
    expect(armTimingProvenance().source).toBe("backend");
  });

  it("honours a whole-window override instead of re-deriving it", () => {
    // OTTO-Q's legacy `robotic_demate_seconds` knob pins the total without
    // touching the phases. The gate must reserve the plug for what OTTO-Q is
    // actually holding, even though 2 + 3 + 6.5 still sums to 11.5.
    applyArmTimings({ ...SERVED_DEFAULTS, demate_seconds: 20.0, demate_source: "override" });
    expect(arm.DISCONNECT_SECONDS).toBe(20.0);
    expect(arm.PHASE_SECONDS.unlatch + arm.PHASE_SECONDS.extract + arm.PHASE_SECONDS.retract).toBe(11.5);
    expect(armTimingProvenance().demateSource).toBe("override");
  });

  it("derives the totals when the backend serves phases only", () => {
    applyArmTimings({ phase_seconds: { ...SERVED_DEFAULTS.phase_seconds, retract: 10.0 } });
    expect(arm.DISCONNECT_SECONDS).toBe(15.0);
    expect(arm.CYCLE_OVERHEAD_SECONDS).toBe(33.5);
  });

  it("tracks a live retune, not just the first snapshot", () => {
    applyArmTimings({ phase_seconds: { retract: 9.0 } });
    expect(arm.DISCONNECT_SECONDS).toBe(14.0);
    applyArmTimings({ phase_seconds: { retract: 6.5 } });
    expect(arm.DISCONNECT_SECONDS).toBe(11.5);
  });
});

describe("a bad payload can never freeze a car", () => {
  // A phase that never ends is a car the gate never releases. Every rejection
  // below must leave the previous timings standing.
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["an older backend omitting the block", {}],
    ["a non-object", 42 as unknown as null],
  ])("ignores %s", (_label, payload) => {
    expect(applyArmTimings(payload as never)).toBe(false);
    expect(arm.DISCONNECT_SECONDS).toBe(11.5);
  });

  it.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["negative", -5],
    ["absurd", 99999],
    ["a string", "6.5" as unknown as number],
  ])("rejects %s and keeps the value in force", (_label, bad) => {
    applyArmTimings({ phase_seconds: { retract: bad as number } });
    expect(arm.PHASE_SECONDS.retract).toBe(6.5);
    expect(arm.DISCONNECT_SECONDS).toBe(11.5);
  });

  it("keeps good fields from a partly-corrupt payload", () => {
    applyArmTimings({ phase_seconds: { retract: 9.0, extract: Number.NaN } });
    expect(arm.PHASE_SECONDS.retract).toBe(9.0);
    expect(arm.PHASE_SECONDS.extract).toBe(3.0);
    expect(arm.DISCONNECT_SECONDS).toBe(14.0);
  });

  it("accepts a deliberate zero — 0 is a value, not a missing field", () => {
    applyArmTimings({ phase_seconds: { unstow: 0 } });
    expect(arm.PHASE_SECONDS.unstow).toBe(0);
    expect(arm.CONNECT_SECONDS).toBe(15.5);
  });
});

describe("resetArmTimings", () => {
  it("restores the shipped floor and the provenance with it", () => {
    applyArmTimings({ phase_seconds: { retract: 9.0 }, demate_source: "override" });
    resetArmTimings();
    expect(arm.PHASE_SECONDS).toEqual(ARM_TIMING_DEFAULTS);
    expect(arm.DISCONNECT_SECONDS).toBe(11.5);
    expect(armTimingProvenance()).toEqual({ source: "defaults", demateSource: "derived" });
  });
});
