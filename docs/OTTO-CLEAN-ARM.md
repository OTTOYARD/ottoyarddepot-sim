# OTTO-CLEAN ARM: the in-stall interior clean

Chase, 2026-10-19: an overhead robot arm at each robotic fast-charger stall cleans the cabin while the car charges.
The doors open, the charge arm mates, the cleaning arm reaches into one side and cleans, comes out, moves over the
roof, reaches into the other side and cleans, comes out. The doors close. The charge finishes and the charge arm lets
go, and the car goes to the next step OTTO-Q gave it. "Just a few minutes ... several minutes on each side", against a
15-30 minute fast charge. It must repeat for every car without a part clipping a car, a door or the charge arm.

This file is the design. The numbers live in code (`src/lib/ottoCleanArm/cleanArmSpec.ts`,
`src/lib/ottoChargeArm/vehicleEnvelope.ts`), and the tests measure them.

## What the twin owns and what the renderer draws

The swap test holds. The engine (otto-q-core 0758, dial `stall_cabin_robot`, applied 2026-10-19, off by default) says
that a car's `interior_tidy` step is done by its fast-charger stall's cleaning arm (`performed_by =
'stall_cabin_robot'`), on which stall (`robot_stall_id`), and when it started and ends (`started_at`, `ends_at`, sim
time). The snapshot publishes those on every visit atom and the depot cards publish the times on every need. The engine
holds the car on its stall until the step is done. The renderer draws the cycle inside that window, as the OTTO-CHARGE
ARM draws its mate inside the charge: the doors, the swings and the strokes are the choreography of one step whose
start and end the twin owns. A real depot reports the same step from the robot controller.

## The car: one door a side, hinged at the front

Numbers from `src/lib/ottoChargeArm/vehicleEnvelope.ts`:

- Aperture (both flanks): along -0.30..+0.85 m from the car's centre, sill 0.42 m, top 1.32 m (the top of the glass).
- Door: hinged at the front edge, 0.025 m outboard of the flank, and opens 78 degrees, nearly square to the flank,
  which leaves the arm room to work behind it. A door that slides cannot fit this 4.69 m pod: a 1.1 m door slid
  forward or back either covers the charge port or stands over the sloping nose.
- Cabin: the hole through the body runs -1.05..+1.05 m, with two benches facing each other (carriage seating, as on a
  purpose-built robotaxi). The side panels between the aperture and the wheel arches keep their windows.
- Charge ports move to the rear quarter (along -0.90..-0.55 m for an unknown make, and the same band for every family),
  so no inlet is on a door. Real inlets are on a fender, never on a door.
