// ============================================================================
// THE ARM MUST NOT PASS THROUGH ITS OWN CABINET.
//
// Reported by the founder: the arm "partially disappears within the cabinets",
// because it does not know where the physical cabinet is. That is exactly what
// the code says. Before cabinetEnvelope.ts, the word "cabinet" appeared in the
// arm package ONLY in prose comments — armClearance.ts imported one solid,
// CarSolid, and measured clearanceToCar. Nothing compared the robot to the
// cabinet it is bolted to, so no test could fail when a link swept through it.
//
// vehicleEnvelope.ts was written after the identical mistake against the CAR:
// "26 arm tests passed, and every one of those tests asked the arm about a
// plane or a point." This is the same hole, one object over.
//
// The measurement below is deliberately of the MOVING LINKS only. The plinth
// and the J1 base housing are BOLTED to the cabinet — they are supposed to be
// touching it, and including them would drown the signal in an intersection
// that is correct by construction.
// ============================================================================
import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { buildCobot } from "./buildCobot";
import { OTTO_CHARGE_ARM, MOUNT_HEIGHT_M, SERVICE_WINDOW, PEDESTAL_TO_CAR_CENTRE_M } from "./cobotSpec";
import { solveIK, STOWED, type JointAngles } from "./cobotIK";
import { clearanceToCar } from "./vehicleEnvelope";
import {
  cabinetSolidInArmFrame, cabinetIntrusionTowardCar, DCFC_CABINET_PU,
  mountSolidInArmFrame, MOUNT_PLATE_UNDERSIDE_M, ARM_MOUNT_PU, CABINET_BACKSET_PU,
} from "./cabinetEnvelope";
import type { CarSolid } from "./vehicleEnvelope";

const CABINET = cabinetSolidInArmFrame();

/**
 * Parts that are bolted to the cabinet on purpose, and are therefore excluded.
 *
 * Matched EXACTLY, against the node's own name and its ancestors' — not as a
 * loose substring. A first attempt used /…|base/i and silently excluded the
 * entire arm, because the yaw joint is called `J1_BaseYaw` and every moving
 * link is one of its descendants. The measurement came back `Infinity`, which
 * is the only reason it was caught: a permissive filter here does not report a
 * bad number, it reports no number at all while looking like a pass.
 *
 * What is left in: UpperArm, Elbow, Forearm, Wrist and the end effector — the
 * links that actually swing, and the only ones whose intersection with the
 * cabinet is a defect rather than the mount doing its job.
 */
const MOUNTED_NODES = new Set(["Mount_Plinth", "Base_Housing", "Base_Band", "Shoulder_Yoke"]);

interface Probe { pose(a: JointAngles): void; worstClearance(solid?: CarSolid): { min: number; part: string }; }

function makeProbe(): Probe {
  const rig = buildCobot(OTTO_CHARGE_ARM, { withPlinth: true, lod: "studio" });
  const scene = new THREE.Scene();
  scene.add(rig.root);
  scene.updateMatrixWorld(true);

  // Collect the MOVING meshes and their vertices once.
  const parts: { name: string; mesh: THREE.Mesh; verts: Float32Array }[] = [];
  rig.root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.geometry) return;
    // Walk the ancestor chain: a part is "mounted" if it or any parent is.
    let mounted = false;
    for (let n: THREE.Object3D | null = m; n; n = n.parent) {
      if (MOUNTED_NODES.has(n.name || "")) { mounted = true; break; }
    }
    if (mounted) return;
    const attr = m.geometry.getAttribute("position") as THREE.BufferAttribute;
    parts.push({ name: m.name || "(unnamed)", mesh: m, verts: new Float32Array(attr.array as ArrayLike<number>) });
  });

  const v = new THREE.Vector3();
  return {
    pose(a) {
      rig.j1.rotation.set(0, a.j1, 0);
      rig.j2.rotation.set(a.j2, 0, 0);
      rig.j3.rotation.set(a.j3, 0, 0);
      rig.j4.rotation.set(0, a.j4, 0);
      rig.j5.rotation.set(a.j5, 0, 0);
      rig.j6.rotation.set(0, a.j6, 0);
      scene.updateMatrixWorld(true);
    },
    worstClearance(solid = CABINET) {
      let min = Infinity, part = "";
      for (const p of parts) {
        const mw = p.mesh.matrixWorld;
        for (let i = 0; i < p.verts.length; i += 3) {
          v.set(p.verts[i], p.verts[i + 1], p.verts[i + 2]).applyMatrix4(mw);
          const d = clearanceToCar({ x: v.x, y: v.y, z: v.z }, solid);
          if (d < min) { min = d; part = p.name; }
        }
      }
      return { min, part };
    },
  };
}

