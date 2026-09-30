# OTTO-Q and Agent tabs: design note (2026-09-30)

Chase, 2026-09-29, 11:45 PM CT: *"Between 'events, intelligence, and orchestration' all in the twin UI, there
seems to be a lot of redundancy and slop data. I need this to be way more concise and basic. The main goal is truly
just to show the functioning thought process behind OTTO-Q overall and how it orchestrates and then specifically the
agent layer, thinking learning looping and proposing."*

Three tabs (Intelligence, Orchestration, Events) become two:

| tab | question it answers | form |
|---|---|---|
| **OTTO-Q** | How does OTTO-Q move every car through the depot, right now? | a living 3D stack of the engine's layers: real cars, offers and decisions on plates, each new record falling through the stack |
| **Agent** | What is the agent reading, proposing, and learning, and what happened to it? | a plain-English live stream, then the learning loop |

## What the three old tabs showed, and what was redundant

| old surface | contract | kept? |
|---|---|---|
| Intelligence ▸ Decisions (per-car trail + a 5-box funnel) | `ottoq_depot_cards`, `ottoq_activity_feed_v2`, `ottoq_decisions`, `ottoq_external_proposals`, `ottoq_decision_options` | the per-car trail moves into the OTTO-Q layer drill-in (same `buildTrail`). The 5-box funnel is replaced by the living funnel. |
| Intelligence ▸ Live stream (every decision, 5 filter chips) | `ottoq_activity_feed_v2` | the **agent** rows become the Agent stream. Per-car rows move to the layer they happened in (OTTO-Q drill-in). The site-battery rows are dropped (see below). |
| Intelligence ▸ How it works (5 auditor cards L0–L4, arming, frame) | `ottoq_intelligence_stack` | the layer headlines feed the OTTO-Q layer overviews. The raw counters, arming dials and frame dump are dropped from the UI. |
| Intelligence ▸ Challenge & learn | `ottoq_challenger_board`, `ottoq_learning_board` | moves to the Agent tab's learning section, unchanged. |
| Orchestration (7 lifecycle tiles, reservation list, inbound cards, 6 hero tiles) | `ottoq_twin_appointments` | the lifecycle tiles were the depot-cards states counted a second time; the funnel's physical layers now show the cars themselves. Dropped. |
| Events (event feed, 4 domains) | `ottoq_run_event_feed` | an event log of what HAPPENED (a car plugged in, a charger faulted). It repeated the decision stream's facts a third time in audit words. Dropped from navigation. |

So the same fact (a car was placed on a charger) appeared in the Decisions trail, the Live stream, the Orchestration
tiles and the Events feed. After this change it appears once: as a node moving from *Decide* through *Safety check* to
*Booked*.

## The layers, in the order the engine actually runs them

Verified against the engine (otto-q-core `db/baseline/functions_public.sql`, `ottoq_shield_and_log`; CLAUDE.md 2.5):
the decide path CHOOSES an action, the shield probe CHECKS that choice when it is enacted, and a blocked choice is
written `overridden_to_default`. So the shield sits **after** the decide path, not before the proposers. The brief's
suggested order had the shield first; the engine has it last before booking, and the tab follows the engine.

| # | layer | kind | what rests or passes here |
|---|---|---|---|
| 1 | **Arriving** | where cars are | cars with state `en_route_to_depot`, `arrived_at_gate` |
| 2 | **Needs** | where cars are | cars waiting for a plan: `staged_awaiting_service`, `emergency_staged` |
| 3 | **Proposers** | thinking | agent passes (`orchestrator_agent`), and CP-SAT / cuOpt / priority offers from `ottoq_proposal_disposition_ledger` |
| 4 | **Decide** | thinking | every per-car decision the decide path writes (`ottoq_activity_feed_v2`, changes only) and every offer it disposes |
| 5 | **Safety check** | thinking | the L1 shield's verdict on each enacted choice: passed, or `overridden_to_default` |
| 6 | **Booked** | where cars are | cars that hold a stall or booking and have not started (state as layer 2, with `stall` or a reservation set) |
| 7 | **Service** | where cars are | `charging_dcfc`, `charging_l2`, `in_wash_bay`, `in_detail_bay`, `in_service_bay`, `charge_complete_holding`, `service_complete_holding`, `tow_requested`, `out_of_service` |
| 8 | **Ready** | where cars are | `staged_for_departure`, `en_route_to_deployment` |

Cars `deployed` or `offline` are outside the depot and are counted in one line under the funnel, never drawn.

