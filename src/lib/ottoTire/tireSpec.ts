/**
 * OTTO-TIRE: the robotic wheel service in each service bay (docs/OTTO-TIRE.md).
 *
 * Chase, 2026-11-17: "I think we need robotic arms for service bays. Maybe just drill and arms to get tire off and on
 * and place tires or rack? Arms can probably be on rails again. Places old tires on one rack, grabs new tires from
 * separate rack. Sliding back and forth. ... integrate a tool/head that accounts for screws/nuts that come off of the
 * vehicle, and then have to be reapplied and tightened back on. It probably needs some kind of camera input as well ...
 * The lift can be automated when vehicles pull in."
 *
 * WHAT IS IN A BAY (all of it designed here and drawn by cad/otto_cad/robots/tire_bay.py from these numbers):
 *   1. THE LIFT. An in-ground twin-post lift: 2 rams in casings in the floor on the drive line. Each ram's saddle
 *      carries 2 arms that swing out under the car and slide to its own lift points, each arm a pad with a load cell
 *      and a camera. Lowered, the saddles and arms lie flush in the floor and the car drives over them. The rams lift
 *      the car 0.50 m for the robots, or 1.85 m for a person to work under it. The car stands on mechanical locks,
 *      never on the oil, while anything works at it.
 *   2. THE PORTAL. A frame on 2 floor rails along the bay's side walls, the OTTO-WASH layout. It slides along the bay
 *      over the car, from the NEW racks at the entrance (south) to the OLD racks at the exit (north).
 *   3. TWO WHEEL ROBOTS on the portal's beam, one each side of the car. Each is a trolley on the beam (across the bay), a
 *      slew (it turns to face the car or the racks), a vertical axis (a beam that slides in a guide hanging under the
 *      slew), a tilt (the wheel's camber) and the wheel head.
 *   4. THE WHEEL HEAD. Two powered rollers that close on the tyre's tread below its centre and hold the wheel by its
 *      shape, 5 nutrunner spindles on a pitch circle that the head sets and turns to the nuts, a suction tool for an aero
 *      cover, a 3D camera and a camera on the spindles' axis. Each spindle keeps its own nut (or bolt) in its socket from
 *      the moment it comes off the hub until it is back on and tight: no nut is ever loose in the bay.
 *   5. THE RACKS. Each side: NEW wheels at the entrance end, OLD wheels at the exit end, 2 floor-level cradles each, so a
 *      person rolls a wheel in or out and never lifts one. Beside the OLD racks, a socket rack holds the head's second
 *      socket set (17 mm, for a car with wheel bolts) and takes the first while the second is on.
 *   6. THE CABINETS. The bay's control cabinet and the lift's power unit on the north wall, the portal's drive cabinet on
 *      its west leg, and the supply chain beside the west rail.
 *
 * Why a portal and not 2 arms on floor tracks (the first study, docs/OTTO-TIRE.md "Choices"): a wheel and its head are
 * about 160 kg, past what the OTTO-CHARGE ARM's arm carries, and a robot that faces the car to work and the racks to
 * store needs to turn round between them. On a floor track beside the car that turn swept 1.3 to 1.5 m and did not fit
 * the 4.21 m from the drive line to the partition with racks behind it. Hung from a trolley, the mast's axis stands at the
 * head's own centre and the turn sweeps 0.82 m, the floor stays clear for a person to walk round the car, and nothing
 * stands in the car's path.
 *
 * FRAME (the CAD's, a world-axis frame like OTTO-WASH's): the bay's. Origin at the bay's LIFT MARK on the floor: the
 * drive line at plan y BAY_STALL_Y, where OTTO-Q stops each car's AXLE MIDPOINT (its body centre then stands 0 to 95 mm
 * north of it, by model). +Y up, +X WEST (world x = 150 - plan x), +Z NORTH (toward the exit door). METRES throughout.
 * The WEST robot is 'W' (its side +X), the EAST robot 'E'. The cars enter through the south door and stop facing north.
 *
 * UNITS: metres, radians, seconds (sim).
 */
const r4 = (v: number): number => Math.round(v * 1e4) / 1e4;

