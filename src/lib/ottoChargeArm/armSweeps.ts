/**
 * THE POSES THE ARM IS MEASURED AT, shared by every clearance test: the procedural arm's (armClearance.test.ts,
 * cabinetClearance.test.ts) and the engineering CAD's that the depot draws (robotics/cadYard.test.ts). One list, so
 * both arms are held to the same ports, the same duty cycle and the same transits.
 */
import { MOUNT_HEIGHT_M, OTTO_CHARGE_ARM, SERVICE_WINDOW } from './cobotSpec';
import { poseFor } from './armMotion';
import { NOMINAL_SEQUENCE, type ArmPhase } from './armStateMachine';
import { portFor } from './chargePort';
import { solveIK, STOWED, type JointAngles } from './cobotIK';
import { carSolidInArmFrame, nearFlankZ } from './vehicleEnvelope';

const spec = OTTO_CHARGE_ARM;
const FLANK = nearFlankZ();

/**
 * How much daylight the STRUCTURE must keep from the bodywork, metres.
 *
 * 0.10 m is an engineering margin, not a tolerance: it is what an operator
 * would call "clear", and it leaves room for the residual pose error a real
 * servo carries.
 */
export const STRUCTURAL_MARGIN_M = 0.10;

/** Phases of a nominal cycle, minus the one where nothing has moved yet. */
export const PHASES = NOMINAL_SEQUENCE.filter((p) => p !== 'stowed') as ArmPhase[];

/**
 * The port variants the depot actually has to serve: the CORNERS of every OEM
 * family's band, plus its centre, mirrored fore/aft.
 *
 * Mirroring is not padding. portInArmFrame maps a port's fore/aft offset to
 * base-frame x as `-toward * along`, so the two pedestal sides of a canopy
 * present the SAME port at OPPOSITE x. Sweeping both signs covers both `toward`
 * values exactly, which is why this does not need to iterate stalls: every
 * DCFC pedestal stands the same distance off its stall, so the only thing
 * a stall changes is a rigid transform.
 */
export function portVariants(): { label: string; along: number; height: number }[] {
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
export function windowVariants(): { label: string; along: number; height: number }[] {
  const W = SERVICE_WINDOW;
  const out: { label: string; along: number; height: number }[] = [];
  for (const a of [W.alongMin, 0, W.alongMax]) {
    for (const h of [W.heightMin, (W.heightMin + W.heightMax) / 2, W.heightMax]) {
      out.push({ label: 'service-window', along: a, height: h });
    }
  }
  return out;
}

/** The IK target for a port `along` the car at `height` above the deck, on the near flank. */
export function target(along: number, height: number) {
  return { port: { x: along, y: height - MOUNT_HEIGHT_M, z: FLANK }, normal: { x: 0, y: 0, z: -1 } };
}

interface Measurable {
  pose(a: JointAngles): void;
  clearance(car: ReturnType<typeof carSolidInArmFrame>, which?: 'structure' | 'tool' | 'all', stopAt?: number): { min: number; part: string };
}

/**
 * Sweep the duty cycle for one port, returning the worst clearance seen. With `stopAt`, nothing at that clearance or
 * more is looked at (armClearance.clearance): the worst is exact below it and `stopAt` otherwise.
 */
export function sweep(
  rig: Measurable,
  car: ReturnType<typeof carSolidInArmFrame>,
  along: number, height: number,
  which: 'structure' | 'tool' | 'all',
  stepsPerPhase = 8,
  stopAt = Infinity,
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
      const c = rig.clearance(car, which, stopAt);
      if (c.min < min) { min = c.min; part = c.part; where = `${phase} t=${u.toFixed(2)}`; }
    }
  }
  return { min, part, where, refused };
}

/** The poses a real cycle actually passes through, at a spread of ports (the mate and its standoff waypoint). */
export function dutyCyclePoses(): { label: string; angles: JointAngles }[] {
  const out: { label: string; angles: JointAngles }[] = [{ label: 'stowed', angles: STOWED }];
  const alongs = [SERVICE_WINDOW.alongMin, 0, SERVICE_WINDOW.alongMax];
  const heights = [SERVICE_WINDOW.heightMin, 0.9, SERVICE_WINDOW.heightMax];
  for (const along of alongs) {
    for (const height of heights) {
      const port = { x: along, y: height - MOUNT_HEIGHT_M, z: SERVICE_WINDOW.flankStandoff };
      const normal = { x: 0, y: 0, z: -1 };
      for (const back of [0, 0.25]) {
        const s = solveIK({ ...port, z: port.z - back }, normal);
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

/** Joint-space interpolation: what the renderer's slew passes through on the way from one pose to another. */
export function lerpAngles(a: JointAngles, b: JointAngles, k: number): JointAngles {
  return {
    j1: a.j1 + (b.j1 - a.j1) * k, j2: a.j2 + (b.j2 - a.j2) * k, j3: a.j3 + (b.j3 - a.j3) * k,
    j4: a.j4 + (b.j4 - a.j4) * k, j5: a.j5 + (b.j5 - a.j5) * k, j6: a.j6 + (b.j6 - a.j6) * k,
  };
}
