# OTTO-TIRE: the robotic wheel service in each service bay

Chase, 2026-11-17: "I think we need robotic arms for service bays. Maybe just drill and arms to get tire off and on and
place tires or rack? Arms can probably be on rails again. Places old tires on one rack, grabs new tires from separate
rack. Sliding back and forth. Need full CAD build out. Make sure to integrate a tool/head that accounts for screws/nuts
that come off of the vehicle, and then have to be reapplied and tightened back on. It probably needs some kind of camera
input as well so it can visually see and confirm what it's doing on the arm. The lift can be automated when vehicles pull
in. Test everything and include electrical design for the machine and into the yard itself."

So each service bay gets one machine. The car drives in and stops on the lift mark. A lift rises out of the floor under
its sills and lifts it 0.50 m. A portal on 2 floor rails carries 2 wheel robots, one each side of the car. Each robot's
head takes the aero cover off, holds the wheel by its tyre, runs its 5 nuts off and keeps each nut in its own socket,
sets the old wheel in an OLD rack at the exit end, takes a new wheel from a NEW rack at the entrance end, puts it on,
runs the same nuts back and tightens each to the car's torque, and presses the cover back on. Cameras find each wheel,
its nuts and its studs, and check each step. The 2 robots change a front pair, then a rear pair.

Its two jobs, Chase, the same day: "Let's not do a flat, because that would require rolling the vehicle in on its rim
(not safe/advised). Flats will be brought in via tow truck (OTTOW workflow) and then jacked up in place at a parking spot
for it to receive a new tire. The tire robot stall needs to be for worn out tires and rotations (scheduled quarterly, and
only occurs a few times per simulation run)." So the machine fits a new set when a car's tread is worn, and rotates a
car's tyres once a quarter. A flat is not its work.

This file is the design. The numbers live in code, and the tests measure them:

| What | Where |
|---|---|
| The machine's dimensions, travel and cabinets | `src/lib/ottoTire/tireSpec.ts` (`TIRE_BAY` in `tireBayFit.ts`) |
| The program, made by rule for each fleet car, and its wheel facts | `src/lib/ottoTire/tireProgram.ts` |
| The CAD: every part, fastener and line | `cad/otto_cad/robots/tire_bay.py` (built by `cad/build.py tire_bay`) |
| The bay's feed from the depot's electrical yard, and the machine's one-line | `src/lib/siteService.ts` |
| Its footprint in the site plan's solids | `structurePlan.tireBaySolids` |
| The yard's drawing | `src/components/canvas/three/TireBay.tsx` |
| What the machine does in the yard, inside OTTO-Q's seat | `src/lib/ottoTire/tireSession.ts`, `src/engine/motion/tireGate.ts` |
| The car's height on the lift | `src/engine/motion/liftStore.ts`, read by `Vehicle3D.tsx` |

## What OTTO-Q decides, and what the twin draws

OTTO-Q decides which car's tyres the machine works on, and when. otto-q-core 0842 (applied 2026-11-17, 5:36 PM CT) gives
the engine two services of its own, in the `service_bay` lane, each required on the car's visit and finished before the
car leaves (CLAUDE.md rule 9):

