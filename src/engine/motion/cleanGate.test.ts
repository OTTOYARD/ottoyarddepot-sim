/**
 * The OTTO-CLEAN ARM's gate, and its interlock with the OTTO-CHARGE ARM. One session
 * per fast-charger stall; it reads the twin's step off the snapshot, holds its car
 * while the arm is out or the doors are open, bounds that hold once the step is over,
 * finishes on screen when its car vanishes, and never lets the two robots move beside
 * the car at the same time.
 */
import { describe, it, expect } from "vitest";
import { CleanGate, cabinCleanOf, CLEAN_HOLD_CAP_S, type CleanStallInput } from "./cleanGate";
import { armSessionInput, IDLE_SESSION, type ArmSession } from "@/lib/ottoChargeArm/roboticService";
import { CLEAN_CHAIN } from "@/lib/ottoCleanArm/cleanArmSpec";

const T0 = Date.parse("2026-10-19T14:00:00.000Z");
const map = (id: string) => ({ "twin-dcfc-01": "DCFC-01", "twin-dcfc-02": "DCFC-02" } as Record<string, string>)[id];

const atom = (over: Record<string, unknown> = {}) => ({
  svc: "interior_tidy", status: "in_progress", must_do: true, est_min: 5,
  started_at: new Date(T0).toISOString(), ends_at: new Date(T0 + 348_000).toISOString(), done_at: null,
  robot_stall_id: "twin-dcfc-01", ...over,
});
const vehicle = (atoms: unknown[], stall: string | null = "twin-dcfc-01") => ({
  stall_id: stall,
  visit: { visit_id: "v1", visit_status: "in_progress", archetype: null, urgency: null, arrived_at: null,
    target_soc: 100, soc_at_arrival: 40, est_charge_min: 25, atoms } as never,
});

describe("reading the twin's step off the snapshot", () => {
  it("finds the interior tidy the stall's arm is doing, with its times and stall", () => {
    const c = cabinCleanOf(vehicle([{ svc: "charge", status: "in_progress" }, atom()]), map);
    expect(c).toEqual({ stall: "DCFC-01", placedHere: true, startMs: T0, endsMs: T0 + 348_000 });
  });

  it("does not play a technician's tidy, a tidy not yet started or done, or one on an unknown stall", () => {
    expect(cabinCleanOf(vehicle([atom({ robot_stall_id: null })]), map)).toBeNull();
    expect(cabinCleanOf(vehicle([atom({ status: "pending" })]), map)).toBeNull();
    expect(cabinCleanOf(vehicle([atom({ status: "done", done_at: new Date(T0 + 348_000).toISOString() })]), map)).toBeNull();
    expect(cabinCleanOf(vehicle([atom({ robot_stall_id: "twin-unknown" })]), map)).toBeNull();
    expect(cabinCleanOf(vehicle([]), map)).toBeNull();
    expect(cabinCleanOf({ stall_id: "twin-dcfc-01", visit: null }, map)).toBeNull();
    expect(cabinCleanOf({ stall_id: "twin-dcfc-01" }, map)).toBeNull();
  });

  it("says when the twin no longer places the car on the arm's stall", () => {
    expect(cabinCleanOf(vehicle([atom()], "twin-dcfc-02"), map)?.placedHere).toBe(false);
    expect(cabinCleanOf(vehicle([atom()], null), map)?.placedHere).toBe(false);
  });

  it("reads a missing or malformed time as absent, not as zero", () => {
    const c = cabinCleanOf(vehicle([atom({ ends_at: "not a time", started_at: 7 })]), map);
    expect(c?.endsMs).toBeNull();
    expect(c?.startMs).toBeNull();
  });
});

const input = (over: Partial<CleanStallInput> = {}): CleanStallInput => ({
  stallId: "DCFC-01", stallType: "dcfc", vehicleId: "car-1", active: true, endsInS: 348,
  toward: 1, mayEnter: true, ...over,
});

/** Step a gate through `seconds` of sim time at `dt`, with inputs per sim second. */
function play(g: CleanGate, seconds: number, dt: number, at: (t: number) => Partial<CleanStallInput> | null) {
  const seen: string[] = [];
  for (let t = 0; t < seconds; t += dt) {
    const i = at(t);
    g.step(dt, i ? [input(i)] : []);
    const p = g.session("DCFC-01")?.phase ?? "none";
    if (seen[seen.length - 1] !== p) seen.push(p);
  }
  return seen;
}

