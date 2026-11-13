# The cleaning arm, per vehicle

Chase, 2026-11-13: *"Make sure you train all robotics individually for each vehicle type ... interior detail or
vacuuming. Our system knows which car is pulling into which stall so that should activate different training sets
for our robotics. ... Make sure all clearance and individual robotics match per vehicle."*

Until that day the OTTO-CLEAN ARM had one program, written by hand for the yard's one generic car. It now has one
program a vehicle. This page says how a program is made, what each one cleans, what it measured, what it does not
reach, and what is short. Every number is from a test named beside it, run on 2026-11-13. All of it is geometry in
the twin: no real arm has been run on a real car.

## How it works

| Step | Where | What |
|---|---|---|
| The car's cabin | `src/lib/fleetModels/cabin.ts` | `cabinProfile(spec)`: door openings, open door leaves, seats, floor and headliner, derived from the vehicle's own spec by the rules the model is drawn with. Nothing is typed per vehicle. |
| The program | `src/lib/ottoCleanArm/cleanArmPose.ts` | A `CleanProgram` is a list of visits. A visit is one door opening: its strokes, its aperture plane, its swing-in height and yaw, its ready point. |
| The chain | `cleanArmSpec.cleanChainFor` | Eight moves a visit (swing, lower, descend, enter, clean, exit, ascend, raise). Two visits on a car with one opening a flank, four on a four-door car (`clean_a` .. `clean_d`). |
| The generic car | `GENERIC_PROGRAM` | The old numbers. `cleanProgramGeneric.test.ts` pins its joints to the old code's, to the last bit (712 poses). |
| A fleet vehicle | `cleanProgramFleet.ts` | Made BY RULE from the cabin: in by the door, an air pass under the headliner, each seat's cushion then its back, the floor deep, the floor by the door. Each stroke's wand is searched over the door opening; only a wand that holds every margin with room to spare, and has a way out, is kept. What has none is left out and named. |
| The stored file | `programs/fleetPrograms.json` | The yard reads this and does no search. `cleanProgramFleet.test.ts` makes all six again and fails when the file differs (`CLEAN_PROGRAM_WRITE=1` rewrites it). |
| Which program | `cleanGate` -> `cleanSession` | The twin's row names the car (`fleetModelKeyFor`). The gate passes the key as a cycle starts, the session keeps it to the end, and the 3D arm, the 2D plan and the Robotics tab's follow all draw `cleanSessionJoints(session)`. A car the row does not name gets the generic program. |
| The doors | `doorStore`, `fleetYard`, `doorPlan.ts` | The 3D yard already opened each vehicle's own doors by the door store's value. The 2D plan now draws them too (one line a door, from the same rig). Both flanks' doors open for the whole cycle, as before. |

**Where the mast stands.** An open door leaf is a wall beside its opening. A hinged leaf stands out from its hinge,
and its window frame leans back over the opening (0.18 m on the I-PACE). A sliding panel lies along the body. A
butterfly door is a roof over the opening. The mast comes down only where it keeps 0.10 m from every leaf (the
"wrist run" below), 0.20 m out from the vehicle's widest point, and the wand reaches in from there. On a four-door
car the two wrist runs are each side of the rear door's leaf, so the arm leaves the first opening, lifts its wand
level at full height, swings over the leaf and comes down at the second.

## What each program does

`cleanProgramFleet.test.ts` prints these (`PROGRAM ...`).

