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

## 3b. The outbound path — one funnel, one wire

The audit above is about what flows *into* OTTO-Q. This section is the other
half: what flows *out*, and how.

### The doctrine

**OTTO-Q orchestrates. It never actuates.**

It says *"vehicle AV-14 is assigned stall D-07, arrive between 14:10 and 14:25."*
It does not say where the car is, how fast to drive, or which path to take — the
twin's motion system owns all of that, exactly as a real AV's autonomy stack
would. Same for energy: OTTO-Q says *"discharge starting in 20 minutes, demand is
peaking"* and the site energy controller decides ramp rate and converter
setpoints.

This is enforced, not just documented. `FORBIDDEN_ACTUATION_KEYS` lists the field
names that would turn a directive into an actuation (`waypoint`, `heading`,
`speed_kmh`, `setpoint_kw`, `contactor`, …), and the shield scans every command
recursively before it can be issued. A command carrying one is rejected with
rule `no_actuation`.

### The funnel

```
   L3  ADVISORS   cuOpt · Nemotron · deterministic heuristics
                  each PROPOSES; none can emit a command
        ↓
   L2  ARBITER    merges every proposal into ONE plan; resolves contention,
                  ranks, materializes envelopes with a chain of custody
        ↓
   L1  SHIELD     Simplex-style gate. Admits or REMOVES. Cannot create
                  or modify a command — that is the whole guarantee.
        ↓
   L0  COMMS      one batch, one sequence space, one ledger
        ↓
                  the twin executes
```

Nothing bypasses this. There is exactly one place a command can be born, one
place it can be vetoed, and one sequence number space — so "what did OTTO-Q tell
that vehicle, and did it comply" is always answerable from a single record.

### Wire realism

Each command class is shaped after the protocol its real-world counterpart
speaks, so the twin rehearses a real integration rather than a bespoke one:

| Class | Modeled on |
|---|---|
| `vehicle.orchestration` | fleet dispatch API — JSON envelope, idempotency key, issued/expires window, async ack then terminal status |
| `energy.orchestration` | **OpenADR 2.0b** event semantics — event id, signal, interval. What a utility or EMS already speaks |
| `charger.orchestration` | **OCPP 2.0.1** smart charging — a *profile* (a ceiling over a period), never an instantaneous setpoint |
| `depot.orchestration` | work-order semantics against an ops queue |

### The three sentences, in code

`advisors.ts → energyAdvisor()` is the reference implementation and emits exactly
what was asked for:

| Situation | Command | Reason code |
|---|---|---|
| "grid price is low" | `charge_bess` | `price_low` |
| "expensive and demand is high" | `discharge_bess` | `price_high` / `peak_demand` |
| "demand is really high — discharge in 20 min" | `discharge_bess`, `start_offset_s: 1200` | `peak_demand` |

Precedence is itself the policy: an active DR call outranks price (compliance
first), a depleted reserve outranks price (you cannot answer a DR call with an
empty battery), and only then does arbitrage apply.

### What the shield actually stops

Twelve rules, each a named predicate with a reason. The ones that matter most:

- `stale_world` — refuses the **entire batch** when the input bundle is
  `not_ready`. This is the join with the inbound half: the boot gate measures
  whether OTTO-Q can see the world, and the shield refuses to let it act when it
  cannot.
- `no_actuation` — the doctrine check above.
- `respects_dr_cap` — will not charge the battery *from the grid* during a
  demand-response call (charging from solar surplus is allowed).
- `bess_soc_bounds` — no discharge below the floor, no charge above the ceiling.
- `stall_exists_and_is_free` — no double-booking, within a batch or against the world.
- `target_not_saturated` — one open command per target; stops command thrash.
- `ceiling_within_rating` — no charger ceiling above the hardware rating.

Every suppression is reported with its rule and detail. "Why didn't OTTO-Q assign
that stall?" always has an answer.

### Files

| File | Role |
|---|---|
| `commands.ts` | outbound contract — envelopes, intents, lifecycle, actuation blacklist |
| `advisors.ts` | L3 — energy policy, charge assignment, charger health, plus the adapter that plugs cuOpt/Nemotron in as peers |
| `pipeline.ts` | L2 arbiter + the full L3→L0 pass |
| `shield.ts` | L1 |
| `commandBus.ts` | L0 — ledger, sequencing, idempotency, ack/outcome tracking, and the twin executor |
| `../../hooks/useOrchestration.ts` | runs one pass per tick |
| `../../store/orchestrationStore.ts` | the decision trace |

49 tests cover this path. Determinism is tested directly: the same world frame
produces byte-identical command ids regardless of the order advisors reply in.

### The subscribers — the loop is closed

Two executors are now wired, so a command changes the world instead of being
politely refused.

**Motion** (`executors.motionSubscriber` → `TwinMotionDriver`). OTTO-Q names a
stall and a deadline; the motion stack owns route, speed, spacing and parked
heading. In `reconcile`, an accepted command outranks the twin's own stall pick,
so what is on screen is literally the decision the funnel emitted.