## The OTTO-Q stack (3D)

Chase, 2026-09-30 ~1 AM CT, with two reference renders of exploded plate stacks: *"majorly upgrade the visual
depiction of the Otto-q funnel. Not just 2D, but More 3D and moving nodes/scaffolding etc."*

The eight layers above are drawn as four plates hung on a scaffold, top to bottom in the order a decision falls
through the engine. Code: `src/components/tabs/ottoq/stack/` (`stackModel.ts` places everything and is tested without
a GPU; `OttoQStack.tsx` draws it with three.js / react-three-fiber, already in the app for the depot view).

| plate | layers | what is on it | one object is |
|---|---|---|---|
| **Agent** (red glass) | Proposers (agent) | a chrome sphere per agent pass, joined to a pearl for the objective it chose, and to the pass before it | one `ottoq_activity_feed_v2` row with action `orchestrator_agent` |
| **Planners** (dark metal) | Proposers (offers) | a bar per offer in its planner's lane (CP-SAT, cuOpt, greedy, service priority), newest on the left | one `ottoq_proposal_disposition_ledger` row |
| **Decide + safety** (tile grid, red rim) | Decide, Safety check | a tile per car decision, newest at the front; the rim is the L1 shield | one car decision (feed row, changes only) |
| **Depot** (base) | Arriving, Needs, Booked, Service, Ready | a puck per car, in the zone its state puts it | one `ottoq_depot_cards` vehicle |

**The depot base is the site.** Zones sit where their stalls sit on the real plan (`src/lib/sitePlan.ts`): service and
wash bays along the north (back), the DCFC canopy west of centre, the L2 canopies in the middle, temp staging (waiting,
booked) to the east, ready to the west. Cars **enter at the east gate and leave by the west gate**, the founder-locked
rule. Charger and bay sockets are the site's real counts from `generateStallsV2` (10 DCFC, 30 L2, 3 wash, 2 service),
and a charging car sits in the socket its own stall number names when its card carries one. A zone with more cars than
sockets reports the overflow; nothing is hidden.

**What moves, and why (every motion is one record or one reported change):**

| record | on screen |
|---|---|
| a new agent pass | its sphere appears; a frame of light rises from the depot to the glass (it read the depot's frame); if the solver took the hand-off (`handoff_status = completed`), a bead falls to the planners |
| a new offer | its bar slides into its lane; an enacted one drops a bead to the decide plate; a refused one flashes red |
| a new car decision | its tile flips up and glows; one that places a car drops a bead along a beam to that car's puck, which pulses as it lands; an override (`overridden_to_default`) flares the red rim |
| a car changing state | its puck glides to its new zone (two polls of the cards); a car the depot no longer holds drives out through the west gate |

Records already there when the tab opens appear without playing. A flood is capped at 48 plays per read; the rest still
appear on their plates. Nothing plays while the run is paused, because nothing new is read. The only motion not caused
by a record is the viewer's own: dragging sideways turns the stack, and tapping a plate zooms to it (it lifts the other
plates away and fades them).

