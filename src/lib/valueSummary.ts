// ============================================================================
// valueSummary — the typed shape of otto-q-core's ottoq_value_summary and the
// pure formatters the Value tab draws it with.
//
// Data contract: otto-q-core 0576 (the_value_tab_reads_what_night_two_measured)
//   public.ottoq_value_summary(p_sweep_code text DEFAULT NULL) -> jsonb
// over a value sweep (0575, night 2): OTTO-Q against a plain depot (first come,
// first served, no energy planning) at 10 and 20 fast chargers, 24-hour days,
// seed by seed on common random numbers.
//
// Three rules every function here obeys:
//   1. A missing number reads as missing (—), never as a zero.
//   2. Signs are honest. Where OTTO-Q is worse the words say so ("higher",
//      "fewer", "−0.4 h") and the verdict is 'worse', which the tab never
//      colours green.
//   3. Rounding is for reading: $ a month to the nearest hundred, % and hours
//      to one decimal. A table's Change is taken between the ROUNDED figures
//      printed beside it, so every row adds up on screen.
// ============================================================================

// ── the contract, exactly as the RPC returns it ──────────────────────────────

export type Range = { low: number; mid: number; high: number }; // over seeds: min, mean, max

export interface ArmBlock {              // one cell of the test, averaged over its seeds
  cell: string;                          // e.g. "dcfc10.otto_q"
  seeds: number;
  power_bill_usd_month: number;          // a month of days like this one, on the cheapest Nashville (NES) rate it qualifies for
  power_rate: 'TGSA-3' | 'GSA-3' | 'EVC';
  effective_cents_per_kwh: number;       // bill / kWh bought
  peak_kw: number;                       // highest 30-minute demand
  demand_charge_usd_month: number;
  kwh_bought_day: number;
  cars_served_day: number;               // visits that left fully charged and serviced
  cars_per_fast_charger_day: number;
  turnaround_p50_min: number | null;     // median door-to-door minutes
  fast_charger_busy_pct: number | null;  // utilization
  demand_met_pct: number;                // share of the car-hours riders asked for that were met
  revenue_hours_per_car_day: number;
  charge_wait_p50_min: number | null;
  departures: number;
  departures_full_and_serviced: number;
}

export interface ChargerView {
  fast_chargers: number;                 // 10 or 20
  otto_q: ArmBlock | null;               // OTTO-Q (energy planning on)
  plain: ArmBlock | null;                // a plain depot: first come, first served, no energy planning
  otto_q_planner_off: ArmBlock | null;
  fifo_planner_on: ArmBlock | null;
  vs_plain: {                            // OTTO-Q minus the plain depot, per seed, then ranged. Savings are positive when OTTO-Q is better.
    power_bill_saved_usd_month: Range | null;
    power_bill_saved_pct: Range | null;
    peak_cut_kw: Range | null;
    cars_served_delta_day: Range | null;
    turnaround_delta_min: Range | null;          // negative = faster
    revenue_hours_per_car_day_delta: Range | null;
    revenue_usd_per_car_day: Range | null;       // at $20 per car-hour
    revenue_usd_per_car_day_band: [number, number] | null;  // mid at $16 and at $24
  } | null;
  split: {                               // where the power-bill saving comes from, $ per month (mid)
    energy_planning_usd_month: number | null;
    charger_assignment_usd_month: number | null;
  } | null;
}

export interface ValueSummary {
  status: 'measured' | 'measuring' | 'none';
  sweep: { code: string; title: string; arms_planned: number; arms_done: number; seeds_done: number;
           day_hours: number; step_min: number; first_arm_at: string | null; last_arm_at: string | null } | null;
  depot: { name: string; fleet: number; battery_kwh: number; battery_kw: number; solar_kw: number; tariff: string };
  views: ChargerView[];
  investor: { chargers_statement: string | null; chargers_avoided: number | null;
              charger_capex_avoided_usd: [number, number, number] | null;   // low, point, high
              fleet_equiv_cars: number | null; fleet_capex_equiv_usd: [number, number, number] | null } | null;
  guarantee: { departures: number; full_and_serviced: number } | null;
  runs: { cell: string; seed: string; arm_id: number; sim_run_id: string | null; ran_at: string }[];
  sources: { what: string; value: string; url: string; as_of: string }[];
  notes: string[];
}

