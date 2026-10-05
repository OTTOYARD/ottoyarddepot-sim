import { describe, expect, it } from "vitest";
import type { ActivityFeedRow } from "@/store/activityFeedStore";
import {
  buildTrail, depotFunnel, splitVisits, type TrailCard, type TrailChoice, type TrailDecision, type TrailProposal,
} from "./decisionTrail";

// Rows shaped exactly as ottoq_activity_feed_v2 returned them on twin runs 8ddd0752 and e9e3b922 (2026-09-28).
const CAR = "229f655b-803c-47c0-95fd-ca8adb9d8ef0";
let seq = 100;
const row = (min: number, over: Partial<ActivityFeedRow>): ActivityFeedRow => ({
  occurred_at: new Date(Date.parse("2026-09-28T18:00:00Z") + min * 60_000).toISOString(),
  vehicle_id: CAR,
  display_name: "Zoox-AV-095",
  action: "stall_assignment",
  engine: "deterministic_v1",
  target: "",
  outcome: "enacted",
  rationale: {},
  reason: null,
  decision_seq: seq++,
  tick_seq: min,
  held_ticks: 1,
  last_at: null,
  standing: false,
  ...over,
});

const noFreeCharger = row(0, {
  outcome: "noop_no_candidate", target: null as unknown as string,
  rationale: { reason: "no_compatible_available_stall", wanted_type: "dcfc" }, last_at: "2026-09-28T18:06:00.000Z", held_ticks: 12,
});
const blocked = row(2, {
  action: "task_start", outcome: "overridden_to_default", target: "hold_in_queue",
  rationale: { verb: "hold_in_queue", reason: "service_shield_blocked", override_rule_codes: ["HW.005.vehicle_one_active_task"] },
});
const assign = row(7, {
  target: "NASH-DCFC-STALL-03",
  rationale: { verb: "assign_stall", soc: 60, stall_type: "dcfc", wanted_type: "dcfc", urgency: "immediate_dispatch", power_downgrade: false },
});
const replanned = row(20, { action: "itinerary_amended", target: "amend_plan", rationale: { verb: "amend_plan", shift_s: 1215 } });
const triage = row(25, { action: "triage_verdict", target: "triage_confirm", rationale: { verb: "triage_confirm", svc: "interior_tidy" } });
const service = row(40, { action: "task_start", target: "NASH-SVC-02", rationale: { verb: "admit_service", stall_type: "service_bay" } });
const deploy = row(95, { action: "redeployment", target: "deploy", rationale: { verb: "deploy", soc: 100, floor: 80 } });
const agent = { ...row(1, { action: "orchestrator_agent", display_name: "OTTO-Q PRIME" }), vehicle_id: "00000000-0000-0000-0000-000000000000" };

const decisions: TrailDecision[] = [
  { decision_seq: blocked.decision_seq!, tick_seq: 2, sim_clock: blocked.occurred_at, overridden: true,
    override_rule_codes: ["HW.005.vehicle_one_active_task"], rule_results: null },
  { decision_seq: assign.decision_seq!, tick_seq: 7, sim_clock: assign.occurred_at, overridden: false, override_rule_codes: null,
    stall_id: "stall-03",
    rule_results: [
      { rule_code: "EN.001.grid_capacity_ceiling", passed: true }, { rule_code: "HW.001.connector_compatibility", passed: true },
      { rule_code: "HW.002.charger_state_precondition", passed: true },
    ] },
  { decision_seq: service.decision_seq!, tick_seq: 40, sim_clock: service.occurred_at, overridden: false, override_rule_codes: null,
    rule_results: [{ rule_code: "HW.004.stall_single_vehicle", passed: true }, { rule_code: "SM.002.task_transition_validity", passed: true }] },
];
const proposals: TrailProposal[] = [
  { tick_seq: 7, status: "enacted", stall_id: "stall-03", abstain: false, end_min: 45 },
  { tick_seq: 7, status: "superseded", stall_id: "stall-05", abstain: false, end_min: 60 },
  { tick_seq: 7, status: "refused", stall_id: null, abstain: true, end_min: null },
  { tick_seq: 3, status: "superseded", stall_id: "stall-09", abstain: false, end_min: 10 }, // another tick: not compared
];
const card: TrailCard = {
  vehicle_id: CAR, display_name: "Zoox-AV-095", state: "charging_dcfc", soc: 72, target_soc: 100,
  stall: { id: "stall-03", code: "NASH-DCFC-STALL-03", kind: "dcfc" },
  reservations: [{ purpose: "wash", booked_by: "fleet_operator", starts_at: "2026-09-28T18:30:00Z", need_atom: "wash" }],
  card: {
    dispatch_due_at: "2026-09-28T19:50:00Z",
    needs: [{ svc: "charge", status: "done" }, { svc: "interior_tidy", status: "done" }, { svc: "detail", status: "deferred" }],
    steps: [
      { seq: 1, leg_type: "taxi", status: "done", planned_end: null },
      { seq: 2, leg_type: "charge_dcfc", status: "current", planned_end: null, progress_pct: 50 },
      { seq: 3, leg_type: "depart", status: "upcoming", planned_end: null },
    ],
    current_step: { seq: 2, leg_type: "charge_dcfc", status: "current", planned_end: null, progress_pct: 50 },
    next_step: { seq: 3, leg_type: "depart", status: "upcoming", planned_end: null },
  },
};

