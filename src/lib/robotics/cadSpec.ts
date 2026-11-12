/**
 * THE ROBOTS' NUMBERS, FOR THE CAD — one home, read from the twin's own specs.
 *
 * The OTTOYARD robots are drawn in the depot from parametric code: the OTTO-CHARGE ARM
 * (`ottoChargeArm/cobotSpec.ts`, `cabinetEnvelope.ts`), the OTTO-CLEAN ARM
 * (`ottoCleanArm/cleanArmSpec.ts`, `cleanArmPlacement.ts`) and the OTTO-WASH gantry
 * (`ottoWash/washSpec.ts`), against the car of `vehicleEnvelope.ts`. The engineering CAD
 * in `cad/` (CadQuery, STEP + GLB + bill of materials) must be the SAME machines, so it
 * reads its interface dimensions from `cad/spec/robots.json`, and that file is this
 * function's output, committed.
 *
 * `cadSpec.test.ts` holds the committed file equal to this function. Change a link length,
 * a mount height, a brush radius or the car, and the test fails until the snapshot is
 * rewritten and the CAD rebuilt:
 *
 *     CAD_SPEC_WRITE=1 npx vitest run src/lib/robotics/cadSpec.test.ts
 *     cad/.venv/bin/python cad/build.py
 *
 * UNITS. Everything here is METRES (the wash gantry's plan units are converted once, below,
 * with the twin's own yardstick). The CAD works in millimetres and converts on read.
 *
 * FRAMES (the CAD keeps the twin's frames, so a CAD point is a twin point):
 *   charge arm  the arm base frame: origin on J1's axis at the top of the mount collar,
 *               +Y up, +Z toward the car, X along the car.
 *   clean arm   the parked car's frame: origin at the car's centre on grade, +Y up,
 *               +X toward the nose, +Z toward the car's right flank.
 *   wash        the bay's frame: origin at the parked car's centre on grade, +Y up,
 *               X across the bay, +Z = -dy (south, toward the entry door).
 */
import {
  ARM_SCALE, FLANK_STANDOFF_M, JOINT_NAMES, METRES_PER_PLAN_UNIT, MOUNT_HEIGHT_M, OTTO_CHARGE_ARM,
  PEDESTAL_TO_CAR_CENTRE_M, SERVICE_WINDOW,
} from '@/lib/ottoChargeArm/cobotSpec';
import { STOWED } from '@/lib/ottoChargeArm/cobotIK';
import {
  ARM_MOUNT_PU, CABINET_BACKSET_PU, DCFC_CABINET_PU, MOUNT_PLATE_UNDERSIDE_M,
} from '@/lib/ottoChargeArm/cabinetEnvelope';
import {
  BODY_ROOF_M, CABIN, CAR_LENGTH_M, CAR_WIDTH_M, DOOR, ROOF_POD, WHEEL_RADIUS_M,
} from '@/lib/ottoChargeArm/vehicleEnvelope';
import {
  CLEAN_ARM, CLEAN_PHASE_S, MAST_FOOT_MAX, MAST_FOOT_MIN, PIVOT_Y_MAX, PIVOT_Y_MIN, WAND_RETRACTED,
} from '@/lib/ottoCleanArm/cleanArmSpec';
import { cleanJointsAt, sidesFor } from '@/lib/ottoCleanArm/cleanArmPose';
import {
  CANOPY_EAVE_U, CANOPY_HALF_U, CANOPY_RIDGE_U, HEADER_DEPTH_U, HEADER_PURLINS_U, HEADER_WIDTH_U,
  PURLIN_UNDERSIDE_U, canopyRoofAt,
} from '@/lib/ottoCleanArm/cleanArmPlacement';
import { DECK_Y } from '@/components/canvas/three/coordUtils';
import {
  PASS_NOMINAL_S, WASH_GANTRY, WASH_HOME_DY, WASH_PHASE_S, WASH_TRAVEL,
} from '@/lib/ottoWash/washSpec';

