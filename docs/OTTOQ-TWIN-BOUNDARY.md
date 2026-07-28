# The OTTO-Q / OTTO-TWIN boundary

**Decided:** 2026-07-28 · **Status:** target architecture, not yet built

This document exists because the boundary between the intelligence layer and the
simulated world is currently **a naming convention, not a boundary**. Everything
lives in one Supabase project, one `public` schema — `vehicles`, `stalls`,
`depots`, every `ottoq_*` table and all ~118 functions together.

That has one consequence that matters more than tidiness:

> **The claim "OTTO-Q orchestrates the depot" is not currently falsifiable.**
> There is no boundary for it to be true across. OTTO-Q can read any table
> directly instead of consuming a published contract, and write world state
> directly instead of issuing an instruction that could be refused.

And one that matters commercially: an intelligence layer whose interface *is*
SQL access to a simulator can never be pointed at a physical depot.

---

## 1. The distinction, stated plainly

### The twin owns the WORLD — what is true

The twin is the reality. It decides what *is*, and hands those facts to OTTO-Q
as constraints to optimize against. It is authoritative over:

- physical inventory — stalls, bays, chargers, their types and positions
- vehicle condition — battery health, consumption, charge curve, soiling,
  wear, open fault codes
- environment — weather, humidity, irradiance, grid price, carbon, DR calls
- labor — staffing levels and the concurrency limits they impose
- arrivals and departures — who shows up, when, at what state of charge
- failures — charger faults, delays, incidents, tows
- **what actually happened** after an instruction was issued

None of these are OTTO-Q's to set. They are the problem, not the solution.

### OTTO-Q owns the DECISIONS — what should happen

OTTO-Q consumes the world and returns instructions. It is authoritative over:

- **vehicle placement** — which vehicle goes to which stall
- **stall selection** — charging stall vs staging vs bay, and which specific one
- **battery storage discharge** — when the BESS charges, discharges, or holds
- **timings** — when a vehicle moves, how long it holds, what order the queue runs
- **rerouting** — withdrawing an assignment and issuing a different one
- **temporary hold** — short-term staging while waiting for a resource
- **long-term hold** — perimeter parking for vehicles not needed soon
- **queue priority** — who gets served first when resources are contended

### The exchange

```
        TWIN                                    OTTO-Q
   (the world)                            (the intelligence)

   publishes observations  ──────────────▶  optimizes against them
   ( 5 channel feeds )                      ( advisors → funnel → shield )
                                                      │
   executes OR REFUSES     ◀──────────────  issues instructions
   reports what happened   ──────────────▶  learns what complied
```

---

## 2. Two rules that make the boundary real

Everything else follows from these.

### Rule 1 — OTTO-Q never writes world state

It does not `UPDATE vehicles`. It does not set a position, a state, or a stall
occupancy. It **issues an instruction**, and the twin is the only writer of
truth.

This is not stylistic. A physical depot will not let an optimizer write a
vehicle's location — you ask a vehicle to move and it moves, or it doesn't. Any
code path where OTTO-Q mutates world state directly is a path that cannot
survive contact with a real depot, and it will not be discovered until it fails
there.

### Rule 2 — The twin must be able to REFUSE

An instruction is a request, not a guarantee. The twin must be free to decline,
delay, partially comply, or fail — and to report which.

If the twin always obeys, OTTO-Q gets built on an assumption that is false in
the physical world, and every downstream behaviour (retry, re-plan, escalate)
goes untested. The refusal path is the most important part of the contract and
the easiest to skip.

The command ack lifecycle already exists server-side for this:
`ottoq_emit_vehicle_command` → `ottoq_fleet_pending_commands` →
`ottoq_ack_vehicle_command` → `ottoq_sim_confirm_commands`.

---

## 3. Why there are currently two schedulers, and what happens to each

This was nearly resolved the wrong way — by picking one and discarding the
other. They do different jobs.

| | **Twin-internal policies** | **The OTTO-Q stack** |
|---|---|---|
| Where | `ottoq_decide_tick`, in SQL | `src/lib/ottoq/*`, TypeScript |
| Why it exists | a world with no scheduler does not move; the sim must *run* | it is the product |
| Has | stall assignment, dispatch, reservations | channel contract, integrity/provenance, L1 safety shield, command contract + acks, explainability |
| Fate | becomes **baselines** to beat | becomes the OTTO-Q service |

