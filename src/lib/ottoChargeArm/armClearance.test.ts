/**
 * THE TEST THAT WAS MISSING: the robot against the car.
 *
 * Twenty-six arm tests already run in CI. Every one of them measures the arm
 * against a PLANE (the flank standoff), a POINT (the charge port), or the DECK.
 * None of them measures it against the VEHICLE. So when the fleet body was
 * widened from 3.367 to 4.2 plan units — moving the near flank 0.199 m closer
 * to the pedestal — all 26 kept passing while the two-link chain folded tighter,
 * threw the elbow housing forward, and swung it straight through the bodywork.
 *
 * That is the defect this file exists to catch, and the rule it enforces is
 * simple enough to state in one line:
 *
 *     NOTHING ON THE ARM MAY ENTER THE CAR, AND THE CONNECTOR MUST REACH IT.
 *
 * ───────────────────────────────────────────────────── HOW IT MEASURES ──────
 * The arm is the DRAWN arm (buildCobot's meshes, posed by the real joint
 * chain), the car is the DRAWN car (vehicleEnvelope.ts, which vehicleBody.ts
 * builds its mesh from), and the clearance is an exact analytic distance from
 * every arm surface vertex to that solid. No proxy on either side.
 *
 * ────────────────────────────────────────────────── HOW IT SAMPLES ──────────
 * BY STRUCTURE, NOT BY CLOCK. Sampling a 15-minute duty cycle at a fixed time
 * step spends 97% of its budget on 'charging', which is one motionless pose,
 * and a handful of samples on 'align' and 'insert', which are where the arm is
 * closest to the car. Every phase therefore gets the same number of progress
 * steps regardless of how long it lasts, and the port variants are the CORNERS
 * of each OEM family's band rather than a uniform grid — the corners are where
 * the geometry is extreme.
 *
 * CI is an ubuntu shared runner and is >12x slower than a dev machine, so the
 * sweeps carry explicit per-test timeouts rather than leaning on the default.
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { makeArmClearanceRig, SAMPLING_SAG_M } from './armClearance';
import {
  carSolidInArmFrame, nearFlankZ, clearanceToCar, isConvex, bodyProfile,
  bevelledBodyProfile, CAR_LENGTH_M, CAR_WIDTH_M,
} from './vehicleEnvelope';
import {
  OTTO_CHARGE_ARM, MOUNT_HEIGHT_M, SERVICE_WINDOW, FLANK_STANDOFF_M, ARM_SCALE, TCP_NODE_NAME,
  METRES_PER_PLAN_UNIT, ARM_BASE_TO_CAR_CENTRE_M,
} from './cobotSpec';
import { buildCobot } from './buildCobot';
import { VEHICLE_GEO, PORT_GEO } from '@/components/canvas/three/vehicleBody';
import { poseFor, STANDOFF_M } from './armMotion';
import { NOMINAL_SEQUENCE, type ArmPhase } from './armStateMachine';
import { portFor } from './chargePort';
import { placeArm, portInArmFrame, ARM_MOUNT_OFFSET_PU, PEDESTAL_OFFSET_PU } from './depotPlacement';
import { generateStallsV2 } from '@/lib/sitePlan';

const spec = OTTO_CHARGE_ARM;
const FLANK = nearFlankZ();

/**
 * How much daylight the STRUCTURE must keep from the bodywork, metres.
 *
 * 0.10 m is an engineering margin, not a tolerance: it is what an operator
 * would call "clear", and it leaves room for the residual pose error a real
 * servo carries. It is also 75.4x SAMPLING_SAG_M (1.326 mm at ARM_SCALE 0.72),
 * so a pass cannot be an artefact of how finely the meshes happen to be
 * tessellated. The assertion below only demands 20x, so the multiple can fall
 * by nearly three quarters before the claim stops being a claim about geometry.
 */
const STRUCTURAL_MARGIN_M = 0.10;

/** Phases of a nominal cycle, minus the one where nothing has moved yet. */
const PHASES = NOMINAL_SEQUENCE.filter((p) => p !== 'stowed') as ArmPhase[];