describe("the hold on the car", () => {
  it("holds the car from the first door movement to the doors shut, then lets it go", () => {
    const g = new CleanGate();
    expect(g.mayMove("DCFC-01")).toBe(true);
    g.step(0.05, [input()]);
    expect(g.session("DCFC-01")?.phase).toBe("doors_open");
    expect(g.mayMove("DCFC-01")).toBe(false);
    expect(g.busy("DCFC-01")).toBe(true);
    expect(g.blocksMate("DCFC-01")).toBe(false);   // only the doors are moving
    const seen = play(g, 360, 0.05, (t) => ({ endsInS: 348 - t }));
    expect(seen).toEqual([...CLEAN_CHAIN, "home"]);
    expect(g.session("DCFC-01")?.phase).toBe("home");
    expect(g.mayMove("DCFC-01")).toBe(true);
    expect(g.busy("DCFC-01")).toBe(false);
  });

  it("is open-ended while the twin's step is on, and bounded once it is over", () => {
    const g = new CleanGate();
    play(g, 60, 0.05, () => ({ endsInS: null }));
    // a minute in, mid-clean, still held: the step is on, so no clock runs on the hold
    expect(g.session("DCFC-01")?.phase).toBe("clean_a");
    expect(g.mayMove("DCFC-01")).toBe(false);
    expect(g.heldFor("DCFC-01")).toBe(0);
    // the step ends: the arm comes out at ABORT_SPEED and is home well inside the cap
    let t = 0;
    while (g.session("DCFC-01")?.phase !== "home" && t < 60) { g.step(0.05, [input({ active: false })]); t += 0.05; }
    expect(g.session("DCFC-01")?.phase).toBe("home");
    expect(t).toBeLessThan(CLEAN_HOLD_CAP_S / 3);
    expect(g.mayMove("DCFC-01")).toBe(true);
  });

  it("counts a finishing hold on its own clock, and lists the stall while it holds", () => {
    const g = new CleanGate();
    play(g, 30, 0.05, () => ({ endsInS: null }));
    g.step(0.05, [input({ active: false })]);
    expect(g.session("DCFC-01")?.finishing).toBe(true);
    expect(g.mayMove("DCFC-01")).toBe(false);
    expect(g.holding()).toEqual(["DCFC-01"]);
    g.step(0.5, [input({ active: false })]);
    expect(g.heldFor("DCFC-01")).toBeCloseTo(0.55, 9); // from the first finishing step
  });

  it("holds nothing on a stall with no arm, and nothing it has never seen", () => {
    const g = new CleanGate();
    g.step(0.05, [input({ stallId: "L2-01", stallType: "l2" })]);
    expect(g.session("L2-01")).toBeNull();
    expect(g.mayMove("L2-01")).toBe(true);
    expect(g.mayMove("NOPE")).toBe(true);
    expect(g.mayMove(null)).toBe(true);
  });
});

describe("the doors", () => {
  it("opens both doors of the car it is cleaning, and only that car's", () => {
    const g = new CleanGate();
    play(g, 4, 0.05, () => ({}));
    expect(g.doors()).toEqual([["car-1", 1]]);
  });

  it("shuts them as it finishes, and publishes nothing once home", () => {
    const g = new CleanGate();
    play(g, 60, 0.05, () => ({ endsInS: null }));
    play(g, 30, 0.05, () => ({ active: false }));
    expect(g.doors()).toEqual([]);
  });
});

describe("a car that vanishes mid-clean", () => {
  it("finishes the arm on screen instead of snapping it home, then forgets the stall", () => {
    const g = new CleanGate();
    play(g, 60, 0.05, () => ({ endsInS: null }));
    expect(g.session("DCFC-01")?.phase).toBe("clean_a");
    const seen = play(g, 30, 0.05, () => null); // the stall drops out of the inputs
    expect(seen.slice(0, 2)).toEqual(["exit_a", "ascend_a"]);
    expect(seen).toContain("doors_close");
    expect(g.session("DCFC-01")).toBeNull();
  });
});

describe("the two robots never move beside the car at the same time", () => {
  const latched: ArmSession = { phase: "charging", phaseElapsed: 30, t: 1, vehicleId: "car-1" };
  const facts = { vehicleId: "car-1", chargingState: true, parked: true, tetherRemainingS: null };

  it("the cleaning arm waits with the doors open while the charge arm reaches for the port", () => {
    const g = new CleanGate();
    play(g, 15, 0.05, () => ({ mayEnter: false }));
    expect(g.session("DCFC-01")?.phase).toBe("doors_open");
    expect(g.doors()).toEqual([["car-1", 1]]);
    play(g, 1, 0.05, () => ({ mayEnter: true }));
    expect(g.session("DCFC-01")?.phase).toBe("swing_a");
  });

  it("a charge arm at home does not start a mate while the cleaning arm is out over the car", () => {
    expect(armSessionInput(IDLE_SESSION, { ...facts, cleanBlocksMate: true }).charging).toBe(false);
    expect(armSessionInput(IDLE_SESSION, { ...facts, cleanBlocksMate: false }).charging).toBe(true);
    // a mate already under way is not interrupted by it
    const reaching: ArmSession = { phase: "approach", phaseElapsed: 1, t: 0.2, vehicleId: "car-1" };
    expect(armSessionInput(reaching, { ...facts, cleanBlocksMate: true }).charging).toBe(true);
  });

  it("a latched connector stays in while the cleaning arm is not home, whatever the charge or the tether says", () => {
    const over = { ...facts, chargingState: false, tetherRemainingS: 11.5 };
    expect(armSessionInput(latched, { ...over, cleanBusy: true })).toEqual({ charging: true, tetherRemainingS: null });
    // and lets go the moment the cleaning arm is home
    expect(armSessionInput(latched, { ...over, cleanBusy: false })).toEqual({ charging: false, tetherRemainingS: 11.5 });
  });

  it("the hold is for the car the connector is in, not for a different car", () => {
    expect(armSessionInput(latched, { ...facts, vehicleId: "car-2", chargingState: false, cleanBusy: true }).charging).toBe(false);
    expect(armSessionInput(latched, { ...facts, vehicleId: null, chargingState: false, cleanBusy: true }).charging).toBe(false);
  });

  it("changes nothing when there is no cleaning arm signal", () => {
    expect(armSessionInput(latched, facts)).toEqual({ charging: true, tetherRemainingS: null });
    expect(armSessionInput(latched, { ...facts, chargingState: false })).toEqual({ charging: false, tetherRemainingS: null });
    expect(armSessionInput(IDLE_SESSION, { ...facts, parked: false }).charging).toBe(false);
  });
});
