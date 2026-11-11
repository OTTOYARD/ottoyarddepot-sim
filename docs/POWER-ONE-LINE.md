# The Power tab: the depot's electrical one-line

**What it is.** A tab in the twin cockpit (the last one in the bar) that shows how power reaches a post: the utility's 13.8 kV
service, the primary switchgear, seven transformers and the thirty posts. Six transformers feed five posts each, one
per canopy column. The seventh feeds the battery, the building and the canopy solar. Each transformer shows its load
and its own winding temperature. Each post shows charging, idle or down.

**Where the numbers come from.** otto-q-core migration 0810. The engine keeps the tree as data
(`ottoq_power_nodes`), measures every node on every tick at the instant it reads the site meter, and steps each
transformer's temperature by the loading guide's thermal model, using the twin's own weather for the air temperature.
The tab reads one function, `ottoq_power_one_line`, every 5 seconds while a run is live. Nothing is computed in the
browser but sums and words (`src/lib/powerOneLine.ts`).

**Two things the page always says.**

1. Every size is what is installed, at or above everything connected under it. Nothing on the page limits a car
   (otto-q-core CLAUDE.md rule 13).
2. "This day would have fit on 1,000 kVA" is one run's reading for a person. It changes nothing. The depot's ceiling is
   set after the build, from what the cars drew.

**Two readings made at a run's end.** For each charger transformer: had it tripped at its busiest moment, could the
posts under the other transformers have taken its cars. For the depot: the most any post delivered against its
350 kW rating, and how many of the depot's cars can take more than 150 kW at all. Both are one run's reading.

**Tripping a transformer.** With a run live, pick a transformer and press
"Trip this transformer", then confirm. Every post under it goes dark for 90 sim minutes. The engine ends each open
charge as a charger fault and re-queues the car to finish on a post under another transformer (rule 9). The diagram
draws the feeder's breaker open in red, and the card says when power returns. The door is
`ottoq_twin_trip_power_node`, reached through `otto-twin-control` (`inject_fault`, kind `power_zone`).

**Applied.** 0810 has been in production since 2026-11-11 at 9:16 AM CT (ledger 20261111151626) and `otto-twin-control`
v31 (`1.11.0-power-zone`) since 9:17 AM CT. If the function is ever missing, the tab says so in one calm line and draws
nothing else.

**Where the control function's source lives.** otto-q-core `edge-functions/otto-twin-control/index.ts` is what is
deployed. This repo's copy under `supabase/functions/` had fallen two versions behind it (1.9.1 against 1.10.0); it is
now the same file. Deploy from otto-q-core.

**Where the gear stands (built 2026-11-11).** The founder gave the fenced northwest corner and the strip behind the office to electrical gear; no car drives there. `sitePlan.ts` holds it: `BESS_YARD` (the battery, the 13.8 kV switchgear `MV-SWGR` and `TX-AUX`) and `TX_YARD` behind the office (the six charger transformers, `TX-A1` to `TX-C2`, in a row). The plan, the 3D scene, the layout seed and `structurePlan` all read those constants, and `electricalYard.test.ts` holds them to the engine's node codes. The old west-link lane constant is retired: no route used it. The battery yard's south fence is at plan y 44, not further south, because a recorded car's body corner reaches y 45.7 on the west aisle turn (the clearance replays caught it).

**The fourth solar array is on the carports.** The engine has generated from four 180 kW DC arrays since before `CANOPY-04` was retired, and the scene has always drawn panels on the five perimeter carports. The layout seed now records `canopy_4`'s 288 panels across those five roofs by roof area, so the picture and the solar table agree and no energy number changes.
Where seven pad-mounted units stand on the site is a site-plan decision (working clearances, bollards, the lane
network is founder-locked), so it was not guessed.

| file | what |
|---|---|
| `src/lib/powerOneLine.ts` | parses the engine's answer; states, totals, formatters, the right-size sentence |
| `src/hooks/usePowerOneLine.ts` | the poll |
| `src/components/tabs/TwinPowerTab.tsx` | the diagram, the transformer card, the trip control |
| `src/components/tabs/__fixtures__/powerOneLine.labDay.json` | a real answer from a research-lab day (not a production run) |
| `supabase/functions/otto-twin-control/index.ts` | `inject_fault` kind `power_zone` |
| `docs/pr-shots/power-one-line/` | the tab on the lab day, and with TX-B1 tripped (the fixture, mid-trip) |
