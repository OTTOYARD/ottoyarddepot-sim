// ============================================================================
// powerOneLine — the depot's electrical one-line, read and put into words.
//
// Data contract: otto-q-core 0810, public.ottoq_power_one_line(p_depot_id, p_sim_run_id). The engine keeps the depot's
// electrical tree as data (a utility service, a switchgear, seven transformers, thirty posts, the battery, the building
// and the canopy solar), measures every node on every tick, and steps each transformer's temperature by the loading
// guide's model. This file parses that answer and formats it. It decides nothing and invents no number: a reading the
// engine did not send is drawn as a dash.
//
// Two things the page must always say, because they are the point (otto-q-core CLAUDE.md rule 13):
//   - every size is what is installed, at or above everything connected under it; nothing here limits a car;
//   - "this day would have fit on a smaller unit" is a reading of one run for a person, never a change.
// ============================================================================

export const DASH = '—';

export type NodeKind = 'utility_service' | 'mv_switchgear' | 'transformer' | 'post' | 'bess' | 'solar' | 'building';

export interface NodeNow {
  kw_dc: number | null;
  kw_ac: number | null;
  kva: number | null;
  load_pu: number | null;
  loss_kw: number | null;
  ambient_c: number | null;
  top_oil_c: number | null;
  hot_spot_c: number | null;
  aging_factor: number | null;
}

export interface RightsizeRow { kva: number; max_hot_spot_c: number | null; aging_vs_normal: number | null }
export interface Rightsize {
  installed_kva: number | null;
  smallest_kva_this_day_fits: number | null;
  by_size: RightsizeRow[];
}

export interface NodeStudy {
  hours: number | null;
  energy_kwh_dc: number | null;
  energy_kwh_ac: number | null;
  loss_kwh: number | null;
  peak_kw_ac: number | null;
  peak_kva: number | null;
  peak_at: string | null;
  peak_30min_kva: number | null;
  peak_load_pu: number | null;
  hours_energized: number | null;
  load_seconds: number[];
  max_top_oil_c: number | null;
  max_hot_spot_c: number | null;
  max_hot_spot_at: string | null;
  aging_hours: number | null;
  rightsize: Rightsize | null;
  /** On a charger transformer: could the other posts have taken its cars. On the service: what the posts were asked for. */
  resilience: Resilience | null;
}

/** otto-q-core 0810, ottoq_power_resilience: made once, at the run's end, from the run's charge sessions. */
export interface Resilience {
  busiest_at: string | null;
  cars_at_busiest: number | null;
  free_posts_elsewhere_then: number | null;
  worst_shortfall_cars: number | null;
  worst_shortfall_at: string | null;
  most_any_post_delivered_kw: number | null;
  post_rating_kw: number | null;
  sessions: number | null;
  sessions_over_150_kw: number | null;
  cars: number | null;
  cars_that_can_take_over_150_kw: number | null;
}

export interface PowerNode {
  code: string;
  parent: string | null;
  kind: NodeKind;
  title: string;
  voltage_v: number | null;
  rated_kva: number | null;
  rated_kw: number | null;
  canopy: string | null;
  charger_state: string | null;
  /** The node whose trip took this post down, when its fault was a common-cause one. */
  power_node_fault: string | null;
  now: NodeNow | null;
  study: NodeStudy | null;
}

export interface PowerTrip {
  trip_id: string;
  node: string;
  tripped_at_sim: string | null;
  recovers_at_sim: string | null;
  posts_faulted: number;
  sessions_stopped: number;
  cars_on_posts: number;
  actor: string | null;
}

export interface OneLine {
  depot_id: string | null;
  design: string | null;
  sim_run_id: string | null;
  run_status: string | null;
  as_of_sim: string | null;
  site_meter_kw: number | null;
  nodes: PowerNode[];
  trips: PowerTrip[];
}

// ── parsing ──────────────────────────────────────────────────────────────────
const KINDS: readonly NodeKind[] = ['utility_service', 'mv_switchgear', 'transformer', 'post', 'bess', 'solar', 'building'];
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
/** PostgREST sends numeric as a number or, at high precision, a string. Anything else is no reading. */
export function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

function readNow(v: unknown): NodeNow | null {
  if (!isObj(v)) return null;
  return {
    kw_dc: num(v.kw_dc), kw_ac: num(v.kw_ac), kva: num(v.kva), load_pu: num(v.load_pu), loss_kw: num(v.loss_kw),
    ambient_c: num(v.ambient_c), top_oil_c: num(v.top_oil_c), hot_spot_c: num(v.hot_spot_c), aging_factor: num(v.aging_factor),
  };
}

