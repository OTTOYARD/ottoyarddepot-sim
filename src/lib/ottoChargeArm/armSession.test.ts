/**
 * THE ARM HOLDS UNTIL THE CAR IS CHARGED.
 *
 * FOUNDER-OBSERVED: "the arm stays connected for a bit and then SNAPS UP to its
 * original unconnected position. I want the arm to remain until the charge is
 * full, then it slowly retracts back into place."
 *
 * Two defects, and this file is the evidence for both fixes:
 *
 *  (a) IT LET GO EARLY, because the phase came from phaseAt(elapsed, dwell) — a
 *      local stopwatch started when the car docked. The dwell is a RESERVATION;
 *      the charge takes as long as the pack takes. `holds while the car is
 *      charging` drives a session for over an hour of sim time with no dwell
 *      anywhere in the inputs and asserts the connector is still locked in.
 *
 *  (b) IT SNAPPED, because a clock-sampled phase has no memory of what it
 *      skipped. `no snapping` runs the real render path — reducer, IK, rate
 *      limit — and asserts no joint ever moves more than the servo ceiling in a
 *      frame, including through a car being swapped out from under a mated arm.
 *
 * These are unit tests over pure functions, deliberately. The component wires
 * them to the two authorities (vehicle state, stall tether) and does nothing
 * else, so everything worth asserting is assertable here.
 */

import { describe, it, expect } from 'vitest';
import {
  advanceArmSession, demateSpeed, isArmCommitted, isArmHome, phaseDuration,
  remainingDemateSeconds, IDLE_SESSION, MATE_CHAIN, DEMATE_CHAIN,
  MAX_SESSION_STEP_S, MIN_DEMATE_SPEED, MAX_DEMATE_SPEED, CLEAR_SECONDS,
  ROBOTIC_OVERHEAD_SECONDS, type ArmSession, type ArmSessionInput,
} from './roboticService';
import {
  CONNECT_SECONDS, DISCONNECT_SECONDS, NOMINAL_SEQUENCE, PHASE_SECONDS,
  isTethered, vehicleMayMove, type ArmPhase,
} from './armStateMachine';
import {
  poseFor, slewAngles, maxJointDelta, releaseEntry, easeInv, MAX_JOINT_RATE,
} from './armMotion';
import { portInArmFrame, placeArm } from './depotPlacement';
import { portFor } from './chargePort';
import { OTTO_CHARGE_ARM, METRES_PER_PLAN_UNIT } from './cobotSpec';
import { CAR_WIDTH } from '@/engine/motion/traffic';
import { MAX_SPEED_X } from "@/hooks/useTwinControl";
import { generateStallsV2 } from '@/lib/sitePlan';
import { STOWED, ease, forwardTCP, type Vec3 } from './cobotIK';

const spec = OTTO_CHARGE_ARM;
const CAR_HALF_WIDTH_M = (CAR_WIDTH * METRES_PER_PLAN_UNIT) / 2;
const FRAME = 1 / 60;

/** The steady input for a car that is parked and taking current. */
const CHARGING: ArmSessionInput = {
  dt: FRAME, vehicleId: 'v1', charging: true, tetherRemainingS: null,
};

/** Drive a session for `seconds`, collecting every distinct phase it passes. */
function run(
  from: ArmSession,
  seconds: number,
  input: (elapsed: number) => Partial<ArmSessionInput>,
  dt = FRAME,
): { session: ArmSession; phases: ArmPhase[]; at: Map<ArmPhase, number> } {
  let session = from;
  const phases: ArmPhase[] = [session.phase];
  const at = new Map<ArmPhase, number>([[session.phase, 0]]);
  for (let e = 0; e < seconds; e += dt) {
    session = advanceArmSession(session, { ...CHARGING, dt, ...input(e) });
    if (phases[phases.length - 1] !== session.phase) {
      phases.push(session.phase);
      if (!at.has(session.phase)) at.set(session.phase, e);
    }
  }
  return { session, phases, at };
}

// ═══════════════════════════════════════════════════════════════════════════
// (a) THE HOLD
// ═══════════════════════════════════════════════════════════════════════════

