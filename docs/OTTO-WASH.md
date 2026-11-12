# OTTO-WASH: the touchless wash machine in each wash bay

Chase, 2026-10-20: "Wash bays are robotic too. Car pulls in and the machine moves back and forth over it several times
to wash and rinse and blow dry before vehicle leave."

Chase, 2026-11-11: "I don't think it makes sense to have giant brushes that will be whipping the vehicle since a lot of
AV's have extended areas with cameras and and lidar ... much more delicate, and maybe only rinses and dries, then ... an
robot arm will locate all sensors and hand wipe gently with a cloth ... I don't think doors should open whatsoever once
in the large external wash bay."

Chase, 2026-11-11 (evening): "the final sensor polisher should be swivel/mechanical arms similar to robocharging arm ...
very delicate and able to move like a hand almost to reach difficult angles of cameras and sensors ... the wash arch
... stows at the front entrance, and then the detail arms come from the opposite end of the wash bay (the exit side)
and come down each of their rails independently ... more like an assembly line ... with robots utilizing the rails
around the stationary car."

So nothing that turns touches the car, and no door opens. The car stands still and the machines move round it. The
gantry soaks the car, washes it with water jets, rinses it and dries it, and then stows at the entrance. Two six-axis
arms then come down their own tracks from the exit end, one each side, and polish each sensor with a soft, damp pad.
The cabin is cleaned at the fast charger, by the cleaning arm's longer program (otto-q-core 0815).

This file is the design. The numbers live in code (`src/lib/ottoWash/washSpec.ts`, the car's shape in
`src/lib/ottoChargeArm/vehicleEnvelope.ts`), and the tests measure them.

## What the twin owns and what the renderer draws

The swap test holds. The engine seats a car in a wash or detail bay and times its work (otto-q-core 0746;
`wash_lane_physics` is 2, robotic lanes, at the twin depot since 2026-10-20 9:10 PM CT). Since 0762 the snapshot says
when the seat started and when it ends: `bay_seat: {since, ends_at}` on each car in a wash, detail or service bay, both
on the sim clock. The engine holds the car in the bay until the seat is over. The renderer plays the machine's program
inside that window, as the OTTO-CHARGE ARM plays its mate inside a charge: the passes are the choreography of one step
whose start and end the twin owns. A real depot reports the same step from the wash controller.

## The bay: a gantry at the entrance end, two detail arms at the exit end

Plan units (1 u = 0.4785 m), in the bay's frame: `x` across from the drive line, `dy` along it from the parked car's
centre, negative to the north (the car faces north, enters by the south door and leaves by the north door).

**The gantry.**

- Two floor rails at x = ±6.8 u, outside the door opening (±5.5 u), from dy -10.0 to +14.2.
- A yellow portal: a trolley and a leg on each rail and a beam across at 6.9-7.6 u, 4.1 u deep along the bay.
- Along the beam: the spray arch (dy -1.6) and the air knives (+1.9).
- Spray arch: one ring of nozzles, with a pre-soak circuit, a wash-water circuit and a rinse circuit.
- Air knives: one over the roof, which follows the car's top 0.5 u above it and ramps over the roof pod, and one each
  side, 0.55 u off the flank.
- A stop light on the beam's south face, toward an arriving car: red while the program runs, green when the car may go.
- A beacon: teal at home, green working, amber moving.

Its passes turn at dy -7.8 and +7.6. It stows at dy +11.6, the entrance end (`WASH_TRAVEL.home`): its north face is
then 2.3 m behind the car's tail. A car drives in under it. Stowed, the portal clears a car and its roof pod by more
than 1 u everywhere.

**The detail arms** (`detailArm.ts`).

- Each is the OTTO-CHARGE ARM's own arm: the same six joints, links, castings and actuators, solved by the same
  kinematics (`cobotIK`). It reaches 2.49 m from its shoulder. Only the tool differs.
- Each stands on a carriage on a floor track, 2.10 m from the drive line (1.10 m off the flank), inside the gantry's
  rails. The gantry passes over the tracks. A rack and pinion drives the carriage at up to 1.5 m/s.
- The tool is a polishing head: a force sensor, a floating joint that tilts 6 degrees and gives 8 mm, a backing plate
  and a 120 mm pad of microfibre on foam. A camera on the wrist looks at the pad's work, and a nozzle mists pure water.