function readRightsize(v: unknown): Rightsize | null {
  if (!isObj(v)) return null;
  const rows = Array.isArray(v.by_size) ? v.by_size : [];
  return {
    installed_kva: num(v.installed_kva),
    smallest_kva_this_day_fits: num(v.smallest_kva_this_day_fits),
    by_size: rows.filter(isObj).flatMap((r) => {
      const kva = num(r.kva);
      return kva === null ? [] : [{ kva, max_hot_spot_c: num(r.max_hot_spot_c), aging_vs_normal: num(r.aging_vs_normal) }];
    }),
  };
}

function readResilience(v: unknown): Resilience | null {
  if (!isObj(v)) return null;
  return {
    busiest_at: str(v.busiest_at), cars_at_busiest: num(v.cars_at_busiest), free_posts_elsewhere_then: num(v.free_posts_elsewhere_then),
    worst_shortfall_cars: num(v.worst_shortfall_cars), worst_shortfall_at: str(v.worst_shortfall_at),
    most_any_post_delivered_kw: num(v.most_any_post_delivered_kw), post_rating_kw: num(v.post_rating_kw), sessions: num(v.sessions),
    sessions_over_150_kw: num(v.sessions_over_150_kw), cars: num(v.cars), cars_that_can_take_over_150_kw: num(v.cars_that_can_take_over_150_kw),
  };
}

function readStudy(v: unknown): NodeStudy | null {
  if (!isObj(v)) return null;
  const bins = Array.isArray(v.load_seconds) ? v.load_seconds.map((b) => num(b) ?? 0) : [];
  return {
    hours: num(v.hours), energy_kwh_dc: num(v.energy_kwh_dc), energy_kwh_ac: num(v.energy_kwh_ac), loss_kwh: num(v.loss_kwh),
    peak_kw_ac: num(v.peak_kw_ac), peak_kva: num(v.peak_kva), peak_at: str(v.peak_at), peak_30min_kva: num(v.peak_30min_kva),
    peak_load_pu: num(v.peak_load_pu), hours_energized: num(v.hours_energized), load_seconds: bins,
    max_top_oil_c: num(v.max_top_oil_c), max_hot_spot_c: num(v.max_hot_spot_c), max_hot_spot_at: str(v.max_hot_spot_at),
    aging_hours: num(v.aging_hours), rightsize: readRightsize(v.rightsize), resilience: readResilience(v.resilience),
  };
}

/** The engine's answer as a OneLine, or null when it is not one (an error body, an empty depot). */
export function readOneLine(data: unknown): OneLine | null {
  if (!isObj(data) || !Array.isArray(data.nodes)) return null;
  const nodes: PowerNode[] = data.nodes.filter(isObj).flatMap((n) => {
    const code = str(n.code);
    const kind = KINDS.find((k) => k === n.kind);
    if (!code || !kind) return [];
    return [{
      code, kind, parent: str(n.parent), title: str(n.title) ?? code, voltage_v: num(n.voltage_v), rated_kva: num(n.rated_kva),
      rated_kw: num(n.rated_kw), canopy: str(n.canopy), charger_state: str(n.charger_state),
      power_node_fault: str(n.power_node_fault), now: readNow(n.now), study: readStudy(n.study),
    }];
  });
  if (nodes.length === 0) return null;
  const trips: PowerTrip[] = (Array.isArray(data.trips) ? data.trips : []).filter(isObj).flatMap((t) => {
    const id = str(t.trip_id);
    const node = str(t.node);
    if (!id || !node) return [];
    return [{
      trip_id: id, node, tripped_at_sim: str(t.tripped_at_sim), recovers_at_sim: str(t.recovers_at_sim),
      posts_faulted: num(t.posts_faulted) ?? 0, sessions_stopped: num(t.sessions_stopped) ?? 0,
      cars_on_posts: num(t.cars_on_posts) ?? 0, actor: str(t.actor),
    }];
  });
  return {
    depot_id: str(data.depot_id), design: str(data.design), sim_run_id: str(data.sim_run_id), run_status: str(data.run_status),
    as_of_sim: str(data.as_of_sim), site_meter_kw: num(data.site_meter_kw), nodes, trips,
  };
}