/**
 * The port variants the depot actually has to serve: the CORNERS of every OEM
 * family's band, plus its centre, mirrored fore/aft.
 *
 * Mirroring is not padding. portInArmFrame maps a port's fore/aft offset to
 * base-frame x as `-toward * along`, so the two pedestal sides of a canopy
 * present the SAME port at OPPOSITE x. Sweeping both signs covers both `toward`
 * values exactly, which is why this file does not need to iterate stalls: every
 * DCFC pedestal stands the same 4.5 plan units off its stall, so the only thing
 * a stall changes is a rigid transform.
 */
function portVariants(): { label: string; along: number; height: number }[] {
  const oems = ['tesla', 'waymo', 'zoox', 'cruise', 'motional', 'van', null];
  const out: { label: string; along: number; height: number }[] = [];
  for (const oem of oems) {
    let aLo = Infinity, aHi = -Infinity, hLo = Infinity, hHi = -Infinity;
    for (let i = 0; i < 200; i++) {
      const p = portFor(`probe-${i}`, oem);
      aLo = Math.min(aLo, p.along); aHi = Math.max(aHi, p.along);
      hLo = Math.min(hLo, p.height); hHi = Math.max(hHi, p.height);
    }
    const name = oem ?? 'generic';
    for (const a of [aLo, (aLo + aHi) / 2, aHi]) {
      for (const h of [hLo, (hLo + hHi) / 2, hHi]) {
        out.push({ label: `${name}`, along: a, height: h });
        out.push({ label: `${name}/mirrored`, along: -a, height: h });
      }
    }
  }
  return out;
}

/** Corners and edge midpoints of the ADVERTISED window — the promise, not the fleet. */
function windowVariants(): { label: string; along: number; height: number }[] {
  const W = SERVICE_WINDOW;
  const out: { label: string; along: number; height: number }[] = [];
  for (const a of [W.alongMin, 0, W.alongMax]) {
    for (const h of [W.heightMin, (W.heightMin + W.heightMax) / 2, W.heightMax]) {
      out.push({ label: 'service-window', along: a, height: h });
    }
  }
  return out;
}

function target(along: number, height: number) {
  return { port: { x: along, y: height - MOUNT_HEIGHT_M, z: FLANK }, normal: { x: 0, y: 0, z: -1 } };
}

/** Sweep the duty cycle for one port, returning the worst clearance seen. */
function sweep(
  rig: ReturnType<typeof makeArmClearanceRig>,
  car: ReturnType<typeof carSolidInArmFrame>,
  along: number, height: number,
  which: 'structure' | 'tool' | 'all',
  stepsPerPhase = 8,
): { min: number; part: string; where: string; refused: boolean } {
  const t = target(along, height);
  let min = Infinity, part = '', where = '', refused = false;
  for (const phase of PHASES) {
    const steps = phase === 'charging' ? 0 : stepsPerPhase;
    for (let k = 0; k <= steps; k++) {
      const u = steps === 0 ? 0 : k / steps;
      const p = poseFor({ phase, t: u }, t, spec);
      if (!p.ok) { refused = true; continue; }
      rig.pose(p.angles);
      const c = rig.clearance(car, which);
      if (c.min < min) { min = c.min; part = c.part; where = `${phase} t=${u.toFixed(2)}`; }
    }
  }
  return { min, part, where, refused };
}

