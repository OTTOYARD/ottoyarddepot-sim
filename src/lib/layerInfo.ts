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
// Chase, 2026-10-12: the layers read "too vague and not technical enough"; "Keep it concise, and don't paraphrase or use
// colloquial language ... Direct, technical when needed, and understandable." So each card names the mechanism and its
// guarantee (the objective set, the lexicographic goal order and hard constraints, the futures test on an agent order,
// the one-transaction commit, the database constraints), in the same three-part shape and length.
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
    tagline: "Objective · charge order",
    overview: "An agent on an NVIDIA open model reads the live depot state each pass. It proposes the planners' objective and an order for the charge line.",
    points: [
      "Objective: readiness first, throughput first or energy balanced.",
      "Charge order: which waiting cars take the next free chargers, and which charger type.",
      "The decide path simulates both orders and adopts the agent's only if it wins the expected and most sampled futures.",
      "Calls run asynchronously, so a tick never waits. Each call is logged to an append-only ledger.",
    ],
    next: "It only proposes. The decide path seats every car.",
    refs: [
      "edge-functions/ottoq-orchestrator-agent",
      "public.ottoq_agent_charge_orders",
      "public.ottoq_charge_order_verdict_v2 (0620: the expected future and the win fraction)",
      "public.ottoq_agent_board",
      "public.ottoq_model_call_ledger",
      "public.ottoq_policy_param_catalog",
    ],
  },

  planners: {
    plate: "planners",
    title: "Planners",
    tagline: "Constrained optimization",
    overview: "The planners solve the depot schedule and offer assignments: this car, this stall, this time. They combine state-of-the-art lexicographic optimization with GPU-accelerated and heuristic solvers.",
    points: [
      "Goals solve in strict order: lateness against each car's ready time first, then peak site power.",
      "Hard constraints: one car per stall, the site power cap, charge curves and fast-charger cooldown.",
      "Each pass plans only for free chargers: not faulted, booked or occupied.",
      "The lexicographic planner is pinned, so the same inputs give the same plan. GPU offers are recorded for replay.",
    ],
    next: "No planner places a car. The decide path chooses.",
    refs: [
      "solvers/cpsat/model.py (AddNoOverlap per point, AddCumulative on power_cap_kw_hard, DCFC cooldown)",
      "policies/forward.py (lexicographic chain: min_tardy first, then min_peak)",
      "proposer/forward_proposer.py",
      "edge-functions/ottoq-cpsat-propose",
      "public.ottoq_promote_proposal_candidates",
      "public.ottoq_proposal_disposition_ledger",
    ],
  },

  decide: {
    plate: "decide",
    title: "Decide",
    tagline: "Deterministic commit",
    overview: "The decide path makes every final decision. It is deterministic: the same depot state always gives the same decision and reason.",
    points: [
      "Each tick it adopts an offer, computes its own choice, or holds the car with a recorded reason.",
      "It alone writes bookings: the stall booking and the vehicle command commit in one transaction.",
      "Its charge line: cars due out first, then cars past the wait limit, then the shortest charges.",
      "Paired runs on one seed must match byte for byte, on every decision.",
    ],
    next: "Each decision then passes the safety layer before the depot acts.",
    refs: [
      "public.ottoq_decide_tick",
      "public.ottoq_decisions",
      "public.ottoq_stall_bookings",
      "public.ottoq_vehicle_commands",
      "db/migrations/0642 (due out, the wait floor longest first, then minutes of charge)",
      "CERTIFICATION_STATUS.md",
    ],
  },

  safety: {
    plate: "safety",
    title: "Safety",
    tagline: "Rule enforcement",
    overview: "OTTOYARD's proprietary safety layer checks decisions against deterministic, versioned rules before the depot acts. It guards what the depot does, not what a model says.",
    points: [
      "Rules are versioned data with per-contract parameters. Paired runs reproduce every verdict byte for byte.",
      "Each decision point either refuses a failed check or records it. Every evaluation is logged.",
      "Database constraints refuse double bookings, two cars per stall and any edit to the event log.",
      "No car leaves below its charge target or with an open service.",
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
    tagline: "Execution · telemetry",
    overview: "The depot executes each command and reports its state. Here it is OTTO-TWIN, a simulated depot on a real site's tables.",
    points: [
      "Cars drive the lanes, charge on DCFC and L2, use the bays and leave ready.",
      "Arrivals, faults and weather come from distributions fitted to public data.",
      "Each random draw depends only on the run seed, the item and the sim time, so a run replays exactly.",
      "OTTO-Q holds no simulation code, so a real depot can take its place. The 3D view only draws.",
    ],
    next: "The new state feeds the next tick, and the agent reads it again.",
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
