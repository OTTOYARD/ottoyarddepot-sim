# Notes from Hermes

Wired `otto_motion.py` into the Isaac stream. Answers to the three asks below,
plus what I had to adapt.

## 1. Does it move?

**Yes — headless-verified.** `motion.update()` returns real interpolated positions
(`test_otto_motion_headless.py` on the box):

```
v-travel: x=-7198.5cm y=5280.0cm heading=-90.0deg   # 100ft leg, mid-flight, east
v-dwell:  x=-5671.2cm y=3751.2cm heading=-0.0deg     # holds destination
```

A 100 ft `travel` leg glides across frames; a `dwell` leg holds; heading negates
correctly for the canonical y-flip. The full stream server is deployed and
running (`[STREAM] OttoMotion ready (edge-function source)` in `stream.log`,
port 49100 up).

**Live motion is pending a run.** At test time there was no `running` sim
(`/sim_runs` returned all `completed`), so the poll legitimately holds the last
frame. The moment a run starts the poll resolves it (`_active_run_id` →
`/sim_runs/{id}/snapshot`) and prims will move. I could not verify the live
feed end-to-end without a run; the interpolation math is what I *could* prove,
and it checks out.

## 2. `live_bridge.py` as it stood

Committed as `isaac/live_bridge_canonical.py` — the edge-function bridge that
was live before OttoMotion. It **snapped** vehicles to stall centres on each
poll (no interpolation), which is exactly the "perfectly still cars that
teleport on poll boundaries" symptom in the README. It is now **removed from
the stream**; OttoMotion owns vehicle transforms exclusively. It had a unit bug
along the way (treated layout feet as plan units until I added the
`/1.569882` conversion) — the committed version has the feet→plan→cm path.

## 3. Prim paths

**Now match the default.** I changed `build_tesla` (`canonical_vehicle.py`) to
create `/World/Vehicles/veh_{vid.replace('-','_')}` — same as OttoMotion's
`prim_path_for` default — instead of the old `av_{10chars}`. Also split the
rotation so OttoMotion can own the heading: `rotateX(90)` is the structural
Y-up→Z-up conversion (never touched), `rotateZ` is the heading (OttoMotion
writes `xformOp:rotateZ` every frame). Before, the vehicle used one
`rotateXYZ(90,0,h)` op, which would have left OttoMotion adding a second
`rotateZ` and double-rotating.

## What I adapted (Claude's module unchanged)

`isaac/otto_motion.py` is **unmodified**. Two things live in
`isaac/otto_motion_canonical.py`:

**A. Data source — `EdgeSnapshotSource`** (option B from the README). The RPC is
still dead on this box (`p_sim_run_id` required + returns `sim_run not found`
even for the live UUID), so I kept the edge function and shimmed four field
differences into OttoMotion's expected shape:

| edge function | → OttoMotion expects |
|---|---|
| `run.sim_clock` | `run.sim_clock_current` |
| `run.speed_x` | `run.time_scale` (the edge fn's `time_scale` is sim-minutes/tick = 60, *not* the 3× advance rate) |
| `legs[].kind` = `flow_contract`/`charge_curve`/`distribution` | `travel`/`dwell` |
| `fleet[].stall_id` (UUID) | `fleet[].stall_x`/`stall_y` (feet, joined to `/depot/{id}/layout`) |

**B. Coordinate frame — `CanonicalOttoMotion`.** `_to_stage()` in the base maps
layout feet → stage units *absolutely* (`feet × 0.3048 / mpu`). The shipping
stage is not absolute — it is plan-unit-centred at (150,110) with y negated
(`plan_to_cm`, U=48cm). I overrode `_to_stage()` to that mapping and negated
`_heading_for()` (the y-flip mirrors heading). Without this the cars would land
~72 m off-centre on a mirrored axis.

## Open items (not done)

- **Parked heading.** For a `dwell` leg `_heading_for` returns 0.0; the correct
  parked heading is the stall's layout heading (north for DCFC/L2). I left this
  — travel heading is right, parked cars face 0°. Wants a stall-heading map
  joined to the layout.
- **Arm animation.** The 40 charging arms are built once and static; the old
  bridge's `_animate_arms` did not survive the swap. Legs carry the charge
  state, so arms can be driven from `charge_curve` legs per stall.
