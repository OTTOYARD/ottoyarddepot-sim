// ============================================================================
// powerOneLine.test.ts — the one-line is parsed strictly and put into honest words.
//
// The fixture (components/tabs/__fixtures__/powerOneLine.labDay.json) is a REAL answer of otto-q-core 0810's
// ottoq_power_one_line: one lab day on a copy of production's engine (busy_day, seed 171717, 2-minute ticks, 6 AM to
// 8 PM depot time, transformer TX-B1 tripped for an hour at 2 PM, run e2c1a471). It is a research-lab day, not a production run.
//
// What is asserted, and why:
//   1. The tree is the depot's: one service, seven transformers, thirty posts, five to a charger transformer.
//   2. The engine's own conservation holds in what the page shows: the posts' energy is the service's DC energy.
//   3. Nothing is invented: a missing reading is a dash, an unknown kind is dropped, an error body is null.
//   4. Heat reads against 110 C, the loading guide's reference, and a trip is active only inside its window.
//   5. The right-size sentence never reads as a change, and says "installed" when the day needed what is there.
// ============================================================================
import { describe, expect, it } from 'vitest';
import labDay from '@/components/tabs/__fixtures__/powerOneLine.labDay.json';
import {
  DASH, activeTrip, childrenOf, fmtC, fmtKv, fmtKva, fmtKw, fmtMwh, fmtPct, heatOf, lifeWords, loadShares, notMeasuredText,
  num, postState, postsAskedWords, readOneLine, resilienceWords, rightsizeWords, service, siteNow, transformers, type OneLine, type PowerNode,
} from './powerOneLine';

const day = (): OneLine => readOneLine(JSON.parse(JSON.stringify(labDay)))!;

describe('reading the engine\'s answer', () => {
  it('is the depot\'s tree: 1 service, 7 transformers, 30 posts, five to a charger transformer', () => {
    const o = day();
    expect(service(o)?.code).toBe('SERVICE');
    const tx = transformers(o);
    expect(tx.map((t) => t.code)).toEqual(['TX-A1', 'TX-A2', 'TX-B1', 'TX-B2', 'TX-C1', 'TX-C2', 'TX-AUX']);
    expect(o.nodes.filter((n) => n.kind === 'post')).toHaveLength(30);
    for (const t of tx.slice(0, 6)) expect(childrenOf(o, t.code).filter((n) => n.kind === 'post')).toHaveLength(5);
    expect(childrenOf(o, 'TX-AUX').map((n) => n.kind).sort()).toEqual(['bess', 'building', 'solar']);
  });

  it('every rating is at or above 125% of what is connected under it (rule 13)', () => {
    const o = day();
    for (const t of transformers(o)) {
      const connectedKva = childrenOf(o, t.code).reduce((s, n) =>
        s + (n.kind === 'post' ? (n.rated_kw ?? 0) / 0.94 : n.kind === 'solar' ? 0 : n.rated_kw ?? 0), 0) / 0.97;
      expect(t.rated_kva!).toBeGreaterThanOrEqual(connectedKva * 1.25);
    }
    expect(service(o)!.rated_kva).toBe(transformers(o).reduce((s, t) => s + (t.rated_kva ?? 0), 0));
  });

  it('the posts\' energy is the service\'s DC energy, to the rounding of thirty rows', () => {
    const o = day();
    const posts = o.nodes.filter((n) => n.kind === 'post').reduce((s, n) => s + (n.study?.energy_kwh_dc ?? 0), 0);
    expect(Math.abs(posts - service(o)!.study!.energy_kwh_dc!)).toBeLessThan(2);
    // and the grid side is more than reached the cars' side of the charger transformers
    const tx = transformers(o).slice(0, 6);
    const ac = tx.reduce((s, t) => s + (t.study?.energy_kwh_ac ?? 0), 0);
    const dc = tx.reduce((s, t) => s + (t.study?.energy_kwh_dc ?? 0), 0);
    expect(ac / dc).toBeCloseTo(1 / 0.94, 2);
  });

  it('drops what it cannot read and never guesses', () => {
    expect(readOneLine(null)).toBeNull();
    expect(readOneLine({ message: 'function public.ottoq_power_one_line does not exist' })).toBeNull();
    expect(readOneLine({ nodes: [] })).toBeNull();
    const o = readOneLine({ nodes: [{ code: 'X', kind: 'reactor' }, { code: 'TX-1', kind: 'transformer', rated_kva: '2500', now: { load_pu: 'abc' } }] })!;
    expect(o.nodes).toHaveLength(1);
    expect(o.nodes[0].rated_kva).toBe(2500);
    expect(o.nodes[0].now?.load_pu).toBeNull();
    expect(o.nodes[0].study).toBeNull();
    expect(num('')).toBeNull();
    expect(num(Number.NaN)).toBeNull();
  });
});

