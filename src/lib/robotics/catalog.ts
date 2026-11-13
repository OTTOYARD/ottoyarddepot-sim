/**
 * The Robotics tab's data and words: the CAD manifest and bills of materials (cad/build.py -> public/cad), the
 * user's five robotic functions mapped onto the three machines, each machine's pose presets, and the steps each
 * one runs. Pose presets and steps are read from the twin's OWN code (cobotIK, cleanArmPose, washPose, the phase
 * tables), never restated here, so the CAD on screen moves the way the depot's robots move.
 *
 * Viewer copy is ASD-STE100 (AGENTS.md). No product names (publicNames.test.ts).
 */
import { ARM_REACH, BASE_JOINT_NAMES, HEAD_JOINT_NAMES, headIK, solveMate } from '@/lib/ottoChargeArm/mateSolver';
import { FLEET_SPECS } from '@/lib/fleetModels';
import { mateTarget } from '@/lib/fleetModels/ports';
import { NOMINAL_SEQUENCE, ARM_TIMING_DEFAULTS } from '@/lib/ottoChargeArm/armStateMachine';
import { poseForPhase } from '@/lib/ottoChargeArm/armMotion';
import { STOWED, solveIK } from '@/lib/ottoChargeArm/cobotIK';
import { FLANK_STANDOFF_M, MOUNT_HEIGHT_M, METRES_PER_PLAN_UNIT } from '@/lib/ottoChargeArm/cobotSpec';
import { CLEAN_CHAIN, CLEAN_PHASE_S, CLEAN_SIDE_NOMINAL_S, MAST_FOOT_MAX, type CleanPhase } from '@/lib/ottoCleanArm/cleanArmSpec';
import { cleanJointsAt, sidesFor, type CleanJoints } from '@/lib/ottoCleanArm/cleanArmPose';
import { programPoseAt, type WashPose } from '@/lib/ottoWash/washPose';
import { DOCK_DY_M } from '@/lib/ottoWash/detailArm';
import {
  CABIN_HOLD_NOMINAL_S, PASS_NOMINAL_S, WASH_GANTRY as WG, WASH_PHASE_S, washChain, isPass, type WashPhase,
} from '@/lib/ottoWash/washSpec';

// ── files ──────────────────────────────────────────────────────────────────

export type RobotKey = 'charge_arm' | 'clean_arm' | 'wash_gantry';
export const ROBOT_KEYS: readonly RobotKey[] = ['charge_arm', 'clean_arm', 'wash_gantry'];

export interface ManifestRobot {
  key: RobotKey;
  title: string;
  frame: string;
  files: { glb: string; step: string; bom: string; csv: string; depot: string };
  bytes: { glb: number; stepZip: number; step: number; depot: number };
  mesh: { vertices: number; triangles: number; meshes: number; nodes: number };
  /** the depot model the yard draws (the parts you can see from the yard, coarse): cadDepot.ts */
  depotMesh: { vertices: number; triangles: number; meshes: number; nodes: number };
  depotSha256: string;
  totals: BomTotals;
  glbSha256: string;
  subsystems: { id: string; name: string }[];
}
export interface Manifest { generator: string; specVersion: number; units: { cad: string; glb: string }; robots: ManifestRobot[] }

export interface BomTotals {
  parts: number; uniqueParts: number; fasteners: number; massKg: number; boughtLines: number; madeLines: number;
  referenceLines?: number;
}
export interface BomLine {
  id: string; name: string; category: string; make: 'make' | 'buy';
  standard: string; size: string; grade: string; material: string; materialKey: string;
  qty: number; massKg: number; totalMassKg: number; torqueNm: number | null; reference?: boolean;
  function: string; spec: Record<string, string>; uses: { sub: string; qty: number }[];
}
export interface BomSubsystem {
  id: string; name: string; function: string; how: string[]; specs: Record<string, string>; group: string; order: number;
  partCount: number; fastenerCount: number; massKg: number; uniqueParts: number;
}
export interface TorqueRow { distalMassKg: number; torqueNm: number; gear: string; repeatedPeakNm: number; margin: number }
export interface TorqueBudget {
  method: string;
  J3: TorqueRow;
  J2: TorqueRow & {
    gearWorstNm: number;
    balancer: { type: string; forceExtendedN: number; forceAt90N: number; strokeMm: number; travelDeg: number };
    curve: { deg: number; gravityNm: number; balancerNm: number; gearNm: number }[];
  };
  serviceWindowJ2Deg: { min: number; max: number } | null;
}
export interface Bom {
  robot: RobotKey; title: string; frame: string; units: { cad: string; glb: string };
  totals: BomTotals; subsystems: BomSubsystem[]; lines: BomLine[]; notes: { torque_budget?: TorqueBudget };
}

