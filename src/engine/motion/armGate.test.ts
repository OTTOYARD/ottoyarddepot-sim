import { describe, it, expect } from "vitest";
import { ArmGate, HOLD_CAP_S, maxPhysicalDemateS, type ArmStallInput } from "./armGate";
import { NOMINAL_SEQUENCE, vehicleMayMove, type ArmPhase } from "@/lib/ottoChargeArm/armStateMachine";

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