// ── reading the payload ──────────────────────────────────────────────────────
// The function is written in parallel with this tab, so the payload is read
// defensively: anything that is not the shape above is dropped, never guessed.

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const objOrNull = <T>(v: unknown): T | null => (isObj(v) ? (v as T) : null);
const listOf = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter(isObj) : []);

export const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** The RPC's answer as a ValueSummary, or null when it is not an object at all. An unknown status reads as 'none'. */
export function readValueSummary(data: unknown): ValueSummary | null {
  if (!isObj(data)) return null;
  const status: ValueSummary['status'] =
    data.status === 'measured' || data.status === 'measuring' ? data.status : 'none';
  const views: ChargerView[] = listOf(data.views)
    .filter((v) => num(v.fast_chargers) !== null)
    .map((v) => ({
      fast_chargers: v.fast_chargers as number,
      otto_q: objOrNull<ArmBlock>(v.otto_q),
      plain: objOrNull<ArmBlock>(v.plain),
      otto_q_planner_off: objOrNull<ArmBlock>(v.otto_q_planner_off),
      fifo_planner_on: objOrNull<ArmBlock>(v.fifo_planner_on),
      vs_plain: objOrNull<ChargerView['vs_plain']>(v.vs_plain),
      split: objOrNull<ChargerView['split']>(v.split),
    }));
  return {
    status,
    sweep: objOrNull<ValueSummary['sweep']>(data.sweep),
    depot: objOrNull<ValueSummary['depot']>(data.depot),
    views,
    investor: objOrNull<ValueSummary['investor']>(data.investor),
    guarantee: objOrNull<ValueSummary['guarantee']>(data.guarantee),
    runs: listOf(data.runs) as unknown as ValueSummary['runs'],
    sources: listOf(data.sources) as unknown as ValueSummary['sources'],
    notes: (Array.isArray(data.notes) ? data.notes : []).filter((n): n is string => typeof n === 'string'),
  };
}

/** A {low, mid, high} whose three ends are all numbers, or null. */
export function rangeOf(r: unknown): Range | null {
  if (!isObj(r)) return null;
  const low = num(r.low), mid = num(r.mid), high = num(r.high);
  return low === null || mid === null || high === null ? null : { low, mid, high };
}

/** A view can be drawn once a test day pairs OTTO-Q with the plain depot: both blocks and the seed-by-seed comparison. */
export const comparable = (v: ChargerView | null | undefined): boolean => !!(v && v.otto_q && v.plain && v.vs_plain);

/** Anything to show at all. 'measuring' in 0576 means no seed has both arms yet, which this also catches. */
export function hasResults(s: ValueSummary | null): boolean {
  return !!s && s.status !== 'none' && s.views.some(comparable);
}

export const DEFAULT_FAST_CHARGERS = 10; // the depot as built

export function viewFor(s: ValueSummary | null, fastChargers: number): ChargerView | null {
  return s?.views.find((v) => v.fast_chargers === fastChargers) ?? null;
}

/** The toggle's choices: 10 and 20 always, plus any other charger count the sweep measured. */
export function chargerOptions(s: ValueSummary | null): number[] {
  const set = new Set<number>([10, 20]);
  for (const v of s?.views ?? []) set.add(v.fast_chargers);
  return [...set].sort((a, b) => a - b);
}

/**
 * How many test days the seed-by-seed comparison covers. 0576 pairs OTTO-Q and the plain depot on the same seed but does
 * not publish the count, so it is read off the runs list (every arm the summary used, with its cell and seed). Where that
 * cannot answer, the smaller arm's seed count, which is the paired count whenever both arms ran the same seeds.
 */
