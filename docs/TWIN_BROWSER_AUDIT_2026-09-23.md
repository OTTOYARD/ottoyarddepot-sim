# Live browser audit, 2026-09-23

Tested `https://ottoyarddepot-sim.lovable.app/` after PR #108 merged. A Normal Day run (`73f9cf55-89f1-4fa6-9efc-61003df71b38`) advanced to 179 ticks, then Stop recorded the run and reset the depot. The 2D map, World channel diagnostics, Intelligence layers and decision stream, Orchestration, KPIs, Alerts, History, Copilot, and Black Box were inspected in the browser. RTX was excluded at the founder's direction.

| Observation | Evidence | Change in this PR |
| --- | --- | --- |
| 3D selection blanked the entire cockpit in a browser without WebGL. | The browser logged `Error creating WebGL context`; the rendered page was black. | A scene error boundary keeps the cockpit alive, reports that 3D is unavailable, and offers Return to 2D. |
| The header read 13:05 while the map clock read 08:05. | Both described the same sim instant: header UTC, depot time America/Chicago. | Add explicit UTC and CT labels. Clarify that the header's `Staged` count means awaiting service, distinct from readiness to depart. |
| Reloading an actively advancing run displayed `Resume`. | The backend was still `running` and tick count advanced from 20 to 24 while the local control said Resume. | Adopt status and speed from the active run's snapshot without issuing a second transport call. |
| At tick 0, energy and price values absent from the snapshot rendered as zero in KPIs. | Header correctly displayed unavailable LMP and solar while KPIs reported `$0/MWh`, `0.0kW` solar, and `0kW` grid import. | Render unavailable for absent grid import/export, solar, and LMP measurements. A real numeric zero still renders as zero. |
| Copilot failed with a generic non-2xx error. | The core project's function log recorded HTTP 502 for the audit call. The function is deployed on that project; the model call failed downstream. | Read the function's structured error response and preserve its measured decision summary when present. Do not present model analysis as successful. |

The initial Intelligence stream displayed zero immediately after selecting its tab; it populated from `ottoq_activity_feed` shortly afterward. The live source had 200 feed rows and 365 decisions while the run advanced. This was a loading delay, not a missing publisher.

## Validation boundary

The live browser validated the merged baseline and revealed these defects. The fixes are on a new branch and were validated by focused regression tests, typecheck, full Vitest suite, and production build. The cloud browser lacks WebGL, so it cannot certify 3D placement or motion even on an accessible site. The new recovery UI needs a deployed preview or merge to verify visually in the browser. The Copilot's NVIDIA call remains HTTP 502 until its provider or function issue is resolved; this PR improves the honest failure state and keeps measured summary data visible when supplied by the function.
