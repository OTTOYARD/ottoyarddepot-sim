// The gate plays the program of the car the twin names. One session a stall: the 3D arm, the 2D plan and the
// Robotics tab's follow all draw cleanSessionJoints(session), so the program a session carries is the one all
// three play. A car the twin does not name is cleaned by the generic program, as before.
import { describe, expect, it } from "vitest";
import { CleanGate, portRule, type CleanStallInput } from "./cleanGate";
import { doorOpenAt, doorStore } from "./doorStore";
import { fleetDoorPlanLines } from "@/lib/fleetModels/doorPlan";
import { cleanSessionJoints, cleanSessionProgram, type CleanSession } from "@/lib/ottoCleanArm/cleanSession";
import { cleanJointsAt, sidesFor, GENERIC_PROGRAM } from "@/lib/ottoCleanArm/cleanArmPose";
import { cleanProgramFor } from "@/lib/ottoCleanArm/cleanPrograms";
import { CLEAN_CHAIN, phaseMove, phaseVisit, wandMayBeInside, type CleanPhase } from "@/lib/ottoCleanArm/cleanArmSpec";
import { FLEET_MODEL_KEYS, fleetModelKeyFor } from "@/lib/fleetModels/assign";
import { cabinArmWords } from "@/lib/vehicleQCard";

const base: Omit<CleanStallInput, "active" | "endsInS" | "model"> = {
  stallId: "A-01", stallType: "dcfc", vehicleId: "car-1", toward: -1, mayEnter: true,
};

/** Play one stall's whole step (5.8 min) at 4 frames a sim second; return what the gate showed. */
function play(model: string | null, vehicleId = "car-1") {
  const gate = new CleanGate();
  const TOTAL = 348;
  const seen: CleanPhase[] = [];
  const sessions: CleanSession[] = [];
  let doorsWhileOut = 1, otherFlankOpen = 0, blocksWhileOut = true, heldWhileOut = true;
  for (let t = 0; t < TOTAL + 60; t += 0.25) {
    gate.step(0.25, [{ ...base, vehicleId, model, active: t < TOTAL + 5, endsInS: Math.max(0, TOTAL - t) }]);
    const s = gate.session("A-01")!;
    sessions.push(s);
    if (seen[seen.length - 1] !== s.phase) seen.push(s.phase);
    if (phaseMove(s.phase) !== null || s.phase === "return") {
      // out over or beside the car: no charge arm may start a mate, the car is held
      blocksWhileOut = blocksWhileOut && gate.blocksMate("A-01");
      heldWhileOut = heldWhileOut && !gate.mayMove("A-01");
    }
    const move = phaseMove(s.phase);
    if (move !== null && move !== "swing") {
      // down at an opening: that flank's doors stand fully open and the other flank's are shut. The stall faces -1,
      // so the far flank (worked first) is the car's right and the port flank its left.
      const d = gate.doorsByFlank().find(([id]) => id === vehicleId) ?? [vehicleId, 0, 0];
      const far = cleanSessionProgram(s).visits[phaseVisit(s.phase)].flank === "far";
      doorsWhileOut = Math.min(doorsWhileOut, far ? d[1] : d[2]);
      otherFlankOpen = Math.max(otherFlankOpen, far ? d[2] : d[1]);
    }
    if (s.phase === "home" && seen.length > 1) break;
  }
  return { seen, sessions, doorsWhileOut, otherFlankOpen, blocksWhileOut, heldWhileOut };
}