const everything = [deploy, service, triage, replanned, assign, blocked, noFreeCharger, agent];

describe("a car's trail", () => {
  const t = buildTrail({ vehicleId: CAR, name: "Zoox-AV-095", rows: everything, decisions, proposals, card });
  const titles = t.steps.map((s) => s.title);

  it("runs arrived -> checked -> found -> picked -> safety -> sent -> done, with branches inline in time order", () => {
    expect(titles).toEqual([
      "Arrived",
      "Owner request",
      "Checked the depot",
      "Waited",
      "Safety check stopped it",
      "Found 2 ways to do it",
      "Picked fast charger 03",
      "3 safety checks passed",
      "Sent to fast charger 03",
      "Re-planned",
      "Service added",
      "Sent to service bay 02",
      "Done",
    ]);
    expect(t.steps.filter((s) => s.branch).map((s) => s.kind)).toEqual(["owner_request", "waited", "blocked", "replanned", "service_added"]);
  });

  it("fills every sentence from real fields", () => {
    const by = (k: string) => t.steps.find((s) => s.kind === k)!;
    expect(by("arrived").detail).toBe("Needs charge to 100%, interior tidy and full detail. Must be ready by 2:50 PM.");
    expect(by("arrived").at).toBe(noFreeCharger.occurred_at);
    expect(by("checked").detail).toBe("Looked for a free fast charger.");
    expect(by("waited").detail).toBe("No free fast charger, for 6 minutes");
    expect(by("picked").detail).toBe("Ready 1:52 PM, against 2:07 PM for the next best.");
    expect(by("sent").detail).toBe("at 1:07 PM");
    expect(t.steps[11].detail).toBe("at 1:40 PM · 2 safety checks passed");
    expect(by("done").detail).toBe("Battery 100%. Charge and interior tidy done. Full detail moved to next visit. Left 2:35 PM, 15 minutes before due.");
    expect(by("owner_request").detail).toBe("wash, booked 1:30 PM");
  });

  it("says what blocked a safety check and what happened next, by the rule's meaning", () => {
    const b = t.steps.find((s) => s.kind === "blocked")!;
    expect(b.tone).toBe("warn");
    expect(b.detail).toBe("Failed: one step at a time per car. Kept it in line instead.");
  });

  it("words a re-plan with how far it moved", () => {
    expect(t.steps.find((s) => s.kind === "replanned")!.detail).toBe("Plan re-timed: 20 minutes later");
  });

  it("never shows a tick number, a table name, a rule code or an engine name", () => {
    const text = t.steps.map((s) => `${s.title} ${s.detail ?? ""}`).join(" | ");
    expect(text).not.toMatch(/tick|ottoq_|[A-Z]{2,3}\.\d{3}|deterministic|shield|proposal|SoC|_/);
  });

  it("summarises the card at rest: left, full progress, no next step", () => {
    expect(t.left).toBe(true);
    expect(t.now).toBe("Left the depot");
    expect(t.progress).toBe(100);
    expect(t.next).toBeNull();
  });

  it("shows a car still in the depot on its current step, with progress and next", () => {
    const live = buildTrail({ vehicleId: CAR, name: "Zoox-AV-095", rows: [assign, noFreeCharger], decisions, proposals, card });
    expect(live.left).toBe(false);
    expect(live.now).toBe("Fast charge");
    expect(live.next).toBe("Leave");
    expect(live.progress).toBe(50); // one of three steps done, the second half done
  });

  it("reads the chosen plan's ready time from the car's own plan when no planner offer carries it", () => {
    const planned: TrailCard = { ...card, card: { ...card.card!, steps: [
      { seq: 1, leg_type: "taxi", status: "done", planned_end: "2026-09-28T18:09:00Z" },
      { seq: 2, leg_type: "charge_dcfc", status: "current", planned_end: "2026-09-28T18:52:00Z" },
      { seq: 3, leg_type: "inspect", status: "upcoming", planned_end: "2026-09-28T19:02:00Z" },
      { seq: 4, leg_type: "depart", status: "upcoming", planned_end: "2026-09-28T19:05:00Z" },
    ] } };
    const t = buildTrail({ vehicleId: CAR, name: "Zoox-AV-095", rows: [assign], card: planned });
    expect(t.steps.find((s) => s.kind === "picked")!.detail).toBe("Ready 2:02 PM.");
  });

  it("says why a car with no plan step yet is waiting", () => {
    const waiting = buildTrail({ vehicleId: CAR, name: "Zoox-AV-095", rows: [noFreeCharger] });
    expect(waiting.now).toBe("Waiting: no free fast charger");
    const sentSince = buildTrail({ vehicleId: CAR, name: "Zoox-AV-095", rows: [noFreeCharger, assign] });
    expect(sentSince.now).toBe("Sent to fast charger 03");
  });

  it("shows missing data as missing, never guessed", () => {
    const bare = buildTrail({ vehicleId: CAR, name: "Zoox-AV-095", rows: [assign] });
    const by = (k: string) => bare.steps.find((s) => s.kind === k)!;
    expect(by("arrived").detail).toBe("Needs not recorded. Must be ready by not recorded.");
    expect(by("arrived").tone).toBe("missing");
    expect(by("options").title).toBe("Found ways to do it");
    expect(by("options").detail).toBe("Options compared: not recorded.");
    expect(by("picked").detail).toBe("Why it was picked: not recorded.");
    expect(by("safety").detail).toBe("Checks run: not recorded.");
    expect(bare.progress).toBeNull();
  });

  it("shows only the latest visit when a car came back", () => {
    const again = row(120, { target: "NASH-L2-STALL-14", rationale: { verb: "assign_stall", stall_type: "l2" } });
    expect(splitVisits([...everything, again]).length).toBe(2);
    const t2 = buildTrail({ vehicleId: CAR, name: "Zoox-AV-095", rows: [...everything, again] });
    expect(t2.steps.map((s) => s.title)).toContain("Sent to standard charger 14");
    expect(t2.steps.map((s) => s.title)).not.toContain("Sent to fast charger 03");
  });
});

