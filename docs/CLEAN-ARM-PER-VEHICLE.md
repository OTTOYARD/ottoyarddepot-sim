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
| The doors | `doorStore`, `fleetYard`, `doorPlan.ts` | The 3D yard already opened each vehicle's own doors by the door store's value. The 2D plan now draws them too (one line a door, from the same rig). A flank's doors are open only while the arm is at that flank ("The doors and the charge arm", below). |

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
| Ojai | 0.112 | 0.176 | 0.137 | 0.148 | 0.025 | 0.025 | 0.281 |
| I-PACE | 0.112 | 0.122 | 0.078 | 0.132 | 0.082 | 0.028 | 0.283 |
| Zoox | 0.112 | 0.127 | 0.077 | 0.108 | 0.024 | 0.022 | 0.342 |
| Cybercab | 0.112 | 0.133 | 0.064 | 0.082 | 0.113 | 0.027 | 0.235 |
| Model Y | 0.112 | 0.123 | 0.052 | 0.128 | 0.051 | 0.016 | 0.265 |
| Gravity | 0.112 | 0.138 | 0.064 | 0.158 | 0.025 | 0.027 | 0.250 |

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

**The rule, measured per vehicle** (`chargeArmBeside.measureChargeBeside`, stored with each program as `beside`,
measured again by `cleanArmFleet.test.ts`). The port flank's doors may be open only while the charge arm is STILL in
a place where it keeps 0.10 m from every port-flank door leaf at every position of the door's travel, shut to open.
A hinged leaf's free edge passes nearer the arm on its way than where it comes to rest, so the travel counts.

| Vehicle | Charge arm stowed at its home | Its home | Charge arm latched | Port flank during the charge |
|---|---|---|---|---|
| Ojai | over 0.37 m | the rail's middle | **-0.124 m: not allowed** (the open rear panel lies over the assumed inlet) | waits |
| I-PACE | 0.108 m | the rail's middle | **-0.122 m: not allowed** (the front door's leaf is at the inlet) | waits |
| Zoox | over 0.37 m | the rail's middle | **-0.123 m: not allowed** (the open panel lies over the assumed inlet) | waits |
| Cybercab | 0.129 m | parked 0.55 m toward the nose (-0.125 m at the middle: the raised door) | over 0.37 m | cleaned |
| Model Y | 0.147 m | parked 0.10 m toward the tail (0.071 m at the middle) | over 0.37 m | cleaned |
| Gravity | 0.134 m | parked 0.10 m toward the tail (0.055 m at the middle) | over 0.37 m | cleaned |

"Over 0.37 m" is the far limit of the measure. A park position is the place on the rail nearest its middle where
the stowed arm is clear; while that vehicle is in the stall it is the charge arm's home (`mateSequence.stepMateSeq`,
stop 0). The stowed run to it is more than 0.37 m from the body with the doors shut.

**The order** (`cleanSession.ts`, `cleanGate.ts`, `armGate.ts`, `roboticService.armSessionInput`):

1. The far flank's doors open (`doors_open`). The arm leaves home when the charge arm is still: latched, or stowed
   with no mate coming. This is the order it always had. The far doors are open while the charge arm mates; no
   charger stands on that side.
2. The arm works the far flank's openings. As it leaves that flank its doors shut.
3. The port flank's doors open as the arm swings to that flank, and only if the rule above holds now. If it does
   not, the arm WAITS at the last far opening's ready point, wand up, every door shut. The wand goes down only when
   the port doors are fully open.
4. The charge arm starts no mate and no release while a port-flank door is not shut, or while the cleaning arm
   moves over the car. A waiting arm blocks nothing: it waits so that the charge arm can move.
5. A charge that ends keeps its connector in while the cleaning arm works (the doors close, then the charge arm
   retracts: Chase, 2026-10-19). While the cleaning arm waits, the connector comes out, and the port flank is
   worked with the charge arm stowed.
6. A charger that faults with the connector in and a port door open: the cleaning arm comes out of that opening and
   up, the port doors shut, then the connector comes out. The arm works that opening again when the charge arm is
   stowed at its home.
