# Cameras and sensors at the depot: the design

**Status:** design, 2026-11-19. It replaces the recommendation note of 2026-11-18. **Built the same day:** the
OTTO-CLEAN ARM's cabin vision pod, in the CAD with its cables (section 2, `docs/OTTO-ROBOTICS-CAD.md` finding 26).
Measuring where it could go moved it from the wrist fork to the wand, and found two things this note first got wrong:
the stall's scanner cannot see the car's far side, and laser scanners are the wrong guard in a wet wash bay (section 2).
**Decided by Chase, 2026-11-22:** *"Definitely do not want doors to close in a wash bay. Everything else is fine. I dont
really want too much lidar or radar. Moreso just vision and bluetooth etc. if radar or something like that is absolutley
necessary, then that's fine. But ideally, its just visions and confirmation of clean or connection and then
completions."* Section 1a states what follows from it.
**Asked by Chase, 2026-11-19:**
*"the ultimate goal is to have actual cameras attached to the robotic arms in a real depot with real autonomous
vehicles ... I don't want to build something cheap or not detailed enough that just looks like a cheap visual rendering
of a final product ... each visual part and electrical or sub component detail that we could theoretically begin
sourcing in building from day one. So I think that over and come up with what you think makes the most sense as far as
integrating the camera visual sensor on the head of robotic arms, and then overall in areas like the wash & service
bays, etc."*

External facts carry a source and the date they were read (otto-q-core CLAUDE.md rule 3). Where sources disagree, both
are given and the part is marked to be confirmed against the supplier's datasheet before it is bought.

## 1. The rule this design is built on

**A camera finds and proves. It never guards.** Every machine at the depot needs three things from its sensors, and they
are not the same kind of sensor:

| Job | What it answers | What does it | Certified? |
|---|---|---|---|
| **Guard** | Is a person or an animal where the machine is about to move? | Safety laser scanners, light curtains, emergency stops, wired to a safety relay | Yes: IEC 61496 type 3, ISO 13849 PL d |
| **Find** | Where exactly is the work: the inlet, the seat, the sensor cover, the wheel nut? | Cameras, depth sensors, force sensors | No |
| **Prove** | Is the work done, and can an owner see it? | The same cameras, after the work | No |

