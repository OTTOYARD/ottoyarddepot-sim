import { describe, it, expect } from "vitest";
import run from "@/components/tabs/__fixtures__/ottoqRun.1ccad49b.json";
import live from "@/engine/__fixtures__/twinRun.live0922rec.json";
import type { ActivityFeedRow } from "@/store/activityFeedStore";
import type { TwinSnapshot, TwinVisitCard } from "@/lib/ottoTwin";
import {
  DASH, buildQCard, currentVisitRows, needState, stallCodeMap, stepLabel, type QDepotCard,
} from "@/lib/vehicleQCard";

// ── fixtures ────────────────────────────────────────────────────────────────
// (1) REAL: ottoqRun.1ccad49b.json — 116 depot cards of a finished busy_day run (state, stall, target; soc and the
//     card body were not capturable for a finished run and are null). The card must stay honest on exactly that.
// (2) CONTRACT: no live ottoq_depot_cards capture with a populated `card` exists in this repo, so DC_CHARGING is built
//     key-for-key from the SQL that writes it (otto-q-core 0460: steps/needs/reservations; 0506: atom, overdue_min;
//     0507/0509: expected_end, eta_source, over_plan_min; 0512: performed_by, awaiting_triage). The VALUES are
//     illustrative; the KEYS and their meanings are the contract's.
// (3) REAL: twinRun.live0922rec.json — a recording of the public snapshot endpoint (states, stalls, reservations).

const VID = "c7d24f18-164f-46f1-88aa-6f747c6668fc";
const CLOCK = "2026-09-22T15:10:00+00:00";

const DC_CHARGING: QDepotCard = {
  vehicle_id: VID,
  display_name: "Waymo-AV-014",
  state: "in_wash_bay",
  soc: 100,
  target_soc: 100,
  stall: { id: "wash-2-id", code: "NASH-WASH-02", kind: "wash" },
  reservations: [
    { booking_id: "b1", purpose: "wash", state: "active", stall_code: "NASH-WASH-02", stall_kind: "wash",
      starts_at: "2026-09-22T15:00:00+00:00", ends_at: "2026-09-22T15:20:00+00:00", need_atom: "exterior_wash", booked_by: "otto_q" },
    { booking_id: "b2", purpose: "inspect", state: "held", stall_code: "NASH-SVC-03", stall_kind: "service_bay",
      starts_at: "2026-09-22T15:25:00+00:00", ends_at: "2026-09-22T15:31:00+00:00", need_atom: "readiness_check", booked_by: "otto_q" },
    { booking_id: "b3", purpose: "staging", state: "held", stall_code: "NASH-STG-12", stall_kind: "staging",
      starts_at: "2026-09-22T15:33:00+00:00", ends_at: "2026-09-22T16:30:00+00:00", need_atom: null, booked_by: "otto_q" },
  ],
  card: {
    urgency: "standard",
    dispatch_due_at: "2026-09-22T16:30:00+00:00",
    needs: [
      { svc: "charge", status: "done", done_at: "2026-09-22T14:52:00+00:00", must_do: true },
      { svc: "interior_inspection", status: "done", done_at: "2026-09-22T14:40:00+00:00", must_do: true, performed_by: "charger_sensors" },
      { svc: "exterior_wash", status: "in_progress", must_do: true },
      { svc: "readiness_check", status: "pending", must_do: true },
    ],
    steps: [
      { seq: 1, leg_type: "taxi", status: "done", planned_start: "2026-09-22T13:58:00+00:00", planned_end: "2026-09-22T14:01:00+00:00",
        actual_start: "2026-09-22T13:58:00+00:00", actual_end: "2026-09-22T14:01:30+00:00" },
      { seq: 2, leg_type: "charge_dcfc", atom: null, status: "done", planned_start: "2026-09-22T14:01:00+00:00", planned_end: "2026-09-22T14:45:00+00:00",
        actual_start: "2026-09-22T14:02:00+00:00", actual_end: "2026-09-22T14:52:00+00:00" },
      { seq: 3, leg_type: "taxi", status: "done", actual_end: "2026-09-22T14:58:00+00:00" },
      { seq: 4, leg_type: "wash", atom: "exterior_wash", status: "current", planned_start: "2026-09-22T15:00:00+00:00", planned_end: "2026-09-22T15:15:00+00:00",
        actual_start: "2026-09-22T15:01:00+00:00", progress_pct: 60, expected_end: "2026-09-22T15:16:00+00:00", eta_source: "plan", over_plan_min: null },
      { seq: 5, leg_type: "taxi", status: "upcoming", planned_start: "2026-09-22T15:16:00+00:00", planned_end: "2026-09-22T15:19:00+00:00" },
      { seq: 6, leg_type: "inspect", atom: "readiness_check", status: "upcoming", planned_start: "2026-09-22T15:25:00+00:00", planned_end: "2026-09-22T15:31:00+00:00" },
      { seq: 7, leg_type: "stage", status: "upcoming", planned_start: "2026-09-22T15:33:00+00:00", planned_end: "2026-09-22T16:30:00+00:00" },
      { seq: 8, leg_type: "depart", status: "upcoming", planned_start: "2026-09-22T16:30:00+00:00", planned_end: "2026-09-22T16:31:00+00:00", overdue_min: null },
    ],
  },
};