describe('the car solid the arm is measured against', () => {
  it('is the body the renderer draws, at the unified footprint', () => {
    expect(CAR_LENGTH_M).toBeCloseTo(10.2 * 0.4785, 9);
    expect(CAR_WIDTH_M).toBeCloseTo(4.2 * 0.4785, 9);
    // the near flank the arm works against is DERIVED from that width
    expect(FLANK).toBeCloseTo(FLANK_STANDOFF_M, 12);
    expect(FLANK).toBeCloseTo(SERVICE_WINDOW.flankStandoff, 12);
  });

  it('has a convex silhouette — the distance maths depends on it', () => {
    expect(isConvex(bodyProfile())).toBe(true);
    // and the bevel offset has to preserve that, or the distance is nonsense
    expect(isConvex(bevelledBodyProfile())).toBe(true);
  });

  /**
   * THE GUARANTEE THE FILE EXISTS TO MAKE, MEASURED RATHER THAN ASSERTED.
   *
   * A clearance number is worth having only if the solid it was taken against
   * contains the solid on screen. That was a sentence in vehicleEnvelope.ts's
   * header and it was FALSE: the polygon was grown by a round offset while
   * ExtrudeGeometry mitres its corners, so the drawn body stood 20.71 mm
   * outside the model at the extreme fore/aft lower corners. Harmless where the
   * arm works and still a hole in the one claim this file makes, so the claim
   * is a test now.
   */
  it('contains every vertex of the drawn car', () => {
    const car = carSolidInArmFrame();
    // planUnits() scales by PLAN_UNITS_PER_METRE then rotates Ry(-PI/2), which
    // sends metre (x, y, z) to plan (-z, y, x). Undo both, then into the arm
    // frame: +x along the car, +y up, +z across it toward the far flank.
    const worstOutside = (geo: THREE.BufferGeometry) => {
      const a = geo.getAttribute('position') as THREE.BufferAttribute;
      let out = -Infinity;
      for (let i = 0; i < a.count; i++) {
        const along = a.getZ(i) * METRES_PER_PLAN_UNIT;
        const height = a.getY(i) * METRES_PER_PLAN_UNIT;
        const lateral = -a.getX(i) * METRES_PER_PLAN_UNIT;
        // the car is symmetric across its centreline; check the vertex on both
        // flanks so a one-sided sign error cannot hide half the mesh
        for (const s of [1, -1]) {
          const p = { x: along, y: height + car.gradeY, z: ARM_BASE_TO_CAR_CENTRE_M + s * lateral };
          out = Math.max(out, clearanceToCar(p, car));
        }
      }
      return out;
    };
    // Position buffers are Float32. The car's furthest vertex is ~5.1 plan
    // units out, so a round trip through the buffer costs up to 5.1 * 1.19e-7
    // = 6.1e-7 plan units, 0.3 um. One micrometre is the containment tolerance;
    // the defect this replaced was 20.71 mm, five orders of magnitude up.
    const FLOAT32_SLOP_M = 1e-6;
    for (const [name, geo] of Object.entries(VEHICLE_GEO)) {
      if (name === 'glow') continue; // a decorative halo, never part of the body
      const out = worstOutside(geo);
      expect(out, `${name} stands ${(out * 1000).toFixed(3)} mm outside the solid`)
        .toBeLessThanOrEqual(FLOAT32_SLOP_M);
    }
  });

  /**
   * THE ONE DRAWN THING DELIBERATELY LEFT OUTSIDE, pinned to a number.
   *
   * The socket rim and the lit ring hang ON the flank plane and stand proud of
   * it. They are not folded into the solid because the connector's whole job is
   * to arrive at that ring — a model that contained the inlet would be asserting
   * the arm may never touch the thing it plugs into. What has to stay true is
   * that the exception is small against the margin the STRUCTURE keeps.
   */
  it('leaves the charge-port trim outside, by a stated and bounded amount', () => {
    const car = carSolidInArmFrame();
    const proud = (geo: THREE.BufferGeometry) => {
      const a = geo.getAttribute('position') as THREE.BufferAttribute;
      let out = -Infinity;
      for (let i = 0; i < a.count; i++) {
        // Vehicle3D hangs this group at x = +/- CAR_W_PU/2 — exactly the flank
        // plane — with local +X pointing out of the bodywork.
        const p = {
          x: a.getZ(i) * METRES_PER_PLAN_UNIT,
          y: 0.9 + car.gradeY + a.getY(i) * METRES_PER_PLAN_UNIT,
          z: car.zMin - a.getX(i) * METRES_PER_PLAN_UNIT,
        };
        out = Math.max(out, clearanceToCar(p, car));
      }
      return out;
    };
    // a torus of tube radius r drawn with 6 radial segments reaches r*sin(60deg)
    expect(proud(PORT_GEO.socket)).toBeCloseTo(0.010 * Math.sin(Math.PI / 3), 6);
    expect(proud(PORT_GEO.ring)).toBeCloseTo(0.006 * Math.sin(Math.PI / 3), 6);
    // and 11x the taller of them still fits inside the structural margin
    const worst = Math.max(proud(PORT_GEO.socket), proud(PORT_GEO.ring));
    expect(worst * 11).toBeLessThan(STRUCTURAL_MARGIN_M);
  });

  /**
   * SAMPLING_SAG_M is the reason a vertex scan is allowed to stand in for a
   * surface. It is derived by hand in armClearance.ts, from the coarsest
   * segment count on the arm paired with the largest radius on it — a pairing
   * no single part actually is. That makes it a bound only for as long as no
   * part gets coarser or fatter, which is a thing a test can watch.
   */
  it('bounds the chord sag of every curved primitive the arm is drawn from', () => {
    const rig = buildCobot(OTTO_CHARGE_ARM, { withPlinth: true, lod: 'studio' });
    const sag = (r: number, n: number) => r * (1 - Math.cos(Math.PI / n));
    // NOTE this walks the AUTHORED radii, ignoring any group scale above the
    // mesh. That is the conservative direction for everything on this rig: the
    // only scaled group is the end effector, and it scales DOWN.
    const seen = new Set<string>();
    let worst = 0, worstName = '';
    rig.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.geometry) return;
      const g = m.geometry as THREE.BufferGeometry & { type: string; parameters: Record<string, number> };
      if (seen.has(g.uuid)) return;
      seen.add(g.uuid);
      const p = g.parameters;
      let s: number;
      switch (g.type) {
        case 'BoxGeometry': case 'PlaneGeometry': s = 0; break; // flat
        case 'CylinderGeometry':
          s = sag(Math.max(p.radiusTop, p.radiusBottom), p.radialSegments); break;
        case 'SphereGeometry':
          // widthSegments spans 2pi, heightSegments spans pi
          s = Math.max(sag(p.radius, p.widthSegments), sag(p.radius, 2 * p.heightSegments)); break;
        case 'TorusGeometry':
          s = Math.max(sag(p.tube, p.radialSegments), sag(p.radius + p.tube, p.tubularSegments)); break;
        case 'TubeGeometry':
          s = sag(p.radius, p.radialSegments); break;
        // Deliberately total: a primitive nobody accounted for must FAIL here
        // rather than be silently skipped and quietly widen the bound.
        default: throw new Error(`unaccounted primitive on the arm: ${g.type} (${m.name})`);
      }
      if (s > worst) { worst = s; worstName = `${m.name} (${g.type})`; }
    });
    expect(
      worst,
      `${worstName} sags ${(worst * 1000).toFixed(3)} mm, past SAMPLING_SAG_M = ${(SAMPLING_SAG_M * 1000).toFixed(3)} mm`,
    ).toBeLessThanOrEqual(SAMPLING_SAG_M);
  });

  it('reports points inside the bodywork as inside, and outside as outside', () => {
    const car = carSolidInArmFrame();
    const deck = -MOUNT_HEIGHT_M;
    // The car's centreline, from the ARM'S BASE. These used to be a literal
    // 2.153 — the pedestal-axis distance — which stopped being the car's centre
    // the moment the mount moved onto the cabinet face.
    const CTR = ARM_BASE_TO_CAR_CENTRE_M;
    // dead centre of the car, at window height: deep inside
    expect(clearanceToCar({ x: 0, y: deck + 0.9, z: CTR }, car)).toBeLessThan(-0.5);
    // just outside the near flank
    expect(clearanceToCar({ x: 0, y: deck + 0.9, z: FLANK - 0.05 }, car)).toBeCloseTo(0.05, 6);
    // above the roof, clear of the sensor pod
    expect(clearanceToCar({ x: 1.5, y: deck + 2.2, z: CTR }, car)).toBeGreaterThan(0.5);
    // the sensor pod is modelled: straight above the centre, just over the roof
    expect(clearanceToCar({ x: 0, y: deck + 1.55, z: CTR }, car)).toBeLessThan(0);
  });
});