// ═════════════════════════════════════════════════════════════════════════════ THE BAY ═══
// The service bays as the site plan builds them, and the half of either bay the machine is designed for, are TIRE_BAY in
// tireBayFit.ts: this file reads nothing from the site plan, so the site plan can read the machine's footprint from it
// (structurePlan.tireBaySolids) with no import cycle.

// ═══════════════════════════════════════════════════════════════════════════ THE PORTAL ═══
export const PORTAL = {
  /** each floor rail's centreline from the drive line: outside the door opening (2.63 m) and the racks, 0.46 m off the partition */
  railX: 3.55,
  /** the rails' ends (Z) */
  railFrom: -4.85, railTo: 4.85,
  /** the beam's centreline travels this far (PORTAL joint, Z): from the NEW racks' far cradle to the OLD racks' far cradle */
  travelFrom: -4.25, travelTo: 4.25,
  /** where it waits for a car: at the exit end, its beam over the OLD racks, so the car drives in under nothing */
  park: 4.25,
  /** the beam's underside and depth: 0.66 m over the tallest fleet car's roof on the lift at service height (2.44 m) */
  beamUnder: 3.10, beamDepth: 0.46, beamWidth: 0.34,
  /** each leg (X x Z) and its end truck on the rail (its box's width, length and height, and its top above the floor: it
   *  rides 2 blocks on a rail beam, so its underside is 0.203 m up) */
  legW: 0.24, legD: 0.30, truckL: 0.86, truckW: 0.40, truckH: 0.22, truckTop: 0.423,
  /** travel speed and acceleration (class, ASSUMPTION): a gantry robot of this size */
  mps: 1.0, mps2: 1.0,
} as const;

// ═════════════════════════════════════════════════════════════════════════ THE ROBOTS ═══
export const TROLLEY = {
  /** the mast's axis from the drive line (TB_TROL_W / TB_TROL_E, metres): its whole run on the beam */
  from: 1.10, to: 2.90,
  /** where it waits: outside the door opening's edge with the head turned to the car and raised */
  park: 2.40,
  mps: 0.8,
} as const;

export const SLEW = {
  /** 0: the head faces the car (inboard). pi: it faces the wall (the racks, the cover nest). Limits, rad. */
  from: -0.17, to: Math.PI + 0.17,
  /**
   * A robot turns only with its trolley at TURN_TROL (tireProgram.ts) or further out, and with its head's axis at or below
   * this height: then its sweep (SLEW_SWEEP, 0.83 m) stays 0.15 m off the widest car's body, and its top stays under every
   * fleet car's door mirror on the lift (the lowest mirror's underside is 1.5 m up at service height).
   */
  maxHeadY: 0.90,
} as const;

/**
 * THE VERTICAL AXIS: a guide frame hangs under the slew plate (it turns with the slew), and a Z-beam slides in its guide
 * blocks; the tilt and the head hang from the Z-beam's foot. One stage, a rack and pinion, 0.65 m of stroke: the head
 * works between a racked wheel's centre (0.44 m) and a little over the wheels on the lift (0.80 to 0.83 m). It never
 * needs to be higher: it turns at the wheels' own height, and the cover nest is at that height. The beam is 1.30 m long,
 * so its top stays 0.14 m under the slew plate at the top of the stroke (the slip ring's lines leave the axis there) and
 * covers both blocks at the bottom.
 */
export const ZAXIS = {
  /** the slew plate's underside, where the guide frame hangs from */
  topY: 2.93,
  /** the head's axis range, metres above the floor (TB_Z_* is the height above `from`) */
  from: 0.40, to: 1.05,
  /** the guide blocks on the guide frame, metres above the floor: the beam (its foot 0.84 to 1.49 m up, 1.30 m long)
   *  covers both at every height, and the lower one stays 0.05 m over the beam's foot at the top of the stroke */
  guideY: [1.58, 2.08],
  mps: 0.3,
} as const;

/**
 * THE HEAD, in its own frame: origin on the spindles' axis (A) at the housing's front face, +x forward (toward the wheel
 * it works), +y up, +z completing a right-handed frame. Metres.
 */