describe('states', () => {
  const post = (over: Partial<PowerNode>): PowerNode => ({
    code: 'P', parent: 'TX', kind: 'post', title: 'P', voltage_v: 480, rated_kva: null, rated_kw: 350, canopy: null,
    charger_state: 'Available', power_node_fault: null, now: null, study: null, ...over,
  });
  const reading = (kw: number) => ({ kw_dc: kw, kw_ac: kw / 0.94, kva: null, load_pu: kw / 350, loss_kw: null, ambient_c: null, top_oil_c: null, hot_spot_c: null, aging_factor: null });

  it('a post is down when its charger is, whatever its last reading', () => {
    expect(postState(post({ charger_state: 'Faulted', now: reading(200) }))).toBe('down');
    expect(postState(post({ now: reading(200) }))).toBe('charging');
    expect(postState(post({ now: reading(0) }))).toBe('idle');
    expect(postState(post({}))).toBe('idle');
  });

  it('heat reads against 110 C', () => {
    expect(heatOf(null)).toBe('unknown');
    expect(heatOf(60)).toBe('cool');
    expect(heatOf(95)).toBe('warm');
    expect(heatOf(110)).toBe('warm');
    expect(heatOf(110.1)).toBe('hot');
  });

  it('a trip is active only between its trip and its return', () => {
    const o = day();
    const trip = o.trips[0];
    expect(trip.node).toBe('TX-B1');
    expect(trip.posts_faulted).toBe(4);                              // the fifth post was already down with a fault of its own
    expect(activeTrip(o, 'TX-B1')).toBeNull();                       // the day ended long after power came back
    const mid = new Date((Date.parse(trip.tripped_at_sim!) + Date.parse(trip.recovers_at_sim!)) / 2).toISOString();
    expect(activeTrip({ ...o, as_of_sim: mid }, 'TX-B1')?.trip_id).toBe(trip.trip_id);
    expect(activeTrip({ ...o, as_of_sim: mid }, 'TX-B2')).toBeNull();
    expect(activeTrip({ ...o, as_of_sim: trip.recovers_at_sim }, 'TX-B1')).toBeNull();
    expect(activeTrip({ ...o, as_of_sim: null }, 'TX-B1')).toBeNull();
  });
});

