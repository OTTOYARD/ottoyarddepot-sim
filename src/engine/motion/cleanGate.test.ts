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
import { advanceCleanSession, IDLE_CLEAN, type CleanSession } from "@/lib/ottoCleanArm/cleanSession";
import { sidesFor } from "@/lib/ottoCleanArm/cleanArmPose";

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

// The arm plays inside the twin's step, on the sim clock. A slow frame (a phone, a headless browser drawing a
// frame a second, a background tab coming back, 8x playback) hands the gate several sim seconds at once, and the
// gate plays them in steps of CLEAN_SUBSTEP_S, so both sides are cleaned for the time the twin gave them whatever
// the frame rate. The twin marks the tidy done on its first tick after the step's end, so these runs keep the
// step in progress a minute past it, as the snapshot does.
describe("the cleaning arm keeps the twin's step at any frame rate", () => {
  const STEP = 348;        // 0758's cycle at its defaults: 2 x 2.5 + 0.8 minutes
  const CLOSE = STEP + 60; // the tick that marks the tidy done

  interface Run { finishing: boolean; cleanA: number; cleanB: number; homeAt: number; seen: string[] }

  /** One step played at `frame` sim seconds a frame. `oneCallAFrame` steps the reducer once a frame, as the gate did. */
  function run(frame: number, oneCallAFrame = false): Run {
    const g = new CleanGate();
    let s: CleanSession = IDLE_CLEAN;
    const r: Run = { finishing: false, cleanA: 0, cleanB: 0, homeAt: Infinity, seen: [] };
    let left = false;
    for (let t = 0; t <= CLOSE + 60; t += frame) {
      const active = t < CLOSE;
      const endsInS = active ? STEP - t : null;
      const dt = t === 0 ? 0 : frame;
      if (oneCallAFrame) {
        s = advanceCleanSession(s, { dt, vehicleId: "car-1", active, endsInS, sides: sidesFor(1), mayEnter: true });
      } else {
        g.step(dt, [input({ active, endsInS })]);
        s = g.session("DCFC-01") ?? IDLE_CLEAN;
      }
      if (s.finishing) r.finishing = true;
      if (s.phase === "clean_a") r.cleanA += frame;
      if (s.phase === "clean_b") r.cleanB += frame;
      if (s.phase !== "home") left = true;
      if (left && s.phase === "home" && r.homeAt === Infinity) r.homeAt = t;
      if (r.seen[r.seen.length - 1] !== s.phase) r.seen.push(s.phase);
    }
    return r;
  }

  // 60 fps at 3x is 0.05 sim-s a frame; one frame a second at 3x is 3 s, at 8x 8 s
  const smooth = run(0.05);

  for (const frame of [0.05, 1, 3, 8]) {
    it(`cleans both sides for their time at ${frame} sim-s a frame, and is home as the step ends`, () => {
      const r = run(frame);
      expect(r.finishing, "cut off").toBe(false);
      expect(r.seen).toContain("clean_a");
      expect(r.seen).toContain("clean_b");
      // each side is timed by the frames that end in it: a frame's error at each end
      expect(Math.abs(r.cleanA - smooth.cleanA), `side A at ${frame}`).toBeLessThanOrEqual(2 * frame);
      expect(Math.abs(r.cleanB - smooth.cleanB), `side B at ${frame}`).toBeLessThanOrEqual(2 * frame);
      expect(r.homeAt).toBeLessThanOrEqual(STEP + frame);
    });
  }

  it("REPRODUCES what it fixes: one reducer call a frame shortens side B at 3 sim-s a frame and skips it at 8", () => {
    // the reducer takes at most 2 s a call and drops the rest, so the arm falls behind the twin's step and the
    // pace squeezes side B into what is left (MEASURED 2026-10-21: 96 s of 149 at 3, none at 8)
    const at3 = run(3, true), at8 = run(8, true);
    expect(at3.cleanB).toBeLessThan(0.7 * smooth.cleanB);
    expect(at3.homeAt).toBeGreaterThan(STEP + 3);
    expect(at8.cleanB).toBe(0);
    expect(at8.finishing).toBe(true);
    // and through the gate, the same frames clean side B in full
    expect(run(3).cleanB).toBeGreaterThan(0.95 * smooth.cleanB);
    expect(run(8).cleanB).toBeGreaterThan(0.9 * smooth.cleanB);
  });

  it("holds the car from the doors opening to the doors shut, at a frame a second", () => {
    const g = new CleanGate();
    for (let t = 0; t <= CLOSE + 30; t += 3) {
      const active = t < CLOSE;
      g.step(t === 0 ? 0 : 3, [input({ active, endsInS: active ? STEP - t : null })]);
      const p = g.session("DCFC-01")?.phase ?? "home";
      if (p !== "home") expect(g.mayMove("DCFC-01"), `t ${t} ${p}`).toBe(false);
    }
    expect(g.session("DCFC-01")?.phase).toBe("home");
    expect(g.mayMove("DCFC-01")).toBe(true);
  });

  it("finishes a step the twin ends early from wherever the arm is, home well inside the cap, at a frame a second", () => {
    const g = new CleanGate();
    let releasedAt = Infinity, phaseAtRelease = "";
    for (let t = 0; t <= 300; t += 3) {
      const active = t < 100; // the car re-tasked in the middle of side A
      g.step(t === 0 ? 0 : 3, [input({ active, endsInS: active ? STEP - t : null })]);
      if (t >= 100 && releasedAt === Infinity && g.mayMove("DCFC-01")) {
        releasedAt = t;
        phaseAtRelease = g.session("DCFC-01")?.phase ?? "home";
      }
    }
    expect(phaseAtRelease).toBe("home");                       // the arm, not the cap, let the car go
    expect(releasedAt - 100).toBeLessThan(CLEAN_HOLD_CAP_S / 2);
  });
});
