# OTTO-WASH works to each vehicle

Chase, 2026-11-13: *"Make sure you train all robotics individually for each vehicle type as well. That includes
sensor cleaning at the detail line ... Our system knows which car is pulling into which stall so that should
activate different training sets for our robotics ... Make sure all clearance and individual robotics match per
vehicle."*

Until this change OTTO-WASH (the gantry and the two detail arms, `docs/OTTO-WASH.md`) worked to one generic car:
12 hand-written pad places a side, and one car shape for the air knives. Now the bay plays a **program** for the
vehicle in it. All numbers below were measured on 2026-11-13 by the tests named in "Proof". The machine's hardware
is not changed.

## How the bay knows the vehicle

| Step | Where |
|---|---|
| The twin's row names the car's model (`port.profile`, else make and model). The same answer draws the car. | `fleetModels/assign.ts`, `fleetModels/vehicleModel.ts` |
| The motion driver gives the model to the bay's gate with the car. | `TwinMotionDriver.ts`, `engine/motion/washGate.ts` |
| The session takes the model when the program starts and holds it to the end. | `ottoWash/washSession.ts` (`model`) |
| The pose is that model's program. The 3D bay, the 2D plan and the Robotics tab all draw `washPoseAt(session)`. | `ottoWash/washPose.ts`, `ottoWash/washProgram.ts` |

A car whose row names none of the six models gets the **generic program**. It is the machine as it was, and a
test pins its poses to the code before this change (`washProgram.test.ts`).

## What a program is

1. **The vehicle's solid** (`fleetModels/washSolid.ts`). The body's own skin, every sensor and housing the model
   draws, the mirrors and the tyres. The charge arm's solid is a box that contains the car. The wash arms must
   touch a sensor, so they need the shape itself. Measured against the model's surface: within 3.1 mm
   (`SOLID_RESOLUTION_M` is 4 mm).
2. **The sensor map** (`fleetModels/sensorMap.ts`). For each lidar, camera, radar and thermal camera: the centre
   of the face a pad polishes, the direction it looks, its zone (front, sides, roof, rear) and its arm (east or
   west). A lidar that turns has 3 faces a side. A window wider than 144 mm has 2. A camera behind glass or inside
   its housing is cleaned on the cover in front of it.
3. **The detail arms' places and paths, by rule** (`ottoWash/fleetWash.ts`). For each face the rule finds how the
   pad meets it and where the carriage stands, and checks the way there and the way home. A place the machine
   cannot do is left out with the reason and the number. Nothing is adjusted to keep it.
4. **The gantry's passes** (`ottoWash/carShape.ts`, `fleetShape`). The top air knife follows the vehicle's own top,
   roof sensors counted. The side knives stand 0.26 m from the widest thing near them (mirrors and side pods
   counted). The travel is the same for all vehicles: it passes the nose and the tail of the longest (5.03 m).
5. **The time.** Each move is as long as its joints need at 80% of their top speed. The arms' whole time is 146 s
   to 161 s, against 145 s for the generic car. The passes give up the difference. The twin's seat does not change.

## The margins

They are the generic car's own, read from its tests. None is weaker for a fleet vehicle.

| What | Margin | Held by |
|---|---|---|
| Pad on a place | centre within 1 mm, square to the rule's direction (cos > 0.9999) | `fleetWash.test.ts` |
| A sensor at a place | under the pad (centre within 60 mm less the face), inside the 15 mm the foam gives | `fleetWash.test.ts` |
| Pad's face in the vehicle | 15 mm or less (CAD: every vertex of the pad) | `washFleetClearance.test.ts` |
| Head behind the pad, camera | 45 mm | `washFleetClearance.test.ts` |
| Arm links and joints (CAD) | 80 mm | `washFleetClearance.test.ts` |
| Arm links (lines with a radius) | 100 mm | `fleetWash.test.ts`, `washProgram.test.ts` |
| Air knives, carriages (CAD) | 100 mm; knives 0.3 u in plan units | both |
| Gantry frame | 1.0 u (0.479 m) | both |
| The two pads, the two wrists | 0.28 m, 0.45 m | `fleetWash.test.ts` |
| Stowed gantry to an arm | 0.5 m | `fleetWash.test.ts`, `washProgram.test.ts` |
| Elbow fold, wrist bend, forearm roll | 2.30 rad, under 1.66 rad, under 2.70 rad near the vehicle | `fleetWash.test.ts` |
| Joint and carriage speed | 120, 120, 150, 210, 210, 210 deg/s; 1.5 m/s | `fleetWash.test.ts` |

## Each vehicle

"Sensors" are the spec's sensors to clean. "Places" are pad stops (both arms). Clearances are the least measured
through the whole program and early ends. CAD figures are from the drawn machine's vertices.

| Vehicle | Sensors | Cleaned | Places | Pad in (CAD) | Head (CAD) | Arm (CAD) | Frame (CAD) | Links | Pads apart | Arms' time |
|---|---|---|---|---|---|---|---|---|---|---|
| Waymo Ojai | 23 | 23 (1 in part) | 24 | 12.7 mm | 45.5 mm | 88 mm | 0.482 m | 105 mm | 0.66 m | 148 s |
| Waymo I-PACE | 21 | 12 | 17 | 14.1 mm | 45.9 mm | 95 mm | 0.665 m | 169 mm | 0.56 m | 146 s |
| Zoox robotaxi | 28 | 24 | 28 | 7.5 mm | 45.2 mm | 115 mm | 0.693 m | 287 mm | 1.88 m | 161 s |
| Tesla Cybercab | 8 | 8 | 8 | 12.2 mm | 47.4 mm | 121 mm | 0.728 m | 289 mm | 0.98 m | 146 s |
| Tesla Model Y | 8 | 6 | 6 | 11.3 mm | 48.7 mm | 123 mm | 0.678 m | 282 mm | 1.66 m | 146 s |
| Lucid Gravity | 21 | 20 | 24 | 10.3 mm | 48.7 mm | 99 mm | 0.623 m | 193 mm | 0.56 m | 146 s |

