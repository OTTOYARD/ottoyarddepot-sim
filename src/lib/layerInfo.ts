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
    what:
      "OTTO-Q's reasoning layer: a large language model agent that reads the whole depot and decides what the planners " +
      "should be optimizing for right now.",
    why:
      "A depot's priorities move through the day: a morning deploy wave, a grid peak, a faulted charger, a backlog of " +
      "washes. A fixed rule weighs those the same way every hour. The agent reads the situation as it is and picks the " +
      "objective that fits it, the way an experienced depot lead would.",
    does:
      "On a regular beat it reads one frame of the depot (every car, stall, charger, booking and the grid), chooses one " +
      "assignment objective and hands it to the solver chain, which plans against it. It can also ask to change a small " +
      "set of run settings. Each pass, what it read and what it asked for, is on the Agent tab.",
    technically: [
      "NVIDIA Nemotron, served through NVIDIA's NIM API and called from a Supabase edge function. The exact model is " +
        "written down with every call.",
      "Fired asynchronously (pg_net), so the engine's tick never waits on it; its answer is applied when it lands.",
      "Every call is one append-only row in ottoq_model_call_ledger, an evidence table that survives run purges. No " +
        "chain-of-thought is stored.",
      "A setting it asks for goes through ottoq_policy_set: only catalogued parameters, clamped to their declared " +
        "minimum and maximum, and judged by the safety shield at the policy_write point.",
      "If the model fails or has nothing to say, the deterministic objective stands, and the ledger records a fallback.",
    ],
    chosen: [
      "Choosing among named objectives from many signals at once is what a language model is good at. Computing an " +
        "exact, feasible plan is not, so the plan stays with the solvers below.",
      "Off the critical path by design: a slow or wrong answer can cost the depot one objective for a while, never a " +
        "safety rule, a booking or a car's service.",
      "One vendor platform for both the agent and cuOpt (NVIDIA), with every call ledgered either way, so the agent's " +
        "record can be audited the same way the solvers' is.",
    ],
    never: "It never places a car, books a stall or starts a charge. It proposes; the deterministic core disposes.",
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
      "The optimization layer: solvers that turn the agent's objective into concrete offers, such as \"this car, this " +
      "stall, this time\", for the decide path to accept or refuse.",
    why:
      "Matching a fleet to a handful of fast chargers, slower chargers and service bays, under a shared site power cap, " +
      "deadlines and the order services must happen in, is a combinatorial scheduling problem. A solver searches it far " +
      "better than a hand-written rule, especially when the depot is busy and the scarce stalls are contested.",
    does:
      "Each planner reads a frame of the depot (cars, free stalls, faulted chargers, standing bookings), solves, and sends " +
      "its offers through one door. Every offer's fate is recorded: enacted, refused (and by which rule), replaced by a " +
      "newer offer, or expired.",
    technically: [
      "CP-SAT, the constraint-programming solver in Google OR-Tools, run as a service with a lexicographic objective " +
        "(forward_lex): the most important goal first, the next one only among the plans that tie on it.",
      "NVIDIA cuOpt, a GPU routing and linear-programming solver reached over NVIDIA's API, as an additional proposer.",
      "Two planners inside the database: a shield-constrained greedy pick and a service-priority sequencer.",
      "One door for every offer, public.ottoq_submit_external_proposal, and one ledger of what happened to each, " +
        "ottoq_proposal_disposition_ledger (evidence class: it survives run purges).",
    ],
    chosen: [
      "CP-SAT can say what a depot actually is: one car per stall, a shared power cap, a cooldown between fast-charge " +
        "sessions, a deadline per car. cuOpt's own documentation (release 26.08) has no construct for the first three, " +
        "so cuOpt plans routes and offers stalls, and CP-SAT schedules the site.",
      "CP-SAT can be made reproducible: its version is pinned, it runs on a deterministic time budget rather than a wall " +
        "clock, and its worker count is fixed, so the same inputs give the same plan.",
      "cuOpt documents no determinism guarantee for routing, so it is only ever consumed as a proposer behind the " +
        "deterministic core, with its offers hashed into the run's certification.",
    ],
    never: "No planner ever writes a final assignment. An offer is a proposal until the decide path enacts it.",
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
      "The deterministic decide path: the part of OTTO-Q that actually decides, every tick, for every car in the depot.",
    why:
      "Someone has to be accountable for each decision. The same inputs must give the same decision every time, with a " +
      "written reason, so any result can be replayed and checked. Planners can be fast, clever or nondeterministic; the " +
      "decide path is none of those things, on purpose.",
    does:
      "Each tick it first reconciles what physically happened, then works through the depot in a fixed order: energy, " +
      "cars due out, stall assignment, gate intake, charge hand-off, service bays, service order. For each car it takes a " +
      "planner's offer, makes its own choice, or holds the car when nothing fits, books the stall and sends the command, " +
      "all in one transaction.",
    technically: [
      "PL/pgSQL inside Postgres: public.ottoq_decide_tick, driven by pg_cron alongside the world step.",
      "Every decision is a row in ottoq_decisions, with the rules it was checked against and its latency.",
      "Every enacted choice books its stall on the calendar, ottoq_stall_bookings, in the same transaction as the " +
        "decision, against the exact stall enacted.",
      "It never moves a car itself: it emits ottoq_vehicle_commands, and the twin carries them out or refuses them.",
    ],
    chosen: [
      "Deciding next to the data means a decision and its booking commit together or not at all: there is no " +
        "half-applied plan to clean up after a crash or a timeout.",
      "Determinism is measured, not assumed: pairs of runs on the same seed are compared byte for byte across fourteen " +
        "independent checks, and any engine change that should invalidate that certification does.",
      "A deterministic disposer is what makes it safe to take advice from proposers that cannot promise the same answer " +
        "twice: the agent and cuOpt.",
    ],
    never: "It never lets a car leave below its charge target or with a needed service still open.",
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
      "OTTO-Q's safety harness: a versioned set of rules checked at each decision point, standing on hard limits built " +
      "into the database itself.",
    why:
      "Software that moves vehicles has to be unable to do some things, not merely unlikely to: book one stall twice, " +
      "start a charge on a faulted charger, exceed the site's power, or release a car below its charge target or with a " +
      "service still needed. A fleet owner's contract terms belong here too.",
    does:
      "At each decision point the rules that apply to that action are evaluated and every verdict is logged. Where the " +
      "point enforces, a failing rule refuses the action and the decide path falls back to a safe default; where it only " +
      "advises, the verdict is recorded for review.",
    technically: [
      "Rules are rows, not code: public.ottoq_rules, versioned, with parameters a fleet owner's contract can set " +
        "(per-operator service levels).",
      "Checked through public.ottoq_shield_probe; every verdict is a row in ottoq_rule_evaluations.",
      "Which points enforce and which advise is read from the engine's own code each time it is asked " +
        "(public.ottoq_shield_probe_posture), never from a list someone has to keep up to date.",
      "Under the rules sit limits that refuse unconditionally: a calendar constraint that makes a double booking " +
        "impossible, a unique index for one vehicle per stall, and an event log that rejects every edit and deletion.",
      "One departure test at every exit, public.ottoq_departure_clear: below its charge target, or with a service " +
        "still needed, a car does not leave.",
    ],
    chosen: [
      "Rules as data can be versioned, audited, and parameterized per fleet owner without a code change.",
      "Limits enforced by the database hold for every caller, including an agent nobody has written yet. A guardrail " +
        "inside an agent's own code is bypassed by anything that does not go through that code.",
      "Every evaluation is evidence: a reviewer can count what was checked, what was refused and what was only noted, " +
        "per decision point, from the ledger.",
    ],
    never: "No agent or planner can switch a rule off: a proposal reaches the depot only through these checks.",
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
      "The depot floor, where OTTO-Q's decisions become physical: cars driving the lanes, plugging in, going through " +
      "wash and service bays, and leaving ready. In this app the depot is OTTO-TWIN, a simulated depot.",
    why:
      "A plan is only worth what it does to real cars. The twin is a world with physical limits (travel time, one car per " +
      "stall, chargers that fault, technicians who are busy) so a decision that looks right on paper has to work on the " +
      "floor before it counts.",
    does:
      "The twin owns the world: it moves each car along the depot's lanes, runs charging sessions on modelled chargers, " +
      "completes services with the technicians on shift, and draws faults, weather and arrivals from distributions fitted " +
      "to public data. It carries out OTTO-Q's commands or refuses them, and reports what happened.",
    technically: [
      "Database-native: the world step is a set of Postgres functions (the twin schema), advanced on a virtual clock by " +
        "pg_cron.",
      "Every random draw is a pure hash of the run's seed, the entity and the sim time (twin.ottoq_sim_seeded_random), " +
        "so a run can be replayed exactly.",
      "OTTO-Q sends commands; the twin executes them and confirms or refuses each one. The 3D view draws the twin's " +
        "snapshots and only interpolates motion between ticks.",
      "Simulated rows and real telemetry share the same tables, told apart by a data_source column.",
    ],
    chosen: [
      "The swap test: OTTO-Q cannot tell this depot from a real one. Its inputs arrive as declared data, nothing from a " +
        "simulated world is wired into its code, and a CI test enforces that separation.",
      "A world in the same database as the engine makes every tick transactional and every run reproducible, so any " +
        "number shown here can be traced to a run and re-derived.",
      "Calibrated to public data (EV charging sessions, trip records, AV incident reports, grid and weather records) so " +
        "the worlds look like real days rather than averages.",
    ],
    never: "The renderer never decides: a car is drawn where the twin says it is, and nowhere else.",
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
