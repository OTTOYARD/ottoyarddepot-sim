// ============================================================================
// machineFacts — the depot's robots in the words of an operator and of an owner.
//
// Chase, 2026-11-09: "Pulse should have depot/operator level info on the functionality of the machines (not
// necessarily CAD-level, but functionality and facts). Orchestra needs just user/asset/vehicle owner detail from a
// stall or stage perspective. ... I think just the twin needs the CAD level detail."
//
// The twin keeps the engineering model (the Robotics tab). OTTO-PULSE and OrchestrAV carry one small file,
// public/cad/robot-facts.json, built HERE from the same sources the tab reads: the parts lists' subsystem texts
// (cad/build.py), the twin's phase tables and its robot specs. So a machine's summary, its steps and its numbers are
// the same in the three apps, and a change to the CAD or to a phase table changes the file (machineFacts.test.ts
// fails until it is written again and copied to the two cockpits).
//
// Copy is ASD-STE100 (AGENTS.md): short sentences, active voice, no semicolons. No product names.
// ============================================================================
import { ARM_TIMING_DEFAULTS } from '@/lib/ottoChargeArm/armStateMachine';
import { CLEAN_MOTION_S, CLEAN_SIDE_NOMINAL_S } from '@/lib/ottoCleanArm/cleanArmSpec';
import { PASSES_NOMINAL_S, WIPE_FIXED_S } from '@/lib/ottoWash/washSpec';
import { SENSORS } from '@/lib/ottoWash/detailArm';
import { FUNCTIONS, ROBOT_INFO, ROBOT_KEYS, cycleSteps, type Bom, type BomSubsystem, type RobotKey } from './catalog';

export interface MachineStep { id: string; label: string; seconds: number | null; note?: string }
export interface MachineFact { label: string; value: string }

export interface MachineFacts {
  key: RobotKey;
  /** OTTO-CHARGE ARM */
  name: string;
  /** Charge arm */
  short: string;
  /** the twin layout's stall type that has one of these */
  stallType: 'dcfc' | 'wash_bay';
  /** One at each fast charger. */
  where: string;
  /** what it is and what it does, for the depot's crew */
  summary: string[];
  /** what an owner needs to know about its car and this machine */
  owner: string[];
  /** the robotic functions it does (the twin's own list) */
  functions: string[];
  /** OTTO-Q's service names this machine does (ottoq_visit_needs atoms' svc) */
  services: string[];
  /** how it runs, from the twin's phase tables */
  steps: MachineStep[];
  facts: MachineFact[];
  safety: string[];
}

export interface RobotFacts {
  version: 1;
  /** where this file is built, for the copies the cockpits carry */
  source: { repo: string; file: string; builtBy: string };
  /** seconds of arm motion to connect, and to release (the twin's shipped defaults; the engine serves the live values) */
  chargeArm: { connectSeconds: number; releaseSeconds: number };
  machines: MachineFacts[];
}

/** The distance every part of the cleaning arm keeps from the car and its open doors, metres (cadYard.test.ts). */
export const CLEAN_ARM_CLEARANCE_M = 0.1;

const one = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const minutes = (s: number): string => `${one(Math.round(s / 6) / 10)} min`;

/** A subsystem of a robot's parts list, or a clear error: a fact must not quote a subsystem that is gone. */
function sub(bom: Bom, id: string): BomSubsystem {
  const s = bom.subsystems.find((x) => x.id === id);
  if (!s) throw new Error(`machineFacts: ${bom.robot} has no subsystem ${id}`);
  return s;
}
/** The subsystem's own sentence that matches, word for word. */
function how(bom: Bom, id: string, re: RegExp): string {
  const line = sub(bom, id).how.find((h) => re.test(h));
  if (!line) throw new Error(`machineFacts: ${bom.robot} ${id} has no line matching ${re}`);
  return line;
}
function spec(bom: Bom, id: string, key: string): string {
  const v = sub(bom, id).specs[key];
  if (!v) throw new Error(`machineFacts: ${bom.robot} ${id} has no spec "${key}"`);
  return v;
}
/** A fact written here in plainer words still rests on the parts list: fail when its source sentence is gone. */
function rests(bom: Bom, id: string, re: RegExp): void {
  const s = sub(bom, id);
  if (!re.test(s.function) && !s.how.some((h) => re.test(h))) {
    throw new Error(`machineFacts: ${bom.robot} ${id} no longer says ${re}`);
  }
}
const functionsOf = (k: RobotKey): string[] => FUNCTIONS.filter((f) => f.robot === k).map((f) => f.label);
const stepsOf = (k: RobotKey): MachineStep[] => cycleSteps(k).map((s) => ({ ...s }));