- The wrist's three axes meet at one point. So the arm can put the pad square on a surface at any angle and turn the
  pad about its own centre. The last joint turns the pad a quarter turn each way to polish. It never spins free.
- Each arm docks at the exit end (dy -10.9 u), north of the gantry's travel, folded along its track with its pad in a
  rinse cup. The dock stands on the track beam's north end. A car drives out between the docked arms with 0.6 m a side.
- The arm folds only as far as its own parts allow: 2.30 rad at the elbow and 1.70 rad at the wrist (`DETAIL_FOLD`).
  The CAD's clash check found where the castings meet, and the motion is held inside it. So the carriage stops 1.0 to
  1.65 m along the track from each sensor, and the arm reaches it at a slant, stretched out.

The gantry and the arms never share a part of the bay. The gantry works with the arms docked, and the arms work with
the gantry stowed.

## The program

| phase | what moves | nominal |
|---|---|---|
| settle | the car stops under the stop light | 2.5 s |
| soak | pass 1, from the stow to the north end: the arch sprays the pre-soak | 25 s |
| wash_1, wash_2 | passes 2 and 3: the arch washes with water jets | 35 s each |
| rinse | pass 4: clear water | 25 s |
| dry_1, dry_2 | passes 5 and 6: the air knives close in and blow. Pass 6 ends at the stow | 30 s each |
| arms_out | each arm unfolds at its dock and rides to the nose | 10 s |
| wipe_front | the nose: the radar, the camera and the corner lidar, each side | 21 s |
| wipe_sides | the wing camera, the pillar camera and the rear-quarter camera, each side | 21 s |
| wipe_roof | the roof lidar, 3 places each arm, the two pads on opposite faces of it | 38 s |
| wipe_rear | the tail: the corner lidar, the camera and the radar, each side | 40 s |
| arms_stow | each arm tucks, rides to its dock and folds | 15 s |
| done | the stop light turns green | 2 s |

Each arm does 12 places, 24 in all. For each place the pad moves to a point 0.15 m off the sensor, touches, turns a
quarter turn each way while it presses, and lifts. Between places the pad moves in a shell 0.40 m off the car. To go
from a flank to the roof, the pad lifts to 2.05 m and the wrist turns over above the track, clear of the car. A corner
lidar is met 45 degrees round the corner and 20 degrees from above.

**No joint is hurried.** The moves are timed so that the base and shoulder stay under 120 deg/s, the elbow under
150 deg/s and the wrist joints under 210 deg/s, which are a 1.75 m collaborative arm's joint speeds (read 2026-11-12,
https://www.universal-robots.com/manuals/latest/en/techsheets/ur20/, through search results). ASSUMPTION: this longer
arm is held to the same joint speeds. ASSUMPTION: no public source gives a measured time for a robot arm that polishes
a car's sensors. The times here are what those joint speeds allow.

