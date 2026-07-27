# OTTO-Q World Contract — audit and build plan

**Audited:** 2026-07-27 · **Scope:** `ottoyarddepot-sim` (cockpit + client engine) and
`otto-q-core` (Supabase project `gxdrcyphqjzjsuhxuqtg`, 160 tables, 118 sim/twin functions).

This document answers one question — *does a new simulation run load the complete world,
and does that world reach OTTO-Q in a form it can orchestrate on?* — and then lists what to
build. Every claim below is backed by a query against the live backend or a file in this repo.

---

## 1. Verdict

**No.** Three separate things are true, and all three matter:

1. **The world does not "load" at run start.** There is no boot phase. Variables are dealt
   lazily, on first touch, over the life of the run.
2. **Most of the registered world is never dealt at all.** 10 of 47 registered variables
   were sampled in the most recent 233-tick run. The other 37 never produced a value.
3. **The rich world that *does* exist is fed to the renderer, not to OTTO-Q.** The
   orchestrator reads a narrower frame than the 3D scene does.

The architecture you described — load the world model, bundle it into channels, hand those
to OTTO-Q — is the right one. It is not what is running today.

---

## 2. Evidence

### 2.1 There is no boot draw

`ottoq_twin_boot_manifest()` returns `payload->'boot_draw'`. Across **every run in the
table**, `payload ? 'boot_draw'` is `false`. The manifest reads a key nothing writes.

Variables are dealt by `ottoq_twin_deal()`, which is a **lazy, memoized card dealer**: on
first request for `(var_key, scope_instance, bucket)` it draws a card and caches it. Nothing
calls it at t=0. A variable no code path touches is never drawn, and its absence is
indistinguishable from a neutral value.

### 2.2 37 of 47 registered variables produced nothing

Newest run `6256a99f` — 233 ticks, 15,330 telemetry packets, 2,805 decisions:

| Dealt (10) | Never dealt (37) |
|---|---|
| `detail_time`, `maintenance_time`, `eta_delay`, `wash_time`, `charger_fault`, `cloud_cover_pct`, `wind_speed_kmh`, `grid_demand_mw`, `ambient_temp_c`, `precip_mm` | all 8 `vehicle` vars · all 5 staffing vars · `arrival` · `soc_on_arrival` · `target_soc` · `trip_duration` · `idle_fraction` · `oem_mix_tesla` · `lmp_usd_mwh` · `dr_ignition` · `brownout_rate` · `freq_excursion_rate` · `carbon_intensity` · `humidity_pct` · `precip_rate` · `solar_soiling` · `charge_time` · `queue_patience` · `scheduling_algorithm` · `dtc` · `incident` · `incident_severity` · `telemetry_dropout` · `soh_spread` · `breakdown_rate` |

Every one of those 47 rows has `wired = true`. `OperatorConsole.tsx:460` renders
`wiredCount / catalog.length`, so the console tells the operator **"47/47 live"** while 37
of them are inert. That is the single most misleading number in the product — it is what an
OEM or investor will read off the screen.

### 2.3 The real-world corpus is loaded and mostly unused

`ottoq_calibration_distributions` holds **41 fitted distributions over 18 variables** from
9 datasets — NYC TLC (3.5M trips), NREL fleet, ACN charging, CA DMV AV disengagements,
EIA grid, NOAA/GHCN weather, charger reliability.

`ottoq_twin_deal` resolves them via `ottoq_sample_calibrated(var_key, …)`, matching
`ottoq_calibration_distributions.variable_name = var_key`. **The names do not match**, so
the join misses:

| Catalog `var_key` | Corpus `variable_name` | Samples | Currently |
|---|---|---|---|
| `trip_duration` | `trip_duration_minutes` | 3,503,651 | **uniform noise** |
| `charge_time` | `charge_duration_minutes` | 3,985 | **uniform noise** |
| `idle_fraction` | `idle_fraction_per_shift` | 10,000 | **uniform noise** |
| `incident` | `collisions_per_million_miles`, `miles_per_disengagement` | 10,000 / 19,941 | **uniform noise** |
| `charger_fault` | `session_success_rate`, `days_between_faults`, `repair_days` | ~10,000 each | **uniform noise** |
| `precip_mm` | `precip_wet_mm` (12 monthly segments) | ~3,700 | falls back to a 361-sample global |

When `ottoq_sample_calibrated` returns NULL, `ottoq_twin_deal` falls back to
`min + U(0,1) × (max − min)` — a **uniform draw between catalog bounds**. That is not Monte
Carlo over real-world distributions; it is a flat random number wearing the corpus's name.
Only `ambient_temp_c` (13 monthly segments), `wind_speed_kmh` and `grid_demand_mw` actually
resolve to fitted data.