export function pairedSeeds(view: ChargerView | null, runs: ValueSummary['runs']): number | null {
  const q = view?.otto_q, p = view?.plain;
  if (!q || !p) return null;
  const seedsOf = (cell: string) => new Set(runs.filter((r) => r.cell === cell).map((r) => String(r.seed)));
  const a = seedsOf(q.cell), b = seedsOf(p.cell);
  let paired = 0;
  a.forEach((s) => { if (b.has(s)) paired += 1; });
  if (paired > 0) return paired;
  const fewer = Math.min(num(q.seeds) ?? 0, num(p.seeds) ?? 0);
  return fewer > 0 ? fewer : null;
}

// ── numbers ──────────────────────────────────────────────────────────────────

export const DASH = '—';
const MINUS = '−';

/** Round half away from zero, to `digits` decimals. Never returns -0. */
export function roundTo(v: number, digits = 0): number {
  const f = 10 ** digits;
  return (Math.sign(v) * Math.round(Math.abs(v) * f)) / f || 0;
}

/** |v| with thousands separators and exactly `digits` decimals. */
const mag = (v: number, digits: number): string =>
  Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** One decimal, dropped when it is zero: 7.7 -> "7.7", 24 -> "24". */
const trim1 = (v: number): string => {
  const r = roundTo(v, 1);
  return mag(r, Number.isInteger(r) ? 0 : 1);
};

/** A number to read: "1,180", "9.9", "−3.8". Missing reads as —. */
export function fmtNumber(v: unknown, digits = 0): string {
  const n = num(v);
  if (n === null) return DASH;
  const r = roundTo(n, digits);
  return `${r < 0 ? MINUS : ''}${mag(r, digits)}`;
}

/** A change, always signed: "+2.6", "−710", "0". */
export function signedNumber(v: number, digits = 0): string {
  const r = roundTo(v, digits);
  return `${r > 0 ? '+' : r < 0 ? MINUS : ''}${mag(r, digits)}`;
}

export function fmtPct(v: unknown, digits = 1): string {
  const s = fmtNumber(v, digits);
  return s === DASH ? DASH : `${s}%`;
}

/** Dollars a month, to the nearest hundred: "$38,200", "−$1,200". */
export function fmtUsdMonth(v: unknown): string {
  const n = num(v);
  if (n === null) return DASH;
  const r = roundTo(n / 100) * 100;
  return `${r < 0 ? MINUS : ''}$${mag(r, 0)}`;
}

const usdSigned = (v: number, digits: number, plus: boolean): string => {
  const r = roundTo(v, digits);
  return `${r > 0 ? (plus ? '+' : '') : r < 0 ? MINUS : ''}$${mag(r, digits)}`;
};

/** Capital: millions to one decimal once any figure reaches a million ("$1.5M"), else the nearest thousand ("$675,000"). */
function capitalFormatter(values: number[]): (v: number) => string {
  const millions = Math.max(...values.map((v) => Math.abs(v))) >= 1e6;
  return (v) => {
    if (millions) {
      const m = roundTo(v / 1e6, 1);
      return `${m < 0 ? MINUS : ''}$${mag(m, 1)}M`;
    }
    const k = roundTo(v / 1000) * 1000;
    return `${k < 0 ? MINUS : ''}$${mag(k, 0)}`;
  };
}

// ── verdicts and ranges ──────────────────────────────────────────────────────

export type Verdict = 'better' | 'worse' | 'same';

/** A (rounded) change as a verdict for OTTO-Q, given which direction is good. Null when there is no change to judge. */
export function verdictOf(change: number | null, goodWhen: 'up' | 'down'): Verdict | null {
  if (change === null) return null;
  if (change === 0) return 'same';
  return (change > 0) === (goodWhen === 'up') ? 'better' : 'worse';
}

export interface SpreadWords {
  digits: number;
  /** printed after each number: '%', ' h' */
  unit?: string;
  /** the word for a positive value, and for a negative one: 'lower' / 'higher', 'more' / 'fewer' */
  up: string;
  down: string;
  /** printed once at the end: ' cars a day' */
  tail?: string;
}

/**
 * A seed range in words, in the direction each end actually went. Positive values are OTTO-Q's gain in the contract's
 * own sign ("saved", "delta"), so 25.1..30.2 saved reads "25.1–30.2% lower", −7.4..−0.8 reads "0.8–7.4% higher", and a
 * range that straddles zero says both: "2.1% higher to 5.3% lower".
 */
