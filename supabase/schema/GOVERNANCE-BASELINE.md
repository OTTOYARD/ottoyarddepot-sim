# Schema governance baseline — pre-separation

**Captured:** 2026-07-29 · **Project:** `gxdrcyphqjzjsuhxuqtg` (otto-q-core)
**Snapshot label:** `pre_separation_2026_07_29` in `public.ottoq_schema_snapshots`

This file exists because the schema had **408 migrations applied in the database and one
migration file in this repo**. A 396-routine, 158-table separation performed that way has no
reviewable diff and no rollback other than a point-in-time restore. This is the baseline the
`twin` / `ottoq` split is measured against.

`pg_dump` is unavailable in the working environment (no client tools, no database password),
so the restorable copy lives **in the database** rather than here — see the snapshot table
below. This file records the *governance surface*, which is what the separation actually
changes, and is small enough to diff by eye.

---

## Rollback baseline

`public.ottoq_schema_snapshots`, label `pre_separation_2026_07_29` — 5,997 objects, ~1.5 MB of
restorable DDL. Restore an object by re-executing its `definition`.

| Object kind | Count | Text size |
|---|---:|---:|
| grant | 4,097 | 237 kB |
| constraint | 663 | 106 kB |
| index | 611 | 68 kB |
| function | 396 | 996 kB |
| policy | 145 | 26 kB |
| trigger | 45 | 6.7 kB |
| view | 40 | 35 kB |

A second table, `public.ottoq_fn_definition_backups`, holds per-change snapshots taken
immediately before each individual function edit, with the reason recorded.

---

## Function security posture (396 non-extension routines, schema `public`)

| Property | Count |
|---|---:|
| `SECURITY DEFINER` | 231 |
| `SECURITY INVOKER` | 165 |
| **No pinned `search_path`** | **288** |
| Pinned `search_path` | 107 |
| **Owned by `postgres`** | **396 (all)** |

Two consequences, both load-bearing for the split:

1. **Every function is owned by `postgres`, which carries `rolbypassrls`.** A `SECURITY DEFINER`
   function therefore ignores RLS *and* ignores any `REVOKE` placed on a schema. 47 of them write
   world state (`vehicles` / `stalls` / `depots` / `ottoq_vehicle_commands`). Until those are
   triaged, "revoked cross-schema write grants" is cosmetic — the grant is real but nothing routes
   through it.
2. **288 functions resolve against the caller's `search_path`.** When tables move out of `public`
   these do not error — they silently resolve somewhere else. The 107 pinned to
   `search_path=public, extensions` do the opposite: they hard-break. This makes a phased migration
   *more* dangerous than a single cutover, because the unpinned majority fail silently.

PostGIS is installed into `public` (744 functions), so `public` cannot simply be dropped from the
search path — `stalls.absolute_point`, `depots.geofence` and `origin_point` depend on it.

---

## The policy that was not what its name said

A policy named **`Service role full access`** existed on **34 tables**, defined as:

```sql
PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true)
```

`TO public` means every role, including `anon`. Combined with table-level
`INSERT`/`UPDATE`/`DELETE` grants to `anon`, **the publishable key shipped in the client bundle
could update or delete any vehicle, stall or depot row.** RLS was enabled on these tables and
enforced nothing. Per-tenant policies that also existed (`Fleet operators see own vehicles`,
`Staff see own depot vehicles`) were dead code — permissive policies are OR'd, so one
`USING(true)` makes every sibling irrelevant.

Affected tables include `vehicles`, `stalls`, `depots`, `dispatch_commands`, `vehicle_telemetry`,
`staff_users`.

### Fixed so far (2026-07-29)

`vehicles`, `stalls`, `depots` — migration `world_tables_read_only_for_client_keys`:

```sql
DROP POLICY "Service role full access" ON <table>;
CREATE POLICY "service_role writes world state" ON <table>
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "client keys read only" ON <table>
  AS PERMISSIVE FOR SELECT TO anon, authenticated USING (true);
REVOKE INSERT, UPDATE, DELETE ON <table> FROM anon, authenticated;
```

