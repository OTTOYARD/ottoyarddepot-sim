# Cameras on the robots

**Status:** recommendation, 2026-11-18 (evening CT). No CAD changed. **Asked by Chase, 2026-11-18:** *"Cameras in
robotic arms? Should all robotic arms and systems have a camera with sensor attached for computer vision and validation
of tasks/ mating or completion?"*

## The answer

**Yes: every machine that works on a car should see its work, and prove it is done.** A camera at a depot does three
separate jobs, and a machine needs all three:

1. **Find** where to work: an inlet, a sensor cover, a wheel nut, a door opening.
2. **Guard**: see that nothing is where the machine is about to move: a person, an open door, an animal in the cabin.
3. **Prove** the work is done: the connector seated, the sensor cover clean, a nut in every socket, the cabin empty
   and clean. That proof is what lets OTTO-Q release a car under rule 9 (no car leaves with a service still needed)
   on evidence rather than on a timer, and it is what an owner can audit: a service record (CLAUDE.md 2.6, the SDR)
   that carries the machine's own picture of the finished job.

## What each machine has today (read from `cad/otto_cad/robots/`, 2026-11-18)

| Machine | Find | Guard | Prove | Gap |
|---|---|---|---|---|
| **OTTO-CHARGE ARM** | A sealed vision pod on the tool: 2 global-shutter 2 MP cameras (stereo, 60 mm apart), a time-of-flight depth sensor (0.1-2 m) and an 850 nm light (`CHG-VIS`, `CHG-CAM`, `CHG-TOF`, `CHG-IRB`) | A 275° safety laser scanner at the base (`CHG-SCN`), an emergency stop (`CHG-EST`) | A 6-axis force and torque sensor at the tool (`CHG-FTS`) feels the mate | None in the parts. The pod can also take the picture of the seated plug: software, no part. |
| **OTTO-TIRE** | A 3D structured-light camera (`TB-C3D`), a camera on the nut cluster's axis (`TB-CAX`), a camera beside each lift pad (`TB-PCM`) | A safety laser scanner (`TB-SCN`) | The axis camera checks a nut in each socket after each change | None. |
| **OTTO-WASH** (its detail arms) | A sensor-finding camera with a ring light (`WSH-PCM`) finds each camera, lidar and radar cover | **None** in the parts (a safety relay in its cabinet, no sensor feeding it) | **None** | Nothing sees a person in the bay before the gantry moves, and nothing checks a cover is clean after the pad. |
| **OTTO-CLEAN ARM** | **None** | **None** (a safety relay in its supply enclosure, no sensor feeding it) | **None** | It works inside the cabin through an open door with nothing to see. **Its own design text already counts on a camera that is not there:** its light ring *"lights the cabin for the camera"* and its status lights *"show the arm state to the site and to the camera"* (`clean_arm.py`), and no camera part exists. |

## What to add, in order

1. **OTTO-CLEAN ARM: a cabin vision pod on the tool**, the charge arm's pod family (stereo pair, depth sensor, IR
   light; one spare part for both arms), plus a presence sensor over the stall's door zone feeding the safety relay it
   already has.
   - Before it goes in: the cabin is empty of people and animals (if not, it stops and says so), and anything left
     behind is reported (never moved).
   - After: a picture of each surface it cleaned, the cabin's proof.
2. **OTTO-WASH: a check after the pad, and a guard on the bay.** The camera that finds each sensor cover looks at it
   again after the pad: clean, or one more pass, then escalate. The twin already models that escalation (a failed clean
   raising a sensor calibration, CLAUDE.md rule 15); a real camera makes it a measurement instead of a draw. A safety
   scanner at each bay's mouth stops the gantry for a person in the bay.
3. **Every machine: its proof on the service record.** The hash of the finished-job image, and the machine's own
   verdict, on the SDR for that operation, so a record says what was done and shows it. (The SDR's fields were not
   checked for this note; it may need one added.)

## What building it takes (AGENTS.md's CAD chain, not a drive-by)

- The parts, their mounts and every cable, end to end in the cable schedule (`cad/otto_cad/cables.py`), in
  `clean_arm.py` and `wash_gantry.py`; then `cad/build.py`, `cad/clash.py --baseline`, `cad/line_ends.py`.
- The clean arm's tool grows, so every vehicle's clean program is regenerated (`CLEAN_PROGRAM_WRITE=1`) and
  `cleanArmFleet.test.ts` must still hold every margin against each car's body, doors, cabin and seats; then
  `cadDetail.test.ts` and `cadYard.test.ts`.
- `ROBOT_FACTS_WRITE=1` for `public/cad/robot-facts.json`, and its copy to OTTO-PULSE and OrchestrAV.
- The CAD toolchain (CadQuery 2.8, `cad/requirements.txt`) is not installed in the session that wrote this note.
