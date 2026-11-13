// THE TWO ROBOTS AND THE DOORS BETWEEN THEM, frame by frame, on each fleet vehicle.
//
// Every charger stands on the car's LEFT (the port flank). An open left door leaf is where the charge arm stands or
// passes, so the port flank's doors open only while the charge arm is STILL in a place measured clear of them for
// that vehicle (CleanProgram.beside), and the charge arm starts no mate and no release while one is not shut. This
// drives the two gates together exactly as the motion driver does (armGate.step, then cleanGate.step, each reading
// the other through cleanGate.factsForChargeArm and cleanGate.chargeArmFacts) and holds, IN EVERY FRAME:
//   - no port-flank door is open unless the charge arm is still in a state the vehicle's program allows;
//   - the charge arm's base, head and joints do not move while a port-flank door is open;
//   - the charge arm, where the gate has it, keeps 0.10 m from every door leaf, where the session has the doors;
// and at the end: both arms home, every door shut, in bounded time.
import { describe, expect, it } from "vitest";
import { ArmGate } from "./armGate";
import { CleanGate, chargeArmFacts, portAllowed } from "./cleanGate";
import { FLEET_SPECS } from "@/lib/fleetModels/fleet";
import { cabinProfile } from "@/lib/fleetModels/cabin";
import { mateTarget } from "@/lib/fleetModels/ports";
import type { VehicleSpec } from "@/lib/fleetModels/spec";
import { capsulesMin, chargeArmCapsules, slideOfCarX, CHARGE_LEAF_MARGIN_M } from "@/lib/ottoCleanArm/chargeArmBeside";
import { cleanProgramFor } from "@/lib/ottoCleanArm/cleanPrograms";
import { cleanDoors, cleanSessionProgram } from "@/lib/ottoCleanArm/cleanSession";
import { sidesFor } from "@/lib/ottoCleanArm/cleanArmPose";
import { phaseMove, phaseVisit, type CleanPhase } from "@/lib/ottoCleanArm/cleanArmSpec";
import { chargeArmState } from "@/lib/ottoChargeArm/mateSequence";
import type { TwinPort } from "@/lib/ottoChargeArm/vehiclePort";

const STALL = "A-01", CAR = "car-1", TOWARD = -1 as const, DT = 0.25;
const SIDES = sidesFor(TOWARD); // far flank = the car's right, port flank = its left

/** The twin's port object for a fleet vehicle (otto-q-core 0824), from its spec. */
function twinPort(spec: VehicleSpec): TwinPort {
  const t = mateTarget(spec)!;
  return {
    profile: spec.key, face: t.face, along_m: t.alongM, height_m: t.heightM, lateral_m: t.lateralM ?? 0, connector: t.connector,
    either_side: !!t.presentsEitherSide, assumed: !!spec.chargePort?.assumed, length_m: t.lengthM, width_m: t.widthM,
  };
}

interface World { charging: boolean; faulted: boolean; cleanActive: boolean; cleanEndsInS: number | null; tether: number | null }
interface Result {
  cleanSeen: CleanPhase[]; visitsCleaned: number; portNotDone: boolean; homeAt: number; worstLeaf: number; worstAt: string;
  portOpenS: number; waitedS: number; latchedWhilePortOpen: boolean; stowedWhilePortOpen: boolean;
}

/** Play one stall for `seconds`, the world given per frame. Throws (expect) on any frame that breaks an interlock. */
/** One turn of the event loop, on the real timer: a play is minutes of sim time, and on a slow machine a play that
 *  never yields keeps the test runner's worker from answering it (CI, 2026-11-13: 133 s in one test). */
const realImmediate = globalThis.setImmediate;
const breathe = () => new Promise<void>((r) => { realImmediate(r); });

