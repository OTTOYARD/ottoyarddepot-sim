# Mission, and how we work

This is the standing brief. Anyone picking up this repo — human or agent — reads
this first. It records **what we are building and why**, and **who decides what**.

---

## 1. The mission, in one paragraph

**The twin and the simulation exist to prove OTTO-Q works.**

They are not the product. OTTO-Q is the product — the orchestration intelligence
that decides what a depot full of autonomous vehicles should do next. The twin is
the world we run it against so we can prove it, repeatedly, without a real depot.

The loop is the whole point:

```
   TWIN                                        OTTO-Q
   ────                                        ──────
   generates a rich, variable world     ──▶    reads it as channels
   (weather, prices, faults, demand,           decides
    wear, staffing, grid, telemetry)
                                        ◀──    sends orchestration instructions
   executes those instructions
   (moves the car, ramps the battery)
   the world changes                    ──▶    OTTO-Q reads the consequence
```

If that loop closes, and the world on the left is rich enough to be hard, then we
have evidence OTTO-Q is intelligent rather than lucky. **That evidence is the
deliverable.**

## 2. What "good" looks like

Two tests, and everything in the backlog should serve one of them.

**Test one — is the world hard enough?**
A world with three variables is a demo. A world with forty-seven, drawn from real
distributions and interacting, is a proving ground. Today 47 variables are
registered and roughly 10 actually vary per run. Closing that gap is the primary
line of work.

**Test two — can OTTO-Q see it, and does its decision land?**
A variable that moves but never reaches the orchestrator proves nothing. A
decision that is issued but never executed proves nothing. Both halves must be
observable and both are measured — see `OTTO-Q-WORLD-CONTRACT.md`.

## 3. Who decides what

The founder sets direction and positioning. Engineering decisions are the CTO's
and should not be escalated.

**Decide without asking** — schema shape, naming, vocabularies, migrations,
query structure, test strategy, tooling, CI, refactors, library choices, data
cleanup, error handling, how a bug gets fixed, whether something ships now or
later.

**Ask, in plain language, only when it is foundational** — what the product is
for, who uses it, what we are claiming to a customer or investor, whether a whole
capability is in or out of scope, or a trade-off that changes what the product
*is* rather than how it is built.

Good question: *"Does the twin need to simulate vehicle telemetry, or is that
coming from a real OEM feed?"*
Bad question: *"Should the tariff window query pick the narrowest match or dedupe
the rows?"* — that is a decision, make it.

When reporting: lead with what it means, not what was typed. Detail belongs in
the code and the docs, not in the founder's inbox.

## 4. Standing decisions

Recorded so they are not re-litigated. Each was a CTO call, not a founder one.

| # | Decision | Reasoning |
|---|---|---|
| 1 | The backend twin is the authority. `SimulationEngine` is an explicitly-labelled offline demo. | Two engines both called "the simulation" is a liability in front of an OEM. One is the product, one is a fallback when the backend is unreachable. |
| 2 | OTTO-Q orchestrates, never actuates. Enforced in code, not convention. | On demo day the same envelope goes to a real fleet API and a real energy system. Both will accept an intent and reject an actuation. Building it any other way means the rehearsal proves nothing. |
| 3 | Everything leaves through one funnel. cuOpt and Nemotron are advisors behind it, not parallel paths. | Two systems telling one vehicle two things is the failure mode that ends a pilot. One funnel means one record of what was said. |
| 4 | Absent data is reported as absent, never as zero. | An optimizer that cannot tell "no data" from "zero" optimizes into a wall. This has already caught real bugs. |
| 5 | Overlapping tariff windows: return the **narrowest** matching window, deterministically. Do not modify the utility data. | A super-peak nested inside peak is how real tariffs are written — it is a surcharge window, not a duplicate. The narrowest match is the binding rate. Rewriting a customer's rate schedule to suit our query would be backwards. |
| 6 | Automated checks run on every change. | The regression guards only protect us if something runs them. Hand-run tests protect nothing once more than one person touches the repo. |
| 7 | Rebuilding the database from migration history is **deferred**, not fixed. | It blocks testing migrations on a throwaway copy, which is inconvenient. It is not a data-loss risk — backups cover that. Revisit when we need to apply a migration to production or stand up a second environment. |

## 5. Where the work goes next

Ordered by how much each moves the two tests in §2.

1. **Make more of the 47 variables actually vary, and actually arrive.** The
   world is the proving ground; a thin world proves little.
2. **Feed the channels OTTO-Q is currently blind on** — service timing, charger
   health. Both are typed and waiting for a source.
3. **Close the remaining executor gaps** so more decisions land in the world
   instead of being refused.
4. **Keep the evidence honest.** The audit trail, the coverage number, and the
   refusal log are what make this provable to someone who was not in the room.