| Vehicle | Doors | Visits | Wrist run (m along the car, + nose) | Cleans | Keyframes a flank |
|---|---|---|---|---|---|
| Waymo Ojai | 2 sliding, no pillar | 2 (one opening a flank) | -0.62 .. 0.38 | air pass (1 point), rear seat cushion, floor deep (1 point), floor by the door (1 point) | 10 |
| Waymo I-PACE | 4 hinged | 4 (front and rear a flank) | front 0.09 .. 0.41, rear -1.14 .. -0.78 | front: air pass (1 point), front seat cushion. Rear: air pass, rear seat cushion | 6 + 7 |
| Zoox | 2 sliding, no pillar | 2 | -0.40 .. 0.40 | air pass, front seat back, rear seat cushion and back, floor deep, floor by the door | 19 |
| Cybercab | 1 butterfly | 2 | -1.20 .. -0.54 (behind the raised door; the wand goes in at a yaw) | air pass (1 point), seat cushion | 6 |
| Model Y | 4 hinged | 4 | front 0.06 .. 0.48, rear -1.13 .. -0.82 | front: air pass (1 point), front seat cushion and back. Rear: air pass, rear seat cushion | 9 + 7 |
| Gravity | 4 hinged | 4 | front 0.08 .. 0.54, rear -1.08 .. -0.77 | front: air pass (1 point), front seat cushion. Rear: air pass, rear seat cushion, floor deep (1 point), floor by the door (1 point) | 6 + 15 |

A flank's visit cleans its own half of the cabin: its own front seat, and its half of a bench.

## What is not reached

Each line is the generator's own reason (`notReached` in the stored file). None is a tuning choice.

- **Seat backs on the forward-facing cars** (I-PACE both rows, Ojai both rows, Cybercab, Model Y rear, Gravity both
  rows). To face a seat back the nozzle must point at it, so the mast must stand ahead of the seat. On a hinged
  car that is where the open door leaf stands. The Model Y's front seat back is the one that is reached.
- **Most floors on the forward-facing cars.** The footwell is ahead of the seat, the wrist run is abeam the seat,
  and the wand would cross the cushion's front corner. The cabin model takes each cushion as solid to the floor.
  Reached: the Zoox (both), the Ojai and the Gravity's rear door (one point each).
- **The Ojai's front seat** (cushion and back): every wand that reaches it has no way out past the seat.
- **The Zoox's front seat cushion**: a wand reaches it, and the way out from between two of its strokes comes
  0.009 m off the seat (0.018 m is kept). The rear bench, the mirror of it, is reached.
- **The air pass is one point, not a sweep**, at five of the nine openings.

What would reach more: a nozzle that turns about the wand's axis (seat backs), a thinner mast or a standoff under
0.20 m (a longer wrist run), a way out that does not tip the wand 30 degrees down over a seat (`exitPose`), and a
cabin model with the real space under a seat. None was changed here.

## Measured margins

`cleanArmFleet.test.ts`, every pose of every cycle, both stall sides (clean phases at 1/240, moves at 1/40), plus the
way out from 40 points an opening. Metres. The floor each is held to is in brackets.

| Vehicle | Links to body [0.10] | Links to a door leaf [0.10] | Wand in the opening [0.03] | Wand outside the door [0.03] | Cabin room [0] | Seats [0.01] | Robots apart [0.10] |
|---|---|---|---|---|---|---|---|
| Ojai | 0.112 | 0.176 | 0.137 | 0.118 | 0.025 | 0.025 | 0.250 |
| I-PACE | 0.112 | 0.122 | 0.078 | 0.132 | 0.082 | 0.028 | 0.253 |
| Zoox | 0.112 | 0.127 | 0.077 | 0.108 | 0.024 | 0.022 | 0.311 |
| Cybercab | 0.112 | 0.133 | 0.064 | 0.082 | 0.113 | 0.027 | 0.274 |
| Model Y | 0.112 | 0.150 | 0.052 | 0.128 | 0.051 | 0.016 | 0.243 |
| Gravity | 0.112 | 0.138 | 0.064 | 0.158 | 0.025 | 0.027 | 0.223 |

- "Links to body" is 0.112 m on every vehicle because the wrist's standoff (0.20 m) less the mast's radius (0.088 m)
  fixes it. The body is taken at its full width at every height.
- "Robots apart" is the cleaning arm against the OTTO-CHARGE ARM on the car's left, stowed and latched at that
  vehicle's own mate (`solveMate`), and the cleaning arm home against the charge arm's whole mate. The charge arm
  is its links as capsules plus its two connectors, not its CAD. The CAD pair is held for the generic car only
  (`cadYard.test.ts`).
