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
| `cad/` | the CAD program (Python, CadQuery 2.8 on OpenCascade 7.9): `otto_cad/std.py` standard parts, `actuator.py` the robot joint, `robots/*.py` the three machines, `build.py` the build. `cad/README.md` says how to run it; `cad/SOURCES.md` lists every external fact and assumption. |
| `cad/spec/robots.json` | the robots' interface dimensions, written by `src/lib/robotics/cadSpec.ts` from the twin's own specs |
| `public/cad/` | the outputs: `<robot>.step.zip` (the CAD), `<robot>.glb` (the same assembly for the web), `<robot>.bom.json/.csv` (the bill of materials), `manifest.json` |
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
| OTTO-CHARGE ARM | 713 | 177 | 529 | 296 kg (with its riser) | 23.5 MB (4.0) | 6.2 MB |
| OTTO-CLEAN ARM | 454 | 145 | 281 | 316 kg (with 198 kg of canopy steel) | 16.0 MB (2.6) | 4.3 MB |
| OTTO-WASH | 578 | 65 | 370 | 3,411 kg | 5.1 MB (0.9) | 1.1 MB |

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
connector with its contacts, latch hook and solenoid, vision pod, cable dress pack, safety laser scanner, emergency stop.

**Load check, from the CAD's own masses** (`charge_arm.torque_budget`): at full horizontal reach J2 carries 1,475 N·m
of gravity and J3 463 N·m (98 kg and 46 kg distal, plus an assumed 4 kg of hanging cable). A size 40 gear's repeated
peak is 738 N·m: J3 has ×1.59. A size 50's is 1,274 N·m, under J2's load, so J2 needs a balancer. A search over the
balancer's preload and rate picked a rate of zero, a constant force: the signature of a nitrogen gas spring, not a coil
spring. With a gas spring of 15 % progression (9.2 kN extended, 175 mm stroke, 320 mm under and 160 mm over the axis)
the J2 gear sees at most 284 N·m over the joint's ±110° balanced travel (×4.49). At the ports the twin serves, J2 stays
between 18.7° and 64.7°. Dynamics and the cable's pull are not in these figures.

### OTTO-CLEAN ARM

Canopy header (RHS 200 × 180 × 8) on 4 angle clips under two purlins, SHS 200 drop column, J1 (size 32, its motor bell
inside the column), welded box links with top covers and energy chains, J2 (size 25), J3 on a slewing bearing driven by
a servo gearmotor through a 3:1 belt, a 3-stage mast (rack and pinion on stage 2, a doubling belt for stage 3, acetal
wear pads), J4 (size 20), a 3-stage carbon wand that is itself the vacuum duct (lip seals between the tubes, a ball-screw
drive and a doubling cable), and the nozzle (worm-driven pitch, vacuum duct, air knife, brush lip, light ring). Vacuum
riser, hoses and clips.

### OTTO-WASH

Two galvanised channel rails on anchor plates, trolleys with PU wheels, side rollers and a geared travel motor each
side, post-and-brace legs with cladding, a two-chord beam, stainless spray arch with 23 nozzles and 4 solenoid valves,
a top brush on a 2-rail lift, two side brushes on rack-driven carriages, a top and two side air knives with 3 blowers,
two 4-stage detail vacuum columns with reach slides, stop light, beacon, control cabinet and the supply drag chain.

## What the CAD found (design findings, not yet in the depot renderer)

1. **J2 needs a balancer, and it should be gas.** Above. The twin draws no balancer.
2. **The pitch actuators are longer than the drawn drums.** The twin draws the J2 drum 135 mm wide; a size-50 joint
   with its motor, brake, encoders and drive board is 239 mm long along its axis (J3: 205 mm). The extra length lies
   along the car, not toward it. The depot's clearance tests measure the drawn arm, not this envelope.
3. **The clean arm's wand passes through its wrist.** A 0.52 m wand stage cannot retract into a 0.45 m base tube with a
   joint actuator on the pivot, so the CAD stands J4 beside a hub the wand slides through. The wrist is 270 mm wide
   along its pitch axis where the twin draws 150 mm. When the wand points into the car that axis runs along the car.
4. **The wash wands need 4 stages, not 1 tube.** The twin draws one tube scaled to the drop. A column that drops
   2.38 m and stows its head just under the beam stood 4.75 m high with 3 stages, 4 cm under the wash hall's 4.79 m
   roof. With 4 stages it stows at 4.23 m (`cad.test.ts` keeps it 0.3 m under the roof).

None of these changes the twin's kinematics, timings or the engine. Whether the depot renderer adopts the CAD's
envelopes is a separate change, measured by the clearance tests when it is made.

## Honest limits

- Bought parts (gears, motors, bearings, encoders, blowers, the connector) are drawn as accurate envelopes with their
  real interfaces, not the vendor's internal geometry. Gear teeth are drawn at 64 a gear; the real counts are in the
  part's spec.
- Fastener head sizes are the standards' nominal values (`cad/SOURCES.md` says which were cross-read). Tightening
  torques are computed by the VDI 2230 method at friction 0.12 and match the published table where checked.
- No FEA, no fatigue or bolted-joint slip check beyond the torque method, and no dynamics in the load check.
- The depot's 3D view still draws its own simplified robots; the Robotics tab draws the CAD. The two share every
  interface dimension, by test.

## The tab

After Research, with a wrench; a banner says *Engineering CAD. Design data, not live.* Opening it widens the panel to
full width on a desktop (Esc returns it). Pick a robot, or a function (charging, interior, vacuum, overhead cleaning,
wash bay); turn, frame, explode and cut the model; hide the fasteners; show the twin's car; pose it from the twin's
code; isolate a major function (what it does, how, specs, parts, screws, mass) and the parts list narrows to it; pick a
part in the list or the view and the rest x-rays while the camera zooms to it; its card gives the standard, size,
grade, material, mass, tightening torque and where it is used. Downloads: STEP, GLB, CSV.

`node scripts/roboticsShots.mjs --url <dev server>` shoots the tab read-only (every Supabase request aborted);
`cad-check.html` (dev only) draws one robot at a fixed camera and `scripts/cadShots.mjs` shoots it.
