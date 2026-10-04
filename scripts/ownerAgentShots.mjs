#!/usr/bin/env node
// ============================================================================
// ownerAgentShots — what owners' agents set, as the twin shows it (otto-q-core 0608): the tapped car's Q card block, the
// Agent tab's owner lines, and the violet mark on the cars in 2D and 3D. Desktop 1440x900, FULLY STUBBED, READ-ONLY.
//
// Nothing reaches the backend and nothing presses Start/Pause/Stop. Served:
//   the snapshot     the recorded run twinRun.fresh0922.json (real twin cars and stalls), as qCardShots.mjs serves it
//   depot cards      every car as the recording has it, named as the twin names it (run 1ccad49b's cards: the twin's
//                    fleet ids do not change between runs); the tapped car gets qCardShots' contract-shaped STUB card
//   decision stream  run 1ccad49b's real decisions (same fleet), re-timed onto the recording's clock
//   owner board      a board in 0608's EXACT shape, built from the real capture
//                    (src/components/tabs/__fixtures__/depotOwnerBoard.0608.json): its agents, its sentences and its
//                    objects (cloned, so the keys are the function's own), re-keyed to the twin's real Teslas
// Every other request to Supabase (and to any other host) is aborted. Nothing shown is live state.
//
//   PORT=8096 npx vite --host 127.0.0.1 --port 8096    # in another shell
//   node scripts/ownerAgentShots.mjs --url http://127.0.0.1:8096/ --out docs/screenshots/2026-10-04-owner-agents
//
// ⚠️ Software GL in a sandbox draws ~1 frame a second: this checks PLACEMENT and WORDS, not smoothness.
// ============================================================================
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return dflt;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith("--") ? true : v;
};
const URL_ = String(arg("url", "http://127.0.0.1:8096/"));
const OUT = resolve(String(arg("out", "docs/screenshots/2026-10-04-owner-agents")));
const SECS = Number(arg("secs", 70));
const PRESET = String(arg("preset", "Operator"));
const CHROMIUM = arg("chromium", existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
mkdirSync(OUT, { recursive: true });

const read = (p) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));
const F = read("src/engine/__fixtures__/twinRun.fresh0922.json");
const RUN1 = read("src/components/tabs/__fixtures__/ottoqRun.1ccad49b.json");
const CAP = read("src/components/tabs/__fixtures__/depotOwnerBoard.0608.json");
const RUN = "f1f1f1f1-0922-4000-8000-000000000003"; // synthetic: never a real run id
const DEPOT = "11111111-1111-1111-1111-111111111111";
const iso = (ms) => new Date(ms).toISOString();
const NAME = new Map(RUN1.cards_b.map((c) => [c.vehicle_id, c.display_name]));
const name = (id) => NAME.get(id) ?? F.roster.find((r) => r.id === id)?.av_id ?? id;

// ── the recording, as qCardShots plays it ────────────────────────────────────
function worldAt(ms) {
  const states = new Map();
  let last = F.frames[0];
  for (const f of F.frames) {
    if (f.wall_ms > ms) break;
    for (const c of f.changes) c.state === "__gone__" ? states.delete(c.id) : states.set(c.id, c);
    last = f;
  }
  const clock = Date.parse(last.t) + (ms - last.wall_ms) * (F.speedX ?? 1);
  const vehicles = F.roster.filter((r) => states.has(r.id)).map((r) => {
    const s = states.get(r.id);
    return { id: r.id, av_id: r.av_id, make: r.make, platform: r.platform, state: s.state, soc: r.soc, stall_id: s.stall_id };
  });
  return { clock, vehicles };
}
let t0 = null, ticks = 0;
const playback = () => (t0 === null ? -1 : (Date.now() - t0) / 1000);
const now = () => worldAt(t0 === null ? 0 : Date.now() - t0);