export const CAD_BASE = '/cad/';
export const cadUrl = (file: string): string => `${CAD_BASE}${file}`;

export async function fetchManifest(fetcher: typeof fetch = fetch): Promise<Manifest> {
  const r = await fetcher(cadUrl('manifest.json'));
  if (!r.ok) throw new Error(`The CAD list did not load (${r.status}).`);
  return (await r.json()) as Manifest;
}

/** cad/clash.py's report for one robot: every placed part against every other, at the stowed pose and the twin's poses. */
export interface ClashPart { item: string; part: string; name: string; sub: string }
export interface ClashReport {
  robot: RobotKey; glbSha256?: string; poses: string[]; pairsChecked: number; contactPairs: number;
  counts: { thread: number; seal: number; ring: number; mesh?: number; context: number; clash: number };
  clashes: { kind: string; a: ClashPart; b: ClashPart; volumeMm3: number; poses: string[] }[];
  floating: ClashPart[][];
}

/** The clash report, or null when it is missing (the tab still works without it). */
export async function fetchClash(robot: ManifestRobot, fetcher: typeof fetch = fetch): Promise<ClashReport | null> {
  try {
    const r = await fetcher(cadUrl(`${robot.key}.clash.json`));
    if (!r.ok) return null;
    return (await r.json()) as ClashReport;
  } catch {
    return null;
  }
}

export async function fetchBom(robot: ManifestRobot, fetcher: typeof fetch = fetch): Promise<Bom> {
  const r = await fetcher(cadUrl(robot.files.bom));
  if (!r.ok) throw new Error(`The parts list did not load (${r.status}).`);
  return (await r.json()) as Bom;
}

// ── words ──────────────────────────────────────────────────────────────────

export const ROBOT_INFO: Record<RobotKey, { name: string; short: string; summary: string[] }> = {
  charge_arm: {
    name: 'OTTO-CHARGE ARM',
    short: 'Charge arm',
    summary: [
      'A 6-axis robot arm at each fast charger.',
      'It finds the charge port, pushes the DC connector in and locks it.',
      'It lets go when the charge ends. The car cannot move until the arm is home.',
    ],
  },
  clean_arm: {
    name: 'OTTO-CLEAN ARM',
    short: 'Cabin clean arm',
    summary: [
      'An overhead arm over each fast charger. It vacuums the cabin while the car charges.',
      'It swings in a plane 1.8 m above the roof. Only the wand goes into the car, and only through a door.',
    ],
  },
  wash_gantry: {
    name: 'OTTO-WASH',
    short: 'Wash bay machine',
    summary: [
      'A touchless wash line in each wash bay. The car stands still and the machines move round it.',
      'A gantry makes 6 passes: pre-soak, 2 water-jet passes, rinse, 2 dry passes. Then it stows at the entrance.',
      'Then 2 six-axis arms come from the exit end, one each side, and polish each sensor with a soft pad.',
      'No brush touches the car. The doors stay shut.',
    ],
  },
};

/** The five robotic functions Chase named, each found in the machine and subsystems that do it. */
export interface RoboticFunction { id: string; label: string; robot: RobotKey; subs: string[] }
export const FUNCTIONS: readonly RoboticFunction[] = [
  { id: 'charge', label: 'Robotic charging', robot: 'charge_arm', subs: ['TOOL', 'WRIST', 'J2'] },
  { id: 'interior', label: 'Interior', robot: 'clean_arm', subs: ['NOZZLE', 'WAND', 'WRIST'] },
  { id: 'vacuum', label: 'Vacuum', robot: 'clean_arm', subs: ['VAC', 'WAND', 'NOZZLE'] },
  { id: 'overhead', label: 'Overhead cleaning', robot: 'clean_arm', subs: ['J1', 'LINK1', 'J2', 'LINK2', 'MAST'] },
  { id: 'wash', label: 'Wash bay', robot: 'wash_gantry', subs: ['ARCH', 'DRYER', 'POLISH'] },
  { id: 'wash_wipe', label: 'Wash bay sensor polish', robot: 'wash_gantry', subs: ['POLISH', 'WRIST', 'TRACK', 'DOCK'] },
  { id: 'wash_overhead', label: 'Wash bay overhead', robot: 'wash_gantry', subs: ['DRYER', 'ARCH'] },
];

