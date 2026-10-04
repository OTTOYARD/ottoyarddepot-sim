import { chargerStallFrame } from '@/lib/sitePlan';
import type { StallState } from '@/store/depotStore';

/**
 * WHEEL STOPS — where each parking stall's concrete stop sits and which way it lies.
 *
 * A wheel stop is the bumper a tyre rolls up against, so it lies ACROSS the stall:
 * long axis square to the car's own axis, parallel to the line at the stall's head.
 * Every staging stop (the perimeter runs and the temp block) used to be drawn turned
 * 90 degrees, lying ALONG the car, parallel to the stall lines: the founder's "they
 * need to be perpendicular so they act as a stopping bumper" (2026-10-04). The angled
 * charger stalls were already right and are unchanged.
 *
 * Kept out of the React component so the orientation is pinned by a test
 * (wheelStops.test.ts) rather than by eye.
 */

/** The stop's box in render units: long axis (box local +X), height, depth along the car. */
export const WHEEL_STOP_SIZE = { length: 4.6, height: 0.45, depth: 0.7 } as const;

/** Distance from the car's centre to the stop, along the car's axis: just past the wheels. */
export const WHEEL_STOP_SETBACK = 3.4;

/** Parking stalls get a stop; wash and service bays are pull-through and do not. */
export const hasWheelStop = (s: Pick<StallState, 'type'>): boolean =>
  s.type === 'staging' || s.type === 'l2' || s.type === 'dcfc';

export interface WheelStopPose {
  /** Plan position of the stop's centre. */
  x: number;
  y: number;
  /** World yaw (radians about +Y) for a box whose long axis is its local +X. */
  rotY: number;
}

export function wheelStopPose(s: Pick<StallState, 'type' | 'position'>): WheelStopPose {
  const a = s.position.angle;
  const { heading, fwd } = chargerStallFrame(a);
  // The box's local +X must lie along the car's lateral: plan (-sin h, cos h), which is
  // world (sin h, -cos h). Ry(r) sends +X to (cos r, 0, -sin r), so r = pi/2 - h. This
  // holds for every stall, angled or square.
  const rotY = Math.PI / 2 - heading;

  if (s.type === 'l2' || s.type === 'dcfc') {
    // Angled charger stalls: 3.4u ahead of the car's centre along its own axis.
    return {
      x: s.position.x + fwd.x * WHEEL_STOP_SETBACK,
      y: s.position.y + fwd.y * WHEEL_STOP_SETBACK,
      rotY,
    };
  }

  // Staging: the stop sits at the stall head, the end away from its access aisle.
  const across = a === 90 || a === 270;
  const offX = a === 270 ? -WHEEL_STOP_SETBACK
    : a === 90 ? (s.position.x < 150 ? -WHEEL_STOP_SETBACK : WHEEL_STOP_SETBACK)
    : 0;
  const offY = across ? 0 : (s.position.y < 110 ? -WHEEL_STOP_SETBACK : WHEEL_STOP_SETBACK);
  return { x: s.position.x + offX, y: s.position.y + offY, rotY };
}