describe("the cleaning arm's program follows the car in the stall", () => {
  it("plays the generic program for a car the twin does not name", () => {
    const r = play(null);
    expect(r.seen).toEqual([...CLEAN_CHAIN, "home"]);
    expect(r.sessions.every((s) => s.program === undefined && cleanSessionProgram(s) === GENERIC_PROGRAM)).toBe(true);
    expect(play("a_car_with_no_program").seen).toEqual([...CLEAN_CHAIN, "home"]);
  });

  it.each(FLEET_MODEL_KEYS.map((key) => ({ key })))("$key: plays that vehicle's own program, the worked flank's doors open and the car held all the way", ({ key }) => {
    const program = cleanProgramFor(key);
    expect(program.key).toBe(key);
    const r = play(key);
    expect(r.seen).toEqual([...program.chain, "home"]);
    expect(r.doorsWhileOut).toBe(1);
    expect(r.otherFlankOpen).toBe(0);
    expect(r.blocksWhileOut).toBe(true);
    expect(r.heldWhileOut).toBe(true);
    const sides = sidesFor(-1);
    for (const s of r.sessions) {
      if (s.phase === "home") continue;
      // the session names its program, and what every view draws from it is that program's pose
      expect(s.program).toBe(key);
      expect(cleanSessionJoints(s, sides)).toEqual(cleanJointsAt(s.phase, s.t, sides, { from: s.from, program }));
    }
    // every opening's clean got a share of the twin's step, none under the 20 s floor
    const worked = new Map<CleanPhase, number>();
    for (const s of r.sessions) if (phaseMove(s.phase) === "clean") worked.set(s.phase, (worked.get(s.phase) ?? 0) + 0.25);
    expect(worked.size).toBe(program.visits.length);
    for (const [, secs] of worked) expect(secs).toBeGreaterThanOrEqual(20);
    // the wand is in the car only between an enter and an exit
    expect(r.sessions.filter((s) => wandMayBeInside(s.phase)).every((s) => ["enter", "clean", "exit"].includes(phaseMove(s.phase)!))).toBe(true);
  });

  it("keeps the program a cycle started with when the row changes under it, and takes the new one for the next car", () => {
    const gate = new CleanGate();
    const step = (model: string | null, vehicleId: string, active = true) => gate.step(0.25, [{ ...base, vehicleId, model, active, endsInS: 300 }]);
    for (let i = 0; i < 80; i++) step("waymo_ipace", "car-1");
    expect(gate.session("A-01")!.program).toBe("waymo_ipace");
    for (let i = 0; i < 40; i++) step("zoox_robotaxi", "car-1");       // the row's name changes mid-cycle
    expect(gate.session("A-01")!.program).toBe("waymo_ipace");
    for (let i = 0; i < 400 && gate.session("A-01")!.phase !== "home"; i++) step("zoox_robotaxi", "car-1", false);
    expect(gate.session("A-01")!.phase).toBe("home");
    for (let i = 0; i < 8; i++) step("zoox_robotaxi", "car-2");
    expect(gate.session("A-01")!.program).toBe("zoox_robotaxi");
  });

  it("reads the model from the twin's row the way the yard does", () => {
    expect(fleetModelKeyFor({ port: { profile: "lucid_gravity_nuro" } })).toBe("lucid_gravity_nuro");
    expect(fleetModelKeyFor({ make: "Zoox", model: "robotaxi" })).toBe("zoox_robotaxi");
    expect(fleetModelKeyFor({ make: "Acme", model: "Van" })).toBeNull();
  });
});

describe("the car's card says where the arm is, at every opening of its program", () => {
  it("keeps the generic cycle's words", () => {
    expect(cabinArmWords("swing_a", "right", "left").words).toBe("The arm moves to the right side.");
    expect(cabinArmWords("clean_a", "right", "left").words).toBe("The arm cleans the right side.");
    expect(cabinArmWords("raise_a", "right", "left").words).toBe("The arm moves to the left side.");
    expect(cabinArmWords("clean_b", "right", "left").words).toBe("The arm cleans the left side.");
    expect(cabinArmWords("exit_b", "right", "left").words).toBe("The arm moves out of the car.");
    expect(cabinArmWords("raise_b", "right", "left").words).toBe("The arm moves back to its start position.");
    expect(cabinArmWords("swing_a", "right", "left").starting).toBe(true);
    expect(cabinArmWords("swing_b", "right", "left").starting).toBe(false);
  });

  it("says when the charger's side was done in part, and when a stop opens the full door opening", () => {
    expect(cabinArmWords("home", "right", "left", false, ["a", "b"], { portNotDone: true }).words)
      .toBe("The arm did not clean the left side. The charge arm was in the way of the doors.");
    expect(cabinArmWords("home", "right", "left", false, ["a", "a", "b", "b"], { portNotDone: true, portPartDone: true }).words)
      .toBe("The arm did not complete the left side. The charge arm was in the way of a door.");
    const st = { widens: [false, false, true] };
    expect(cabinArmWords("raise_b", "right", "left", false, ["a", "b", "b"], st).words).toBe("The arm moves to the full door opening on the left side.");
    expect(cabinArmWords("clean_c", "right", "left", false, ["a", "b", "b"], st).words).toBe("The arm cleans the left side.");
    expect(cabinArmWords("raise_a", "right", "left", false, ["a", "b", "b"], st).words).toBe("The arm moves to the left side.");
  });

  it("names the side of each of a four-door car's openings", () => {
    const stops = ["a", "a", "b", "b"] as const;
    const w = (p: string) => cabinArmWords(p, "right", "left", false, stops).words;
    expect(w("clean_a")).toBe("The arm cleans the right side.");
    expect(w("exit_a")).toBe("The arm moves to the next door on the right side.");
    expect(w("clean_b")).toBe("The arm cleans the right side.");
    expect(w("raise_b")).toBe("The arm moves to the left side.");
    expect(w("clean_c")).toBe("The arm cleans the left side.");
    expect(w("descend_d")).toBe("The arm moves to the next door on the left side.");
    expect(w("clean_d")).toBe("The arm cleans the left side.");
    expect(w("exit_d")).toBe("The arm moves out of the car.");
    expect(w("ascend_d")).toBe("The arm moves back to its start position.");
  });
});

