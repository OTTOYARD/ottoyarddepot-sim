# Robotics: the depot's robots as engineering CAD

Chase, 2026-11-07: *"a robotics tab with every robotic feature to be reviewed and built more robustly and accurately
based on current design and CAD inputs ... wash bases, interior, vacuuming, and overhead cleaning, and robotic arm
charging ... if you click the robotics tab in the twin and select the overhead vacuum option, there should be a CAD
breakdown of each microscopic or individual piece going down to each screw"*, and later the same night: *"spend
incredible time designing CAD files for each robotic step."*

There were no CAD files to review: no STEP, STL or drawing in any OTTOYARD repository or in the Drive, and
`otto-q-workspace/OTTOQ_FRONTIER_BUILD_TRACKER.md` records "no commissioned CAD". The "current design" was the
parametric geometry the twin draws its robots from. So this builds the CAD from that geometry: three B-rep assemblies,
designed part by part to the last screw, and a tab that shows them.

## What is where

| | |
|---|---|
| `cad/` | the CAD program (Python, CadQuery 2.8 on OpenCascade 7.9): `otto_cad/std.py` standard parts, `actuator.py` the robot joint, `robots/*.py` the three machines, `build.py` the build, `clash.py` and `otto_cad/check.py` the clash check, `line_ends.py` the line-ends check, `otto_cad/cables.py` the cable schedule. `cad/README.md` says how to run it; `cad/SOURCES.md` lists every external fact and assumption. |
| `cad/spec/robots.json`, `cad/spec/poses.json` | the robots' interface dimensions and the twin's poses for the clash check, written by `src/lib/robotics/cadSpec.ts` and `cadPoses.ts` from the twin's own code |
| `public/cad/` | the outputs: `<robot>.step.zip` (the CAD), `<robot>.glb` (the same assembly for the web), `<robot>.bom.json/.csv` (the bill of materials), `<robot>.clash.json` (the clash report), `manifest.json` |
| `src/lib/robotics/` | `cadSpec.ts` (the spec bridge), `cadModel.ts` (load, pose, explode, isolate, pick), `catalog.ts` (data, words, pose presets and run steps from the twin's code) |
| `src/components/robotics/CadViewer.tsx`, `src/components/tabs/TwinRoboticsTab.tsx` | the 3D view and the tab |
| `public/cad/<robot>.depot.glb`, `src/lib/robotics/cadDepot.ts`, `src/components/canvas/three/cadFleet.ts`, `instancedFleet.ts` | the CAD in the depot's 3D view: the depot model each robot is drawn from, cut into instanced parts and posed from the twin (below, "The CAD in the yard") |
| `src/lib/robotics/cadYard.test.ts`, `cadDepot.test.ts` | the CAD the yard draws, held to the car, the doors, the cabinet and the wash hall, and to the twin's moves |
| `src/lib/robotics/machineFacts.ts`, `public/cad/robot-facts.json` | what each machine is and does, in the words of a depot crew and of a car's owner, for OTTO-PULSE and OrchestrAV (below, "What the two cockpits show") |

## One home for every number

The CAD never types a link length, a mount height, a joint offset, a brush radius or a car dimension. It reads
`cad/spec/robots.json`, which is `cadSpec()`'s output over `cobotSpec.ts`, `cabinetEnvelope.ts`, `cleanArmSpec.ts`,
`cleanArmPlacement.ts`, `washSpec.ts` and `vehicleEnvelope.ts`. Two tests hold it:

- `cadSpec.test.ts`: the committed snapshot equals `cadSpec()`. Change a robot and it fails until the snapshot is
  rewritten (`CAD_SPEC_WRITE=1 npx vitest run src/lib/robotics/cadSpec.test.ts`) and the CAD rebuilt.
- `cad.test.ts`: the built GLBs are the twin's robots: the charge arm's J1..J6 at `cobotSpec`'s offsets and its
  connector face at the TCP, `tool` past the flange; each joint's stowed angle is the twin's `STOWED`; the clean arm's
  nodes are `buildCleanArm`'s at `cleanArmSpec`'s offsets with the twin's home pose; the wash machine's rails at
  `washSpec`'s track and its home at the twin's; and every bill-of-materials line is placed exactly as often as counted.

The tab's poses are the twin's own code, not copies: the charge arm stowed (`STOWED`) or connected (`solveIK` to a
rear-quarter port, and `catalog.test.ts` checks that `forwardTCP` of the result is the port); the clean arm at home,
over side A and in the cabin (`cleanJointsAt`, through `buildCleanArm.poseCleanArm`'s node mapping); the wash machine
at home, mid wash pass, dry pass and on the roof and front sensors (`programPoseAt`). Its run steps are the twin's phase tables
(`NOMINAL_SEQUENCE` and `ARM_TIMING_DEFAULTS`, `CLEAN_CHAIN` and `CLEAN_PHASE_S`, `washChain` and `PASS_NOMINAL_S`).

## The three machines (as built 2026-11-15, with their supplies drawn: finding 19)

| robot | parts | different parts | screws, nuts, washers, pins | mass | STEP (zip) | GLB |
|---|---:|---:|---:|---:|---:|---:|
| OTTO-CHARGE ARM (rail bed, two-connector head, supply from the cabinet) | 1,052 | 248 | 702 | 990 kg (with its bed, carriage, cross-slide, riser and supply) | 38.9 MB (7.4) | 8.5 MB |
| OTTO-CLEAN ARM (with its power and its vacuum and air drops) | 258 | 117 | 147 | 375 kg (with its canopy steel) | 7.6 MB (1.4) | 2.3 MB |
| OTTO-WASH (touchless, 2 detail arms, bay supply) | 2,777 | 292 | 1,636 | 5,950 kg | 38.7 MB (7.0) | 9.1 MB |

(The table read 966, 408 and 2,639 parts until 2026-11-15. The clean arm's row was already stale: it had 238. The
supplies added 86, 20 and 138 parts.)

(Fewer fasteners than the first pass: where the clash check found a screw standing in another part, or holding a part
the new layout leaves out (the wash beam's cover, the clean arm's mast cap and first hose), it went. The masses went
up: the actuators came out longer, the wash machine's beam became a box girder, and its drag chain trough's floor now
runs to the rail's anchor plates.)

**Every STEP is re-imported by the build before it is published** (`build.py step_check`): each placed part must come
back as a named solid and every solid must pass OpenCascade's validity check, or the build stops. As built
2026-11-15: 1,069, 263 and 2,794 named parts (the counts include the reference context parts), 1,759, 395 and 4,236
solids, 0 invalid.

Through-bolted steel joints are drawn as they are assembled (`std.bolt_stack`): bolt, a washer under the head, the
clamped plates, a washer and a lock nut (the wash machine's leg flanges, its blower feet and pillow blocks, the clean
arm's header clips and column top).

Masses are each solid's volume times its material's density, except a bought assembly drawn as its envelope (a foam
brush, a blower, a gearmotor, a cabinet), which carries a class mass marked "catalogue class mass" in its line. The
site pad and the charger cabinet are drawn for context, marked reference, and left out of every total.

### The robot joint (`actuator.py`)

Every rotary joint of both arms is one parametric module, built the way a cobot joint is: output flange, preloaded
cross-roller bearing, strain-wave gear set (flexspline cup, circular spline, wave generator), frameless motor (stator,
winding, rotor), spring-applied power-off brake, motor and output encoders (the pair detects gear wind-up and
collisions), servo drive board with safe torque off, seals, O-rings and every screw, dowel and retaining ring. Sizes
17, 20, 25, 32, 40 and 50. The parts that turn with the joint are in the joint's node, so the tab poses it; the rest
stay with the parent link.

### OTTO-CHARGE ARM

Riser weldment on 4 injection anchors, mount plate, J1 (size 40, motor bell inside the riser), cast turret, J2 (size 50)
with a gas-spring balancer, 1.344 m cast upper arm, J3 (size 40), 1.142 m cast forearm, spherical wrist J4/J5/J6
(sizes 25, 25, 20), ISO 9409-1 tool flange, 6-axis force and torque sensor, lockable compliance unit, DC combo
connector with its contacts, face seal, bumper, latch hook and solenoid, a sealed vision pod with its 2 camera modules,
time-of-flight module, IR illuminator board, window and gasket, the power path in the arm (6 DC terminal boxes and 4
booted flex links, finding 16), safety laser scanner, emergency stop.

**Load check, from the CAD's own masses** (`charge_arm.torque_budget`): at full horizontal reach J2 carries 1,602 N·m
of gravity and J3 476 N·m (112.7 kg and 50.8 kg distal, plus an assumed 4 kg of hanging cable). A size 40 gear's
repeated peak is 738 N·m: J3 has ×1.55. A size 50's is 1,274 N·m, under J2's load, so J2 needs a balancer. A search
over the balancer's preload and rate picked a rate of zero, a constant force: the signature of a nitrogen gas spring,
not a coil spring. With a gas spring of 15 % progression (10.0 kN extended, 175 mm stroke, 320 mm under and 160 mm
over the axis) the J2 gear sees at most 310 N·m over the joint's ±110° balanced travel (×4.12). At the ports the twin
serves, J2 stays between 18.7° and 64.7°. Dynamics and the cable's pull are not in these figures. (The distal masses
went up from the first pass, 96 and 42 kg: the actuators are longer with every part in its own space.)

**The base stage and the two-connector head (2026-11-13).** The arm no longer stands on a fixed pad. From the floor
up: 2 bed beams (RHS 120 x 80 x 6) on plates, grout blocks and M16 injection anchors, each with a size 25 profile
rail, the rear one with a module 3 rack; a carriage plate on 4 blocks with a rack-and-pinion drive (`CR_X`, 1.3 m
toward the car's nose and 2.5 m toward its tail); on it 2 size 20 cross rails, a 20 x 5 ball screw and a saddle
(`CR_Z`, 0.65 m toward the car, 0.06 m away); the riser, shortened, on the saddle. The power and coolant lines run in
a cable chain in a steel-lined channel in the slab, with a second chain of the same size across the carriage (finding
19 draws them from the cabinet). `CR_BED` is the
bed's set position, not a drive. The tool is a holder with 2 connectors side by side, CCS1 and NACS, 100 mm each side
of the tool axis, each on a 90 mm plunge cylinder (`HD_CCS`, `HD_NACS`) with its own contacts, seal, bumper, latch and
solenoid. The mass went from 313 kg to 833 kg: the bed, its anchors and the carriage are steel. The six-axis arm's links and joints are unchanged.
**The head is heavier, and the load check moved with it** (`charge_arm.torque_budget`, rebuilt 2026-11-13): at full
horizontal reach J2 now carries 1,902 N·m of gravity (131.1 kg distal) and J3 575 N·m (62.8 kg), against 1,602 and 476
with the one-connector tool. J3's size 40 gear has x1.28 on its 738 N·m repeated peak, down from x1.55. The balancer
search now picks a gas spring of 11.85 kN extended (was 10.0 kN), and the J2 gear sees at most 365 N·m (x3.49, was
x4.12). The figures in the paragraph below are the one-connector tool's. J3's margin is the one to watch if the head
gains mass: dynamics are not in these figures.
The slab under the bed, the grout blocks, the channel liner, the pad and the cabinet are reference parts: drawn in the
tab, left out of the totals and out of the yard's model. Why these additions, and what each vehicle's mate uses of
them: `docs/CHARGE-ARM-REACH.md`.

### OTTO-CLEAN ARM

Canopy header (RHS 200 × 180 × 8) on 4 angle clips under two purlins, SHS 200 drop column, J1 (size 32, its motor bell
inside the column), welded box links with top covers and energy chains, J2 (size 25), J3 on a slewing bearing driven by
a servo gearmotor through a 3:1 belt, a 3-stage mast (rack and pinion on stage 2, a doubling belt for stage 3, acetal
wear pads), J4: a size 17 strain-wave gear unit in the fork's cheek, turned by a 200 W servo motor behind the hub through
a 2:1 toothed belt (design finding 9), the vacuum crossing the joint through the hub's hollow stub, a swivel on the other
cheek and a duct up through the fork into the mast, a 4-tube
carbon wand that is itself the vacuum duct (3 tubes slide, a third of the reach each, on lip seals; a ball-screw drive and
cables), and the nozzle (worm-driven pitch, vacuum duct, air knife, brush lip, light ring). Vacuum riser, hoses and
clips, J2's two drum covers, link covers and the carriage lid. The mast stages are the vacuum duct from J3 to the wrist.
Nothing on the wrist stands more than 95 mm from the pivot along its axis.

### OTTO-WASH

Two galvanised channel rails on anchor plates with a buffered stop at each end, trolleys with PU wheels, side rollers
and a geared travel motor inside each trolley, post-and-brace legs with cladding, a box-girder beam, stainless spray arch with 23 nozzles and 4 solenoid valves,
a top air knife on 2 telescoping lift columns with a servo gearmotor each, two side air knives, 3 blowers and their
ducts, the valve manifold and arch feed hose. No brush and no vacuum wand. Beside the car, two detail arms (finding
18): each is the charge arm's six-axis arm (`charge_arm.build_chain`, the same castings and actuators) on a pedestal
on a carriage, with a servo gearmotor and pinion, on a floor track of 2 profile rails and a rack on a steel beam with
anchor plates and end stops. Each carries a polishing head (force sensor, floating joint, backing plate, microfibre
pad), a wrist camera and a pure-water mist nozzle, and has a cable chain beside its track and a dock at the exit end
(post, rinse cup, signal). The stop light, beacon,
the control cabinet on the inner side of the west leg, and the supply drag chain in a covered trench inboard of the west
rail, clear of the travel drive. Nothing stands outboard of the trolleys (design finding 8).

## Every part against every other: the clash check

`cad/clash.py` builds each robot again and places every solid where the assembly puts it, at the stowed pose and at
every pose in `cad/spec/poses.json`: each pose the tab offers, and the middle and the end of every step of the robot's
cycle, from the twin's own pose code (`cadPoses.ts`). It finds the pairs of parts whose boxes overlap and measures the
volume they share with an OpenCascade boolean. A pair inside one rigid body is measured once; a pair across a joint is
measured again at every pose.

A measurement depends only on the two parts and on where one stands in the other's frame. So the check measures a
pair once for each such placement and uses that answer again wherever the same two parts stand the same way: at a
later pose in which neither moved against the other, and in a second copy of an assembly (the wash bay's two detail
arms). A part number is one solid, so the answer is the same answer. A flexible line's solid is made anew at each pose,
so a pair with one in it is used again only when neither it nor the other part moved at all (its volume, its centre
of mass and its place are the same). And before any pair is measured, each part's own box where it stands is tested
against the other's (the separating-axis test): a part turned 45 degrees has an axis-aligned box far larger than
itself, and at an arm's working poses those boxes overlapped by the hundred. The test errs toward keeping a pair. The
wash bay with its two arms did not finish in two hours without these (2026-11-12). With them it takes 18 minutes. On
the clean arm they give the same findings as before (no clash, no loose group, the same 185 expected overlaps and the
same 407 touching pairs) from 2,691 measurements in place of 9,045. The report says how many pairs it looked at and how
many it measured (`pairsChecked`, `pairsMeasured`).

Some overlap is expected and is counted, not flagged: a screw's shank in a tapped hole the CAD does not draw (only if
the shared volume lies inside the screw's own hole cylinder, below its head), a seal pressed into its groove, a
retaining ring in its groove, and the drawn teeth of a gear mesh. Anything else is a **clash**. A second test runs at
the stowed pose: every part must touch another (within 0.3 mm) and the graph of touching parts must be one piece. A
group that touches nothing else is a **loose** group: a part, or a set of parts, held by nothing.

The report goes to `public/cad/<robot>.clash.json` with the digest of the GLB it checked. `cad.test.ts` fails if a
report does not describe the committed GLB, if it did not run at every twin pose, or if it finds more clashes or loose
groups than `cad/clash_baseline.json` allows. The baseline only goes down. The Robotics tab shows each robot's report.

As run on the committed CAD (`public/cad/<robot>.clash.json`):

| robot | poses | pairs measured | clashes | loose groups | expected overlaps (screws in tapped holes, seals, retaining rings, gear meshes) |
|---|---:|---:|---:|---:|---|
| OTTO-CHARGE ARM (2026-11-15, finding 21) | 34 | 41,380 (17,979 measured) | 0 | 0 | 841, 13, 9, 3 |
| OTTO-CLEAN ARM (2026-11-15) | 42 | 7,546 (2,822 measured) | 0 | 0 | 192, 0, 1, 4 |
| OTTO-WASH (touchless, with 2 detail arms, 2026-11-15, finding 21) | 37 | 68,830 (15,208 measured) | 0 | 0 | 1,999, 24, 18, 6 |

No clash and no loose part is left in any robot, at any of the twin's poses, and `cad.test.ts` holds all three at
zero. Design findings 6 and 7 were fixed in the CAD without a change to the twin, and so were 8 and 9, which the yard's
clearance tests found (below).

### What it found, and what changed

The first run, on the CAD as the first pass committed it and at the stowed pose only, found 617 clashes and 9 loose
groups in the charge arm, 511 and 8 in the clean arm, and 376 and 60 in the wash machine. Most were in a few causes:

1. **The wash machine's right side was drawn on top of its left.** Its wand column, brush carriage, rack, air knife and
   duct were built with their side's position inside the solid, and both sides used one part id, so the right side
   reused the left side's solid. The right side brush hung in the air. Each solid is now built at its own origin and
   placed. The build now refuses one part id with two different solids.
2. **Inside every joint actuator, parts shared space.** The front shaft bearing, the winding end turns, the brake and
   the encoders were stacked into the same 20 mm; the rotor, brake, encoder and wave generator bores were smaller than
   the hollow shaft that runs through them; the rear cover was turned into the housing; and 12 M6 screws stood on a
   25 mm circle. The stack is now built station by station from each part's own extent. Every size checks with no
   clash and no loose part. The actuators came out longer (below).
3. **Every lip seal was a solid disc.** Its web was drawn with two equal radii. This was in the standard parts, so in
   every seal of both arms.
4. **Nothing held the actuators.** Each sat in a bore 0.5 mm larger than its housing, so the contact test found both
   arms in pieces. The bores now fit.
5. **The charge arm's castings ran through their own actuators.** The upper arm and the forearm swept from their cheeks
   through J2 and J3. Each cheek now climbs beside its actuator, and a bridge crosses over it, clear of the boss.
6. **The clean arm's J4 was mounted backwards,** through the wrist hub and the wand. Its J3 pulley had a bore larger
   than its own diameter round the mast, and the mast's rack, pulleys and belts were thicker than the 12 mm gaps between
   its stages.
7. **The wash tools hung from nothing.** The beam was two chords with a gap between them, under which the top brush,
   the side brushes and the wand columns hung. It is now a box girder: the chords at full height and a 4 mm deck top and
   bottom.
8. **Every sliding joint's limits were in millimetres,** where the viewer reads metres: the sliders went to 1,727 m. A
   new test keeps every limit in the viewer's units and every pose and cycle frame inside the limits.
9. **On a top-face workplane CadQuery turns local x to world -X.** The connector's contacts were drawn mirrored from
   their holes.

The poses found more, which the stowed pose could not show:

10. **The wash machine's two vacuum heads met in the middle of the car.** Each wand had 1 reach tube with its head 640 mm
    out, so at the twin's vacuum pose the heads stood 0.27 m into each other. Each wand now reaches with 2 telescoping
    tubes (a joint each, half the twin's reach each, 60 mm kept inside the tube outside at full reach), and its head
    starts beside the slide block. At full reach the heads stop 89 mm apart. The twin's head starts at the column, so
    the CAD's head ends 125 mm further in than the twin draws it.
11. **The wash machine's right trolley drove through its own drag chain.** The chain's trough lay beside the rail, under
    the travel gearmotor and a guide roller. It now lies outboard of the gearmotor, and its floor runs under the
    gearmotor to the rail's anchor plates, which hold it.
12. **The clean arm's wand swung through its own hose,** the hose loop from the wrist fork to the wand, when the wand
    hangs down. The vacuum now crosses J4 on its axis: through the hub's hollow stub, on a thin-section bearing in the
    fork, into a swivel on the fork's outer face. The wand's tubes also stood behind the pivot (design finding 3).
13. **The charge arm's cables ran through its castings.** Each run was a spline through 4 or 5 points, and between the
    points it bulged up into the casting. Each run now follows the casting's face, 1.5 mm under it, through points
    sampled along it, and passes through the clamps' bores.
14. **Smaller ones in the charge arm.** The balancer's crank clevis opened away from its rod, so its base stood across
    the rod's neck. J3's front clamp ring, its bearing and its screws stood in the upper arm's flanks. The riser's anchor
    nuts stood in the tube's corners (the anchors are now 380 mm apart, not 350). The wrist light ring stood on the J6
    clamp screws' heads (it is now round the socket ring). The retract unit's brackets had flat tops against a curved
    casting (their flanges are now cut to it). J6's cable gland met the wrist yoke. And the J2 and J3 drum clamp
    screws' heads stood 1 to 3 mm proud of their bosses, where the upper arm's and the forearm's bridges turn over them
    at the port: they now sit in counterbores.

15. **The charge arm's base stage and head (2026-11-13).** The first all-pose check of the new parts (34 poses: stowed,
    each fleet vehicle's mate and its base position with the arm folded, and the cycle) found 3 clashes and 3 loose
    groups. The J1 actuator's cable gland stood 2,324 mm3 into the riser's base plate, because the riser is shorter on
    the saddle than it was on the pad: the plate now has a 180 mm hole under the actuator. Each connector's latch
    solenoid sat 109 mm3 into its connector body: it now sits on the latch's tail, 1 mm clear of the body. And the 2
    bed beams and the cable channel were held by nothing, because a rail block runs 0.5 mm off its rail and the check
    counts 0.3 mm as touching: the floor slab is now drawn (a reference part), and the grout blocks stand on it, the
    channel is cast into it and the pad is cast 150 mm into it. After: 31,024 pairs measured, 0 clashes, 0 loose
    groups.

## What the CAD found (design findings)

1. **J2 needs a balancer, and it should be gas.** Above. The twin draws no balancer.
2. **The pitch actuators are longer than the drawn drums.** The twin draws the J2 drum 135 mm wide. Built with every
   part in its own space, a size-50 joint is 317 mm long along its axis (size 40: 276 mm, 32: 243 mm, 25: 205 mm, 20:
   182 mm). The extra length lies along the car, not toward it. The depot's clearance tests measure the drawn arm, not
   this envelope.
3. **The clean arm's wand needs 3 sliding tubes, not 2.** The twin draws a 0.45 m base tube and 2 tubes that each slide
   half of the 0.92 m reach. Each of those is then 0.52 m long, longer than the base tube, so retracted they stand
   120 mm behind the pitch pivot. The twin hangs the wand straight down while it is retracted (14 of its 41 poses), and
   then the tubes meet the wrist fork and the mast's foot, 100 mm above the pivot. With 3 sliding tubes of 0.37 m every
   tube lies inside the base tube when retracted; the innermost is still the twin's 44 mm tube. (The wrist's own width
   along its pitch axis is finding 9.)
4. **The wash wands need 4 stages, not 1 tube.** The twin draws one tube scaled to the drop. A column that drops
   2.38 m and stows its head just under the beam stood 4.75 m high with 3 stages, 4 cm under the wash hall's 4.79 m
   roof. With 4 stages it stows at 4.23 m (`cad.test.ts` keeps it 0.3 m under the roof).
5. **The clean arm's mast turns 462 degrees in one cycle.** The twin's choreography turns J3 from -177 to +285 degrees
   against link 2 (measured over `CLEAN_CHAIN` by the joint-limits test). A hose or a cable cannot cross that, so the CAD
   carries the vacuum across J3 in a rotary union with a slip ring on the mast axis, and the mast stages are the vacuum
   duct down to the wrist.

6. **The charge arm's forearm passed through its upper arm when the twin folds the elbow.** The twin stows the arm
   with J3 at 2.3 rad (132°), folded back to within 48° of the upper arm, folds it to 109° at the port, and draws both
   links in one plane. The CAD's castings are as deep as the twin draws its links, so they overlapped by 114,050 mm³
   stowed and 15,491 mm³ at the port, at every step of the charge cycle. **The CAD now jogs the forearm** (`FORE_JOG`):
   its first 330 mm runs 190 mm out along the elbow axis, 120 mm wide and as deep as before, and swings back to the
   arm's plane by 640 mm, so the wrist is where the twin puts it and its kinematics do not change. The upper arm's last
   155 mm before its J3 boss narrows to 110 mm (`UPR_END_W`), so the forearm's cheek plate folds past it. The twin
   draws both links in one plane, so its picture of the arm does not change.

7. **The wash machine's top brush and top air knife travel further than fixed guides can.** Over the hood the twin
   lowers the top brush 1.80 m (its axis to 0.93 m above grade) and the top knife 2.00 m (to 0.87 m). The beam's
   underside is 3.30 m up, and the brush's guides stand over the car's flanks, so a guide that reaches that low stands
   below the roof (1.46 m) as the machine passes over the car. The first CAD's 2 lift rails guided 1.39 m of the
   brush's lift, and its knife hung on its duct. The joints-limit test found it (`cad.test.ts` checks every frame of
   every cycle against every joint's limits). **The CAD now hangs each tool on 2 telescoping lift columns,** the wand
   columns' scheme: a sleeve fixed through the beam and 3 stages, each a third of the lift, 74 mm kept in the stage
   outside at full travel. The sleeves end 2.91 m (brush) and 3.23 m (knife) above grade, above the car's roof, and
   the knife's columns stand 4.01 m high stowed, 0.78 m under the wash hall roof (`cad.test.ts` keeps 0.3 m). The twin
   draws neither mechanism, so its picture of the machine does not change.

8. **The wash machine was wider than the end bays.** The wash hall's outer walls stand 7.4 u (3.541 m) from the drive
   lines of bays 1 and 3 (`structurePlan.WASH_SHELL`), and the twin's trolleys end 48 mm short of them. The CAD hung a
   travel gearmotor outboard of each trolley (to 3.795 m from the drive line), the control cabinet on a leg's outer face
   (3.679 m) and the drag chain's trough outboard of a rail (3.950 m), so in bay 1 the cabinet and the trough stood in
   the west wall, and in bay 3 a gearmotor stood in the east wall. Found when the yard first drew the CAD
   (`cadYard.test.ts`: every part at every pose against every bay's walls and partitions). **Fixed in the CAD:** each
   gearmotor and idler block now sits inside its trolley's inner wall (the gearmotor turned helical-bevel, its motor
   standing up), the cabinet hangs on the inner side of the west leg between the arch brackets, and the trough lies
   inboard of the west rail, its floor running on to the rail's anchor plates. Nothing stands outboard of a trolley:
   48 mm to the walls. The machine also got a buffered stop at each rail end, which the yard's simple rails had and the
   CAD had not.

9. **The clean arm's wrist had no room for its drive.** The twin holds the wrist pivot 0.20 m off the car in every
   working pose (`cleanArmSpec.pivotZ`) and every part but the wand 0.10 m off the car and the open doors. That leaves
   the wrist about ±95 mm along its pitch axis. The CAD's size 20 actuator on that axis stood 250 mm out along it, and
   when the wand reaches in at an angle the axis turns toward the car: the actuator went 47 mm into the car's outline
   (into the open door's opening) and came 19 mm from an open door; the swivel on the other end came 73 mm from the car.
   Found when the yard first drew the CAD. **Fixed in the CAD:** a size 17 strain-wave gear unit in the fork's cheek,
   turned by a 200 W servo motor behind the hub through a 2:1 toothed belt; a compact swivel; a duct up through the
   fork into the mast in place of the hose (which had come 41 mm from an open door). The wand side J4 turns weighs
   5.15 kg and holds 24 N m level at full reach, under the gear's 70 N m repeated peak (`cad/SOURCES.md`). The wrist now
   keeps 0.104 m off the car and 0.109 m off the doors over the whole cycle, on both stall columns. The twin draws neither, so its picture of
   the arm does not change. With margins that thin, a bigger pitch drive needs the twin to stand the pivot further out,
   and the wand's spare reach is 28 mm (0.892 of 0.92 m used).

10. **The clean arm's J1 and J2 could not carry a hose.** J1 swings the arm 178 degrees round the column in a cleaning
    cycle and J2 folds link 2 54 degrees under link 1. A hose from the column would pass through the column at
    mid-swing, and at J2's fold its 2 ports stand closer than its bend allows. The energy chains first drawn there
    were decorative: they crossed no joint the way the joint moves. **J1 and J2 are now built as J3 was (finding 5):**
    the vacuum, the air and the signals cross each joint on its axis in a rotary union with a slip ring, the joint is
    driven off its axis by a pinion on a ring gear, and the duct and the cables run inside the links.
11. **The charge cable stopped at every joint.** It was drawn in 3 rigid runs, clamped along the turret, the upper arm
    and the forearm, with a retract unit under the upper arm, and nothing crossed J1, J2 or J3. Its gland on the
    connector was an M20, for a cable 35.7 mm across. A 500 A liquid-cooled cable bends no tighter than 357 mm when it
    moves, so it cannot follow a 6-axis arm through its joints. **It now does not ride the arm:** it comes up out of
    the cabinet roof into a slip ring and coolant union in the hub of a take-up wheel (820 mm, groove radius 380 mm),
    lies in the rim's groove, leaves it in the wheel's plane at a fixed point above the cabinet's front edge and spans
    free to a side outlet on the connector, through an M50 swivel gland. A spring turns the wheel back, so the span
    keeps 1.36 times its chord: never slack onto the car. The span's anchors, outlet directions and ratio were searched
    over the duty cycle's poses. Over 11,070 poses (every inlet and every corner of the window) the tightest bend is
    418 mm (against 357 mm). Over 5,275 the span stays at least 52 mm from the arm, its free length runs 2.72 to
    3.91 m, and the wheel turns 178 degrees. A first draft let the span turn sideways as it left the rim. The clash
    check found it riding up the wheel's flange at most poses, so it now leaves in the wheel's plane, and the groove is
    56 mm wide for its 40 mm sleeve (as it leaves, the span keeps at least 3 mm off the flange). The arm's zero
    pose (straight up) is outside the cable's reach: it would bend the cable to 251 mm. The twin never plays it, so the
    Robotics tab no longer offers it and the clash check no longer tests it. The joints' own power and network (a 10 mm
    hybrid cable) runs inside the arm through the hollow shafts of J1 to J5. J6's bore (9.4 mm) is too small for it, so
    the tool's cable and air line ride with the charge cable in its sleeve.
12. **No line can loop across the clean arm's wrist (J4).** J4 turns 135 degrees, and the wrist keeps only 4 to 9 mm
    over the 0.10 m it must keep off the car and the doors (finding 9), so it cannot grow. The best loop of a 10 mm
    hybrid cable across it, searched over the cycle, bent to 27 mm against the 70 mm it needs. A 6 mm air line bent to
    21 mm against 30. **So nothing loops there:** the power and network cross in a flat-cable clock spring (8 mm thick)
    in the 10 mm between the hub and the +Z cheek, and the air crosses in a second passage of the vacuum swivel, in its
    old envelope. Their fixed leads run up the cheek and over the back of the fork's top block to a clamp. The mast's
    own supply changed for the same reason: a coil from the mast top can only end at the fork (the 3 stages are flush
    when the mast is in), and there it stood 79 mm from the car on one side of the fork and 80 mm from an open door on
    the other. A spring reel on the outer stage's back now pays the cable and the air line straight down, 12 mm off the
    stage, to that clamp, inside the wrist's outline.
13. **The wash machine's drag chain stood in the side air knife's path.** On the floor its upper run stood 0.43 m up;
    the retracted right knife's foot is 0.26 m up, over the same strip of floor, at every gantry position. Its moving
    end was also drawn fixed: the chain did not follow the machine. **The chain now runs in a covered trench**
    (floor 0.52 m down, galvanised liner, slotted checker-plate cover with brush strips, tied to the rail anchor plates).
    A driver duct joins its moving end through the slot to an arm on the trolley's inner wall, and a conduit takes the
    lines up the leg to the cabinet. Its bend rolls at half the machine's speed over the whole 7.37 m of travel.
14. **The wash wands' cable reel stood in the reach tubes and the arch.** Hung under the beam, its drum met the reach
    tubes at the stowed pose, and moved to clear them it met the spray arch. Its cable also climbed from the reel to
    the slide block at the stowed pose. **The reel now stands on the top deck,** outboard of the column, and pays its
    cable straight down through a conduit in the beam to an arm on the slide block.
15. **Two of the wash machine's stretching lines stretched further than their kind can.** Played through every program
    (`cadFlex.test.ts`), the top brush's coiled motor cable ran from 0.29 to 2.10 m, 7.3 times its shortest length;
    spiral cables are rated 3 to 5 times (`cad/SOURCES.md`). The top knife's bellows duct ran from 0.26 to 2.26 m as
    the knife drops 2 m to the hood, where a PU bellows folds to about 15 % of its length. **The top brush's cable is
    now on a spring reel** under the beam behind its lift column, and **the duct is a concertina duct on a steel coil
    frame** (its class folds to 5 to 8 % of its length; this one needs 11 %). The clean arm's mast line passed the
    same test as a coil (3.8 times) before finding 12 moved it to a reel.

16. **The charge cable was in the open, pulled off a wheel.** Chase, 2026-11-11: *"I dont think there should be an
    exposed cable that the arm pulls to extend out of a pulley. The wire needs to either be safely mounted inside the
    arm, or to the outside, OR charging is integrated into the arm."* Finding 11's answer (a take-up wheel on the
    cabinet and a free span of 2.7 to 3.9 m) is gone. **The current now runs in the arm.** Two insulated copper bars,
    40 x 10 mm, one a pole, run up the riser and inside each hollow link. At each of J1, J2 and J3 a link of braided
    copper in a sealed silicone boot (OD 60 mm) joins two terminal boxes, and one last booted link, 1.2 m, runs from
    the forearm to the connector across the three wrist joints (the wrist yoke has no room for a box: J4's bearing and
    J5's cheek fill both its sides). Nothing live is in the open, and no link is longer than 1.2 m.
    **Why the current does not go through the joints:** a joint's through-bore is the bore of its gear's cup hub,
    24 mm at J2 down to 9 mm at J6. That passes the joints' 10 mm cable and no more. **Why this works where finding
    11 did not:** the one-piece liquid-cooled cable bends no tighter than 357 mm, and a braid in a boot bends to
    80 mm. Each link's ends and length were searched over the twin's poses and then played through every phase at
    every inlet and every corner of the service window (11,070 poses, `cadFlex.test.ts`): no link bends tighter than
    its boot allows, and none comes within 0.10 m of the car. The bar size is a rule of thumb (about 1.4 to
    1.8 A/mm2, so 560 to 720 A for 400 mm2; https://payapress.com/busbar-sizing/, read 2026-11-11), not a rating:
    check it against the Copper Development Association's ampacity tables before a bar is bought. The connector's
    contacts stay liquid-cooled: two 8 mm coolant tubes, the tool's cable and its air line run with the bars and
    through each boot. (Finding 21: the forearm, which swings past the elbow, now takes 2 flexible conductors of 400 mm2
    in place of bars, and the coolant and air tubes, 8 x 6 and 6 x 4, run unbroken from the cabinet.) **What you still see:** four black boots, at the base, the shoulder, the elbow and the wrist. They are the arm's own, they move with it, and nothing is pulled from anywhere.

17. **The wash machine whipped the car with brushes and opened its doors in the wet.** Chase, 2026-11-11: *"I don't
    think it makes sense to have giant brushes that will be whipping the vehicle since a lot of AV's have extended
    areas with cameras and and lidar ... only rinses and dries, then ... an robot arm will locate all sensors and hand
    wipe gently with a cloth ... I don't think doors should open whatsoever once in the large external wash bay."*
    **The top brush, the two side brushes and the two vacuum wands are gone**, with their lift columns, carriages,
    drives, reels and vacuum units (finding 7's top-brush columns, finding 10's reach tubes and finding 15's brush
    reel go with them). The machine is now touchless: the arch soaks, washes with water jets and rinses, and the air
    knives dry. **Two sensor-wipe arms** then wipe each sensor. Each is 4 axes on the gantry's own travel: a carriage
    across the bay (1.73 m), a mast of 2 sliding stages (1.12 m), a wrist that turns the forearm in, aft or fore, and a
    hinge that swings the pad from face-down to face-on. A camera on the wrist finds each sensor, a nozzle mists it
    with pure water, and the pad on its sprung plate pushes no harder than its force sensor allows. **Choices made,
    and why:** the arms ride the gantry and not the hall's roof, so the gantry's travel carries them along the car and
    no second structure stands over the wet bay. They park beside the car's path, 1.1 m off the flank, and not over
    the roof, so a mast of 2 stages is enough (a column stowed above the roof needed 4 stages through the beam, and the
    beam's cross members stand in its way). The pad's plate is 45 mm smaller in radius than the pad, so beside the roof
    pod only foam is near the paint. **Held by:** `cad/clash.py` (38 poses, 9,520 pairs, 0 clashes, 0 loose parts),
    `washPose.test.ts` (the masts keep 0.10 m off the car at every moment, only the pads touch it, only at the four
    places, no deeper than a pad gives) and `cadYard.test.ts` (the same, measured on the CAD's own meshes).
    **Assumptions, stated:** the 10 N push limit and the wipe times are not from a source. The sensor places (the
    nose's and tail's upright face at 0.57 m, the front wings at 0.96 m, the roof pod) are the twin's one car shape:
    a real fleet needs each model's sensor map. Pad cleaning between cars is by hand, each shift: a pad wash station
    is not designed. (Finding 18 replaces these arms, and gives each pad a rinse cup.)

18. **The wipe arms rode the gantry, so the gantry had to stand over the car while a pad was on it, and each arm had 4
    axes.** Chase, 2026-11-11 (evening): *"swivel/mechanical arms similar to robocharging arm ... very delicate and
    able to move like a hand almost to reach difficult angles of cameras and sensors ... the wash arch ... stows at the
    front entrance, and then the detail arms come from the opposite end of the wash bay (the exit side) and come down
    each of their rails independently ... more like an assembly line."* **The 2 wipe arms, their cross rail, masts and
    wrists are gone. Two detail arms replace them.** Each is the OTTO-CHARGE ARM's own six-axis arm: `wash_gantry.py`
    calls `charge_arm.build_chain`, so the turret, the two cast links, the six actuators and the wrist are the same
    parts, and the twin solves it with the same `cobotIK`. One arm design is built, held in spares and serviced for
    both jobs. Each stands on a pedestal on a carriage (runner blocks, a servo gearmotor and a pinion) on its own
    floor track: 2 profile rails and a rack on a steel beam, anchored each metre, 2.10 m from the drive line, inside
    the gantry's rails. The tool is a polishing head: a 6-axis force sensor, a floating joint (6 degrees, 8 mm), a
    backing plate and a 120 mm microfibre-on-foam pad, with a camera and a pure-water mist nozzle on the wrist.
    **Choices made, and why:**
    - *The charge arm's arm, not a new one.* Its three wrist axes meet at one point, which is what "like a hand"
      needs: the pad turns about its own centre without leaving the sensor. A 4-axis arm cannot put a pad square on a
      corner lidar or on the roof lidar's shoulder.
    - *A floor track, not the gantry's rails and not the roof.* The gantry's rails stand 3.25 m out,
      too far for a 2.49 m reach to the roof's centre. A track 1.10 m off the flank puts every sensor in reach, and
      the gantry passes over it. Nothing new hangs over the wet bay.
    - *The gantry stows at the entrance and the arms dock at the exit.* The gantry's rails are 1.9 m longer so that it
      stows 2.3 m behind the car's tail, clear of an arm working on the tail from a carriage 3.0 m from the car's
      centre. Its drag chain is sized from that travel in the model. The docks stand
      north of the gantry's travel, so the two machines never share a part of the bay. A car drives in under the
      gantry and out between the docked arms, with 0.6 m a side.
    - *The pad turns a quarter turn each way and never spins free.* So no cable or water line winds up, and the last
      joint stays under its speed.
    - *Each dock has a rinse cup.* A parked arm's pad hangs in it, and a nozzle rinses the pad with pure water after
      each car. This closes finding 17's "pad cleaning is by hand". The dock's post is bolted to the track beam's north
      end, and a tie bar joins each track to the gantry rail's north anchor plate, so the tracks stay parallel to the
      gantry's rails and the whole bay is one assembly.
    **What the motion model found, and what changed** (`detailArm.ts`):
    - A wrist has two ways to any direction, and on one of them the forearm's roll reached its limit at the roof
      lidar and jumped a whole turn. The arm uses one way round the car's sides and the other on the roof, and turns
      over above its own track with the pad pointing down, where the wrist is well away from straight.
    - Moved at an even pace along the pad's path, the shoulder ran at 243 deg/s. Each part of a path is now as long as
      its line or its busiest joint's turn, whichever is more, and the program is timed so that no joint passes a
      1.75 m collaborative arm's speeds (120, 120, 150, 210, 210, 210 deg/s). The arms' work takes 145 s for 24 places.
    - A seat that ended early sent each arm's joints straight to the tuck, through the car. Now the pad backs straight
      off the way it faces, lifts if it is over the roof, and only then tucks. An arm is never hurried on the way home.
    - A leaned pad on the roof lidar's flat top dug 20 mm into it on one side. The lidar's window is its side wall, so
      each arm polishes 3 places round its top edge and no pad goes on the cap.
    **What the clash check found in the first build, and what changed.** It found 450 clashes and 4 loose groups, all in
    the new parts, and none of them was a rounding matter:
    - *The arm folded into itself.* With the track 1.10 m off the flank and the carriage beside each sensor, the elbow
      folded to 2.76 rad and the forearm's casting cut 36 cm3 out of the upper arm's. The wrist bent to 1.85 rad and
      its tube met its yoke. The charge arm never folds past 2.30 and 1.48, so its own check never found these. The
      motion is now held to 2.30 and 1.70 rad (`DETAIL_FOLD`): the carriage stops 1.0 to 1.65 m along the track from
      each sensor, the tuck pose is higher, and the corner lidars are met 20 degrees from above.
    - *340 rail screws stood 2 mm proud of their counterbores' floors.* Their heads are now on the floors.
    - *The carriage was too short for what stood on it.* The pedestal's foot stood on the gearmotor and on the block
      screws' heads, its bolts were under its own tube wall, and the pinion ran through the plate and a rail block. The
      plate is now 660 mm long with the rails 200 mm apart: the block screws are sunk in it, the foot's bolts are
      outside the tube, and the gearmotor stands south of the foot with its pinion's shaft in its own hole.
    - *The sensor bracket's screws went into the J6 socket ring.* The bracket now has a foot on the wrist tube's flat
      cheek, in the clear strip between the J5 flange screws and the socket ring.
    - *The floating joint's screws were inside its elastomer.* They are now between its 3 springs.
    - *The chain's carrier arm stood in the chain.* Its upright now lies on the outer side of the last link.
    - *The tracks, the docks and the gantry were 5 separate islands.* See the dock and the tie bar above.
    **Held by:** `cad/clash.py` (after the fixes: 37 poses, 66,264 pairs, 0 clashes, 0 loose groups), `detailArm.test.ts`, `washPose.test.ts` (both programs and 43 early
    ends) and `cadYard.test.ts` on the CAD's own meshes: the pad's face on the car (its foam gives 6 mm at the rim on a
    corner lidar), the head 53 mm off or more, every link and joint of an arm 0.13 m off, the gantry never within 0.5 m
    of an arm.
    **Assumptions, stated:** the joint speeds are a shorter arm's (above). The 5 N working push and 10 N limit are not
    from a source. The 24 sensor places are rays aimed at the twin's one car shape: a real fleet gives each model's
    sensor map, and the wrist camera corrects each point. No public source gives a measured time for a robot arm that
    polishes a car's sensors.

19. **The supply was drawn only where it moves.** Chase, 2026-11-14: *"how does that arm get electricity to it while
    it's sliding on the rail? I even see the charging cabinet behind the robotic charging arm, but it doesn't look like
    it's plugged into the arm itself or even the rail ... this needs to be studied and analyzed on all robotics."* He
    was right on all three. The charge arm's 2 chains were drawn, but no line reached their fixed end and the cabinet
    had no way out: this file said the arm was "fed by the cable trunk from the cabinet", and a trunk cannot follow
    3.8 m of rail. The wash machine's drag chain began at a point in its trench: no bracket held its first link and no
    line reached it. The clean arm had a vacuum riser in its column and no power at all. **Every line is now drawn
    from where the site hands it over to the tool** (the paths are in "The service lines", below): the charge arm's
    from the cabinet's floor, down through the pad, along a covered trench and
    the bed's channel, into the chain, up through the cover's slot and across the carriage to the riser; the wash
    machine's from a service panel on the bay's north wall, through ducts cast in the slab, a pit and a tray, into the
    drag chain and up the leg; the clean arm's from the canopy's cable tray and plant mains to a supply enclosure and a
    service unit on its column. **In the Robotics tab each path is one subsystem:** the charge arm's "Supply from the
    cabinet" (new: its lines, chains, driver, trays and ducts left the base and the power path, while the slab, the
    liners and the cover plates stay with the base, so isolating the supply ghosts them and shows every line from the
    cabinet's floor to the riser), the wash machine's "Bay supply" with "Control, supply and signals" for the drag chain,
    and the clean arm's "Power, control and network" with "Vacuum and air supply". The tab's Cut X and Cut Z show the
    buried runs in section. **Choices made, and why:**
    - *4 cores of 50 mm2 a pole, not 1 of 400.* A cable in a chain bends no tighter than 7.5 x its diameter, and the
      chain cable family used has no single core larger than 185 mm2 (27.5 mm, so R 206, too big for the bed's
      channel). 1 x 50 mm2 is 15 mm (R 112.5, inside the chain's 125) and carries 228 A at 30 C on its sheet; 4 in
      parallel carry 125 A each at 500 A, 55 % of that (igus chainflex CF310.UL data sheet, read 2026-11-14; source in `charge_arm.py`). The arm's
      bars stay 400 mm2: they are shut in the links.
    - *A covered trench and channel, not a chain on the floor.* People walk round the car beside the bed. A flush
      checker plate and a brush-closed slot leave nothing to trip on, and keep grit and water out of the chain.
    - *Each chain chosen by what it holds, from the maker's sheet.* While the lines were drawn, 3 chains were found too
      small for them. The CAD library drew a link to the size it was given and labelled that size "inner", and the wash
      machine's 2 chains were filled to their drawn width as if it were their inside. The charge arm's walls were a
      guess (12.5 and 8 mm). A chain's walls take 26 mm of width and 22 of height in the heavy class
      and 17 and 9 in the light one (igus product data for E4.42 and E2.26, read 2026-11-15:
      https://www.igus.com/product/series-E4-42, https://www.igus.com/product/series-E2-26; `std.CHAIN_CLASSES`).
      Now each chain is the narrowest of its class that holds its lines side by side, with the maker's clearances
      (10 % a cable, 20 % a hose): the charge arm's 2 chains 137 x 42 inside (163 x 64 outside, was drawn 160 x 56),
      the wash machine's drag chain 125 x 42 (151 x 64, was 120 x 50, with 117 mm of lines in it; its trench went from
      140 to 171 mm wide, its tray onto runners so its lines run straight into the chain), and each detail arm's chain
      57 x 26 (74 x 35, was 57 x 35 with 51 mm of lines in it).
    **Assumptions, stated:** what the charge arm's cabinet holds besides its rectifiers (the connector's cooling unit,
    the arm's controller and the base's 2 servo drives) is a layout decision, not a bought cabinet's contents. The
    hoses' and small cables' diameters are typical of their kind, not from a sheet. The derating of 4 loaded cores in
    one chain (about 0.65 at 45 C) is from memory of IEC 60364-5-52, not re-read: the cable maker confirms it before a
    cable is bought. The lines inside a chain or a duct are not drawn one by one. The clean arm's disconnect a person
    reaches from the ground is on the canopy's board, site work, and is not drawn.
    **Still open, found in the same audit:** the wash bay's 2 detail arms get their supply to the carriage (above), and
    their joints' cable runs inside the arm as the charge arm's does. Not yet drawn: how the mist nozzle's water and the
    polishing head's and camera's signals cross the wrist. The joints' through-bores are 18.8 mm at J1 and J3, 23.5 at
    J2, 11.7 at J4 and J5 and 9.4 at J6 (the cup hub's bore, `std.swg_dims`), so a 6 mm water tube can ride beside the
    10 mm joints' cable through J1 to J3 but not through J4 and J5: the water must cross the wrist outside the arm, as
    the charge arm's last booted link does, to a feed block at the nozzle (the nozzle is drawn screwed into the end of
    an 8 mm plate, which cannot take its G 1/4 thread). The camera's and the force sensor's signals could instead ride
    the joints' own network to a connector at J6, but no such connector is drawn. The camera, the J6 socket and the car
    stand within a few centimetres of that path, so it needs its own design pass and clash check.
20. **Up close, the yard drew the robots coarsely, and close inspection found gaps.** Chase, 2026-11-15: *"If you are close enough
    there's discrepancies between some of the robotics and floating items or just square opaque systems ... There cannot
    be gaps between cables randomly plugging into charging system or just floating off of robotic arms with gaps ... I
    need super high-level 4K detail when it comes to some of these integrations from a robotic standpoint."* He was
    right. Up close the yard drew each robot from its depot model (no fasteners, coarse, some parts as boxes), and
    measured against the CAD the models had real defects:
    - **Lines that stopped short of what they plug into.** Each boot of the charge arm's power path ended bare on its
      box's face; the forearm's sat 20 mm off the casting (its box is inside the hollow forearm), and the wrist boot sat
      12 mm past an M50 gland too small for a 60 mm boot. Each boot now ends in a fitting it slides 18 mm into: CHG-BFT
      on a box's face, and CHG-BF1B, CHG-BF3B and CHG-BF4A cut to the casting they stand on (CHG-BF3B went with finding
      21, when its box moved outside the forearm). The head's outlet takes the
      wrist boot in a boot outlet adapter (CHG-BTO) where the gland was. The clean arm's wand cable stopped 4.6 mm short
      of the knuckle: an entry block (CLN-WCE) now takes its end, and a boss on the knuckle now carries the nozzle air
      loop's fitting, which stood off it.
    - **Parts that hung in the air.** The wash machine's side air knives slid on a joint with nothing to slide on. A
      toothed belt axis under the beam now carries each one, with its carriage, its hanger and its gearmotor (WSH-SAX,
      WSH-SAC, WSH-SAH, WSH-SAM). The arm chains ran to the pedestals with no duct between: an elbow duct bolted to each
      pedestal now takes their lines (WSH-DCXL, WSH-DCXR).
    - **Boxes where the parts are.** The yard drew each cable chain as a box. It now draws each chain link by link, with
      each line in its own lane inside. The emergency stop was one red solid. It is now its yellow housing and its red mushroom.
    - **Tubes drawn inside out.** The viewer's tube mesh wound its faces the wrong way, in the yard and in the tab, so a
      line showed its far wall. Fixed, with end caps.
    - **A rigid line's far end, which the contact test cannot see.** The contact test passes a part that touches
      anything, so a cable held at one end passes with its other end in the air. A new check, `cad/line_ends.py`, holds
      both ends of each rigid line (`cadEnds.test.ts`), and it found 2 such ends on the clean arm. The hybrid cable to the mast reel
      began 6 mm under the mast collar's foot, 28 mm from any part. It now leaves the mast top through an outlet on the
      collar (CLN-MOB). The wrist's fixed air line stopped 1 mm short of its clamp, and now reaches it.
    - **A boot that bent past its limit, and no test found it.** At the Tesla Cybercab's mate pose the J2 link bent to 65
      mm, and its boot allows 80. The duty-cycle sweep never visited that pose. With its ends straight in their collars it
      bent to 53 mm and cut its collar, and the clash check found it. The link is now 1,200 mm and bulges toward the
      turret only: 141 mm at that pose. The wrist link is now 1,250 mm, with half its bulge from its own weight: 88 mm.
      `cadFlex.test.ts` now also sweeps each fleet car's mate pose.
    **Up close, the yard now draws the CAD itself** (see "Up close: the detail model", below). `cadDetail.test.ts` measures
    what this finding fixed, on all 3 models: no part floats (each part touches what holds it, within 1 mm on the full
    and detail models and 10 mm on the coarse depot model). Each line's end sits in what holds it, at each twin pose.
    Each line that a chain carries stays inside the links and keeps its length. No part that the detail model leaves out
    can be seen. **The cable schedule** (below) gives the rest of what was asked: each line's full route and length.

21. **What the cable schedule left open, routed (2026-11-15).** Chase, on the open items the new schedule listed: *"Yeah,
    go find a solution to all of those."* Each one now has a drawn route, its parts in the parts list and its line in the
    schedule:
    - **The charge arm's status rings had no supply.** The model said the safety cable fed them, and no route reached
      them (and a safety controller has no business lighting a status ring). Each ring is now lit by the drive of the
      joint it sits on, as a robot joint's own light is. J2: an M8 receptacle on the front of J2's rear bell (CHG-RRC2),
      wired inside the actuator to its drive board, and a 4.5 mm lead from its plug over into the left ring (CHG-RL2);
      the left ring passes the supply to the right one by a jumper in a 6.5 mm channel cored along the turret boss's top,
      under the rings (CHG-RJ2). The lead stands where nothing passes it: the upper arm's bridge goes by 156 mm out at the
      arm's own angle, the balancer stays on the +Z side, and the J2 boot runs within 30 mm of the arm's plane. The wrist
      ring wraps the socket that holds J6's rear bell, so a receptacle on the bell, through a hole in the socket, mates
      the ring's own plug (CHG-RRC6): no cable is in the open there. (J6's rear cover faces the wrist yoke 5 mm away, so
      a lead from a gland there had nowhere to go.) ASSUMPTION: each drive gives a 24 V output and a data line for its
      ring; the drive's maker confirms them. The safety cable now serves the scanner and the emergency stop only.
    - **The coolant and the air changed size at the riser.** The chains carried a 12 x 8 hose and an 8 x 6 tube, the
      boots an 8 mm and a 6 mm tube, and the schedule joined them with reducing couplings the model did not have. One 8 x
      6 tube each way and one 6 x 4 air tube now run from the cabinet to the head, through both chains and all 4 boots:
      the size the boot has room for beside its 2 braids. The chain keeps its size (the DC cores set it). The cost is
      the pump: at the connector's 2 L/min of 50 % glycol (the flow Phoenix Contact states for its liquid-cooled CCS
      cables, https://www.phoenixcontact.com/en-fr/products/dc-charging-cable-ev-t2hpcc-dc400a-80m50ecbk11r-1333722, read
      2026-11-15), a 6 mm bore loses about 0.6 bar each way over its length (laminar, at 3.7 mPa s), so the cooling unit
      must give 2 L/min against about 2 bar, where a cable-mounted unit gives 1.
    - **The 4 copper bars were not drawn and were not in the parts list.** They are drawn now, each where it runs. In
      the upper arm, 2 bars of 40 x 10 in their sleeves lie stacked on the back wall on 3 bonded insulators under
      screwed straps, each bent flatwise at its ends through a port to its box (CHG-BBUP, CHG-BBUN). The forearm swings
      past the elbow, so it takes 2 flexible conductors of 400 mm2 (OD 26, no bend under 80 mm) in 2 cleats, from a slot
      under its elbow box round the swing to a slot under its wrist-end box (CHG-FCFP, CHG-FCFN). Each box closes its
      port; the upper arm's are the openings its bar pack goes in by. The castings are the wash arms' too, so they have
      the same ports there, each closed by a plug moulded to it. Drawing them found the forearm's elbow box (CHG-PB4)
      INSIDE the casting, where no hand could reach it: its block was cut by the casting and the larger piece was kept.
      It now saddles the forearm's back, and its boot fitting is the standard one (CHG-BF3B is gone). The copper adds 11.4
      kg: J3's load margin is 1.22 (it was 1.27) and J2's 3.22 (3.46).
    - **The wash machine's side-knife gearmotors had no conduit.** Each one's 16 mm conduit (WSH-ECAL, WSH-ECAR) leaves
      the cable trunk's floor, drops through a sleeve in both decks over the motor, and turns into the motor's north face:
      the trunk lies on the top deck along the beam's middle line, and each motor hangs under the bottom deck 88 mm south
      of it, at the knife axis's end.
    - **The wash arms' pure water stopped in the pedestal.** It now runs up the arm through J1, J2 and J3 beside the joint
      cables (their bores, 18.8 and 23.5 mm, take the 10 mm cable and the 6 mm tube; J4's and J5's 11.7 mm take the
      cable alone), leaves the forearm by a bulkhead fitting in a plate in the side port the charge arm's wrist-end box
      uses (WSH-PPF, WSH-BHF), crosses J4 and J5 in a loop of 6 x 4 tube (WSH-PWLL, WSH-PWLR), and goes up the sensor
      bracket in a stainless tube (WSH-PST) to a new holder that carries the nozzle and feeds it (WSH-PNH). The nozzle had
      stood screwed into the bracket's 8 mm edge with no water reaching it.

The audit also found the wash machine's tools fed by rigid pipes that could not follow them. They now have flexible
lines that do (below). (The wands' vacuum units and the side brushes' chains it added went with finding 17.)

None of these changes the twin's kinematics, timings or the engine. The depot now draws the CAD, so each is in the
yard as designed.

## The service lines: power, signal, coolant, vacuum, water and air

Every robot needs power, a network and its media at its tool, and every line that crosses a moving joint must move
with it. A rigid part moves with its node; a line that runs from one node to another cannot, because its shape
changes with the pose. So the CAD gives each line what does not change, and the shape is solved at each pose
(`cad/otto_cad/flex.py`):

| kind | what it is | its rule | its checks |
|---|---|---|---|
| loop | a cable or hose between 2 anchors | a fixed length, or a take-up's share of the chord; 2 cubics through a middle point, or one cubic for a long span | its tightest bend against its minimum radius; never pulled straight |
| stretch | a cable on a spring reel, a coiled cable, a bellows duct | a straight run whose length follows its anchors | its length within the reel's or coil's range |
| chain | an energy chain on a linear axis | a fixed run, a 180 degree bend, a moving run | its travel within the chain's links |

The clash check places every line at every pose as a solid (a tube, a coil's envelope, a duct's box, a chain's links)
against every part. The GLB carries each line (its root's `extras.flex`, in metres) and the CAD's own solution at a
few poses (`extras.flexCheck`). `src/lib/robotics/flexLines.ts` solves the lines exactly as flex.py does, and
`flexMesh.ts` draws them: the Robotics tab bends them with the joints (a selected line lights up), and the yard draws
every robot's lines, one merged draw per material per robot kind, re-solved only when that robot moves.
`cadFlex.test.ts` holds the 2 solvers to the same points (within 0.5 mm) and sweeps each robot's whole duty cycle.

**OTTO-CHARGE ARM.** Every line comes from the DC cabinet beside the bed (finding 19): 8 DC cores of 50 mm2, 4 a
pole; 2 coolant tubes; an air tube; and 5 cables, for the joints, the tool, the safety circuit and the 2 servo motors
of the base. They leave the cabinet through a gland plate in its floor, drop through a shaft in the pad, and run in a
lined trench in the slab, under a flush checker plate, to the cable channel between the bed's beams. There each turns
onto its own lane and enters the cable chain at its fixed end, under the bed's middle. The chain's bend rolls along the
channel as the carriage moves. Cover plates close the channel flush with the deck, and a driver on the carriage runs
in the 60 mm slot between them, closed by 2 brush strips. The lines rise inside the driver into a second chain, on a
tray at the carriage plate's edge, which follows the cross-slide, and a duct on the saddle takes them into the riser.
The 2 servo cables leave the driver in conduits, one to each motor of the base. Both chains are the same: 137 x 42 mm
inside, 163 x 64 outside, bend radius 125 mm (the DC core may bend on 112.5). In the riser a terminal box joins each
pole's 4 cores to the arm's copper bars, and the bars and the booted links carry the current to the connector (finding
16). The joints' cable goes up through J1 to J5's hollow shafts. The tool's cable, the 2 coolant tubes and the air
line run with the bars and through each boot.

**OTTO-CLEAN ARM.** The power and the network: down from the canopy's cable tray, each in its own conduit, to a supply
enclosure on the drop column, 4.25 m up, which holds the controller, the power supplies, the J1 drive and the safety
relay, with a lockable isolator on its door (finding 19). A motor cable runs from it to the J1 gearmotor, and a second
cable goes in through the column wall to the J1 union, whose slip ring feeds the rest of the arm. The disconnect a
person reaches from the ground is on the canopy's board: site work, not drawn. The vacuum: a branch from the canopy's
vacuum main through a gate valve, in through the column wall and down to J1; a rotary union at J1, J2 and J3 (findings
5 and 10), a duct in each link, the mast stages, a passage through the wrist fork, the swivel on the fork, the hub and
the wand's tubes to the nozzle. The air: a drop from the canopy's air main to a service unit on the column (a lockable
shut-off valve and a filter regulator), then a 6 mm line to J1. Past J1, the air and the signals: through the same
unions; down the mast from a spring reel on
its outer stage (the line runs 0.65 to 1.95 m over the cycle); across J4 in a clock spring and a passage in the swivel
(finding 12); along the wand on a reel in its drive (0.06 to 0.94 m); and a loop of air line across the nozzle joint
(tightest bend 32 mm against 30, 22 mm clear, searched over the cycle).

**OTTO-WASH.** The building hands every line over at a service panel on the north wall, beside the exit door: a
lockable isolator, the detail arms' drive cabinet, and a shut-off valve for each of the 5 media (finding 19). Every
line drops to a pull box at the wall's foot and runs in a duct cast into the slab. 3 ducts (power, network, media)
end in a pit at the north end of the drag chain's trench, and a closed tray on the trench floor takes the 6 lines to
the chain's fixed end at mid travel, through a strain relief block. Power, network, water, 2 chemicals and air then
ride the drag chain in its covered trench to the moving machine (finding 13; its bend travels 3.68 m either way, the
full 7.37 m of the machine's travel). The chain is 125 x 42 mm inside and 151 x 64 outside, bend radius 200 mm. A
driver duct through the cover's slot joins its moving end to an arm on the west trolley. The supply cable and the
network cable go up a conduit on the leg to the control cabinet, and the water, the chemicals and the air go up a
closed duct, through the beam, to the valve manifold. From the cabinet a cable trunk runs through the beam and along
its top, with a conduit to each motor, the valves, the beacon and the stop light. Each detail arm's carriage has its
own cable chain beside its track (57 x 26 mm inside, 74 x 35 outside, bend radius 100 mm), fed from a floor box at the
chain's fixed end by 3 more ducts in the slab: power, data and pure water. On the machine: a concertina duct from the
top knife's blower (0.26 to 2.26 m as the knife moves) and a flexible duct loop to each side knife (tightest bend 337 mm
against 280). The brushes, the vacuum wands and their reels and chains went with finding 17.

Each line's minimum bend radius, mass and standard are in the bill of materials and `cad/SOURCES.md`.

## The cable schedule

Chase, 2026-11-15: *"I know the exact pieces and length of certain cables and exact routing of electrical wire and
distances of machinery and parts that I will need."* The parts list counts a line only in the pieces the CAD draws. A
DC core read `D 15 x 1822` there, its piece in the feed trench. From the cabinet to the riser's terminal box the 8
cores run 7.29 to 7.53 m, by their lanes. Bought from the parts list, they would have been cut short. **The cable schedule lists each cable, hose and tube
once, from the device it leaves to the one it reaches, with each piece of its route** (`cad/otto_cad/cables.py`: each
robot's builder declares its lines, and `cables.finish` completes and checks them). The build writes it into each parts
list (`cables`) and as `public/cad/<robot>.cables.csv`. The Robotics tab lists it in the robot's overview, and each part
that is a piece of a line names that line in its card ("in the cable schedule").

How the length of each piece is known:

| piece | its length |
|---|---|
| drawn | the line is drawn there as its own solid: its drawn centreline |
| conduit | in a drawn conduit, tube or pipe: the conduit's centreline |
| chain | in a cable chain, in its own lane: links x pitch - pi x v, the same at every pose |
| boot | in a moving boot: the boot's length, and the slack that its worst bend over the twin's poses asks of a line at its wall |
| reel | on a spring reel: what the reel holds (its range in use over the twin's poses is given) |
| loop | a free loop of fixed length |
| duct | through a duct, a box or a hollow link that the CAD draws without the lines in it: a planned route through it, its corners on the line's own bend radius, +/- what its place in the duct can change (half the inside width at each turn) |
| arm | inside the arm where no duct is drawn: a planned route between 2 points of the model, +/- its dressing |
| site | outside the machine: what the model shows, and the rest is the site's |

A line's **order length** is its route, its tolerance and its 2 tails (the length to make it off inside the box or the
cabinet at each end, with the basis given), rounded up to 0.1 m. The build stops on a piece in a part the model does
not have, or a bend tighter than its line allows.

| robot | lines | route | to order |
|---|---|---|---|
| OTTO-CHARGE ARM | 35 | 161.5 m | 198.2 m |
| OTTO-CLEAN ARM | 16 | 13.2 m | 17.6 m |
| OTTO-WASH | 54 | 376.6 m | 408.5 m |

**What it found** (each listed as an open item on its line, and each routed since: finding 21): the charge arm's
status rings had no supply; its coolant and air changed size at the riser; its 4 copper bars were not drawn; the wash
machine's side-knife gearmotors had no conduit; the wash arms' pure water stopped in the pedestal.

**What it still lists as open,** each on its line:
- The wash docks' feeds: each dock's signal cable and rinse tube run inside its post to the signal and the cup, and
  that run is not drawn (600 mm, +/- 300).
- The clean arm's link lines: in 2 of its links the CAD draws the duct, not the 2 cables and the tube beside it.
- The charge arm's DC cabinet is drawn as its envelope. The length of each line inside it (1.5 m, ASSUMPTION) is for
  the cabinet maker to confirm. The clean arm's supply and network cables also run along the canopy's tray from its
  board, and that length is the site's.

## The CAD in the yard

The depot's 3D view draws every OTTO-CHARGE ARM, OTTO-CLEAN ARM and OTTO-WASH from its CAD, in place of the simple
procedural robots it drew before. The build writes a **depot model** of each robot beside the full one
(`public/cad/<robot>.depot.glb`, `glb.py`): only the parts you can see from the yard (no fasteners, bearings, seals or
parts inside the actuators, nothing under 30 mm), tessellated coarse, a few simplified to their outline. 0.54, 0.40
and 0.33 MB; 23,760, 15,156 and 9,618 triangles in their meshes.

- **Instanced.** `cadDepot.ts` cuts the model into rigid segments (the robot's root, everything each CAD joint carries,
  each turning brush) and merges each segment's meshes per material. Each (segment, material, shadow) group is one
  instanced mesh for every robot of the kind (`instancedFleet.ts`, the code the procedural arms already used): the
  charge arms are 50 draws (10 cast shadows), the clean arms 49 (14), the wash machines 61 (35), whatever their number.
  Each robot is 24,900, 14,200 and 17,500 triangles as drawn, where the procedural arms were 6,600 and 3,400: at the
  twin depot's 30 fast chargers that is about 1.2 million triangles for the arms, plus the shadow pass. Only parts half
  a metre or more cast shadows (a link, a casting, a column).
- **Posed by the twin.** Each robot keeps a skeleton of the CAD's joint nodes and poses it from the same session as
  before: the charge arm's IK angles (its joints are the twin's J1 to J6 in the same frames), the clean arm's joints
  through `catalog.cleanAngles`, the wash machine's pose through `catalog.washJoints`. The light rings, the mast strip,
  the beacon and the stop lamps show the robot's state per instance; the brushes turn on their shafts.
- **What the site draws itself stays with the site.** The clean arm's header beam, drop column and clamps are the
  canopy's steel (`SolarCanopy`). The charge arm's riser and supply and the wash machine's rails are the robots' own,
  so `ChargingField` and `WashBays` stop drawing their simple ones once the CAD has loaded. One kind of site works is
  the robot's in the yard, because nothing else draws it: the charge arm bed's 12 grout blocks (`glb.DEPOT_SITE_KEEP`;
  without them its plates stood 77 mm over the deck).
- **Parts set flush in the deck draw over it** (2026-11-15, finding 19). The charge arm's channel and feed covers, and
  the wash machine's trench and pit covers and rail anchor plates, have their top face at the deck's own height, and
  drawn plainly they lost the depth test to the asphalt: the channel vanished from the yard, with z-fighting speckle
  along it. Their draws now take a polygon offset (`DepotCadOptions.deckY`), as the deck paint does, and cast no
  shadow. That is 1 more draw for the charge arms and 2 for the wash machines. **Still drawn over the supply, and not
  changed here:** `ChargingField`'s concrete pad from the fixed-mount design (2026-09-30) runs from behind the cabinet
  to past the arm's J1 line, about 1 m along the car, with its top 77 mm over the deck. It hides the feed cover and
  that metre of the channel covers. The CAD's own pad stops at the bed's back edge, so the yard's pad should too; it
  is the one footprint the car solids and the 2D plan share (`depotPlacement.chargerPad`), so it is a change of its
  own.
- **The CAD carries its own cables and hoses,** so the charge arm's drawn cable catenary and the clean arm's drawn hose
  go with the procedural robots.
- **Until the CAD has loaded, or if it cannot** (it is fetched once, on first view), the yard draws the procedural
  robots as before, and says so once in the console.

**Up close: the detail model** (2026-11-15, finding 20). The build writes a third model of each robot, the **detail
model** (`public/cad/<robot>.near.glb`, `glb.py` `lod='near'`): every part of the full CAD that can be seen, as finely
as the Robotics tab draws it, fasteners, fittings and chain links included. It leaves out only the parts sealed inside
each joint actuator (its gear set, motor, brake, encoders, drive board, bearings and seals: `Item.sealed`) and the lines
under the yard's deck or in the cabinet's pad (`Item.yard_hidden`). 6.36, 3.07 and 6.61 MB; 304,631, 154,028 and
310,389 triangles in their meshes (the depot models: 35,160, 23,932 and 35,654).
- **Which robots draw it.** Each frame, the director in `robotics/cadDetail.ts` picks the robots of each kind nearest
  the camera and in its view: up to 4 charge arms and 4 clean arms within 16 m, and 2 wash machines within 22 m. It
  releases them past 19 m and 26 m, so a robot at the edge does not flicker. It fetches a kind's detail model the first
  time one of its robots comes near. A robot it picks draws in its kind's detail fleet and its depot slot stays empty.
  The two models have the same joints, so one skeleton poses both (`RobotDetail.tsx`, `detailDraw.ts`).
- **One render quality.** The choice is by distance and view only. A slow frame never lowers the picture.
- **Its lines too.** Up close, each tube has 16 sides and each chain is drawn link by link, with the lines that the
  chain carries in their lanes (`flexMesh.ts`, `NEAR_FLEX_OPTIONS`).

**Held to everything the procedural robots were held to** (`cadYard.test.ts`, on the depot model's own geometry, against
the twin's car, doors, cabin, seats, cabinet and buildings, at the twin's poses):

| robot | check | as measured |
|---|---|---|
| OTTO-CHARGE ARM | every part but the connector off the car, 135 inlets and window corners, whole cycle (≥ 0.10 m) | ≥ 0.20 m (the sweep looks no further; the full CAD: 0.37 m) |
| | the connector into the car only through the inlet the car draws | its latch hook goes 14 mm into the inlet's 35 mm recess, 60 mm from its axis (radius 68 mm) |
| | everything J1 turns off the cabinet (≥ 0.15 m), the riser and trunk (≥ 0.05 m), the fault beacon (≥ 0.20 m), duty cycle and transits | 0.182, 0.411, 0.492 m |
| OTTO-CLEAN ARM | every part but the wand off the car and the open doors, whole cycle, both columns (≥ 0.10 m) | 0.104, 0.109 m |
| | the wand only through the door (≥ 0.03 m from its edges), in the cabin's free space, off the seats (≥ 0.01 m) | 0.107, 0.031, 0.014 m |
| | at home and swinging, nothing under 2 m over the car | 2.12 m |
| both arms | 0.10 m apart in every pose the twin's interlock lets them share | 0.249 m (the wand in the cabin, the connector latched outside the same flank) |
| OTTO-WASH | inside every bay's walls and partitions, every pose (≥ 30 mm) | 48 mm |
| | the frame off the car (≥ 1.0 u); a brush in no deeper than its bristles give; every other moving part off the car (≥ 0.2 u) | 3.47 u; side 0.180, top 0.150 u (their limits); 0.34 u |
| | off an open door (≥ 0.25 u), the wands into the car only through it | 1.11 u; every wand point inside the car is in the door, in the cabin, off the seats |
| | a car drives under the retracted machine wherever it stands (≥ 1.0 u) | 1.40 u |

`cadDepot.test.ts` holds that the depot model is the full CAD's machine (the same joints at the same rest frames, only
its parts), that the instanced parts redraw it exactly, and that posed by the twin's joints the CAD's working points
stand where the twin's do: the clean arm's wrist pivot and nozzle within 1 mm of `cleanArmPose` all cycle, the wash
machine's gantry and knives where `washPose` puts them, and each detail arm's elbow, wrist and pad within 1 mm of
`detailArm.ts`.

## What the two cockpits show

Chase, 2026-11-09: *"Pulse should have depot/operator level info on the functionality of the machines (not
necessarily CAD-level, but functionality and facts). Orchestra needs just user/asset/vehicle owner detail from a stall
or stage perspective. ... I think just the twin needs the CAD level detail."*

So the CAD stays in this tab, and the two cockpits get the robots at their own level:

| | who reads it | what it shows |
|---|---|---|
| the twin, Robotics tab | engineering | every part, the clash check, the service lines, the cycle on the CAD |
| OTTO-PULSE, Robots tab | the depot's crew, every owner's cars | what each machine does, its steps, facts and safety lines; what each arm and each wash bay is doing now; the run's results |
| OrchestrAV, each car's card | one fleet owner, its own cars | the machines at work on the car, the visit stage by stage with the station and the machine that does each stage, and what each machine does to the car |

**What a machine IS has one home, here.** `machineFacts.ts` builds `public/cad/robot-facts.json` from what this tab
already holds: `ROBOT_INFO` and `FUNCTIONS` (the name, the summary, the functions), `cycleSteps()` (the steps and their
times, from the twin's phase tables), the parts lists' subsystem sentences and specs (the facts and the safety lines),
and the cycle times in `cleanArmSpec.ts` and `washSpec.ts`. A fact that quotes a parts-list sentence fails the build
when that sentence is gone. It adds the sentences an owner reads. `machineFacts.test.ts` holds the committed file to
the builder's output, the steps to the tab's, the charge arm's connect and release times to `ARM_TIMING_DEFAULTS`,
and every sentence to plain words (20 words at most, no semicolons, no joint names for an owner). Write the file again
with `ROBOT_FACTS_WRITE=1 npx vitest run src/lib/robotics/machineFacts.test.ts`.

Each cockpit carries a copy at `src/lib/twin/robotFacts.json`. **When `public/cad/robot-facts.json` changes, copy it
to both cockpits**, byte for byte. Their `src/lib/twin/robots.ts` reads it, and their tests read the machine names and
step words from it.

**What a machine is DOING is never in that file.** The cockpits read it from the feeds this cockpit reads:

- the charge arm: the snapshot's `stalls_status` (`tethered`, `tether_direction`, `tether_phase`), its open cycles with
  their retries (`arm.cycles`), its times and its results for the run (`arm.timings`, `arm.accuracy`);
- the cleaning arm: the car's visit atom `interior_tidy` with `performed_by: 'stall_cabin_robot'`, the stall
  (`robot_stall_id`) and its times (`started_at`, `ends_at`, `done_at`);
- the wash machine: the car's `bay_seat` (`since`, `ends_at`) while its state is `in_wash_bay` or `in_detail_bay`;
- a car's stages: `ottoq_depot_cards` 1.5, each step with its station (`to_stall_code`, `to_stall_kind`);
- the run's service counts: `ottoq_twin_kpi_board` (`service.by_service`), and `ottoq_twin_events_window.by_type`
  for the arm's events.

So `TwinVisitAtom` in `src/lib/ottoTwin.ts` carries `performed_by`, `awaiting_triage` and `triage_verdict` (the
snapshot has published them since otto-q-core 0512), and the cockpits copy that type with the rest of the wire types.

**Links both ways.** `/?tab=robotics&robot=<charge_arm|clean_arm|wash_gantry>` opens this tab on one machine
(`cockpitLinks.ts`: `tabFromSearch`, `robotFromSearch`; an unknown robot opens the charge arm). PULSE's Robots tab
links each machine to it ("Engineering model in the twin"). This tab's banner links the other way, to PULSE's Robots
tab (`pulseRobotsUrl`: `/?tab=robots`, with `source=twin&run=` while the run on screen is live), because the CAD is
design data and PULSE shows what each machine is doing now.

## Honest limits

- Bought parts (gears, motors, bearings, encoders, blowers, the connector) are drawn as accurate envelopes with their
  real interfaces, not the vendor's internal geometry. Gear teeth are drawn at 64 a gear; the real counts are in the
  part's spec.
- Fastener head sizes are the standards' nominal values (`cad/SOURCES.md` says which were cross-read). Tightening
  torques are computed by the VDI 2230 method at friction 0.12 and match the published table where checked.
- No FEA, no fatigue or bolted-joint slip check beyond the torque method, and no dynamics in the load check.
- The clash check measures the solids as drawn, at separate poses: the stowed pose, each pose the tab offers, and the
  middle and the end of each cycle step. It does not sweep the motion between two poses, so a part can pass through
  another between them unseen. A bought part is its envelope, so a clash inside a vendor's part cannot be seen, and an
  envelope can show a clash the real part would not have. Overlaps under 10 mm³ are not counted (they are the size of
  the booleans' tolerance on faces that touch). Cables and hoses are drawn in one route on one link, so they do not
  follow a joint; where a run crosses a joint the CAD draws a gap or a swivel.
- The contact test proves that each part touches another within 0.3 mm, not that it is fastened: a part that only
  rests against its neighbour passes. Screws are checked against the threads the CAD does not draw only by volume
  (the overlap must lie inside the screw's own hole cylinder, below its head).
- Far from the camera, the depot's 3D view draws the CAD's depot model, not the full CAD: fasteners and parts inside
  the actuators are left out, and curved faces are coarser (a curved face is within about 1% of its part's size). Up
  close it draws the detail model: every part that can be seen, the parts sealed inside the actuators left out. The 2D
  plan still draws each robot's outline from the twin's kinematic points (`robotPlan.ts`).
- The cable schedule's duct and arm pieces are planned routes, not lines drawn one by one: their tolerance says how
  much the dressing can change them. Its joint cables are straight between 2 points of the model, plus up to a quarter
  for their dressing in the casting, and so is the wash arms' pure-water tube through J1 to J3. Its tails are
  assumptions, each one stated.
- Inside an actuator nothing is drawn but its parts: the status rings' receptacles are wired to their drive boards by
  the actuator's maker, and the wash arms' pure-water tube passes J1 to J3's glands and bores as the joint cable does,
  unseen. The copper inside the charge arm's castings is bonded and strapped as drawn; the passages the arm's terminal
  boxes seal round it are drawn as plain ports, not as glands.
- The yard's clearance tests sample the depot model's vertices, as the procedural tests sample the procedural robots'.
  The two-arm test covers the pairs the twin's interlock lets happen (the clean arm goes out over the car only while
  the charge arm is stowed or latched; the charge arm moves only while the clean arm is home), not every combination.

## The tab

After Research, with a wrench; a banner says *Engineering CAD. Design data, not live.* Opening it widens the panel to
full width on a desktop (Esc returns it). Pick a robot, or a function (charging, interior, vacuum, overhead cleaning,
wash bay); turn, frame, explode and cut the model; hide the fasteners; show the twin's car; pose it from the twin's
code; isolate a major function (what it does, how, specs, parts, screws, mass) and the parts list narrows to it; pick a
part in the list or the view and the rest x-rays while the camera zooms to it; its card gives the standard, size,
grade, material, mass, tightening torque and where it is used. The overview lists the cable schedule: each line with
its route and order lengths; open a line for each piece of its route, and pick a piece to select it in the model.
Downloads: STEP, GLB, the parts list and the cable schedule (CSV).

**Pick a step** (2026-11-11). Each step in "How it runs" is a button: the model takes the pose that step ends in (the
connector in, the wand in the cabin). A cockpit can ask for a step with `?tab=robotics&robot=<machine>&step=<id>`.
OTTO-PULSE's status feed links each step here. PULSE draws no model and has no live follow (Chase, 2026-11-11).

**Follow a robot in the depot** (2026-11-11) poses the model from a machine the yard draws now. It is offered while a
run plays in the yard, and it is the one time this tab reads the run. The pose is not a second evaluation: it is the
motion driver's own session for that stall or wash bay (`armSessionAt`, `cleanSessionAt`, `washSessionAt`) through the
pose code the yard uses (`poseFor` with the port of the car the arm serves, `cleanSessionJoints`, `washPoseAt`), in
`src/lib/robotics/liveFollow.ts` and `src/components/robotics/useLiveFollow.ts`. The machine that works is picked
first, and a list gives the others. The banner then reads *Engineering CAD. The pose follows Fast charger 02 now.*, a
line gives the step and the car, and the joint sliders become read-outs. A pose preset, the cycle or Reset ends it.
Three limits, stated on purpose. The model stands on one side of its car, so an arm on the other side shows as its
mirror image, and the tab says so. The model's car is the sample car, at the followed car's port position. The 3D yard
limits how fast a drawn joint turns, and the model shows the solved pose, so the two can differ for a moment in a fast
move. The follow reads and decides nothing.

**Run the cycle** plays the robot's whole cycle on the CAD, at 1x to 8x, with the step it is on: the charge arm through
`poseForPhase` (unstow to retract, to the same rear-quarter port), the clean arm through `cleanJointsAt` (doors to
doors), the wash machine through `washPoseAt` (settle, cabin vacuum, the 6 passes). A step the twin times by the car
(the charge, a side's clean, the vacuum) plays short and says so. `catalog.test.ts` checks the charge arm's insert ends
with the connector on the port. **Move the joints** has a slider for every axis the GLB carries, inside its limits.

`node scripts/roboticsShots.mjs --url <dev server>` shoots the tab read-only (every Supabase request aborted);
`cad-check.html` (dev only) draws one robot at a fixed camera and `scripts/cadShots.mjs` shoots it.