const snap = (over: Partial<TwinSnapshot> = {}): TwinSnapshot => ({
  run: { sim_run_id: "r", scenario: "busy_day", status: "running", sim_clock: CLOCK, tick_count: 1, time_scale: 60, seed: 1 },
  legs: [], fleet: { counts: {}, total: 0, vehicles: [] }, stalls_status: [],
  energy: null, bess: null, weather: null, grid: null, counters: {}, recent_events: [], variability: {},
  ...over,
});

const row = (over: Partial<ActivityFeedRow>): ActivityFeedRow => ({
  occurred_at: CLOCK, vehicle_id: VID, display_name: "Waymo-AV-014", action: "stall_assignment", engine: "deterministic",
  target: "", outcome: "enacted", rationale: null, reason: null, ...over,
});

// ── (1) the real cards: honest on what they do not carry ──────────────────────
describe("buildQCard on the captured run's depot cards (116 cars, no soc, no card body)", () => {
  const cards = (run as unknown as { cards_b: QDepotCard[] }).cards_b;
  const built = cards.map((c) => buildQCard({ vehicleId: c.vehicle_id, card: c }));

  it("builds a card for every car and names it by the engine's display name", () => {
    expect(built).toHaveLength(116);
    expect(built.every((q, i) => q.name === cards[i].display_name)).toBe(true);
  });

  it("never turns a missing SoC into a number, and never claims a car is cleared to leave", () => {
    expect(built.filter((q) => q.battery.now !== null)).toHaveLength(0);
    expect(built.filter((q) => q.battery.ofTarget !== null)).toHaveLength(0);
    expect(built.filter((q) => q.leave.cleared !== null)).toHaveLength(0);
    expect(built.every((q) => q.leave.words.includes(DASH))).toBe(true);
    // the target IS published (the engine's one answer, 100)
    expect(built.every((q) => q.battery.target === 100)).toBe(true);
  });

  it("says the steps and services were not published rather than drawing an empty plan", () => {
    expect(built.every((q) => !q.steps.published && q.steps.items.length === 0)).toBe(true);
    expect(built.every((q) => !q.needs.published)).toBe(true);
  });

  it("puts every known state into plain words (counts by state, denominator 116)", () => {
    const words = new Map<string, string>();
    for (const q of built) words.set(q.state.code ?? "", q.state.words);
    expect(words.get("charging_l2")).toBe("Charging");
    expect(words.get("charging_dcfc")).toBe("Fast charging");
    expect(words.get("staged_for_departure")).toBe("Staged to leave");
    expect(built.filter((q) => q.state.words === DASH)).toHaveLength(0);
  });

  it("marks the 19 cars parked awaiting service as in temporary staging", () => {
    const staged = built.filter((q) => q.state.code === "staged_awaiting_service");
    expect(staged).toHaveLength(19);
    expect(staged.every((q) => q.hold?.words.startsWith("In temporary staging"))).toBe(true);
  });
});