describe('the OTTO-CHARGE ARM never enters the vehicle', () => {
  /**
   * THE ONE THAT WOULD HAVE CAUGHT THE NAIVE RESIZE.
   *
   * ───────────────────────────────────────────────────────── THE HARNESS ─────
   * Everything below comes out of ONE sweep, and it is this file's own: the 126
   * port variants plus the 9 advertised-window corners, every phase of the duty
   * cycle at 8 steps each (82 poses per target), studio LOD, STRUCTURE only,
   * against carSolidInArmFrame() at the mount height being tested. The only
   * thing it does that `sweep()` below cannot is take the standoff as an
   * argument — STANDOFF_M is a module constant, so restoring the old 0.45 m
   * needs a copy of poseFor() with that one value lifted out. (The copy is
   * checked against the real poseFor() at STANDOFF_M first; it agrees to 0.)
   *
   * ───────────────────────────────────── WIDEN THE CAR, LEAVE THE ARM ────────
   * Mesh at 4.2 plan units, arm still at ARM_SCALE 1.5 / mount 0.70 m /
   * standoff 0.45 m:
   *
   *     11070 poses attempted
   *      1148 REFUSED outright, spread over 14 of the 135 targets
   *      1098 of the 9922 that did solve are INSIDE the bodywork
   *     worst penetration  -0.1726 m  on Elbow_Joint_Drum
   *                        (DressPack_Forearm is the other offender, 326 poses)
   *
   * The SAME sweep against the SAME solid at the old 7.5 x 3.367 footprint:
   * ZERO poses inside, worst clearance +0.0271 m. The arm never changed. The
   * car did, and it took 15% of the arm's working span with it.
   *
   * Either failure is caught here, and `refused` trips first: a 0.45 m standoff
   * off a flank that close is no longer a pose the arm can make, so the arm
   * would simply have stayed folded at those ports. Nothing on origin/main
   * catches either one.
   */
  it('keeps the STRUCTURE clear of the bodywork for every OEM in the fleet', () => {
    const rig = makeArmClearanceRig(spec, 'studio');
    const car = carSolidInArmFrame();
    let worst = Infinity, detail = '';
    let checked = 0;
    for (const v of portVariants()) {
      const r = sweep(rig, car, v.along, v.height, 'structure');
      expect(r.refused, `${v.label} along=${v.along.toFixed(2)} h=${v.height.toFixed(2)}: the arm REFUSED the mate`).toBe(false);
      if (r.min < worst) {
        worst = r.min;
        detail = `${v.label} along=${v.along.toFixed(2)} h=${v.height.toFixed(2)} ${r.where} part=${r.part}`;
      }
      checked++;
    }
    expect(checked).toBe(126);
    expect(
      worst,
      `arm structure comes within ${worst.toFixed(4)} m of the car at ${detail}` +
      ` — ARM_SCALE=${ARM_SCALE}, MOUNT_HEIGHT_M=${MOUNT_HEIGHT_M}, STANDOFF_M=${STANDOFF_M}`,
    ).toBeGreaterThan(STRUCTURAL_MARGIN_M);
    // and the margin is far larger than the mesh sampling error, so this is a
    // statement about the geometry, not about the tessellation
    expect(STRUCTURAL_MARGIN_M).toBeGreaterThan(20 * SAMPLING_SAG_M);
  }, 120_000);

  it('keeps the STRUCTURE clear across the ADVERTISED service window, not just the fleet', () => {
    // chargePort clamps into SERVICE_WINDOW and the backend gate trusts it. If
    // a corner of the advertised window fouls the car, the promise is false.
    const rig = makeArmClearanceRig(spec, 'studio');
    const car = carSolidInArmFrame();
    let worst = Infinity, detail = '';
    for (const v of windowVariants()) {
      const r = sweep(rig, car, v.along, v.height, 'structure');
      expect(r.refused, `service window corner along=${v.along} h=${v.height} is unreachable`).toBe(false);
      if (r.min < worst) { worst = r.min; detail = `along=${v.along} h=${v.height} ${r.where} part=${r.part}`; }
    }
    expect(worst, `advertised window fouls the car at ${detail}`).toBeGreaterThan(STRUCTURAL_MARGIN_M);
  }, 60_000);

  it('does not let the CONNECTOR penetrate the bodywork either', () => {
    // The end effector is allowed to REACH the car — that is its job — but the
    // inlet mouth is on the flank plane, so at full mate the tip touches and
    // nothing goes past it.
    const rig = makeArmClearanceRig(spec, 'studio');
    const car = carSolidInArmFrame();
    let worst = Infinity, detail = '';
    for (const v of portVariants()) {
      const r = sweep(rig, car, v.along, v.height, 'tool');
      if (r.min < worst) { worst = r.min; detail = `${v.label} along=${v.along.toFixed(2)} ${r.where} part=${r.part}`; }
    }
    expect(worst, `connector inside the bodywork at ${detail}`).toBeGreaterThan(-SAMPLING_SAG_M);
  }, 120_000);
});

