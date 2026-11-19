# Cameras and sensors at the depot: the design

**Status:** design, 2026-11-19. It replaces the recommendation note of 2026-11-18. **Asked by Chase, 2026-11-19:**
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

## 2. Each machine: what it has, what it gets

Read from `cad/otto_cad/robots/` on 2026-11-19. Part ids are the CAD's.

### OTTO-CHARGE ARM: complete; one wire and one record to add

- **Has.** Find: a sealed vision pod on the tool, 2 global-shutter 2 MP cameras 60 mm apart, a time-of-flight depth
  module (0.1 to 2 m) and an 850 nm light (`CHG-VIS`, `CHG-CAM`, `CHG-TOF`, `CHG-IRB`). Guard: a 275-degree safety
  laser scanner at knee height on the riser (`CHG-SCN`) and an emergency stop (`CHG-EST`). Prove: a 6-axis force and
  torque sensor at the tool (`CHG-FTS`) feels the mate.
- **Add: one guard for the whole stall.** The clean arm works in the same stall, so the stall's scanner stops both
  machines: its 2 safety outputs (OSSDs) are wired to the clean arm's safety relay as well as the charge arm's. One
  scanner, one protective field, two machines stopped. A second scanner would double the cost and give the stall two
  fields to keep in step.
- **Add: the proof record.** At every latch: the pod's picture of the seated connector, the force trace of the mate and
  the latch confirmation, hashed into the charge's service record. No new hardware.

### OTTO-CLEAN ARM: the biggest gap, built first

It works inside the cabin through an open door, and it has no sensor of any kind today. Its own design text already
counts on a camera that is not there: its wand-tip light ring *"lights the cabin for the camera"* (`CLN-NRG`).

- **A cabin vision pod on the wrist fork** (`CLN-FRK`, the mast's last stage). It is the charge arm's pod family, so one
  spare fits both arms: 2 global-shutter 2 MP cameras, a time-of-flight depth module and an 850 nm light, sealed behind
  one coated window, IP67. The mast lowers the fork to the door opening and J3 aims it, so the pod looks across the
  cabin through the door while the wand works. It does not pitch with the wand and does not enter the cabin, so it
  adds nothing to the wand's swept envelope.
- **A 60 GHz presence radar in the same pod.** A camera cannot see a child or a pet under a blanket or behind a seat. A
  60 GHz in-cabin radar sees breathing and small motion through soft material; this is the automotive child-presence
  sensor, with a 120 x 120 degree field of view on one chip ([TI reference design TIDEP-01023](https://m.ti.com/tool/TIDEP-01023),
  read 2026-11-19; a low-power variant on an 18 x 55 mm board, [TIDEP-01037](https://www.ti.com/tool/TIDEP-01037), same date).
- **Inference in the pod.** A small vision processor inside the pod runs the models and sends verdicts and still proof
  pictures, not video. The arm already carries one network link from its enclosure to the tool, through the J1, J2 and
  J3 rotary unions, the mast reel and the wrist clock spring (an EtherCAT pair, `CLN-SWV`, `CLN-WCS`). Stills fit that
  link. Streaming video would not, and would need gigabit slip rings in 3 unions.
- **What it does, in order:** before the wand enters, the radar and the cameras check that no one is in the cabin (if
  someone is, the arm stays out and OTTO-Q is told; nothing is moved); it finds the seats, the floor and any item left
  behind (an item is reported, never moved: the found-item flow from otto-q-core 0814); it cleans; it takes an after
  picture of each surface from the same pose as the before picture; a surface that does not pass gets one more pass,
  then is reported as a need.
- **Guard:** the stall's scanner (above), plus the doors: the arm enters only with the door the car reports open, and
  the pod confirms it.

### OTTO-WASH: a guard for each bay, and its own sensor camera used twice

- **Has.** Find: a sensor-finding camera with a ring light on each detail arm (`WSH-PCM`), which finds each camera,
  lidar and radar cover so the polishing pad goes to the sensor and not the paint. Guard: none; there is a safety relay
  in the cabinet and no sensor feeding it.
- **Add: 2 safety laser scanners per bay**, one at each mouth, at the ends of the gantry's floor rails, in IP69K covers.
  A person in either field stops the gantry and the detail arms. IP69K is the road-vehicle rating for close-range,
  hot, high-pressure spray: 80 degrees C water at 80 to 100 bar ([fabrico summary of ISO 20653](https://www.fabrico.io/fr/blog/ip69k-rating-washdown-equipment/),
  read 2026-11-19; sources differ on the exact distance and time, so test to the standard's text).
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

1. **OTTO-CLEAN ARM: the cabin vision pod and the presence radar** on the wrist fork, with their cables in the cable
   schedule, and the stall scanner's outputs wired to its safety relay. The full CAD chain (build, clash, line ends,
   the twin's CAD tests, the robot facts and their copies to the two cockpits).
2. **OTTO-WASH: 2 safety laser scanners per bay** at the rail ends, and the bay overview camera.
3. **The arrival inspection arch:** its place on the site plan (the inbound lane, before the gate queue), its model in
   the yard and the twin's needs from its readings.
4. **The canopy overhead cameras**, and a stall-occupancy check in OTTO-Q against them.
5. **Proof records on the service record** in the engine.
6. **Camera views in the twin.**

## 9. Open feedback

- **The clean arm was the riskiest machine and the blindest one.** It reaches into cabins. Build its pod first.
- **The arch may be the best money spent at the depot.** It replaces a 12-minute walkaround on every car, makes five
  needs measured, and protects every owner relationship with evidence.
- **Do not buy a camera per robot where one fixed camera serves many.** A canopy camera watches several stalls; a stall
  scanner guards both of its machines.
- **Send stills, not video.** It keeps the network small, keeps the arms' existing slip rings, and keeps the privacy
  surface small.
- **The cars have cabin cameras of their own.** Read them through the contract as a second opinion. Never make them
  the only check.
- **Calibration is part of the hardware.** A camera on a moving arm drifts. Each stall needs a fiducial target the arm
  can see at its home pose, so a calibration check is a few seconds at every cycle, not a service visit.
