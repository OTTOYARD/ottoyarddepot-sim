// ============================================================================
// THE 2D PLAN'S ROBOTS AND DOORS ARE THE 3D VIEW'S, SEEN FROM ABOVE.
//
// Each projection in robotPlan.ts is held equal to the 3D rig it stands for, built and posed
// exactly as the 3D components pose it (ChargingArm.tsx, CleanArm.tsx, Vehicle3D.tsx), on every
// fast-charger stall of the site plan, in poses across each robot's whole cycle.
// ============================================================================
import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { armPlanPoints, carToPlan, cleanArmPlanPoints, doorPlanEdge } from "./robotPlan";
import { generateStallsV2 } from "@/lib/sitePlan";
import { placeArm, portInArmFrame } from "@/lib/ottoChargeArm/depotPlacement";
import { STOWED, type JointAngles } from "@/lib/ottoChargeArm/cobotIK";
import { poseFor } from "@/lib/ottoChargeArm/armMotion";
import { portFor } from "@/lib/ottoChargeArm/chargePort";
import { CAR_WIDTH_M, doorSwing } from "@/lib/ottoChargeArm/vehicleEnvelope";
import { PLAN_UNITS_PER_METRE } from "@/lib/ottoChargeArm/cobotSpec";
import { armSkeleton } from "@/components/canvas/three/armInstances";
import { cleanSkeleton } from "@/components/canvas/three/cleanArmInstances";
import { poseCleanArm } from "@/lib/ottoCleanArm/buildCleanArm";
import { placeCleanArm } from "@/lib/ottoCleanArm/cleanArmPlacement";
import { cleanJointsAt } from "@/lib/ottoCleanArm/cleanArmPose";
import { CLEAN_CHAIN } from "@/lib/ottoCleanArm/cleanArmSpec";
import { DECK_Y, toWorld, yawFromHeading2D } from "@/components/canvas/three/coordUtils";
import { DOOR_HINGE_PU } from "@/components/canvas/three/vehicleBody";
import { doorWorld } from "@/components/canvas/three/fleetMath";

const dcfc = generateStallsV2().filter((s) => s.type === "dcfc");
const onPlan = (v: THREE.Vector3) => ({ x: 150 - v.x, y: 110 - v.z });
const near = (a: { x: number; y: number }, b: { x: number; y: number }, what: string) => {
  expect(a.x, `${what} x`).toBeCloseTo(b.x, 6);
  expect(a.y, `${what} y`).toBeCloseTo(b.y, 6);
};

describe("the OTTO-CHARGE ARM on the plan", () => {
  const rig = (() => {
    const root = armSkeleton();
    const by = (n: string) => root.getObjectByName(n)!;
    return { root, j1: by("J1_BaseYaw"), j2: by("J2_Shoulder"), j3: by("J3_Elbow"), j4: by("J4_ForearmRoll"),
      j5: by("J5_WristPitch"), j6: by("J6_ToolRoll"), tcp: by("TCP_ConnectorTip") };
  })();
  const group = new THREE.Group();
  group.add(rig.root);

  /** Pose the 3D rig as ChargingArm.tsx does, at this stall. */
  function pose3d(p: ReturnType<typeof placeArm>, a: JointAngles) {
    group.position.set(...p.world);
    group.rotation.set(0, p.rotationY, 0);
    group.scale.setScalar(p.scale);
    rig.j1.rotation.set(0, a.j1, 0); rig.j2.rotation.set(a.j2, 0, 0); rig.j3.rotation.set(a.j3, 0, 0);
    rig.j4.rotation.set(0, a.j4, 0); rig.j5.rotation.set(a.j5, 0, 0); rig.j6.rotation.set(0, a.j6, 0);
    group.updateWorldMatrix(true, true);
    const at = (o: THREE.Object3D) => onPlan(o.getWorldPosition(new THREE.Vector3()));
    return { base: at(rig.j1), elbow: at(rig.j3), wrist: at(rig.j5), tcp: at(rig.tcp) };
  }

  it("stands where the 3D arm stands, joint by joint, on every fast charger and through its cycle", () => {
    expect(dcfc.length).toBeGreaterThanOrEqual(10);
    for (const s of dcfc) {
      const p = placeArm(s.id, s.position.x, s.position.y, s.position.angle);
      const port = portFor("car-1", "waymo");
      const target = { port: portInArmFrame(port.along, port.height, CAR_WIDTH_M / 2, p.toward), normal: { x: 0, y: 0, z: -1 } };
      const poses: JointAngles[] = [STOWED];
      for (const phase of ["unstow", "approach", "align", "insert", "latch", "charging", "extract", "retract"] as const) {
        for (const t of [0, 0.5, 1]) poses.push(poseFor({ phase, t }, target).angles);
      }
      for (const a of poses) {
        const want = pose3d(p, a), got = armPlanPoints(p, a);
        near(got.base, want.base, `${s.id} base`);
        near(got.elbow, want.elbow, `${s.id} elbow`);
        near(got.wrist, want.wrist, `${s.id} wrist`);
        near(got.tcp, want.tcp, `${s.id} tcp`);
      }
    }
  });

  it("reaches the car's charge port when latched, and folds back over its pedestal when stowed", () => {
    for (const s of dcfc) {
      const p = placeArm(s.id, s.position.x, s.position.y, s.position.angle);
      const port = portFor("car-1", "waymo");
      const target = { port: portInArmFrame(port.along, port.height, CAR_WIDTH_M / 2, p.toward), normal: { x: 0, y: 0, z: -1 } };
      const mated = armPlanPoints(p, poseFor({ phase: "charging", t: 1 }, target).angles);
      // the port is on the car's flank: half a car width from the stall's centre line
      const fromCentre = Math.hypot(mated.tcp.x - s.position.x, mated.tcp.y - s.position.y);
      expect(fromCentre, s.id).toBeGreaterThan(CAR_WIDTH_M / 2 * PLAN_UNITS_PER_METRE * 0.9);
      expect(fromCentre, s.id).toBeLessThan(3 * PLAN_UNITS_PER_METRE);
      const stowed = armPlanPoints(p, STOWED);
      expect(Math.hypot(stowed.tcp.x - stowed.base.x, stowed.tcp.y - stowed.base.y), s.id)
        .toBeLessThan(Math.hypot(mated.tcp.x - mated.base.x, mated.tcp.y - mated.base.y) / 2);
    }
  });
});

