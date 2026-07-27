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

## Review checklist before applying

1. Run each file against a Supabase **branch**, not the main project (`create_branch`).
2. Start one `normal_day` run on the branch and diff `ottoq_twin_run_list` counters against
   a main-project run of the same seed.
3. For `002`, confirm `ottoq_calibration_gaps` stops recording fallbacks for the six mapped
   variables — that is the proof the mapping resolved.
4. Only then merge the branch.
