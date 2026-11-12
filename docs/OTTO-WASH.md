# OTTO-WASH: the touchless wash machine in each wash bay

Chase, 2026-10-20: "Wash bays are robotic too. Car pulls in and the machine moves back and forth over it several times
to wash and rinse and blow dry before vehicle leave."

Chase, 2026-11-11: "I don't think it makes sense to have giant brushes that will be whipping the vehicle since a lot of
AV's have extended areas with cameras and and lidar ... much more delicate, and maybe only rinses and dries, then ... an
robot arm will locate all sensors and hand wipe gently with a cloth ... I don't think doors should open whatsoever once
in the large external wash bay."

So nothing that turns touches the car, and no door opens. The arch soaks the car, washes it with water jets and rinses
it. The air knives dry it. Two arms then wipe each sensor with a soft, damp pad. The cabin is cleaned at the fast
charger, by the cleaning arm's longer program (otto-q-core 0815).

This file is the design. The numbers live in code (`src/lib/ottoWash/washSpec.ts`, the car's shape in
`src/lib/ottoChargeArm/vehicleEnvelope.ts`), and the tests measure them.

## What the twin owns and what the renderer draws

The swap test holds. The engine seats a car in a wash or detail bay and times its work (otto-q-core 0746;
`wash_lane_physics` is 2, robotic lanes, at the twin depot since 2026-10-20 9:10 PM CT). Since 0762 the snapshot says
when the seat started and when it ends: `bay_seat: {since, ends_at}` on each car in a wash, detail or service bay, both
on the sim clock. The engine holds the car in the bay until the seat is over. The renderer plays the machine's program
inside that window, as the OTTO-CHARGE ARM plays its mate inside a charge: the passes are the choreography of one step
whose start and end the twin owns. A real depot reports the same step from the wash controller.

## The machine: one portal gantry on two floor rails

Plan units (1 u = 0.4785 m), in the bay's frame: `x` across from the drive line, `dy` along it from the parked car's
centre, negative to the north (the car faces north, enters by the south door and leaves by the north door).

- Two floor rails at x = ±6.8 u, outside the door opening (±5.5 u), from dy -10.0 to +10.2.
- A yellow portal: a trolley and a leg on each rail and a beam across at 6.9-7.6 u, 4.1 u deep along the bay.
- Along the beam, so no part can meet another: the spray arch (dy -1.6), the wipe arms' cross rail (-0.2) and the air
  knives (+1.9).
- Spray arch: one ring of nozzles, with a pre-soak circuit, a wash-water circuit and a rinse circuit.
- Air knives: one over the roof, which follows the car's top 0.5 u above it and ramps over the roof pod, and one each
  side, 0.55 u off the flank.
- Two sensor-wipe arms, one each side. Each has a carriage on the cross rail, a mast that lowers the wrist, and a wrist
  that turns and tilts a soft pad (radius 0.26 u, 0.12 u thick) to face the car. The pad's centre stands 0.35 u from
  the mast's axis, so the mast stays clear of the car while the pad is on it. The arms park at x = ±4.3 u, 1.1 m off
  the flank, where the first machine's side brushes stood. They are beside the car's path, not over it.
- A stop light on the beam's south face, toward an arriving car: red while the program runs, green when the car may go.
- A beacon: teal at home, green working, amber moving.

Stowed, the portal clears a car and its roof pod by more than 1 u everywhere, so a car drives in under the machine
and out under it. The machine waits at the north end (home), its air knives 1 u ahead of a parked car's nose.

## The program

| phase | what moves | nominal |
|---|---|---|
| settle | the car stops under the stop light | 2.5 s |
| soak | pass 1, north to south: the arch sprays the pre-soak | 25 s |
| wash_1, wash_2 | passes 2 and 3: the arch washes with water jets | 35 s each |
| rinse | pass 4: clear water | 25 s |
| dry_1, dry_2 | passes 5 and 6: the air knives close in and blow | 30 s each |
| arms_down | at the north end, the masts lower and the wrists turn for the nose | 3 s |
| wipe_front | the nose: the low cameras and radars on its upright face | 14 s |
| wipe_sides | the front wings: the side cameras | 14 s |
| wipe_roof | the roof pod, from its two sides | 16 s |
| wipe_rear | the tail | 18 s |
| arms_up, to_home | the masts rise, the machine goes home | 3 s, 17 s |
| done | home, the stop light turns green | 2 s |

Each wipe phase is one motion: the masts go out to their park, the gantry travels to the place, the pads close in, wipe
with two strokes, and go back out. The pad's face is on the car's surface and presses in no more than the pad gives
(6 mm of spring and its foam). ASSUMPTION: no public source gives a measured time for a robot arm that wipes a car's
sensors. 14 to 18 s a place is a gentle hand's pace.

Six passes (180 s) and the wipe (85 s) make 4.5 minutes at nominal pace. The twin's robotic wash is 5 minutes (pull in
0.5, program 4.0, pull out 0.5), so the passes run at about 0.8 of nominal there, 0.31 m/s. A real rollover on a 23 ft
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
from wherever it is: the air knives off the car and the wipe pads out and up at their own speed (2 s, never hurried),
then home at 3x. The hold is capped at 30 sim-seconds after the seat is over, so a wedged signal
cannot freeze a car (`WASH_HOLD_CAP_S`, derived in `washGate.ts`).

## Seeing it

From above, the roofs used to hide every robot the depot has. Since 2026-10-20 the solar modules and roof membranes
fade when the camera looks down steeply (`RoofXray.tsx`: below 40 degrees down they come back), so the arms under the
canopies and the machines inside the wash hall show. Two camera presets frame the robots close: **Robots** (under
canopy A: the fast chargers' arms on the cars and the cleaning arms above them) and **Wash** (inside wash bay 2).

The 2D plan draws the same machines from above (`WashGantry2D.tsx`), from the same session and pose as the 3D view:
the portal on its rails, the spray and the air knives' blast while they run, the two wipe arms on their cross rail with
their pads (amber on the way, green while pressed on a sensor), the beacon and the stop light. No door opens on the
plan in a wash bay. Each bay's square on the plan is centred on the car it holds, and so is every staging stall, at the
size the 3D view paints it.

## Tests

- `washSession.test.ts`: the program's order, both chains; it is home before every robotic wash and detail seat the
  twin draws ends; nominal pace with no end; never twice for one seat; and every phase of both programs ended early
  finishes home with nothing spraying or blowing and nothing jumping.
- `washPose.test.ts`: against the car's solid, at every moment of both programs and of seven early ends: the frame
  keeps more than 1 u off the car, the air knives their gap, and each arm's mast 0.10 m; only the pads touch the car,
  only while they wipe, and no deeper than a pad gives; each pad is on its place with its face the right way; the arms
  stay inside the machine's cross travel, drop and rails; no door opens and nothing goes into the car; stowed, the
  machine clears a car driving under it by more than 1 u.
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