export const HEAD = {
  /** the tilt axis (horizontal, along z) and the vertical axis (the slew's) stand here: above the head's centre of mass */
  tiltX: -0.20, tiltY: 0.32,
  /** the head's axis below the Z-beam's foot: the tilt axis 0.14 under the foot, so the tilt actuator clears the foot plate */
  axisBelowFoot: 0.46,
  /** the camber the tilt sets, rad (+/- 6 degrees) */
  tilt: 0.105,
  /** the sockets' tips with the grip unit home: the grip face then stands `faceAhead` in front of them */
  socketTip: 0.15, faceAhead: 0.03,
  /** the grip unit's slide back along -x: it holds the wheel still while the head moves the sockets onto the nuts */
  grip: 0.22,
  /** the 2 clamp rollers: their axis this far below the head's axis, radius, length; each arm's slide (z, from the axis) */
  rollerY: -0.34, rollerR: 0.045, rollerL: 0.33, rollerBack: 0.02,
  clampMin: 0.20, clampMax: 0.37,
  /** the spindles' pitch circle (PCD) range, metres: the fleet's 108, 114.3 and 120 mm inside it */
  pcdMin: 0.100, pcdMax: 0.130,
  /** the spindle cluster's turn about the axis (A), rad, each way: a 5-stud circle repeats every 72 degrees, so +/- 40
   *  degrees reaches any nut pattern a car stops with */
  aRange: 0.70,
  /** the cover tool's slide: its 4 suction cups' face from flush with the housing's front (0) to 0.15 m past the sockets */
  cover: 0.30,
  /** the head's extent about the vertical axis, for its sweep when it turns (with the clamp open) */
  backFromMast: 0.60, halfWidth: 0.47,
  /** a class mass, kg (ASSUMPTION, the parts list carries the CAD's own): the head without a wheel */
  massKg: 110,
} as const;

/** The grip face's x (head frame) at a grip slide value. */
export const gripFaceX = (grip: number): number => HEAD.socketTip + HEAD.faceAhead - grip;
/** The face's distance ahead of the vertical axis at grip 0: the head's working point. */
export const FACE_AHEAD_OF_MAST = r4(gripFaceX(0) - HEAD.tiltX);

export const HEAD_Y_MAX = ZAXIS.to;
export const HEAD_Y_MIN = ZAXIS.from;
/** The head's sweep radius about the vertical axis when it turns (front corners, clamp open). */
export const SLEW_SWEEP = r4(Math.hypot(FACE_AHEAD_OF_MAST + HEAD.rollerL - HEAD.rollerBack, HEAD.halfWidth));

// ═══════════════════════════════════════════════════════════════════════════ THE RACKS ═══
export const RACK = {
  /** the racked tyre's outer face (it faces the bay's centre) from the drive line: outside the door opening */
  faceX: 2.72,
  /** cradle centres (Z): NEW at the entrance (south), OLD at the exit (north). [front wheel's, rear wheel's] */
  newZ: [-3.40, -4.25], oldZ: [3.40, 4.25],
  /** the lowest point of a racked tyre: the cradle's 2 rollers hold it this high */
  tyreBottom: 0.08,
  /** the back stop's bumpers, from the drive line, and their height */
  backX: 3.02, backTop: 0.75,
  /** each frame's outline across the bay */
  frameX0: 2.66, frameX1: 3.18,
} as const;

/**
 * The socket rack on each side, on the floor north of the lift and outside the door opening: 2 rings of 5 holders on a
 * 114.3 mm pitch circle, each ring's axis at its height. The head carries the 21 mm set (the fleet's wheel nuts); for a
 * car with 17 mm wheel bolts it puts its 5 sockets into ring A's empty holders and takes the 17 mm set from ring B, and
 * swaps back when the car is done. `faceX` is the holders' mouths (|X|); a socket goes `engage` past it to be held. At
 * the rack the head's rollers reach out 0.69 m past its axis, so faceX keeps their tips 0.04 m off the end truck. The 2
 * rings stand 0.37 m apart: at ring B the head's grip carriage and clamp beam, which reach 0.04 m past the holders' mouths,
 * pass 0.04 m over ring A's holders.
 * Both sides' racks stand at the same Z (the portal carries both robots), so the east one is the west one mirrored.
 */
