// ============================================================================
// layerInfo — what each OTTO-Q layer is, why it is there, and why it is built the way it is. The words behind the
// "i" beside every layer on the OTTO-Q tab (src/components/tabs/ottoq/LayerInfo.tsx).
//
// Chase, 2026-10-02: "a little information I or little note beside each title of the OTTO-Q tab layers that you can
// click on and it gives a technical description and context of what it is why it's there what purpose does it serve?
// Maybe why it was integrated and so forth."
//
// Every sentence here describes a mechanism in otto-q-core that can be pointed at by name (the `refs` of each layer).
// No count lives in this file: a number on screen comes from the run being watched (the plate's live line) or from
// a ledger read at the moment it is shown (the Background tab), never from copy written on a given day. The test
// beside this file holds both rules.
// ============================================================================
import type { PlateId } from "@/components/tabs/ottoq/stack/stackModel";
import type { LayerId } from "@/lib/ottoqFunnel";

export interface LayerInfo {
  plate: PlateId;
  /** The plate's own label and tagline, repeated so the card stands alone. */
  title: string;
  tagline: string;
  /** One or two sentences: what the layer is, in plain words. */
  what: string;
  /** Why it exists: the problem it answers. */
  why: string;
  /** What it does, every time it acts. */
  does: string;
  /** What it technically is: the code, the services, the tables. Short lines. */
  technically: string[];
  /** Why this technology and not another. Short lines. */
  chosen: string[];
  /** What it may never do. One sentence; the line a reviewer asks about first. */
  never: string;
  /** Code objects in otto-q-core (or this repo) a reader can open to check every line above. */
  refs: string[];
}