function chargeArm(bom: Bom, connect: number, release: number): MachineFacts {
  const k: RobotKey = 'charge_arm';
  return {
    key: k, name: ROBOT_INFO[k].name, short: ROBOT_INFO[k].short, stallType: 'dcfc',
    where: 'One at each fast charger.',
    summary: [...ROBOT_INFO[k].summary],
    owner: [
      'A robot arm plugs your car in and unplugs it. No person handles the cable.',
      'The arm measures the force on every move. A small error cannot jam the connector.',
      'Your car cannot move until the arm is home.',
    ],
    functions: functionsOf(k),
    services: ['charge'],
    steps: stepsOf(k),
    facts: [
      { label: 'Connector', value: spec(bom, 'TOOL', 'connector') },
      { label: 'Charge current', value: `${spec(bom, 'DRESS', 'current')}, liquid-cooled at the connector` },
      { label: 'Time to connect', value: `${one(connect)} s of arm motion` },
      { label: 'Time to release', value: `${one(release)} s of arm motion` },
      { label: 'Finds the port', value: how(bom, 'TOOL', /cameras/) },
      { label: 'Force control', value: `${how(bom, 'TOOL', /force and torque sensor/)} ${how(bom, 'TOOL', /compliance unit/)}` },
      { label: 'Latch', value: how(bom, 'TOOL', /latch locks/) },
      { label: 'Power path', value: `The charge current runs inside the arm. ${how(bom, 'DRESS', /Nothing live is in the open\.$/)} ${how(bom, 'DRESS', /booted link of braided copper joins/)}` },
      { label: 'Status lights', value: 'Light rings on the arm show its state: teal ready, amber moving, green charging, red fault.' },
    ],
    safety: [
      `${how(bom, 'SAFETY', /laser scanner/)} A person in its field stops the arm.`,
      how(bom, 'SAFETY', /emergency stop/),
      'OTTO-Q does not move a car while an arm is connected to it.',
      'When a charger has a fault, the arm lets the car go at once. OTTO-Q sends the car to another charger.',
    ],
  };
}

function cleanArm(bom: Bom): MachineFacts {
  const k: RobotKey = 'clean_arm';
  const cycle = 2 * CLEAN_SIDE_NOMINAL_S + CLEAN_MOTION_S;
  const reach = spec(bom, 'WAND', 'reach').match(/[\d.]+/g)?.map(Number) ?? [];
  if (reach.length !== 2) throw new Error('machineFacts: the wand reach is not "base + extension"');
  rests(bom, 'STATUS', /ring on the J1 base, a strip on the mast and a ring at the nozzle/);
  rests(bom, 'MAST', /brake holds it when power is off/);
  rests(bom, 'MOUNT', /Nothing stands where a car drives/);
  return {
    key: k, name: ROBOT_INFO[k].name, short: ROBOT_INFO[k].short, stallType: 'dcfc',
    where: 'One over each fast charger.',
    summary: [
      ...ROBOT_INFO[k].summary,
      'The doors open. The arm cleans one side, then the other side. Then the doors close.',
    ],
    owner: [
      'An overhead arm vacuums the cabin of your car while it charges.',
      'Only the wand goes into the car, and only through an open door.',
      `Every part of the arm keeps ${CLEAN_ARM_CLEARANCE_M.toFixed(2)} m off the bodywork and the open doors.`,
      'Your car stays at its charger until the arm is home.',
    ],
    functions: functionsOf(k),
    services: ['interior_tidy', 'interior_deep_clean'],
    steps: stepsOf(k),
    facts: [
      { label: 'Nozzle head', value: sub(bom, 'NOZZLE').function },
      { label: 'Time for a clean', value: `About ${Math.round(cycle / 60)} min: ${minutes(CLEAN_SIDE_NOMINAL_S)} on each side, and the moves between. The twin sets the time.` },
      { label: 'Reach', value: `The wand reaches ${(reach[0] + reach[1]).toFixed(2)} m into the cabin.` },
      { label: 'Mast', value: sub(bom, 'MAST').function },
      { label: 'Clearance', value: `${CLEAN_ARM_CLEARANCE_M.toFixed(2)} m off the car and the open doors, at every point of the cycle.` },
      { label: 'Vacuum supply', value: how(bom, 'VAC', /central vacuum producer/) },
      { label: 'Crew', value: 'The arm needs no technician.' },
      { label: 'Status lights', value: 'Lights on the base, the mast and the nozzle show the arm state.' },
    ],
    safety: [
      'The arm swings above the roof. Nothing stands where a car drives.',
      'The car stays on its stall until the arm is home.',
      'A brake holds the mast when power is off.',
      'A charger fault lets the car go at once. The arm at the next charger does the clean.',
    ],
  };
}