async function play(spec: VehicleSpec | null, seconds: number, world: (t: number) => World): Promise<Result> {
  const arm = new ArmGate(), clean = new CleanGate();
  const model = spec?.key ?? null;
  const program = cleanProgramFor(model);
  const cabin = spec ? cabinProfile(spec) : null;
  const port = spec ? twinPort(spec) : null;
  const parkSlideM = program.beside.parkX === undefined ? 0 : slideOfCarX(program.beside.parkX, TOWARD);
  const r: Result = {
    cleanSeen: [], visitsCleaned: 0, portNotDone: false, homeAt: Infinity, worstLeaf: Infinity, worstAt: "",
    portOpenS: 0, waitedS: 0, latchedWhilePortOpen: false, stowedWhilePortOpen: false,
  };
  let before: string | null = null;
  let everBusy = false;
  let sinceBreath = 0;
  for (let t = 0; t < seconds; t += DT) {
    if (++sinceBreath >= 200) { sinceBreath = 0; await breathe(); }
    const w = world(t);
    // the motion driver's order: the charge arms, reading the cleaning arm as of the last step; then the cleaning arms
    arm.step(DT, [{
      stallId: STALL, stallType: "dcfc", vehicleId: CAR, chargingState: w.charging, parked: true, tetherRemainingS: w.tether,
      ...clean.factsForChargeArm(STALL), chargerFaulted: w.faulted, port, toward: TOWARD, parkSlideM,
    }]);
    clean.step(DT, [{
      stallId: STALL, stallType: "dcfc", vehicleId: CAR, active: w.cleanActive, endsInS: w.cleanEndsInS, toward: TOWARD, model,
      ...chargeArmFacts(arm.armState(STALL), { charging: w.charging, parked: true, chargerFaulted: w.faulted }),
    }]);
    const s = clean.session(STALL)!;
    const m = arm.machineAt(STALL)!;
    const phase = arm.phase(STALL)!;
    if (r.cleanSeen[r.cleanSeen.length - 1] !== s.phase) r.cleanSeen.push(s.phase);
    if (s.phase !== "home") everBusy = true;
    r.visitsCleaned = Math.max(r.visitsCleaned, s.visitsDone ?? 0);
    if (s.waiting) r.waitedS += DT;
    const doors = cleanDoors(s, SIDES);
    const portOpen = doors.left > 0;
    const at = `t ${t.toFixed(2)} clean ${s.phase} arm ${phase}`;

    // 1. a port-flank door is open only with the charge arm still in a state this vehicle's program allows
    const now = chargeArmState(m.seq, phase, m.mate, parkSlideM);
    if (portOpen) {
      r.portOpenS += DT;
      expect(now, `${at}: a port door is open and the charge arm is ${now}`).not.toBe("moving");
      expect(now === "latched" ? program.beside.latched : program.beside.stowed, `${at}: port door open with the charge arm ${now}`).toBe(true);
      if (now === "latched") r.latchedWhilePortOpen = true; else r.stowedWhilePortOpen = true;
    }
    // 2. the charge arm's base, head and joints do not move while a port-flank door is open
    const pose = JSON.stringify([m.seq.slide, m.seq.cross, m.seq.ccs, m.seq.nacs, m.seq.stop, Object.values(m.seq.shown).map((v) => +v.toFixed(6))]);
    if (portOpen && before !== null) expect(pose, `${at}: the charge arm moved with a port door open`).toBe(before);
    before = portOpen ? pose : null;
    // 3. the charge arm as the gate has it, against every door leaf as the session has the doors
    if (cabin && (doors.left > 0 || doors.right > 0)) {
      const head = m.mate?.mate.head ?? null;
      const caps = chargeArmCapsules(m.seq.shown, TOWARD, m.seq.slide, m.seq.cross, head, head === "CCS1" ? m.seq.ccs : m.seq.nacs);
      const d = capsulesMin(caps, (p) => cabin.leafClearanceAt(p, doors.right, doors.left), 12);
      if (d < r.worstLeaf) { r.worstLeaf = d; r.worstAt = at; }
    }
    // 4. the wand is down at an opening only with that flank's doors fully open
    const move = phaseMove(s.phase);
    if (move === "descend" || move === "enter" || move === "clean" || move === "exit" || move === "ascend") {
      const far = cleanSessionProgram(s).visits[phaseVisit(s.phase)].flank === "far";
      expect(far ? doors.right : doors.left, `${at}: the arm is down at a flank whose doors are not open`).toBe(1);
    }
    // 5. the port flank's rule, as the gate composes it, is the program's
    if (s.phase !== "home") expect(typeof portAllowed(program.beside, arm.armState(STALL), w.charging && !w.faulted)).toBe("boolean");
    if (everBusy && s.phase === "home" && !clean.busy(STALL) && r.homeAt === Infinity && !w.cleanActive) {
      r.homeAt = t;
      r.portNotDone = s.portNotDoneFor === CAR;
    }
  }
  // the end: both arms home, every door shut
  const s = clean.session(STALL)!;
  expect(s.phase, "the cleaning arm ends home").toBe("home");
  expect(clean.doorsByFlank()).toEqual([]);
  expect(["stowed", "clear"]).toContain(arm.phase(STALL));
  expect(arm.armState(STALL), "the charge arm ends stowed at its home").toBe("stowed");
  expect(arm.machineAt(STALL)!.seq.slide).toBeCloseTo(parkSlideM, 3);
  if (cabin) expect(r.worstLeaf, `charge arm to a door leaf ${r.worstLeaf.toFixed(3)} m at ${r.worstAt}`).toBeGreaterThanOrEqual(CHARGE_LEAF_MARGIN_M);
  return r;
}