// ── (2) a contract-1.4 card ─────────────────────────────────────────────────
describe("buildQCard on a contract-1.4 card", () => {
  const q = buildQCard({ vehicleId: VID, card: DC_CHARGING, snapshot: snap() });

  it("lists the stations in plan order, drives between them folded away", () => {
    expect(q.steps.items.map((s) => `${s.state}:${s.label}`)).toEqual([
      "done:Fast charge", "current:Exterior wash", "upcoming:Readiness check", "upcoming:Staging", "upcoming:Ready to leave",
    ]);
  });

  it("ticks a done step with the time it actually finished", () => {
    const done = q.steps.items[0];
    expect(done.doneAt).toBe("2026-09-22T14:52:00+00:00");
    expect(done.progress).toBeNull();
  });

  it("shows the current station's progress and end time, as the card published them", () => {
    expect(q.now.what).toBe("Exterior wash");
    expect(q.now.place).toBe("wash bay 02");
    expect(q.now.progress).toBe(60);
    expect(q.now.eta).toBe("2026-09-22T15:16:00+00:00");
    expect(q.now.etaSource).toBe("plan");
  });

  it("names each upcoming station from its live booking, with the booked window", () => {
    const insp = q.steps.items[2];
    expect(insp.place).toBe("service bay 03");
    expect(insp.windowKind).toBe("booked");
    expect([insp.from, insp.to]).toEqual(["2026-09-22T15:25:00+00:00", "2026-09-22T15:31:00+00:00"]);
    expect(q.steps.items[3].place).toBe("parking 12");
    // no booking for leaving: its own planned window, and no station invented
    expect(q.steps.items[4].place).toBeNull();
    expect(q.steps.items[4].windowKind).toBe("planned");
    expect(q.next?.label).toBe("Readiness check");
  });

  it("lists the services with done times and who did them", () => {
    expect(q.needs.items.map((n) => `${n.state}:${n.svc}`)).toEqual([
      "done:charge", "done:interior_inspection", "active:exterior_wash", "open:readiness_check",
    ]);
    expect(q.needs.items[1].note).toBe("by the charger's sensors");
  });

  it("is not cleared to leave with services open, even at a full battery (rule 9)", () => {
    expect(q.leave.cleared).toBe(false);
    expect(q.leave.words).toBe("Not cleared to leave: 2 services open (exterior wash, readiness check)");
  });

  it("clears to leave only at target with every service done; a deferred service does not hold it", () => {
    const done: QDepotCard = { ...DC_CHARGING, card: { ...DC_CHARGING.card!, needs: [
      { svc: "charge", status: "done" }, { svc: "interior_tidy", status: "deferred" },
    ] } };
    expect(buildQCard({ vehicleId: VID, card: done }).leave.cleared).toBe(true);
    const low = { ...done, soc: 96 };
    const ql = buildQCard({ vehicleId: VID, card: low });
    expect(ql.leave.cleared).toBe(false);
    expect(ql.leave.words).toBe("Not cleared to leave: battery 96% of 100%");
    // an unknown status is still owed
    const odd: QDepotCard = { ...done, card: { ...done.card!, needs: [{ svc: "charge", status: "queued_for_robot" }] } };
    expect(buildQCard({ vehicleId: VID, card: odd }).leave.cleared).toBe(false);
  });

  it("shows only the last three finished steps the card carries, and says earlier ones exist", () => {
    expect(q.steps.earlierHidden).toBe(true); // three done legs published (two taxis folded)
    const one = { ...DC_CHARGING, card: { ...DC_CHARGING.card!, steps: DC_CHARGING.card!.steps!.slice(3) } };
    expect(buildQCard({ vehicleId: VID, card: one }).steps.earlierHidden).toBe(false);
  });
});