7. If the twin's step ends while the arm waits, it goes home, and the home session says the port flank was not done
   (`CleanSession.portNotDoneFor`; the car's card says so). Nothing shows it as cleaned.

**What that gives, per vehicle** (`cleanInterlock.test.ts` drives the two gates together, one frame at a time, and
measures the charge arm where the gate has it against every door leaf where the session has it):

| Vehicle | A clean and a charge together (step 5.8 min, charge longer) | Cabin stop, no charge | Charge ends at 120 s | Worst charge arm to a door leaf |
|---|---|---|---|---|
| Ojai | far flank only: 1 of 2 openings, waits 175 s, **port flank not done** | 2 of 2 | 2 of 2 (waits 15 s) | over 0.37 m |
| I-PACE | far flank only: 2 of 4, waits 226 s, **port flank not done** | 4 of 4 | 4 of 4 (waits 16 s) | 0.108 m |
| Zoox | far flank only: 1 of 2, waits 175 s, **port flank not done** | 2 of 2 | 2 of 2 (waits 14 s) | over 0.37 m |
| Cybercab | 2 of 2 during the charge | 2 of 2 | 2 of 2 | 0.129 m |
| Model Y | 4 of 4 during the charge | 4 of 4 | 4 of 4 | 0.152 m |
| Gravity | 4 of 4 during the charge | 4 of 4 | 4 of 4 | 0.134 m |

A charger fault at 100 s and at 230 s: every opening is still cleaned on all six, and both arms are home inside the
step. In every frame of every case: no port door open unless the rule holds, no charge-arm motion with a port door
open, the wand down only at a flank whose doors are fully open, and at the end both arms home and every door shut.

**What changed for the generic car.** Its joints in every phase are bit for bit what they were
(`cleanProgramGeneric.test.ts`). Its doors changed: the far flank's doors open in `doors_open` and shut during the
swing to the port flank (they stood open to the end); the port flank's doors open during that swing (they opened at
the start) and shut in `doors_close`. Both of its states are allowed, so it never waits and its timing is the same.
Since the generic rule is "latched allowed", a car the twin does not name is cleaned on both flanks during its charge.

**What is left.**

- **For the Ojai, the I-PACE and the Zoox the port flank is not cleaned during a charge.** It needs a clean step
  that is open when the charge arm is stowed: after the charge, or on a cabin stop with no charge. The twin runs the
  cabin clean during the charge today. A clean step after the charge for these three was **tried on the engine and
  is OFF** (otto-q-core 0827 and 0828, 2026-11-13; Chase: "clean after charge is fine"). With it on, the arm's clean
  started in the last minutes of the charge and ran on after it, and it missed about 4 in 10 of these cars' arm
  cleans on two runs (40 of 72 charged visits cleaned on run c86b46e1, against 10 of 10 with it off; otto-q-core
  `db/checks/0491`). So the setting `cabin_robot_after_charge` is 0 at the twin depot. Until a version that does not
  miss is on, a charging Ojai, I-PACE or Zoox leaves with its left half not cleaned by the arm, and the session says
  so.
- The Ojai's and the Zoox's inlet positions are assumptions. An inlet clear of the open panel would let them be
  cleaned latched.
- The charge arm's drawn base and joints are each view's own play of `stepMateSeq` (3D, 2D) with the same inputs;
  the gate plays a third for the interlock and reads a state only after it has been still for 1 s. The views do not
  read the gate's play.
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
  cleans (about 64 s each against 148 s) and has 91 s of motion against 52 s.

## Not done

- No per-vehicle clean poses were added to `cad/spec/poses.json`, and `robots.json` did not change. The CAD clash
  check was not needed and was not run.
- The cleaning arm's CAD against each vehicle (the `cadYard.test.ts` check, per vehicle) was not built. The
  procedural capsules were measured.
- Nothing was looked at in the running twin, 2D or 3D, for the programs or for the door order.
- The wash machine still works to the generic car.
