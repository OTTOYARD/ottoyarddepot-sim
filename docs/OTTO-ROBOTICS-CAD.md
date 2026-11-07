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
| `cad/` | the CAD program (Python, CadQuery 2.8 on OpenCascade 7.9): `otto_cad/std.py` standard parts, `actuator.py` the robot joint, `robots/*.py` the three machines, `build.py` the build, `clash.py` and `otto_cad/check.py` the clash check. `cad/README.md` says how to run it; `cad/SOURCES.md` lists every external fact and assumption. |
| `cad/spec/robots.json`, `cad/spec/poses.json` | the robots' interface dimensions and the twin's poses for the clash check, written by `src/lib/robotics/cadSpec.ts` and `cadPoses.ts` from the twin's own code |
| `public/cad/` | the outputs: `<robot>.step.zip` (the CAD), `<robot>.glb` (the same assembly for the web), `<robot>.bom.json/.csv` (the bill of materials), `<robot>.clash.json` (the clash report), `manifest.json` |
| `src/lib/robotics/` | `cadSpec.ts` (the spec bridge), `cadModel.ts` (load, pose, explode, isolate, pick), `catalog.ts` (data, words, pose presets and run steps from the twin's code) |
| `src/components/robotics/CadViewer.tsx`, `src/components/tabs/TwinRoboticsTab.tsx` | the 3D view and the tab |

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
at home, mid brush pass, dry pass and cabin vacuum (`washPoseAt`). Its run steps are the twin's phase tables
(`NOMINAL_SEQUENCE` and `ARM_TIMING_DEFAULTS`, `CLEAN_CHAIN` and `CLEAN_PHASE_S`, `washChain` and `PASS_NOMINAL_S`).

## The three machines (as built 2026-11-07)

| robot | parts | different parts | screws, nuts, washers, pins | mass | STEP (zip) | GLB |
|---|---:|---:|---:|---:|---:|---:|
| OTTO-CHARGE ARM | 666 | 188 | 467 | 313 kg (with its riser) | 32.8 MB (6.2) | 6.9 MB |
| OTTO-CLEAN ARM | 467 | 154 | 293 | 317 kg (with its canopy steel) | 17.4 MB (2.9) | 4.7 MB |
| OTTO-WASH | 792 | 102 | 449 | 4,152 kg | 6.5 MB (1.1) | 1.2 MB |

(Fewer fasteners than the first pass: where the clash check found a screw standing in another part, or holding a part
the new layout leaves out (the wash beam's cover, the clean arm's mast cap and first hose), it went. The masses went
up: the actuators came out longer, the wash machine's beam became a box girder, and its drag chain trough's floor now
runs to the rail's anchor plates.)

**Every STEP is re-imported by the build before it is published** (`build.py step_check`): each placed part must come
back as a named solid and every solid must pass OpenCascade's validity check, or the build stops. As built: 668, 469
and 792 named parts (the counts include the reference context parts), 1,360, 855 and 855 solids, 0 invalid.

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
time-of-flight module, IR illuminator board, window and gasket, the cable dress pack with a spring retract unit on the
upper arm, safety laser scanner, emergency stop.

**Load check, from the CAD's own masses** (`charge_arm.torque_budget`): at full horizontal reach J2 carries 1,602 N·m
of gravity and J3 476 N·m (112.7 kg and 50.8 kg distal, plus an assumed 4 kg of hanging cable). A size 40 gear's
repeated peak is 738 N·m: J3 has ×1.55. A size 50's is 1,274 N·m, under J2's load, so J2 needs a balancer. A search
over the balancer's preload and rate picked a rate of zero, a constant force: the signature of a nitrogen gas spring,
not a coil spring. With a gas spring of 15 % progression (10.0 kN extended, 175 mm stroke, 320 mm under and 160 mm
over the axis) the J2 gear sees at most 310 N·m over the joint's ±110° balanced travel (×4.12). At the ports the twin
serves, J2 stays between 18.7° and 64.7°. Dynamics and the cable's pull are not in these figures. (The distal masses
went up from the first pass, 96 and 42 kg: the actuators are longer with every part in its own space.)

### OTTO-CLEAN ARM

Canopy header (RHS 200 × 180 × 8) on 4 angle clips under two purlins, SHS 200 drop column, J1 (size 32, its motor bell
inside the column), welded box links with top covers and energy chains, J2 (size 25), J3 on a slewing bearing driven by
a servo gearmotor through a 3:1 belt, a 3-stage mast (rack and pinion on stage 2, a doubling belt for stage 3, acetal
wear pads), J4 (size 20) with the vacuum crossing it through the hub's hollow stub and a swivel on the fork, a 4-tube
carbon wand that is itself the vacuum duct (3 tubes slide, a third of the reach each, on lip seals; a ball-screw drive and
cables), and the nozzle (worm-driven pitch, vacuum duct, air knife, brush lip, light ring). Vacuum riser, hoses and
clips, J2's two drum covers, link covers and the carriage lid. The mast stages are the vacuum duct from J3 to the wrist.

### OTTO-WASH

Two galvanised channel rails on anchor plates, trolleys with PU wheels, side rollers and a geared travel motor each
side, post-and-brace legs with cladding, a box-girder beam, stainless spray arch with 23 nozzles and 4 solenoid valves,
a top brush on 2 telescoping lift columns (a sleeve through the beam and 3 stages each, driven by a cross shaft with
2 belt drums in pillow blocks), two side brushes on carriages each driven by a gearmotor and pinion on a rack, a top air
knife on 2 more lift columns with a servo gearmotor each, two side air knives, 3 blowers and their ducts, the valve
manifold and arch feed hose, two 4-stage detail vacuum columns, each with a 2-tube telescoping reach, stop light, beacon, control cabinet
and the supply drag chain in a trough clear of the travel drive.

## Every part against every other: the clash check

`cad/clash.py` builds each robot again and places every solid where the assembly puts it, at the stowed pose and at
every pose in `cad/spec/poses.json`: each pose the tab offers, and the middle and the end of every step of the robot's
cycle, from the twin's own pose code (`cadPoses.ts`). It finds the pairs of parts whose boxes overlap and measures the
volume they share with an OpenCascade boolean. A pair inside one rigid body is measured once; a pair across a joint is
measured again at every pose.

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
| OTTO-CHARGE ARM | 22 | 32,311 | 0 | 0 | 672, 12, 9, 3 |
| OTTO-CLEAN ARM | 42 | 19,643 | 0 | 0 | 367, 6, 6, 2 |
| OTTO-WASH | 39 | 13,109 | 0 | 0 | 503, 0, 0, 0 |

No clash and no loose part is left in any robot, at any of the twin's poses, and `cad.test.ts` holds all three at
zero. The last two were design findings 6 and 7, fixed in the CAD without a change to the twin.

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

## What the CAD found (design findings, not yet in the depot renderer)

1. **J2 needs a balancer, and it should be gas.** Above. The twin draws no balancer.
2. **The pitch actuators are longer than the drawn drums.** The twin draws the J2 drum 135 mm wide. Built with every
   part in its own space, a size-50 joint is 317 mm long along its axis (size 40: 276 mm, 32: 243 mm, 25: 205 mm, 20:
   182 mm). The extra length lies along the car, not toward it. The depot's clearance tests measure the drawn arm, not
   this envelope.
3. **The clean arm's wand needs 3 sliding tubes, not 2.** The twin draws a 0.45 m base tube and 2 tubes that each slide
   half of the 0.92 m reach. Each of those is then 0.52 m long, longer than the base tube, so retracted they stand
   120 mm behind the pitch pivot. The twin hangs the wand straight down while it is retracted (14 of its 41 poses), and
   then the tubes meet the wrist fork and the mast's foot, 100 mm above the pivot. With 3 sliding tubes of 0.37 m every
   tube lies inside the base tube when retracted; the innermost is still the twin's 44 mm tube. The CAD stands J4
   beside the hub, so the wrist is 270 mm wide along its pitch axis where the twin draws 150 mm. When the wand points
   into the car that axis runs along the car.
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

None of these changes the twin's kinematics, timings or the engine. Whether the depot renderer adopts the CAD's
envelopes is a separate change, measured by the clearance tests when it is made.

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
- The depot's 3D view still draws its own simplified robots; the Robotics tab draws the CAD. The two share every
  interface dimension, by test.

## The tab

After Research, with a wrench; a banner says *Engineering CAD. Design data, not live.* Opening it widens the panel to
full width on a desktop (Esc returns it). Pick a robot, or a function (charging, interior, vacuum, overhead cleaning,
wash bay); turn, frame, explode and cut the model; hide the fasteners; show the twin's car; pose it from the twin's
code; isolate a major function (what it does, how, specs, parts, screws, mass) and the parts list narrows to it; pick a
part in the list or the view and the rest x-rays while the camera zooms to it; its card gives the standard, size,
grade, material, mass, tightening torque and where it is used. Downloads: STEP, GLB, CSV.

**Run the cycle** plays the robot's whole cycle on the CAD, at 1x to 8x, with the step it is on: the charge arm through
`poseForPhase` (unstow to retract, to the same rear-quarter port), the clean arm through `cleanJointsAt` (doors to
doors), the wash machine through `washPoseAt` (settle, cabin vacuum, the 6 passes). A step the twin times by the car
(the charge, a side's clean, the vacuum) plays short and says so. `catalog.test.ts` checks the charge arm's insert ends
with the connector on the port. **Move the joints** has a slider for every axis the GLB carries, inside its limits.

`node scripts/roboticsShots.mjs --url <dev server>` shoots the tab read-only (every Supabase request aborted);
`cad-check.html` (dev only) draws one robot at a fixed camera and `scripts/cadShots.mjs` shoots it.
