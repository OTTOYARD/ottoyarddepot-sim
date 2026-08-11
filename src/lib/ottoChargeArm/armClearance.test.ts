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
  CAR_LENGTH_M, CAR_WIDTH_M,
} from './vehicleEnvelope';
import {
  OTTO_CHARGE_ARM, MOUNT_HEIGHT_M, SERVICE_WINDOW, FLANK_STANDOFF_M, ARM_SCALE, TCP_NODE_NAME,
} from './cobotSpec';
import { poseFor, STANDOFF_M } from './armMotion';
import { NOMINAL_SEQUENCE, type ArmPhase } from './armStateMachine';
import { portFor } from './chargePort';
import { placeArm, portInArmFrame } from './depotPlacement';
import { generateStallsV2 } from '@/lib/sitePlan';

const spec = OTTO_CHARGE_ARM;
const FLANK = nearFlankZ();

/**
 * How much daylight the STRUCTURE must keep from the bodywork, metres.
 *
 * 0.10 m is an engineering margin, not a tolerance: it is what an operator
 * would call "clear", and it leaves room for the residual pose error a real
 * servo carries. It is also ~40x SAMPLING_SAG_M, so a pass cannot be an
 * artefact of how finely the meshes happen to be tessellated.
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
  });

  it('reports points inside the bodywork as inside, and outside as outside', () => {
    const car = carSolidInArmFrame();
    const deck = -MOUNT_HEIGHT_M;
    // dead centre of the car, at window height: deep inside
    expect(clearanceToCar({ x: 0, y: deck + 0.9, z: 2.153 }, car)).toBeLessThan(-0.5);
    // just outside the near flank
    expect(clearanceToCar({ x: 0, y: deck + 0.9, z: FLANK - 0.05 }, car)).toBeCloseTo(0.05, 6);
    // above the roof, clear of the sensor pod
    expect(clearanceToCar({ x: 1.5, y: deck + 2.2, z: 2.153 }, car)).toBeGreaterThan(0.5);
    // the sensor pod is modelled: straight above the centre, just over the roof
    expect(clearanceToCar({ x: 0, y: deck + 1.55, z: 2.153 }, car)).toBeLessThan(0);
  });
});

describe('the OTTO-CHARGE ARM never enters the vehicle', () => {
  /**
   * THE ONE THAT WOULD HAVE CAUGHT THE NAIVE RESIZE.
   *
   * Reproduced before shipping. Widen the mesh to 4.2 plan units and leave the
   * arm at ARM_SCALE 1.5 / mount 0.70 m / standoff 0.45 m, and:
   *
   *   - a raw sweep of the same duty cycle over the same port variants finds
   *     240 intersecting samples out of 6664, worst penetration -0.0424 m, on
   *     Elbow_Joint_Drum. On origin/main's 3.367-wide car the identical sweep
   *     finds ZERO — which is exactly why the resize looked safe;
   *   - and this test fails even sooner, on `refused`, because a 0.45 m
   *     standoff off a flank that close is no longer a pose the arm can make.
   *
   * Either way it is caught. Nothing on origin/main catches either one.
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
      expect(Math.abs(p.carWorld[0] - p.world[0])).toBeCloseTo(4.5, 9);
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
