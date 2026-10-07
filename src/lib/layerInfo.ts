// ============================================================================
// layerInfo — what each OTTO-Q layer is, in a few lines: the words behind the "i" beside every layer on the OTTO-Q
// tab (src/components/tabs/ottoq/LayerInfo.tsx).
//
// Chase, 2026-10-02: "a little information I or little note beside each title of the OTTO-Q tab layers that you can
// click on and it gives a technical description and context of what it is why it's there what purpose does it serve?"
// Chase, 2026-10-06: "the description of each layer behind the information button needs to be way more concise. We
// don't need paragraphs in paragraphs. We need short narrative of the background or overview, bullets for any facts or
// listed features or context, and then closing narrative or transition narrative."
//
// So each card is three parts and nothing else: an overview (two sentences at most), three or four short facts, and one
// closing line that hands over to the next layer. The 2026-10-02 cards (what, why, does, technically, chosen, never)
// were cut from about 330 words each to under 100; nothing they said is contradicted here, and the code objects that
// back every line stay under "Where to check it".
//
// Every sentence describes a mechanism in otto-q-core that can be pointed at by name (the `refs` of each layer). No
// count lives in this file: a number on screen comes from the run being watched (the plate's live line). The test
// beside this file holds both rules, and the length.
// ============================================================================
import type { PlateId } from "@/components/tabs/ottoq/stack/stackModel";
import type { LayerId } from "@/lib/ottoqFunnel";

export interface LayerInfo {
  plate: PlateId;
  /** The plate's own label and tagline, repeated so the card stands alone. */
  title: string;
  tagline: string;
  /** Two sentences at most: what the layer is and why it is there. */
  overview: string;
  /** Three or four short facts: how it works, what it is built on, what it may not do. */
  points: string[];
  /** One sentence: what the layer hands to the next one. */
  next: string;
  /** Code objects in otto-q-core (or this repo) a reader can open to check every line above. */
  refs: string[];
}

export const LAYER_INFO: Record<PlateId, LayerInfo> = {
  agent: {
    plate: "agent",
    title: "Agent",
    tagline: "Read & propose",
    overview: "The agent is the AI layer of OTTO-Q. It reads the whole depot and sets the goal for the next decisions.",
    points: [
      "Model: NVIDIA Nemotron, on the NVIDIA API. The tick never waits for it.",
      "It picks one of three goals: readiness first, throughput first or energy balanced.",
      "It can ask to change a few settings. Each one is held inside its safe range.",
      "A ledger records each call. If the agent fails, the default goal stays.",
    ],
    next: "It only proposes. The planners turn its goal into offers.",
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
    overview: "The planners are solvers. They turn the goal into offers: this car, this stall, this time.",
    points: [
      "CP-SAT (Google OR-Tools) plans the site: one car per stall, the power cap, each deadline.",
      "NVIDIA cuOpt, a greedy planner and a service-priority planner also make offers.",
      "CP-SAT runs pinned, so the same inputs give the same plan.",
      "A ledger records what happens to each offer: used, refused, replaced or expired.",
    ],
    next: "No planner places a car. The decide path chooses.",
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
    overview: "The decide path is the deterministic core of OTTO-Q. Each tick, it makes the final decision for each car.",
    points: [
      "It takes an offer, makes its own choice, or holds the car when nothing fits.",
      "It books the stall and sends the command in one transaction.",
      "The same inputs always give the same decision, with a written reason.",
      "Paired runs on one seed must match byte for byte.",
    ],
    next: "Each decision then passes the safety shield before the depot acts.",
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
    overview: "The safety shield checks decisions against versioned rules. Under it, the database refuses what must never happen.",
    points: [
      "Rules are data, with versions and settings per fleet owner.",
      "At an enforcing point, a failed rule blocks the action.",
      "The database refuses a double booking and any edit to the event log.",
      "No car leaves below its charge target or with a service still needed.",
    ],
    next: "Only a decision that passes reaches the depot.",
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
    overview: "The depot is where decisions become real. In this app it is OTTO-TWIN, a simulated depot.",
    points: [
      "Cars drive the lanes, charge, use the bays and leave ready.",
      "Faults, weather and arrivals come from fits to public data.",
      "Each random draw comes from the run seed, so a run replays exactly.",
      "OTTO-Q holds no simulation code, so a real depot can take its place. The 3D view only draws.",
    ],
    next: "What happens here feeds the next tick, and the agent reads it again.",
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

/** Every word a card shows (not its refs), for the length test and the Background tab. */
export const layerInfoText = (p: PlateId): string => {
  const i = LAYER_INFO[p];
  return [i.overview, ...i.points, i.next].join(" ");
};