export const LAYER_INFO: Record<PlateId, LayerInfo> = {
  agent: {
    plate: "agent",
    title: "Agent",
    tagline: "Read & propose",
    what: "The agent is the reasoning layer of OTTO-Q. It reads the whole depot and sets the goal for the planners.",
    why:
      "A depot's priorities change during the day: a morning dispatch wave, a grid peak, a charger fault, a queue at " +
      "the wash. A fixed rule gives each the same weight every hour. The agent reads the depot as it is now and picks " +
      "the goal that fits.",
    does:
      "At regular intervals, the agent reads a snapshot of the whole depot. It picks one goal for stall assignment, and " +
      "the solvers plan to that goal. It can also ask to change a few run settings. The Agent tab shows what it read " +
      "and asked for in each pass.",
    technically: [
      "A Supabase edge function calls NVIDIA Nemotron on the NVIDIA NIM API. The record of each call names the exact " +
        "model.",
      "The engine calls it asynchronously through pg_net, so the tick never waits for it. The engine uses the answer " +
        "when it arrives.",
      "Each call adds one row to ottoq_model_call_ledger, an append-only evidence table that run purges do not delete. " +
        "The table stores no chain-of-thought.",
      "Each setting it asks for goes through ottoq_policy_set. That function accepts only catalogued parameters and " +
        "clamps each to its declared range. The safety shield checks each change at the policy_write point.",
      "If the agent fails or gives no answer, the deterministic goal stays in place. The ledger records a fallback.",
    ],
    chosen: [
      "A language model picks well among named goals from many signals at once. It is not good at exact, feasible " +
        "plans, so the solvers below make the plan.",
      "The agent is off the critical path on purpose. A slow or wrong answer can cost the depot the right goal for a " +
        "time. It can never cost a safety rule, a booking or a service that a car needs.",
      "NVIDIA serves both the agent and cuOpt. A ledger records each call to either, so a reviewer can audit the agent " +
        "the same way as the solvers.",
    ],
    never: "It only proposes and never places a car, books a stall or starts a charge.",
    refs: [
      "edge-functions/ottoq-orchestrator-agent",
      "public.ottoq_model_call_ledger",
      "public.ottoq_intelligence_ledger",
      "public.ottoq_policy_set",
      "public.ottoq_policy_param_catalog",
    ],
  },

  planners: {
    plate: "planners",
    title: "Planners",
    tagline: "Optimize & offer",
    what:
      "The planners are solvers. They turn the agent's goal into offers, such as \"this car, this stall, this time\". " +
      "The decide path accepts or refuses each offer.",
    why:
      "Cars compete for a few fast chargers, standard chargers and service bays under one site power cap. Each car has " +
      "a deadline and a fixed order of services. A solver searches this combinatorial scheduling problem far better " +
      "than a hand-written rule, most of all when many cars want the scarce stalls.",
    does:
      "Each planner reads a snapshot of the depot: cars, free stalls, faulted chargers and bookings. It solves and sends " +
      "its offers through one function. A ledger records what happens to each offer: chosen, refused by a named rule, " +
      "replaced by a newer offer, or expired.",
    technically: [
      "CP-SAT, the constraint-programming solver in Google OR-Tools, runs as a service with a lexicographic objective, " +
        "forward_lex. It ranks plans on the most important term first and uses each next term only to break ties.",
      "NVIDIA cuOpt, a GPU solver for routing and linear programs, is another proposer that OTTO-Q calls through the " +
        "NVIDIA API.",
      "The database also runs a greedy planner, which the safety shield constrains, and a service-priority sequencer.",
      "Every offer enters through public.ottoq_submit_external_proposal. The evidence table " +
        "ottoq_proposal_disposition_ledger records what happened to each, and run purges do not delete it.",
    ],
    chosen: [
      "CP-SAT can model one car per stall, a shared power cap, a fast-charge cooldown and a deadline per car. cuOpt's " +
        "own documentation (release 26.08) has no construct for the first three. So on this one depot, cuOpt only " +
        "offers stalls, and CP-SAT schedules the site.",
      "OTTO-Q can make CP-SAT reproducible. It pins the version, fixes the worker count and sets a deterministic time " +
        "budget, not a wall clock. So the same inputs give the same plan.",
      "cuOpt documents no determinism guarantee for routing. So OTTO-Q uses it only as a proposer behind the decide " +
        "path. The run's certification hash includes its offers.",
    ],
    never: "No planner ever writes a final assignment, because the decide path makes every one.",
    refs: [
      "solvers/cpsat/model.py (OR-Tools CP-SAT)",
      "edge-functions/ottoq-cuopt-propose",
      "public.ottoq_submit_external_proposal",
      "public.ottoq_proposal_disposition_ledger",
      "SOLVER_STATE.md §10 (why the decomposition is forced)",
    ],
  },

  decide: {
    plate: "decide",
    title: "Decide",
    tagline: "Choose one plan",
    what:
      "The decide path is the deterministic part of OTTO-Q. Each tick, it makes the final decision for each car in the " +
      "depot.",
    why:
      "Someone must be accountable for each decision. The same inputs must always give the same decision, with a " +
      "written reason, so anyone can replay and check a result. Planners can be fast, clever or nondeterministic. The " +
      "decide path is none of these, on purpose.",
    does:
      "Each tick, it first matches its records to what physically happened. Then it works through the depot in a fixed " +
      "order: energy, cars due out, stall assignment, gate intake, charge hand-off, service bays, service order. For " +
      "each car, it takes an offer, makes its own choice, or holds the car when nothing fits. Each choice books its " +
      "stall and sends its command in one transaction.",
    technically: [
      "pg_cron runs public.ottoq_decide_tick, a PL/pgSQL function in Postgres, together with the world step.",
      "Each decision is one row in ottoq_decisions, with its rule results and its latency.",
      "When it places a car, it books the exact stall on the calendar, ottoq_stall_bookings, in the same transaction.",
      "It never moves a car itself. It writes ottoq_vehicle_commands, and the twin carries them out or refuses them.",
    ],
    chosen: [
      "The decide path runs next to the data, so a decision and its booking commit together or not at all. A crash " +
        "or a timeout leaves no half-applied plan.",
      "OTTO-Q measures determinism and does not assume it. It compares pairs of runs on the same seed byte for byte, " +
        "on fourteen independent checks. Any engine change that should make the certification invalid does so.",
      "The agent and cuOpt cannot promise the same answer twice. A deterministic decide path makes their advice safe " +
        "to use.",
    ],
    never: "It never lets a car leave below its charge target or with a service still needed.",
    refs: [
      "public.ottoq_decide_tick",
      "public.ottoq_decisions",
      "public.ottoq_stall_bookings",
      "public.ottoq_vehicle_commands",
      "public.ottoq_departure_clear",
      "CERTIFICATION_STATUS.md",
    ],
  },

  safety: {
    plate: "safety",
    title: "Safety",
    tagline: "Check & enforce",
    what:
      "The safety shield is a versioned set of rules that OTTO-Q checks at each decision point. Under these rules, the " +
      "database itself enforces hard limits.",
    why:
      "Software that moves cars must be unable to do some things, not only unlikely to. It must never book one stall " +
      "twice, start a charge on a faulted charger or exceed the site power limit. It must never dispatch a car below " +
      "its charge target or with a service still needed. A fleet owner's contract terms belong here too.",
    does:
      "At each decision point, the shield checks the rules for that action and logs each result. Where the point " +
      "enforces, a failed rule blocks the action and the decide path uses a safe default. Where it only advises, the " +
      "shield records the result for review.",
    technically: [
      "Rules are versioned rows in public.ottoq_rules, not code. A fleet owner's contract can set their parameters, " +
        "such as service levels per operator.",
      "public.ottoq_shield_probe checks the rules, and each result is a row in ottoq_rule_evaluations.",
      "public.ottoq_shield_probe_posture reads which points enforce and which advise from the engine code on each " +
        "call. It uses no list that a person must keep up to date.",
      "Under the rules are hard limits in the database that always refuse. A calendar constraint makes a double " +
        "booking impossible. A unique index allows only one car per stall. The event log rejects every edit and " +
        "deletion.",
      "Every exit uses one departure test, public.ottoq_departure_clear. A car below its charge target or with a " +
        "service still needed does not leave.",
    ],
    chosen: [
      "As data, rules can have versions, audits and parameters per fleet owner with no code change.",
      "The database enforces its limits on every caller, even an agent that nobody has written yet. A check inside an " +
        "agent's own code stops only what goes through that code.",
      "Each check is evidence. From the ledger, a reviewer can count what each decision point checked, blocked and " +
        "only noted.",
    ],
    never: "No agent or planner can turn a rule off, because a proposal reaches the depot only through these checks.",
    refs: [
      "public.ottoq_rules",
      "public.ottoq_shield_probe",
      "public.ottoq_shield_probe_posture",
      "public.ottoq_rule_evaluation_effect",
      "public.ottoq_stall_bookings (EXCLUDE constraint)",
      "public.ottoq_departure_clear",
    ],
  },

  depot: {
    plate: "depot",
    title: "Depot",
    tagline: "Dispatch & serve",
    what:
      "The depot is where OTTO-Q's decisions become physical. Cars drive the lanes, plug in, use the wash and service " +
      "bays, and leave ready. In this app, the depot is OTTO-TWIN, a simulated depot.",
    why:
      "A plan is only worth what it does to real cars. The twin has physical limits: travel time, one car per stall, " +
      "charger faults and busy technicians. A decision counts only when it also works on the depot floor.",
    does:
      "The twin owns the world. It moves cars, charges them and completes services with the technicians on shift. It " +
      "draws faults, weather and arrivals from distributions fitted to public data. It carries out OTTO-Q's commands " +
      "or refuses them, and reports what happened.",
    technically: [
      "The world step is a set of Postgres functions in the twin schema. pg_cron advances them on a virtual clock.",
      "twin.ottoq_sim_seeded_random makes each random draw a pure hash of the run seed, the entity and the sim time. " +
        "So anyone can replay a run exactly.",
      "OTTO-Q sends commands, and the twin carries out and confirms each one or refuses it. The 3D view draws the " +
        "twin's snapshots and only interpolates motion between ticks.",
      "Simulated rows and real telemetry share the same tables. A data_source column tells them apart.",
    ],
    chosen: [
      "The swap test: OTTO-Q cannot tell the difference between this depot and a real one. Its inputs arrive as " +
        "declared data, and its code holds nothing from the simulated world. A CI test enforces this separation.",
      "The world and the engine share one database, so each tick is transactional and each run is reproducible. Any " +
        "number shown here traces to a run, and anyone can derive it again.",
      "Public data calibrates the twin: EV charge sessions, trip records, AV incident reports, and grid and weather " +
        "records. So a simulated day looks like a real day, not an average.",
    ],
    never: "The renderer never decides and draws each car only where the twin says it is.",
    refs: [
      "twin.ottoq_sim_seeded_random",
      "public.ottoq_twin_snapshot",
      "public.ottoq_vehicle_commands",
      "SEPARATION.md (the solver / simulator boundary)",
      "TWIN_CORE.md",
    ],
  },
};

/** The flat funnel's eight layers (a browser without WebGL), and the plates whose words explain each. */
export const FLAT_LAYER_PLATES: Record<LayerId, PlateId[]> = {
  arriving: ["depot"],
  needs: ["depot"],
  proposers: ["agent", "planners"],
  decide: ["decide"],
  shield: ["safety"],
  booked: ["depot"],
  service: ["depot"],
  ready: ["depot"],
};