describe("a car's trail with the engine's own record of each charger choice (otto-q-core 0590)", () => {
  // Shaped as ottoq_decision_options returned them on run 1ebae97a (Waymo-AV-004's wait, then its pick).
  const wait: TrailChoice = {
    decision_seq: noFreeCharger.decision_seq!, tick_seq: 0, at: noFreeCharger.occurred_at, outcome: "noop_no_candidate",
    engine: "deterministic_v1", chosen: null,
    depot: { free_fast: 0, free_standard: 2, cars_waiting: 36, waiting_for_charge: 21 },
    car: { soc: 60, wanted_kind: null, why_wanted: null },
    agrees: true, options_found: 0, options_by_kind: { dcfc: 0, l2: 0 }, why: null, downgrade: false, options: null,
  };
  const pickChoice = (over: Partial<TrailChoice> = {}): TrailChoice => ({
    decision_seq: assign.decision_seq!, tick_seq: 7, at: assign.occurred_at, outcome: "enacted", engine: "deterministic_v1",
    chosen: { stall_id: "stall-03", stall_code: "NASH-DCFC-STALL-03", kind: "dcfc" },
    depot: { free_fast: 3, free_standard: 9, cars_waiting: 30, waiting_for_charge: 18 },
    car: { soc: 38, wanted_kind: "dcfc", why_wanted: "low_battery" },
    agrees: true, options_found: 11, options_by_kind: { dcfc: 3, l2: 8 }, why: "wanted_kind", downgrade: false,
    options: [
      { rank: 1, stall_code: "NASH-DCFC-STALL-03", kind: "dcfc", kw: 350, chosen: true, charge_min: 42 },
      { rank: 2, stall_code: "NASH-DCFC-STALL-07", kind: "dcfc", kw: 350, chosen: false, charge_min: 44.6 },
      { rank: 3, stall_code: "NASH-L2-STALL-34", kind: "l2", kw: 19.2, chosen: false, charge_min: 188 },
    ],
    ...over,
  });
  const run = (choices: TrailChoice[]) =>
    buildTrail({ vehicleId: CAR, name: "Zoox-AV-095", rows: [noFreeCharger, assign], decisions, proposals: [], choices, card });
  const by = (t: ReturnType<typeof run>, k: string) => t.steps.find((x) => x.kind === k)!;

  it("says what the depot had, how many ways it found, why it picked one and how long each would take", () => {
    const t = run([wait, pickChoice()]);
    expect(by(t, "checked").detail).toBe("0 fast chargers and 2 standard chargers were free. 21 cars waited for a charge.");
    expect(by(t, "waited").detail).toBe("None of the 2 free chargers could take it, for 6 minutes");
    expect(by(t, "options")).toMatchObject({
      title: "Found 11 ways to do it",
      detail: "Best 3: fast charger 03, fast charger 07 and standard charger 34.",
      tone: "ok",
    });
    expect(by(t, "picked")).toMatchObject({
      title: "Picked fast charger 03",
      detail: "It needed a fast charger: battery 38%. Charges in 42 minutes here, against 45 minutes at fast charger 07.",
      tone: "ok",
    });
  });

  it("names a car that got a kind it did not want, and why", () => {
    const t = run([pickChoice({
      chosen: { stall_id: "s20", stall_code: "NASH-L2-STALL-20", kind: "l2" },
      car: { soc: 78, wanted_kind: "dcfc", why_wanted: "due_now" }, why: "only_option", downgrade: true,
      options_found: 1, options_by_kind: { dcfc: 0, l2: 1 },
      options: [{ rank: 1, stall_code: "NASH-L2-STALL-20", kind: "l2", kw: 19.2, chosen: true, charge_min: 94 }],
    })]);
    expect(by(t, "options")).toMatchObject({ title: "Found 1 way to do it", detail: null });
    expect(by(t, "picked").detail)
      .toBe("No fast charger could take it, so it took a standard charger. It was the only one it could use. Charges in 1 hr 34 min here.");
  });

  it("falls back to 'not recorded' where the rebuild does not reproduce the engine", () => {
    const t = run([{ ...pickChoice(), agrees: false, options_found: null, options_by_kind: null, why: null, options: null }]);
    expect(by(t, "options").detail).toBe("Options compared: not recorded.");
    // and this card's plan carries no times, so there is nothing else to say why
    expect(by(t, "picked").detail).toBe("Why it was picked: not recorded.");
    expect(by(t, "picked").tone).toBe("missing");
  });

  it("never shows a stall code, a rule code or an engine name", () => {
    const text = run([wait, pickChoice()]).steps.map((x) => `${x.title} ${x.detail ?? ""}`).join(" | ");
    expect(text).not.toMatch(/NASH-|deterministic|[A-Z]{2,3}\.\d{3}|_|tick/);
  });
});

describe("the depot funnel", () => {
  const other = "11111111-2222-3333-4444-555555555555";
  const rows = [
    ...everything,
    { ...noFreeCharger, vehicle_id: other, decision_seq: 900 },
  ];

  it("counts cars at each stage, and cars that took each branch", () => {
    const f = depotFunnel(rows);
    expect(f).toEqual({
      asked: 2, planned: 1, passed: 1, sent: 1, done: 1,
      branches: { replanned: 1, waited: 2, blocked: 1, serviceAdded: 1 },
    });
  });

  it("counts only the window it is asked for", () => {
    const f = depotFunnel(rows, "2026-09-28T19:00:00Z");
    expect(f.asked).toBe(1);
    expect(f.done).toBe(1);
    expect(f.sent).toBe(0);
  });

  it("does not count the agent or the depot battery as a car", () => {
    expect(depotFunnel([agent]).asked).toBe(0);
  });
});