export const CATEGORY_LABEL: Record<string, string> = {
  structure: 'Structure', drive: 'Drive', bearing: 'Bearing', sensor: 'Sensor', electrical: 'Electrical',
  fluid: 'Fluid', tool: 'Tool', seal: 'Seal', fastener: 'Fastener',
};

// ── numbers ────────────────────────────────────────────────────────────────

export const fmtKg = (kg: number): string =>
  kg >= 100 ? `${Math.round(kg).toLocaleString('en-US')} kg` : kg >= 1 ? `${kg.toFixed(1)} kg` : `${Math.round(kg * 1000)} g`;
export const fmtNm = (nm: number): string => `${Math.round(nm).toLocaleString('en-US')} N·m`;
export const fmtMB = (bytes: number): string => `${(bytes / 1e6).toFixed(1)} MB`;

/** Bill-of-materials lines for a subsystem (or all), filtered by a search string and the fasteners switch. */
export function filterLines(lines: readonly BomLine[], opts: { sub?: string | null; query?: string; fasteners?: 'all' | 'only' | 'none' }): BomLine[] {
  const q = (opts.query ?? '').trim().toLowerCase();
  return lines.filter((l) => {
    if (l.reference) return false;
    if (opts.sub && !l.uses.some((u) => u.sub === opts.sub)) return false;
    if (opts.fasteners === 'only' && l.category !== 'fastener') return false;
    if (opts.fasteners === 'none' && l.category === 'fastener') return false;
    if (!q) return true;
    return [l.name, l.id, l.size, l.standard, l.grade, l.material, l.function].some((s) => s.toLowerCase().includes(q));
  });
}

/** How many of a line a subsystem uses (or the whole robot). */
export const qtyIn = (l: BomLine, sub?: string | null): number =>
  sub ? (l.uses.find((u) => u.sub === sub)?.qty ?? 0) : l.qty;

/** The part ids that are fasteners (for the viewer's fastener switch). */
export const fastenerIds = (bom: Bom): Set<string> => new Set(bom.lines.filter((l) => l.category === 'fastener').map((l) => l.id));

/** The CAD model's stall faces this way (liveFollow.MODEL_TOWARD = -1): the arm stands on the car's left. */
const MODEL_ARM_ON_CARS_RIGHT = false;

// ── poses, from the twin's own code ────────────────────────────────────────

export interface PosePreset { id: string; label: string; angles: Record<string, number> }

/** A port on the near flank, rear quarter, at a typical inlet height: the IK target for the "connected" preset. */
export const SAMPLE_PORT = { along: 0.72, height: 0.7 } as const;

function chargePoses(): PosePreset[] {
  const port = { x: SAMPLE_PORT.along, y: SAMPLE_PORT.height - MOUNT_HEIGHT_M, z: FLANK_STANDOFF_M };
  const ik = solveIK(port, { x: 0, y: 0, z: -1 });
  const j = (a: { j1: number; j2: number; j3: number; j4: number; j5: number; j6: number }) =>
    ({ J1: a.j1, J2: a.j2, J3: a.j3, J4: a.j4, J5: a.j5, J6: a.j6 });
  // No "straight up" (all joints 0) preset: the flex links that carry the charge current across the joints are sized
  // for the poses the twin plays (cadFlex.test.ts), and straight up is not one of them.
  // The connected preset, with the head's CCS1 connector forward on that inlet.
  const hk = headIK(port, { x: 0, y: 0, z: -1 }, 'CCS1');
  const out: PosePreset[] = [
    { id: 'stowed', label: 'Stowed', angles: j(STOWED) },
    { id: 'connected', label: 'Connected', angles: { ...j(hk.ik), [HEAD_JOINT_NAMES.CCS1]: ARM_REACH.headStrokeM } },
    { id: 'connected_axis', label: 'Tool axis on the port, both connectors back', angles: j(ik) },
  ];
  // One preset a fleet vehicle, on this model's stall side: the base where the mate puts it, the connector the car
  // takes forward (mateSolver.solveMate, from the fleet models' own port facts).
  for (const spec of FLEET_SPECS) {
    const t = mateTarget(spec);
    if (!t) continue;
    const m = solveMate(t, MODEL_ARM_ON_CARS_RIGHT);
    if (!m.ok || !m.ik || !m.head) continue;
    out.push({
      id: `mate_${spec.key}`, label: `Connected: ${spec.name}`,
      angles: { ...j(m.ik), [BASE_JOINT_NAMES[1]]: m.slideM, [BASE_JOINT_NAMES[2]]: m.crossM, [HEAD_JOINT_NAMES[m.head]]: ARM_REACH.headStrokeM },
    });
    // and the base there with the arm still folded: the carriage travels with the arm stowed
    out.push({
      id: `base_${spec.key}`, label: `Base at the inlet, arm folded: ${spec.name}`,
      angles: { ...j(STOWED), [BASE_JOINT_NAMES[1]]: m.slideM, [BASE_JOINT_NAMES[2]]: m.crossM },
    });
  }
  return out;
}

