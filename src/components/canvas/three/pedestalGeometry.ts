/**
 * THE CHARGER PEDESTAL AS BOXES — one table, two consumers.
 *
 * ChargingField.tsx draws its meshes from this, and the OTTO-CHARGE ARM's
 * clearance check measures against it. That is the whole reason it exists as a
 * table rather than as literals inside the JSX: the arm is BOLTED TO this
 * cabinet, so "the arm does not pass through the charger" is only a guarantee
 * while the boxes the arm is measured against are the boxes on screen.
 *
 * They were not. placeArm() put the J1 axis on the pedestal's CENTRE, and six
 * parts of the mount and lower arm measured 0.1675 m INSIDE the drawn box for
 * the whole duty cycle. Nothing caught it because nothing compared the two —
 * exactly the defect vehicleEnvelope.ts exists to prevent for the car.
 *
 * ═══════════════════════════════════════════════════════════════ UNITS ═══════
 * PLAN UNITS, the depot renderer's own (1 unit = 0.4785 m). The arm package
 * converts once, in pedestalEnvelope.ts.
 *
 * ═══════════════════════════════════════════════════════════════ FRAME ═══════
 * The pedestal group sits at [worldX, 0, worldZ] with NO rotation, so the box
 * axes are the world axes:
 *
 *   size[0]  world X — DEPTH, toward and away from the car. The car sits at
 *            +toward * PEDESTAL_OFFSET_PU in world X, so this is the dimension
 *            that eats into the arm's working span, and the only one that does.
 *   size[1]  world Y — height. `centreY` is measured from world y = 0, which is
 *            the earth under the curb slab, NOT the asphalt deck at DECK_Y.
 *   size[2]  world Z — WIDTH, along the car. This is the visible frontage.
 *
 * Every box is centred on the pedestal axis in X and Z; only `centreY` moves.
 *
 * ══════════════════════ THE CABINET USED TO BE THE OTHER WAY ROUND ══════════
 * It was drawn 1.5 plan units DEEP toward the car and 0.7 WIDE across it — a
 * 0.718 m slab pointed at the vehicle, presenting a 0.335 m frontage barely
 * wider than its own screen. That is not what a DCFC cabinet looks like, and it
 * was expensive: depth is subtracted from the arm's span twice over, once for
 * the cabinet and once for the plinth that bolts to its face, so the arm had
 * 0.640 m to work in instead of 1.148 m. Turning the box 90 degrees — every
 * part of it, so the pad, the LED strip and the power cap keep their
 * relationship to the cabinet — gives the frontage to the car, buries the depth
 * along the kerb where nothing needs it, and returns 0.191 m of span.
 *
 * The numbers below are the SAME numbers as before with size[0] and size[2]
 * exchanged. Nothing grew or shrank; the cabinet turned.
 *
 * The screen is deliberately NOT in this table. It is a PlaneGeometry hung on
 * the cabinet's car-facing face with no thickness, so it is not a solid the arm
 * can enter — and it is on the same face the arm's plinth bolts to, which would
 * make a solid model of it collide with the mount by construction.
 */

export interface PedestalBox {
  /** Box size in plan units: [depth toward the car, height, width along the car]. */
  size: [number, number, number];
  /** Box centre height above world y = 0, plan units. */
  centreY: number;
}

/** Cabinet height, plan units — DCFC cabinets are taller than L2 bollards. */
export const pedestalH = (isDC: boolean) => (isDC ? 3.6 : 2.8);
/** Cabinet WIDTH along the car, plan units — the frontage it presents. */
export const pedestalW = (isDC: boolean) => (isDC ? 1.5 : 1.1);
/**
 * Cabinet DEPTH toward the car, plan units.
 *
 * The one dimension of the charger that costs the arm anything, which is why it
 * is named rather than buried in the table: ARM_MOUNT_OFFSET_M is half of this
 * plus half the mount plate.
 */
export const PEDESTAL_DEPTH_PU = 0.7;

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
  const D = PEDESTAL_DEPTH_PU;
  const boxes: Record<string, PedestalBox> = {
    pad: { size: [1.6, 0.16, W + 0.8], centreY: 0.08 },
    cabinet: { size: [D, H, W], centreY: H / 2 + 0.16 },
    led: { size: [0.5, 0.12, W * 0.85], centreY: H + 0.22 },
  };
  // The DCFC power cap OVERHANGS the cabinet on every side, so just above the
  // cabinet top the nearest obstacle to the arm is CLOSER than the face it is
  // bolted to, not further. Only DCFC stalls carry an arm, so this is never the
  // absent case.
  if (isDC) boxes.cap = { size: [0.85, 0.35, W + 0.25], centreY: H + 0.5 };
  return boxes;
}
