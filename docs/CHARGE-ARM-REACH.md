# Charge arm: reaching each vehicle's real inlet

Status on 2026-11-12 (evening CT): **measured and solved in code, not yet built into the drawn arm, the CAD or the
yard.** Nothing a viewer sees has changed. This page says what was measured, what the arm needs, and what is left.

## What was so

The arm is a pedestal fixed beside the middle of the car. The yard drew every car's inlet on whichever flank its
charger stood on, inside the arm's reach (`chargePort.ts`). Real inlets are elsewhere (`docs/FLEET-MODELS.md`):

| Vehicle | Inlet | From the middle of the car | Height | Connector |
|---|---|---|---|---|
| Jaguar I-PACE | left front wing | 1.20 m toward the nose | 0.90 m | CCS1 |
| Tesla Model Y | left rear | 2.17 m toward the tail | 1.00 m | NACS |
| Lucid Gravity | left rear quarter | 2.04 m toward the tail | 1.02 m | NACS |
| Waymo Ojai | left rear quarter (assumed) | 1.86 m toward the tail | 0.95 m | CCS1 (assumed) |
| Zoox | one side, near a corner (assumed) | 1.19 m from the middle | 0.78 m | CCS1 (assumed) |
| Tesla Cybercab | rear bumper, centre, facing back | 2.22 m toward the tail | 0.62 m (assumed) | NACS |

The Cybercab's inlet: a NACS port behind a drop-down door in the rear bumper, DC only, plugged in by hand today;
inductive pads are planned and not in service. Reported by TeslAnt (2026-09), CyberCab.News (2026-10-12) and Tesla North
(2026-10-27), as relayed by Chase on 2026-11-12:
https://teslant.com/en/news/tesla-cybercab-no-onboard-charger-dc-only-2026-09 ,
https://www.cybercab.news/article/austin-robotaxi-supercharger-one-worker-oct12 ,
https://teslanorth.com/2026/10/27/moravy-optimus-cybercab-charging/ . I did not open these pages.

## What was measured

With the arm as built (reach 3.125 m, `mateSolver.test.ts`):

- The arm's safe window is 1.00 m either side of its base. **No vehicle in the fleet has its inlet inside it.**
- The Cybercab's rear inlet has **no solution from any base position**: it is on the centreline, half a car's width
  further in than any flank, and is entered from behind.
- 2 connectors cover all 6 vehicles: CCS1 and NACS.

## What the arm needs

| Addition | Size | Why |
|---|---|---|
| A floor rail under the base, along the car | 1.3 m toward the nose, 2.5 m toward the tail, from the stall's middle | Every side inlet is then met square-on, dead abeam the base, in the middle of the measured window. The fleet needs 1.20 m and 2.40 m. |
| A telescoping forearm | 0.75 m of travel; the Cybercab mate uses 0.40 m | Only for a rear inlet. The forearm keeps 0.49 m from the car's corner in plan on that mate. |
| A two-connector head | CCS1 and NACS, 120 degrees apart, third pocket empty | The head turns the connector the car takes to the front. |

`solveMate()` returns, for a vehicle and a stall side: where the base stands on the rail, how far the forearm
extends, which connector faces forward, and the joint angles. It refuses a car whose inlet is on the flank away from
the arm.

## Which posts can charge which cars

A west-column post's arm stands on the car's right; an east-column post's on its left (`depotPlacement.portFlank`).
The twin depot has 15 of each (read 2026-11-13).

| Car | Posts that fit |
|---|---|
| I-PACE, Model Y, Gravity, Ojai (inlet on the left) | the 15 left-arm posts |
| Zoox (drives either way, so presents either flank) | all 30 |
| Cybercab (rear inlet) | all 30 |

At the twin depot that is **78 of 116 cars on 15 posts**, and 38 cars that fit all 30. otto-q-core migration 0824
(written, not applied) makes OTTO-Q seat by this rule behind a setting, and has a both-sides car take a right-arm post
when one is free. Two ways to get the other 15 posts back for left-port cars, neither built:

1. A left-port car backs into a right-arm post. Its left flank then faces the arm. The yard's cars drive in nose
   first today, by the founder's layout, so this is a layout and motion decision.
2. Build posts with the arm on the side the fleet needs.

## What is not proved, and what is left

- **Clearance to each vehicle's own body is not measured.** The safe window was measured against the yard's one car
  at a 1.866 m flank standoff. The six vehicles put the base 1.82 to 1.95 m from their flanks. The per-vehicle sweep
  (arm, elbow and forearm against each body, doors open and shut) is the next step.
- **The rail is not in the stall yet.** It has to clear the cabinet, the canopy columns, the neighbour's back-out and
  the cleaning arm. `structurePlan.ts` and the clearance replays decide that.
- The drawn arm, the engineering CAD (`cad/`, rail, telescope, head) and its clash check are unchanged.
- The cleaning arm and the wash machine still work to the one car's shape and doors.
- The yard still draws one car. The six models need a light version and a per-vehicle body envelope first.