/** The clean arm's joints as the CAD's nodes take them (buildCleanArm.poseCleanArm's mapping). */
/** The clean arm wand's sliding tubes (cad clean_arm.WAND_SLIDES; the twin draws 2): each takes a third of the reach. */
export const CLEAN_WAND_SLIDES = 3;

export function cleanAngles(q: CleanJoints): Record<string, number> {
  const E = Math.max(0, MAST_FOOT_MAX - q.foot);
  const out: Record<string, number> = {
    CA_J1: -q.t1, CA_J2: -q.t2, CA_J3: -(q.yaw - q.t1 - q.t2),
    CA_Mast2: E / 2, CA_Mast3: E / 2, CA_Pitch: q.pitch, CA_Nozzle: q.nozzle,
  };
  for (let k = 2; k <= CLEAN_WAND_SLIDES + 1; k++) out[`CA_Wand${k}`] = q.ext / CLEAN_WAND_SLIDES;
  return out;
}

function cleanPoses(): PosePreset[] {
  const sides = sidesFor(1);
  return [
    { id: 'home', label: 'Home', angles: cleanAngles(cleanJointsAt('home', 0, sides)) },
    { id: 'reach', label: 'Over side A', angles: cleanAngles(cleanJointsAt('descend_a', 1, sides)) },
    { id: 'clean', label: 'In the cabin', angles: cleanAngles(cleanJointsAt('clean_a', 0.35, sides)) },
  ];
}

/** The top air knife's lift column stages (cad wash_gantry.TOP_SLIDES): each takes a third of the lift. */
export const WASH_TOP_SLIDES = 3;

/** The wash bay's moving parts as the CAD's nodes take them, at a phase of the program played from its start. */
export function washAngles(phase: WashPhase, t: number): Record<string, number> {
  return washJoints(programPoseAt(phase, t));
}

/**
 * The wash bay's moving parts as the CAD's nodes take them, from a pose of the twin's bay: the gantry and its knives
 * (plan units -> metres), and each detail arm's carriage (metres from its dock) and six joints (radians). The east arm
 * is the CAD's 'L', the west its 'R' (the CAD's +X is west).
 */
export function washJoints(p: WashPose): Record<string, number> {
  const m = METRES_PER_PLAN_UNIT;
  const out: Record<string, number> = { GANTRY: -p.dy * m };
  for (let k = 1; k <= WASH_TOP_SLIDES; k++) out[`DRYER_TOP${k}`] = (WG.dryer.top.retractY - p.dryerTopY) * m / WASH_TOP_SLIDES;
  for (const s of ['L', 'R']) out[`DRYER_SIDE_${s}`] = (WG.dryer.side.retractX - p.dryerSideX) * m;
  p.arms.forEach((a, i) => {
    const s = i === 0 ? 'L' : 'R';
    out[`DARM_${s}_RAIL`] = a.rail - DOCK_DY_M;
    out[`DARM_${s}_J1`] = a.q.j1; out[`DARM_${s}_J2`] = a.q.j2; out[`DARM_${s}_J3`] = a.q.j3;
    out[`DARM_${s}_J4`] = a.q.j4; out[`DARM_${s}_J5`] = a.q.j5; out[`DARM_${s}_J6`] = a.q.j6;
  });
  return out;
}

function washPoses(): PosePreset[] {
  return [
    { id: 'home', label: 'Home', angles: washAngles('home', 1) },
    { id: 'jet', label: 'Wash pass', angles: washAngles('wash_1', 0.5) },
    { id: 'dry', label: 'Dry pass', angles: washAngles('dry_1', 0.45) },
    { id: 'wipe_roof', label: 'Polish the roof lidar', angles: washAngles('wipe_roof', 0.19) },
    { id: 'wipe_front', label: 'Polish the front sensors', angles: washAngles('wipe_front', 0.25) },
    { id: 'wipe_sides', label: 'Polish a side camera', angles: washAngles('wipe_sides', 0.58) },
  ];
}

