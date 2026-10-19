# OTTO-CLEAN ARM: the in-stall interior clean

Chase, 2026-10-19: an overhead robot arm at each robotic fast-charger stall cleans the cabin while the car charges.
The doors open, the charge arm mates, the cleaning arm reaches into one side and cleans, comes out, moves over the
roof, reaches into the other side and cleans, comes out. The doors close. The charge finishes and the charge arm lets
go, and the car goes to the next step OTTO-Q gave it. "Just a few minutes ... several minutes on each side", against a
15-30 minute fast charge. It must repeat for every car without a part clipping a car, a door or the charge arm.

This file is the design. The numbers live in code (`src/lib/ottoCleanArm/cleanArmSpec.ts`,
`src/lib/ottoChargeArm/vehicleEnvelope.ts`), and the tests measure them.

## What the twin owns and what the renderer draws

The swap test holds. The engine (otto-q-core 0758, dial `stall_cabin_robot`) says that a car's `interior_tidy` step is
done by the stall's cleaning arm (`performed_by = 'stall_cabin_robot'`), and when it started and ends (sim time). It
holds the car on the stall until that step is done. The renderer draws the cycle inside that window, exactly as the
OTTO-CHARGE ARM draws its mate inside the charge: the doors, the swings and the strokes are choreography of one step
whose start and end the twin owns. A real depot reports the same step from the robot controller.

## The car: one door a side, hinged at the front

- Aperture (both flanks): along -0.25..+0.85 m from the car's centre, sill 0.42 m, top 1.32 m (the glass line's top).
- Door: front-hinged, swings out 68 degrees. Open, its rear edge stands about 1.0 m off the flank, 0.44 m ahead of
  the car's centre. A door that slides cannot fit this 4.69 m pod: a 1.1 m door slid forward or back either covers
  the charge port or stands above the sloping nose.
- Cabin: a 2.2 m x 0.8 m void behind the apertures with two benches facing each other (carriage seating, as on a
  purpose-built robotaxi). The side panels between the aperture and the wheel arches keep their windows.
- Charge ports move to the rear quarter (along <= -0.50 m) for every family, so no inlet sits on a door. Real inlets
  are on a fender, never a door. The arm's service window (along +-1.00 m) is unchanged and fully measured, so every
  new port is still inside the measured region.
- The doors are powered: the car opens and closes them on OTTO-Q's command. ASSUMPTION. Purpose-built robotaxis open
  their own doors (Zoox: core77, 2020-12-14, https://www.core77.com/posts/138537/Amazons-Zoox-the-Worlds-First-Purpose-Designed-Robotaxi-Launches).
  Waymo's current fleet cannot close its own doors and pays people to do it, and its next vehicles close their own
  (Fortune, 2026-02-25, https://fortune.com/2026/02/25/waymo-vehicles-doordash-gig-workers-close-doors/). Where a car
  has no powered doors, a technician opens them on arrival: the twin does not model that as a step.

## The arm: an overhead SCARA with a telescoping mast

Hung from the canopy above the car's roof, so it reaches both flanks and never stands where a car drives.

- A header beam under two purlins, a drop column to 3.6 m, then:
- J1 shoulder yaw, link 1 (0.95 m), J2 elbow yaw, link 2 (0.80 m): a ceiling SCARA in a plane at 3.4 m.
- J3 mast yaw and a three-stage telescoping mast: foot at 2.45 m retracted, down to 0.80 m.
- J4 wrist pitch and a two-stage wand, 0.45-1.20 m, with a vacuum and air nozzle and a lit ring.
- A hose loop from the column to the nozzle.

Overhead cleaners on a gantry beside or over a parking spot, and two units per car to halve the time, are described in
US 12,686,365, "Automated fleet-connected cleaning and inspection system"
(https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/12686365, read through search results 2026-10-19).
Tesla's Austin hub robot switches tools to vacuum, pick up trash and wipe (Not a Tesla App, 2026-07-12,
https://www.notateslaapp.com/news/4424/tesla-robotaxi-hubs-start-adding-car-cleaning-robots).

### The cycle

| phase | what moves | seconds (sim) |
|---|---|---|
| doors_open | both doors swing open | 4 |
| swing_a | SCARA to side A, mast up | 5 |
| descend_a | mast down to the aperture | 5 |
| enter_a | wand in through the aperture | 3 |
| clean_a | strokes: floor, both benches, seat backs, a blow-out pass | the rest, halved |
| exit_a | wand out | 3 |
| ascend_a | mast up | 4 |
| swing_b | SCARA over the roof to side B | 6 |
| descend_b, enter_b, clean_b, exit_b, ascend_b | as side A | |
| home | SCARA back over the roof | 5 |
| doors_close | both doors close | 4 |

Side A is the far flank (no charge arm on it), side B the charge-port flank. On the port flank every stroke works
forward of the inlet, and the clearance test holds the arm clear of the charge arm through its whole duty cycle.

The clean phases stretch so the arm is home and the doors are shut when the twin's step ends, inside bounds: the arm
has a top speed, and a step that ends early makes it come out and go home at once (never through the car).

### Timing

The engine's default cycle is 2.5 min a side plus 0.8 min of motion: 5.8 min. ASSUMPTION, pending R-21 (no public
source gives a measured cycle time). Bracket: a robot arm could clean a Cybercab cabin between rides "in under two
minutes" (Teslarati's framing, not a Tesla figure: https://www.teslarati.com/tesla-cleaning-robot-cybercab-robotaxi-service/);
Aseon quotes about 30 minutes for a whole servicing cycle with cleaning, the charge connection and an inspection
(Robotics & Automation News, 2026-10-02,
https://roboticsandautomationnews.com/2026/10/02/aseon-ceo-the-opportunity-is-to-make-vehicle-servicing-as-autonomous-as-driving/105477/).
Both read through search results on 2026-10-19.

## Clearance, measured, not assumed

`src/lib/ottoCleanArm/cleanArmClearance.test.ts` samples the whole cycle on both stall columns and both flanks:

- every link outside the car is >= 0.10 m from the car solid and the open doors;
- the wand crosses the flank inside the aperture with >= 0.03 m on every side of its section;
- inside the cabin the wand and nozzle stay in the free volume (the nozzle may skim a surface it cleans, never enter it);
- the arm is >= 0.15 m from the OTTO-CHARGE ARM at every pose of its mate, hold and release, over the port matrix;
- the stowed arm is clear of every car in the stall's drive-in and back-out sweep (it is above them).

## Twenty posts

The research wing recommended twenty robotic fast chargers in total (ten new), staged (otto-q-core db/checks/0451 §10
point 2). A pedestal 5.9 plan units off its car's centreline does not fit at the L2 rows' 8.4u pitch: it stands inside
the next car. So canopy B is re-striped like canopy A, two columns of five at the 14u pitch: ten new fast chargers in
place of canopy B's fifteen L2 spaces, 20 DCFC and 15 L2 in all. At this arm design the site holds at most thirty
(ten a canopy). The renderer draws whichever layout the twin publishes, and each fast-charger stall gets both arms.
