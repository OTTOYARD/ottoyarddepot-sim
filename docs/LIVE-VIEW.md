# The live view: the twin's 3D depot, on its own

Chase, 2026-10-02:

> "replacing the map sections in the orchestra and pulse UI's, with a direct snapshot that could be spun around of the
> live depot from either various corners of the depot or along middle section pole ... It could be blank or just show
> empty just as the twin UI does before a simulation has started. Then when a simulation has started it loads similarly
> and then you can see the vehicles moving around in action ... mirrored from the actual twin 3-D rendering."

The live view is this app's own 3D depot (`DepotScene3D`), with the same motion driver (`TwinMotionDriver`) and the
same snapshots (`ottoq_twin_snapshot`, through the control edge function). It runs as its own page, without the cockpit
around it. OrchestrAV and OTTO-PULSE frame it at the top of their Overview tabs. What it draws is what the twin draws,
because it is the twin's code drawing it.

## Where it lives

| | |
|---|---|
| Page | `view.html`, the second entry in `vite.config.ts`. It loads ~11 kB of its own plus the shared `three` and `vendor` chunks, and none of the cockpit (`main-*.js`, ~600 kB). |
| Short form | `/view` redirects to `/view.html`, keeping the query (`src/main.tsx`). Hosting serves `index.html` for unknown paths, so the redirect runs there. |
| Code | `src/viewer/`: `DepotViewer.tsx` (the page), `useViewerFeed.ts` (reads), `protocol.ts` (URL and messages), `viewerCams.ts` (cameras), `main.tsx` (entry). |
| Service worker | None. The page registers none, and `public/sw.js` never caches it as the app shell. |

## URL

```
https://ottoyarddepot-sim.lovable.app/view.html?run=<sim_run_id>&cam=<cam>&spin=0|1&embed=1
```

| param | meaning |
|---|---|
| `run` | Pin the view to one run. Without it, the view follows the live run at the twin depot, the way the twin finds it (newest running, active or paused). With no live run it shows the empty depot, as the twin does before a run starts. |
| `cam` | The opening camera: `se` (default), `sw`, `ne`, `nw`, `pole`, `top`. |
| `spin` | `1` (default) turns the view slowly until someone takes hold of it; `0` holds it still. |
| `embed` | `1` when a cockpit frames it: the view drops its own link back to the twin and posts its state to the frame. |

A pinned run is checked once. A run that does not exist, or ran at a depot other than the twin depot
(`11111111-…`, CLAUDE.md rule 8), is named and not drawn.

## Cameras

| id | shot |
|---|---|
| `se`, `sw`, `ne`, `nw` | From just outside each corner of the fenced lot, at about a light pole's height, looking across the site. Orbit, zoom and pan. |
| `pole` | From a mast at the middle of the lot. The camera turns on the mast: its target sits one unit in front of the lens, so a drag or the spin looks around the depot instead of circling the mast. No zoom or pan. |
| `top` | Straight down, north up: the whole lot. |

Every camera can be dragged (one finger orbits, two pinch, twist and pan, as in the twin). Tapping a car follows it.
From a corner or overhead the camera rides with the car, as in the twin. From the pole it stays on its mast and turns
to keep the car in view; a drag or a second finger hands the camera back. (Riding from the mast carried the lens down to
within a unit of the car, with no zoom or pan to get back: `src/components/canvas/three/followMath.ts`.) The chip names
the car by its fleet id, or, for a car the fleet API never named, by operator and the end of its id. Tuned against
screenshots of the empty depot and of a recorded run (`scripts/viewerShots.mjs`).

## Messages

Both directions are plain objects with `source` naming the sender. Nothing in either is secret: the view is a read-only
picture, and every command changes only what it shows.

**View to frame** (`source: "otto-twin-view"`):

| type | when |
|---|---|
| `ready` | The view mounted and can draw. |
| `webgl_unavailable` | The browser cannot draw 3D. The frame should offer its own fallback. |
| `state` | Whenever what it shows changes. `state.kind` is `connecting`, `no_run`, `live` (with `runId`, `status`, `simClock`, `cars` on site), `ended`, `not_found`, `other_depot` or `offline`. |

Until the frame speaks, the view posts to `*`. After that, it answers the frame's origin only.

**Frame to view** (`source: "otto-cockpit"`). Accepted only from the view's own parent window, and only from a trusted
origin: `*.lovable.app`, `*.lovableproject.com`, `localhost` and `127.0.0.1`, plus any origin in
`VITE_VIEW_PARENT_ORIGINS` (comma-separated). Anything else is dropped.

| type | effect |
|---|---|
| `visibility` `{ visible }` | `false` stops drawing (the scene's frame loop goes to `never`) and slows reads to every 15 s. `true` resumes and reads at once. Cockpits send it from an `IntersectionObserver` on the frame. |
| `run` `{ runId \| null }` | Pin another run, or follow the live run, without reloading. |
| `camera` `{ cam }` | Frame one of the cameras above. |

## Cost

The view reads only what it draws: the run list (follow mode, every 4 s), the run's context (once), and its snapshot
every 1.5 s while live and visible. While hidden or ended it reads every 15 s. The cockpit's own feed also pulls four
run-to-date aggregates and packs the OTTO-Q channel bundle each frame; the view does neither. Rendering is capped at a
device pixel ratio of 1.5, uses the twin's quality governor, and stops entirely when the view is hidden: a hidden tab,
or a frame that has scrolled out of view.

## Read-only

The page calls `twin.runs`, `twin.runContext`, `twin.snapshot` and `twin.layout`, all reads. It has no control that
starts, stops, pauses or changes a run. Its tests (`src/viewer/*.test.ts*`) stub the API and assert nothing else is
called.