/** The poses a real cycle actually passes through, at a spread of ports. */
function dutyCyclePoses(): { label: string; angles: JointAngles }[] {
  const out: { label: string; angles: JointAngles }[] = [{ label: "stowed", angles: STOWED }];
  const alongs = [SERVICE_WINDOW.alongMin, 0, SERVICE_WINDOW.alongMax];
  const heights = [SERVICE_WINDOW.heightMin, 0.9, SERVICE_WINDOW.heightMax];
  for (const along of alongs) {
    for (const height of heights) {
      const port = { x: along, y: height - MOUNT_HEIGHT_M, z: SERVICE_WINDOW.flankStandoff };
      const normal = { x: 0, y: 0, z: -1 };
      // the mate itself, and the standoff waypoint it arrives from
      for (const back of [0, 0.25]) {
        const s = solveIK({ ...port, z: port.z - back }, normal);
        // IKSolution IS the joint set plus its own verdict — there is no
        // nested `.angles`, and `reachable` is the flag. A pose the arm cannot
        // actually reach is not a pose it can foul the cabinet in.
        if (s.reachable) {
          out.push({
            label: `port(${along},${height}) back=${back}`,
            angles: { j1: s.j1, j2: s.j2, j3: s.j3, j4: s.j4, j5: s.j5, j6: s.j6 },
          });
        }
      }
    }
  }
  return out;
}

describe("the cabinet is a solid the arm can be measured against", () => {
  it("sits entirely BEHIND the arm base, not straddling it", () => {
    // It used to straddle: the box was drawn at the pedestal point, placeArm
    // put the arm at that same point, and the cabinet reached +0.359 m toward
    // the car past the arm's own base axis. Rotated and backed off, the whole
    // box is now behind the base plane.
    expect(CABINET.zMax).toBeLessThan(0);
    expect(CABINET.zMin).toBeLessThan(CABINET.zMax);
    // ...and it still towers over the mount, as a 1.72 m cabinet should.
    const top = CABINET.profile[2][1] + CABINET.gradeY;
    expect(top).toBeCloseTo(1.2494, 3);
  });

  it("no longer reaches toward the car past the arm base", () => {
    // Negative now: its magnitude is the gap between the arm base and the
    // cabinet's car-facing face. Positive was the defect.
    expect(cabinetIntrusionTowardCar()).toBeLessThan(0);
    // and the arm has the whole standoff to the car to work in, uninterrupted
    expect(SERVICE_WINDOW.flankStandoff).toBeGreaterThan(0);
  });

  it("leaves room between cabinet face and car flank", () => {
    // Sanity on the frame: the car's near flank must still be outside the box.
    expect(SERVICE_WINDOW.flankStandoff).toBeGreaterThan(CABINET.zMax);
    expect(PEDESTAL_TO_CAR_CENTRE_M).toBeGreaterThan(CABINET.zMax);
  });
});

function worstOverDutyCycle(): { min: number; part: string; label: string } {
  const probe = makeProbe();
  let worst = { min: Infinity, part: "", label: "" };
  for (const p of dutyCyclePoses()) {
    probe.pose(p.angles);
    const c = probe.worstClearance();
    if (c.min < worst.min) worst = { min: c.min, part: c.part, label: p.label };
  }
  return worst;
}

describe("THE MOVING ARM vs THE CABINET", () => {
  // ── CHARACTERISATION ─────────────────────────────────────────────────────
  // Locks the defect's SIZE, so a change that makes it quietly worse (a longer
  // link, a bigger cabinet, a different mount height) fails here rather than
  // being discovered on screen.
  it("keeps every moving link clear of the cabinet, with margin", () => {
    const worst = worstOverDutyCycle();
    // eslint-disable-next-line no-console
    console.log(
      `[cabinet] worst moving-link clearance ${worst.min.toFixed(4)} m ` +
      `on "${worst.part}" at ${worst.label} ` +
      `(cabinet ${DCFC_CABINET_PU.width}x${DCFC_CABINET_PU.height}x${DCFC_CABINET_PU.depth} pu)`,
    );
    expect(Number.isFinite(worst.min)).toBe(true);

    // WAS -0.1675 m — exactly half the cabinet's 0.7 pu depth, because the
    // upper arm ran straight down the box's centre axis. Not clipping a corner:
    // inside the middle of it. Rotating the cabinet and backing it off to
    // CABINET_BACKSET_PU turns that into real clearance.
    //
    // Characterised, not just bounded, so a later geometry change that quietly
    // eats the margin fails here rather than on screen.
    expect(worst.min).toBeGreaterThan(0.15);
    expect(worst.min).toBeCloseTo(0.2169, 3);
  });

  // ── THE INVARIANT ────────────────────────────────────────────────────────
  // These two shipped as `it.fails` for exactly one commit — the honest way to
  // record a defect that is measured but not yet fixed. They are plain `it`
  // now because the geometry actually changed: the cabinet is rotated so its
  // wide face runs fore/aft along the car, and backed off CABINET_BACKSET_PU
  // so the whole box sits behind the arm's base.
  it("the moving arm must never enter the cabinet it is bolted to", () => {
    const worst = worstOverDutyCycle();
    expect(worst.min).toBeGreaterThan(0);
  });

  it("the stowed arm must be clear of the cabinet", () => {
    // Stow folds the arm back over its own base, which is the pose most likely
    // to end up inside a cabinet that straddles that base — and it is the
    // binding case above.
    const probe = makeProbe();
    probe.pose(STOWED);
    expect(probe.worstClearance().min).toBeGreaterThan(0);
  });
});