export const SOCKET_RACK = { z: 2.55, faceX: 2.94, ringY: [0.45, 0.82], pcd: 0.1143, engage: 0.03, hexOnHead: 21 } as const;

/**
 * The cover nest on each portal leg's inner face: a removed aero cover waits here while its wheel is changed. `x` is the
 * cover's outer face (the face the suction cups hold) when it sits in the nest. Its rim rests on 2 hooks whose tops are
 * `seatY` above the floor, so the head sets the cover's centre at seatY + the cover's radius: high enough that the head's
 * rollers, which then reach out over the portal's end truck, stay 0.03 m over it.
 */
export const COVER_NEST = { x: 3.34, seatY: 0.62 } as const;
/** An aero cover's radius is its rim's less this (ASSUMPTION: it sits inside the rim's flange). */
export const COVER_RIM = 0.02;
/** A cover's outer face stands this far inboard of its tyre's outer face (ASSUMPTION: an aero cover is recessed in the rim). */
export const COVER_INSET = 0.03;

// ═════════════════════════════════════════════════════════════════════════════ THE LIFT ═══
/**
 * An IN-GROUND TWIN-POST LIFT: 2 hydraulic rams in steel casings in the floor on the drive line, one under the front
 * lift points and one under the rear. Each ram carries a saddle with 2 arms that swing out to the car's own lift points
 * and slide out to reach them, and each arm a pad that screws up to the sill, with a load cell and a camera. Lowered,
 * the saddles and arms lie in recesses with their tops flush with the floor, so the car drives over them; the rams first
 * rise 0.11 m to lift the arms out of their recesses, then the arms swing out under the car.
 *
 * Why in-ground posts (docs/OTTO-TIRE.md, "Choices"): the robots work at the car's sides, so nothing may stand there; a
 * two-post lift's columns did. A flush double scissor (2 platforms in 0.30 m pits) was drawn first: closed, its crossing
 * beams stand 65 mm apart against 80 mm beams and 30 mm pins, so it cannot be packed in a flush pit. A ram lifts its car
 * directly, with no linkage, at about 7 bar at its rated load (ramBar), and reaches 1.85 m for a person to work under the car.
 *
 * Lift points: ASSUMPTION, a sill point LIFT_POINT_FROM_AXLE (0.60 m) inboard of each axle (tireProgram.ts); each car's
 * own points come from its maker's service data before the bay serves it, and each pad's camera checks its point.
 */
export const LIFT = {
  /** the 2 posts' centres (Z) on the drive line */
  postZ: [0.85, -0.85],
  /** the ram's rise, metres: 0.11 to lift the arms out of their recesses, 0.50 for the robots, 1.85 for a person */
  armClearRise: 0.095, serviceRise: 0.50, fullRise: 1.85,
  /** ram, casing and the casing's depth under the floor */
  ramD: 0.20, casingD: 0.56, casingDepth: 2.60,
  /** each saddle: the arms' swing pivots (X from the drive line), the arms' tops under the floor when down */
  pivotX: 0.10, saddleTop: -0.010,
  /** each arm: its reach from its pivot to its pad's centre (telescoping), its section; stowed it points along the drive line toward the bay's centre */
  reach: [0.56, 0.78], armW: 0.10, armH: 0.09,
  /** each pad's rubber block: its diameter (its top is the arm's top) */
  padD: 0.15,
  /** rated load (both posts), kg: the heaviest fleet car is about 2.7 t (ASSUMPTION, the Lucid Gravity's class) */
  ratedKg: 4500,
  /** the locks' tooth pitch on each ram (it stands on the nearest tooth at or below its height) */
  lockPitch: 0.075,
  /** lifting time to full rise. Class: a 10,000 lb in-ground electric-hydraulic two-post lift lists 53 s to full rise and
   *  24 s down (read through a web search on 2026-11-17: https://standardus.com/rotary-two-post-auto-lift-10-000lbs-capacity-inground-electric-hydraulic-r-sl210-fa.html) */
  riseS: 50,
} as const;