export function spreadWords(r: Range, o: SpreadWords): string {
  const u = o.unit ?? '', t = o.tail ?? '';
  const lo = roundTo(Math.min(r.low, r.high), o.digits);
  const hi = roundTo(Math.max(r.low, r.high), o.digits);
  const m = (v: number) => mag(v, o.digits);
  if (lo === 0 && hi === 0) return `${m(0)}${u} change${t}`;
  if (lo >= 0) return `${lo === hi ? m(hi) : `${m(lo)}–${m(hi)}`}${u} ${o.up}${t}`;
  if (hi <= 0) return `${lo === hi ? m(lo) : `${m(hi)}–${m(lo)}`}${u} ${o.down}${t}`;
  return `${m(lo)}${u} ${o.down} to ${m(hi)}${u} ${o.up}${t}`;
}

/** "range over 3 test days: 25.1–30.2% lower". One test day has no range to show. */
export function rangeText(n: number | null, r: Range | null, o: SpreadWords): string | null {
  if (!r || n === null || n < 1) return null;
  if (n === 1) return 'from 1 test day';
  return `range over ${n} test days: ${spreadWords(r, o)}`;
}

// ── the three headline cards ─────────────────────────────────────────────────

export interface Headline {
  /** the big figure: "27.8%", "21.4", "+0.6 h"; — when not measured */
  big: string;
  /** the words beside it: "lower", "cars per charger a day" */
  words: string;
  /** null: nothing to judge */
  verdict: Verdict | null;
  lines: string[];
  /** a small line under the lines (where the power-bill saving comes from) */
  detail: string | null;
  /** the seed range */
  range: string | null;
}

function splitText(split: ChargerView['split']): string | null {
  const planning = num(split?.energy_planning_usd_month);
  const assignment = num(split?.charger_assignment_usd_month);
  const parts: string[] = [];
  if (planning !== null) parts.push(`From energy planning ${fmtUsdMonth(planning)}`);
  if (assignment !== null) parts.push(`${parts.length ? 'from' : 'From'} charger assignment ${fmtUsdMonth(assignment)}`);
  return parts.length ? parts.join('; ') : null;
}

/** 1. Power bill: the saving as a share of the plain depot's bill, the two bills, the two peaks. */
export function powerHeadline(view: ChargerView, n: number | null): Headline {
  const q = view.otto_q, p = view.plain;
  const pct = rangeOf(view.vs_plain?.power_bill_saved_pct);
  const mid = pct ? roundTo(pct.mid, 1) : null;
  return {
    big: mid === null ? DASH : `${mag(mid, 1)}%`,
    words: mid === null ? 'not measured' : mid > 0 ? 'lower' : mid < 0 ? 'higher' : 'change',
    verdict: verdictOf(mid, 'up'),
    lines: [
      `${fmtUsdMonth(p?.power_bill_usd_month)} → ${fmtUsdMonth(q?.power_bill_usd_month)} a month`,
      `Peak demand ${fmtNumber(p?.peak_kw)} → ${fmtNumber(q?.peak_kw)} kW`,
    ],
    detail: splitText(view.split),
    range: rangeText(n, pct, { digits: 1, unit: '%', up: 'lower', down: 'higher' }),
  };
}

/** 2. Chargers: how many cars each fast charger serves in a day, against the plain depot. */
export function chargersHeadline(view: ChargerView, n: number | null): Headline {
  const q = num(view.otto_q?.cars_per_fast_charger_day);
  const p = num(view.plain?.cars_per_fast_charger_day);
  const change = q === null || p === null ? null : roundTo(roundTo(q, 1) - roundTo(p, 1), 1);
  return {
    big: fmtNumber(q, 1),
    words: 'cars per charger a day',
    verdict: verdictOf(change, 'up'),
    lines: [
      `${fmtNumber(p, 1)} at a plain depot`,
      `${fmtNumber(view.otto_q?.cars_served_day)} cars fully serviced a day`,
    ],
    detail: null,
    range: rangeText(n, rangeOf(view.vs_plain?.cars_served_delta_day), {
      digits: 0, up: 'more', down: 'fewer', tail: ' cars a day',
    }),
  };
}

