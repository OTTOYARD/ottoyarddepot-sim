import { describe, it, expect } from "vitest";
import { ArmGate, HOLD_CAP_S, maxPhysicalDemateS, type ArmStallInput } from "./armGate";
import {
  NOMINAL_SEQUENCE, vehicleMayMove, CONNECT_SECONDS, DISCONNECT_SECONDS, type ArmPhase,
} from "@/lib/ottoChargeArm/armStateMachine";
import {
  advanceArmSession, armSessionInput, isArmHome, playArmSession, phaseDuration, ARM_SUBSTEP_S, CLEAR_SECONDS,
  DEMATE_CHAIN, IDLE_SESSION, type ArmSession,
} from "@/lib/ottoChargeArm/roboticService";

/** One DCFC stall with a car on it, taking current. */
const charging = (over: Partial<ArmStallInput> = {}): ArmStallInput => ({
  stallId: "DCFC-01",
  stallType: "dcfc",
  vehicleId: "v1",
  chargingState: true,
  parked: true,
  tetherRemainingS: null,
  ...over,
});

/** Step until `pred` holds, or give up. Returns the sim seconds spent. */
function stepUntil(
  gate: ArmGate, input: () => ArmStallInput, pred: () => boolean, dt = 0.5, maxS = 400,
): number {
  let t = 0;
  while (t < maxS && !pred()) {
    gate.step(dt, [input()]);
    t += dt;
  }
  return t;
}