The pad is turned off a sensor's face by 41 degrees at most (small camera lenses, 16 to 22 mm in radius). A radar
or a lidar window is met within 14.5 degrees.

### What each program does

- **Waymo Ojai.** Front: the front radar, the nose camera, the two corner radars. Sides: each wing pod's lidar and
  camera. Roof: the 7 cameras of the roof bar and the roof lidar's two rear faces. The arms take the roof one after
  the other. Rear: the corner radars, the corner-pod cameras, the rear radar, the rear lidar and the rear camera.
- **Waymo I-PACE.** Front: the front lidar and the corner radars. Sides: each wing pod's lidar and camera. Roof:
  the front roof radar and all 6 faces of the roof lidar, one arm after the other. Rear: the corner radars and the
  rear lidar.
- **Zoox robotaxi.** Each arm does the two corner pods on its side: 7 places a pod (3 round the top lidar, the 3
  cameras with the thermal camera, the radar). No place is over the roof.
- **Tesla Cybercab.** The bumper camera, each wing and pillar camera, the two windscreen cameras (on the glass,
  one arm after the other) and the rear camera.
- **Tesla Model Y.** The bumper camera, each wing and pillar camera, and the rear camera.
- **Lucid Gravity.** Front: the nose lidar (2 places), the front radar and the corner radars; the arms take the
  nose one after the other. Sides: the wing cameras. Roof: the halo's front and side lidars (2 places each) and 8
  cameras. Rear: the corner radars and the rear camera.

### What is not reached, and what would change it

The last column is an estimate from the measured shortfall. No changed machine was built or measured.


| Vehicle | Not cleaned | Why (measured) | What would be needed |
|---|---|---|---|
| Waymo Ojai | Roof lidar: its front and side faces (4 of 6). The 2 rear faces are done. | Front faces: a wrist housing would have 3 mm of room over its margin, and the rule plans to 8 mm. Side faces: 37 mm inside the margin (the roof bar under the lidar). Also, a lidar that turns is met 30 mm under its window's top edge (`SPIN_TOP_M`), so on this 0.2 m lidar the pad's 120 mm face does not cover the bottom of the 124 mm window. | Not measured. An estimate: a smaller head, or a wrist with its actuator not beside the tool. |
| Waymo I-PACE | The 8 cameras in the roof dome | The plate behind the pad comes 42 to 45 mm from the roof tray under the dome. It must keep 45 mm. | Not measured. An estimate: a pad of about 45 mm radius. |
| Waymo I-PACE | Rear roof radar | The pad's face would go 19 mm into the roof beside it. Its foam gives 15 mm. | Not measured. An estimate: a pad of about 45 mm radius. |
| Zoox robotaxi | The 4 lower corner lidars | Each is drawn under its pod's overhang. The pad's face would go 19 mm into the pod. | Not measured. An estimate: a pad of about 35 mm radius. |
| Tesla Model Y | The 2 windscreen cameras | The forearm would roll 2.70 rad at the glass. The limit near a vehicle is 2.70 rad and the rule plans to 2.60. | Not established. The Cybercab's two, lower on a lower roof, are reached. |
| Lucid Gravity | Rear halo lidar | The plate behind the pad would come 12 mm from the roof behind the halo. | Not measured. An estimate: a much smaller head. |

The side air knives are 1.17 m tall (0.26 m to 1.44 m above grade). They do not blow on a body above 1.44 m (the
upper sides of the Zoox, the Ojai and the Gravity). The top knife follows the roof.

## Assumptions

- Sensor positions are each spec's (`fleetModels/specs`). Several are illustrative, not published
  (`docs/FLEET-MODELS.md`). A real fleet gives each model's sensor map, and the wrist camera corrects each point.
- The vehicle stands on the bay's centre, facing north, as every car in a wash bay does.
- The wrist's housings, bracket and camera are modelled in the rule from the CAD's measured sizes (`WRIST_CAD`).
  The CAD test is the final check.
- A turn's fixed parts are 0.55 s to touch, 2.8 s to polish and 0.55 s to lift (the generic program's shortest).
- Joint top speeds are those of a 1.75 m collaborative arm (source in `detailArm.test.ts`), and a move is planned
  to 80% of them.
- The first program for a model is made when its first car is seated: 0.2 s to 1.7 s of work, once a model.

## Proof

| Test | What it measures |
|---|---|
| `src/lib/fleetModels/sensorMap.test.ts` | The solid against the model's surface. Each vehicle's map: count, each face on the vehicle and looking away, zone, arm, label. |
| `src/lib/ottoWash/fleetWash.test.ts` | Each vehicle's arms through their whole work every 0.02 s: reach, limits, speeds, every part off the vehicle, pads on places only, arms apart, gantry clear, each sensor cleaned or left out with its number. |
| `src/lib/ottoWash/washProgram.test.ts` | The generic program pinned. Selection from the gate to the pose. The seat's length. The gantry's frame and knives over each vehicle, early ends, drive-through. |
| `src/lib/robotics/washFleetClearance.test.ts` | The machine's CAD against each vehicle: 1,626 to 1,687 poses a vehicle, every place pressed. |

`WASH_REPORT=1` with the first three prints each vehicle's figures. `cad/spec/poses.json` did not change: the
generic presets are the generic program.