/** "+$12 per car a day ($10–$14)": the mid at $20 a car-hour, then at $16 and at $24. Cents only below $10. */
function revenueUsdLine(vs: ChargerView['vs_plain']): string | null {
  const r = rangeOf(vs?.revenue_usd_per_car_day);
  if (!r) return null;
  const band = Array.isArray(vs?.revenue_usd_per_car_day_band) ? vs.revenue_usd_per_car_day_band.map(num) : [];
  const [at16, at24] = band.length === 2 && band[0] !== null && band[1] !== null ? band : [null, null];
  const digits = Math.max(Math.abs(r.mid), Math.abs(at16 ?? 0), Math.abs(at24 ?? 0)) < 10 ? 2 : 0;
  let text = `${usdSigned(r.mid, digits, true)} per car a day`;
  if (at16 !== null && at24 !== null) {
    const a = usdSigned(at16, digits, false), b = usdSigned(at24, digits, false);
    text += at16 < 0 || at24 < 0 ? ` (${a} to ${b})` : ` (${a}–${b})`;
  }
  return text;
}

/** 3. Revenue time: the hours of rides each car gains a day, in dollars, and the share of ride demand met. */
export function revenueHeadline(view: ChargerView, n: number | null): Headline {
  const q = view.otto_q, p = view.plain;
  const hours = rangeOf(view.vs_plain?.revenue_hours_per_car_day_delta);
  const mid = hours ? roundTo(hours.mid, 1) : null;
  const usd = revenueUsdLine(view.vs_plain);
  return {
    big: mid === null ? DASH : `${signedNumber(mid, 1)} h`,
    words: 'per car a day',
    verdict: verdictOf(mid, 'up'),
    lines: [
      ...(usd ? [usd] : []),
      `${fmtPct(q?.demand_met_pct)} of ride demand met (${fmtPct(p?.demand_met_pct)} at a plain depot)`,
    ],
    detail: null,
    range: rangeText(n, hours, { digits: 1, unit: ' h', up: 'more', down: 'less' }),
  };
}

// ── the standard measures ────────────────────────────────────────────────────

interface KpiSpec {
  key: string;
  name: string;
  pick: (b: ArmBlock) => unknown;
  digits: number;
  better: 'up' | 'down';
  /** dollars a month, to the nearest hundred */
  money?: boolean;
  /** a percentage, whose change is in points */
  points?: boolean;
  /** a small note under each figure */
  note?: (b: ArmBlock) => string | null;
}

const KPI_SPECS: KpiSpec[] = [
  { key: 'peak', name: 'Peak demand (kW)', pick: (b) => b.peak_kw, digits: 0, better: 'down' },
  { key: 'demand_charge', name: 'Demand charge ($/month)', pick: (b) => b.demand_charge_usd_month, digits: 0, better: 'down', money: true },
  { key: 'rate', name: 'Effective electricity rate (¢/kWh)', pick: (b) => b.effective_cents_per_kwh, digits: 1, better: 'down' },
  {
    key: 'bill', name: 'Power bill ($/month)', pick: (b) => b.power_bill_usd_month, digits: 0, better: 'down', money: true,
    note: (b) => (typeof b.power_rate === 'string' ? b.power_rate : null),
  },
  { key: 'served', name: 'Cars fully serviced per day', pick: (b) => b.cars_served_day, digits: 0, better: 'up' },
  { key: 'per_charger', name: 'Cars per fast charger per day', pick: (b) => b.cars_per_fast_charger_day, digits: 1, better: 'up' },
  { key: 'turnaround', name: 'Median turnaround (min)', pick: (b) => b.turnaround_p50_min, digits: 0, better: 'down' },
  { key: 'utilization', name: 'Fast charger utilization (%)', pick: (b) => b.fast_charger_busy_pct, digits: 1, better: 'up', points: true },
  { key: 'demand_met', name: 'Ride demand met (%)', pick: (b) => b.demand_met_pct, digits: 1, better: 'up', points: true },
  { key: 'revenue_hours', name: 'Revenue hours per car per day', pick: (b) => b.revenue_hours_per_car_day, digits: 1, better: 'up' },
];