### 2.4 The catalog is not the authoritative registry

Two `var_key`s hold dealt cards but do not exist in `ottoq_variability_catalog`:
`lmp_day_regime`, `charger_mtbf_days`. The registry the UI renders from is not the registry
the engine samples from.

### 2.5 The feed-agent layer has never run

`ottoq-feed-agents` (Nemotron 3 Ultra, per-variable sampling-plan review) is invoked
fire-and-forget from `startScenario`. **`ottoq_feed_activations` contains 0 rows, all-time.**
Six `ottoq_feed_plans` are active but the edge function's `WHITELIST` covers only two
(`charger_fault_repair`, `tariff_demand_charge`) — the other four are un-adjustable by
construction. Separately, `ottoq_start_demo_run` (the path the cockpit actually uses, via
`blackbox.ts:64`) does **not** invoke the feed agents at all; only
`otto-twin-control/scenarios/start` does, and the cockpit does not call it.

### 2.6 OTTO-Q sees less of the world than the renderer does

Two frames exist. They are not the same size.

| | `ottoq_twin_snapshot` → renderer | `ottoq_build_decision_frame` → OTTO-Q |
|---|---|---|
| run / clock / tick | ✅ | ✅ |
| itinerary legs (motion contract) | ✅ | ❌ |
| fleet + SoC | ✅ | ✅ (+ target_soc, inlet_kw) |
| stalls | ✅ | ✅ |
| charge sessions | counters only | ✅ |
| energy (10 fields) | ✅ | 6 fields |
| BESS | ✅ | ✅ |
| **weather** | ✅ | ❌ |
| **grid / LMP / carbon / voltage / freq** | ✅ | ❌ |
| **DR call state + cap** | ✅ | ❌ |
| **tariff window** | ✅ | ❌ |
| **incidents** | ✅ | ❌ |
| events | ✅ | ❌ |
| variability profile | ✅ | ❌ |

And the in-database decision loop is narrower still. Table references inside
`ottoq_decide_tick` (27KB of PL/pgSQL):

```
vehicles(15) ottoq_decisions(13) stalls(8) ottoq_visit_needs(7)
ottoq_external_proposals(3) ottoq_sim_runs(2)
ottoq_grid_snapshots(1) ottoq_bess_units(1) ottoq_ocpp_chargers(1)
ottoq_sim_scenarios(1) ottoq_ops_approvals(1)
```

Zero references to: `ottoq_weather_snapshots`, `ottoq_telemetry_packets`,
`site_energy_snapshots`, `ottoq_dr_calls`, `ottoq_depot_tariffs`, `ottoq_tariff_windows`,
`ottoq_vehicle_wear`, `ottoq_vehicle_incidents`, `charger_health_scores`,
`ottoq_depot_staffing`, `ottoq_solar_output`.

**OTTO-Q is orchestrating a depot without seeing the weather, the tariff, the demand-response
call, the telemetry stream, or the wear state of the assets it is scheduling.**

### 2.7 `ottoq_build_decision_frame` is keyed on depot, not run

Its signature is `(p_depot_id uuid)`. It reads the live `vehicles`/`stalls` tables with no
`sim_run_id` filter. So the OTTO-Q frame is **not run-scoped**: it cannot be replayed from a
Black Box bundle, and two runs against one depot cannot be A/B'd on identical frames. Only
three functions call it (`ottoq_api_twin_get_state`, `ottoq_capture_decision_snapshot`,
`ottoq_score_run`) — the production decision path bypasses the "contract" entirely.

### 2.8 The client-side simulator is a second, disconnected world

`src/engine/SimulationEngine.ts` is a complete parallel sim — its own arrivals, stalls,
KPIs, cuOpt calls — driven by `Math.random()` with **no seed** (`ArrivalGenerator.ts:12-14`).
It is unseeded, therefore unreproducible, therefore not usable for validation. It shares no
types, no variables and no scenarios with the backend twin. `twinStore.offlineDemo` exists
to switch between them.

Two engines called "the simulation" is a liability in an OEM conversation. One of them
should become the authority and the other should become explicitly a demo fallback.

### 2.9 Smaller findings

- **The render contract is published and ignored.** `ottoq_twin_snapshot` emits `legs` — a
  full timed-leg motion contract with `legs_meta.median_deviation_s` for coverage
  measurement. `TwinSnapshot` in `ottoTwin.ts` does not even declare the field, and nothing
  in `src/` reads it; `TwinMotionDriver` invents motion instead. The server is measuring
  coverage of a contract the client never accepted.