Conflict handling is the interesting part. The twin's state machine still decides
*what service* a vehicle needs; a command names a stall *inside* that decision.
The candidate list is already filtered to the lane the twin's state implies, so a
command naming a stall in the wrong lane is simply not a candidate — the vehicle
follows the twin and the mismatch is recorded. Fighting the backend would
recreate the two-systems-one-vehicle problem the single funnel exists to prevent.

It refuses honestly, by name: vehicle not in the scene, stall the renderer does
not draw, stall already held by another vehicle (naming it), layout not loaded
yet. On arrival it reports back — and arriving at a *different* stall than
commanded is reported as a **rejection**, because that is a completed drive but a
failed instruction, and the ledger must show which.

**Energy** (`energyController.SiteEnergyController`). OTTO-Q sends an average
power, a window, a state-of-charge bound and a reason code. The controller owns
everything OTTO-Q deliberately does not say:

- **Ramp** — power moves at 30 kW/s. A commanded 400 kW step takes ~13s, because
  an instant step would be a fault on real hardware.
- **Bounds** — it stops at the tighter of the command's declared bound and its own
  hardware limits, and it *anticipates its own stopping distance* so the ramp-down
  lands on the bound rather than through it.
- **Derate** — a hot pack cannot deliver nameplate; the controller cuts power and
  **reports** the derate instead of silently under-delivering.
- **Arbitration** — one battery directive at a time; a new one supersedes the old
  and the old is closed in the ledger, never left dangling.

It is a model, not a passthrough: state of charge integrates over the sim clock,
so a discharge actually drains the battery and the *next* world frame reflects it.
That closes the loop — OTTO-Q's decision changes the world it reads next tick.

`charger.orchestration` and `depot.orchestration` still have no subscriber, and
`twinExecutor` refuses those by name.

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

### P0b — let the twin actually carry out what OTTO-Q sends

**4.16 Subscribe the motion system to `vehicle.orchestration`.** ✅ **Done** — see §3b.
`assign_stall` now outranks the twin's own stall pick in `reconcile`, and the driver reports
arrival (or the reason it could not). Remaining gap: `hold`, `depart` and `requeue` have no
handler and are refused by name.

**4.17 Subscribe an energy controller to `energy.orchestration`.** ✅ **Done** — see §3b.
`SiteEnergyController` accepts battery and curtailment directives, owns ramp/derate/bounds,
and integrates state of charge so the decision shows up in the next world frame. Remaining
gap: it is a **client-side model**. The backend has `ottoq_sim_bess_step` and
`ottoq_energy_commands`; pointing the subscriber at those makes the battery state
server-authoritative like the rest of the world.

**4.18 Subscribe the charger manager to `charger.orchestration`.** `set_power_ceiling`,
`quarantine` and pause/resume are all refused today. Depends on 4.2 (charger health has to
be observable before ceilings mean anything).

### P2 — one world, one clock

**4.10 Decide the authority between the two engines** (§2.8). ✅ **Partially done.**
`SimulationEngine` is now explicitly labelled the offline demo, and every draw in the
client engine routes through a seeded generator (`src/engine/rng.ts`), so a demo run is
reproducible from its seed. The remaining decision — whether the client engine survives at
all once the twin is the sole authority — is still open.

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
`otto-twin-control/index.ts:452`. Deferred by decision: acceptable for a private demo link.

**4.15 Fix `OperatorConsole.tsx:306`** (`scenario_code` → `scenario`). ✅ **Done** — the
auto-attach toast was rendering `undefined`; `tsc --noEmit` is now clean.

---

## 5. Decisions taken

1. **One funnel, one wire.** Everything — cuOpt, Nemotron, deterministic rules — passes
   through L3→L2→L1→L0 and leaves by a single transport. See §3b. The in-database
   `ottoq_decide_tick` and the `ottoq-cuopt-propose` seam become *advisors* behind that
   funnel rather than parallel orchestrators.
2. **Advisory, never actuating.** OTTO-Q communicates orchestration intent with a time
   window. The twin's motion system moves vehicles; the energy controller moves electrons.
   Enforced by the `no_actuation` shield rule.
3. **Client-side packing for now.** The bundle is packed in the cockpit from the existing
   snapshot poll — no backend risk, works today. The durable version is a backend
   `ottoq_api_twin_channels(sim_run_id)` RPC returning the same five envelopes so every
   consumer gets identical bytes. Written against the `contracts.ts` shapes when wanted.
4. **Inbound realism target.** `fleet_telemetry` is shaped on the common denominator of AV
   fleet telemetry (identity, state machine, SoC, stall binding, health). If a specific OEM
   schema is the target, `ottoq_oem_webhook_patterns` on the backend appears to hold real
   patterns — worth reading before the shape hardens.

## 6. Open questions

1. **How strict should the readiness gate be?** Today the shield vetoes a batch only when a
   required channel is entirely `missing`. Flipping `requireUndegradedBundle` to true would
   also refuse a merely *degraded* world — safer, but it suppresses everything until
   backlog 4.1 and 4.2 land. One-line change when ready.
2. **Should the price thresholds be fitted rather than fixed?** `DEFAULT_ENERGY_POLICY`
   uses $25/$60 per MWh. Percentiles of the run's own price distribution would adapt to the
   scenario instead of assuming a typical day.

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