export interface KpiRow {
  key: string;
  name: string;
  plain: string;
  ottoQ: string;
  change: string;
  verdict: Verdict | null;
  plainNote: string | null;
  ottoQNote: string | null;
}

/** The ten standard measures, plain depot beside OTTO-Q, in the order the tab prints them. */
export function kpiRows(view: ChargerView): KpiRow[] {
  return KPI_SPECS.map((s) => {
    const rounded = (b: ArmBlock | null): number | null => {
      const n = b ? num(s.pick(b)) : null;
      if (n === null) return null;
      return s.money ? roundTo(n / 100) * 100 : roundTo(n, s.digits);
    };
    const p = rounded(view.plain), q = rounded(view.otto_q);
    const change = p === null || q === null ? null : roundTo(q - p, s.digits);
    const show = (v: number | null) => (v === null ? DASH : s.money ? fmtUsdMonth(v) : fmtNumber(v, s.digits));
    return {
      key: s.key,
      name: s.name,
      plain: show(p),
      ottoQ: show(q),
      change: change === null ? DASH : s.money ? usdSigned(change, 0, true) : `${signedNumber(change, s.digits)}${s.points ? ' pts' : ''}`,
      verdict: verdictOf(change, s.better),
      plainNote: s.note && view.plain ? s.note(view.plain) : null,
      ottoQNote: s.note && view.otto_q ? s.note(view.otto_q) : null,
    };
  });
}

// ── the rest of the page ─────────────────────────────────────────────────────

/** Rule 9's promise, counted. Short departures are named, never hidden. */
export function guaranteeText(g: ValueSummary['guarantee']): { short: boolean; text: string } | null {
  const departures = num(g?.departures), full = num(g?.full_and_serviced);
  if (departures === null || full === null) return null;
  const counted = `${fmtNumber(full)} of ${fmtNumber(departures)} departures`;
  if (full >= departures) {
    return { short: false, text: `Every car left 100% charged with every needed service done: ${counted}.` };
  }
  return {
    short: true,
    text: `${fmtNumber(departures - full)} left short: ${counted} left 100% charged with every needed service done.`,
  };
}

export interface InvestorLines {
  statement: string | null;
  avoided: string | null;
  chargerCapital: string | null;
  fleet: string | null;
}

const triple = (v: unknown): [number, number, number] | null => {
  if (!Array.isArray(v) || v.length !== 3) return null;
  const [a, b, c] = v.map(num);
  return a === null || b === null || c === null ? null : [a, b, c];
};

const capitalRange = ([low, , high]: [number, number, number], f: (v: number) => string): string =>
  low < 0 || high < 0 ? `${f(low)} to ${f(high)}` : `${f(low)}–${f(high)}`;

/** The capital lens: what an investor reads, never added to the savings. */
export function investorLines(inv: ValueSummary['investor']): InvestorLines | null {
  if (!inv) return null;
  const chargers = triple(inv.charger_capex_avoided_usd);
  const fleet = triple(inv.fleet_capex_equiv_usd);
  const cars = num(inv.fleet_equiv_cars);
  const avoided = num(inv.chargers_avoided);
  let chargerCapital: string | null = null;
  if (chargers) {
    const f = capitalFormatter(chargers);
    chargerCapital = `Charger capital avoided: ${capitalRange(chargers, f)} (point ${f(chargers[1])})`;
  }
  let fleetLine: string | null = null;
  if (cars !== null) {
    const carsText = `${cars < 0 ? MINUS : ''}${trim1(cars)} cars`;
    fleetLine = fleet
      ? `Fleet capital equivalent: ${carsText}, ${capitalRange(fleet, capitalFormatter(fleet))}`
      : `Fleet capital equivalent: ${carsText}`;
  }
  return {
    statement: typeof inv.chargers_statement === 'string' && inv.chargers_statement ? inv.chargers_statement : null,
    avoided: avoided === null ? null : `Fast chargers avoided: ${fmtNumber(avoided)}`,
    chargerCapital,
    fleet: fleetLine,
  };
}