// ── the tree ─────────────────────────────────────────────────────────────────
export const service = (o: OneLine): PowerNode | null => o.nodes.find((n) => n.kind === 'utility_service') ?? null;
/** Charger transformers first, in code order, then the one that feeds the battery, building and solar. */
export function transformers(o: OneLine): PowerNode[] {
  const feedsPosts = (t: PowerNode) => o.nodes.some((n) => n.parent === t.code && n.kind === 'post');
  return o.nodes.filter((n) => n.kind === 'transformer').sort((a, b) =>
    Number(feedsPosts(b)) - Number(feedsPosts(a)) || a.code.localeCompare(b.code));
}
export const childrenOf = (o: OneLine, code: string): PowerNode[] =>
  o.nodes.filter((n) => n.parent === code).sort((a, b) => a.code.localeCompare(b.code));

// ── states ───────────────────────────────────────────────────────────────────
export type PostState = 'charging' | 'idle' | 'down';
/** A post's state as the engine's charger row and its last reading say it. */
export function postState(n: PowerNode): PostState {
  if (n.charger_state === 'Faulted') return 'down';
  return (n.now?.kw_dc ?? 0) > 0.5 ? 'charging' : 'idle';
}

/** The trip a node is under at the one-line's clock, if any. */
export function activeTrip(o: OneLine, code: string): PowerTrip | null {
  const at = o.as_of_sim ? Date.parse(o.as_of_sim) : NaN;
  if (Number.isNaN(at)) return null;
  const live = o.trips.filter((t) => t.node === code && t.tripped_at_sim && t.recovers_at_sim
    && Date.parse(t.tripped_at_sim) <= at && at < Date.parse(t.recovers_at_sim));
  return live.length ? live[live.length - 1] : null;
}

export type Heat = 'cool' | 'warm' | 'hot' | 'unknown';
/**
 * How a hot-spot temperature reads. 110 C is the loading guide's reference: at it the insulation ages at its normal
 * rate; under it, slower. "warm" is the last 15 degrees under it.
 */
export function heatOf(hotSpotC: number | null | undefined): Heat {
  if (hotSpotC === null || hotSpotC === undefined) return 'unknown';
  if (hotSpotC > 110) return 'hot';
  return hotSpotC >= 95 ? 'warm' : 'cool';
}

// ── totals ───────────────────────────────────────────────────────────────────
export interface SiteNow {
  /** What a primary meter would read: every transformer's flow and its own losses. */
  gridKw: number | null;
  /** What reached the cars. */
  carsKw: number | null;
  /** Conversion in the posts and the transformers' losses, for the charging alone. */
  lostKw: number | null;
  lostPct: number | null;
  hottest: PowerNode | null;
  postsCharging: number;
  postsDown: number;
  posts: number;
}

export function siteNow(o: OneLine): SiteNow {
  const svc = service(o);
  const tx = transformers(o);
  const posts = o.nodes.filter((n) => n.kind === 'post');
  const carsKw = svc?.now?.kw_dc ?? null;
  // the charger transformers' AC flow and loss against the DC under them: what the charging cost on the grid side
  const chargerTx = tx.filter((t) => posts.some((p) => p.parent === t.code));
  const acForCars = chargerTx.reduce<number | null>((s, t) =>
    t.now?.kw_ac === null || t.now?.kw_ac === undefined ? s : (s ?? 0) + t.now.kw_ac + (t.now.loss_kw ?? 0), null);
  const lostKw = acForCars !== null && carsKw !== null && carsKw > 0.5 ? acForCars - carsKw : null;
  const read = tx.filter((t) => t.now?.hot_spot_c !== null && t.now?.hot_spot_c !== undefined);
  const hottest = read.length ? read.reduce((a, b) => ((b.now!.hot_spot_c as number) > (a.now!.hot_spot_c as number) ? b : a)) : null;
  return {
    gridKw: svc?.now?.kw_ac ?? null,
    carsKw,
    lostKw,
    lostPct: lostKw !== null && acForCars ? (lostKw / acForCars) * 100 : null,
    hottest,
    postsCharging: posts.filter((p) => postState(p) === 'charging').length,
    postsDown: posts.filter((p) => postState(p) === 'down').length,
    posts: posts.length,
  };
}

// ── words and figures ────────────────────────────────────────────────────────
const fix = (v: number, d: number) => v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
export const fmtKw = (v: number | null | undefined): string => (v === null || v === undefined ? DASH : `${fix(v, 0)} kW`);
export const fmtKva = (v: number | null | undefined): string => (v === null || v === undefined ? DASH : `${fix(v, 0)} kVA`);
export const fmtMwh = (kwh: number | null | undefined): string =>
  kwh === null || kwh === undefined ? DASH : Math.abs(kwh) >= 1000 ? `${fix(kwh / 1000, 2)} MWh` : `${fix(kwh, 0)} kWh`;