const M = METRES_PER_PLAN_UNIT;
/** Round to 0.1 mm, so the snapshot is stable across float noise and readable. */
const r4 = (v: number): number => Math.round(v * 1e4) / 1e4;
const mm = (u: number): number => r4(u * M);

/** A car's centre stands this far out from its canopy's spine (sitePlan's charger columns). */
export const NOMINAL_STALL_OFFSET_U = 7;

export function cadSpec() {
  const s = OTTO_CHARGE_ARM;
  const headerBottomU = canopyRoofAt(NOMINAL_STALL_OFFSET_U) - PURLIN_UNDERSIDE_U - HEADER_DEPTH_U;
  const columnBottomM = CLEAN_ARM.link1Y + CLEAN_ARM.j1.h / 2 + 0.05;
  const G = WASH_GANTRY;
  return {
    version: 1,
    units: 'metres',
    yardstick_m_per_plan_unit: M,
    chargeArm: {
      armScale: ARM_SCALE,
      shoulderHeight: r4(s.shoulderHeight),
      shoulderOffset: r4(s.shoulderOffset),
      upperArm: r4(s.upperArm),
      forearm: r4(s.forearm),
      wrist: r4(s.wrist),
      tool: r4(s.tool),
      radii: Object.fromEntries(Object.entries(s.radii).map(([k, v]) => [k, r4(v)])),
      limits: Object.fromEntries(Object.entries(s.limits).map(([k, v]) => [k, v.map(r4)])),
      jointNames: [...JOINT_NAMES],
      stowed: Object.fromEntries(Object.entries(STOWED).map(([k, v]) => [k, r4(v)])),
      mountHeight: MOUNT_HEIGHT_M,
      mountPlateUnderside: MOUNT_PLATE_UNDERSIDE_M,
      pedestalToCarCentre: r4(PEDESTAL_TO_CAR_CENTRE_M),
      flankStandoff: r4(FLANK_STANDOFF_M),
      serviceWindow: {
        alongMin: SERVICE_WINDOW.alongMin, alongMax: SERVICE_WINDOW.alongMax,
        heightMin: SERVICE_WINDOW.heightMin, heightMax: SERVICE_WINDOW.heightMax,
      },
      cabinet: {
        width: mm(DCFC_CABINET_PU.width), height: mm(DCFC_CABINET_PU.height), depth: mm(DCFC_CABINET_PU.depth),
        padHeight: mm(DCFC_CABINET_PU.padHeight), backset: mm(CABINET_BACKSET_PU),
      },
      armMount: {
        riser: mm(ARM_MOUNT_PU.riser), bridge: mm(ARM_MOUNT_PU.bridge), padFront: mm(ARM_MOUNT_PU.padFront),
        top: mm(ARM_MOUNT_PU.top),
      },
    },
    cleanArm: {
      mountX: CLEAN_ARM.mountX,
      link1Y: CLEAN_ARM.link1Y,
      link2Drop: CLEAN_ARM.link2Drop,
      link1: { ...CLEAN_ARM.link1 },
      link2: { ...CLEAN_ARM.link2 },
      j1: { ...CLEAN_ARM.j1 },
      j2: { ...CLEAN_ARM.j2 },
      column: { ...CLEAN_ARM.column },
      mast: { ...CLEAN_ARM.mast, sections: [...CLEAN_ARM.mast.sections] },
      pivotBelowFoot: CLEAN_ARM.pivotBelowFoot,
      wrist: { ...CLEAN_ARM.wrist },
      wand: { ...CLEAN_ARM.wand },
      nozzle: { ...CLEAN_ARM.nozzle },
      pivotZ: r4(CLEAN_ARM.pivotZ),
      limits: {
        j2: CLEAN_ARM.limits.j2.map(r4), pitch: CLEAN_ARM.limits.pitch.map(r4), nozzle: CLEAN_ARM.limits.nozzle.map(r4),
      },
      mastFootMax: r4(MAST_FOOT_MAX),
      mastFootMin: r4(MAST_FOOT_MIN),
      pivotYMax: r4(PIVOT_Y_MAX),
      pivotYMin: r4(PIVOT_Y_MIN),
      wandRetracted: r4(WAND_RETRACTED),
      phaseSeconds: { ...CLEAN_PHASE_S },
      /** the twin's home (stowed) pose, from its own choreography: cleanJointsAt('home', 0, sidesFor(+1)) */
      home: Object.fromEntries(Object.entries(cleanJointsAt('home', 0, sidesFor(1))).map(([k, v]) => [k, r4(v)])),
      canopy: {
        ridge: mm(CANOPY_RIDGE_U), eave: mm(CANOPY_EAVE_U), half: mm(CANOPY_HALF_U),
        purlins: HEADER_PURLINS_U.map(mm), purlinUnderside: mm(PURLIN_UNDERSIDE_U),
        headerDepth: mm(HEADER_DEPTH_U), headerWidth: mm(HEADER_WIDTH_U),
        nominalStallOffset: mm(NOMINAL_STALL_OFFSET_U),
        /** the header's underside at J1 over a nominal stall, metres above the deck */
        headerBottomAboveDeck: mm(headerBottomU - DECK_Y),
        /** the drop column's foot, metres above the deck (cleanArmPlacement.columnBottom) */
        columnBottomAboveDeck: r4(columnBottomM),
      },
    },
    wash: {
      travel: { north: mm(WASH_TRAVEL.north), south: mm(WASH_TRAVEL.south) },
      homeDy: mm(WASH_HOME_DY),
      gantry: {
        legX: mm(G.legX),
        leg: { w: mm(G.leg.w), d: mm(G.leg.d), dy: mm(G.leg.dy), top: mm(G.leg.top) },
        trolley: { w: mm(G.trolley.w), d: mm(G.trolley.d), h: mm(G.trolley.h) },
        beam: { y0: mm(G.beam.y0), y1: mm(G.beam.y1), dy0: mm(G.beam.dy0), dy1: mm(G.beam.dy1) },
        rail: { w: mm(G.rail.w), h: mm(G.rail.h), from: mm(G.rail.from), to: mm(G.rail.to) },
        arch: { dy: mm(G.arch.dy), x: mm(G.arch.x), top: mm(G.arch.top), r: mm(G.arch.r), nozzles: G.arch.nozzles },
        dryer: {
          dy: mm(G.dryer.dy),
          top: {
            halfLen: mm(G.dryer.top.halfLen), d: mm(G.dryer.top.d), h: mm(G.dryer.top.h),
            gap: mm(G.dryer.top.gap), retractY: mm(G.dryer.top.retractY),
          },
          side: {
            w: mm(G.dryer.side.w), d: mm(G.dryer.side.d), y0: mm(G.dryer.side.y0), y1: mm(G.dryer.side.y1),
            gap: mm(G.dryer.side.gap), retractX: mm(G.dryer.side.retractX),
          },
        },
        wipe: {
          dy: mm(G.wipe.dy), parkX: mm(G.wipe.parkX), stowY: mm(G.wipe.stowY), padR: mm(G.wipe.padR), padT: mm(G.wipe.padT),
          forearm: mm(G.wipe.forearm), mastR: mm(G.wipe.mastR),
        },
        light: { y: mm(G.light.y), x: mm(G.light.x) },
      },
      passSeconds: { ...PASS_NOMINAL_S },
      phaseSeconds: { ...WASH_PHASE_S },
    },
    car: {
      length: r4(CAR_LENGTH_M),
      width: r4(CAR_WIDTH_M),
      roof: BODY_ROOF_M,
      roofPod: { ...ROOF_POD },
      wheelRadius: WHEEL_RADIUS_M,
      door: { ...DOOR },
      cabin: { ...CABIN },
    },
  };
}

export type CadSpec = ReturnType<typeof cadSpec>;