- **`tire_replacement`**: the tread is worn, under 3.0 mm (the needs card's own 'due' line; critical under 2.7 mm). The
  bay exit fits a new set: the car's tread reads 8.0 mm and its rotation quarter starts again.
- **`tire_rotation`**: a quarter (2,190 h) since the last rotation. The bay exit starts the next quarter. A rotation due
  within 14 days rides along when the car is in the service bay for other required work, so the car does not come back
  for it. A car whose tyres are due for replacement is not also rotated.

A seat for either is 12 minutes, the longest program (10.1 min, the Waymo Ojai with its socket change) plus the drive on
and off. A seat that also has other service-bay work keeps that work's own length, and the machine works inside it. The
seeding draws worn tyres for about 1 car in 100 and rotations about 1.3 a day at the twin depot's 116 cars: "a few times
per simulation run". Before 0842 the needs card folded tyre wear into preventive maintenance, so a worn car was seated for
maintenance, and the exit reset the maintenance clock and never the tread (two cars in Chase's run 89ac9e74).

The twin draws what OTTO-Q decided. The snapshot's `bay_seat` says when the twin seated a car in a bay and when its timer
ends (0762), and since 0843 what the seat is for (`work`, the bay exit's own credit set, e.g. `["tire_rotation"]`). In
each service bay the motion driver plays the machine's program for the car's own model inside that window
(`tireGate.ts`, `tireSession.ts`): a replacement or a rotation, paced to end 20 s before the seat does, joining part way
through when the page opens mid-seat. A seat for other work (a fault repair, preventive maintenance) leaves the machine at
home. The car rises with the lift's pads (`liftStore`), and it may not move until the machine is home and the lift is
down. The beacon is cyan at home, green while it works and amber on its way home.

0844 closed a defect the first check run found: both of the decide tick's doors to the service bay admitted the same car
in one tick, and the second took back the first one's booking, so a rotation was seated for one minute. A tire job is
must-do on the needs card and required on the visit, so both doors saw it. Now the second door passes over a car the first
has already sent to a bay.

The cockpits (OTTO-PULSE, OrchestrAV) carry the machine's facts (`public/cad/robot-facts.json`), including its two
services.

## The bay

`TIRE_BAY` measures the bays as the site plan builds them (`structurePlan.OPS_SHELL`). The machine is designed for the
narrower half of either bay, from its drive line to the partition beside it: 4.211 m. Each end wall is 6.890 m from the
lift mark. The roof deck is 5.790 m up. The doors are 2.632 m each side of the drive line.

The frame is the CAD's: metres, origin at the lift mark on the floor (the drive line at plan y `BAY_STALL_Y`, where OTTO-Q
stops each car's axle midpoint), +Y up, +X west, +Z north. Cars come in by the south door and leave by the north door.

```
 north wall:  [power unit] [bay cabinet]               (conduits up to the building's cable tray, 4.4 m)
   +4.25  OLD racks        [portal parked here: beam 3.10 m up, a cover nest on each leg]       OLD racks
   +3.40  OLD racks                                                                              OLD racks
   +2.55  socket rack                                                                          socket rack
   +0.85                         ( front ram )            lift mark: 0
   -0.85                         ( rear ram  )
   -3.40  NEW racks                                                                              NEW racks
   -4.25  NEW racks                                                                              NEW racks
          rail at X +3.55 (and the floor chain outboard of it)                              rail at X -3.55
 south wall:  safety scanner, emergency stop post (the cars come in here)
```

## The machine

**The lift.** An in-ground twin-post lift. 2 hydraulic rams of 200 mm in 2.6 m casings under the floor, on the drive
line, 0.85 m each side of the lift mark. Each saddle carries 2 arms on worm slewing drives. An arm slides out on a rack
and pinion to the car's lift point (0.56 to 0.78 m from its pivot). A pad on each arm has a load cell and a camera that
looks at the lift point before the car leaves the floor. Each ram rises on its own until both its pads touch, then both
lift together: 0.50 m for the robots, 1.85 m for a person under the car. 2 toothed lock bars hang from each saddle, and a
pawl drops into a tooth every 75 mm. The robots start only with all 4 pawls in and the oil let off: the car stands on
steel. Lowered, the saddles and arms lie in recesses with their tops 10 mm under the floor, and the car drives over them.
Rated load 4,500 kg (both posts). At that load a ram works at 7.03 bar (`ramBar`).

**The power unit.** A 150 L tank (the rams take 116 L) with a 5 hp motor and a gear pump: 139 L/min, so both rams reach
1.85 m in 50 s. A 10,000 lb in-ground electric-hydraulic two-post lift lists 53 s to full rise and 24 s down (source
below). A valve block feeds and lowers each ram on its own and reads each line's pressure. The relief valve is set at
10 bar, so the pump takes 2.7 kW at worst against the motor's 3.7 kW (pump efficiency 0.85, ASSUMPTION).

**The portal.** 2 legs and a box beam on 2 floor rails 7.10 m apart, outside the door opening and the racks. Travel
±4.25 m, at 1 m/s, by a servo motor, a right-angle gearbox and a pinion on a rack in each end truck. The beam's underside
is 3.10 m up: 0.66 m over the tallest fleet car on the lift at service height. It waits at the exit end.

**Each wheel robot.** A trolley on 2 profile rails under the beam (1.10 to 2.90 m from the drive line). A ball slewing ring
under the trolley (-10 to 190 degrees: it faces the car, or the wall where the racks and its cover nest are). A slip ring
with a fibre rotary joint on the slew's axis, so the slew turns any way and no cable twists. A guide frame under the
slew, and a Z-beam that slides in it, 0.65 m of stroke (the head's axis 0.40 to 1.05 m above the floor). A joint actuator
with a strain-wave gear under the Z-beam's foot tilts the head ±6 degrees, for the wheel's camber. A steel box on the
guide frame holds the head's 5 nutrunner drives and the DC supply for its servo motors, so only the supply, EtherCAT and
one fibre cross the slip ring.

Why a portal, and not 2 arms on floor tracks (the first study): a wheel and its head are about 160 kg, past what the
OTTO-CHARGE ARM's arm carries. A robot that faces the car to work and the racks to store must turn round between them,
and on a floor track beside the car that turn swept 1.3 to 1.5 m and did not fit the 4.21 m to the partition with racks
behind it. Hung from a trolley, the mast's axis stands at the head's own centre and the turn sweeps 0.82 m
(`SLEW_SWEEP`). The floor stays clear for a person to walk round the car, and nothing stands in the car's path.

Why in-ground posts: the robots work at the car's sides, so nothing may stand there, and a two-post lift's columns did. A
flush double scissor (2 platforms in 0.30 m pits) was drawn first. Closed, its crossing beams stand 65 mm apart against
80 mm beams and 30 mm pins, so it cannot be packed in a flush pit. A ram lifts its car directly, with no linkage.

**The head** (about 110 kg without a wheel). A cast housing carries:

- **The nutrunners.** 5 spindles on a cluster that turns ±40 degrees to the nuts' angle. A scroll ring moves all 5 out or
  in together to the car's pitch circle, 100 to 130 mm. An offset head on each spindle brings its drive in to its socket,
  so 5 spindles fit a 100 mm circle. Each spindle's transducer records torque and angle for every nut. 250 N m peak a
  spindle (class).
- **Every nut stays held.** A magnet in each socket holds its nut, or its bolt, from the moment it leaves the hub until it
  is back on and tight. No nut is loose in the bay at any time. The axis camera checks a nut is in each socket after the
  sockets come back, and checks all 5 sockets after a socket change.
- **The grip.** 2 powered rollers close on the tread below the wheel's centre and hold the wheel by its shape. A left and
  right-hand screw closes both together, the same distance from the head's axis (0.20 to 0.37 m). The grip carriage
  slides back under the housing, so the wheel stays still while the sockets move onto the nuts. Turned by their motors,
  the rollers turn the wheel to line its holes up with the studs.
- **The covers.** 4 suction cups on rods at the housing's corners. 4 electric cylinders push them out past the sockets
  (300 mm), and a vacuum pump in the head's junction box holds the cover. A removed cover waits in a nest on the
  portal's leg while its wheel is changed.
- **The cameras.** A 3D camera on the housing finds the wheel, its centre, the nuts and how deep they sit. A camera on the
  spindles' axis centres the head on the hub. A light ring round the cluster lights the wheel under its arch.

**The racks.** Each side has 2 cradles for NEW wheels at the entrance end (Z -3.40 and -4.25) and 2 for OLD wheels at the
exit end (+3.40, +4.25), on the floor outside the door opening. A wheel stands on 2 free rollers and leans on a back stop.
A sensor in each cradle sees a wheel. A person rolls wheels in and out and never lifts one. The frame is 20 mm high where
the head's rollers reach under a wheel.

**The socket rack.** The head carries the 21 mm set (the fleet's wheel nuts). For a car with 17 mm wheel bolts (the
Waymo Ojai, ASSUMPTION from its platform) it puts its 5 sockets into the empty ring of a stand north of the lift, takes
the 17 mm set from the other ring, and swaps back before the car leaves.

## The program

`tireProgram.ts` makes each fleet car's wheel change by rule from the car's own facts (`fleetModels`: wheelbase, track,
tyre, the sill). On the Tesla Model Y (with aero covers) it is 112 steps and 534 s, about 8.9 min, for all 4 wheels. Every
step's time is nominal (ASSUMPTION). Each step moves one group of axes in a straight line in the machine's own state, so
the middle of a step is a pose the machine really passes through. The clash check tests both.

**The rotation** (`tireCycle(v, 'rotation')`) moves each side's front wheel to the rear hub and its rear wheel to the
front hub, on the same side. One wheel must wait while the other moves, so the front wheel waits in an OLD rack's cradle.
Each wheel keeps its own aero cover. A side has one cover nest, so the front wheel's cover goes back onto it in the cradle
before the rear cover comes off, and comes off again before that wheel goes onto the rear hub. A racked tyre faces the
bay's centre, so its cover sits 0.03 m beyond its face, and the head reaches it turned to the wall. The rotation takes as
long as the replacement: 9.0 min on the Model Y, 5.9 min on a car without covers, 10.2 min on the Waymo Ojai. It never
goes to the NEW racks.

In order: the lift's arms come out of the floor and swing under the lift points, the pads touch, the car rises 0.50 m on
the locks. Then for the front pair, and again for the rear pair: the portal comes to the axle; the cups take the covers
off and the robots turn and put them in their nests; the rollers close on each tyre; the sockets go onto the nuts and each
nut breaks free in turn, then all 5 spin off into their sockets; the wheel comes straight off its studs; the portal
carries the old wheels to the OLD racks and the new ones from the NEW racks; the cameras find the studs and the rollers
turn each wheel to them; the wheel goes onto its hub; all 5 nuts run down, then each is tightened to the car's torque in a
star order; the covers go back on. Then the car comes down and the machine goes home.

## What the fleet must give

OTTO-Q reads a car's facts before it arrives, and the head sets its pitch circle, its sockets and its torque from them.
`WHEEL_FACTS` holds each fleet model's, each with its source (read 2026-11-17):

| Model | Pattern | Fastener | Hex | Torque | Cover | Assumed |
|---|---|---|---|---|---|---|
| Tesla Model Y | 5 x 114.3 | M14 x 1.5 nut | 21 mm | 175 N m | yes | the robotaxi's aero cover |
| Waymo (I-PACE) | 5 x 108 | M14 x 1.5 nut | 21 mm | 133 N m | no | torque (133 and 120 in 2 sources), hex |
| Waymo Ojai | 5 x 108 | M14 x 1.5 bolt | 17 mm | 140 N m | yes | all but the pattern (its platform's) |
| Lucid Gravity (Nuro) | 5 x 120 | M14 x 1.5 nut | 21 mm | 140 N m | no | torque (an owner reports 190), hex |
| Tesla Cybercab | 5 x 114.3 | M14 x 1.5 nut | 21 mm | 175 N m | yes | every fastening fact (the Model Y's) |
| Zoox | 5 x 114.3 | M14 x 1.5 nut | 21 mm | 150 N m | no | every fastening fact (none published) |

A fact marked assumed must be read from the maker's service data before the bay serves that model. The lift points are
ASSUMED for every model: a sill point 0.60 m inboard of each axle (`LIFT_POINT_FROM_AXLE`). Each car's own points come
from its maker's service data, and each pad's camera checks its point before the car leaves the floor.

## Electrical design

### The supply

480 V, 3 phase, 60 Hz, from TX-AUX: the one-line's unit for the battery, the building and the canopies' plant (otto-q-core
0810; 2,500 kVA in its power nodes, read 2026-11-17). The bays' machines are the depot's own plant, not charging, so they
stay off the charger transformers, as the canopies' boards do. Every figure below is `siteService.ts`'s, measured on the
site plan, and `siteService.test.ts` holds it.

**The route** (ASSUMPTION: the site's civil design sets it): from TX-AUX south inside the battery yard to its south fence,
east along it to the strip between the yard and the office (where the chargers' duct bank runs), north up the strip to the
ops building's north wall, in through its west wall, and east along the building's cable tray on the inside of the north
wall (4.4 m up) to the bay. A conduit takes the feed down the wall to the bay cabinet's top.

| | Bay 1 (beside the office) | Bay 2 (east) |
|---|---|---|
| Feed, TX-AUX to the cabinet | 73.0 m | 81.8 m |
| Network fibre, office switch to the cabinet | 33.5 m | 42.4 m |
| Voltage drop at the design current | 1.74 % | 1.96 % |
| Fault current at the cabinet (upper bound) | 2.87 kA | 2.56 kA |

**The load**, by NEC 670.4(A) for industrial machinery: 125 % of the largest motor's full-load current plus the full-load
currents of every other motor and load. The largest motor is the lift pump's 5 hp, 7.6 A at 460 V (NEC Table 430.250).
Each servo and nutrunner drive is counted at its motor's rating, all at once, at a drive input power factor of 0.95 and
efficiency of 0.92 (ASSUMPTION: the drives' own input ratings replace these when they are chosen). Per robot: trolley 0.4,
slew 0.4, Z 1.0, tilt 1.0, the head's small drives 0.8, 5 nutrunners at 1.0 kW. The portal's 2 travel drives at 2.0 kW.
The cabinets' controls, computers, supplies and fans, 2.0 kW. **Design current: 41.2 A.**

**The conductor:** 3 x 6 AWG copper and an equipment ground (THHN/THWN-2 in conduit and duct bank), the smallest whose
75 °C ampacity (NEC Table 310.16) carries the load and keeps the farther bay under 3 % drop. 8 AWG carries 50 A, but its
drop to bay 2 is over 3 % at 75 °C.

**The fault current:** TX-AUX at 5.75 % impedance, the nominal a utility's specification gives for 750 to 3,750 kVA
units, at its -7.5 % tolerance (5.32 %), from an infinite primary, through the feeder's copper at 20 °C: about 56.6 kA at
TX-AUX's terminals and 2.87 kA at most at a bay cabinet. The cabinet is marked with a 10 kA short-circuit rating (NEC
670.3(A) asks the machine's nameplate to state it).

### The machine's one-line

```
TX-AUX 2,500 kVA, 480 V ──50 A 3P breaker──> 3 x 6 AWG + EG, 73.0 / 81.8 m ──> BAY CABINET (north wall, 800 x 2000 x 500)
  main switch 60 A, lockable (NEC 670.4(B)), SCCR 10 kA
  ├─ lift pump: motor circuit protector + contactor + overload ──4 x 14 AWG──> 5 hp motor (7.6 A)
  ├─ lift valve block, pawl solenoids, position sensors: 24 V I/O
  ├─ 24 V 20 A and 48 V 10 A supplies; 1 kVA UPS (the safety and motion controllers, the vision computer)
  ├─ the lift's 2 saddles: 48 V + Ethernet on a spring reel each (the arms' swing and slide drives, load cells, cameras)
  ├─ safety controller (FSoE master): 2 floor scanners, 4 emergency stops, the 2 door interlocks
  ├─ motion controller (EtherCAT master), vision computer, network switch (fibre to the office)
  └─ portal feeder 40 A ──4G10 mm² in the floor chain──> PORTAL CABINET (on the west leg)
       ├─ 2 travel drives 2.0 kW ──> the travel motors
       ├─ per robot: trolley and slew drives 0.4 kW ──> their motors (in the trolley chain)
       └─ per robot: robot feeder 15 A ──4G2.5 mm² in the trolley chain, across the slip ring──> HEAD DRIVE BOX
            ├─ 600 V DC bus supply ──> Z servo, the head's servo bus (tilt, cluster, scroll, grip, clamp, rollers, cups)
            ├─ 5 nutrunner drives ──> 5 spindles (one cable each, in the Z chain)
            └─ safety I/O (FSoE), EtherCAT coupler, vision switch (one fibre across the rotary joint)
```

Each feeder is held above the load it carries, and each conductor above the feeder that protects it
(`SERVICE_ONE_LINE`, `siteService.test.ts`):

| Supply | Load (NEC 670.4(A)) | Protection | Conductor |
|---|---|---|---|
| The bay's feed | 41.2 A | 50 A breaker at TX-AUX, 60 A main switch | 3 x 6 AWG (65 A at 75 °C) |
| The portal, through the floor chain | 29.9 A (both robots, trolleys, slews, travel) | 40 A | 4G10 mm² (more copper than 8 AWG: 50 A) |
| Each robot, across its slip ring | 11.1 A (Z, tilt, head, 5 nutrunners) | 15 A | 4G2.5 mm² (more copper than 14 AWG: NEC 240.4(D) protects it at 15 A) |
| The lift pump | 7.6 A (125 %: 9.5 A) | motor circuit protector, overload relay | 4 x 14 AWG (NEC 240.4(G) sends a motor circuit to Article 430) |

**Conduit fill.** Every conduit's fill is checked in the build against NEC Chapter 9, Table 1 (53 % of the bore for one
cable, 31 % for 2, 40 % for 3 or more; a multiconductor cable counts as one conductor, Note 9), and written into its
parts-list line. The check found the conduit up from the portal cabinet into the beam at 58 %, with both robots' 14 lines
in 50 mm. It is 63 mm now (34.4 %), and moved inboard of the leg's head flange. The fullest conduits now:

| Conduit | Lines | Fill | Limit |
|---|---|---|---|
| Portal cabinet to the beam, 63 mm | 14 | 34.4 % | 40 % |
| Site network, tray to cabinet, 25 mm | 3 | 37.1 % | 40 % |
| Beam to the east travel motor, 32 mm | 3 | 28.6 % | 40 % |
| The bay's feed, tray to cabinet, 50 mm | 1 | 25.0 % | 53 % |
| Floor chain's fixed end, 50 mm | 3 | 22.1 % | 40 % |

**The cable schedule.** 103 lines, 628.8 m of route and 749.3 m to order (`public/cad/tire_bay.cables.csv`): 7 power, 50
hybrid (servo power with its feedback, or 48 V with Ethernet), 14 control, 7 safety, 15 network, 8 air (the cups'
vacuum) and the lift's 2 oil pipes. Every line runs from a named terminal to a named device through parts the model has;
none is open. Each line's bends are held to its own bend radius, fixed and moving, through every chain, loop, reel and
conduit (`cad/otto_cad/cables.py`). Each line's class size and bend radius is an ASSUMPTION until its maker's sheet sets
it.

**Fieldbus and networks.** EtherCAT from the motion controller to every drive and I/O module, with FSoE (safety over
EtherCAT) for the safety I/O. A single-mode fibre from the office switch to the bay cabinet, a 4-core fibre to the portal
cabinet, and a 2-core fibre across each robot's rotary joint for its cameras.

### Safety

The bay is a robot cell. Its safety functions are designed to PL d, category 3 (ISO 13849-1), as ISO 10218-2 asks of a
robot cell: 2 safety laser scanners at opposite corners watch the bay's floor, and a person in the bay stops every
motion. Emergency stops at the south door, on each portal leg and on the cabinet stop every motion. The safety controller
cuts each drive's torque (safe torque off) and locks the lift. The doors' interlocks keep the machine from running with a
door open. The lift: the robots start only with all 4 pawls in and the oil let off; each pad's load cell reads its share
of the car, and the lift stops if the 4 shares do not agree with the car's weight. A beacon on the beam shows the bay's
state: green home (the car may move), amber moving, red stopped, blue a person is needed.

## Verification

Every CAD change ends with `cad/build.py`, `cad/clash.py --baseline` and `cad/line_ends.py` (cad/README.md). As built on
2026-11-17:

- **Parts:** 2,399 placed parts, 249 kinds, 1,541 fasteners, 8,059 kg. The STEP re-imports with every part named and every
  solid valid (2,627 solids).
- **Clash and contact:** at the stowed pose and every twin pose in `cad/spec/poses.json` (382: every preset, every fleet
  car's grip and socket change, the middle and end of every replacement step, and the middle and end of every rotation
  step the replacement does not already make), 415,790 pairs measured, **0 clashes and 0 floating parts** (2026-11-17,
  with the rotation). Every thread, mesh and seal overlap is an expected class.
- **Line ends:** 18 rigid lines, **0 open ends**. The flexible lines' ends are held at every pose by `cadDetail.test.ts`.
- **Conduit fill:** every conduit inside NEC Chapter 9, Table 1 (above).
- **The twin's tests:** the CAD's joints are tireSpec's travel and stow at the program's home (`cad.test.ts`); every
  pose and every frame of the cycle lies inside the joints' limits; every flexible line holds its bend radius and length
  through every fleet car's wheel change (`cadFlex.test.ts`); the machine stands inside both service bays at every step,
  clears a car driving through at home, and lies inside the site plan's solids up to a car's height (`cadYard.test.ts`);
  a car drives straight through both bays touching nothing (`structurePlan.test.ts`); the program's own 104 tests, every
  check on both jobs and every model (`tireProgram.test.ts`); the session and the gate in the yard (`tireSession.test.ts`,
  `tireGate.test.ts`); the feed and the feeders (`siteService.test.ts`); the cable schedule names the same breakers,
  feeders and conductors (`cadCables.test.ts`).

## Assumptions and open items

- Every bought part's class size (motors, drives, cables, the slip ring) is an ASSUMPTION until its maker's sheet sets it.
- The lift points and the fastening facts marked assumed (above).
- The power unit's relief setting (10 bar) and pump efficiency (0.85); each step's nominal time.
- The feed's route through the site, and the drives' input power factor and efficiency.
- The engine's numbers (0842): the 3.0 mm line is the needs card's own; 8.0 mm for a new set (a new car tyre starts at
  10/32 to 11/32 in, 7.9 to 8.7 mm); the quarter (Chase's word) and the 12-minute seat; the seeding's rates.
- The yard draws the car's own wheels on the car while the robots carry wheels: no wheel is drawn on a head or in a rack
  yet. The Robotics tab plays the replacement; the rotation plays in the yard and is held to the clash check.
- Every fleet car is rotated front to rear on its own side. A car with a staggered fitment (different front and rear
  tyres) could not be: none in the twin depot's fleet is drawn as one.

## Sources

Read through a web search on 2026-11-17 (check the code edition the site adopts):

- NEC 670.4(A), industrial machinery supply sizing: [solar365, the NEC 2008 text](https://solar365.com/green-homes/national-electric-code-2008/industrial-machinery/page/0/1), [codebookcity](https://codebookcity.com/codearticles/nec/necarticle670-675.htm)
- NEC Table 430.250, 5 hp at 460 V, 7.6 A: [Elliott Electric](https://static.elliottelectric.com/StaticPages/ElectricalReferences/ElectricalTables/FullLoad_Current.aspx)
- NEC Table 310.16, 75 °C copper ampacities: [Elliott Electric](https://elliottelectric.com/StaticPages/ElectricalReferences/ElectricalTables/Allowable_Ampacities.aspx)
- NEC 240.4(D), small conductors (14 AWG at 15 A, 10 AWG at 30 A): [EC&M, Article 240](https://www.ecmweb.com/national-electrical-code/code-basics/article/20885916/article-240-overcurrent-protection)
- NEC Chapter 9, Table 1 and Note 9, conduit fill: [EC&M, Fill 'Er Up](https://www.ecmweb.com/national-electrical-code/code-basics/article/20892946/fill-er-up), [EC&M, Size Raceways](https://www.ecmweb.com/content/article/20891686/size-raceways-for-a-successful-installation)
- Transformer impedance, 5.75 % nominal with -7.5 % tolerance: [Snohomish PUD specification](https://esr.snopud.com/Content/Material/B-Transformers/636318.1.htm)
- In-ground two-post lift rise time, 53 s up and 24 s down: [a 10,000 lb in-ground electric-hydraulic lift's listing](https://standardus.com/rotary-two-post-auto-lift-10-000lbs-capacity-inground-electric-hydraulic-r-sl210-fa.html)
- A new car tyre's tread, 10/32 to 11/32 in (7.9 to 8.7 mm), for the 8.0 mm a replacement fits: [Tire Rack](https://www.tirerack.com/tires/tiretech/techpage.jsp?techid=197); 8 to 9 mm: [Continental](https://www.continental-tires.com/be/nl/tire-knowledge/tread-depth/)
- The fleet's wheel fastenings: the sources beside each entry in `tireProgram.ts` (`WHEEL_FACTS`), among them [Tesla's Model Y service manual](https://service.tesla.com/docs/ModelY/ServiceManual/en-us/GUID-6B20CACF-C224-4B28-9592-7BEB02E9AEB6.html) and [wheel-sizes.com](https://wheel-sizes.com/lugnuts/tesla/model-y/)