describe("buildQCard: moving, re-assigned, holding", () => {
  it("a car driving between stations is 'on the way to' its next one", () => {
    const steps = DC_CHARGING.card!.steps!.map((s) =>
      s.seq === 4 ? { ...s, status: "done", actual_end: "2026-09-22T15:16:00+00:00" } : s.seq === 5 ? { ...s, status: "current", progress_pct: 30 } : s);
    const q = buildQCard({ vehicleId: VID, card: { ...DC_CHARGING, card: { ...DC_CHARGING.card!, steps } } });
    expect(q.now.what).toBe("On the way to readiness check");
    expect(q.now.place).toBe("service bay 03");
    expect(q.steps.items.find((s) => s.enRoute)?.label).toBe("Readiness check");
    expect(q.steps.items.filter((s) => s.enRoute)).toHaveLength(1);
  });

  it("marks a future step OTTO-Q re-booked, from the car's own decision", () => {
    const feed = [
      row({ action: "reservation_reopt", target: "NASH-SVC-03", occurred_at: "2026-09-22T15:05:00+00:00", rationale: { verb: "rebook", source: "cuopt" } }),
    ];
    const q = buildQCard({ vehicleId: VID, card: DC_CHARGING, feed });
    const insp = q.steps.items.find((s) => s.label === "Readiness check")!;
    expect(insp.reassigned).toEqual({ at: "2026-09-22T15:05:00+00:00", was: null });
    expect(q.steps.items.filter((s) => s.reassigned)).toHaveLength(1);
    expect(q.changes[0].words).toBe("Re-booked to service bay 03");
  });

  it("names the station a re-plan replaced, from the snapshot's amended leg", () => {
    const codes = stallCodeMap([{ id: "svc-1", code: "NASH-SVC-01" }, { id: "svc-3", code: "NASH-SVC-03" }]);
    const leg = (status: string, to: string) => ({
      leg_id: `l-${status}`, vehicle_id: VID, seq: 6, leg_type: "inspect", intent: null, kind: "distribution",
      from_stall: null, to_stall: to, from_x: null, from_y: null, to_x: null, to_y: null,
      start_sim: "2026-09-22T15:25:00+00:00", end_sim: "2026-09-22T15:31:00+00:00", duration_s: 360, status, geometry: "measured",
    });
    const q = buildQCard({ vehicleId: VID, card: DC_CHARGING, stallCodes: codes,
      snapshot: snap({ legs: [leg("amended", "svc-1"), leg("planned", "svc-3")] }) });
    const insp = q.steps.items.find((s) => s.label === "Readiness check")!;
    expect(insp.reassigned?.was).toBe("service bay 01");
    expect(insp.place).toBe("service bay 03");
  });

  it("never marks a step re-assigned without a record that says so", () => {
    const q = buildQCard({ vehicleId: VID, card: DC_CHARGING, snapshot: snap() });
    expect(q.steps.items.filter((s) => s.reassigned)).toHaveLength(0);
    expect(q.changes).toHaveLength(0);
  });

  it("a temporary-hold booking reads as a hold until OTTO-Q re-orchestrates", () => {
    const held: QDepotCard = { ...DC_CHARGING, reservations: [
      { purpose: "temp_hold", state: "active", stall_code: "NASH-STG-04", stall_kind: "staging", ends_at: "2026-09-22T15:40:00+00:00" },
    ] };
    const q = buildQCard({ vehicleId: VID, card: held });
    expect(q.hold).toEqual({ words: "Temporary hold until OTTO-Q re-orchestrates", place: "parking 04", until: "2026-09-22T15:40:00+00:00" });
  });

  it("a standing wait is a hold; once the car is sent on it is not", () => {
    const wait = row({ action: "stall_assignment", outcome: "noop_no_candidate", rationale: { verb: "hold_no_bay" }, standing: true });
    const q = buildQCard({ vehicleId: VID, card: DC_CHARGING, feed: [row({ occurred_at: "2026-09-22T14:00:00+00:00" }), wait] });
    expect(q.hold?.words).toBe("Holding: no free bay");
    const sent = row({ occurred_at: "2026-09-22T15:20:00+00:00", rationale: { verb: "admit_wash" } });
    expect(buildQCard({ vehicleId: VID, card: DC_CHARGING, feed: [wait, sent] }).hold).toBeNull();
  });

  it("reads only the visit the car is on (rows before its last departure are another visit)", () => {
    const rows = [
      row({ occurred_at: "2026-09-22T10:00:00+00:00", action: "reservation_reopt", target: "NASH-SVC-03" }),
      row({ occurred_at: "2026-09-22T11:00:00+00:00", action: "redeployment", rationale: { verb: "deploy" } }),
      row({ occurred_at: "2026-09-22T14:00:00+00:00", rationale: { verb: "assign_stall" } }),
    ];
    expect(currentVisitRows(rows).map((r) => r.occurred_at)).toEqual(["2026-09-22T14:00:00+00:00"]);
    expect(buildQCard({ vehicleId: VID, card: DC_CHARGING, feed: rows }).changes).toHaveLength(0);
  });
});

