# AGENTS.md — ottoyarddepot-sim (OTTO-TWIN)

**This repo is OTTO-TWIN's cockpit and renderer** — the digital twin of an OTTOYARD depot, plus the
operator console that starts and stops simulation runs.

## What the twin is for

It is not a demo animation. It is a **world generator** whose job is to manufacture maximally real,
maximally *random* conditions so that OTTO-Q can be proven to handle them. The founder's framing:
**almost a video game — a 4K, hyper-realistic world model.** The realism is the *proof surface* for
the intelligence layer. If a viewer can watch a vehicle arrive, take an assigned lane, pull into a
specific stall, dwell for a physically sensible time, and leave — and every movement traces back to a
decision OTTO-Q made and can justify — the intelligence is **visible, not asserted.**

**The swap test is the pitch:** unplug the twin, plug in a real depot's telemetry, and OTTO-Q cannot
tell the difference. **If you build a code path that only works because this is a simulation, you
have broken the pitch.**

## The clean split

The twin owns **discrete truth** (which stall, which state, what time). The renderer owns **only
interpolation.** Zero world logic client-side.

## Landmines specific to this repo

- **1 plan unit = 0.4785 m = 1.57 ft.** `src/lib/sitePlan.ts` is drawn to real dimensions and the 3D
  frame is **1:1 with plan units, no scale factor**. ⚠️ A *different* yardstick (1.5699 ft/unit)
  exists in the site-plan export — mixing them caused a 1.57× outage.
- **The lane network is founder-locked.** Charging lanes stay **all northbound**; perimeter avenues
  stay **two-way divided**; gates stay **enter east / exit west**. Chase chose all three explicitly.
  Do not "improve" them.
- **Lane paint is generated from the LaneGraph, never hand-drawn** — so painted right-of-way can
  never drift from routed motion. Both renderers once carried hand-drawn arrows that *contradicted
  the actual rules*. Do not reintroduce them.
- **Measure oriented body overlap** (the 4.2 × 10.2 box actually drawn), **never centre distance** —
  perimeter stalls are pitched 5.7u apart, so a distance test flags every pair of parked neighbours
  and once reported **31 phantom collisions**.
- **Sample during motion, not after the scene settles.** And **replay the captured fixture**
  (`src/engine/__fixtures__/twinRun.busyday.json` + `replay.ts`), not a live run — these bugs are
  intermittent and a frozen recording makes a fix falsifiable.
- **Measured worse, do not re-propose:** routing cars onto the parking access aisle before departing
  (305 → **728** overlap samples) · correcting the parked heading (305 → **378**) · enabling
  `separationSteer` (its radius 5.5 exceeds the 4.8u opposing-lane separation — **it would
  manufacture the head-on swerve**).
- **Keep Yuka's `SeparationBehavior.weight` low (0.35).** At 2.2 it was *stronger* than
  path-following and shoved cars sideways off the lanes.
- **Known open:** the 3D car uses `BoxGeometry(2.2, 0.85, 4.9)` — **metres dropped into unit-space**,
  so it renders at ~48%. Three different car lengths coexist (2D 10.2u, 3D 4.9m, physics
  `CAR_LENGTH = 9`). ⚠️ Changing `rightOffset` or `CAR_LENGTH` moves routed motion and needs a
  certified pass, not a drive-by edit.
- **`ResponsiveGuard` requires ≥1200px.** Test at 1440×900 or larger.
- **The RTX tab needs the AWS Isaac box running.** Blank is normal when it is stopped. IP override:
  `localStorage.setItem('ottoq_omniverse_ip','<ip>')`.

## Verify before you PR

```bash
npm run verify        # typecheck && vitest run && vite build
npm run layout:verify # if you touched geometry — rebuilds the seed and asserts no diff
```

⚠️ **This repo is Lovable-synced with two-way sync on `main`.** Chase's edits in Lovable commit
straight to `main` (as `gpt-engineer-app[bot]`), and merging your PR is picked up by Lovable
automatically. Fetch before you push.
---

## The full context lives elsewhere

**Read this first, before any substantive work:**

```bash
git clone https://github.com/OTTOYARD/ottoyard-agent-context.git
```

That repository is the shared brain for agents on this project: architecture, the founder's binding
doctrine, the known-issues register, a ranked backlog, hard-won lessons, and a verbatim copy of the
79 memory files Claude Code accumulated while building this system. Start with its `README.md` and
`docs/16_FIRST_SESSION_RUNBOOK.md`.

## Rules that apply in every OTTOYARD repo

**⚖️ The law.** *OTTO-Q decides. OTTO-TWIN executes and owns world state. The renderer only draws.*
Decision-layer code that mutates world state is a defect on sight. Renderer code containing world
logic is a defect on sight.

**Branch, verify, PR. Never merge.** Chase Ballenger (founder) is the only one who merges. Branch as
`hermes/<slug>` or `claude/<slug>`, prove it works yourself, then open a PR whose description carries
**the evidence** — real numbers, real row counts, real screenshots — plus what you did *not* verify
and what could break. Half-done labelled half-done is fine; half-done labelled done is not.

**🚨 `git fetch origin` before you reason about anything.** The clones on the founder's Desktop have
been up to **77 commits behind**. Compare against `origin/main`, never local `main`. A branch still
existing is not evidence it is unmerged — check
`git rev-list --count origin/main..origin/<branch>` (0 means merged).

**Two identity traps.** `OTTOYARD` on GitHub is a **personal account, not an organization**
(`/orgs/OTTOYARD/...` returns 404 — use `/user/repos`). And GitHub **rejects pushes authored as
`chase@ottoyard.com`** — commit as a noreply identity.

**The one database that matters is `gxdrcyphqjzjsuhxuqtg`.** ⚠️ **Every `supabase/config.toml` in
every OTTOYARD repo points somewhere else** — at dead refs (`hfjaofyfxsyniohdfacg`,
`odhpbdhnpcrjeaxvbrzd`), at OrchestrAV's legacy database (`ycsisvozzgmisboumfqc`), or at a
placeholder. The real ref is hardcoded in client code instead. **Pass
`--project-ref gxdrcyphqjzjsuhxuqtg` explicitly to any Supabase CLI command that writes.**

**Never disable pg_cron job 12** (`ottoq-demo-metronome`). It **is** the simulation run engine.
Disabling it stops every run while everything still looks green.

**Honesty about numbers is a hard requirement here.** Always state your denominator. Never quote
`vehicles_turned_around`, `fleet_ready_pct`, or `gate_backlog` — they are final-frame instantaneous
counts that structurally penalise OTTO-Q. Interrogate the baseline before believing a win: it has
been invalid twice, both times in our favour. Read
`ottoyard-agent-context/memory/reference_ottoq_real_edge.md` before quoting any comparative figure.