Six passes (180 s) and the arms' work (145 s) make 5.5 minutes at nominal pace. The twin's robotic wash seat is 6.5
minutes at the twin depot since 2026-11-12 (pull in 0.5, program 5.5, pull out 0.5). A real rollover on a 23 ft
guiderail "would travel 138' in six passes (3 minutes)" (carwashforum.com, 2015-10-12,
https://carwashforum.com/goto/post?id=99620, read 2026-10-21), and an in-bay automatic runs about 4 minutes a car
(ccentral.ca, https://ccentral.ca/experts-weigh-small-footprint-car-wash-opportunities, read through search results
2026-10-21).

The passes are fitted to the seat as the program starts: they stretch or shrink (0.4x to 2x) so the machine is home
8 sim-seconds before the twin's seat ends. An older backend that publishes no end runs at nominal pace.

The machine keeps to the twin's clock at any frame rate. The gate plays each frame's sim time in steps of 0.25 s
(`WASH_SUBSTEP_S`). Played as one step capped at 2 s, a frame a second at 3x lost a third of its time, and on live run
96371023 a detail seat ended while its machine was still in its interior phase. `washGate.test.ts` plays both programs at
0.05, 1, 3 and 8 sim-seconds a frame and requires every pass, no early end, and the last pass within a frame of 60 fps.

A detail seat (the twin's `in_detail_bay`) still exists for a car that no fast charger's arm reached (otto-q-core 0815
§3: 10 of 43 deep cleans on the twin depot's last three runs). The twin times a cabin clean in that seat, 16.5 minutes
within 20%. The machine does no cabin work and no door opens: it holds, parked and dry, for that time (`cabin_hold`),
and then runs the same program. This is a gap, and it is stated: the twin's seat says a cabin was cleaned in a bay
where nothing now cleans a cabin. It closes when the engine sends such a car to a fast charger for its clean.

## A seat that ends first, and the hold

The car may not move until the machine is home (`washLetsCarMove`: home or done), as a car on a fast charger may not
move until its arms are home. If the twin ends the seat first, or a different car is in the bay, the machine finishes
from wherever it is. The air knives come off the car. Each pad backs straight off the car the way it faces, to the
0.40 m shell, lifts if it is over the roof, and the arm tucks (9 s). Then the gantry goes home at 3x, and each arm
rides to its dock and folds at its own pace. An arm's joints and its carriage are never hurried
(`washSession.armsMove`). The hold is capped at 30 sim-seconds after the seat is over, so a wedged signal
cannot freeze a car (`WASH_HOLD_CAP_S`, derived in `washGate.ts`).

## Seeing it

From above, the roofs used to hide every robot the depot has. Since 2026-10-20 the solar modules and roof membranes
fade when the camera looks down steeply (`RoofXray.tsx`: below 40 degrees down they come back), so the arms under the
canopies and the machines inside the wash hall show. Two camera presets frame the robots close: **Robots** (under
canopy A: the fast chargers' arms on the cars and the cleaning arms above them) and **Wash** (inside wash bay 2).

The 2D plan draws the same machines from above (`WashGantry2D.tsx`), from the same session and pose as the 3D view:
the portal on its rails, the spray and the air knives' blast while they run, each detail arm on its own track (its
carriage, its two links and its pad: amber on the way, green while pressed on a sensor), the beacon and the stop light. No door opens on the
plan in a wash bay. Each bay's square on the plan is centred on the car it holds, and so is every staging stall, at the
size the 3D view paints it.

## Tests

- `washSession.test.ts`: the program's order, both chains; it is home before every robotic wash and detail seat the
  twin draws ends; nominal pace with no end; never twice for one seat; and every phase of both programs ended early
  finishes home with nothing spraying or blowing and nothing jumping.
- `detailArm.test.ts`: the two arms through all of their work. Every one of the 24 places is on the car and in
  reach, and so is every point of every path between them. Every joint stays inside its limits and the arm's fold
  limits, never jumps, and stays under its speed. Each carriage stays under 1.5 m/s.
  Every link keeps 0.10 m off the car. A pad touches the car only on a sensor, square to it, and turns its quarter turn
  on every one. The two pads are on opposite faces of the roof lidar. Each arm starts and ends folded in its dock.
- `washPose.test.ts`: against the car's solid, at every moment of both programs and of 43 early ends (one every 4 s of
  the arms' work): the frame keeps more than 1 u off the car, the air knives their gap, and each arm's links 0.10 m;
  only the pads touch the car, only while the arms work; the arms are docked while the gantry travels, and the gantry
  is stowed while the arms are out, with 0.5 m or more between them at every moment; no door opens and nothing goes
  into the car; a car drives under the stowed gantry and between the docked arms.
- `cadYard.test.ts`: the same, measured on the CAD's own meshes. The pad's face is on the car (on a corner lidar its
  foam gives 6 mm at the rim), the head behind it stays 53 mm off or more, every link and joint of an arm 0.13 m, and
  every other tool 0.20 m.
- `structureClearance.replay.test.ts`: the wash bays' solids are the machine at home and its rails
  (`structurePlan.bayEquipmentSolids`), and no recorded car meets them.
- `washGate.test.ts`: both programs at 0.05, 1, 3 and 8 sim-seconds a frame run every pass and are home before the
  seat ends; a seat the twin ends early still lets the car go inside the hold cap; a viewer joining mid-seat at a frame
  a second runs the rest of the program. Its reproduction fails on the old one-step-a-frame gate (7 of 13 tests).
- `WashGantry2D.test.tsx`: the 2D plan draws exactly the pose the 3D view draws, at every moment of a detail program,
  and the machine passes over the car end to end. `StallBay.test.tsx`: each bay's square is centred on its car, inside
  its own bay, and each staging stall is the 3D paint's outline centred on its car with the car's body inside it.
- `scripts/liveWashShots.mjs` films a real program from a live run, from inside the hall, through the south door and
  from above.