describe("the charger's flank per opening, from the gate to the door store", () => {
  it("the I-PACE with the connector in: the gate opens the rear left door alone, and the door store carries each door", () => {
    const program = cleanProgramFor("waymo_ipace");
    // each port visit's own rule, as the gate composes it
    const latched = portRule(program, "latched", true), stowed = portRule(program, "stowed", false), moving = portRule(program, "moving", true);
    expect(latched.portOk).toBe(false);
    expect(program.visits.map((v, i) => (v.flank === "port" ? `${v.opening} ${latched.portOkAt[i]}` : null)).filter(Boolean)).toEqual(["rear door true", "front door false"]);
    expect(stowed.portOkAt.every(Boolean)).toBe(true);
    expect(moving.portOkAt.some(Boolean)).toBe(false);
    expect(portRule(program, "stowed", true).portOkAt.slice(2)).toEqual([false, false]);
    // a program whose visits carry no rule of their own takes the flank's at every visit
    expect(portRule(GENERIC_PROGRAM, "latched", true)).toEqual({ portOk: true, portOkAt: [true, true] });

    const gate = new CleanGate();
    let sawRearAlone = false, waited = false;
    for (let t = 0; t < 348 + 60; t += 0.25) {
      gate.step(0.25, [{ ...base, model: "waymo_ipace", active: t < 348, endsInS: Math.max(0, 348 - t), chargeArm: "latched", mateComing: true }]);
      const s = gate.session("A-01")!;
      doorStore.syncFlanks(gate.doorsByDoor());
      const d = doorStore.get("car-1");
      // the front left door (the one at the inlet) is never open, in the session or in the store
      expect(s.doorPortBy?.[0] ?? 0).toBe(0);
      if (d) expect(doorOpenAt(d, -1, 0)).toBe(0);
      if (s.phase === "clean_c") {
        expect(d!.leftEach).toEqual([0, 1]);
        expect(doorOpenAt(d!, -1, 1)).toBe(1);
        expect(d!.left).toBe(1);
        // the far flank's doors have no value of their own: they stand at the flank's
        expect(d!.rightEach).toBeUndefined();
        expect(doorOpenAt(d!, 1, 0)).toBe(d!.right);
        sawRearAlone = true;
      }
      if (gate.waitsForChargeArm("A-01")) {
        waited = true;
        // a wait that begins with a port door still closing keeps the connector in; once it is shut it does not
        expect(gate.holdsConnector("A-01")).toBe(gate.portDoorsOpen("A-01"));
      }
    }
    expect(sawRearAlone).toBe(true);
    expect(waited).toBe(true);
    expect(gate.session("A-01")!.portNotDoneFor).toBe("car-1");
    expect(gate.session("A-01")!.portPartDone).toBe(true);
    doorStore.clear();
  });

  it("the 2D plan draws only the doors that are open", () => {
    expect(fleetDoorPlanLines("waymo_ipace", -1, 1).length).toBe(2);
    const rear = fleetDoorPlanLines("waymo_ipace", -1, 1, [0, 1]);
    expect(rear.length).toBe(1);
    // the rear door: behind the car's middle, on its left
    expect(rear[0].a.x).toBeLessThan(0.2);
    expect(rear[0].a.z).toBeLessThan(0);
    const front = fleetDoorPlanLines("waymo_ipace", -1, 1, [1, 0]);
    expect(front.length).toBe(1);
    expect(Math.max(front[0].a.x, front[0].b.x)).toBeGreaterThan(Math.max(rear[0].a.x, rear[0].b.x));
  });
});