Verified after: `anon` retains `SELECT`, holds neither `UPDATE` nor `DELETE`, `service_role`
retains writes, and zero unconditional public policies remain on the three tables.

Reads were deliberately left open so the cockpit and edge functions are unaffected. Simulation
writes are also unaffected — every writer is a `SECURITY DEFINER` function owned by `postgres` and
bypasses RLS regardless. That is the point: **grants alone were never going to enforce this
boundary**, which is why the definer triage is the next step.

### Still open

The same policy remains on **31 further tables**, including `ottoq_vehicle_commands` — the table
that is supposed to carry the instruction/refusal contract, and which additionally has RLS
disabled entirely with `anon` holding full DML.

---

---

## Two traps that make a separation *look* successful while changing nothing

### 1. `REVOKE ... FROM anon` is a no-op while `PUBLIC` holds the grant

Postgres grants `EXECUTE` on every new function to `PUBLIC` by default. The ACL reads:

```
=X/postgres | postgres=X/postgres | service_role=X/postgres
```

The **empty grantee is `PUBLIC`**. `anon` therefore holds `EXECUTE` *through* `PUBLIC`, not by its
own grant — so `REVOKE EXECUTE ... FROM anon` removes nothing, the statement succeeds, and
`has_function_privilege('anon', ...)` still returns `true`.

Any plan phrased as "revoke cross-schema execute from the ottoq role" hits this. It must be
`REVOKE ... FROM PUBLIC` followed by an explicit `GRANT ... TO service_role`.

**Live exposure this concealed:** all **48** `SECURITY DEFINER` world-state writers were callable by
`anon` — the publishable key in the shipped client bundle. Including `ottoq_sim_seed_fleet`
(blanket-updates every vehicle, clears every stall) and `ottoq_purge_prior_runs` (deletes the black
box). Closed 2026-07-29 for the five destructive control-plane routines; the remaining 43 need an
edge-function caller inventory first, because "no in-database caller" does not mean "no caller" —
Edge Functions, the dashboard and cron are invisible to a `pg_proc.prosrc` scan.

**Also:** the count is **48, not 47**. `ottoq_sim_seed_fleet` has two overloads sharing one name.
Any dedupe keyed on function *name* instead of full signature silently drops one — and it is the
most destructive routine in the set.

### 2. A routine with a `SET` clause cannot `COMMIT`

Pinning `search_path` via `ALTER ROUTINE ... SET search_path` on a procedure that uses transaction
control makes it fail at runtime with `invalid transaction termination`.

Hit live: the blanket pin caught `ottoq_demo_metronome` — the engine behind the Start button — plus
both `ottoq_retention_purge_worker` overloads. Cron job 12 failed on its next two beats (18:00,
18:01) and recovered at 18:02 once corrected. Two ticks of sim time lost.

**Correct pattern for routines that commit:** no `SET` clause; set the path from inside the body,
which is legal alongside `COMMIT` and survives each commit:

```sql
PERFORM set_config('search_path', 'twin, ottoq, public, extensions', false);
```

---

## search_path: made forward-compatible (2026-07-29)

All **396** non-extension routines now resolve against:

```
twin, ottoq, public, extensions
```

- **today** — `twin` and `ottoq` are empty, so every name resolves in `public` exactly as before;
- **after the move** — a table relocated into `twin` is found there first, with *no function edit*;
- **always** — `public` stays on the path because PostGIS lives there and `stalls.absolute_point`,
  `depots.geofence` and `origin_point` depend on it.

Move day therefore requires no change to any function body. Verified: 0 unpinned, 0 still pinned to
`public` only, all 48 world-writers forward-compatible, and the simulation ticked straight through
the change (tick 20 → 22, bookings 97 → 105).

Empty `twin` and `ottoq` schemas now exist, with `USAGE` granted to `service_role` only.

---

## Schema move, wave 1+2 (2026-07-29): 25 decision functions now live in `ottoq`

