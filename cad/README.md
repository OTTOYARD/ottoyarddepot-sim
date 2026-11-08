# OTTOYARD robot CAD

Parametric engineering CAD of the depot's three robots, built in Python with CadQuery 2.8 (OpenCascade 7.9),
from the SAME numbers the twin draws them with.

| robot | what it does | file |
|---|---|---|
| OTTO-CHARGE ARM | 6-axis arm that plugs the DC connector into the car at each fast charger | `otto_cad/robots/charge_arm.py` |
| OTTO-CLEAN ARM | overhead SCARA with a telescoping mast and vacuum wand that cleans the cabin while the car charges | `otto_cad/robots/clean_arm.py` |
| OTTO-WASH | rollover gantry in each wash bay: spray arch, top and side brushes, air knives, detail vacuum wands | `otto_cad/robots/wash_gantry.py` |

## Build

```bash
python3 -m venv cad/.venv
cad/.venv/bin/pip install -r cad/requirements.txt
cad/.venv/bin/python cad/build.py            # all three, about 40 s
```

Outputs go to `public/cad/` (the twin's Robotics tab reads them):

- `<robot>.step.zip` — the CAD: a STEP AP214 assembly, millimetres, Y up, every part a named solid, repeated
  parts stored once and placed many times. Opens in SolidWorks, Fusion, Onshape, FreeCAD. The assembly is written at
  the robot's STOWED pose, with its flexible lines (cables, hoses, ducts, chains) as solids solved at that pose.
- `<robot>.glb` — the same assembly for the web: metres, Y up, in the twin's own frame, one mesh per part shared by
  every placement. Node `extras` carry the part id, its subsystem, its explode vector, and each joint's axis, limits and
  the twin's stowed angle.
- `<robot>.bom.json`, `<robot>.bom.csv` — the bill of materials: every part to the last washer, with quantity,
  standard, size, grade, material, mass (from the solid's volume x density, or a catalogue mass for a bought assembly
  drawn as its envelope), tightening torque for every screw (VDI 2230), function, and where it is used.
- `<robot>.depot.glb` — the depot model the twin's 3D yard draws the robot from: the parts you can see from the yard
  (no fasteners, bearings, seals or parts inside an actuator, nothing under 30 mm), tessellated coarse, a few drawn as
  their outline (`PartDef.depot`), with the same joints. `src/lib/robotics/cadYard.test.ts` holds it to the car, the
  doors, the cabinet and the wash hall at the twin's poses; run it after a CAD change.
- `manifest.json` — the list of robots, files, sizes, totals and each STEP's re-import check.

The flexible lines (`otto_cad/flex.py`): a line that crosses a moving joint is defined by its anchors (a point and a
direction on a node), its length rule and its tightest allowed bend, and is solved at each pose: a loop (a fixed
length or a take-up's share of the chord), a stretch (a reel cable, a coil, a bellows duct) or an energy chain. The
clash check places each one at every pose; both GLBs carry them in the root's `extras.flex` (metres) with the CAD's own
solutions at a few poses (`extras.flexCheck`), and the twin's viewer and yard solve them the same way
(`src/lib/robotics/flexLines.ts`, held to these points by `cadFlex.test.ts`).

Before it publishes a STEP the build re-imports it: every placed part must come back as a named solid and every solid
must be valid (`build.py step_check`), or the build stops. A part id defined twice with different solids stops it too
(`core.Model.part`): one id is one solid.

## Clash check

```bash
CAD_SPEC_WRITE=1 npx vitest run src/lib/robotics/cadPoses.test.ts   # only if the twin's poses changed
cad/.venv/bin/python cad/clash.py --baseline                          # after build.py; all three, about 30 min
cad/.venv/bin/python cad/clash.py wash_gantry --stowed                # one robot, stowed pose, prints only
```

It places every part at the stowed pose and at each of the twin's poses (`cad/spec/poses.json`), measures the volume
every overlapping pair shares, and checks that every part touches another, in one connected piece
(`otto_cad/check.py` says what counts as expected: a screw in a tapped hole the CAD does not draw, a seal in its
groove, a retaining ring, a gear mesh). It writes `public/cad/<robot>.clash.json` with the digest of the GLB it
checked; `--baseline` lowers `cad/clash_baseline.json` to what it finds (never raises it). `cad.test.ts` fails when a
report does not match its GLB, did not run at every twin pose, or finds more clashes or loose groups than the baseline.

## One home for every number

The interface dimensions (link lengths, mount heights, joint positions, brush radii, travel, the car) are not typed
here. `cad/spec/robots.json` is the output of `src/lib/robotics/cadSpec.ts`, which reads the twin's specs
(`cobotSpec.ts`, `cabinetEnvelope.ts`, `cleanArmSpec.ts`, `cleanArmPlacement.ts`, `washSpec.ts`, `vehicleEnvelope.ts`).
`src/lib/robotics/cadSpec.test.ts` fails if the snapshot and the twin disagree, and `src/lib/robotics/cad.test.ts`
checks the built files against the twin (joint positions, joint names, the stowed pose). After changing a robot spec:

```bash
CAD_SPEC_WRITE=1 npx vitest run src/lib/robotics/cadSpec.test.ts
cad/.venv/bin/python cad/build.py
```

## What is designed here, and what is not

Designed (the CAD's own engineering): the mechanical layout of every joint (actuator, bearing, gear, brake, encoders,
seals, every screw), the castings, weldments and links, the tool, the fastener specs and torques, the masses, and the
charge arm's torque budget (`charge_arm.torque_budget`: J2's gas-spring balancer is sized by search, and J2 and J3 are
checked against their gears' repeated peak torque).

Not designed here: the electronics inside the drive boards, the controller software, the vendor's internal geometry of
bought parts (gears, motors, bearings, blowers are drawn as accurate envelopes with their real interfaces), and
detailed FEA. External facts and assumptions are listed in `cad/SOURCES.md`.