// ============================================================================
// ONE UNIT (founder, 2026-09-30: "the robotic charging arms are floating beside
// the hardware cabinets"). A riser under the mount plate and a bridge into the
// cabinet face tie the arm to its cabinet. The arm itself did not move, so the
// only question is whether the new hardware stands anywhere a moving link goes.
// ============================================================================
describe("THE ARM'S MOUNT: riser and bridge join the arm to its cabinet", () => {
  const MOUNT = mountSolidInArmFrame();

  it("the riser meets the underside of the arm's own mount plate — no gap, no overlap", () => {
    const rig = buildCobot(OTTO_CHARGE_ARM, { withPlinth: true, lod: "studio" });
    rig.root.updateMatrixWorld(true);
    const plate = rig.root.getObjectByName("Mount_Plate") as THREE.Mesh;
    const box = new THREE.Box3().setFromObject(plate);
    expect(box.min.y).toBeCloseTo(-MOUNT_PLATE_UNDERSIDE_M, 6);
    // the solid's top, back in the arm frame, is that same plane
    expect(MOUNT.profile[2][1] + MOUNT.gradeY).toBeCloseTo(-MOUNT_PLATE_UNDERSIDE_M, 6);
    // and the riser is wider than the plate it carries
    expect(ARM_MOUNT_PU.riser * 0.4785).toBeGreaterThan(0.30);
  });

  it("the bridge runs all the way from the riser into the cabinet face", () => {
    // the mount solid's back face IS the cabinet's car-facing face
    expect(MOUNT.zMin).toBeCloseTo(CABINET.zMax, 9);
    expect(MOUNT.zMin).toBeCloseTo(-(CABINET_BACKSET_PU - DCFC_CABINET_PU.depth / 2) * 0.4785, 3);
    // and it stays well short of the car's flank
    expect(MOUNT.zMax).toBeLessThan(SERVICE_WINDOW.flankStandoff - 1.0);
  });

  it("no moving link enters the riser or the bridge, anywhere in the duty cycle", () => {
    const probe = makeProbe();
    let worst = { min: Infinity, part: "", label: "" };
    // the poses, and the TRANSIT to each from stowed: the renderer slews every
    // joint toward its target (armMotion.slewAngles), so the arm passes through
    // these interpolations on every connect and every release
    const lerp = (a: JointAngles, b: JointAngles, k: number): JointAngles => ({
      j1: a.j1 + (b.j1 - a.j1) * k, j2: a.j2 + (b.j2 - a.j2) * k, j3: a.j3 + (b.j3 - a.j3) * k,
      j4: a.j4 + (b.j4 - a.j4) * k, j5: a.j5 + (b.j5 - a.j5) * k, j6: a.j6 + (b.j6 - a.j6) * k,
    });
    for (const p of dutyCyclePoses()) {
      for (let i = 0; i <= 12; i++) {
        probe.pose(lerp(STOWED, p.angles, i / 12));
        const c = probe.worstClearance(MOUNT);
        if (c.min < worst.min) worst = { min: c.min, part: c.part, label: `${p.label} @${i}/12` };
      }
    }
    // eslint-disable-next-line no-console
    console.log(`[mount] worst moving-link clearance ${worst.min.toFixed(4)} m on "${worst.part}" at ${worst.label}`);
    expect(Number.isFinite(worst.min)).toBe(true);
    expect(worst.min).toBeGreaterThan(0.05);
  });
});