function snapshot() {
  const { clock, vehicles } = now();
  const counts = {};
  for (const v of vehicles) counts[v.state] = (counts[v.state] ?? 0) + 1;
  return {
    run: { sim_run_id: RUN, scenario: "busy_day", status: "running", tick_count: ++ticks, time_scale: 60, seed: 1,
      sim_clock: iso(clock), speed_x: F.speedX ?? 1, playback_mode: "live", jump: null },
    legs: [], fleet: { counts, total: vehicles.length, vehicles }, stalls_status: [],
    energy: null, bess: null, weather: null, grid: null, counters: {}, recent_events: [], variability: {},
  };
}

// ── the cars the board is about: the twin's 36 Teslas ───────────────────────
const TESLAS = F.roster.filter((r) => r.platform === "tesla").map((r) => r.id).sort((a, b) => name(a).localeCompare(name(b), "en", { numeric: true }));
const AT_DEPOT = worldAt(SECS * 1000).vehicles.filter((v) => v.platform === "tesla" && !["deployed", "en_route_to_depot"].includes(v.state));
const onL2 = (n) => AT_DEPOT.find((v) => name(v.id) === n && v.state === "charging_l2");
const CAR = (onL2("Tesla-AV-055") ?? AT_DEPOT.find((v) => v.state === "charging_l2") ?? AT_DEPOT[0]).id; // the car tapped
const WASHED = AT_DEPOT.filter((v) => v.state === "charging_l2").map((v) => v.id).slice(0, 4);
const HELD = AT_DEPOT.find((v) => v.state !== "charging_l2")?.id ?? WASHED[1];

// ── the decision stream: run 1ccad49b's records, re-timed onto the recording's clock ──
const FEED_END = Date.parse(F.frames[0].t) + 8 * 60_000; // its newest record lands 8 sim-minutes into the recording
const SHIFT = FEED_END - Math.max(...RUN1.feed.map((r) => Date.parse(r.occurred_at)));
const shift = (t) => (t ? iso(Date.parse(t) + SHIFT) : t);
const FEED = RUN1.feed.map((r) => ({ ...r, occurred_at: shift(r.occurred_at), last_at: shift(r.last_at) }));
const TICK_AT = (tick) => FEED.find((r) => r.tick_seq === tick)?.occurred_at ?? iso(FEED_END);

// ── the owner board, in 0608's exact shape ───────────────────────────────────
const L = CAP.live;
const AGENT_KEY = L.agents.find((a) => a.via === "key");
const AGENT_PASS = L.agents.find((a) => a.via === "passcode");
const clone = (o) => JSON.parse(JSON.stringify(o));
const tpl = {
  limit: L.commands.find((c) => c.tool === "set_charge_limit" && c.outcome === "applied"),
  wash: L.commands.find((c) => c.tool === "request_service" && c.outcome === "applied" && c.cars > 1),
  pm: L.commands.find((c) => c.tool === "request_service" && c.outcome === "applied" && c.cars === 1),
  hold: L.commands.find((c) => c.tool === "hold_vehicle"),
  refusedLimit: L.commands.find((c) => c.tool === "set_charge_limit" && c.outcome === "refused"),
  refusedCar: L.commands.find((c) => c.tool === "request_service" && c.outcome === "refused"),
  inForce: Object.fromEntries(["charge_limit", "service", "hold"].map((k) => [k, L.in_force.find((s) => s.kind === k)])),
};
const ctFmt = (ms, withDay) => new Date(ms).toLocaleString("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit", hour12: true, ...(withDay ? { weekday: "short", month: "short", day: "numeric" } : {}) });
const simLocal = (ms) => `${ctFmt(ms)} sim time`;
const REAL_NOW = Date.now();
const realLocal = (ms) => `${ctFmt(ms)} CT`;
// Stable ids: every poll returns the same commands and settings, as the function would (synthetic, never real ids).
const stable = new Map();
const uuid = (key) => {
  if (!stable.has(key)) stable.set(key, `0e0e0e0e-0608-4000-8000-${String(stable.size + 1).padStart(12, "0")}`);
  return stable.get(key);
};
const link = (cmd) => tpl.limit.link.replace(L.run.sim_run_id, RUN).replace(tpl.limit.command_id, cmd);
const HOLD_UNTIL = FEED_END + 2 * 3600_000; // the hold asked for: two sim-hours after the newest decision
const ranges = () => {
  const groups = new Map();
  for (const id of TESLAS) { const m = /^(.*-)(\d+)$/.exec(name(id)); const k = m ? m[1] : name(id); (groups.get(k) ?? groups.set(k, []).get(k)).push(name(id)); }
  return [...groups.values()].map((g) => (g.length > 1 ? `${g[0]} to ${g[g.length - 1]} (${g.length} cars)` : g[0])).join("; ");
};

