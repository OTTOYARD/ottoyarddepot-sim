# Charge arm: reaching each vehicle's real inlet

Status on 2026-11-13 (early morning CT): **built.** The arm stands on a floor rail with a cross-slide, its head
carries two connectors, the twin tells the yard which vehicle each car is and where its inlet is, and OTTO-Q seats a
car only at a post whose arm can reach its inlet (otto-q-core 0824, on at the twin depot). This page says what was
built, what was measured, and what is not done.

## Where the inlets are

`docs/FLEET-MODELS.md` has the sources. Entries marked "assumed" have no published figure.

| Vehicle | Inlet | From the middle of the car | Height | Connector |
|---|---|---|---|---|
| Jaguar I-PACE | left front wing | 1.20 m toward the nose | 0.90 m | CCS1 |
| Tesla Model Y | left rear | 2.17 m toward the tail | 1.00 m | NACS |
| Lucid Gravity | left rear quarter | 2.04 m toward the tail | 1.02 m | NACS |
| Waymo Ojai | left rear quarter (assumed) | 1.86 m toward the tail | 0.95 m | CCS1 (assumed) |
| Zoox | one side, near a corner (assumed) | 1.19 m from the middle | 0.78 m | CCS1 (assumed) |
| Tesla Cybercab | rear bumper, centre, facing back | 2.22 m toward the tail | 0.62 m (assumed) | NACS |

The Cybercab's inlet: a NACS port behind a drop-down door in the rear bumper, DC only, plugged in by hand today;
inductive pads are planned and not in service. Reported by TeslAnt (2026-09), CyberCab.News (2026-10-12) and Tesla North
(2026-10-27), as relayed by Chase on 2026-11-12:
https://teslant.com/en/news/tesla-cybercab-no-onboard-charger-dc-only-2026-09 ,
https://www.cybercab.news/article/austin-robotaxi-supercharger-one-worker-oct12 ,
https://teslanorth.com/2026/10/27/moravy-optimus-cybercab-charging/ . I did not open these pages.

## What was added to the arm

The six-axis arm is unchanged (reach 3.125 m). Three things were added (`mateSolver.ARM_REACH`, the CAD in
`cad/otto_cad/robots/charge_arm.py`):

| Addition | Size | Why |
|---|---|---|
| A floor rail under the base, along the car (`CR_X`) | 1.3 m toward the nose, 2.5 m toward the tail, from the stall's middle | A side inlet is met square-on, abeam the base. The fleet needs 1.29 m and 2.35 m; a rear mate unfolds 0.15 m further out, at 2.50 m. |
| A cross-slide on the carriage (`CR_Z`) | 0.65 m toward the car, 0.06 m away | It puts the base at one standoff from every vehicle's flank whatever the vehicle's width, and carries the arm in behind a Cybercab's tail. |
| A two-connector head (`HD_CCS`, `HD_NACS`) | CCS1 and NACS side by side, 100 mm each side of the tool axis, each on a 90 mm plunge cylinder | The connector the car takes comes forward. The other stays back, clear of the car. |

Two earlier ideas were dropped. A telescoping forearm: the cross-slide does the same work and leaves the arm as it
was. A turret head that turns a connector to the front: it did not clear the car's body at the inlet.

`CR_BED` is not a moving joint. It is where the bed is set at install: its middle is 0.6 m toward the car's tail from
the stall's middle, whichever way the stall faces.

## The mate, per vehicle and stall side

`solveMate(target, armOnCarsRight)` returns where the base stands, which connector comes forward and the joint
angles. It refuses a car whose inlet is on the flank away from the arm. Rail positions are metres from the stall's
middle along the arm's +X (2026-11-13):

| Vehicle | Arm on the car's left | Arm on the car's right | Connector |
|---|---|---|---|
| Waymo Ojai | rail -1.96, cross-slide -0.04 | refused: inlet on the other side | CCS1 |
| Jaguar I-PACE | rail +1.10, cross-slide +0.01 | refused | CCS1 |
| Zoox | rail -1.29, cross-slide +0.04 | rail -1.29, cross-slide +0.04 (it drives in either way) | CCS1 |
| Tesla Cybercab | rail -2.35 (unfolds at -2.50), cross-slide +0.40 | rail +2.35 (unfolds at +2.50), cross-slide +0.60 | NACS |
| Tesla Model Y | rail -2.065, cross-slide 0.00 | refused | NACS |
| Lucid Gravity | rail -1.93, cross-slide -0.04 | refused | NACS |

## The order of a mate

