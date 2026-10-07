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
// were cut from about 330 words each to under 100; nothing they said is contradicted here.
// Chase, 2026-10-07: "It sounds very childish ... I want to remove all specific tool naming from our descriptions ...
// definitely make note of our proprietary or custom build safety layer and rule set ... without revealing our entire
// formula and construction". So the cards name no vendor product (names live in src/lib/publicNames.ts, with the
// sources for "NVIDIA open model" and "state-of-the-art"), and the code objects behind each line are no longer drawn
// on screen. They stay in `refs`, for an engineer and for the tests.
//
// Every sentence describes a mechanism in otto-q-core that can be pointed at by name (the `refs` of each layer). No
// count lives in this file: a number on screen comes from the run being watched (the plate's live line). The test
// beside this file holds both rules, the length, and the product names.
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
  /** Code objects in otto-q-core (or this repo) that back every line above. Not drawn on screen (Chase, 2026-10-07). */
  refs: string[];
}

export const LAYER_INFO: Record<PlateId, LayerInfo> = {
  agent: {
    plate: "agent",
    title: "Agent",
    tagline: "Read & propose",
    overview: "The agent reasons over the live depot state with an NVIDIA open model. Each pass sets the planners' objective and orders the charge line.",
    points: [
      "It ranks the cars waiting for a charger and names a fast charger or an L2 for each.",
      "Cars due out and long waits still go first. No charger idles and no charge is cut short.",
      "The objective is one of three: readiness first, throughput first or energy balanced.",
      "It reads what the planners learned this run. A ledger records each call and each order.",
    ],
    next: "It only proposes. The decide path seats every car.",
    refs: [
      "edge-functions/ottoq-orchestrator-agent",
      "public.ottoq_agent_charge_orders",
      "public.ottoq_agent_board",
      "public.ottoq_run_learning",
      "public.ottoq_model_call_ledger",
      "public.ottoq_policy_param_catalog",
    ],
  },

  planners: {
    plate: "planners",
    title: "Planners",
    tagline: "Optimize & offer",
    overview: "The planners combine state-of-the-art lexicographic optimization with GPU-accelerated and heuristic solvers. They turn the objective into offers: this car, this stall, this time.",
    points: [
      "Goals rank in strict order, readiness first, so a lower goal never costs a higher one.",
      "Each pass reads where this run placed cars and plans only for free chargers.",
      "An offer whose charger is taken moves to an equal free one, or the agent sees why.",
      "The lexicographic planner is pinned, so the same inputs give the same plan.",
    ],
    next: "No planner places a car. The decide path chooses.",
    refs: [
      "solvers/cpsat/model.py",
      "proposer/forward_proposer.py",
      "edge-functions/ottoq-cpsat-propose",
      "public.ottoq_promote_proposal_candidates",
      "public.ottoq_proposal_disposition_ledger",
    ],
  },

  decide: {
    plate: "decide",
    title: "Decide",
    tagline: "Choose one plan",
    overview: "The decide path makes every final decision. It is deterministic: the same depot state always gives the same decision and reason.",
    points: [
      "Each tick, it takes an offer, makes its own choice, or holds a car when nothing fits.",
      "It books the stall and sends the command in one transaction.",
      "Paired runs on one seed must match byte for byte, on every decision.",
      "Models and solvers cannot go around it. Only the decide path writes a booking.",
    ],
    next: "Each decision then passes the safety layer before the depot acts.",
    refs: [
      "public.ottoq_decide_tick",
      "public.ottoq_decisions",
      "public.ottoq_stall_bookings",
      "public.ottoq_vehicle_commands",
      "CERTIFICATION_STATUS.md",
    ],
  },

  safety: {
    plate: "safety",
    title: "Safety",
    tagline: "Check & enforce",
    overview: "OTTOYARD's proprietary safety layer checks decisions against deterministic, versioned rules before the depot acts. It guards what the depot does, not what a model says.",
    points: [
      "The rules are data, with versions and parameters for each fleet contract.",
      "Paired runs reproduce every verdict byte for byte.",
      "Under the rules, the database refuses double bookings and any edit to the event log.",
      "No car leaves below its charge target or with a service still needed.",
    ],
    next: "A decision that fails an enforcing check never reaches the depot.",
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