Why the split is not a preference: the safety function of a machine is certified as a whole (ISO 13849), and an AI
vision model is not a certifiable safety device. The one certified 3D safety camera found for this design, a 3D
time-of-flight sensor, is rated PL c ([SICK press release, 2022-11](https://www.sick.com/se/sv/safevisionary2-3d-tof-camera-pushing-forward-into-the-third-dimension-of-safety-technology/w/press-2022-sps-safevisionary),
read 2026-11-19), one level below the PL d the depot's laser scanners carry. So the depot's guards are laser scanners
(275 degrees, PL d, [distributor copy of the supplier datasheet](https://www.generationrobots.com/media/sick/datasheet-sick-microscan3-core-safety-laser%20scanners-de.pdf);
the protective field is 4.0 or 5.5 m by variant, [supplier datasheet MICS3-AAAZ40AZ1P01](https://www.sick.com/media/pdf/5/45/945/dataSheet_MICS3-AAAZ40AZ1P01_1075842_en.pdf),
both read 2026-11-19; confirm the variant before purchase), and the cameras do everything else.

**Where water and dirt are, the guard is a radar, not a scanner.** Laser scanners and light curtains are optical, and
spray, mist and soap film can make them stop a machine for nothing. A safety radar is made for that: one 60 GHz family
is rated PL d / SIL 2, category 3, with a 5 m or 9 m range and a beam of 10 to 100 degrees by 20
([Leuze, LBK SBV](https://www.leuze.com/en-dk/products/safety/safety-products/safety-radar-system), read 2026-11-19), and
its maker calls it *"insensitive to dust, dirt, debris, smoke and even moderate amounts of water"*
([distributor page](https://tipteh.com/machine-safety/optoelectronic-machine-safety-equipment/inxpect-safety-radar-system/),
same date). Both are vendor statements. A radar sees about 300 mm, coarser than a scanner, and is not sure to see a hand
([Leuze comparison, via a distributor](https://www.breemes.be/breemes/en/EUR/content/resources/news/LeuzeRadarofOptisch),
same date). No source found covers high-pressure spray, so that needs the maker's approval in writing.

## 1a. Vision first: the few sensors that are not cameras, and why each stays (Chase, 2026-11-22)

Cameras do the work at this depot: they find, they confirm the connection or the clean, and they record the completion.
A sensor that is not a camera stays only where a camera cannot do the job. That leaves 4 kinds, and no others are added:

| Sensor | Where | Count at the 30-post depot | Why a camera cannot do it |
|---|---|---|---|
| Safety laser scanner | each charger's riser (in the CAD today), and the open end of each charger row | 30 today, 6 to add | It stops the arms when a person steps in. That function must be certified (PL d), and no camera found is. |
| Safety radar | each wash bay mouth, since the doors stay open | 6 to add | The same function, in spray, where a camera or a laser gives false stops. It needs the maker's approval for spray. |
| Cabin presence radar | inside each clean arm's vision pod (built) | 30, one small board each | A child or a pet under a blanket. A camera sees the blanket. |
| Safety laser scanner | each service bay's tire machine (in the CAD today) | 2 today | As the first row. |

Everything else is a camera, a force sensor the machine already has, or a radio link:

- **Confirmation by vision:** the connector seated (charge arm), each surface clean (clean arm), each sensor cover clean
  (wash arms), each nut in its socket (tire machine). Each is a picture on the operation's record (section 5).
- **Bluetooth for the car and the stall to talk at short range.** A Bluetooth Low Energy link at each stall lets the car
  and the stall confirm, with no cloud between them: this is the car the plan sent here, its charge port is open, its
  doors are open or shut, its cabin reports empty. It is a second path beside the owner's API, never the only one, and
  never a safety function. ASSUMPTION: which fleets expose such a link is not known; R-request to file before it is
  built.
- **No wash bay door closes.** The bays stay open pull-through bays.

## 2. Each machine: what it has, what it gets

Read from `cad/otto_cad/robots/` on 2026-11-19. Part ids are the CAD's.

### OTTO-CHARGE ARM: complete; one wire and one record to add

- **Has.** Find: a sealed vision pod on the tool, 2 global-shutter 2 MP cameras 60 mm apart, a time-of-flight depth
  module (0.1 to 2 m) and an 850 nm light (`CHG-VIS`, `CHG-CAM`, `CHG-TOF`, `CHG-IRB`). Guard: a 275-degree safety
  laser scanner at knee height on the riser (`CHG-SCN`) and an emergency stop (`CHG-EST`). Prove: a 6-axis force and
  torque sensor at the tool (`CHG-FTS`) feels the mate.
- **Add: the stall's guard must cover both sides of the car, and one scanner cannot.** The first version of this note
  wired the riser's scanner to the clean arm too: "one scanner, two machines stopped". That is wrong for half the car.
  The scanner stands on the charger's side, 1.87 m off the car (the arm's standoff, `FLANK_STANDOFF_PU`), and the car's
  body hides its far side from it. The clean arm works the far side first, with its mast 0.20 m off the car. What can
  see the far side is the next stall's scanner: charger stalls stand 5.80 m apart car centre to car centre (14 plan units
  along the column at 60 degrees: 14 x 0.4785 m x sin 60), so between 2 cars there are 3.89 m, and the neighbour's riser
  stands in that gap, 2.02 m from this car's far side. So the guard is per canopy, not per stall:
  - **A safety controller in each canopy's board** reads every riser scanner on that canopy and stops each stall's arms
    from the fields that touch that stall. Each scanner's fields cover the gap it stands in: its own car's charger side
    and the next car's far side. The OSSD pairs run to the board, not stall to stall.
  - **The last stall of each column has no neighbour on its far side.** It gets a scanner of its own there: 6 at the
    30-post build (3 canopies, each with 2 columns of 5 at that pitch, `sitePlan.chargingStalls`).
  - **Approved by Chase, 2026-11-22** ("Everything else is fine"). These 6 scanners are the only laser scanners this
    design adds. The CAD has not drawn them yet.
- **Add: the proof record.** At every latch: the pod's picture of the seated connector, the force trace of the mate and
  the latch confirmation, hashed into the charge's service record. No new hardware.

### OTTO-CLEAN ARM: the biggest gap, now built

It works inside the cabin through an open door, and until 2026-11-19 it had no sensor of any kind. Its own design text
already counted on a camera that was not there: its wand-tip light ring *"lights the cabin for the camera"* (`CLN-NRG`).

- **Where it goes was measured first, and the wrist fork has no room.** Over every pose of the generic cycle and of each
  fleet vehicle's program (6 vehicles, both flanks), the arm keeps 0.10 m off a car at the wrist only within about 90 mm
  of the mast's axis. The wand turns the wrist to every heading, so the limit is about the same all round. The fork
  already reaches 81 mm, so a pod on it could stand out about 30 mm at most.
- **So the pod rides the wand, under its base tube, 72 to 152 mm from the wrist pivot** (`CLN-VPH`, on a saddle bonded
  to the tube, `CLN-VSD`). The wand drive is on the tube's top, so the pod hangs below. It turns with the wand, so it
  looks where the wand points: through the door from the ready point, and at each surface the nozzle cleans. It never
  goes in the car. Measured as built: 0.041 m from the generic car at its closest, against the 0.03 m the wand is held
  to, and 0.217 m from an open door. On the 6 fleet vehicles: 0.169 m or more from the body, 0.116 m or more from a
  door, 0.170 m or more from a sensor (`cadYard.test.ts`, `cleanArmFleet.test.ts`).
- **What is in it.** Each part is in the CAD with its class and its source (`cad/SOURCES.md`):
  - 2 global-shutter cameras, 2.3 MP, 1/2.6 inch, 55 mm apart, with M12 lenses of 2.8 mm (about 92 x 66 degrees),
    behind a coated glass window. They are the charge arm's camera class with a wider lens. The housing is the clean
    arm's own: the charge arm's 110 mm housing does not fit.
  - A time-of-flight depth module, with its own IR light, for depth in the dark. The light ring at the wand's tip
    lights the cabin for the cameras (`CLN-NRG`, whose design text already said so). A first draft also had an 850 nm
    light board over the cameras: it made the pod 21.5 mm deeper, and with the wand level at rest the pod's floor then
    stood 0.085 m over the tallest fleet vehicle's roof equipment (the Ojai's lidar, 2.04 m), under the 0.10 m every part
    keeps. Without it the pod is one row deep and stands 0.106 m over it (`fleetEnvelope.test.ts`).
  - A 60 GHz radar behind a black polycarbonate radome 3.0 mm thick: 2 half wavelengths at 60 GHz, where the wall
    reflects least ([TI SWRA705](https://ti.com/lit/swra705); polycarbonate's permittivity 2.75 from
    [Acconeer](https://docs.acconeer.com/en/latest/integration/radome_and_mechanical_design.html), both read 2026-11-19).
  - A vision board with a 7 TOPS class processor, its heat carried into the housing's back wall by a thermal pad, and
    an EtherCAT and power board. 2 M8 connectors and a pressure vent on the back.
- **The radar is what sees a person under a blanket.** A camera cannot see a child or a pet under a blanket or behind a
  seat. A 60 GHz in-cabin radar sees breathing and small motion through soft material; this is the automotive
  child-presence sensor, with a 120 x 120 degree field of view on one chip ([TI reference design TIDEP-01023](https://m.ti.com/tool/TIDEP-01023),
  read 2026-11-19; a low-power variant on an 18 x 55 mm board, [TIDEP-01037](https://www.ti.com/tool/TIDEP-01037), same date).
- **Inference in the pod.** The vision board runs the models and sends verdicts and still proof pictures, not video,
  on the arm's one network line from its enclosure to the tool: through the J1, J2 and J3 rotary unions, the mast reel
  and the wrist clock spring (an EtherCAT pair, `CLN-SWV`, `CLN-WCS`). Stills fit that line. Streaming video would not,
  and would need gigabit slip rings in 3 unions. The pod is the first node on the wand: the clock spring's turning lead
  leaves the hub through a gland and goes into the pod, and the pod passes 48 V and the EtherCAT line on to the wand
  drive. Those are 2 new lines in the cable schedule (`CLN-VPL`, `CLN-VPD`). Before them, no line in the schedule reached
  the wand drive.
- **What it does, in order:** before the wand enters, the radar and the cameras check that no one is in the cabin (if
  someone is, the arm stays out and OTTO-Q is told; nothing is moved); it finds the seats, the floor and any item left
  behind (an item is reported, never moved: the found-item flow from otto-q-core 0814); it cleans; it takes an after
  picture of each surface from the same pose as the before picture; a surface that does not pass gets one more pass,
  then is reported as a need.
- **The cabin check is a safety function, so no one sensor carries it.** The wand must not go into a cabin with a
  person in it. That takes 3 layers:
  - the car's own report that its cabin is empty, read through the owner's contract;
  - the pod's radar and its cameras both finding it empty;
  - the wand working inside the cabin at collaborative limits of speed and force, so a contact both missed does not
    injure. ISO/TS 15066 sets the limits by body region, and ISO 10218-2 (2025) makes power and force limiting a
    requirement ([summary, arXiv 2602.17822](https://arxiv.org/pdf/2602.17822), read 2026-11-19).

  The radar class here is an automotive presence sensor, not a certified safety device, and an AI camera model cannot
  be certified (section 1). That is why the third layer is needed.
- **Guard for people beside the car:** the canopy's scanners (above). The arm enters only with the door the car reports
  open, and the pod confirms it.

### OTTO-WASH: a guard for each bay, and its own sensor camera used twice

- **Has.** Find: a sensor-finding camera with a ring light on each detail arm (`WSH-PCM`), which finds each camera,
  lidar and radar cover so the polishing pad goes to the sensor and not the paint. Guard: none; there is a safety relay
  in the cabinet and no sensor feeding it.
- **Add: a guard for each bay, with the doors open (Chase, 2026-11-22: *"Definitely do not want doors to close in a
  wash bay"*).** An earlier version of this note closed and interlocked the doors. That is withdrawn. A wash bay is full
  of spray and mist while the machine runs, which makes a camera or a laser guard stop the machine for nothing
  (section 1). With the doors open, something certified must still stop the gantry and the 2 arms when a person walks
  in. So:
  - **One 60 GHz safety radar at each mouth, 2 a bay, 6 in all.** Its field is the door opening and the first metres
    inside. A person in it stops the gantry and the detail arms. The car's own passage is expected: the field is muted
    while the machine is home and the signal is green. This is the one place this design uses a radar as a guard, and
    it is here because nothing else certified works in spray (section 1a). If the maker does not approve it for this
    spray, the fallback is a safety light curtain across each mouth, set back from the spray.
  - **The bay's overview camera checks that the bay is empty** before a program starts, and records any stop.
  - **Emergency stops** at each mouth, inside and out.
  - IP69K for everything in the bay: the road-vehicle rating for close-range, hot, high-pressure spray, 80 degrees C
    water at 80 to 100 bar ([fabrico summary of ISO 20653](https://www.fabrico.io/fr/blog/ip69k-rating-washdown-equipment/),
    read 2026-11-19; sources differ on the exact distance and time, so test to the standard's text).
  - **Built 2026-11-23** (`docs/OTTO-ROBOTICS-CAD.md` finding 27): a guard station on the wall east of each mouth (the
    radar, an emergency stop inside and one outside), the overview camera over the exit station, and their cables in 2
    ducts under the slab from the detail arm cabinet. Clash check 0, line ends 0 open.
- **Add: the check after the pad.** The same sensor camera looks at each cover again after it is polished: clean, one
  more pass, or a need for a sensor calibration. The twin already models that escalation (a failed clean raising a
  calibration); a real camera makes it a measurement. No new hardware.
- **Add: one overview camera per bay**, IP69K, high on the hall wall, for the operator and for the record of any
  incident.

### OTTO-TIRE: complete; the record to add

- **Has.** Find: a 3D structured-light camera (`TB-C3D`), a camera on the nut cluster's axis (`TB-CAX`) and a camera at
  each lift pad (`TB-PCM`). Guard: a safety laser scanner (`TB-SCN`). Prove: the axis camera checks a nut in each socket.
- **Add: the proof record.** Each nut's torque trace and its socket picture, into the tire job's service record. No new
  hardware.

## 3. The site: what no robot can see

### An arrival inspection arch on the inbound lane: the best value in this design

A drive-through arch that photographs every arriving car's body all round, its underbody and its tires, at low speed:
exterior damage, underbody leaks and damage, tread depth and sidewalls. Commercial systems of this kind exist as 3
units, body, underbody and tires; one body arch is drive-through at up to 15 km/h in its maker's 2020 brochure, and
the tire unit's tread readings were found accurate in a reviewer's test that also noted it missed tire date codes
([vendor brochure, 2020](https://www.uveye.com/wp-content/uploads/2020/03/repairshops_automotive.pdf);
[Work Truck](https://www.worktruckonline.com/products/uveye-helps-keep-fleets-safe-on-the-road); both read
2026-11-19; no current spec sheet was found, so tread resolution, speed limits and power are open with the supplier).

Why it is worth more than any single robot camera:
1. **Evidence for every owner.** The depot serves several owners at once (otto-q-core rule 14). A dated picture of each
   car's condition as it arrived settles a damage dispute in seconds.
2. **It does the perimeter walkaround.** Today a technician walks round each car for 12 minutes (`perimeter_walkaround`,
   otto-q-core G86). The arch does it in the time the car takes to drive through.
3. **Five needs become measured, not drawn.** Tread depth (the tire job), underbody damage and leaks (fault repair),
   body damage (cosmetic repair), sensor covers dirty (the sensor clean), and exterior soil (the wash).

### Overhead cameras on the canopies

One camera covers several stalls from above: multi-space occupancy sensors cover about 3 to 6 spaces indoors and more
when mounted high outdoors, with vendor accuracy claims of 95 to 99.9 percent that depend on the site
([parkingguidancesystems.com](https://parkingguidancesystems.com/my-product/multi-space/),
[Swarm Analytics setup guide](https://docs.swarm-analytics.com/use-cases/parking-monitoring/set-up-single-space-multi-space-parking),
both read 2026-11-19). At the depot they do one job no other sensor does: **they check that each stall holds the car
OTTO-Q says it holds.** OTTO-Q's rule is assignment plus verification (CLAUDE.md rule 6), and its records have
disagreed with the physical yard before (stall pointers held by no car, otto-q-core G121). A camera that sees the stall
turns those into measured conflicts. They also give the operator the arms' work area and a record of incidents.

### The gate

A camera at the gate confirms the arriving car is the one that announced itself. The car's identity comes from its own
data (the contract's `vehicle_ref`, and Plug & Charge at the charger); the camera checks it, it does not replace it.

## 4. Compute, network, clock and ratings

- **Compute at the edge, one box per zone** (each canopy, the wash hall, the service hall, the gate). An industrial AI
  module of the class the design assumes: 248 TOPS at INT8, 15 to 75 W, 64 GB of ECC memory, a cold start at -40
  degrees C and a 10-year rated life ([Connect Tech](https://connecttech.com/product/nvidia-jetson-agx-orin-industrial-module-900-13701-0080-000/),
  read 2026-11-19; the full temperature range is in the supplier's data sheet, not confirmed here). Only verdicts,
  events and proof stills leave the zone.
- **Network:** a PoE++ switch per zone, fibre to the ops building, and the cameras, the robot cells and the office on
  separate network zones.
- **One clock:** IEEE 1588 PTP on every camera and robot controller, so a proof picture, the robot's log and the
  charger's meter readings carry the same time. PTP is part of GigE Vision 2.0, and gives microsecond alignment with
  hardware timestamping ([Basler](https://docs.baslerweb.com/precision-time-protocol),
  [SVS-Vistek](https://www.svs-vistek.com/en/knowledgebase/svs-about-machine-vision.php?p=ptp-766), both read 2026-11-19).
- **Ratings:** robot pods IP67; yard and canopy cameras IP67; everything in a wash bay IP69K.

A sealed industrial stereo camera is the alternative to our own pod housing: one such camera has GMSL2 over a FAKRA
connector, global shutter on depth and colour, a 95 mm baseline and 1280 x 800 depth at 30 fps
([Seeed Studio wiki](https://wiki.seeedstudio.com/orbbec_gemini_335lg/), read 2026-11-19); sources disagree on its
rating, IP65 or IP67 ([Electronics-Lab](https://www.electronics-lab.com/orbbec-gemini-335lg-3d-camera-offers-ip65-protection-and-long-range-depth-sensing-with-gmsl2-and-fakra-connectivity-for-robotic-systems),
same date). For the prototypes our pod is right (it shares the charge arm's design); for production, buying a sealed
camera saves certifying our own enclosure.

## 5. What reaches OTTO-Q

Each machine sends a verdict and a proof record per operation: the picture's hash, the sensor's id, its calibration's
id, the model's version and the time. The record goes onto that operation's service record (the SDR, otto-q-core
CLAUDE.md 2.6), so a completed operation says what was done and shows it. A failed proof raises a need on the needs
card (a re-clean, a re-mate, a fault), and rule 9 holds the car until it is done.

## 6. Privacy and security

- **Cabin pictures can hold an owner's or a rider's belongings.** They are kept for as long as the owner's contract
  says, shown to that owner, and never sent anywhere else. Screens and papers in a picture are blurred before it is
  stored.
- **Cameras are an attack surface.** They sit on their own network zone, have no route to the internet, and sign what
  they send.

## 7. The twin: proving the concept at the same detail

- **Every camera in the CAD with its real numbers:** sensor size, lens, field of view, resolution and its pose on the
  machine. The CAD carries them as part facts, so the bill of materials can be bought from.
- **The twin draws each camera's field of view**, and can render what a camera sees from the 3D scene: the clean arm's
  view into the cabin, the arch's view of an arriving car.
- **The twin draws outcomes at measured rates:** a proof can fail, and a failure raises the same need a real one would,
  so OTTO-Q is tested against it.
- **The arch's readings replace drawn needs** in the twin: tread depth and damage come from the arch, as they will at a
  real depot.

## 8. The build, in order

1. **OTTO-CLEAN ARM: the cabin vision pod and the presence radar. Built 2026-11-19** on the wand, not the wrist fork
   (section 2), with its 2 cables in the cable schedule and the whole CAD chain: build, clash (0), line ends (0 open),
   the twin's CAD tests, the yard and fleet clearance tests, and the robot facts and their copies to the two cockpits.
   The stall's guard for the clean arm is not built: it waits on the canopy safety controller (section 2).
2. **The guards, as Chase decided on 2026-11-22.** Built 2026-11-23: in each wash bay a safety radar at each mouth, 4
   emergency stops and the overview camera; no door closes. Not built yet: the canopy safety controller with a scanner
   at each row's open end (6). Those stand in the yard, beside lanes cars drive, so they need a place on the site plan
   and the motion checks first.
3. **The arrival inspection arch:** its place on the site plan (the inbound lane, before the gate queue), its model in
   the yard and the twin's needs from its readings.
4. **The canopy overhead cameras**, and a stall-occupancy check in OTTO-Q against them.
5. **Proof records on the service record** in the engine.
6. **Camera views in the twin.**

## 9. Open feedback

- **The clean arm was the riskiest machine and the blindest one.** It reaches into cabins. Build its pod first.
- **The arch may be the best money spent at the depot.** It replaces a 12-minute walkaround on every car, makes five
  needs measured, and protects every owner relationship with evidence.
- **Do not buy a camera per robot where one fixed camera serves many.** A canopy camera watches several stalls, and a
  riser scanner guards the gap it stands in, for 2 stalls' machines.
- **Measure before you place a sensor.** The pod was drawn on the wrist fork in this note's first version, and the
  wrist turned out to be full. A sensor that sits in a robot's swept space is part of the robot's clearance, and every
  clearance at this depot is measured against every vehicle.
- **A sensor in the wrong medium is a false alarm machine.** Optical guards in spray, and any guard that stops the
  depot for nothing, get switched off by the people who work there. Pick the guard for the place: a radar at each open
  wash bay mouth, scanners in the dry canopies, cameras for everything else.
- **Send stills, not video.** It keeps the network small, keeps the arms' existing slip rings, and keeps the privacy
  surface small.
- **The cars have cabin cameras of their own.** Read them through the contract as a second opinion. Never make them
  the only check.
- **Calibration is part of the hardware.** A camera on a moving arm drifts. Each stall needs a fiducial target the arm
  can see at its home pose, so a calibration check is a few seconds at every cycle, not a service visit.