/** The ram's pressure for a load on its saddle (N), bar. */
export const ramBar = (loadN: number): number => loadN / (Math.PI * (LIFT.ramD / 2) ** 2) / 1e5;

/** Where a pad must stand (|X| from the drive line, Z) as the swing angle (rad, from the drive line's direction toward the
 *  bay's centre: 0 stowed, pi/2 square to the car) and the reach of the arm on the +X side of a post at postZ. */
export function armFor(postZ: number, padX: number, padZ: number): { swing: number; reach: number } {
  const dx = padX - LIFT.pivotX;
  const toward = postZ > 0 ? -1 : 1;               // the arm stows pointing toward the bay's centre
  const dz = (padZ - postZ) * toward;               // + toward the centre
  return { swing: Math.atan2(dx, dz), reach: Math.hypot(dx, dz) };
}

// ═══════════════════════════════════════════════════════════════════════ THE CABINETS ═══
/**
 * The bay's control cabinet and the lift's power unit stand against the NORTH wall, west of the exit door, between the
 * door's jamb (2.63) and the partition (4.21): out of the car's path, north of the portal's travel, and reached from the
 * bay floor past the north end of the west rail. `x` is each one's middle, `w` across the bay, `d` out from the wall. The
 * power unit's tank holds the 2 rams' 116 L and a reserve (150 L), its motor on the lid (1.15 m to the motor's top). The
 * portal's drive cabinet rides on its west leg's north face, `y0` its underside.
 */
export const CABINETS = {
  bay: { x: 3.70, w: 0.80, d: 0.50, h: 2.00 },
  hpu: { x: 2.96, w: 0.46, d: 0.44, h: 1.15 },
  portal: { w: 0.60, d: 0.30, h: 1.10, y0: 1.40 },
} as const;

/**
 * What the machine stands in the bay up to a car's height, for the site plan's solids (structurePlan.tireBaySolids: the
 * rectangles a car driving through the bay must never meet) beyond the numbers above. |X| from x0 to x1 (or a centre and a
 * half-size), Z half-lengths or ends, metres. ASSUMPTION: the CAD's outlines rounded out (cad/otto_cad/robots/tire_bay.py:
 * RB_W and the rail's anchor plates, RCC, the floor chain's trough, SCANNERS, ESTOP_POST, the portal cabinet);
 * robotics/cadYard.test.ts holds every part of the drawn machine at home, up to a car's height, inside them.
 */
export const FLOOR = {
  /** each rail's width on the floor: its anchor plates, 260 wide under the 160 rail beam */
  railFootW: 0.26,
  /** a racked wheel's half-length along the bay (the largest fleet tyre's radius, with room) */
  rackHalfZ: 0.45,
  /** the socket rack (its 17 mm sockets stand out of their holders to 2.88) and the cover nest on the portal's leg */
  socketRack: { x0: 2.85, x1: 3.25, halfZ: 0.25 },
  coverNest: { x0: 3.28, x1: 3.45, halfZ: 0.40 },
  /** room kept round a parked head's outline */
  headMargin: 0.05,
  /** the portal at its park, each side: the leg, its end truck, and on the west leg the drive cabinet, its conduits and a stop */
  portalLeg: { halfX: 0.31, zBack: 0.44, zFront: 0.47 },
  /** each side's floor cable channel along the racks (100 x 30, ramped), and the floor chain's trough beside the west rail */
  cableChannel: { x0: 3.19, x1: 3.31, halfZ: 4.71 },
  floorChain: { x0: 3.71, x1: 4.12, z0: -4.61, z1: 4.26 },
  /** the 2 safety scanners' pedestals (south-west, north-east) and the south emergency stop's post: centres and half-sizes */
  scanners: [{ x: 3.95, z: -6.60 }, { x: -3.95, z: 6.60 }],
  scannerHalf: 0.09,
  estopPost: { x: 3.60, z: -6.48, half: 0.10 },
} as const;