export const fmtPct = (pu: number | null | undefined, d = 0): string => (pu === null || pu === undefined ? DASH : `${fix(pu * 100, d)}%`);
export const fmtC = (v: number | null | undefined): string => (v === null || v === undefined ? DASH : `${fix(v, 0)} °C`);
export const fmtKv = (v: number | null | undefined): string =>
  v === null || v === undefined ? DASH : v >= 1000 ? `${fix(v / 1000, 1)} kV` : `${fix(v, 0)} V`;

/** "2.1 of 24.0 h": hours of insulation life the day used, against the hours a day at normal aging uses. */
export function lifeWords(s: NodeStudy | null): string {
  if (!s || s.aging_hours === null || s.hours === null || s.hours <= 0) return DASH;
  return `${fix(s.aging_hours, s.aging_hours < 10 ? 1 : 0)} of ${fix(s.hours, 1)} h`;
}

/** The right-size reading in one sentence, or null when the engine has not made one for this run. */
export function rightsizeWords(n: PowerNode): string | null {
  const r = n.study?.rightsize;
  if (!r || r.installed_kva === null) return null;
  if (r.smallest_kva_this_day_fits === null) {
    return `No standard size up to ${fix(r.by_size.length ? Math.max(...r.by_size.map((x) => x.kva)) : r.installed_kva, 0)} kVA keeps this day's hot spot under 110 °C.`;
  }
  if (r.smallest_kva_this_day_fits >= r.installed_kva) {
    return `This day needed the ${fix(r.installed_kva, 0)} kVA that is installed.`;
  }
  return `This day would have fit on ${fix(r.smallest_kva_this_day_fits, 0)} kVA. ${fix(r.installed_kva, 0)} kVA is installed.`;
}

/**
 * "Had this transformer tripped at its busiest moment ...": one sentence, or null when the run's end has not made the
 * reading. It is the best case (posts already down are not counted out) and says so where it matters.
 */
export function resilienceWords(n: PowerNode, clock: (iso: string | null) => string): string | null {
  const r = n.study?.resilience;
  if (!r || r.cars_at_busiest === null) return null;
  if (r.cars_at_busiest === 0) return 'No car charged under this transformer on this run.';
  const cars = `${r.cars_at_busiest} ${r.cars_at_busiest === 1 ? 'car' : 'cars'}`;
  const short = r.worst_shortfall_cars ?? 0;
  if (short > 0) {
    return `Had it tripped at ${clock(r.worst_shortfall_at)}, ${short} of its cars would have had no free post under the other transformers and would have waited.`;
  }
  return `Had it tripped at its busiest moment (${clock(r.busiest_at)}, ${cars}), the other transformers had ${r.free_posts_elsewhere_then ?? 0} posts free: every car could have moved and finished.`;
}

/** What the day asked of the posts, in one sentence, or null before the run's end has read it. */
export function postsAskedWords(o: OneLine): string | null {
  const r = service(o)?.study?.resilience;
  if (!r || r.most_any_post_delivered_kw === null || r.post_rating_kw === null) return null;
  const cars = r.cars !== null && r.cars_that_can_take_over_150_kw !== null
    ? ` ${r.cars_that_can_take_over_150_kw} of the depot's ${r.cars} cars can take more than 150 kW at all.` : '';
  return `The most any post delivered was ${fix(r.most_any_post_delivered_kw, 0)} kW of its ${fix(r.post_rating_kw, 0)} kW, over ${r.sessions ?? 0} charges.${cars}`;
}

/** Share of the measured time in each tenth of rating: 11 numbers, the last is "at or over 100%". Sums to 1, or all 0. */
export function loadShares(s: NodeStudy | null): number[] {
  const bins = Array.from({ length: 11 }, (_, i) => Math.max(0, s?.load_seconds[i] ?? 0));
  const total = bins.reduce((a, b) => a + b, 0);
  return total > 0 ? bins.map((b) => b / total) : bins.map(() => 0);
}

/** Nothing measured yet for this run: the calm panel's line. */
export function notMeasuredText(o: OneLine | null): string {
  if (!o) return 'The engine has not returned the depot’s one-line diagram yet.';
  return 'No run has been measured yet. Start a run and each transformer’s load and temperature appear here as the day goes.';
}
