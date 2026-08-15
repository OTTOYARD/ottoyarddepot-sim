# Notes from Hermes

Wired `otto_motion.py` into the Isaac stream. Answers to the three asks below,
plus what I had to adapt.

## 1. Does it move?

**Yes — confirmed live.** On the running sim (`40eec1b8`), `motion.update()` places
65 vehicles and **22 are actively interpolating** (positions + headings changing
between samples). The stream server logs `[MOTION] poll=21 targets=116 placed=66
err=None` every 5 s.

**The one thing that blocked motion was `from_x`.** The edge function publishes
only each leg's *destination* (`to_stall` / `to_x` / `to_y`); `from_x/from_y` are
null on 125 of 126 legs. OttoMotion's `Leg.position_at` treats a travel leg with
no origin as "hold at destination", so every car sat at its stall. Fixed in
`EdgeSnapshotSource.fetch`: chain `from_x/from_y` from the prior leg's
destination (per vehicle, sorted by `seq`) and use the INGRESS gate
(`sitePlan.ts`: plan 200,215) for the first leg — the same reconstruction
`TwinMotionDriver` does.

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

- **Arm animation.** The 40 charging arms are built once and static; the old
  bridge's `_animate_arms` did not survive the swap. Legs carry the charge
  state, so arms can be driven from `charge_curve` legs per stall.
- **Parked heading is a flat NORTH (180°), not per-stall.** Correct for the
  DCFC/L2 charger lanes (all northbound); staging/wash/service stalls that face
  other ways will read slightly wrong until a per-stall heading is joined from
  the layout.

## Follow-up: vehicle orientation (upside-down) — fixed

After the first live feed, vehicles were upside-down / underground at headings
away from 0°. Two causes, both in `canonical_vehicle.py`:

1. **Rotation order.** The Tesla USDZ is Y-up, length along Z (bbox X=width
   4.65 m, Y=height 3.0 m, Z=length 10 m). `rotateX(90)` flips Y-up→Z-up and
   must be applied BEFORE the heading rotation. Split `rotateX`/`rotateZ` ops
   are listed `[translate, rotateZ, rotateX]` so USD applies rotateX first —
   the original single `rotateXYZ(90,0,h)` op had the same internal order, but
   my first split added `rotateX` before `rotateZ`, reversing it.
2. **A redundant `rotateY(-90)`** on the child was also folding an extra 90°
   into the heading. Removed.

Heading convention is now: `rotateZ = atan2(dx, dy)` degrees directly (no
negation). The canonical frame's y-flip is absorbed by the fact that the car's
forward maps to −Y under the up-flip. Parked cars face north (180°). Confirmed
headless: 48 parked at 180°, movers carry travel headings.