Moved via `ALTER FUNCTION … SET SCHEMA ottoq` (relabel — no copy, OIDs unchanged, so views,
triggers and column defaults that bind by OID are untouched; unqualified in-DB calls resolve via
the forward-compatible `search_path`). The 9 text-qualified `public.<callee>` references — all
internal to the calendar family — were rewritten to `ottoq.<callee>` in the same transaction.
Verified live mid-run: 0 cron failures, bookings and enacted decisions flowing, 0 double-bookings.
Rollback: snapshot label `pre_schema_move_2026_07_29`.

Stayed in `public` deliberately: `ottoq_decide_tick` / `ottoq_fifo_tick` / `ottoq_greedy_tick` /
`ottoq_manual_tick` (twin baseline policies per boundary doc §3) and `ottoq_reserve_stall`
(shared claim primitive). Side effect that matters: client keys hold no `USAGE` on `ottoq`, so the
decision layer is structurally unreachable from the publishable key and invisible to PostgREST.

### MUST-STAY-IN-PUBLIC list (PostgREST callers — service_role included)

A complete scan of **all 26 deployed edge functions** produced the definitive set of RPC names
called through PostgREST (`.rpc()` or raw `rest/v1/rpc/…`). PostgREST only exposes `public`, so
**none of these may move in any future wave** without either updating the calling edge function or
extending PostgREST's exposed-schemas config (a dashboard setting, not SQL):

`does_task_trigger_oem_gate, evaluate_slo_breach, has_blocking_exception, validate_depot_snapshot,
ottoq_sim_run_scenario, ottoq_record_event, ottoq_sim_advance_tick, ottoq_sim_advance_due_runs,
ottoq_variability_instantiate, ottoq_twin_depot_layout, ottoq_twin_snapshot, ottoq_twin_run_list,
ottoq_active_charge_cap_kw, ottoq_submit_external_proposal, ottoq_agent_board, ottoq_policy_set,
ottoq_apply_ops_action, ottoq_emit_recommendation, ottoq_shield_and_log, ottoq_shield_probe,
ottoq_progress_commit, ottoq_amend_apply, ottoq_cleaning_due, ottoq_nl_status_brief,
ottoq_active_sim_run, ottoq_mpc_energy_lookahead, ottoq_cil_tick, ottoq_comms_locate_vehicle,
ottoq_comms_manager_escalate, ottoq_ingest_vehicle_signal, ottoq_benchmark_reset,
ottoq_sim_advance_and_snapshot, ottoq_score_run, ottoq_twin_refit_distribution,
ottoq_energy_cost_for_run, ottoq_run_blackbox_meta`

(Plus the cockpit's own `.rpc()` surface: run lifecycle, twin feeds, `ottoq_set_playback`,
`ottoq_sim_jump_forward`, `ottoq_twin_boot_manifest`.)

### Re-apply hazard

`OTTO-Q V1/supabase/migrations/20260711_t1_sub235_reservations_ledger_evalfix.sql` contains
`CREATE OR REPLACE FUNCTION public.ottoq_release_stall_reservation(...)`. That function now lives
in `ottoq`. Re-running the old migration file would recreate a stale duplicate in `public` — the
`ottoq` copy would still win on the search_path, but the duplicate would sit there as a trap.
Old migration files with schema-qualified DDL must not be replayed post-move.

---

## Not blockers (verified, so they can be dropped from planning)

- **Realtime** — the `supabase_realtime` publication contains **zero** public tables. Nothing is
  replicated, so nothing needs re-adding. (Any "live" UI behaviour is polling.)
- **Cross-schema foreign keys** — legal in Postgres, survive the move intact. 69 of the 222 FKs
  cross the `ottoq_*` / unprefixed line; they map where the boundary actually runs but do not break.
- **Materialized views** — none.

## Genuine mechanical cost

- 5 active cron jobs, 4 with a hardcoded `public.` prefix, plus 9 function bodies containing
  hardcoded `public.` references. `cron.job.command` is opaque text — nothing warns on a stale
  reference.
- 6 views and 45 user triggers reference world tables and move with them. `trg_sync_stall_occupancy`
  is the sharpest: a trigger **on `vehicles` that writes `stalls`**, so any retained write path to
  `vehicles` is a transitive write path to `stalls`.