**Replay, only when asked.** An ended, paused or quiet run writes nothing new, so on its own the stack stands still. The
row above the stack offers **▶ Replay**: the newest records on the plates (6 agent passes, 10 offers, 14 decisions,
`REPLAY_PER`) are hidden and played through the stack again, one every 0.6 s, in the order they were written, with the
same light a new record gets. While it plays, the row says **REPLAY n of 30** and names the record playing, in the same
words as its hover line (*"Waymo-AV-025: Assigned a stall · 08:12:51"*). **■ Stop** puts everything back at once. It
never starts on its own, and it plays only records whose object is on a plate, so every bead starts and lands on
something real. Passes and decisions share the feed's clock and keep their time order; offers carry the ledger's clock, so
they keep their id order and are spread evenly through the rest (the live stream's own compromise). Pucks are not
replayed: the cards give only where each car is now, so a replayed decision's bead lands on its car where it stands today.
The replay's Stop is the replay's own button, labelled "Stop the replay"; it is not the run's Stop and calls nothing.

The agent's threads grow with their pass: a pass still to come has no thread yet, and the thread from its objective and
from the pass before it draws out as the sphere appears. The scaffold's two red light pipes brighten while a record is
travelling down the stack and dim when nothing is; its posts all but vanish while a plate is zoomed, so they do not cross
the plate being read.

**Every object can be read.** Hover one for a line about its record; tap it and the stack zooms to its plate and a card
below says it in words: an agent pass (what it read, the directives, what it chose, what happened), an offer (who
offered it, for which car, what the decide path did and why), a decision (what, why, whether the safety check overrode
it, how long it held), or a car (its battery against its target, and its full plain-English trail).

**Colours** are the legend's: green enacted, amber held or waiting (an agent fallback is amber, never red), red refused
(the safety check overrode a choice, or the decide path refused an offer), grey nothing recorded or an offer replaced,
expired or declined. A car in Ready is green only with a battery reading at or above its target and no open need
(rule 9).

**Without WebGL** (and in tests) the tab falls back to the flat funnel below, which reads the same records.

## The flat funnel (fallback)

- **A car node** is one vehicle from `ottoq_depot_cards` (contract 1.4), placed in the layer its `state` maps to. It
  moves only when a new poll puts it in a different layer: the motion interpolates between two real states.
- **A decision spark** is one engine record that arrived since the last poll: one `ottoq_activity_feed_v2` row (a
  decision, changes only) or one `ottoq_proposal_disposition_ledger` row (an offer disposed). It travels from the layer
  where the record was made to the layer its outcome sends it to, then fades. Sparks are spread across the poll
  interval so a batch does not arrive as one flash; nothing is emitted that no record carries.

| record | spark path | colour |
|---|---|---|
| `orchestrator_agent` enacted | Proposers (pulse) | green |
| `orchestrator_agent` fell back / noop | Proposers (pulse) | amber |
| disposition `enacted` | Proposers → Decide → Safety check | green |
| disposition `refused` (not abstained) | Proposers → Decide | red |
| disposition `superseded` / `expired` / abstained | Proposers (pulse) | grey |
| `stall_assignment` / `task_start` enacted, placing a car | Decide → Safety check → Booked or Service | green |
| `task_start promote_ready`, `redeployment hold` resolved | Decide → Ready | green |
| any `overridden_to_default` | Decide → Safety check (stops) | red |
| `noop_no_candidate`, `hold_*` | Decide (pulse) | amber |
| `redeployment deploy` enacted | Ready → out the bottom | green |
| `triage_verdict`, `gate_intake*` | Needs (pulse) | green (escalate: amber) |

`bess_dispatch` (the site battery) and challenger rows are not car decisions and make no sparks; the challenger is on
the Agent tab.

## What every colour and motion means

- **Green**: enacted, placed, passed the safety check, left ready. Only an enacted record is ever green.
- **Amber**: held or waiting: no free stall, bays full, the agent fell back to the deterministic path, a car standing
  in Ready whose card still shows an open need or a battery below its target (rule 9: it may not leave; the engine's
  0543 recheck sends it back).
- **Red**: refused: the safety check overrode a choice, or the decide path refused an offer. Never used for
  `recorded_only` (an advisory rule's would-block is a note, not a refusal, `ottoq_rule_evaluation_effect`), never for
  superseded or expired.
- **Grey**: no decision recorded for this car in the window, or an offer superseded, expired or abstained.
- **Motion**: a car glides only between two states the engine reported. A spark or bead travels only along the path its
  record names. When the run is paused, polling stops and the stack freezes (the stream's own rule). The one exception
  is a replay someone asked for, which says REPLAY for as long as it plays.
- A missing number shows as "—", never 0.

## Each layer's one-line overview (and its source)

| layer | line | source |
|---|---|---|
| Arriving | "4 on the way · 2 at the gate" | depot cards |
| Needs | "6 waiting for a plan · most need: charge" | depot cards `card.needs` |
| Proposers | "Agent: readiness first, 15 passes, 2 fell back · offers 1 enacted, 25 refused" | stack L2 + disposition ledger |
| Decide | "101 moves decided · 36 holds, last two sim-hours" | activity feed, this window |
| Safety check | "14,143 checks · 0 refused" | stack L1 (`refused` = enforced; `recorded_only` shown apart) |
| Booked | "3 held for their car" | depot cards |
| Service | "18 charging · 2 in wash or detail · 2 in service bays" | depot cards |
| Ready | "9 staged · 11 left this window" | depot cards + feed `deploy` |

Tap a layer: it opens underneath the funnel with the cars resting there (tap a car for its plain-English trail, the
same `buildTrail` the Decisions view used) and that layer's newest decisions in sentences.

## The Agent tab

A stream of the agent's passes, newest first, each written as sentences:

1. **What it read**: the agent's own summary of the depot (the model's words, from the decision's `summary`) and the
   directives it applied.
2. **What it chose**: the objective and its stated reason (`objective_why`).
3. **What happened to it**: the solver hand-off (`handoff_status`, provider from `solver_engine`) and the decide path's
   disposition (`kernel_enacted/refused/superseded/expired`), or the fallback and why (`model_error`).

Beside it, the offers the proposers made and what the decide path did with each (`ottoq_proposal_disposition_ledger`,
read by run, newest first), in sentences.

Then **Learning** (the loop): the challenger's open and graded questions (read-only; it never changes the engine) and the
research wing's paired tests in the twin (rule 10: OTTO-Q never experiments in production; each result is a
recommendation a person ships).

**Overnight estimates are not shown, because nothing produces them yet.** CLAUDE.md rule 10 says production OTTO-Q
"updates its estimates (how long charges take, when cars return, which chargers fault)" overnight, but no cron job,
table or function in otto-q-core does that today (checked 2026-09-30: `cron.job` holds only the retention and run purges
at night; no read contract names estimates). The tab says so in one line. No migration was written: a read contract for
a process that does not exist would be invented data.

## Data contracts (all existing, all read-only, all open to the cockpit's anon key)

| contract | poll | used by |
|---|---|---|
| `ottoq_depot_cards(depot, null)` | 10 s | car nodes, physical-layer overviews |
| `ottoq_activity_feed_v2(run, changes only, 240 ticks)` | 4 s (shared store) | decision sparks, Decide overview, Agent stream |
| `ottoq_intelligence_stack(run, false)` | 5 s | Proposers + Safety check overviews |
| `ottoq_proposal_disposition_ledger` (select, `sim_run_id = run`, `disposition_id > last`) | 8 s | proposer sparks, Agent offers |
| `ottoq_challenger_board(run)`, `ottoq_learning_board()` | 10 s / 60 s | Agent learning |

No new RPC. Every poll stops when the run is paused or another cockpit tab is open (the tab unmounts), and the 3D stack
renders nothing while the page is hidden.

## Dropped, and why

- **The 5 auditor cards' raw counters** (packets, integrity, by-probe-point, arming dials, per-provider call counts).
  They answer "is the instrument healthy", which is Diagnostics' question, not "how does OTTO-Q think". Their sources
  stay in `TwinIntelligenceTab.tsx` for review.
- **The Orchestration tab's hero tiles** ("Vehicles / charger", "Unsafe deploys") and lifecycle tiles: the same states as
  the funnel's physical layers, counted a second time.
- **The Events tab**: the third copy of the same facts, in audit words.
- **Site battery rows** in the stream: energy dispatch is not a car decision. Value and KPIs cover energy.
- The old components stay in the tree (as PR #108 did) and are no longer in navigation.

## Found on the way (for Chase)

- **The decide path's own card undercounts on a finished run.** On run `1ccad49b` the stack's L4 card, reading
  `ottoq_external_proposals`, shows 0 enacted and 2 refused; the evidence ledger `ottoq_proposal_disposition_ledger`
  for the same run holds 24 more rows from `greedy_constrained` (1 enacted, 23 refused) that the working table no longer
  has. Cause not established (that run interrupted a determinism pair). The new tab reads the ledger, as the brief
  requires.

## Performance rules

- **The stack renders only while something moves** (react-three-fiber `frameloop="demand"`): an event's animation, a
  car gliding, the zoom, a drag. Measured on the fixture: the frame counter stopped (59 frames from second 16 to second
  20 of a quiet stretch), and a poll with nothing new costs a couple of frames. With `prefers-reduced-motion` no bead
  plays and cars jump to their zone.
- **53 draw calls and 21k triangles per frame, bloom passes included** (was 92 before the ports, posts and collars were
  instanced). Every repeated object is one instanced mesh: spheres (≤ 40), bars (≤ 48), tiles (≤ 72), pucks (≤ 170),
  beads and flashes (one point cloud).
- The frame is fitted to the stack every frame, so it fills the panel at 420, 360 and 320 px and in the phone sheet.
- Device pixel ratio follows the app's render tier (`qualityStore`): up to 1.75 on High, 1.5 on Medium, 1 on Low; Low
  also drops bloom and MSAA.
- The measurements above ran in a headless browser rendering WebGL in software (SwiftShader, about 6 frames a second).
  They count work, not smoothness; smoothness has to be seen on a real GPU and a real phone.

The flat fallback (Canvas 2D): one `requestAnimationFrame` loop, nodes capped at 160 cars and 60 live sparks, stopped when
the page is hidden or the tab unmounts.