const STEP = 348; // the twin's cabin-clean step, 5.8 min
const cleanWorld = (t: number, from = 0): Pick<World, "cleanActive" | "cleanEndsInS"> =>
  ({ cleanActive: t >= from && t < from + STEP + 2, cleanEndsInS: Math.max(0, from + STEP - t) });

describe.each(FLEET_SPECS.map((spec) => ({ key: spec.key, spec })))("$key: the cleaning arm, the charge arm and the doors", { timeout: 300_000 }, ({ spec }) => {
  const program = cleanProgramFor(spec.key);
  const farVisits = program.visits.filter((v) => v.flank === "far").length;
  const { latched, stowed } = program.beside;

  it("a clean and a charge due together: the far flank during the charge, the port flank only where it is measured clear", async () => {
    // the charge outlasts the twin's clean step by ten minutes
    const r = await play(spec, STEP + 720, (t) => ({ charging: t < STEP + 600, faulted: false, tether: null, ...cleanWorld(t) }));
    expect(r.visitsCleaned).toBeGreaterThanOrEqual(farVisits);
    if (latched) {
      // the whole clean runs during the charge, the connector in
      expect(r.visitsCleaned).toBe(program.visits.length);
      expect(r.portNotDone).toBe(false);
      expect(r.latchedWhilePortOpen).toBe(true);
      expect(r.cleanSeen).toEqual([...program.chain, "home"]);
    } else {
      // the port flank waits for the charge arm to be stowed; the step ended first, and the session says so
      expect(r.visitsCleaned).toBe(farVisits);
      expect(r.portNotDone).toBe(true);
      expect(r.portOpenS).toBe(0);
      expect(r.waitedS).toBeGreaterThan(60);
    }
    expect(r.homeAt).toBeLessThan(STEP + 30);
    console.log(`INTERLOCK ${spec.key} clean + charge: ${r.visitsCleaned} of ${program.visits.length} openings cleaned${r.portNotDone ? ", port flank NOT done" : ""}; waited ${r.waitedS.toFixed(0)} s; charge arm to a door leaf ${r.worstLeaf.toFixed(3)} m (${r.worstAt})`);
  });

  it("a cabin stop with no charge: both flanks, the charge arm stowed at its home", async () => {
    const r = await play(spec, STEP + 60, (t) => ({ charging: false, faulted: false, tether: null, ...cleanWorld(t) }));
    expect(stowed).toBe(true);
    expect(r.visitsCleaned).toBe(program.visits.length);
    expect(r.portNotDone).toBe(false);
    expect(r.stowedWhilePortOpen).toBe(true);
    expect(r.latchedWhilePortOpen).toBe(false);
    expect(r.homeAt).toBeLessThan(STEP + 30);
    console.log(`INTERLOCK ${spec.key} cabin stop: ${r.visitsCleaned} of ${program.visits.length} openings cleaned; charge arm (stowed${program.beside.parkX === undefined ? "" : `, parked at ${program.beside.parkX} m`}) to a door leaf ${r.worstLeaf.toFixed(3)} m (${r.worstAt})`);
  });

  it("a charge that ends in the middle of the clean: no release with a port door open, and no deadlock", async () => {
    // the charge ends at 120 s with an 18 s demate allowed by the twin
    const r = await play(spec, STEP + 120, (t) => ({ charging: t < 120, faulted: false, tether: t >= 120 && t < 138 ? 138 - t : null, ...cleanWorld(t) }));
    expect(r.visitsCleaned).toBeGreaterThanOrEqual(farVisits);
    // where the port flank may be worked latched the connector stays in to the end; elsewhere the arm waits, the
    // connector comes out, and the port flank is worked with the charge arm stowed in what is left of the step
    expect(r.visitsCleaned).toBe(program.visits.length);
    expect(r.portNotDone).toBe(false);
    expect(r.homeAt).toBeLessThan(STEP + 30);
    console.log(`INTERLOCK ${spec.key} charge ends mid-clean: ${r.visitsCleaned} of ${program.visits.length} openings cleaned; waited ${r.waitedS.toFixed(0)} s; charge arm to a door leaf ${r.worstLeaf.toFixed(3)} m (${r.worstAt})`);
  });

  it("a charger fault in the middle of the clean: the port doors shut before the connector comes out", async () => {
    // late enough that a vehicle cleaned latched is at its port flank
    for (const faultAt of [100, 230]) {
      const r = await play(spec, STEP + 120, (t) => ({ charging: true, faulted: t >= faultAt, tether: null, ...cleanWorld(t) }));
      expect(r.visitsCleaned).toBeGreaterThanOrEqual(farVisits);
      expect(r.homeAt).toBeLessThan(STEP + 30);
      console.log(`INTERLOCK ${spec.key} fault at ${faultAt} s: ${r.visitsCleaned} of ${program.visits.length} openings cleaned${r.portNotDone ? ", port flank not finished" : ""}; charge arm to a door leaf ${r.worstLeaf.toFixed(3)} m (${r.worstAt})`);
    }
  });
});

describe("the generic car: the same order, and nothing waits", () => {
  it("cleans both flanks during the charge, the far flank's doors first and the port flank's as the arm swings to it", async () => {
    const r = await play(null, STEP + 720, (t) => ({ charging: t < STEP + 600, faulted: false, tether: null, ...cleanWorld(t) }));
    expect(r.visitsCleaned).toBe(2);
    expect(r.portNotDone).toBe(false);
    expect(r.waitedS).toBe(0);
    expect(r.latchedWhilePortOpen).toBe(true);
  });
  it("cleans both flanks on a cabin stop, and after a charge that ends mid-clean, and through a fault", async () => {
    expect((await play(null, STEP + 60, (t) => ({ charging: false, faulted: false, tether: null, ...cleanWorld(t) }))).visitsCleaned).toBe(2);
    expect((await play(null, STEP + 120, (t) => ({ charging: t < 120, faulted: false, tether: null, ...cleanWorld(t) }))).visitsCleaned).toBe(2);
    const f = await play(null, STEP + 120, (t) => ({ charging: true, faulted: t >= 230, tether: null, ...cleanWorld(t) }));
    expect(f.homeAt).toBeLessThan(STEP + 30);
  });
});