describe("ArmGate — the depart gate", () => {
  it("holds the car for the WHOLE mate → charge → demate cycle, and releases only after", () => {
    const gate = new ArmGate();
    // stowed and empty: nothing to wait for
    expect(gate.mayMove("DCFC-01")).toBe(true);

    // a car docks and starts taking current → the arm reaches for the port
    stepUntil(gate, () => charging(), () => gate.phase("DCFC-01") === "charging");
    expect(gate.phase("DCFC-01")).toBe("charging");
    expect(gate.mayMove("DCFC-01")).toBe(false);

    // the charge runs long. NOTHING here can end it — there is no duration.
    gate.step(30, [charging()]);
    gate.step(30, [charging()]);
    expect(gate.phase("DCFC-01")).toBe("charging");
    expect(gate.mayMove("DCFC-01")).toBe(false);

    // OTTO-Q re-tasks the car: the roster status flips away from 'charging'.
    // That is the release trigger, and the car must STILL not move yet.
    const done = () => charging({ chargingState: false, parked: false });
    gate.step(0.5, [done()]);
    expect(gate.phase("DCFC-01")).toBe("unlatch");
    expect(gate.mayMove("DCFC-01")).toBe(false);

    // …through unlatch, extract and retract, held the entire way.
    const spent = stepUntil(gate, done, () => gate.mayMove("DCFC-01"), 0.25, 200);
    expect(gate.phase("DCFC-01")).toBe("clear");
    expect(vehicleMayMove(gate.phase("DCFC-01")!)).toBe(true);
    // the physical demate is 11.5 s of robot motion; it may not be skipped
    expect(spent).toBeGreaterThan(11);
    expect(spent).toBeLessThan(maxPhysicalDemateS() + 1);
  });

  it("passes through EVERY release phase — it can never jump from charging to clear", () => {
    const gate = new ArmGate();
    stepUntil(gate, () => charging(), () => gate.phase("DCFC-01") === "charging");
    const done = () => charging({ chargingState: false, parked: false });
    const seen: ArmPhase[] = [];
    for (let i = 0; i < 400 && gate.phase("DCFC-01") !== "clear"; i++) {
      gate.step(0.25, [done()]);
      const p = gate.phase("DCFC-01")!;
      if (seen[seen.length - 1] !== p) seen.push(p);
    }
    expect(seen).toEqual(["unlatch", "extract", "retract", "clear"]);
    // and the vehicle was held for all of them except the last
    for (const p of seen.slice(0, -1)) expect(vehicleMayMove(p)).toBe(false);
  });

  it("an L2 stall is COMPLETELY unaffected — no arm, no hold, ever", () => {
    const gate = new ArmGate();
    for (let i = 0; i < 200; i++) gate.step(0.5, [charging({ stallId: "L2-04", stallType: "l2" })]);
    expect(gate.phase("L2-04")).toBeNull();
    expect(gate.mayMove("L2-04")).toBe(true);
  });

  it("is TOTAL and fails to NOT-HELD on absence: unknown stall, no session, junk type", () => {
    const gate = new ArmGate();
    expect(gate.mayMove("DCFC-99")).toBe(true);       // never seen
    expect(gate.mayMove(null)).toBe(true);            // no stall at all
    expect(gate.mayMove(undefined)).toBe(true);
    expect(gate.mayMove("")).toBe(true);
    for (const t of [null, undefined, "", "staging", "wash", "DCFC", "dcfc "]) {
      gate.step(1, [charging({ stallId: `S-${String(t)}`, stallType: t })]);
      expect(gate.mayMove(`S-${String(t)}`)).toBe(true);
    }
    // a stall that stops being reported is forgotten rather than left holding
    stepUntil(gate, () => charging(), () => gate.phase("DCFC-01") === "charging");
    expect(gate.mayMove("DCFC-01")).toBe(false);
    gate.step(1, []);
    expect(gate.mayMove("DCFC-01")).toBe(true);
    expect(gate.phase("DCFC-01")).toBeNull();
  });

  it("OTTO-Q's robotic tether holds on its own, even with no local session history", () => {
    const gate = new ArmGate();
    gate.step(0.5, [charging({ chargingState: false, parked: false, tetherRemainingS: 8 })]);
    expect(gate.mayMove("DCFC-01")).toBe(false);
  });

  it("the hold is BOUNDED — a wedged signal releases the car instead of deadlocking it", () => {
    const gate = new ArmGate();
    // a tether that never expires: the backend keeps republishing it
    const stuck = () => charging({ chargingState: false, parked: false, tetherRemainingS: 5 });
    let t = 0;
    while (t < HOLD_CAP_S - 1) { gate.step(0.5, [stuck()]); t += 0.5; }
    expect(gate.mayMove("DCFC-01")).toBe(false);
    while (t < HOLD_CAP_S + 2) { gate.step(0.5, [stuck()]); t += 0.5; }
    expect(gate.mayMove("DCFC-01")).toBe(true);
    // and the cap really does clear every legitimate demate
    expect(HOLD_CAP_S).toBeGreaterThan(maxPhysicalDemateS());
  });

  it("a clock JUMP is not elapsed time — it cannot fast-forward the gate open", () => {
    const gate = new ArmGate();
    stepUntil(gate, () => charging(), () => gate.phase("DCFC-01") === "charging");
    const done = () => charging({ chargingState: false, parked: false });
    // one enormous step (a scrub, a run change). At most ONE phase transition.
    gate.step(100000, [done()]);
    expect(gate.mayMove("DCFC-01")).toBe(false);
    expect(NOMINAL_SEQUENCE).toContain(gate.phase("DCFC-01")!);
  });

  it("the mate does not start until the car is physically PARKED", () => {
    const gate = new ArmGate();
    // charging on the wire but still taxiing in — no service window published
    for (let i = 0; i < 100; i++) gate.step(0.5, [charging({ parked: false })]);
    expect(gate.phase("DCFC-01")).toBe("stowed");
    expect(gate.mayMove("DCFC-01")).toBe(true);
  });

  it("holding() names the stalls that are refusing, and clear() forgets them", () => {
    const gate = new ArmGate();
    stepUntil(gate, () => charging(), () => gate.phase("DCFC-01") === "charging");
    expect(gate.holding()).toEqual(["DCFC-01"]);
    // the cap's clock reads 0 through the charge — that hold is open-ended by
    // design — and starts running the moment the release does
    expect(gate.heldFor("DCFC-01")).toBe(0);
    gate.step(1, [charging({ chargingState: false, parked: false })]);
    gate.step(1, [charging({ chargingState: false, parked: false })]);
    expect(gate.phase("DCFC-01")).toBe("unlatch");
    expect(gate.heldFor("DCFC-01")).toBeGreaterThan(0);
    gate.clear();
    expect(gate.holding()).toEqual([]);
    expect(gate.mayMove("DCFC-01")).toBe(true);
  });
});