- The doors are powered: the car opens and closes them on OTTO-Q's command. ASSUMPTION. Purpose-built robotaxis open
  their own doors (Zoox: Core77, https://www.core77.com/posts/138537/Amazons-Zoox-the-Worlds-First-Purpose-Designed-Robotaxi-Launches).
  Waymo's current fleet cannot close its own doors and pays people to do it, and its next vehicles close their own
  (Fortune, 2026-02-25, https://fortune.com/2026/02/25/waymo-vehicles-doordash-gig-workers-close-doors/). Where a car
  has no powered doors, a technician opens them on arrival: the twin does not model that as a step.

## The arm: an overhead SCARA with a telescoping mast

Hung from the canopy above the car's roof, so it reaches both flanks and never stands where a car drives. Numbers from
`src/lib/ottoCleanArm/cleanArmSpec.ts`:

- A header beam under the two canopy purlins either side of the arm (4.6 and 8.0 plan units out from the canopy's
  spine) and a drop column from the header to the arm's base drum.
- J1 shoulder yaw at 3.42 m, link 1 (0.95 m), J2 elbow yaw, link 2 (0.80 m) 0.19 m under link 1 so the arm folds: a
  ceiling SCARA far above every car and the OTTO-CHARGE ARM.
- J3 mast yaw and a three-stage telescoping mast: foot at 2.28 m retracted, down to 0.68 m.
- J4 wrist pitch and a three-stage wand: 0.45 m, plus up to 0.92 m of extension, and J5, the nozzle (0.16 m: vacuum,
  air knife and a lit ring).
- A hose from the mast's carriage to the wrist, outboard of the mast, away from the door the wand goes through.

Overhead cleaners on a gantry over a parking spot, and two units on one car to halve the time, are in US 12,686,365
(https://patents.google.com/patent/US12686365B2/en, read 2026-10-19), which also has the dispatch system command the car
to open its doors. Tesla's Austin hub robot switches tools to vacuum, pick up trash and wipe (Not a Tesla App,
2026-07-12, https://www.notateslaapp.com/news/4424/tesla-robotaxi-hubs-start-adding-car-cleaning-robots).

### The cycle

Fixed moves, sim seconds at nominal speed (`CLEAN_PHASE_S`, 52 s in all):

| phase | what moves | s |
|---|---|---|
| doors_open | both doors open | 3 |
| swing_a | the SCARA swings from over the roof to side A | 4 |
| lower_a | the wrist turns the wand down | 1.5 |
| descend_a | the mast lowers beside the car to the aperture | 3.5 |
| enter_a | the wand turns in through the middle of the aperture, then reaches in | 3.5 |
| clean_a | strokes: floor, both benches, seat backs, a blow-out pass | the twin's time, shared |
| exit_a, ascend_a, raise_a | out the way it went in, mast up, wand up | 3.5, 3, 1.5 |
| swing_b | over the roof to side B | 5 |
| lower_b .. raise_b | as side A | as side A |
| return | back over the roof | 4 |
| doors_close | both doors close | 3 |

Side A is the car's far flank (no charge arm on it); side B is the charge-port flank. The clean phases take the rest of
the twin's window, set as each begins: (time left, less the fixed moves still to come) shared between the cleans still
to come, bounded 20-600 s a side. If the arm is behind, the fixed moves speed up to 2x. When the step ends early, the arm
comes out the way it went in and goes home at 3x from wherever it is: never across the car.

### Timing

The engine's default cycle is 2.5 min a side plus 0.8 min of motion: 5.8 min. ASSUMPTION, pending R-21 (no public
source gives a measured cycle time). Bracket: a robot arm could clean a Cybercab cabin between rides "in under two
minutes" (Teslarati's framing, not a Tesla figure: https://www.teslarati.com/tesla-cleaning-robot-cybercab-robotaxi-service/);
Aseon quotes about 30 minutes for a whole servicing cycle with cleaning, the charge connection and an inspection
(Robotics & Automation News, 2026-10-02,
https://roboticsandautomationnews.com/2026/10/02/aseon-ceo-the-opportunity-is-to-make-vehicle-servicing-as-autonomous-as-driving/105477/).
Both read on 2026-10-19.

## In the depot

- **One evaluation.** The motion driver steps one cleaning session per fast-charger stall on the sim clock
  (`src/engine/motion/cleanGate.ts`). `CleanArm.tsx` draws that session, the car's doors are written from it
  (`doorStore`), and the car's right to move is read from it, so the arm, the doors and the hold cannot disagree.
- **When it starts.** The twin has the car's interior tidy in progress by this stall's arm, the twin still places the
  car on this stall, and the car stands on its stall pose to 0.04 plan units (1.9 cm) and 0.01 rad. A car anywhere
  else is not reached into.
- **Chase's order, both ways.** The doors open as the charge arm reaches for the port; the cleaning arm waits at home
  with the doors open until the connector is latched (or no charge arm is working). No charge-arm mate starts while the
  cleaning arm is out over the car. A latched connector stays in until the cleaning arm is home and the doors are shut,
  whatever the charge or the tether says, so the charge arm lets go last. One composition (`armSessionInput`) feeds
  both evaluations of the charge arm.
- **The hold.** Open-ended while the twin's step is on (it ends on the twin's state, like a charge); once the step is
  over, the arm is home in about 5 s, and the hold is bounded at 30 s so a wedged signal cannot freeze a car.
- **Measured** through the driver (`TwinMotionDriver.cleanarm.test.ts`, 0.25 s polls, a 5.8-minute step): the doors
  were fully open at 3 s, the connector latched at 19 s, the arm left home at 19 s and was home with the doors shut at
  347.75 s of the twin's 348. With the charge done at 60 s, the connector stayed in until the arm was home (348 s) and
  the car first moved at 360.25 s, after the charge arm's release.
- **The canopy carries it.** A header beam under the two purlins and a drop column, drawn with the canopy; a canopy LED
  fixture the header would cut is not hung (`cleanArmPlacement.ts`, tested against every stall and every rafter).
- **Instanced.** One clone is 38 meshes, 27 casting shadows; every cleaning arm on the site is 28 instanced parts, 17
  casting, at ten arms or twenty (`cleanArmInstances.ts`).
- **The Q card** shows an "Interior clean" row under "Now": Starting (an empty box), In progress (a dot, a meter to the
  twin's end time and what the arm does: "The doors open.", "The arm cleans the left side.", "The arm moves out of the
  car.", "The arm moves back to its start position."), Done (a tick and the time). The Services chip says "by the
  stall's cleaning arm". Tapped in the cockpit through a whole cycle (`docs/pr-shots/clean-arm/09`-`11`,
  `card-playback-summary.json`): Starting until the wand is in, In progress until the arm is home, then Done, with the
  car still held for its charge. A card that fails to draw shows one line and Close in its place; it never takes the
  depot view with it.

## Clearance, measured, not assumed

`src/lib/ottoCleanArm/cleanArmClearance.test.ts` samples the whole cycle on both stall columns and both flanks:

- every part outside the car is >= 0.10 m from the car solid and from the open doors;
- the wand crosses the flank inside the aperture with >= 0.03 m on every side of its section;
- inside the cabin the wand and nozzle stay in the free volume and >= 0.01 m off the seats (the nozzle may skim a
  surface it cleans, never enter it);
- the arm is >= 0.10 m from the OTTO-CHARGE ARM at every pose of its mate, hold and release, over the port matrix, and
  the open doors are >= 0.10 m from the charge arm;
- the stowed arm is above 2.0 m, clear of every car in the stall's drive-in and back-out sweep;
- two arms' reach envelopes fit between neighbouring fast-charger stalls.

## How to look at it

- `clean-check.html` (dev server): the arm alone over one car, every phase, any time (`?t=`, `?view=`, `?toward=`).
- `node scripts/cleanArmShots.mjs --url <dev server>`: a recorded run in the real cockpit, read-only, with the twin's
  cabin-clean step added to every fast-charging car; one frame per phase from three cameras.
- `... --card`: taps the first car an arm starts on, and shoots its Q card at each phase until the arm is home.

## Twenty posts

The research wing recommended twenty robotic fast chargers in total (ten new), staged (otto-q-core db/checks/0451 §10
point 2). A pedestal 5.9 plan units off its car's centreline does not fit at the L2 rows' 8.4u pitch: it stands inside
the next car. So canopy B is re-striped like canopy A, two columns of five at the 14u pitch: ten new fast chargers in
place of canopy B's fifteen L2 spaces, 20 DCFC and 15 L2 in all. At this arm design the site holds at most thirty
(ten a canopy).

- The database change is otto-q-core 0759, prepared and not applied: it changes the world every queued research cell
  reads, so applying it is Chase's call, and not while an arm runs against the depot as built.
- The renderer is ready for it and changes nothing until then (`src/lib/chargerBuild.ts`). It never chooses a build:
  it reads the twin layout's census (10 + 30 as built, 20 + 15 after 0759) and redraws the depot, stall for stall
  where the twin stands them, with both arms on every fast charger. As built is byte-for-byte as before.
- `TwinMotionDriver.dcfc20.test.ts` docks ten cars on canopy B's new chargers in two waves, the second driving in past
  the first, touching no car and no structure. `chargerBuild.test.ts` holds the new layout to every rule the as-built
  one is held to.
- `node scripts/cleanArmShots.mjs --build dcfc20` shows it in the cockpit before 0759 exists.
- The OTTO-Q stack draws the same build: 20 fast-charger sockets in four columns of five, the L2 zone east of them
  (`stackModel.syncStackSite`; `docs/pr-shots/clean-arm/12`-`13`). As built, its zones are exactly as before.