- **Pre-existing type error.** `OperatorConsole.tsx:306` reads `live.scenario_code` off a
  `TwinRunSummary`, which has `scenario`. The auto-attach toast shows `undefined`.
  (`tsc --noEmit` flags it; the Vite build does not typecheck, so it ships.)
- **The control API is fully open.** `otto-twin-control/index.ts:449-456` disables the
  mutation auth gate — anyone with the URL can start, stop, or inject faults into a run.
  Documented as a deliberate demo posture; must close before OEM exposure.

---

## 3. What was built in this change

A channel contract layer in `src/lib/ottoq/`, with a hard readiness gate. It does not fix
the backend — it makes the backend's actual state **measurable and visible**, which is the
prerequisite for fixing it.

| File | What it does |
|---|---|
| `contracts.ts` | Versioned envelopes for the five channels: `fleet_telemetry`, `energy_grid`, `depot_ops`, `charger_systems`, `environment`. Every packet carries run identity, tick, sim-clock staleness, provenance, and an integrity record naming the fields that did **not** resolve. Nothing is defaulted. |
| `channels.ts` | Pure packer: `TwinSnapshot` + `TwinLayout` → five packets. Reconstructs full stall inventory from the layout (the status feed only carries non-available stalls) and flags inferred availability. Computes a site power-balance residual so an unbalanced energy model is loud instead of plausible. |
| `worldBoot.ts` | The level loader. Loads geometry, registry, scenarios, first frame and variability profile; grades every channel; emits a serializable `WorldBootReport` with `ready`, `blocked_by`, per-stage timing. A failed stage is reported, not thrown. Does not start or tick the run. |
| `coverage.ts` | Binds all 47 catalog variables to the channel field that would move if the knob moved, and grades each **observed / dark / unobservable** against a live frame. This is the honest replacement for "47/47 live". |
| `../../store/worldStore.ts` | Boot record + latest packed frame, separate from `twinStore` so the renderer can keep drawing a degraded world while OTTO-Q refuses to orchestrate one. |
| `../../hooks/useWorldBoot.ts` | Runs the boot once per adopted run. |
| `useTwinFeed.ts` (edited) | Packs every polled frame into the bundle, so renderer and orchestrator can never disagree about which tick they are on. |

38 tests, all passing (`npx vitest run src/lib/ottoq`). Full suite: 85/85.

**Today the gate correctly reports `ready: false`** on a fully-populated frame, because
`depot_ops.service_timers` and `charger_systems.ocpp` have no source. That is the gate
working. It goes green when §4.1 and §4.2 land.

---

## 4. Build backlog — ordered by leverage

### P0 — the world must load, and OTTO-Q must see it

**4.1 Feed service timing into `depot_ops`.** *(unblocks 5 catalog variables)*
`charge_time`, `wash_time`, `detail_time`, `maintenance_time` are dealt every visit and
reach nothing. The twin knows service start and expected end — `ottoq_itinerary_legs` has
`planned_start_sim`/`planned_end_sim`/`planned_duration_s` per leg. Add a `service_timers`
array to `ottoq_twin_snapshot` (and to the decision frame) built from the open dwell legs.
`DepotOpsPayload.service_timers` is already typed and waiting.

**4.2 Publish OCPP charger health.** *(unblocks the charger channel)*
`ottoq_ocpp_chargers` (21 cols: `station_state`, error codes, heartbeat) and
`charger_health_scores` exist and are on no frame. `ChargerSystemsPayload.ocpp` is typed and
empty. Without it, a faulted charger is indistinguishable from an idle one.

**4.3 Widen `ottoq_build_decision_frame` to the five channels, and key it on `sim_run_id`.**
This is the highest-leverage backend change in the list. Proposed SQL:
`supabase/proposed/001_decision_frame_channels.sql`. Adds weather, grid/LMP/carbon, DR call
+ cap, tariff window, incidents, wear and staffing; scopes to the run so frames are
replayable and A/B-able.

**4.4 Make `ottoq_decide_tick` actually read the new channels.** (4.3 without this is a
contract nobody consumes — exactly the trap `build_decision_frame` is in today.) Start with
the three with the clearest objective value: tariff window → charge scheduling; DR cap →
load shedding; charger health → assignment eligibility.

### P1 — make the Monte Carlo real

**4.5 Map catalog variables to corpus distributions.** *(3.5M NYC TLC trips, 10k NREL shifts,
~20k CA DMV records currently unused)* Add `ottoq_variability_catalog.corpus_variable` +
`corpus_segment_expr`, populate the mappings in §2.3, and have `ottoq_twin_deal` resolve
through it. Proposed SQL: `supabase/proposed/002_corpus_variable_mapping.sql`.