describe('the connector reaches the port you can SEE', () => {
  /**
   * The TCP is an EMPTY. Every existing test drives it onto the port and
   * confirms it lands to 1e-9 — and on origin/main the drawn connector still
   * finished 0.1200 m short of the inlet, because the meshes are authored at
   * fixed metres while spec.tool scales with ARM_SCALE. An empty landing on a
   * ring is not a connector plugging into a socket.
   */
  it('closes the gap between the drawn connector tip and the TCP', () => {
    const rig = makeArmClearanceRig(spec, 'studio');
    rig.pose({ j1: 0, j2: 0.4, j3: 1.1, j4: 0.3, j5: 0.6, j6: 0 });
    const gap = rig.drawnTipVsTcp();
    // measured on origin/main at ARM_SCALE 1.5: -0.1200 m
    expect(gap, `drawn connector tip is ${gap.toFixed(4)} m from the TCP`).toBeGreaterThan(-0.005);
    // and it must not overshoot into the bodywork either
    expect(gap).toBeLessThan(0.005);
  });

  it('lands the drawn connector ON the inlet at full mate, for every OEM', () => {
    const rig = makeArmClearanceRig(spec, 'studio');
    const car = carSolidInArmFrame();
    let worstStandoff = 0, detail = '';
    for (const v of portVariants()) {
      const t = target(v.along, v.height);
      const p = poseFor({ phase: 'charging', t: 0 }, t, spec);
      expect(p.ok, `${v.label} refused`).toBe(true);
      rig.pose(p.angles);
      // the connector, at mate, must be touching the car — not hovering off it
      const c = rig.clearance(car, 'tool');
      if (c.min > worstStandoff) {
        worstStandoff = c.min;
        detail = `${v.label} along=${v.along.toFixed(2)} h=${v.height.toFixed(2)} part=${c.part}`;
      }
    }
    expect(
      worstStandoff,
      `drawn connector hangs ${worstStandoff.toFixed(4)} m off the inlet at ${detail}`,
    ).toBeLessThan(0.02);
  }, 60_000);
});