describe("the OTTO-CLEAN ARM on the plan", () => {
  const rig = cleanSkeleton();
  const outer = new THREE.Group(), frame = new THREE.Group();
  outer.add(frame);
  frame.add(rig.root);

  it("stands where the 3D arm stands, joint by joint, on every fast charger and through its cycle", () => {
    for (const s of dcfc) {
      const place = placeCleanArm(s.position.x, s.position.y, s.position.angle, DECK_Y);
      outer.position.set(place.world.x, DECK_Y, place.world.z);
      outer.rotation.set(0, place.yaw, 0);
      frame.rotation.set(0, -Math.PI / 2, 0);
      frame.scale.setScalar(PLAN_UNITS_PER_METRE);
      for (const phase of CLEAN_CHAIN) {
        for (const t of [0, 0.5, 1]) {
          const q = cleanJointsAt(phase, t, place.sides);
          poseCleanArm(rig.nodes, q);
          outer.updateWorldMatrix(true, true);
          const at = (o: THREE.Object3D) => onPlan(o.getWorldPosition(new THREE.Vector3()));
          const got = cleanArmPlanPoints(s.position.x, s.position.y, s.position.angle, q);
          near(got.j1, at(rig.nodes.CA_J1), `${s.id} ${phase} j1`);
          near(got.pivot, at(rig.nodes.CA_Pitch), `${s.id} ${phase} pivot`);
          near(got.knuckle, at(rig.nodes.CA_Nozzle), `${s.id} ${phase} knuckle`);
        }
      }
    }
  });

  it("puts the car's frame where the 3D car body puts it", () => {
    for (const h of [0, 0.7, Math.PI / 2, 2.4, Math.PI, -1.1]) {
      const [wx, , wz] = toWorld({ x: 100, y: 60 });
      const g = new THREE.Group(), f = new THREE.Group();
      g.position.set(wx, 0, wz); g.rotation.set(0, yawFromHeading2D(h), 0);
      f.rotation.set(0, -Math.PI / 2, 0); f.scale.setScalar(PLAN_UNITS_PER_METRE);
      g.add(f); g.updateWorldMatrix(true, true);
      for (const v of [{ x: 1, z: 0 }, { x: 0, z: 1 }, { x: -1.3, z: 0.8 }]) {
        const w = f.localToWorld(new THREE.Vector3(v.x, 0, v.z));
        near(carToPlan(100, 60, h, v), onPlan(w), `heading ${h}`);
      }
    }
  });
});

describe("the doors on the plan", () => {
  it("swing where Vehicle3D swings them, about the same hinge, on both flanks", () => {
    for (const h of [0, 0.9, Math.PI / 2, -2.2]) {
      const [wx, , wz] = toWorld({ x: 120, y: 80 });
      const yaw = yawFromHeading2D(h);
      for (const side of [1, -1] as const) {
        for (const f of [0, 0.4, 1]) {
          const hinge = side === 1 ? DOOR_HINGE_PU.right : DOOR_HINGE_PU.left;
          const dw = doorWorld(wx, wz, yaw, hinge.x, hinge.z, doorSwing(side, f), { x: 0, z: 0, yaw: 0 });
          // the shut door's rear edge, in the car model's frame (plan units): car (x, z) -> (-z, x)
          const rear = { x: -side * (CAR_WIDTH_M / 2 + 0.025) * PLAN_UNITS_PER_METRE, z: -0.3 * PLAN_UNITS_PER_METRE };
          const c = Math.cos(dw.yaw), s = Math.sin(dw.yaw);
          const want = onPlan(new THREE.Vector3(dw.x + rear.x * c + rear.z * s, 0, dw.z - rear.x * s + rear.z * c));
          const wantHinge = onPlan(new THREE.Vector3(
            wx + hinge.x * Math.cos(yaw) + hinge.z * Math.sin(yaw), 0, wz - hinge.x * Math.sin(yaw) + hinge.z * Math.cos(yaw)));
          const got = doorPlanEdge(120, 80, h, side, f);
          near(got.edge, want, `edge h ${h} side ${side} open ${f}`);
          near(got.hinge, wantHinge, `hinge h ${h} side ${side}`);
        }
      }
    }
  });

  it("opens outward, away from the car, by the door's opening angle", () => {
    const shut = doorPlanEdge(0, 0, 0, 1, 0), open = doorPlanEdge(0, 0, 0, 1, 1);
    // heading 0: the car points plan east, its right flank faces south (+y)
    expect(open.edge.y).toBeGreaterThan(shut.edge.y + 1);
    const a = Math.atan2(open.edge.y - open.hinge.y, open.edge.x - open.hinge.x);
    const b = Math.atan2(shut.edge.y - shut.hinge.y, shut.edge.x - shut.hinge.x);
    expect(Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) * 180 / Math.PI).toBeCloseTo(78, 6);
  });
});