function washMachine(bom: Bom): MachineFacts {
  const k: RobotKey = 'wash_gantry';
  return {
    key: k, name: ROBOT_INFO[k].name, short: ROBOT_INFO[k].short, stallType: 'wash_bay',
    where: 'One in each wash bay.',
    summary: [...ROBOT_INFO[k].summary],
    owner: [
      'A machine washes your car in the wash bay. No brush touches the car.',
      'It moves over the parked car 6 times: pre-soak, 2 water-jet passes, rinse and 2 dry passes.',
      'The machine then stows at the entrance. 2 robot arms come down their tracks, one each side of the car.',
      'They polish each camera, lidar and radar cover with a soft pad. The doors stay shut.',
    ],
    functions: functionsOf(k),
    services: ['exterior_wash', 'sensor_clean'],
    steps: stepsOf(k),
    facts: [
      { label: 'Passes', value: `6 passes in about ${minutes(PASSES_NOMINAL_S)}: pre-soak, 2 water-jet passes, rinse, 2 dry passes.` },
      { label: 'Touch', value: 'No brush. Only the soft pads touch the car, and only on its sensors.' },
      { label: 'Sensor polish', value: `${sub(bom, 'POLISH').function} The 2 arms do ${SENSORS[1].length + SENSORS[-1].length} places in about ${minutes(WIPE_FIXED_S)}.` },
      { label: 'Detail arms', value: `2 six-axis arms, one each side of the car. ${sub(bom, 'WRIST').function} ${how(bom, 'WRIST', /meet at one point/)}` },
      { label: 'Pad', value: `${how(bom, 'POLISH', /microfibre/)} ${how(bom, 'WRIST', /quarter turn/)}` },
      { label: 'Push', value: `${how(bom, 'POLISH', /force sensor/)} ${how(bom, 'POLISH', /floating joint/)}` },
      { label: 'Finds each sensor', value: how(bom, 'POLISH', /camera beside the pad/) },
      { label: 'Arm tracks', value: `${sub(bom, 'TRACK').function} Travel: ${spec(bom, 'TRACK', 'travel')}.` },
      { label: 'Pad care', value: `${sub(bom, 'DOCK').function} ${how(bom, 'DOCK', /rinses the pad/)}` },
      { label: 'Doors', value: 'The doors stay shut in the wash bay. The cabin is cleaned at the fast charger.' },
      { label: 'Spray arch', value: `${sub(bom, 'ARCH').function} ${how(bom, 'ARCH', /nozzles/)}` },
      { label: 'Air knives', value: `${sub(bom, 'DRYER').function} Blowers: ${spec(bom, 'DRYER', 'blowers')}.` },
      { label: 'Travel speed', value: spec(bom, 'TRAVEL', 'speed') },
      { label: 'Stop light', value: how(bom, 'CONTROL', /stop light/) },
      { label: 'Supply', value: how(bom, 'CONTROL', /drag chain brings/).split('. ').slice(0, 2).join('. ').replace(/\.?$/, '.') },
      { label: 'Clear height', value: spec(bom, 'PORTAL', 'clear height') },
    ],
    safety: [
      sub(bom, 'PORTAL').function.split('. ').slice(-1)[0],
      'The machine never moves over the car with a tool still on it.',
      'The gantry and the arms never work at the same time. Each waits at its own end of the bay.',
      how(bom, 'DOCK', /never under the gantry/),
      'An arm stops its push at 10 N. If a wash ends early, each pad backs straight off the car.',
      'No joint of an arm is hurried, even when a wash ends early.',
      how(bom, 'RAILS', /stop at each rail end/),
      'The car leaves only when the light is green.',
    ],
  };
}

/** The facts file, from the three parts lists and the twin's own tables. Pure: the same inputs give the same file. */
export function buildRobotFacts(boms: Record<RobotKey, Bom>): RobotFacts {
  const t = ARM_TIMING_DEFAULTS;
  const connect = t.unstow + t.approach + t.align + t.insert + t.latch;
  const release = t.unlatch + t.extract + t.retract;
  for (const k of ROBOT_KEYS) if (boms[k]?.robot !== k) throw new Error(`machineFacts: no parts list for ${k}`);
  return {
    version: 1,
    source: { repo: 'OTTOYARD/ottoyarddepot-sim', file: 'public/cad/robot-facts.json', builtBy: 'src/lib/robotics/machineFacts.ts' },
    chargeArm: { connectSeconds: connect, releaseSeconds: release },
    machines: [chargeArm(boms.charge_arm, connect, release), cleanArm(boms.clean_arm), washMachine(boms.wash_gantry)],
  };
}

/** The file's text as it is committed: 1-space JSON and a final newline. */
export const robotFactsText = (f: RobotFacts): string => `${JSON.stringify(f, null, 1)}\n`;
