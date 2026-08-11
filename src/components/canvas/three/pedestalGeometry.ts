/**
 * THE CHARGER PEDESTAL AS BOXES — one table, two consumers.
 *
 * ChargingField.tsx draws its meshes from this, and the OTTO-CHARGE ARM's
 * clearance check measures against it. That is the whole reason it exists as a
 * table rather than as literals inside the JSX: the arm is BOLTED TO this
 * cabinet, so "the arm does not pass through the charger" is only a guarantee
 * while the boxes the arm is measured against are the boxes on screen.
 *
 * They were not. placeArm() put the J1 axis on the pedestal's CENTRE, which is
 * 0.359 m inside a cabinet drawn 0.718 m deep toward the car, and six parts of
 * the mount and lower arm measured 0.1675 m INSIDE the drawn box for the whole
 * duty cycle. Nothing caught it because nothing compared the two — exactly the
 * defect vehicleEnvelope.ts exists to prevent for the car.
 *
 * ═══════════════════════════════════════════════════════════════ UNITS ═══════
 * PLAN UNITS, the depot renderer's own (1 unit = 0.4785 m). The arm package
 * converts once, in pedestalEnvelope.ts.
 *
 * ═══════════════════════════════════════════════════════════════ FRAME ═══════
 * The pedestal group sits at [worldX, 0, worldZ] with NO rotation, so the box
 * axes are the world axes:
 *
 *   size[0]  world X — TOWARD AND AWAY FROM THE CAR. The car sits at
 *            +toward * PEDESTAL_OFFSET_PU in world X, so this is the cabinet's
 *            DEPTH along the arm's working direction, not its visible frontage.
 *   size[1]  world Y — up. `centreY` is measured from world y = 0, which is the
 *            earth under the curb slab, NOT the asphalt deck at DECK_Y.
 *   size[2]  world Z — along the car.
 *
 * Every box is centred on the pedestal axis in X and Z; only `centreY` moves.
 *
 * The screen is deliberately NOT in this table. It is a PlaneGeometry hung on
 * the cabinet's car-facing face with no thickness, so it is not a solid the arm
 * can enter — and it is on the same face the arm's plinth bolts to, which would
 * make a solid model of it collide with the mount by construction.
 */

export interface PedestalBox {
  /** Box size in plan units: [toward-the-car, up, along-the-car]. */
  size: [number, number, number];
  /** Box centre height above world y = 0, plan units. */
  centreY: number;
}

/** Cabinet height, plan units — DCFC cabinets are taller than L2 bollards. */
export const pedestalH = (isDC: boolean) => (isDC ? 3.6 : 2.8);
/** Cabinet depth toward the car, plan units. `W` in ChargingField's own terms. */
export const pedestalW = (isDC: boolean) => (isDC ? 1.5 : 1.1);

/**
 * Every solid part of one pedestal.
 *
 * Keyed rather than an array because ChargingField draws each with its own
 * material and shadow flags, and because the clearance test names the part it
 * fouls — "Base_Housing 0.1675 m inside `cabinet`" is a bug report, "inside
 * box 1" is not.
 */
export function pedestalBoxes(isDC: boolean): Record<string, PedestalBox> {
  const H = pedestalH(isDC);
  const W = pedestalW(isDC);
  const boxes: Record<string, PedestalBox> = {
    pad: { size: [W + 0.8, 0.16, 1.6], centreY: 0.08 },
    cabinet: { size: [W, H, 0.7], centreY: H / 2 + 0.16 },
    led: { size: [W * 0.85, 0.12, 0.5], centreY: H + 0.22 },
  };
  // The DCFC power cap OVERHANGS the cabinet — 1.75 plan units against 1.5 —
  // so above the cabinet top the nearest obstacle to the arm is closer, not
  // further. Only DCFC stalls carry an arm, so this is never the absent case.
  if (isDC) boxes.cap = { size: [W + 0.25, 0.35, 0.85], centreY: H + 0.5 };
  return boxes;
}