`mateSequence.ts`, played by the 3D yard (`ChargingArm.tsx`) and the 2D plan (`Robots2D.tsx`). Five stops, one at a
time, and back the same way. At each step the arm takes the next stop's pose first; only then does the base move.

0. Home: base at the stall's middle, arm folded.
1. Base where the arm unfolds, arm folded.
2. The same place, arm at its standoff pose. The session's unstow, approach and retract play here.
3. Base where it mates along the rail, arm holding the standoff pose.
4. Cross-slide in. The session's align to extract play here, with the car's connector forward.

A release on the session's own clock is folded, with the cross-slide out, before the session lets the car move
(`mateSequence.test.ts`, the Cybercab on both stall sides).

## What was measured

- **The arm against each vehicle's own body** (`armFleetClearance.test.ts`): the CAD arm, through the whole cycle
  in the order above, on every stall side that can charge each of the six vehicles (8 cases). Every part but the
  connector stays more than 0.10 m off the car, and the connector's face is on the inlet at full mate. The vehicle
  is its side silhouette at full width, with its roof sensors as one cylinder.
- **The arm and its bed against the canopy columns** (`armColumnClearance.test.ts`). Found on 2026-11-13: at two
  stalls the bed's foot plate was 2 mm inside a column's concrete plinth and the carriage came within 8 mm of it.
  `structurePlan.canopyColumnYs` now keeps a column's steel 0.7 u from every rail bed. Three columns of canopy A
  moved (plan y 132, 149, 163 to 131.25, 145.25, 162.25); the count is the same. After the change the bed is 0.13 m
  from the nearest plinth and the moving machine 0.38 m.
- **Cars against the rail bed**: the bed is a yard solid (`dcfc-arm-bed`). The clearance replays measured 4.5
  million body samples against the solids as they stand, with 0 inside a bed.
- **Each vehicle's size against the other two machines** (`fleetEnvelope.test.ts`): the cleaning arm, parked and
  swinging, is 0.18 m (Zoox) to 0.71 m (Cybercab) over the vehicle's top; the stowed wash machine is 0.73 m or more
  from each vehicle's swept box as it drives through.
- **The live run** a95e51a3 on 2026-11-13 (`scripts/liveChargeShots.mjs`): 12 arms at a mate, each with its base
  where the table above puts it for its vehicle (I-PACE +1.10 m with CCS1, Model Y -2.065 m with NACS, Zoox -1.29 m),
  none refused.

## Which posts can charge which cars

A west-column post's arm stands on the car's right; an east-column post's on its left (`depotPlacement.portFlank`).
The twin depot has 15 of each.

| Car | Posts that fit |
|---|---|
| I-PACE, Model Y, Gravity, Ojai (inlet on the left) | the 15 left-arm posts |
| Zoox (drives either way, so presents either flank) | all 30 |
| Cybercab (rear inlet) | all 30 |

At the twin depot that is **78 of 116 cars on 15 posts**, and 38 cars that fit all 30. otto-q-core 0824 seats by
this rule and has a both-sides car take a right-arm post when one is free. On run a95e51a3 after the change: 22 of
22 left-port seats were at left-arm posts, 27 of 27 both-side seats at right-arm posts, and 22 proposals were
declined for the side (`db/checks/0489` in otto-q-core).

**This is an open layout decision.** No vehicle in today's fleet has its inlet on the right, so the 15 right-arm
posts serve only the Zoox cars. Two ways to give them to left-port cars, neither built:

1. Stand the west column's arms on the cars' left. Every post then fits every vehicle in the fleet. It moves 15
   machines, their cabinets and their beds, and the cleaning arm's side with them.
2. A left-port car backs into a right-arm post. The stalls stand at 60 degrees to the lane for nose-in parking, so
   a car would have to reverse through about 120 degrees in the aisle. Not measured; it reads as impractical.

## What is not built

- **The cleaning arm and the wash machine still work to the one generic car's cabin, doors and sensors.** Their
  sizes clear every vehicle (above). Their work does not follow each vehicle yet: the cleaning arm's path goes
  through the generic car's door opening, and the wash arms' pads go to the generic car's sensor positions. Each
  needs a per-vehicle target as the charge arm now has (door opening and cabin space; sensor positions).
- **The yard's traffic and parking use one car size** (4.69 m by 1.91 m). The Gravity is 5.03 m by 2.00 m. A
  per-vehicle envelope for driving and for stall clearance is not built.
- **Door clearance at the charger**: the arm is measured against each vehicle with its doors shut. A hinged door
  open on the arm's side while the arm is at the inlet is not measured for the six vehicles.
- An inlet's own door (the Cybercab's drop-down flap, a charge-port lid) is not modelled as a moving part.