// The arm plays inside the twin's charge, on the sim clock, and the gate's hold cap runs on the same clock. A
// slow frame (a phone, a headless browser drawing a frame a second, a background tab, 8x playback) hands it
// several sim seconds at once, and both evaluations play them in steps of ARM_SUBSTEP_S (playArmSession), so
// the arm keeps the clock and the cap can only fire on a wedged signal, whatever the frame rate.
describe("ArmGate — at any frame rate", () => {
  const CHARGE_END = 600;   // the twin stops calling the car 'charging'
  const TETHER = 11.5;      // OTTO-Q's demate window, counting down from the charge's end

  const factsAt = (t: number) => ({
    chargingState: t < CHARGE_END,
    tetherRemainingS: t >= CHARGE_END && t < CHARGE_END + TETHER ? CHARGE_END + TETHER - t : null,
  });

  interface Run { latchedAt: number; releasedAt: number; phaseAtRelease: string; heldForAtRelease: number }

  /** One charge played at `frame` sim seconds a frame through the gate. */
  function run(frame: number): Run {
    const gate = new ArmGate();
    const r: Run = { latchedAt: Infinity, releasedAt: Infinity, phaseAtRelease: "", heldForAtRelease: 0 };
    for (let t = 0; t <= CHARGE_END + 200 && r.releasedAt === Infinity; t += frame) {
      gate.step(t === 0 ? 0 : frame, [charging(factsAt(t))]);
      const p = gate.phase("DCFC-01")!;
      if (p === "charging" && r.latchedAt === Infinity) r.latchedAt = t;
      if (t > CHARGE_END && gate.mayMove("DCFC-01")) {
        r.releasedAt = t; r.phaseAtRelease = p; r.heldForAtRelease = gate.heldFor("DCFC-01");
      }
    }
    return r;
  }

  /** The gate as it was until 2026-10-21: the reducer called once a frame, the cap counting the frame's clock. */
  function runOneCallAFrame(frame: number): Run {
    let s: ArmSession = IDLE_SESSION;
    let heldFor = 0, prevHeld = false;
    const r: Run = { latchedAt: Infinity, releasedAt: Infinity, phaseAtRelease: "", heldForAtRelease: 0 };
    for (let t = 0; t <= CHARGE_END + 200 && r.releasedAt === Infinity; t += frame) {
      const dt = t === 0 ? 0 : Math.min(frame, 30);
      const f = { ...charging(factsAt(t)) };
      s = advanceArmSession(s, { dt, vehicleId: f.vehicleId, ...armSessionInput(s, f) });
      const held = f.tetherRemainingS !== null || !vehicleMayMove(s.phase);
      const transient = held && s.phase !== "charging";
      heldFor = transient ? (prevHeld ? heldFor + dt : 0) : 0;
      prevHeld = held;
      if (s.phase === "charging" && r.latchedAt === Infinity) r.latchedAt = t;
      if (t > CHARGE_END && (!held || heldFor >= HOLD_CAP_S)) { r.releasedAt = t; r.phaseAtRelease = s.phase; }
    }
    return r;
  }

  // 60 fps at 3x is 0.05 sim-s a frame; a frame a second at 3x is 3 s, at 8x 8 s
  for (const frame of [0.05, 1, 3, 8, 12, 20]) {
    it(`latches on time and lets the car go only once the arm is home, at ${frame} sim-s a frame`, () => {
      const r = run(frame);
      // the reach, to the frame that sees it, less a dropped step at each of its five transitions
      expect(r.latchedAt).toBeLessThanOrEqual(CONNECT_SECONDS + frame + 5 * ARM_SUBSTEP_S);
      expect(isArmHome(r.phaseAtRelease as ArmPhase), `released in '${r.phaseAtRelease}'`).toBe(true);
      expect(r.heldForAtRelease).toBeLessThan(HOLD_CAP_S);           // the arm let it go, not the cap
      expect(r.releasedAt - CHARGE_END).toBeLessThanOrEqual(DISCONNECT_SECONDS + frame + 3 * ARM_SUBSTEP_S);
    });
  }

  it("REPRODUCES what it fixes: called once a frame, the arm fell behind and the cap released the car mid-release", () => {
    // MEASURED 2026-10-21: latched at 33 s at 3 sim-s a frame; at 20 the car released with the connector in 'extract'
    expect(runOneCallAFrame(3).latchedAt).toBeGreaterThan(30);
    const slow = runOneCallAFrame(20);
    expect(isArmHome(slow.phaseAtRelease as ArmPhase)).toBe(false);
    expect(["unlatch", "extract", "retract"]).toContain(slow.phaseAtRelease);
    // and through the gate, the same frames latch on time and release a car only from a home arm
    expect(run(3).latchedAt).toBeLessThanOrEqual(CONNECT_SECONDS + 3);
    expect(isArmHome(run(20).phaseAtRelease as ArmPhase)).toBe(true);
  });

  it("the drawn arm and the gate's arm keep step however differently their frames fall", () => {
    // ChargingArm.tsx plays the renderer's frames and the gate the driver's, both through playArmSession: here
    // a drawn frame every 3 sim-s against a gate step every 0.1. Each phase begins in both within a drawn frame
    // and a dropped step per transition of each other: the drawn frame is seen only at its end, and it reads
    // the stall's facts at its end, so a change of state (the charge over) starts its release up to a frame
    // early. It never trails the gate's arm by more than the dropped steps, because both keep the clock.
    const gate = new ArmGate();
    let drawn: ArmSession = IDLE_SESSION;
    const gateAt = new Map<string, number>(), drawnAt = new Map<string, number>();
    /** Nominal sim seconds into the release: the measure of how far an arm has let go. */
    const released = (phase: ArmPhase, elapsed: number): number => {
      const i = DEMATE_CHAIN.indexOf(phase);
      if (i >= 0) return DEMATE_CHAIN.slice(0, i).reduce((a, q) => a + phaseDuration(q), 0) + elapsed;
      if (phase === "clear") return DISCONNECT_SECONDS + elapsed;
      return phase === "stowed" ? DISCONNECT_SECONDS + CLEAR_SECONDS : 0;
    };
    let worstTrail = 0;
    for (let k = 0; k <= (CHARGE_END + 60) * 10; k++) {
      const t = k / 10;
      gate.step(k === 0 ? 0 : 0.1, [charging(factsAt(t))]);
      const g = gate.phase("DCFC-01")!;
      if (!gateAt.has(g)) gateAt.set(g, t);
      if (k % 30 === 0) {
        drawn = playArmSession(drawn, k === 0 ? 0 : 3, charging(factsAt(t)));
        if (!drawnAt.has(drawn.phase)) drawnAt.set(drawn.phase, t);
        if (t >= CHARGE_END) {
          const gp = released(g, gate.session("DCFC-01")?.phaseElapsed ?? 0);
          worstTrail = Math.max(worstTrail, gp - released(drawn.phase, drawn.phaseElapsed));
        }
      }
    }
    // while letting go, the drawn arm is never further from home than the arm that holds the car, but for the
    // step each evaluation may drop at each of the release's transitions
    expect(worstTrail).toBeLessThanOrEqual(3 * ARM_SUBSTEP_S);
    for (const p of ["unstow", "approach", "align", "insert", "latch", "charging", "unlatch", "extract", "retract", "clear"]) {
      const g = gateAt.get(p), d = drawnAt.get(p);
      expect(g, p).toBeDefined();
      if (d === undefined) continue; // a phase shorter than a frame can begin and end between two drawn frames
      expect(Math.abs(d - g!), p).toBeLessThanOrEqual(3 + 5 * ARM_SUBSTEP_S);
    }
    // every phase that outlasts a drawn frame is drawn, and both end home
    for (const p of ["approach", "align", "charging", "retract"]) expect(drawnAt.has(p), p).toBe(true);
    expect(isArmHome(drawn.phase)).toBe(true);
    expect(gate.mayMove("DCFC-01")).toBe(true);
  });

  it("a jump of the clock plays none of the arm, in either evaluation", () => {
    const latched: ArmSession = { phase: "charging", phaseElapsed: 30, t: 1, vehicleId: "v1" };
    const done = charging({ chargingState: false });
    // the release begins (a state, not a duration), and not one second of it is played
    for (const jump of [31, 100000, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const s = playArmSession(latched, jump, done);
      expect(s.phase, String(jump)).toBe("unlatch");
      expect(s.phaseElapsed, String(jump)).toBe(0);
    }
    const gate = new ArmGate();
    gate.step(0, [charging()]);
    expect(gate.phase("DCFC-01")).toBe("unstow");
    gate.step(31, [charging()]);
    expect(gate.phase("DCFC-01")).toBe("unstow");
  });
});