export function posePresets(robot: RobotKey): PosePreset[] {
  return robot === 'charge_arm' ? chargePoses() : robot === 'clean_arm' ? cleanPoses() : washPoses();
}

// ── how each machine runs: its steps, read from the twin's phase tables ───

export interface CycleStep { id: string; label: string; seconds: number | null; note?: string }

const CHARGE_LABEL: Record<string, string> = {
  unstow: 'Lift clear of the stow', approach: 'Move to the port', align: 'Align with the cameras', insert: 'Push the connector in',
  latch: 'Lock the connector', charging: 'Charge', unlatch: 'Unlock the connector', extract: 'Pull the connector out',
  retract: 'Fold home',
};
const CLEAN_LABEL: Record<CleanPhase, string> = {
  home: 'Home', doors_open: 'The doors open', swing_a: 'Swing over side A', lower_a: 'Turn the wand down',
  descend_a: 'Lower the mast', enter_a: 'Reach in through the door', clean_a: 'Clean side A', exit_a: 'Come out of the car',
  ascend_a: 'Raise the mast', raise_a: 'Turn the wand up', swing_b: 'Swing over side B', lower_b: 'Turn the wand down',
  descend_b: 'Lower the mast', enter_b: 'Reach in through the door', clean_b: 'Clean side B', exit_b: 'Come out of the car',
  ascend_b: 'Raise the mast', raise_b: 'Turn the wand up', return: 'Swing home', doors_close: 'The doors close',
};
const WASH_LABEL: Partial<Record<WashPhase, string>> = {
  settle: 'The car stops at the bay centre', cabin_hold: 'Hold for the cabin clean. The doors stay shut',
  soak: 'Pass 1: pre-soak', wash_1: 'Pass 2: water jets', wash_2: 'Pass 3: water jets', rinse: 'Pass 4: rinse',
  dry_1: 'Pass 5: dry', dry_2: 'Pass 6: dry. The gantry stows at the entrance',
  arms_out: 'The detail arms leave their docks', wipe_front: 'Polish the front sensors', wipe_sides: 'Polish the side cameras',
  wipe_roof: 'Polish the roof lidar', wipe_rear: 'Polish the rear sensors', arms_stow: 'The detail arms go back to their docks',
  done: 'All stowed. The light turns green',
};

export function cycleSteps(robot: RobotKey): CycleStep[] {
  if (robot === 'charge_arm') {
    return NOMINAL_SEQUENCE.filter((p) => p !== 'stowed' && p !== 'clear').map((p) => ({
      id: p, label: CHARGE_LABEL[p] ?? p,
      seconds: p === 'charging' ? null : ARM_TIMING_DEFAULTS[p as keyof typeof ARM_TIMING_DEFAULTS],
      note: p === 'charging' ? 'as long as the charge' : undefined,
    }));
  }
  if (robot === 'clean_arm') {
    return CLEAN_CHAIN.map((p) => ({
      id: p, label: CLEAN_LABEL[p],
      seconds: p === 'clean_a' || p === 'clean_b' ? CLEAN_SIDE_NOMINAL_S : CLEAN_PHASE_S[p as keyof typeof CLEAN_PHASE_S],
      note: p === 'clean_a' || p === 'clean_b' ? 'the twin sets the time' : undefined,
    }));
  }
  return washChain(true).map((p) => ({
    id: p, label: WASH_LABEL[p] ?? p,
    seconds: isPass(p) ? PASS_NOMINAL_S[p] : p === 'cabin_hold' ? CABIN_HOLD_NOMINAL_S : WASH_PHASE_S[p as keyof typeof WASH_PHASE_S] ?? null,
    note: p === 'cabin_hold' ? 'a detail seat only. The twin sets the time' : undefined,
  }));
}

// ── the cycle, played on the CAD: the twin's own choreography over time ────


export interface ScriptStep { id: string; label: string; seconds: number; short?: boolean }
export interface CycleScript {
  steps: ScriptStep[];
  total: number;
  /** the joint values at `t` seconds into the cycle (wraps), and which step that is */
  at(t: number): { step: number; angles: Record<string, number> };
}

