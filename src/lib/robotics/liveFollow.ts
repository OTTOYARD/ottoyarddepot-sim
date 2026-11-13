// liveFollow — one running robot's pose, as the engineering model's joint values.
//
// The Robotics tab's model can follow a robot in the depot. The pose is not a second evaluation: it is the session the
// yard draws (TwinMotionDriver.armSessionAt, cleanSessionAt, washSessionAt) through the pose code the yard uses
// (poseFor, cleanSessionJoints, washPoseAt), so the model and the yard cannot disagree about what a machine is doing.
// This file decides nothing. Pure: no React, no stores.
//
// THE MODEL STANDS ON ONE SIDE. The CAD is drawn as one arm beside one car (catalog.SAMPLE_PORT's frame: the port at
// +x). Half the depot's arms are that arm, and the other half are its mirror image. A followed arm is posed in the
// model's frame with its own car's port (how far along the car, how high), so every joint moves as that arm's does and
// a mirrored arm reads as its mirror. The 3D yard also limits how fast a drawn joint may turn. The model does not: it
// shows the solved pose.
import { STOWED } from '@/lib/ottoChargeArm/cobotIK';
import { portInArmFrame } from '@/lib/ottoChargeArm/depotPlacement';
import { isArmHome, type ArmSession } from '@/lib/ottoChargeArm/roboticService';
import { CAR_WIDTH_M } from '@/lib/ottoChargeArm/vehicleEnvelope';
import { sidesFor } from '@/lib/ottoCleanArm/cleanArmPose';
import { cleanSessionJoints, type CleanSession } from '@/lib/ottoCleanArm/cleanSession';
import { washPoseAt } from '@/lib/ottoWash/washPose';
import type { WashSession } from '@/lib/ottoWash/washSession';
import { chargeModelAngles, cleanAngles, cycleSteps, washJoints, type RobotKey } from './catalog';

/** The side the model stands on: catalog.SAMPLE_PORT puts the port at +x, which is portInArmFrame's toward = -1. */
export const MODEL_TOWARD = -1 as const;
const MODEL_SIDES = sidesFor(1); // catalog's clean-arm presets and cycle use the same

export type LiveSession = ArmSession | CleanSession | WashSession;

/** Where a car's charge port is on its flank (chargePort.portFor): metres along the car and above the ground. */
export interface PortAt { along: number; height: number }

/** The charge arm's six joints for this session. With no port known the arm has nothing to reach to: it reads stowed. */
export function chargeLiveAngles(s: Pick<ArmSession, 'phase' | 't'>, port: PortAt | null): Record<string, number> {
  if (!port || isArmHome(s.phase)) return { J1: STOWED.j1, J2: STOWED.j2, J3: STOWED.j3, J4: STOWED.j4, J5: STOWED.j5, J6: STOWED.j6 };
  return chargeModelAngles(s.phase as Parameters<typeof chargeModelAngles>[0], s.t, portInArmFrame(port.along, port.height, CAR_WIDTH_M / 2, MODEL_TOWARD));
}

export const cleanLiveAngles = (s: CleanSession): Record<string, number> => cleanAngles(cleanSessionJoints(s, MODEL_SIDES));
export const washLiveAngles = (s: WashSession): Record<string, number> => washJoints(washPoseAt(s));

/** A robot at rest: the charge arm stowed (or clear of a car that left), the other two at home. */
export function isAtRest(robot: RobotKey, phase: string): boolean {
  return robot === 'charge_arm' ? isArmHome(phase as ArmSession['phase']) : phase === 'home';
}

const REST_WORD: Record<RobotKey, string> = { charge_arm: 'Stowed', clean_arm: 'Home', wash_gantry: 'Home' };

/** A phase in the words the tab's step list uses (catalog.cycleSteps), so the live line and the list agree. */
export function phaseLabel(robot: RobotKey, phase: string): string {
  if (isAtRest(robot, phase)) return REST_WORD[robot];
  return cycleSteps(robot).find((s) => s.id === phase)?.label ?? phase.replace(/_/g, ' ');
}

/** "Fast charger 07", "Wash bay 02": the renderer's stall id, in words. */
export function unitLabel(robot: RobotKey, id: string): string {
  const n = id.match(/(\d+)\s*$/)?.[1];
  const what = robot === 'wash_gantry' ? 'Wash bay' : 'Fast charger';
  return n ? `${what} ${n.padStart(2, '0')}` : `${what} ${id}`;
}

export interface LiveUnit {
  /** the renderer's stall or bay id: the key the motion driver's sessions use */
  id: string;
  label: string;
  phase: string;
  phaseLabel: string;
  /** not at rest */
  working: boolean;
  /** the car it serves, by its fleet name, or null */
  car: string | null;
}

export function liveUnit(robot: RobotKey, id: string, s: Pick<LiveSession, 'phase' | 'vehicleId'> & { held?: boolean }, carName: (vehicleId: string) => string | null): LiveUnit {
  return {
    // a cleaning arm that found an item in the cabin stands still until an attendant secures it (otto-q-core 0814)
    id, label: unitLabel(robot, id), phase: s.phase, phaseLabel: s.held ? 'Stopped. An item is in the cabin' : phaseLabel(robot, s.phase),
    working: !isAtRest(robot, s.phase), car: s.vehicleId ? carName(s.vehicleId) : null,
  };
}

/** Robots that work first, then by label: the list a viewer picks from. */
export function sortUnits(units: readonly LiveUnit[]): LiveUnit[] {
  return [...units].sort((a, b) => Number(b.working) - Number(a.working) || a.label.localeCompare(b.label));
}

/** One line for the viewer: what the followed robot does now. */
export function followLine(u: LiveUnit): string {
  return `${u.label}: ${u.phaseLabel}${u.car && u.working ? ` · ${u.car}` : ''}`;
}