function command(t, { id, agent, cars, vehicles, head, summary, code, refusal, simAt, realAt }) {
  const c = clone(t);
  Object.assign(c, {
    command_id: id, sim_run_id: RUN, agent: agent.agent, agent_via: agent.via, cars, head, summary,
    sim_clock: iso(simAt), sim_clock_local: simLocal(simAt), created_at: iso(realAt), created_at_local: realLocal(realAt), live_run: true,
  });
  if (vehicles) { c.vehicles = vehicles.map(name); c.vehicle_ids = vehicles; } else { delete c.vehicles; delete c.vehicle_ids; }
  if (code) { c.confirmation_code = code; c.link = link(id); } else { delete c.confirmation_code; delete c.link; }
  if (refusal) c.refusal = refusal;
  return c;
}

function board() {
  const { clock } = now();
  const limitAt = Date.parse(TICK_AT(90)), lateAt = Date.parse(TICK_AT(96));
  const real = (k) => REAL_NOW - (6 - k) * 47_000;
  const ids = { limit: uuid("cmd:limit"), wash: uuid("cmd:wash"), pm: uuid("cmd:pm"), hold: uuid("cmd:hold"), r1: uuid("cmd:refused-limit"), r2: uuid("cmd:refused-car") };
  const code = { limit: "OQ-B610-EA0E", wash: "OQ-4C1D-7A92", pm: "OQ-2F86-0B3D", hold: "OQ-91E5-C47A" };
  // the receipt's counts, as of the moment the limit was sent (the served world at SECS)
  const at = new Map(worldAt(SECS * 1000).vehicles.map((v) => [v.id, v]));
  const out = TESLAS.filter((id) => ["deployed", "en_route_to_depot"].includes(at.get(id)?.state ?? "deployed")).length;
  const charging = TESLAS.filter((id) => /^charging_/.test(at.get(id)?.state ?? "")).length;
  const holdUntil = HOLD_UNTIL;
  const commands = [
    command(tpl.refusedCar, { id: ids.r2, agent: AGENT_PASS, cars: 0, simAt: lateAt, realAt: real(5),
      head: `Not done: No car in your fleet matches "Tesla 98". Your cars here: ${ranges()}.`,
      summary: `Not done: No car in your fleet matches "Tesla 98". Your cars here: ${ranges()}.`,
      refusal: `No car in your fleet matches "Tesla 98". Your cars here: ${ranges()}.` }),
    command(tpl.refusedLimit, { id: ids.r1, agent: AGENT_PASS, cars: TESLAS.length, vehicles: TESLAS, simAt: lateAt, realAt: real(4),
      head: tpl.refusedLimit.head, summary: tpl.refusedLimit.summary, refusal: tpl.refusedLimit.refusal }),
    command(tpl.hold, { id: ids.hold, agent: AGENT_PASS, cars: 1, vehicles: [HELD], simAt: lateAt, realAt: real(3), code: code.hold,
      head: `Done. ${name(HELD)} will not leave before ${ctFmt(holdUntil)} sim time; once it is ready it waits in staging, and no charger is kept for it.`,
      summary: `Done. ${name(HELD)} will not leave before ${ctFmt(holdUntil)} sim time; once it is ready it waits in staging, and no charger is kept for it.\nA hold only delays a departure; it never sends a car anywhere.\nThis lasts until the demo run ends or you undo it.` }),
    command(tpl.pm, { id: ids.pm, agent: AGENT_PASS, cars: 1, vehicles: [CAR], simAt: lateAt, realAt: real(2), code: code.pm,
      head: `Done. ${name(CAR)} gets mechanical PM on this visit (in the service bay, about 40 min); OTTO-Q fits it into the car's plan, and the car does not leave until it is done.`,
      summary: tpl.pm.summary.replace(/^Done\. [^ ]+ /, `Done. ${name(CAR)} `).split("\nSee it in OrchestrAV")[0] }),
    command(tpl.wash, { id: ids.wash, agent: AGENT_PASS, cars: WASHED.length, vehicles: WASHED, simAt: lateAt, realAt: real(1), code: code.wash,
      head: `Done. ${WASHED.length} Teslas get exterior wash (in the wash bay, about 10 min) on every visit from now on, this one included.`,
      summary: `Done. ${WASHED.length} Teslas get exterior wash (in the wash bay, about 10 min) on every visit from now on, this one included.\n- ${WASHED.length} are at the depot and get it on this visit\nOTTO-Q decides when and where: work in a bay comes after the charge, work at the car runs during it, and no car leaves with it undone.\nThis lasts until the demo run ends or you undo it.` }),
    command(tpl.limit, { id: ids.limit, agent: AGENT_KEY, cars: TESLAS.length, vehicles: TESLAS, simAt: limitAt, realAt: real(0), code: code.limit,
      head: `Done. All ${TESLAS.length} Teslas charge to at most 90% instead of 100%.`,
      summary: `Done. All ${TESLAS.length} Teslas charge to at most 90% instead of 100%.\n- ${charging} are charging and will stop at 90%\n- ${out} are out; they charge to 90% when they next come in\n- ${TESLAS.length - charging - out} are at the depot and charge to 90% when they plug in\nThis lasts until the demo run ends or you undo it.` }),
  ];
  const byCmd = Object.fromEntries(commands.map((c) => [c.command_id, c]));
  const setting = (kind, id, cmdId, extra, waiting) => {
    const s = clone(tpl.inForce[kind]);
    const c = byCmd[cmdId];
    Object.assign(s, { vehicle_id: id, vehicle: name(id), command_id: cmdId, setting_id: uuid(`set:${kind}:${id}:${cmdId}`), agent: c.agent, agent_via: c.agent_via,
      set_at: c.created_at, set_at_local: c.created_at_local, confirmation_code: c.confirmation_code, waiting_for_tick: waiting, ...extra });
    return s;
  };
  const in_force = [
    ...TESLAS.map((id) => setting("charge_limit", id, ids.limit, { charge_limit_pct: 90 }, false)),
    ...WASHED.map((id) => setting("service", id, ids.wash, { service: "exterior_wash", service_name: "Exterior wash", when: "every_return" }, true)),
    setting("service", CAR, ids.pm, { service: "mechanical_pm", service_name: "Mechanical PM", when: "now" }, true),
    setting("hold", HELD, ids.hold, { hold_until_sim: iso(holdUntil), hold_until_local: `${ctFmt(holdUntil, true).replace(/^(\w+), (\w+ \d+), (.*)$/, "$3 on $1 $2")} sim time` }, true),
  ];
  const by_vehicle = {};
  for (const s of in_force) {
    const v = (by_vehicle[s.vehicle_id] ??= { agents: [], orders: [], vehicle: s.vehicle, full_pct: s.full_pct, fleet_operator: s.fleet_operator, waiting_for_tick: false, confirmation_codes: [] });
    if (!v.agents.includes(s.agent)) v.agents.push(s.agent);
    if (s.confirmation_code && !v.confirmation_codes.includes(s.confirmation_code)) v.confirmation_codes.push(s.confirmation_code);
    v.waiting_for_tick = v.waiting_for_tick || s.waiting_for_tick;
    if (s.kind === "charge_limit") v.charge_limit_pct = s.charge_limit_pct;
    if (s.kind === "service") v.orders.push({ name: s.service_name, when: s.when, service: s.service });
    if (s.kind === "hold") { v.hold_until_sim = s.hold_until_sim; v.hold_until_local = s.hold_until_local; }
  }
  return {
    ...clone(L),
    run: { ...clone(L.run), sim_run_id: RUN, sim_clock: iso(clock), sim_clock_local: simLocal(clock) },
    agents: L.agents.map((a) => ({ ...clone(a), connected_at_local: realLocal(REAL_NOW - 300_000), last_seen_local: realLocal(REAL_NOW) })),
    counts: { cars: Object.keys(by_vehicle).length, holds: 1, orders: WASHED.length + 1, charge_limits: TESLAS.length, agents_connected: 2 },
    commands, in_force, by_vehicle,
  };
}