The twin's internal policies are `fifo`, `greedy`, and one currently named
`otto_q`.

> **Rename `otto_q` → `twin_internal`.** As it stands the A/B harness compares a
> stand-in against baselines and labels the winner "OTTO-Q", so it is measuring
> the wrong thing. Real OTTO-Q must enter the benchmark as an external
> participant, or the comparison proves nothing.

---

## 4. What is already built toward this

**The inbound half of the contract exists.** Five run-scoped feeds published this
session, all read-only, all provenance-tagged:

| Feed | Carries |
|---|---|
| `ottoq_twin_fleet_condition` | per-vehicle SoH, consumption, charge curve, soiling, intervals |
| `ottoq_twin_labor_window` | staffing, lane caps, overflow pressure, service backlog |
| `ottoq_twin_offsite_window` | trips, durations vs plan, SoC on return, return reasons |
| `ottoq_twin_wear_window` | drive km/hours, PM and calibration due, open DTCs |
| `ottoq_twin_run_context` | which depot, which policy actually ran |

**The decision code is already portable.** Verified: `channels`, `contracts`,
`coverage`, `advisors`, `shield`, `pipeline`, `commands`, `commandBus`,
`energyController` have **zero** React, DOM, browser-storage or UI imports. Only
`channels.ts` and `worldBoot.ts` touch the twin client, and only at the
transport seam. This stack relocates to a service essentially unchanged.

**Reservations exist for two asset classes.** `ottoq_reserve_stall` is atomic and
TTL'd (`reserved_by`, `reserved_at`, `reservation_expires_at`), covering charging
stalls and staging.

---

## 5. What is missing

| Gap | Detail |
|---|---|
| **Command ingest** | There is no inbound path. `ottoq_api_twin_apply_commands` is misleadingly named — its body only calls `ottoq_sim_confirm_commands` and takes no command payload. OTTO-Q cannot currently instruct the twin at all. |
| **Bay reservations** | Wash, detail and service bays are gated by *lane capacity* (`cleaning_staff`, `service_staff`) — throttled concurrency, never a specific bay reserved for a specific vehicle at a specific time. |
| **BESS orchestration** | Exists only as a client-side `SiteEnergyController`. `ottoq_bess_reserve_target` exists server-side but is not driven by OTTO-Q decisions. |
| **Long-term hold / perimeter** | Stall types are `dcfc`, `l2`, `staging`, `wash_bay`, `service_bay`. There is no explicit perimeter or long-term-hold class. Stalls carry a `zone` column that may be usable — **unverified**, needs checking before design. |
| **Unwired subscribers** | Of four command targets, only `vehicle` and `energy` have subscribers. `charger` and `depot` are declared and unconnected. |
| **Schema separation** | One schema. No boundary to enforce rules 1 and 2 against. |

---

## 6. Sequencing, and why this order

**Do not split the databases first.** Splitting before the interface is proven
means debugging an unproven contract *and* a distributed system at once, where
every failure is ambiguous between the two.

1. **Establish the seam inside one database.** Separate schemas (`twin`, `ottoq`),
   a real command-ingest path, and revoked cross-schema write grants so rule 1 is
   enforced by the database rather than by discipline.
2. **Prove instructions flow end to end.** A vehicle moves because it was told
   to, and a refused instruction is visibly refused.
3. **Move OTTO-Q to its own service** (edge function or standalone), consuming
   the feeds over HTTP like any external client would.
4. **Split the databases physically**, cutting along a line already tested.
5. **Point it at a physical depot.** The interface is then the same one the twin
   has been speaking all along.

The endgame is that the twin is one implementation of an interface, and a real
depot is another. Nothing in OTTO-Q should be able to tell the difference.

---

## 7. Open questions

- Does the `stalls.zone` column already distinguish perimeter/long-term parking,
  or does that class need to be introduced?
- Should the twin's refusal reasons be a closed vocabulary (so OTTO-Q can react
  differently to "occupied" vs "vehicle unresponsive" vs "unsafe")?
- Do OTTO-Q's own learned parameters and decision history live in its database
  (yes, by rule 1) — and if so, how does a benchmark replay a historical run
  against a *fresh* OTTO-Q with no memory?
- Was there an original constraint that stopped the database split from
  happening earlier? Unknown; treated here as unfinished work rather than a
  decision against.
