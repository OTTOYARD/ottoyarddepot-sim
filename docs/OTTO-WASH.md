# OTTO-WASH: the robotic rollover machine in each wash bay

Chase, 2026-10-20: "Wash bays are robotic too. Car pulls in and the machine moves back and forth over it several times
to wash and rinse and blow dry before vehicle leave."

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
- Along the beam, so no part can meet another: the spray arch (dy -1.6), the top brush (-0.7), the two vacuum wands'
  carriages (-1.2), the two side brushes (+0.6) and the air knives (+1.9).
- Side brushes: vertical, radius 0.9 u, retracted at x = ±4.3, closed to the flank's line less 0.18 u of bristle.
- Top brush: horizontal, radius 0.75 u, 3.4 u long (narrower than the gap between the side brushes), retracted at
  5.7 u, riding the car's top less 0.15 u of bristle, over the roof pod too.
- Air knives: one over the roof, which follows the car's top 0.5 u above it and ramps over the roof pod, and one each
  side, 0.55 u off the flank.
- A stop light on the beam's south face, toward an arriving car: red while the program runs, green when the car may go.
- A beacon: teal at home, green working, amber moving.

Retracted, the portal clears a car and its roof pod by more than 1 u everywhere, so a car drives in under the machine
and out under it. The machine waits at the north end (home), its air knives 1 u ahead of a parked car's nose.

## The program

| phase | what moves | nominal |
|---|---|---|
| settle | the car stops under the stop light | 2.5 s |
| soak | pass 1, north to south: the arch sprays pre-soak foam | 30 s |
| wash_1, wash_2 | passes 2 and 3: the brushes close in and turn, foam on | 40 s each |
| rinse | pass 4: clear water | 30 s |
| dry_1, dry_2 | passes 5 and 6: the air knives close in and blow | 35 s each |
| done | home, the stop light turns green | 2 s |

Six passes, 3.6 minutes in all at nominal pace, inside the twin's robotic wash of 5 minutes (pull in 0.5, program 4.0,
pull out 0.5). A real 5-brush rollover on a 23 ft guiderail "would travel 138' in six passes (3 minutes)"
(carwashforum.com, 2015-10-12, https://carwashforum.com/goto/post?id=99620, read 2026-10-21), and an in-bay automatic
runs about 4 minutes a car (ccentral.ca, https://ccentral.ca/experts-weigh-small-footprint-car-wash-opportunities,
read through search results 2026-10-21).

The passes are fitted to the seat as the program starts: they stretch or shrink (0.4x to 2x) so the machine is home
8 sim-seconds before the twin's seat ends. An older backend that publishes no end runs at nominal pace.

The machine keeps to the twin's clock at any frame rate. The gate plays each frame's sim time in steps of 0.25 s
(`WASH_SUBSTEP_S`). Played as one step capped at 2 s, a frame a second at 3x lost a third of its time, and on live run
96371023 a detail seat ended while its machine was still in the vacuum. `washGate.test.ts` plays both programs at
0.05, 1, 3 and 8 sim-seconds a frame and requires every pass, no early end, and the last pass within a frame of 60 fps.

A detail seat (the twin's `in_detail_bay`; at `wash_lane_physics` 2 a door attendant and a robot arm clean the
interior, then the exterior program runs, 16.5 minutes within 20%) cleans the cabin first:

| phase | what moves |
|---|---|
| to_cabin | the machine moves until its wands stand at the car's middle (dy 0) |
| doors_open | the car's doors open (doorStore, as for the cleaning arm) |
| wands_down, wands_in | each wand drops outside its flank to the door's mid-height, then reaches in through the aperture |
| vacuum | the wands sweep the cabin floor, in and out and along; the twin's time left after the exterior |
| wands_out, wands_up, doors_close | back out the way they went in |
| to_start | the machine moves to the north end and the six passes follow |

The doors open from their front hinge, so the wands work in the apertures' rear half, behind the open doors, and the
side brushes stand south of every point an opening door sweeps. ASSUMPTION: the interior robot is a Cartesian wand on
the gantry. The twin's model (0746) says "a door attendant and a robot arm" and names no machine.

## A seat that ends first, and the hold

The car may not move until the machine is home (`washLetsCarMove`: home or done), as a car on a fast charger may not
move until its arms are home. If the twin ends the seat first, or a different car is in the bay, the machine finishes
from wherever it is: wands out the way they went in, doors shut, brushes and air knives off the car at their own speed
(2 s, never hurried), then home at 3x. The hold is capped at 30 sim-seconds after the seat is over, so a wedged signal
cannot freeze a car (`WASH_HOLD_CAP_S`, derived in `washGate.ts`).

## Seeing it

From above, the roofs used to hide every robot the depot has. Since 2026-10-20 the solar modules and roof membranes
fade when the camera looks down steeply (`RoofXray.tsx`: below 40 degrees down they come back), so the arms under the
canopies and the machines inside the wash hall show. Two camera presets frame the robots close: **Robots** (under
canopy A: the fast chargers' arms on the cars and the cleaning arms above them) and **Wash** (inside wash bay 2).

The 2D plan draws the same machines from above (`WashGantry2D.tsx`), from the same session and pose as the 3D view:
the portal on its rails, the side brushes closing on the car, the top brush, the spray and the air knives' blast while
they run, a detail seat's two wands in the doorways, the beacon and the stop light. Each bay's square on the plan is
centred on the car it holds (it was drawn from that point as a corner, and reached into the next bay), and so is every
staging stall, at the size the 3D view paints it.

## Tests

- `washSession.test.ts`: the program's order, both chains; it is home before every robotic wash and detail seat the
  twin draws ends; nominal pace with no end; never twice for one seat; and every phase of both programs ended early
  finishes home with nothing spraying or blowing and nothing jumping.
- `washPose.test.ts`: against the car's solid, at every moment of both programs and of four early ends: a brush
  presses in no deeper than its bristles give (and does touch); every rigid part keeps off the car (frame by more than
  1 u, knives, hangers and wands by more than 0.2 u); nothing touches an open door (more than 0.25 u); a wand enters the
  car only through an open door, into the cabin's free space, clear of the seats; retracted, the machine clears a car
  driving under it by more than 1 u.
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