/** The served board's key sets against the capture's, object by object: an empty list means 0608's exact shape. */
function shapeCheck(b) {
  const keys = (o) => Object.keys(o ?? {}).sort().join(",");
  const diff = [];
  const same = (what, a, c) => { if (keys(a) !== keys(c)) diff.push(`${what}: served {${keys(a)}} vs capture {${keys(c)}}`); };
  same("board", b, L);
  same("run", b.run, L.run);
  same("counts", b.counts, L.counts);
  same("depot", b.depot, L.depot);
  for (const a of b.agents) same(`agent ${a.via}`, a, L.agents.find((x) => x.via === a.via));
  const kindOf = (c) => `${c.tool}/${c.outcome}/${c.cars === 1 ? "one" : c.vehicles ? "many" : "none"}`;
  for (const c of b.commands) same(`command ${kindOf(c)}`, c, L.commands.find((x) => kindOf(x) === kindOf(c)) ?? L.commands.find((x) => x.tool === c.tool && x.outcome === c.outcome));
  for (const s of b.in_force) same(`in_force ${s.kind}`, s, L.in_force.find((x) => x.kind === s.kind));
  const vKind = (v) => (v.hold_until_sim ? "held" : "plain");
  for (const v of Object.values(b.by_vehicle)) same(`by_vehicle ${vKind(v)}`, v, Object.values(L.by_vehicle).find((x) => vKind(x) === vKind(v)));
  return [...new Set(diff)];
}
if (arg("dry", false)) {
  t0 = Date.now() - SECS * 1000;
  const b = board();
  console.log(JSON.stringify({ shape: shapeCheck(b), car: name(CAR), washed: WASHED.map(name), held: name(HELD),
    counts: b.counts, lines: b.commands.map((c) => `${c.agent_via} · ${c.tool} · ${c.head}`) }, null, 1));
  process.exit(0);
}