/** A step the twin times by the car (a charge, a clean, a vacuum) plays this long, marked "shown short". */
export const SHORT_STEP_S = 6;

function script(steps: ScriptStep[], anglesAt: (id: string, u: number) => Record<string, number>): CycleScript {
  const total = steps.reduce((a, s) => a + s.seconds, 0);
  const starts = steps.map((_, i) => steps.slice(0, i).reduce((a, s) => a + s.seconds, 0));
  return {
    steps, total,
    at(t: number) {
      const tt = ((t % total) + total) % total;
      let i = steps.length - 1;
      while (i > 0 && starts[i] > tt) i--;
      const u = steps[i].seconds > 0 ? Math.min(1, (tt - starts[i]) / steps[i].seconds) : 1;
      return { step: i, angles: anglesAt(steps[i].id, u) };
    },
  };
}

export function cycleScript(robot: RobotKey): CycleScript {
  if (robot === 'charge_arm') {
    const target = { port: { x: SAMPLE_PORT.along, y: SAMPLE_PORT.height - MOUNT_HEIGHT_M, z: FLANK_STANDOFF_M }, normal: { x: 0, y: 0, z: -1 } };
    const steps = cycleSteps('charge_arm').map((s) => ({ id: s.id, label: s.label, seconds: s.seconds ?? SHORT_STEP_S, short: s.seconds == null }));
    return script(steps, (id, u) => {
      const a = poseForPhase(id as Parameters<typeof poseForPhase>[0], u, target).angles;
      return { J1: a.j1, J2: a.j2, J3: a.j3, J4: a.j4, J5: a.j5, J6: a.j6 };
    });
  }
  if (robot === 'clean_arm') {
    const sides = sidesFor(1);
    const steps = cycleSteps('clean_arm').map((s) => ({
      id: s.id, label: s.label, seconds: s.note ? SHORT_STEP_S * 2 : (s.seconds ?? 1), short: !!s.note,
    }));
    return script(steps, (id, u) => cleanAngles(cleanJointsAt(id as CleanPhase, u, sides)));
  }
  const steps = cycleSteps('wash_gantry').map((s) => ({
    id: s.id, label: s.label, seconds: s.note ? SHORT_STEP_S * 2 : (s.seconds ?? 1), short: !!s.note,
  }));
  return script(steps, (id, u) => washAngles(id as WashPhase, u));
}

// ── the joints, by name, for the sliders ────────────────────────────────────

export const JOINT_LABEL: Record<string, string> = {
  J1: 'J1 base yaw', J2: 'J2 shoulder pitch', J3: 'J3 elbow pitch', J4: 'J4 forearm roll', J5: 'J5 wrist pitch', J6: 'J6 tool roll',
  CA_J1: 'J1 shoulder yaw', CA_J2: 'J2 elbow yaw', CA_J3: 'J3 mast yaw', CA_Mast2: 'Mast stage 2', CA_Mast3: 'Mast stage 3',
  CA_Pitch: 'J4 wrist pitch', CA_Wand2: 'Wand tube 2', CA_Wand3: 'Wand tube 3', CA_Wand4: 'Wand tube 4', CA_Nozzle: 'J5 nozzle pitch',
  GANTRY: 'Gantry travel', SIDE_BRUSH_L: 'Left side brush', SIDE_BRUSH_R: 'Right side brush',
  TOP_BRUSH1: 'Top brush lift stage 2', TOP_BRUSH2: 'Top brush lift stage 3', TOP_BRUSH3: 'Top brush lift stage 4',
  DRYER_TOP1: 'Top air knife lift stage 2', DRYER_TOP2: 'Top air knife lift stage 3', DRYER_TOP3: 'Top air knife lift stage 4',
  DRYER_SIDE_L: 'Left air knife', DRYER_SIDE_R: 'Right air knife',
  WAND_L_DROP1: 'Left wand stage 2', WAND_L_DROP2: 'Left wand stage 3', WAND_L_DROP3: 'Left wand stage 4',
  WAND_L_REACH1: 'Left wand reach tube 1', WAND_L_REACH2: 'Left wand reach tube 2',
  WAND_R_DROP1: 'Right wand stage 2', WAND_R_DROP2: 'Right wand stage 3', WAND_R_DROP3: 'Right wand stage 4',
  WAND_R_REACH1: 'Right wand reach tube 1', WAND_R_REACH2: 'Right wand reach tube 2',
};