describe('the arm holds until the car is charged', () => {
  it('stays latched for an arbitrarily long charge — 10x any service duration', () => {
    // The longest dwell the old clock could have been handed, ten times over.
    // If ANY duration is still hiding in the reducer, this is where it expires.
    const LONGEST_PLAUSIBLE_SERVICE = 3600 + ROBOTIC_OVERHEAD_SECONDS;
    const seconds = LONGEST_PLAUSIBLE_SERVICE * 10;

    const { session, phases } = run(IDLE_SESSION, seconds, () => ({}));

    expect(session.phase).toBe('charging');
    expect(isTethered(session.phase)).toBe(true);
    expect(vehicleMayMove(session.phase)).toBe(false);
    // it got there by mating, and it never left
    expect(phases).toEqual(['stowed', ...MATE_CHAIN, 'charging']);
    // and the connector is fully locked, not merely "in a charging-ish phase"
    expect(poseFor(session, targetFor('v1', 1), spec).latch).toBe(1);
    // the hold really is open-ended in the model, not a very large number
    expect(phaseDuration('charging')).toBe(Infinity);
    expect(session.phaseElapsed).toBeGreaterThan(seconds - CONNECT_SECONDS - 1);
  });

  it('mates on the same physical schedule it always did', () => {
    // The fix must not have quietly retimed the choreography.
    const { at } = run(IDLE_SESSION, 60, () => ({}));
    expect(at.get('charging')).toBeGreaterThan(CONNECT_SECONDS - 0.5);
    expect(at.get('charging')).toBeLessThan(CONNECT_SECONDS + 0.5);
  });

  it('keeps holding when OTTO-Q stops publishing a dwell window mid-charge', () => {
    // Dwell legs are rebuilt from scratch on every snapshot. A re-plan that drops
    // the leg must not yank the connector out of a car that is still charging —
    // which is why the component gates the START of a mate on the window and the
    // CONTINUATION on the vehicle's state. isArmCommitted is that gate.
    const { session } = run(IDLE_SESSION, 300, () => ({}));
    expect(isArmCommitted(session.phase)).toBe(true);

    // The component's own gate, verbatim. `parked` is the dwell window; it is
    // required to START a mate (an arm must not reach into a stall a car is
    // still taxiing toward) and deliberately NOT required to continue one.
    const gate = (chargingState: boolean, parked: boolean, phase: ArmPhase) =>
      chargingState && (parked || isArmCommitted(phase));

    expect(gate(true, false, session.phase)).toBe(true);   // window gone, hold stands
    expect(gate(true, false, 'stowed')).toBe(false);       // …but no window, no mate
    expect(gate(true, true, 'stowed')).toBe(true);
    expect(gate(false, true, session.phase)).toBe(false);  // state beats everything
  });

  it('never invents a mate: a tether on a stall whose arm is home changes nothing', () => {
    // The tether is a RELEASE signal. A home arm has nothing to release. The
    // previous override replaced the phase unconditionally and had to be fenced
    // off with a whitelist; here it is structural — 'stowed' has no demate entry.
    const { session, phases } = run(IDLE_SESSION, 120, () => ({
      vehicleId: null, charging: false, tetherRemainingS: 11.5,
    }));
    expect(session.phase).toBe('stowed');
    expect(phases).toEqual(['stowed']);
  });

  it('will not reach for a car that is in the stall but not yet charging', () => {
    const { session } = run(IDLE_SESSION, 120, () => ({ charging: false }));
    expect(session.phase).toBe('stowed');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// THE RELEASE — on state, and only on state
// ═══════════════════════════════════════════════════════════════════════════

describe('the demate begins when the state says so, and not before', () => {
  it('starts on the stall tether, within a frame of it appearing', () => {
    let s = run(IDLE_SESSION, 600, () => ({})).session;
    expect(s.phase).toBe('charging');
    s = advanceArmSession(s, { ...CHARGING, tetherRemainingS: DISCONNECT_SECONDS });
    expect(s.phase).toBe('unlatch');
  });

  it('starts when the vehicle leaves the charging state, tether or no tether', () => {
    let s = run(IDLE_SESSION, 600, () => ({})).session;
    s = advanceArmSession(s, { ...CHARGING, charging: false });
    expect(s.phase).toBe('unlatch');
  });

  it('starts when the car in the stall is replaced under a mated arm', () => {
    let s = run(IDLE_SESSION, 600, () => ({})).session;
    s = advanceArmSession(s, { ...CHARGING, vehicleId: 'v2' });
    expect(s.phase).toBe('unlatch');
    // …and it keeps serving the car it actually mated to until it is home, so the
    // retract plays out against THAT car's inlet.
    expect(s.vehicleId).toBe('v1');
  });

  it('plays every release phase in order, never jumping to the cradle', () => {
    const start = run(IDLE_SESSION, 600, () => ({})).session;
    const { session, phases } = run(start, 60, () => ({
      charging: false, tetherRemainingS: DISCONNECT_SECONDS,
    }));
    expect(phases).toEqual(['charging', ...DEMATE_CHAIN, 'clear', 'stowed']);
    expect(session.phase).toBe('stowed');
  });

  it('runs the WHOLE cycle in the nominal order with no gaps and no repeats', () => {
    const start = run(IDLE_SESSION, 600, () => ({}));
    const rest = run(start.session, 60, () => ({ charging: false }));
    const all = [...start.phases, ...rest.phases.slice(1)];
    expect(all).toEqual([...NOMINAL_SEQUENCE, 'stowed']);
  });

  it('takes the physical release time when OTTO-Q publishes no deadline', () => {
    const start = run(IDLE_SESSION, 600, () => ({})).session;
    const { at } = run(start, 60, () => ({ charging: false }));
    expect(at.get('clear')).toBeGreaterThan(DISCONNECT_SECONDS - 0.5);
    expect(at.get('clear')).toBeLessThan(DISCONNECT_SECONDS + 0.5);
  });

  it('holds the vehicle until the arm is CLEAR, not until charging ends', () => {
    const start = run(IDLE_SESSION, 600, () => ({})).session;
    let s = start;
    let lastLocked = -1;
    let released = -1;
    for (let e = 0; e < 60; e += FRAME) {
      s = advanceArmSession(s, { ...CHARGING, charging: false });
      if (isTethered(s.phase)) lastLocked = e;
      if (released < 0 && vehicleMayMove(s.phase)) released = e;
    }
    expect(lastLocked).toBeGreaterThan(0);
    expect(released).toBeGreaterThan(lastLocked);
    // the gap is the physical extract + retract, not an arbitrary delay
    expect(released - lastLocked).toBeGreaterThan(PHASE_SECONDS.extract);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PACING THE RELEASE AGAINST OTTO-Q's DEADLINE
// ═══════════════════════════════════════════════════════════════════════════

describe('the release is paced by the tether, never resolved from it', () => {
  it('lands the arm home about when the deadline expires', () => {
    const start = run(IDLE_SESSION, 600, () => ({})).session;
    const WINDOW = 8; // OTTO-Q allows less than the nominal 11.5 s
    let s = start;
    let homeAt = -1;
    for (let e = 0; e < 40; e += FRAME) {
      s = advanceArmSession(s, {
        dt: FRAME, vehicleId: 'v1', charging: false,
        tetherRemainingS: Math.max(0, WINDOW - e),
      });
      if (homeAt < 0 && isArmHome(s.phase)) homeAt = e;
    }
    expect(homeAt).toBeGreaterThan(WINDOW * 0.6);
    expect(homeAt).toBeLessThan(WINDOW * 1.6);
  });

  it('refuses to teleport home on a zero or expired deadline', () => {
    // A tether that says "0 seconds left" is not permission to be in the cradle
    // this frame. The speed is bounded, so the arm still walks the chain.
    const start = run(IDLE_SESSION, 600, () => ({})).session;
    let s = start;
    const phases: ArmPhase[] = [];
    for (let e = 0; e < 20; e += FRAME) {
      s = advanceArmSession(s, {
        dt: FRAME, vehicleId: 'v1', charging: false, tetherRemainingS: 0,
      });
      if (phases[phases.length - 1] !== s.phase) phases.push(s.phase);
    }
    expect(phases).toEqual([...DEMATE_CHAIN, 'clear', 'stowed']);
    // fastest legal release is the nominal one compressed by MAX_DEMATE_SPEED
    expect(DISCONNECT_SECONDS / MAX_DEMATE_SPEED).toBeGreaterThan(3);
  });

  it('bounds the playback rate in both directions', () => {
    expect(demateSpeed('retract', 0, 0)).toBe(MAX_DEMATE_SPEED);
    expect(demateSpeed('retract', 0, 1e6)).toBe(MIN_DEMATE_SPEED);
    expect(demateSpeed('retract', 0, NaN)).toBeGreaterThanOrEqual(MIN_DEMATE_SPEED);
    // a deadline is meaningless outside the release chain
    expect(demateSpeed('charging', 0, 3)).toBe(1);
    expect(demateSpeed('approach', 0, 3)).toBe(1);
    expect(demateSpeed('stowed', 0, 3)).toBe(1);
  });

  it('counts the release from wherever it actually is', () => {
    expect(remainingDemateSeconds('unlatch', 0)).toBeCloseTo(DISCONNECT_SECONDS, 6);
    expect(remainingDemateSeconds('retract', PHASE_SECONDS.retract)).toBe(0);
    expect(remainingDemateSeconds('charging', 0)).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// (b) NO SNAPPING
// ═══════════════════════════════════════════════════════════════════════════

function targetFor(vehicleId: string, toward: 1 | -1) {
  const port = portFor(vehicleId, 'waymo');
  return {
    port: portInArmFrame(port.along, port.height, CAR_HALF_WIDTH_M, toward),
    normal: { x: 0, y: 0, z: -1 },
  };
}

/**
 * The component's frame loop, in miniature: step the session, solve the pose,
 * then drive the SHOWN joints toward it at the servo ceiling. Everything the
 * founder can see passes through here.
 */
function render(
  frames: number,
  inputAt: (frame: number) => Partial<ArmSessionInput>,
  targetAt: (frame: number, s: ArmSession) => ReturnType<typeof targetFor>,
) {
  let session = IDLE_SESSION;
  let shown = { ...STOWED };
  let worstStep = 0;
  let worstAt = '';
  for (let f = 0; f < frames; f++) {
    session = advanceArmSession(session, { ...CHARGING, ...inputAt(f) });
    const pose = poseFor(session, targetAt(f, session), spec);
    const next = slewAngles(shown, pose.angles, FRAME);
    const step = maxJointDelta(shown, next);
    if (step > worstStep) { worstStep = step; worstAt = `${session.phase} f=${f}`; }
    shown = next;
  }
  return { session, shown, worstStep, worstAt };
}

describe('no snapping — the pose is continuous whatever the inputs do', () => {
  it('never moves a joint more than the servo ceiling in one frame', () => {
    const CHARGE_FRAMES = 60 * 600;
    const r = render(
      CHARGE_FRAMES + 60 * 40,
      (f) => (f < CHARGE_FRAMES ? {} : { charging: false, tetherRemainingS: 0 }),
      () => targetFor('v1', 1),
    );
    expect(r.worstStep, r.worstAt).toBeLessThanOrEqual(MAX_JOINT_RATE * FRAME + 1e-12);
    // a few degrees per frame, which is what "no snap" means on screen
    expect((MAX_JOINT_RATE * FRAME * 180) / Math.PI).toBeLessThan(4);
    expect(r.session.phase).toBe('stowed');
  });

  it('absorbs a car being swapped out from under a mated arm', () => {
    // The nastiest discontinuity available: the IK goal moves while the connector
    // is in an inlet. The reducer keeps serving the old car; the limiter covers
    // whatever is left.
    const CHARGE_FRAMES = 60 * 120;
    const r = render(
      CHARGE_FRAMES + 60 * 40,
      (f) => (f < CHARGE_FRAMES ? {} : { vehicleId: 'v2' }),
      (f, s) => targetFor(s.vehicleId ?? `swapped-${f}`, 1),
    );
    expect(r.worstStep, r.worstAt).toBeLessThanOrEqual(MAX_JOINT_RATE * FRAME + 1e-12);
  });

  it('absorbs a target that flips to the far side of the aisle', () => {
    // toward flips sign only if a stall's placement is re-derived, but the point
    // of a rate limit is that it does not matter WHY the goal moved.
    const r = render(
      60 * 200,
      () => ({}),
      (f) => targetFor('v1', f < 60 * 100 ? 1 : -1),
    );
    expect(r.worstStep, r.worstAt).toBeLessThanOrEqual(MAX_JOINT_RATE * FRAME + 1e-12);
  });

  // Same reasoning as the sweep below: explicit headroom, not a global raise.
  it('the limiter is INERT at every supported playback speed — it protects, it does not pace', () => {
    // The session advances in SIM seconds; the limiter bounds REAL joint travel.
    // At Nx playback the same choreography is drawn N times faster, so the
    // headroom that matters is measured against the fastest playback the product
    // actually permits — not against 1x. Asserting it at 1x would leave the arm
    // free to start silently lagging its own animation at the speed the demo is
    // usually run at.
    //
    // The arm's clock advances at the run's speed_x (simClockTod), so the ceiling that
    // matters is ottoq_set_playback's clamp — NOT TwinMotionDriver.setViewMult, which is
    // a separate render-side view multiplier that still clamps to 3 and does not touch
    // the sim clock. Conflating the two is how this test came to certify 3x.
    //
    // DRIFT PIN, deliberately imported rather than retyped: this was hardcoded to 3 with
    // a comment asserting "hard-capped at 3 backend-side". That stopped being true when
    // the founder raised the continuous-play ceiling to 8x (migration
    // continuous_playback_ceiling_is_eight_x), leaving a guard that certified a ceiling
    // 2.7x below the one the product actually permits — i.e. it would have passed while
    // the arm silently lagged its own animation at the speed the demo is run at.
    const MAX_PLAYBACK_X = MAX_SPEED_X;

    let worst = 0;
    let worstAt = '';
    for (const st of generateStallsV2().filter((s) => s.type === 'dcfc')) {
      const p = placeArm(st.id, st.position.x, st.position.y);
      for (const oem of ['tesla', 'waymo', 'zoox', 'cruise', 'motional', 'van', null]) {
        const port = portFor(`veh-${st.id}-${oem}`, oem);
        const target = {
          port: portInArmFrame(port.along, port.height, CAR_HALF_WIDTH_M, p.toward),
          normal: { x: 0, y: 0, z: -1 },
        };
        let session = IDLE_SESSION;
        let prev = poseFor(session, target, spec).angles;
        for (let f = 0; f < 60 * 90; f++) {
          session = advanceArmSession(session, {
            dt: FRAME, vehicleId: 'v1',
            charging: f < 60 * 60,
            tetherRemainingS: f < 60 * 60 ? null : DISCONNECT_SECONDS,
          });
          const a = poseFor(session, target, spec).angles;
          const rate = maxJointDelta(prev, a) / FRAME;
          if (rate > worst) { worst = rate; worstAt = `${session.phase} ${st.id} ${oem}`; }
          prev = a;
        }
      }
    }
    // MEASURED: 0.611 rad/s at 1x (fastest joint, in 'unstow').
    //
    // This assertion used to read `worst * 3 < MAX_JOINT_RATE` and was described as
    // proving the limiter is inert "at every supported playback speed". That was only
    // ever true of a 3x world. At the real ceiling (8x) the request is 4.89 rad/s
    // against a 2.5 rad/s servo, so the limiter DOES bind — and that is correct, not a
    // regression: a physical arm cannot travel eight times faster because the operator
    // is fast-forwarding. ChargingArm says so in the code ("above ~4x playback it
    // becomes the binding constraint and the arm trails the clock slightly, the same
    // way the cars do").
    //
    // So the honest guard is TWO claims, not one:
    //   1. the limiter is genuinely inert through the speeds where the arm can keep up;
    //   2. past that it DEGRADES BY TRAILING, never by snapping — which is the property
    //      the founder actually reported and the rest of this describe block pins.
    const bindsAt = MAX_JOINT_RATE / worst;              // measured ~4.09x
    expect(worst, worstAt).toBeLessThan(1.0);
    expect(bindsAt, `limiter should stay inert to at least 4x; binds at ${bindsAt.toFixed(2)}x`)
      .toBeGreaterThan(4);
    // and the ceiling it binds against is a REAL servo rate, not an arbitrary number:
    // MAX_JOINT_RATE * FRAME is under 4 degrees per frame (asserted above), so even when
    // it binds, the arm slews — it cannot teleport.
    expect(MAX_PLAYBACK_X).toBeGreaterThanOrEqual(bindsAt);
  }, 20_000);

  it('slewAngles bounds a deliberate teleport request', () => {
    const far = { j1: 3, j2: -3, j3: 3, j4: -3, j5: 3, j6: -3 };
    let a = { ...STOWED };
    for (let i = 0; i < 5; i++) {
      const next = slewAngles(a, far, FRAME);
      expect(maxJointDelta(a, next)).toBeLessThanOrEqual(MAX_JOINT_RATE * FRAME + 1e-12);
      a = next;
    }
    // a zero or negative frame time freezes rather than jumping
    expect(slewAngles(a, far, 0)).toEqual(a);
    expect(slewAngles(a, far, -1)).toEqual(a);
    expect(slewAngles(a, far, NaN)).toEqual(a);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AN INTERRUPTED MATE MUST NOT LUNGE AT THE CAR
//
// The release chain is entered from wherever the reach got to. Entering it at
// t=0 looks right and is not: a release phase at t=0 is a pose AT THE INLET, so
// a mate aborted just after leaving the cradle asked the arm to travel out to
// the car before folding home. MEASURED at 142° on one joint for an abort 0.25 s
// into 'unstow'. The rate limiter turned that into a ~1 s sweep instead of a
// teleport — bounded, and still the arm lunging at a vehicle it was supposed to
// be backing away from.
//
// releaseEntry() rejoins the chain at the point whose pose is the pose already
// held, so the abort is continuous by construction rather than by tuning.
// ═══════════════════════════════════════════════════════════════════════════

const dist = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** Every DCFC stall crossed with every modelled port — the real target set. */
function everyArmAndPort() {
  const out: { label: string; target: ReturnType<typeof targetFor> }[] = [];
  for (const st of generateStallsV2().filter((s) => s.type === 'dcfc')) {
    const p = placeArm(st.id, st.position.x, st.position.y);
    for (const oem of ['tesla', 'waymo', 'zoox', 'cruise', 'motional', 'van', null]) {
      const port = portFor(`veh-${st.id}-${oem}`, oem);
      out.push({
        label: `${st.id}/${oem}`,
        target: {
          port: portInArmFrame(port.along, port.height, CAR_HALF_WIDTH_M, p.toward),
          normal: { x: 0, y: 0, z: -1 },
        },
      });
    }
  }
  return out;
}

/**
 * Every state the arm passes through on its way to a hold, one frame apart.
 *
 * An ArmSession is a plain value and the reducer is pure, so a release can be
 * FORKED off any of these without re-running the reach. Re-simulating the mate
 * per abort point is quadratic and times the suite out; forking is linear.
 */
function reachFrames(seconds: number): ArmSession[] {
  const out: ArmSession[] = [];
  let s = IDLE_SESSION;
  for (let e = 0; e < seconds; e += FRAME) {
    s = advanceArmSession(s, CHARGING);
    out.push(s);
  }
  return out;
}

/** Pull the charge away from `s` and hand back the first frame of the release. */
const abortFrom = (s: ArmSession) => advanceArmSession(s, { ...CHARGING, charging: false });

/** Run a release to completion, calling `each` on every frame. Bounded. */
function playRelease(s0: ArmSession, each: (s: ArmSession) => void) {
  let s = s0;
  each(s);
  for (let e = 0; e < 30 && !isArmHome(s.phase); e += FRAME) {
    s = advanceArmSession(s, { ...CHARGING, charging: false });
    each(s);
  }
  return s;
}

describe('an interrupted mate rejoins the release where it already is', () => {
  it('is EXACTLY continuous whenever the abort lands, on every arm and port', () => {
    // Sweeps the whole reach frame by frame — unstow, approach, align, insert,
    // latch — for all 10 DCFC arms and all 7 port variants. This is the assertion
    // that would have caught the 142° step.
    const reach = reachFrames(CONNECT_SECONDS + 1);
    let worst = 0;
    let worstAt = '';
    for (const { label, target } of everyArmAndPort()) {
      for (const before of reach) {
        const after = abortFrom(before);
        const jump = maxJointDelta(
          poseFor(before, target, spec).angles,
          poseFor(after, target, spec).angles,
        );
        if (jump > worst) { worst = jump; worstAt = `${before.phase}→${after.phase} ${label}`; }
      }
    }
    // Exact, not merely small: the entry point is solved, not approximated.
    expect(worst, worstAt).toBeLessThan(1e-9);
  });

  // 60 s, not the 5 s default: this is an exhaustive physical sweep, not a unit test,
  // and CI's shared runner is many times slower than a dev machine. Scoped to THIS
  // test rather than raised globally on purpose — a global testTimeout would also hand
  // 60 s to every genuinely hung test in the suite, which is how a slow suite creeps.
  //
  // RAISED FROM 20 s TO 60 s, and the ratio is measured rather than guessed. At 20 s
  // this test was the sole failure in `verify` on THREE separate runs, including twice
  // on `main` itself — runs 120 (head 53c8bdb) and 122 (head 9ede5a3), both merge
  // commits, and then again on PR #101 whose two-file diff does not touch this
  // directory at all. Every failure is the same line and the same message:
  //   Error: Test timed out in 20000ms.  ❯ armSession.test.ts:523:3
  //
  // The numbers, from the PR #101 run against the same commit locally:
  //   local  1,375 ms  (whole file 3,342 ms, 30 tests)
  //   CI    20,771 ms  — 15.1x slower, and 771 ms over a 20,000 ms budget
  //
  // So it was never passing with margin on CI; it was passing by luck, which is why
  // run 124 on `main` went green on the identical code. The note below already
  // measured "north of 12x" and concluded "raising the number again is a guess, not a
  // fix" — correct about the SAMPLING, which is why the per-phase forking below stays
  // exactly as it is. But the sampling is not what is marginal now: 1.4 s of local work
  // is the right cost for this sweep, and a 20 s ceiling simply does not cover 15x.
  //
  // 60 s is ~2.9x the observed CI time, so a runner twice as bad as the worst seen
  // still passes. This costs nothing on the happy path — a timeout is a hang detector,
  // not a budget the test spends — and it weakens no assertion: the property below
  // (an abort adds no connector travel beyond the nominal arc, within 5 mm) is
  // unchanged, over the same exhaustive 10 arms x 7 ports geometry. The alternative,
  // thinning the sampling further, would have traded real coverage for wall clock.
  it('never moves the connector toward the car more than a normal release does', () => {
    // The physical statement of the same bug, and the one that does not depend on
    // WHERE the abort happened. Measure how far the connector ever travels back
    // TOWARD the inlet during a release — the drop from its running maximum
    // distance — and compare an aborted release against a nominal one.
    //
    // A nominal release is not zero: RETRACT folds home by blending joint angles
    // (deliberately — see armMotion), and that arc carries the connector ~0.147 m
    // back toward the car on its way to the cradle. That is approved, pre-existing
    // choreography. What matters is that an ABORT adds nothing to it.
    //
    // MEASURED across all 10 DCFC arms × 7 ports × every abort instant:
    //   nominal 0.1466 m · aborted 0.1483 m — a 1.7 mm difference.
    // Before the fix an abort during 'unstow' drove the connector from 0.96 m to
    // 0.10 m: an 0.86 m lunge, ~6x the nominal arc. This test is what says so.
    const TOLERANCE = 0.005;

    const approachToward = (target: ReturnType<typeof targetFor>, s0: ArmSession) => {
      let peak = -Infinity;
      let worst = 0;
      playRelease(s0, (s) => {
        const d = dist(forwardTCP(poseFor(s, target, spec).angles, spec), target.port);
        peak = Math.max(peak, d);
        worst = Math.max(worst, peak - d);
      });
      return worst;
    };

    // One walk of the reach, forked at a sampled set of instants; plus a settled hold
    // to give the nominal baseline.
    //
    // COST, AND WHY THE SAMPLING IS BY PHASE RATHER THAN BY TIME.
    //
    // Every fork replays a whole release with an IK solve per frame, so the work is
    // (arms x ports x abort-instants x release-frames). A uniform 0.1 s stride was about
    // 9 million solves: 3.9 s on an M3 and a TIMEOUT on CI. Widening the stride to 0.25 s
    // cut that to 1.6 s locally — and it STILL timed out on CI at a 20 s budget, which
    // puts the runner north of 12x slower than this machine. At that ratio, raising the
    // number again is a guess, not a fix.
    //
    // So the sampling now follows the STRUCTURE OF THE FAILURE instead of the clock.
    // The defect this test exists for is phase-entry-specific: an abort during 'unstow'
    // drove the connector 0.86 m back toward the inlet, ~6x the nominal arc. Travel
    // varies smoothly WITHIN a phase, so dense sampling inside one buys almost nothing,
    // while every phase boundary is a distinct opportunity for the entry maths to be
    // wrong. Forking a fixed number of evenly spaced instants PER PHASE therefore aims
    // at the bug class directly and costs a fraction of a uniform sweep.
    //
    // GEOMETRY IS STILL EXHAUSTIVE — all 10 DCFC arms x 7 port variants. That axis is
    // where a real defect hides (a particular arm placement and port position), and it
    // has never been the expensive one.
    const reach = reachFrames(CONNECT_SECONDS + 1);
    const held = reachFrames(CONNECT_SECONDS + 20).pop()!;

    const FORKS_PER_PHASE = 4;
    const byPhase = new Map<string, ArmSession[]>();
    for (const f of reach) {
      const list = byPhase.get(f.phase) ?? [];
      list.push(f);
      byPhase.set(f.phase, list);
    }
    const forkAt: ArmSession[] = [];
    for (const [, frames] of byPhase) {
      const step = Math.max(1, Math.floor(frames.length / FORKS_PER_PHASE));
      for (let i = 0; i < frames.length; i += step) forkAt.push(frames[i]);
    }

    // SELF-GUARDING. The justification above is "every phase is forked several times" —
    // asserted, not asserted-in-a-comment, so nobody can thin this to make it faster
    // without the test saying so.
    for (const [ph, frames] of byPhase) {
      const n = forkAt.filter((f) => f.phase === ph).length;
      expect(n, `phase '${ph}' (${frames.length} frames) is forked only ${n} time(s)`)
        .toBeGreaterThanOrEqual(Math.min(FORKS_PER_PHASE, frames.length));
    }

    for (const { label, target } of everyArmAndPort()) {
      const nominal = approachToward(target, abortFrom(held));
      for (const before of forkAt) {
        const aborted = approachToward(target, abortFrom(before));
        expect(aborted, `${label} abort in ${before.phase}`)
          .toBeLessThanOrEqual(nominal + TOLERANCE);
      }
    }
  }, 60_000);

  it('an arm that had barely left the cradle is home almost at once', () => {
    // It is a quarter-second from stowed, so the honest release is a quarter-second
    // back. The old entry made it play a full 6.5 s retract — and play it starting
    // from the inlet. Time-to-home is the founder-visible consequence.
    const timeToHome = (s0: ArmSession) => {
      let n = 0;
      playRelease(s0, (s) => { if (!isArmHome(s.phase)) n++; });
      return n * FRAME;
    };

    const barely = abortFrom(reachFrames(0.25).pop()!);
    expect(barely.phase).toBe('retract');
    expect(timeToHome(barely)).toBeLessThan(2);

    // …whereas a release from a real charge takes the whole physical demate.
    const settled = abortFrom(reachFrames(CONNECT_SECONDS + 20).pop()!);
    expect(settled.phase).toBe('unlatch');
    expect(timeToHome(settled)).toBeGreaterThan(DISCONNECT_SECONDS - 0.5);
  });

  it('rests on smoothstep symmetry, which is asserted rather than assumed', () => {
    // releaseEntry reverses 'latch' and 'insert' with t → 1-t. That is only exact
    // because ease(1-x) === 1-ease(x). If ease were ever retuned to an asymmetric
    // curve, those two reversals would drift and this is the tripwire.
    for (let x = 0; x <= 1.0001; x += 0.01) {
      expect(ease(1 - x)).toBeCloseTo(1 - ease(x), 12);
      expect(easeInv(ease(x))).toBeCloseTo(x, 9);
    }
    expect(easeInv(0)).toBeCloseTo(0, 12);
    expect(easeInv(1)).toBeCloseTo(1, 12);
    // and it is total: out-of-range input is clamped, never NaN
    expect(Number.isFinite(easeInv(-5))).toBe(true);
    expect(Number.isFinite(easeInv(5))).toBe(true);
  });

  it('offers no release entry for phases a release cannot interrupt', () => {
    // A whitelist, like every other gate here. 'stowed' and 'clear' have nothing
    // to release — that is what stops a tether inventing a demate on a home arm.
    for (const p of ['stowed', 'clear', 'unlatch', 'extract', 'retract', 'fault'] as ArmPhase[]) {
      expect(releaseEntry(p, 0.5), p).toBeNull();
    }
    for (const p of ['unstow', 'approach', 'align', 'insert', 'latch', 'charging'] as ArmPhase[]) {
      const e = releaseEntry(p, 0.5);
      expect(e, p).not.toBeNull();
      expect(DEMATE_CHAIN).toContain(e!.phase);
      expect(e!.t).toBeGreaterThanOrEqual(0);
      expect(e!.t).toBeLessThanOrEqual(1);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TOTALITY — every gate in this file must be a total function
// ═══════════════════════════════════════════════════════════════════════════

describe('the reducer is total and fails safe', () => {
  it('never emits a phase outside the modelled set, whatever the inputs', () => {
    const known = new Set<string>([...NOMINAL_SEQUENCE, 'fault']);
    let s = IDLE_SESSION;
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let i = 0; i < 20000; i++) {
      s = advanceArmSession(s, {
        dt: [FRAME, 0, -1, NaN, 1e9, 0.5][Math.floor(rnd() * 6)],
        vehicleId: rnd() < 0.2 ? null : `v${Math.floor(rnd() * 3)}`,
        charging: rnd() < 0.6,
        tetherRemainingS: rnd() < 0.3 ? rnd() * 20 : null,
      });
      expect(known.has(s.phase)).toBe(true);
      expect(Number.isFinite(s.t)).toBe(true);
      expect(s.t).toBeGreaterThanOrEqual(0);
      expect(s.t).toBeLessThanOrEqual(1);
      expect(Number.isFinite(s.phaseElapsed)).toBe(true);
      expect(s.phaseElapsed).toBeGreaterThanOrEqual(0);
    }
  });

  it('caps a single step, so a backgrounded tab cannot fast-forward the cycle', () => {
    // One enormous frame must not vault past the mate. MAX_SESSION_STEP_S is
    // shorter than the shortest phase pair, so at most one boundary is crossed.
    const s = advanceArmSession(IDLE_SESSION, { ...CHARGING, dt: 1e6 });
    expect(MAX_SESSION_STEP_S).toBeLessThan(PHASE_SECONDS.unstow);
    expect(s.phase).toBe('unstow');
  });

  it('plays every phase even when driven in huge steps', () => {
    const seen: ArmPhase[] = [];
    let s = IDLE_SESSION;
    for (let i = 0; i < 400; i++) {
      s = advanceArmSession(s, { ...CHARGING, dt: 1e6, charging: i < 200 });
      if (seen[seen.length - 1] !== s.phase) seen.push(s.phase);
    }
    expect(seen).toEqual([...NOMINAL_SEQUENCE.filter((p) => p !== 'stowed'), 'stowed']);
  });

  it('classifies home and committed phases exhaustively', () => {
    for (const p of NOMINAL_SEQUENCE) {
      expect(isArmHome(p) || isArmCommitted(p)).toBe(true);
      expect(isArmHome(p) && isArmCommitted(p)).toBe(false);
    }
    expect(isArmHome('stowed')).toBe(true);
    expect(isArmHome('clear')).toBe(true);
    expect(phaseDuration('clear')).toBe(CLEAR_SECONDS);
    expect(phaseDuration('stowed')).toBe(Infinity);
    expect(phaseDuration('fault')).toBe(Infinity);
  });
});