/** "3 of 24 test days done", or null when the sweep does not say. */
export function progressText(sweep: ValueSummary['sweep']): string | null {
  const done = num(sweep?.arms_done), planned = num(sweep?.arms_planned);
  if (done === null || planned === null || planned <= 0) return null;
  return `${fmtNumber(done)} of ${fmtNumber(planned)} test days done`;
}

/** Still running: 0576 calls a sweep 'measured' as soon as one seed pairs, so the page says when more days are coming. */
export function stillMeasuring(sweep: ValueSummary['sweep']): boolean {
  const done = num(sweep?.arms_done), planned = num(sweep?.arms_planned);
  return done !== null && planned !== null && done < planned;
}

/**
 * Night 2's first results were due Thursday morning, 2026-10-01. The sentence that says so stops at noon CT that day, so a
 * page still waiting after it never promises a morning that has passed.
 */
export const FIRST_RESULTS_DUE_UTC = Date.parse('2026-10-01T17:00:00Z');

/** The not-measured panel's words. Its only numbers are the sweep's own plan and progress. */
export function notMeasuredText(sweep: ValueSummary['sweep'], now: number = Date.now()): { lead: string; progress: string | null } {
  const planned = num(sweep?.arms_planned);
  const days = planned !== null && planned > 0 ? fmtNumber(planned) : '24';
  const when = now < FIRST_RESULTS_DUE_UTC ? 'First results Thursday morning.' : 'Results appear here as the test days finish.';
  return {
    lead: `Night 2 measures this: ${days} test days on the calibrated twin, each OTTO-Q against a plain depot. ${when}`,
    progress: sweep ? progressText(sweep) : null,
  };
}

/** "OTTOYARD Nashville Flagship · 116 cars · 3,000 kWh battery · 600 kW solar". */
export function depotLine(d: ValueSummary['depot'] | null): string | null {
  if (!d) return null;
  const parts: string[] = [];
  if (typeof d.name === 'string' && d.name) parts.push(d.name);
  if (num(d.fleet)) parts.push(`${fmtNumber(d.fleet)} cars`);
  if (num(d.battery_kwh)) parts.push(`${fmtNumber(d.battery_kwh)} kWh battery`);
  if (num(d.solar_kw)) parts.push(`${fmtNumber(d.solar_kw)} kW solar`);
  return parts.length ? parts.join(' · ') : null;
}

const ROLE_LABEL: Record<'otto_q' | 'plain' | 'otto_q_planner_off' | 'fifo_planner_on', string> = {
  otto_q: 'OTTO-Q',
  plain: 'Plain depot',
  otto_q_planner_off: 'OTTO-Q without energy planning',
  fifo_planner_on: 'First come, first served with energy planning',
};

/** A test cell in words ("Plain depot · 10 chargers"); a cell no view names reads as its own code. */
export function cellLabel(cell: string, views: ChargerView[]): string {
  for (const v of views) {
    for (const role of Object.keys(ROLE_LABEL) as (keyof typeof ROLE_LABEL)[]) {
      if (v[role]?.cell === cell) return `${ROLE_LABEL[role]} · ${v.fast_chargers} chargers`;
    }
  }
  return cell;
}

/** Only a web address is a link; anything else (a repository path) is shown as text. */
export const safeHref = (url: unknown): string | null =>
  typeof url === 'string' && /^https?:\/\//i.test(url) ? url : null;

/** "Oct 1, 5:48 AM CT". Reporting only; the timestamps stay UTC. */
export function dayClockCT(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} CT`;
}

/** The footnote, with the sweep's own day length and step where it gives them. */
export function footnoteText(sweep: ValueSummary['sweep']): string {
  const hours = num(sweep?.day_hours) ?? 24;
  const step = num(sweep?.step_min) ?? 5;
  return (
    `Twin results on the calibrated digital twin: ${trim1(hours)}-hour busy days at ${trim1(step)}-minute steps; ` +
    'a month is 30 days like these. Prices: each depot on the cheapest Nashville Electric Service rate it qualifies ' +
    "for. Revenue: $16–24 per car-hour from Waymo's public figures."
  );
}