**4.6 Fail loudly on an uncalibrated draw.** `ottoq_twin_deal`'s silent uniform fallback is
why §2.3 went unnoticed. Log every fallback to a `ottoq_calibration_gaps` table; surface the
count on the boot report. A variable falling back to uniform should be a visible defect.

**4.7 Implement the boot draw.** Write a real `payload.boot_draw` at run start: deal every
`lifespan IN ('run','day')` card up front, record the drawn values, and let
`ottoq_twin_boot_manifest` return something. This is what makes a run reproducible from its
manifest and is the literal "world loads first" requirement.

**4.8 Deal the 37 dark variables — or mark them unwired.** Every one is either (a) not
requested by any engine path, or (b) requested under a different key. Both are bugs. If a
variable will not be wired this quarter, set `wired = false` so the console stops claiming
it. **Reconcile `ottoq_variability_catalog` with the card table** (§2.4) so one registry is
authoritative.

**4.9 Repair the feed-agent layer.** Either invoke `ottoq-feed-agents` from
`ottoq_start_demo_run` (the path the cockpit uses) or drop the claim. Extend `WHITELIST` to
the four uncovered plans. Zero activations in the table means the self-calibration loop has
never closed.

### P2 — one world, one clock

**4.10 Decide the authority between the two engines** (§2.8). Recommendation: backend twin
is the product; `SimulationEngine` becomes an explicitly-labelled offline demo. At minimum,
seed it (`ArrivalGenerator` needs the run seed) so it is reproducible.

**4.11 Consume the render contract** (§2.9). Add `legs`/`legs_meta` to `TwinSnapshot`, drive
`TwinMotionDriver` from them, and close the coverage ratio the server is already computing.

**4.12 Surface the boot report in the cockpit.** `worldStore.phase` is populated and nothing
renders it. A world-load panel — per-channel status, coverage headline, blockers — is a
strong demo artifact: it shows an OEM you *measure* your twin's completeness.

**4.13 Attach the boot report to the Black Box bundle.** A run whose forensic download
includes its own load manifest and channel-integrity record is auditable. That is the V1
validation story.

### P3 — before external exposure

**4.14 Close the control-API auth gate** (§2.9) — the hardening TODO at
`otto-twin-control/index.ts:452`.

**4.15 Fix `OperatorConsole.tsx:306`** (`scenario_code` → `scenario`).

---

## 5. Open questions

1. **Where does OTTO-Q V1 actually run?** `ottoq_decide_tick` (in-database) and the
   `ottoq-cuopt-propose` external-proposal seam are two different orchestrators. Which one
   is "OTTO-Q V1" for the OEM narrative? The channel contract should point at that one.
2. **Should the channel bundle be pushed or pulled?** This change packs client-side from the
   existing snapshot poll — zero backend risk, works today. The durable answer is a backend
   `ottoq_api_twin_channels(sim_run_id)` RPC returning the same five envelopes, so any
   consumer (cockpit, cuOpt seam, an OEM integration) gets identical bytes. Say the word and
   I will write it against the `contracts.ts` shapes.
3. **Is `ready: false` allowed to block Start?** Right now the gate reports; it does not
   enforce. Enforcing is a one-line change once §4.1/§4.2 land.
4. **Which OEM telemetry schema should `fleet_telemetry` mirror?** If there is a target
   (Waymo/Zoox webhook shape, or an internal AV API), the channel should be shaped to it now
   rather than translated later. `ottoq_oem_webhook_patterns` suggests one may already exist.

---

## 6. Reproducing this audit

```sql
-- no boot draw, ever
select count(*) filter (where payload ? 'boot_draw'), count(*) from ottoq_sim_runs;

-- variables dealt in the newest run vs. the registry
with n as (select sim_run_id from ottoq_sim_runs order by started_at desc nulls last limit 1)
select c.var_key, c.wired,
       (select count(*) from ottoq_variability_cards v, n
         where v.sim_run_id = n.sim_run_id and v.var_key = c.var_key) as cards
from ottoq_variability_catalog c order by cards desc;

-- corpus variables that no catalog var_key resolves to
select distinct d.variable_name from ottoq_calibration_distributions d
where not exists (select 1 from ottoq_variability_catalog c where c.var_key = d.variable_name);

-- the feed-agent layer has never activated
select count(*) from ottoq_feed_activations;

-- what the OTTO-Q decision loop actually reads
select prosrc from pg_proc where proname = 'ottoq_decide_tick';
```
