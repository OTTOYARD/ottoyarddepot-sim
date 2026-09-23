# Twin cockpit integration audit, 2026-09-23

Base: `ottoyarddepot-sim` main `3178e96` (merged PR #107). Engine: `otto-q-core` main `214f1b4` (merged PR #205). Engine project: `gxdrcyphqjzjsuhxuqtg`. This PR changes the cockpit only. It does not apply migrations or start a live run.

| Finding | Evidence | Change and validation |
| --- | --- | --- |
| Duplicated decision navigation | `TwinIntelligenceTab` already embeds `TwinDecisionLogTab` as its default stream. A separate Decisions tab exposed the same feed. | Keep the stream inside Intelligence; remove the duplicate tab. Shortcut 3 opens Intelligence. |
| Readiness and charger use overstated | KPI and deterministic narrative counted `staged_awaiting_service` as ready and divided L2 charging by 35, while both seeded depots have 30 L2 stalls. | Count only `staged_for_departure` and take DCFC/L2 capacities from the active layout. Show unavailable when that layout or a denominator is missing. Regression tests cover 5 ready, 15 awaiting service, and 15 of 30 L2. |
| Wrong building on a failed run lookup | `useTwinFeed` and `bootWorld` fell back to Nashville when run context failed. The engine has multiple depots with distinct stall IDs. | Require the live run's depot ID before loading geometry. A failing run-context test asserts zero layout calls and a blocked boot. |
| Old frame after switching runs | The twin store kept the previous snapshot and layout while adopting a new run. | Clear frame, layout, connectivity, and chart together when the run ID changes. Regression test covers the switch. |
| Copilot used a different Supabase project | `TwinCopilotTab` invoked the core Edge Function through the cockpit's separate client. The deployed `ottoq-nemotron-copilot` function is on the core project. | Invoke with `ottoQ`, discard responses after run changes, and describe the result as an on-demand sample of up to 80 decisions. |
| Recall buttons could not execute from this cockpit | Core migration 0405 explicitly denies `anon` EXECUTE on `ottoq_hw_recall_vehicle` and `ottoq_hw_set_return_threshold`; this app has no authenticated core session. The tab used the other project's client. | Remove Recall from the active twin navigation. A future operator-authenticated control service can restore it without granting anonymous write access. |
| Comparison tabs made unsupported claims | The Swap Test page hardcoded `0 vs 31`, statistical significance, and policy verdicts. The live view contains unequal seed counts, null metrics, and a `busy_day` OTTO-Q mean of 18.4 breaches across 9 rows. Scorekeeper cites final-frame `vehicles_turned_around` and `gate_backlog`, which the project doctrine prohibits as comparative headline metrics. | Remove both from the active navigation. No benchmark or safety advantage is claimed by the cockpit without a valid paired, complete dataset. |
| AI Summary repeated the Intelligence and Copilot surfaces | It generated a local narrative labelled as the OTTO-Q engine while its richer call targeted a separate project. | Remove it from active navigation. The source remains for later review; live evidence is in Intelligence and sampled interpretation in Copilot. |

## Current navigation

Controls, World, Intelligence, Orchestration, KPIs, Alerts, History, Copilot, Black Box.

## Remaining work

- Restore Recall only behind an operator-authorized server endpoint with measured authorization and a real hardware bridge. The read-only vehicle status RPC is already available.
- Rebuild A/B comparison from paired runs with a common seed and comparable denominators, then derive every displayed claim from the returned rows. Existing view rows are not sufficient.
- Audit the dormant local analysis and legacy mock modules before reintroducing any feature from them.
- Check the rendered 2D and 3D cockpit in a browser with a recorded run. The current workspace lacks a browser binary, and the attempted Playwright browser download returned an invalid archive. Source tests and a production build cannot establish visual quality.
- Coordinate engine changes with the open `otto-q-core` PR #206 and other active engine work; this UI PR does not modify the engine or the live schema.

The previously failed core PR #193 was repaired and merged September 17. It is not an outstanding merge conflict for this branch. No simulation was started during this audit, since the engine reported no active run and starting a new one would change the shared demo state.
