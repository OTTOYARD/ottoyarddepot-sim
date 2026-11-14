# The cleaning arm, per vehicle

Chase, 2026-11-13: *"Make sure you train all robotics individually for each vehicle type ... interior detail or
vacuuming. Our system knows which car is pulling into which stall so that should activate different training sets
for our robotics. ... Make sure all clearance and individual robotics match per vehicle."*

Until that day the OTTO-CLEAN ARM had one program, written by hand for the yard's one generic car. It now has one
program a vehicle. This page says how a program is made, what each one cleans, what it measured, what it does not
reach, and what is short. Every number is from a test named beside it, run on 2026-11-13; the per-opening door rule
and its numbers are from 2026-11-14. All of it is geometry in the twin: no real arm has been run on a real car.

## How it works

| Step | Where | What |
|---|---|---|
| The car's cabin | `src/lib/fleetModels/cabin.ts` | `cabinProfile(spec)`: door openings, open door leaves, seats, floor and headliner, derived from the vehicle's own spec by the rules the model is drawn with. Nothing is typed per vehicle. |
| The program | `src/lib/ottoCleanArm/cleanArmPose.ts` | A `CleanProgram` is a list of visits. A visit is one door opening: its strokes, its aperture plane, its swing-in height and yaw, its ready point. |
| The chain | `cleanArmSpec.cleanChainFor` | Eight moves a visit (swing, lower, descend, enter, clean, exit, ascend, raise). Two visits on the generic car and the Cybercab, three on the Ojai and the Zoox, four on a four-door car (`clean_a` .. `clean_d`). |
| The generic car | `GENERIC_PROGRAM` | The old numbers. `cleanProgramGeneric.test.ts` pins its joints to the old code's, to the last bit (712 poses). |
| A fleet vehicle | `cleanProgramFleet.ts` | Made BY RULE from the cabin: in by the door, an air pass under the headliner, each seat's cushion then its back, the floor deep, the floor by the door. Each stroke's wand is searched over the door opening; only a wand that holds every margin with room to spare, and has a way out, is kept. What has none is left out and named. |
| The stored file | `programs/fleetPrograms.json` | The yard reads this and does no search. `cleanProgramFleet.test.ts` makes all six again and fails when the file differs (`CLEAN_PROGRAM_WRITE=1` rewrites it). |
| Which program | `cleanGate` -> `cleanSession` | The twin's row names the car (`fleetModelKeyFor`). The gate passes the key as a cycle starts, the session keeps it to the end, and the 3D arm, the 2D plan and the Robotics tab's follow all draw `cleanSessionJoints(session)`. A car the row does not name gets the generic program. |
| The doors | `doorStore`, `fleetYard`, `doorPlan.ts` | The 3D yard already opened each vehicle's own doors by the door store's value. The 2D plan now draws them too (one line a door, from the same rig). The far flank's doors are open only while the arm is at that flank. On the charger's flank only the doors of the opening the arm is at are open, each door by its own value (`DoorState.leftEach` / `rightEach`, since 2026-11-14; "The doors and the charge arm", below). |

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
| Waymo Ojai | 2 sliding, no pillar | 3 (one opening a flank; on the charger's flank it is worked twice, see below) | -0.62 .. 0.38 | air pass (1 point), rear seat cushion, floor deep (1 point), floor by the door (1 point) | 10 |
| Waymo I-PACE | 4 hinged | 4 (front and rear a flank) | front 0.09 .. 0.41, rear -1.14 .. -0.78 | front: air pass (1 point), front seat cushion. Rear: air pass, rear seat cushion | 6 + 7 |
| Zoox | 2 sliding, no pillar | 3 (as the Ojai) | -0.40 .. 0.40 | air pass, front seat back, rear seat cushion and back, floor deep, floor by the door | 19 |
| Cybercab | 1 butterfly | 2 | -1.20 .. -0.54 (behind the raised door; the wand goes in at a yaw) | air pass (1 point), seat cushion | 6 |
| Model Y | 4 hinged | 4 | front 0.06 .. 0.48, rear -1.13 .. -0.82 | front: air pass (1 point), front seat cushion and back. Rear: air pass, rear seat cushion | 9 + 7 |
| Gravity | 4 hinged | 4 | front 0.08 .. 0.54, rear -1.08 .. -0.77 | front: air pass (1 point), front seat cushion. Rear: air pass, rear seat cushion, floor deep (1 point), floor by the door (1 point) | 6 + 15 |

A flank's visit cleans its own half of the cabin: its own front seat, and its half of a bench.

**The visit with one panel open (Ojai and Zoox, the charger's flank only, since 2026-11-14).** Two sliding panels make
these vehicles' one opening. The open rear panel lies over the assumed inlet, so the whole opening cannot be open
while the connector is in. The front panel alone is clear of the latched charge arm (over 0.37 m). The generator
makes a program for the cabin with only that panel open (`cabinProfile(spec, ['FR'])`: the shut panel is the body, the
opening is the front panel's own part), by the same rules and the same margins. Both fit. Nothing was relaxed.

| Vehicle | Opening with the front panel only (m along the car) | Wrist run | Cleans | Keyframes |
|---|---|---|---|---|
| Ojai | -0.04 .. 0.62 (0.66 m wide; the whole opening is -0.86 .. 0.62) | -0.74 .. 0.38, the wand in at a 15 degree yaw | air pass, front seat cushion | 7 |
| Zoox | 0.00 .. 0.60 (the whole opening is -0.60 .. 0.60) | -0.70 .. 0.40 | air pass, front seat back, floor deep, floor by the door (the front half of the floor) | 12 |

It does not reach the rear seat on either vehicle: no wand through the front part reaches it inside the arm's travel.
On the Ojai it reaches the front seat's cushion, which the whole opening's program does not. The far flank has no
such visit, so the Ojai's right front cushion is still not cleaned.

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
| Ojai | 0.112 | 0.163 | 0.122 | 0.134 | 0.025 | 0.025 | 0.325 |
| I-PACE | 0.112 | 0.122 | 0.078 | 0.132 | 0.082 | 0.028 | 0.230 |
| Zoox | 0.112 | 0.127 | 0.038 | 0.108 | 0.024 | 0.022 | 0.342 |
| Cybercab | 0.112 | 0.133 | 0.064 | 0.082 | 0.113 | 0.027 | 0.235 |
| Model Y | 0.112 | 0.123 | 0.052 | 0.128 | 0.051 | 0.016 | 0.265 |
| Gravity | 0.112 | 0.138 | 0.064 | 0.158 | 0.025 | 0.027 | 0.250 |

- The Ojai's, I-PACE's and Zoox's rows were measured again on 2026-11-14 with the per-opening order. The Zoox's
  0.038 m is the wand's way out of the visit with one panel open (the floor is 0.03 m). A visit made with one panel
  open is measured in the cabin with that panel only: the shut panel is the body.
- "Links to body" is 0.112 m on every vehicle because the wrist's standoff (0.20 m) less the mast's radius (0.088 m)
  fixes it. The body is taken at its full width at every height.
- "Robots apart" is the cleaning arm against the OTTO-CHARGE ARM on the car's left, in every pair of poses the
  interlocks allow: the cleaning arm anywhere in its cycle with the charge arm stowed at its home or latched at that
  vehicle's own mate (`solveMate`); and the charge arm moving (its mate, its release, its base on its rail) with the
  cleaning arm home, swinging over the car, or waiting at a ready point with its wand up. The charge arm is its
  links as capsules plus its two connectors, not its CAD. The CAD pair is held for the generic car only
  (`cadYard.test.ts`).
- Every joint stays inside the arm's travel and reach on every vehicle (elbow, mast, wand extension, wrist and
  nozzle pitch).

Parked and swinging, over the vehicle's highest point, which is its roof equipment, not `dims.height`:

| Vehicle | Highest point (m) | Arm over it (m) |
|---|---|---|
| Ojai | 2.040 (roof lidar) | 0.119 |
| I-PACE | 1.920 (roof lidar) | 0.239 |
| Zoox | 1.936 | 0.223 |
| Cybercab | 1.407 | 0.752 (0.233 from the door, anywhere in its travel) |
| Model Y | 1.624 | 0.535 |
| Gravity | 1.728 | 0.431 |

The arm was raised 0.06 m on 2026-11-13 (`CLEAN_ARM.link1Y` 3.48). Before that it parked 0.059 m over the Ojai's
roof lidar.

## The doors and the charge arm

Chase, 2026-11-12: *"If a car can't be cleaned from over head with doors open AND being charged simultaneously, then
they can charge first, then clean with doors open (if both services are needed). I'd prefer simultaneously, if at
all possible and design allows."*

Every charger stands on the car's left. The cleaning arm calls that the PORT flank, and the other the FAR flank. An
open left door leaf is where the charge arm stands or passes: with both flanks' doors open for the whole cycle, as
it was, the charge arm overlapped an open left leaf on all six vehicles (by 0.064 m to 0.141 m).

**The rule, measured per opening** (`chargeArmBeside.measureOpeningBeside`, stored with each port-flank visit as
`beside`, measured again by `cleanArmFleet.test.ts`). Until 2026-11-14 the rule was for the whole flank
(`measureChargeBeside`, still stored as the program's `beside`): if one leaf was in the charge arm's way, every door
of that flank waited. Chase, 2026-11-14: clean and charge at the same time where the design allows, one after the
other only where clearance forbids it. So the rule is now per opening. The doors of a port-flank opening may be open
only while the charge arm is STILL in a place where it keeps 0.10 m from THOSE doors' leaves at every position of
their travel, shut to open. A hinged leaf's free edge passes nearer the arm on its way than where it comes to rest,
so the travel counts. The flank's other doors are shut while the arm works that opening, and a shut door is the body.

| Vehicle | Port-flank opening (its doors) | Charge arm stowed at its home | Charge arm latched | During the charge |
|---|---|---|---|---|
| Ojai | door, front panel only | over 0.37 m | over 0.37 m | **worked** |
| Ojai | door, both panels | over 0.37 m | **-0.124 m: not allowed** (the open rear panel lies over the assumed inlet) | waits |
| I-PACE | rear door | 0.364 m | over 0.37 m | **worked** |
| I-PACE | front door | 0.108 m | **-0.122 m: not allowed** (the front door's leaf is at the inlet) | waits |
| Zoox | door, front panel only | over 0.37 m | over 0.37 m | **worked** |
| Zoox | door, both panels | over 0.37 m | **-0.123 m: not allowed** (the open rear panel lies over the assumed inlet) | waits |
| Cybercab | door | 0.129 m | over 0.37 m | worked |
| Model Y | front door / rear door | 0.147 m / 0.239 m | over 0.37 m | worked |
| Gravity | front door / rear door | 0.134 m / 0.152 m | over 0.37 m | worked |

"Over 0.37 m" is the far limit of the measure. The charge arm's home is the rail's middle for the Ojai, the I-PACE
and the Zoox, and a park position for the others (Cybercab 0.55 m toward the nose, Model Y and Gravity 0.10 m
toward the tail: at the middle the stowed arm is -0.125 m, 0.071 m and 0.055 m from a leaf). A park position is the
place on the rail nearest its middle where the stowed arm is clear of every leaf of the flank; while that vehicle is
in the stall it is the charge arm's home (`mateSequence.stepMateSeq`, stop 0). The stowed run to it is more than
0.37 m from the body with the doors shut.

**The order** (`cleanSession.ts`, `cleanGate.ts`, `armGate.ts`, `roboticService.armSessionInput`):

1. The far flank's doors open (`doors_open`). The arm leaves home when the charge arm is still: latched, or stowed
   with no mate coming. The far doors are open while the charge arm mates; no charger stands on that side.
2. The arm works the far flank's openings. As it leaves that flank its doors shut.
3. On the port flank the program puts first the openings that may be worked with the connector in (the I-PACE's
   rear door before its front door; the Ojai's and Zoox's front panel before the whole opening). The doors of an
   opening open as the arm swings to it, and only if that opening's rule holds now. Only that opening's doors are
   open: every other door of the flank is shut. The wand goes down only when those doors are fully open (and, at a
   visit made with one panel open, when the other panel is shut).
4. If the next opening's rule does not hold, the arm WAITS at the ready point of the opening it last worked, wand
   up, every door shut.
5. The charge arm starts no mate and no release while a port-flank door is not shut, or while the cleaning arm
   moves over the car. A waiting arm blocks nothing once its doors are shut: it waits so that the charge arm can
   move. (A wait that begins at a port opening begins with that opening's door still closing. The connector stays
   in for those 3 s: `cleanGate.holdsConnector`. `cleanInterlock.test.ts` found this on 2026-11-14, before it
   was merged.)
6. A charge that ends keeps its connector in while the cleaning arm works (the doors close, then the charge arm
   retracts: Chase, 2026-10-19). While the cleaning arm waits, the connector comes out, and the openings that
   waited are worked with the charge arm stowed at its home.
7. A charger that faults with the connector in and a port door open: the cleaning arm comes out of that opening and
   up, the port doors shut, then the connector comes out. The arm works that opening again when the charge arm is
   stowed at its home.
8. If the twin's step ends while the arm waits, it goes home, and the home session says the port flank was not
   finished (`CleanSession.portNotDoneFor`, with `portPartDone` when at least one of its openings was cleaned; the
   car's card says which). Nothing shows it as cleaned.

On the I-PACE the swing across the roof to the rear door goes by the front door's ready point
(`CleanVisit.swingVia`, 3 s more). The straight swing to the rear door measured 0.011 m between the nozzle and the
charge arm's forearm, with the charge arm on its rail 2/16 of the way from its home to its mate (a pair the
interlock does not allow, held all the same). By the front door's ready point the two robots keep 0.230 m.

**What that gives, per vehicle** (`cleanInterlock.test.ts` drives the two gates together, one frame at a time, and
measures the charge arm where the gate has it against every door leaf where the session has that door):

| Vehicle | A clean and a charge together (step 5.8 min, charge longer) | Cabin stop, no charge | Charge ends at 120 s | Worst charge arm to a door leaf |
|---|---|---|---|---|
| Ojai | 2 of 3 visits during the charge (the far flank, and the port flank with its front panel open). The whole port opening waits 149 s, **not done** | 3 of 3 | 3 of 3 (waits 18 s) | over 0.37 m |
| I-PACE | 3 of 4 openings during the charge (far front, far rear, port rear). The port front door waits 140 s, **not done** | 4 of 4 | 4 of 4 (waits 17 s) | 0.108 m |
| Zoox | 2 of 3 visits during the charge (as the Ojai). The whole port opening waits 149 s, **not done** | 3 of 3 | 3 of 3 (waits 17 s) | over 0.37 m |
| Cybercab | 2 of 2 during the charge | 2 of 2 | 2 of 2 | 0.129 m |
| Model Y | 4 of 4 during the charge | 4 of 4 | 4 of 4 | 0.157 m |
| Gravity | 4 of 4 during the charge | 4 of 4 | 4 of 4 | 0.134 m |

A charger fault at 100 s and at 230 s: every opening is still cleaned on all six, and both arms are home inside the
step. In every frame of every case: no port door open unless that door's own leaf is measured clear of the charge
arm where it is, no charge-arm motion with a port door open, the wand down only at an opening whose doors are fully
open, and at the end both arms home and every door shut.

**An opening that waited is done after the connector is out. How long that takes** (`cleanInterlock.test.ts`,
`AFTER-CHARGE ...`). The case: the twin's step is 348 s, and the charge ends at the moment the arm starts to wait.

| Vehicle | Arm work during the charge | After the charge ends, to the arm home | Of that: cleaning | Of that: the connector out, the door, the arm's moves |
|---|---|---|---|---|
| Ojai | 201 s (2 of 3 visits; cleans of 88 s and 103 s) | 147 s | 102 s (the whole port opening) | 45 s |
| I-PACE | 211 s (3 of 4 openings; cleans of 61 s, 73 s and 90 s) | 137 s | 93 s (the port front door) | 44 s |
| Zoox | 201 s (2 of 3 visits; cleans of 88 s and 103 s) | 147 s | 103 s (the whole port opening) | 44 s |
| Cybercab, Model Y, Gravity | the whole cycle (home at 350 s) | 0 s | - | - |

- The 44 s to 45 s does not change with the step: about 21 s from the end of the charge to the arm's first move
  (the connector comes out, 18 s in this case by the twin's demate allowance, and the charge arm is still for 1 s),
  then 23.5 s of the arm's own moves at one opening and home.
- The cleaning time is what the twin's step leaves. The arm cleans for no less than 20 s at an opening
  (`CLEAN_SIDE_MIN_S`). So the least time on the post after a charge is about 65 s. That number is the sum of the
  fixed part and the 20 s floor. It was not played as a case.
- Before 2026-11-14 the whole port flank waited: the I-PACE's two port openings, and the Ojai's and Zoox's one.

**What changed for the generic car.** Its joints in every phase are bit for bit what they were
(`cleanProgramGeneric.test.ts`). Its doors changed: the far flank's doors open in `doors_open` and shut during the
swing to the port flank (they stood open to the end); the port flank's doors open during that swing (they opened at
the start) and shut in `doors_close`. Both of its states are allowed, so it never waits and its timing is the same.
Since the generic rule is "latched allowed", a car the twin does not name is cleaned on both flanks during its charge.
Its visits name no doors, so its port flank keeps one value for every door (`doorPortBy` is absent).

**What changed on 2026-11-14 for the vehicles that never waited** (Cybercab, Model Y, Gravity). Their openings, strokes
and order are the same. On the charger's flank of the Model Y and the Gravity the front door now shuts as the arm
swings to the rear door, and the rear door opens during that swing: before, both stood open for both visits.

**What is left.**

- **For the Ojai, the I-PACE and the Zoox one port-flank visit still waits for the connector to come out**: the
  I-PACE's front door, and the Ojai's and Zoox's whole opening (their rear seat is reached only through it). It needs
  a clean step that is open when the charge arm is stowed: after the charge, or on a cabin stop with no charge. The
  twin gives these three a clean step after the charge **since 2026-11-14 01:56 UTC** (otto-q-core 0827, 0828 and
  0830; Chase: "clean after charge is fine"). The arm's clean starts in the last minutes of the charge, or at the
  moment the charge is stopped, and the car stays on its post until the arm is home (one cycle, 5.8 min, at most).
  The first two versions missed about 4 in 10 of these cars' arm cleans (0827, 0828); 0830 starts the clean where
  the charge is stopped, and on its first run (c8913ea2) none was missed: 135 charged visits, 107 cleaned by the
  arm, 28 an owner's immediate turnaround (otto-q-core `db/checks/0491`). One run, made before the per-opening order.
- **The engine does not use the shorter time yet.** It holds the car for up to a whole cycle after the charge. With
  the per-opening order the arm needs 137 s to 147 s after the charge in the case measured above, and about 65 s at
  the least. To start the clean step during the charge and hold the car only for what waited is an engine change
  (otto-q-core). It was not made here.
- An owner's immediate turnaround of these three is not held past its charge for a routine clean, so it gets none; a
  needed tidy is still done. If the twin gave it a clean step during its charge, the arm would now do the far flank
  and one port visit in it.
- Not watched in the running twin: the arm at one port opening with the connector in, and the arm doing what waited
  after the connector is out.
- The Ojai's right front seat cushion: the visit with the front panel only reaches it on the charger's flank. No such
  visit was added on the far flank.
- On a cabin stop with no charge the Ojai and the Zoox still play the visit with one panel open, then the whole
  opening. On the Zoox that is the front half done twice. To leave that visit out when the whole opening may open
  at once was not built.
- The Ojai's and the Zoox's inlet positions are assumptions. An inlet clear of the open panel would let them be
  cleaned latched.
- The charge arm's drawn base and joints are each view's own play of `stepMateSeq` (3D, 2D) with the same inputs;
  the gate plays a third for the interlock and reads a state only after it has been still for 1 s. The views do not
  read the gate's play.
- A door that may not be open with the connector in stays shut for the whole charge: the rule does not look for a
  part of its travel that is clear.
- The door leaves' travel is measured at 50 positions (about 4 cm of a hinged leaf's free edge a step).
- The charge arm is capsules here, not its CAD.

## Assumptions

- The cabin's inner face is the body skin moved in 0.065 m. The floor, the seats, the dash and the steering wheel
  are the boxes the model draws; a cushion is solid to the floor; the steering wheel is counted on both flanks.
- Two hinged doors that share a cut line have a 0.10 m pillar between their openings. The model draws none.
- Door travel, swing angles and the Cybercab's hinge line are the specs' own, and several are estimates
  (`docs/FLEET-MODELS.md`).
- A door leaf is a cloud of points 25 mm apart; 18 mm is taken off every distance to it.
- Each vehicle stands with its middle on the stall's middle, as the yard draws it.
- The twin's cabin-clean step is one length for every vehicle (5.8 min). A four-visit car shares it between four
  cleans (about 64 s each against 148 s) and has 91 s of motion against 52 s (94 s on the I-PACE). A three-visit car
  (Ojai, Zoox) shares it between three.
- The left flank's doors and leaves are the mirror of the right flank's (the cabin profile holds the right flank).
  A door's id in a stored program is the right flank's ("FR", "RR"); on the charger's flank it is the left door
  that mirrors it.

## Not done

- No per-vehicle clean poses were added to `cad/spec/poses.json`, and `robots.json` did not change. The CAD clash
  check was not needed and was not run.
- The cleaning arm's CAD against each vehicle (the `cadYard.test.ts` check, per vehicle) was not built. The
  procedural capsules were measured.
- Nothing was looked at in the running twin, 2D or 3D, for the programs or for the door order, the doors drawn each
  by its own value included.
- The wash machine still works to the generic car.