// ── depot cards: the recording's cars; the tapped car's card is qCardShots' contract-shaped STUB sample ──
function depotCards() {
  const { clock, vehicles } = now();
  const m = (min) => iso(clock + min * 60_000);
  const code = new Map(F.stalls.map((s) => [s.id, { code: s.code, kind: s.type }]));
  return {
    endpoint: "ottoq.depot_cards", contract_version: "1.4", depot_id: DEPOT, sim_run_id: RUN, sim_clock: iso(clock),
    vehicles: vehicles.map((v) => {
      const st = v.stall_id ? code.get(v.stall_id) : null;
      const base = { vehicle_id: v.id, display_name: name(v.id), state: v.state, soc: v.soc, target_soc: 100,
        stall: st ? { id: v.stall_id, code: st.code, kind: st.kind } : null, reservations: [], card: null };
      if (v.id !== CAR) return base;
      return {
        ...base,
        reservations: [
          { booking_id: "s1", purpose: "wash", state: "held", stall_code: "NASH-WASH-02", stall_kind: "wash", starts_at: m(34), ends_at: m(46), need_atom: "exterior_wash", booked_by: "otto_q" },
          { booking_id: "s2", purpose: "inspect", state: "held", stall_code: "NASH-SVC-02", stall_kind: "service_bay", starts_at: m(49), ends_at: m(55), need_atom: "readiness_check", booked_by: "otto_q" },
          { booking_id: "s3", purpose: "staging", state: "held", stall_code: "NASH-STG-12", stall_kind: "staging", starts_at: m(57), ends_at: m(120), booked_by: "otto_q" },
        ],
        card: {
          urgency: "standard", dispatch_due_at: m(120),
          needs: [
            { svc: "interior_inspection", status: "done", done_at: m(-52), must_do: true, performed_by: "charger_sensors" },
            { svc: "charge", status: "in_progress", must_do: true },
            { svc: "exterior_wash", status: "pending", must_do: true },
            { svc: "readiness_check", status: "pending", must_do: true },
          ],
          steps: [
            { seq: 1, leg_type: "taxi", status: "done", actual_end: m(-60) },
            { seq: 2, leg_type: "inspect", atom: "interior_inspection", status: "done", actual_start: m(-58), actual_end: m(-52) },
            { seq: 3, leg_type: "charge_l2", status: "current", planned_start: m(-58), planned_end: m(26), actual_start: m(-58),
              progress_pct: 61, expected_end: m(29), eta_source: "charge_physics", over_plan_min: null },
            { seq: 4, leg_type: "taxi", status: "upcoming", planned_start: m(30), planned_end: m(33) },
            { seq: 5, leg_type: "wash", atom: "exterior_wash", status: "upcoming", planned_start: m(34), planned_end: m(46) },
            { seq: 6, leg_type: "inspect", atom: "readiness_check", status: "upcoming", planned_start: m(49), planned_end: m(55) },
            { seq: 7, leg_type: "stage", status: "upcoming", planned_start: m(57), planned_end: m(120) },
          ],
        },
      };
    }),
  };
}

