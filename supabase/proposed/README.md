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
| `002_corpus_variable_mapping.sql` | §2.3 — 3.5M+ fitted samples unused because catalog keys do not match corpus names | **Additive columns + a backfill.** Changes the *values* `ottoq_twin_deal` draws for six variables, so re-baseline any saved comparison runs after applying. |

## Review checklist before applying

1. Run each file against a Supabase **branch**, not the main project (`create_branch`).
2. Start one `normal_day` run on the branch and diff `ottoq_twin_run_list` counters against
   a main-project run of the same seed.
3. For `002`, confirm `ottoq_calibration_gaps` stops recording fallbacks for the six mapped
   variables — that is the proof the mapping resolved.
4. Only then merge the branch.