- Every joint stays inside the arm's travel and reach on every vehicle (elbow, mast, wand extension, wrist and
  nozzle pitch).

Parked and swinging, over the vehicle's highest point, which is its roof equipment, not `dims.height`:

| Vehicle | Highest point (m) | Arm over it (m) |
|---|---|---|
| Ojai | 2.040 (roof lidar) | **0.059** |
| I-PACE | 1.920 (roof lidar) | 0.179 |
| Zoox | 1.936 | 0.163 |
| Cybercab | 1.407 | 0.692 (0.174 from the raised door) |
| Model Y | 1.624 | 0.475 |
| Gravity | 1.728 | 0.371 |

## What is short

Two things do not hold 0.10 m. The test states each as a number and fails if it moves by more than 5 mm. Neither
margin was relaxed.

1. **The stowed arm is 0.059 m over the Ojai's roof lidar.** The drawn lidar stands 0.20 m on a mark at 1.84 m, so
   it tops at 2.04 m, 0.285 m over the published 1.755 m height that `fleetEnvelope.test.ts` measures against. The
   arm's wrist parks at 2.099 m, right over it. 0.041 m is missing. Raise the arm 0.05 m (`CLEAN_ARM.link1Y`), or
   park the wrist 0.25 m further ahead (`STOW_POLAR`). Both change the generic poses and the CAD pose file, so
   neither was done here. First check the lidar's height: its position is read off photographs.
2. **With the left doors open, the charge arm is in them, on all six vehicles.** Every charger stands on the car's
   left. The doors open on both flanks for a clean, and they open while the charge arm mates. Measured, charge arm
   (capsules) to the nearest open left door leaf, negative is overlap:

   | Vehicle | Stowed at the rail's middle | On its way and at the mate | Latched |
   |---|---|---|---|
   | Ojai | 0.378 | -0.122 | -0.122 (the open rear panel lies over the assumed inlet) |
   | I-PACE | 0.149 | -0.141 (passes the front door's leaf) | -0.120 |
   | Zoox | 0.378 | -0.122 | -0.121 (the open panel lies over the assumed inlet) |
   | Cybercab | -0.077 (the raised door reaches the stowed arm) | -0.077 | 0.378 |
   | Model Y | 0.152 | -0.064 | 0.378 |
   | Gravity | 0.184 | -0.138 | 0.378 |

   This is a choreography and door-order problem, not the cleaning arm's reach. The generic car's one door a flank
   keeps 0.10 m from the charge arm (`cleanArmClearance.test.ts`); the real doors are longer and open wider. What
   would fix it is a decision for the twin and for Chase: open the left doors only when the charge arm is latched
   or parked clear, and only as far as clears it; or clean the left flank only on a car that is not on charge; and
   for the Ojai and the Zoox, whose inlet positions are assumptions, move the assumed inlet clear of the open panel.

## Assumptions

- The cabin's inner face is the body skin moved in 0.065 m. The floor, the seats, the dash and the steering wheel
  are the boxes the model draws; a cushion is solid to the floor; the steering wheel is counted on both flanks.
- Two hinged doors that share a cut line have a 0.10 m pillar between their openings. The model draws none.
- Door travel, swing angles and the Cybercab's hinge line are the specs' own, and several are estimates
  (`docs/FLEET-MODELS.md`).
- A door leaf is a cloud of points 25 mm apart; 18 mm is taken off every distance to it.
- Each vehicle stands with its middle on the stall's middle, as the yard draws it.
- The twin's cabin-clean step is one length for every vehicle (5.8 min). A four-visit car shares it between four
  cleans (about 64 s each against 148 s) and has 91 s of motion against 52 s.

## Not done

- No per-vehicle clean poses were added to `cad/spec/poses.json`, and `robots.json` did not change. The CAD clash
  check was not needed and was not run.
- The cleaning arm's CAD against each vehicle (the `cadYard.test.ts` check, per vehicle) was not built. The
  procedural capsules were measured.
- Nothing was looked at in the running twin, 2D or 3D.
- The wash machine still works to the generic car.