// ── routes ──────────────────────────────────────────────────────────────────
const json = (route, body) => route.fulfill({ status: 200, headers: { "content-type": "application/json", "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
const served = new Map();
const aborted = new Map();
const count = (m, k) => m.set(k, (m.get(k) ?? 0) + 1);

async function install(page) {
  const local = new URL(URL_).host;
  await page.route("**/*", async (route) => {
    const r = route.request();
    const u = new URL(r.url());
    if (u.host === local) return route.continue();
    const m = r.method();
    const key = `${m} ${u.pathname}`;
    if (!/supabase\.co$/.test(u.hostname)) { count(aborted, `${m} ${u.host}`); return route.abort(); }
    if (m === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,OPTIONS" } });
    if (m === "GET" && /\/otto-twin-control\/sim_runs$/.test(u.pathname)) {
      count(served, key);
      return json(route, { ok: true, data: { runs: [{ sim_run_id: RUN, scenario: "busy_day", status: "running", speed_x: F.speedX, tick_count: ticks, seed: 1 }] } });
    }
    if (m === "GET" && u.pathname.endsWith(`/sim_runs/${RUN}/snapshot`)) {
      if (t0 === null) t0 = Date.now();
      count(served, key);
      return json(route, { ok: true, data: snapshot() });
    }
    if (m === "GET" && /\/otto-twin-control\/depot\/[^/]+\/layout$/.test(u.pathname)) {
      count(served, key);
      return json(route, { ok: true, data: { depot: null, structures: [], stalls: F.stalls.map((s) => ({ zone: null, canopy: null, covered: null, heading: 0, connector_kw: null, ...s })) } });
    }
    const rpc = /\/rest\/v1\/rpc\/(\w+)/.exec(u.pathname)?.[1];
    const body = r.postData() ?? "";
    if (m === "POST" && rpc === "ottoq_twin_run_context" && body.includes(RUN)) { count(served, key); return json(route, { depot_id: DEPOT, sim_run_id: RUN }); }
    if (m === "POST" && rpc === "ottoq_depot_cards" && t0 !== null) { count(served, key); return json(route, depotCards()); }
    if (m === "POST" && rpc === "ottoq_depot_owner_board" && t0 !== null) { count(served, key); return json(route, board()); }
    if (m === "POST" && rpc === "ottoq_activity_feed_v2") {
      count(served, key);
      const a = JSON.parse(body || "{}");
      return json(route, a.p_vehicle_id ? FEED.filter((x) => x.vehicle_id === a.p_vehicle_id) : FEED);
    }
    count(aborted, key);
    return route.abort();
  });
}

const browser = await chromium.launch({
  ...(CHROMIUM ? { executablePath: CHROMIUM } : {}),
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const summary = [];
const clickText = (page, t) => page.evaluate((x) => {
  const b = [...document.querySelectorAll("button")].find((e) => e.textContent?.trim().toLowerCase() === x.toLowerCase());
  b?.click(); return !!b;
}, t);
const facts = (page) => page.evaluate(() => {
  const q = document.querySelector('[data-testid="qcard-owner"]');
  const strip = document.querySelector("div.h-14 .flex-1.min-w-0");
  return {
    qcardOwner: q ? [...q.querySelectorAll('[data-testid="qcard-owner-chip"]')].map((e) => e.textContent) : null,
    qcardCodes: q ? [...q.querySelectorAll('[data-testid="qcard-owner-code"]')].map((e) => e.textContent) : null,
    ownerLines: [...document.querySelectorAll('[data-testid="owner-line"]')].map((e) => e.textContent?.replace(/\s+/g, " ").trim()),
    marks2d: document.querySelectorAll("[data-owner-mark]").length,
    agentsChip: document.querySelector('[data-testid="agents-connected"]')?.textContent ?? null,
    telemetryStrip: strip ? { scroll: strip.scrollWidth, client: strip.clientWidth } : null,
  };
});
const shot = async (page, file, opts = {}) => {
  const path = join(OUT, file);
  await page.screenshot({ path, type: "jpeg", quality: 85, ...opts });
  summary.push({ shot: path, facts: await facts(page) });
};

{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  await install(page);
  const u = new URL(URL_); u.searchParams.set("quality", "low");
  await page.goto(u.toString(), { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);
  // 1. 2D: the marks, the tapped car's Q card, and the Agent tab's stream beside them
  await clickText(page, "2D");
  while (playback() < SECS) await page.waitForTimeout(500);
  await page.locator("div.w-\\[420px\\] button", { hasText: /^Agent$/ }).first().click();
  await page.waitForTimeout(2000);
  const clicked = await page.evaluate((vid) => {
    const g = document.querySelector(`[data-vid="${vid}"]`);
    g?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    return !!g;
  }, CAR);
  summary.push({ step: `2D click on ${name(CAR)}`, clicked });
  await page.waitForTimeout(12000); // depot cards (10 s) and the car's feed answer
  await shot(page, "1-desktop-2d-qcard-and-agent-feed.jpg");
  // 2. the Agent tab's stream alone
  const panel = page.locator("div.w-\\[420px\\]").first();
  await panel.screenshot({ path: join(OUT, "2-agent-feed-owner-lines.jpg"), type: "jpeg", quality: 90 });
  summary.push({ shot: join(OUT, "2-agent-feed-owner-lines.jpg") });
  // 3. 3D at the default camera: the badges over the marked cars, the charging ones under the canopy included
  await page.evaluate(() => document.querySelector('[aria-label="Close Q card"]')?.click());
  await clickText(page, "3D");
  await page.waitForTimeout(20000);
  await shot(page, "3-desktop-3d-default-camera-marked-cars.jpg");
  // 4. 3D from an oblique preset: the same badges in perspective (a tap would start the camera following the car)
  await clickText(page, PRESET);
  await page.waitForTimeout(8000);
  await shot(page, `4-desktop-3d-${PRESET.toLowerCase()}-marked-cars.jpg`);
  summary.push({ errors: [...new Set(errors)].slice(0, 5) });
  await ctx.close();
}

await browser.close();
summary.push({ shape: shapeCheck(board()), car: name(CAR), washed: WASHED.map(name), held: name(HELD), served: Object.fromEntries(served), aborted: Object.fromEntries(aborted) });
console.log(JSON.stringify(summary, null, 1));