describe('totals and words', () => {
  it('site totals come from the service and the charger transformers', () => {
    const o = day();
    const n = siteNow(o);
    expect(n.posts).toBe(30);
    expect(n.gridKw).toBe(service(o)!.now!.kw_ac);
    expect(n.carsKw).toBe(service(o)!.now!.kw_dc);
    expect(n.hottest && transformers(o).every((t) => (t.now?.hot_spot_c ?? -1) <= (n.hottest!.now!.hot_spot_c as number))).toBe(true);
    if (n.lostKw !== null) expect(n.lostKw).toBeGreaterThan(0);
  });

  it('formats, and a missing reading is a dash', () => {
    expect(fmtKw(1234.4)).toBe('1,234 kW');
    expect(fmtKva(null)).toBe(DASH);
    expect(fmtMwh(999)).toBe('999 kWh');
    expect(fmtMwh(12345)).toBe('12.35 MWh');
    expect(fmtPct(0.0897)).toBe('9%');
    expect(fmtPct(undefined)).toBe(DASH);
    expect(fmtC(45.14)).toBe('45 °C');
    expect(fmtKv(13800)).toBe('13.8 kV');
    expect(fmtKv(480)).toBe('480 V');
    expect(lifeWords(null)).toBe(DASH);
  });

  it('load shares sum to one over eleven bins, or are all zero', () => {
    const o = day();
    const shares = loadShares(transformers(o)[0].study);
    expect(shares).toHaveLength(11);
    expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    expect(loadShares(null)).toEqual(Array(11).fill(0));
  });

  it('the right-size sentence is a reading, never a change', () => {
    const o = day();
    const t = transformers(o)[0];
    const words = rightsizeWords(t)!;
    expect(words).toMatch(/installed/);
    expect(words).not.toMatch(/should|must|replace|downsize/i);
    const need: PowerNode = { ...t, study: { ...t.study!, rightsize: { installed_kva: 2500, smallest_kva_this_day_fits: 2500, by_size: [] } } };
    expect(rightsizeWords(need)).toBe('This day needed the 2,500 kVA that is installed.');
    const none: PowerNode = { ...t, study: { ...t.study!, rightsize: { installed_kva: 2500, smallest_kva_this_day_fits: null, by_size: [{ kva: 3750, max_hot_spot_c: 130, aging_vs_normal: 4 }] } } };
    expect(rightsizeWords(none)).toMatch(/No standard size up to 3,750 kVA/);
    expect(rightsizeWords({ ...t, study: null })).toBeNull();
  });

  it('says whether the day could have ridden through losing a transformer, and never more than the reading knows', () => {
    const o = day();
    const clock = (iso: string | null) => (iso ? iso.slice(11, 16) : '?');
    const short = transformers(o).find((t) => (t.study?.resilience?.worst_shortfall_cars ?? 0) > 0)!;
    expect(resilienceWords(short, clock)).toMatch(/would have had no free post under the other transformers and would have waited/);
    const fine: PowerNode = { ...short, study: { ...short.study!, resilience: { ...short.study!.resilience!, worst_shortfall_cars: 0, cars_at_busiest: 4, free_posts_elsewhere_then: 19, busiest_at: '2026-09-01T19:14:00+00:00' } } };
    expect(resilienceWords(fine, clock)).toBe('Had it tripped at its busiest moment (19:14, 4 cars), the other transformers had 19 posts free: every car could have moved and finished.');
    const idle: PowerNode = { ...short, study: { ...short.study!, resilience: { ...short.study!.resilience!, cars_at_busiest: 0 } } };
    expect(resilienceWords(idle, clock)).toBe('No car charged under this transformer on this run.');
    expect(resilienceWords({ ...short, study: { ...short.study!, resilience: null } }, clock)).toBeNull();
    expect(resilienceWords(transformers(o).find((t) => t.code === 'TX-AUX')!, clock)).toBeNull();   // no posts under it
  });

  it('says what the day asked of the posts', () => {
    const o = day();
    const r = service(o)!.study!.resilience!;
    expect(postsAskedWords(o)).toBe(
      `The most any post delivered was ${Math.round(r.most_any_post_delivered_kw!)} kW of its 350 kW, over ${r.sessions} charges. ${r.cars_that_can_take_over_150_kw} of the depot's ${r.cars} cars can take more than 150 kW at all.`);
    expect(r.most_any_post_delivered_kw!).toBeLessThan(150);
    const none: OneLine = { ...o, nodes: o.nodes.map((n) => (n.kind === 'utility_service' ? { ...n, study: { ...n.study!, resilience: null } } : n)) };
    expect(postsAskedWords(none)).toBeNull();
  });

  it('says what is missing in plain words', () => {
    expect(notMeasuredText(null)).toMatch(/0810/);
    expect(notMeasuredText(day())).toMatch(/Start a run/);
  });
});