// ── (3) the snapshot alone ──────────────────────────────────────────────────
describe("buildQCard from the twin snapshot alone", () => {
  // the exact visit shape visitWorkflow.test.ts carries (ottoq_twin_snapshot, run 53660b86, 2026-08-11)
  const visit: TwinVisitCard = {
    visit_id: "ea632e4b-ead6-49ab-9e7a-0d37e86625bc", visit_status: "in_progress", archetype: "std_mixed", urgency: "standard",
    arrived_at: "2026-08-11T17:55:28.962438+00:00", target_soc: 89, soc_at_arrival: 42, est_charge_min: 81,
    atoms: [
      { svc: "charge", status: "in_progress", must_do: true, est_min: 81 },
      { svc: "readiness_check", status: "pending", must_do: true, est_min: 3 },
      { svc: "interior_inspection", status: "done", must_do: true, est_min: 3 },
    ],
  };
  const s = snap({ fleet: { counts: {}, total: 1, vehicles: [
    { id: VID, av_id: "twin-sim-014", make: "Waymo", platform: "waymo", state: "charging_dcfc", soc: 61, stall_id: "dc-4", visit },
  ] }, arm: { cycles: [{ cycle_id: "c", stall_id: "dc-4", vehicle_id: VID, direction: "mate", phase: "approach", phase_deadline: null, started_at: null, retry_count: 1 }] } });
  const q = buildQCard({ vehicleId: VID, snapshot: s, stallCodes: stallCodeMap([{ id: "dc-4", code: "NASH-DCFC-STALL-04" }]) });

  it("takes SoC, target and arrival SoC from the twin, and services from the visit's atoms", () => {
    expect(q.battery).toEqual({ now: 61, target: 89, ofTarget: (61 / 89) * 100, onArrival: 42 });
    expect(q.needs.items.map((n) => `${n.state}:${n.svc}:${n.estMin}`)).toEqual([
      "active:charge:81", "open:readiness_check:3", "done:interior_inspection:3",
    ]);
    // the snapshot's atoms carry no done time: the tick has no time rather than an invented one
    expect(q.needs.items[2].doneAt).toBeNull();
  });

  it("says where the car is and what the arm is doing, and that no plan steps were published", () => {
    expect(q.now.what).toBe("Fast charging");
    expect(q.now.place).toBe("fast charger 04");
    expect(q.now.progress).toBeNull();
    expect(q.now.eta).toBeNull();
    expect(q.now.arm).toBe("Charge arm plugging in (retry 1)");
    expect(q.steps.published).toBe(false);
    expect(q.leave.words).toBe("Not cleared to leave: battery 61% of 89%, 2 services open (charge, readiness check)");
  });
});

describe("buildQCard over the recorded live snapshot feed (twinRun.live0922rec)", () => {
  type F = { roster: { id: string; av_id: string; make: string; platform: string; soc: number }[];
    stalls: { id: string; code: string }[]; frames: { t: string; changes: { id: string; state: string; stall_id: string | null }[] }[] };
  const F = live as unknown as F;
  const states = new Map<string, { state: string; stall_id: string | null }>();
  for (const f of F.frames.slice(0, 60)) for (const c of f.changes) states.set(c.id, c);
  const vehicles = F.roster.filter((r) => states.has(r.id) && states.get(r.id)!.state !== "__gone__")
    .map((r) => ({ ...r, state: states.get(r.id)!.state, stall_id: states.get(r.id)!.stall_id }));
  const s = snap({ fleet: { counts: {}, total: vehicles.length, vehicles } });
  const codes = stallCodeMap(F.stalls);
  // the renderer's label, built as TwinMotionDriver builds it (none when the car has no av id)
  const cards = vehicles.map((v) => buildQCard({ vehicleId: v.id, snapshot: s, stallCodes: codes, label: v.av_id ? `${v.av_id} · ${v.make}` : null }));

  it("builds a card per car on the recording, with no visit published (that backend predates it)", () => {
    expect(cards.length).toBeGreaterThan(50);
    expect(cards.every((q) => !q.needs.published && q.leave.cleared === null)).toBe(true);
    // named by the fleet id, or the vehicle id when the recording carries none — never "null"
    expect(cards.every((q, i) => q.name === (vehicles[i].av_id ?? vehicles[i].id))).toBe(true);
  });

  it("names the stall of every car the recording puts in one", () => {
    const inStall = vehicles.filter((v) => v.stall_id && codes.has(v.stall_id));
    const named = cards.filter((q) => q.now.place !== null);
    expect(named).toHaveLength(inStall.length);
    expect(inStall.length).toBeGreaterThan(0);
  });
});

describe("vocabulary", () => {
  it("needState is total, and reads anything unknown as still owed", () => {
    expect(["done", "in_progress", "deferred", "skipped", "pending", "", null, "mystery"].map(needState))
      .toEqual(["done", "active", "deferred", "dropped", "open", "open", "open", "open"]);
  });
  it("stepLabel says which inspection, and uses the station words", () => {
    expect(stepLabel({ leg_type: "inspect", atom: "readiness_check" })).toBe("Readiness check");
    expect(stepLabel({ leg_type: "stage", atom: null })).toBe("Staging");
    expect(stepLabel({ leg_type: "charge_l2" })).toBe("Charge");
  });
});
