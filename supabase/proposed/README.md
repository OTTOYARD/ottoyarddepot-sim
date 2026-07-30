# Proposed backend migrations — NOT APPLIED

These files target the **shared** `otto-q-core` backend (Supabase project
`gxdrcyphqjzjsuhxuqtg`), which serves the cockpit, the twin, and every other consumer.
Applying them changes production behaviour for all of them, so they are checked in as
**proposals for review**, not as migrations. Nothing here has been run.

They are written against the live schema as of 2026-07-27 (column names verified by query),
and each one closes a specific finding in [`docs/OTTO-Q-WORLD-CONTRACT.md`](../../docs/OTTO-Q-WORLD-CONTRACT.md).

| File | Closes | Risk |
|---|---|---|
| `001_decision_frame_channels.sql` | §2.6, §2.7 — OTTO-Q sees less of the world than the renderer, and its frame is not run-scoped | **Additive.** Creates `ottoq_build_decision_frame_v2`; leaves v1 untouched so nothing breaks until callers migrate. |
| `002_corpus_variable_mapping.sql` | §2.3 — 3.5M+ fitted samples unused because catalog keys do not match corpus names | **Additive columns + a backfill.** Changes the *values* `ottoq_twin_deal` draws for seven variables, so re-baseline any saved comparison runs after applying. |

## Verification status — both files executed against the live schema

Verified 2026-07-27 by running each file's read paths as plain `SELECT`s against
run `6256a99f`. Nothing was created or modified.

**001 — passes, after one real bug was found and fixed.**

The first draft filtered service legs on `duration_basis->>'kind' = 'dwell'`. **There is no
`dwell` kind.** `kind` does not classify the service — it records how the *duration was
derived* (`charge_curve`, `distribution`, `flow_contract`, `travel`). The filter matched
**zero rows** and would have shipped a `service_timers` array that was permanently empty
while looking correct.

Fixed to exclude `travel` rather than enumerate services, so a new service kind arrives
included instead of silently vanishing. Re-verified:

| | rows | vehicles covered |
|---|---|---|
| old filter (`kind = 'dwell'`) | **0** | 0 |
| new filter (`kind <> 'travel'`) | **205** | 82 of 100 |

The corrected version also carries more than planned: `leg_type` as the real service
classifier, the duration's provenance, and — on charge legs — the curve inputs
(`start_soc`, `target_soc`, `charger_kw`, `pack_kwh`, `battery_temp_c`), which is what lets
OTTO-Q reason about whether a charge will *finish in time* rather than merely that one is
running. `src/lib/ottoq/contracts.ts → ServiceTimer` was updated to match.

Everything else in 001 resolved on the first pass: 100 vehicles with **100 wear rows**,
150 stalls, **3 staffing rows**, **45 OCPP chargers**, **6 tariff windows**, 233 weather
snapshots, 976 in-window energy snapshots — all real data that reaches the optimizer today.

**002 — passes as written.** All 7 catalog keys exist; all 7 corpus targets exist with the
expected shape (`precip_wet_mm` and `ambient_temp_c` both carry the 12 monthly segments the
`month:{MM}` template expects, zero-padded as the template assumes). The columns and the
gaps table it creates do not already exist. Total samples the mapping connects:

    trip_duration        3,503,651     charger_fault    10,000
    ambient_temp_c          10,442     idle_fraction    10,000
    incident                10,000     charge_time       3,985
    precip_mm                3,691     ─────────────────────────
                                       TOTAL         3,551,769

## ⚠️ Branch testing is currently IMPOSSIBLE — attempted 2026-07-27, blocked

The intended review path was: create a Supabase branch, apply both files there, run a
scenario, diff against live. **That cannot be done today.**

A branch replays the tracked migration history onto an empty database. The attempt returned
`MIGRATIONS_FAILED` with **0 tables, 0 functions, 0 migrations applied** — it failed on the
first one. The earliest tracked migration (`20260618035454 hw001_charging_scope_guard`)
opens with `CREATE FUNCTION ... RETURNS ottoq_rule_result`, a type no migration creates.
The 160 base tables and the `vehicle_state` / `stall_type` enums are likewise absent from
the history — the whole tracked sequence assumes a schema built outside migrations.

The branch was deleted immediately (~4 minutes billed, well under a cent).

See `docs/OTTO-Q-WORLD-CONTRACT.md` §2.8b — the broader consequence is that this database
is **not reconstructible from source**, which matters far beyond these two files.

**Prerequisite before either file is applied anywhere:** land a baseline schema dump as a
migration ordered before `20260618035454`, so the history replays from zero. Then the
checklist below becomes runnable.

## Review checklist — runnable only after the baseline migration exists

1. Run each file against a Supabase **branch**, not the main project (`create_branch`).
2. Start one `normal_day` run on the branch and diff `ottoq_twin_run_list` counters against
   a main-project run of the same seed.
3. For `002`, confirm `ottoq_calibration_gaps` stops recording fallbacks for the six mapped
   variables — that is the proof the mapping resolved.
4. Only then merge the branch.

## What IS verified today, without a branch

Both files had every read path executed as plain `SELECT`s against production with real
data — no writes, no DDL. That is what caught the `dwell` bug in `001` (0 rows → 205 after
the fix). It validates column names, joins, and result shapes.

What it does **not** validate, and what stays unverified until a branch is possible:

- that the DDL in either file applies cleanly (`ALTER TABLE`, `CREATE TABLE`, the
  `CREATE OR REPLACE FUNCTION` bodies)
- that `002`'s replacement of `ottoq_twin_deal` behaves identically to the live version on
  the paths it does not change — this is the real risk, since every run depends on that
  function and a regression there breaks card dealing globally
- the `minutes_until_change` arithmetic in `001` against overlapping tariff windows.
  Live data has `peak` (13–20) overlapping `super_peak` (17–19), and duplicate rows for
  every label, so the `LIMIT 1` picks nondeterministically between them. Worth resolving
  before `001` is applied.
