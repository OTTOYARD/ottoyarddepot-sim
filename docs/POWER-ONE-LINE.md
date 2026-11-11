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

**Tripping a transformer.** With a run live, pick a transformer and press
"Trip this transformer", then confirm. Every post under it goes dark for 90 sim minutes. The engine ends each open
charge as a charger fault and re-queues the car to finish on a post under another transformer (rule 9). The diagram
draws the feeder's breaker open in red, and the card says when power returns. The door is
`ottoq_twin_trip_power_node`, reached through `otto-twin-control` (`inject_fault`, kind `power_zone`).

**Before 0810 is applied** the function does not exist. The tab says so in one calm line and draws nothing else.

**What is not built.** The 3D yard still draws one transformer in the battery compound and no primary switchgear.
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