describe('the depot places every arm where this measurement applies', () => {
  it('gives all 10 DCFC arms the same relative geometry, so one sweep covers them', () => {
    // The sweep above measures ONE arm against ONE car. That generalises only
    // if every DCFC pedestal stands the same distance off its stall and squares
    // up to it — otherwise ten arms need ten sweeps. Assert the premise.
    const dcfc = generateStallsV2().filter((s) => s.type === 'dcfc');
    expect(dcfc).toHaveLength(10);
    const towards = new Set<number>();
    for (const s of dcfc) {
      const p = placeArm(s.id, s.position.x, s.position.y);
      // the arm stands off its stall by the pedestal offset LESS the mount
      // offset — it is bolted to the cabinet's car-facing face, not its axis
      expect(Math.abs(p.carWorld[0] - p.world[0]))
        .toBeCloseTo(PEDESTAL_OFFSET_PU - ARM_MOUNT_OFFSET_PU, 9);
      expect(p.carWorld[2]).toBeCloseTo(p.world[2], 9);
      towards.add(p.toward);
      // and the port really does land on the flank the solid says it does
      const t = portInArmFrame(0.3, 0.8, CAR_WIDTH_M / 2, p.toward);
      expect(t.z).toBeCloseTo(FLANK, 9);
      expect(Math.abs(t.x)).toBeCloseTo(0.3, 9);
    }
    // both pedestal sides occur, and the sweep covers both by mirroring `along`
    expect(towards).toEqual(new Set([1, -1]));
  });
});
