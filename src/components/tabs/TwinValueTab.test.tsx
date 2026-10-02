// ============================================================================
// TwinValueTab.test.tsx — the Value tab draws night 2's numbers honestly.
//
// The fixture (__fixtures__/valueSummary.example.json) is an EXAMPLE, not a
// result: hand-written plausible numbers in otto-q-core 0576's shape, so the tab
// can be drawn and tested before the function answers. Only this file imports it.
//
// What is asserted, and why:
//   1. The three cards print the right rounded figures, and the charger toggle
//      moves them (10 is the depot as built, 20 the build-out).
//   2. Signs are honest: where OTTO-Q's bill is higher the card says "higher",
//      never "lower", and nothing on that card is green.
//   3. The guarantee is never hidden: a car that left short turns the strip
//      amber and is counted.
//   4. No number is invented: an RPC error, status 'none', and 'measuring' with
//      no pair complete all draw the calm panel and no measured figure.
//   5. Value is the last tab.
// ============================================================================
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/ottoQClient', () => ({ ottoQ: { rpc } }));

import example from './__fixtures__/valueSummary.example.json';
import { TwinValueTab } from './TwinValueTab';
import { TabBar } from '@/components/layout/TabBar';
import {
  fmtUsdMonth,
  footnoteText,
  guaranteeText,
  kpiRows,
  notMeasuredText,
  spreadWords,
  type ValueSummary,
} from '@/lib/valueSummary';

const EXAMPLE = example as unknown as ValueSummary;
const clone = (): ValueSummary => JSON.parse(JSON.stringify(EXAMPLE)) as ValueSummary;
const tenChargers = (s: ValueSummary) => s.views.find((v) => v.fast_chargers === 10)!;
const answer = (data: unknown) => rpc.mockResolvedValue({ data, error: null });

beforeEach(() => {
  rpc.mockReset();
  try { window.localStorage.clear(); } catch { /* storage may be unavailable */ }
});
afterEach(() => { cleanup(); });

describe('the three cards', () => {
  it('print the 10-charger figures, and the 20-charger ones once switched', async () => {
    answer(EXAMPLE);
    render(<TwinValueTab />);

    const power = await screen.findByTestId('value-card-power');
    expect(rpc).toHaveBeenCalledWith('ottoq_value_summary', { p_sweep_code: null });
    expect(screen.getByRole('tab', { name: '10 fast chargers' })).toHaveAttribute('aria-selected', 'true');
    expect(power).toHaveTextContent('27.8% lower');
    expect(power).toHaveTextContent('$52,900 → $38,200 a month');
    expect(power).toHaveTextContent('Peak demand 1,890 → 1,180 kW');
    expect(power).toHaveTextContent('From energy planning $9,800; from charger assignment $4,900');
    expect(power).toHaveTextContent('range over 3 test days: 25.1–30.2% lower');

    const chargers = screen.getByTestId('value-card-chargers');
    expect(chargers).toHaveTextContent('21.4 cars per charger a day');
    expect(chargers).toHaveTextContent('18.8 at a plain depot');
    expect(chargers).toHaveTextContent('214 cars fully serviced a day');
    expect(chargers).toHaveTextContent('range over 3 test days: 20–32 more cars a day');

    const revenue = screen.getByTestId('value-card-revenue');
    expect(revenue).toHaveTextContent('+0.6 h per car a day');
    expect(revenue).toHaveTextContent('+$12 per car a day ($10–$14)');
    expect(revenue).toHaveTextContent('97.1% of ride demand met (91.0% at a plain depot)');
    expect(revenue).toHaveTextContent('range over 3 test days: 0.4–0.8 h more');

    expect(screen.getByTestId('value-guarantee')).toHaveTextContent(
      'Every car left 100% charged with every needed service done: 2,628 of 2,628 departures.',
    );
    expect(screen.getByTestId('value-kpi-bill')).toHaveTextContent('−$14,700');
    expect(screen.getByTestId('value-kpi-bill')).toHaveTextContent('better');

    fireEvent.click(screen.getByRole('tab', { name: '20 fast chargers' }));
    expect(screen.getByTestId('value-card-power')).toHaveTextContent('33.9% lower');
    expect(screen.getByTestId('value-card-power')).toHaveTextContent('$58,400 → $38,600 a month');
    expect(screen.getByTestId('value-card-power')).toHaveTextContent('Peak demand 2,460 → 1,240 kW');
    expect(screen.getByTestId('value-card-chargers')).toHaveTextContent('11.3 cars per charger a day');
    expect(screen.getByTestId('value-card-chargers')).toHaveTextContent('10.2 at a plain depot');
    expect(screen.getByTestId('value-card-revenue')).toHaveTextContent('+0.7 h per car a day');
    expect(screen.getByTestId('value-card-revenue')).toHaveTextContent('+$14 per car a day ($11–$17)');
    expect(screen.getByTestId('value-card-power')).not.toHaveTextContent('27.8%');
    expect(window.localStorage.getItem('ottoq_value_fast_chargers')).toBe('20');
  });

  it('opens on the remembered charger count', async () => {
    window.localStorage.setItem('ottoq_value_fast_chargers', '20');
    answer(EXAMPLE);
    render(<TwinValueTab />);
    expect(await screen.findByTestId('value-card-power')).toHaveTextContent('33.9% lower');
  });

  it('keeps the capital lens collapsed until asked, and apart from the savings', async () => {
    answer(EXAMPLE);
    render(<TwinValueTab />);
    await screen.findByTestId('value-card-power');
    expect(screen.queryByText(/Charger capital avoided/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /For investors/ }));
    expect(screen.getByText('Charger capital avoided: $1.5M–$3.0M (point $2.0M)')).toBeInTheDocument();
    expect(screen.getByText('Fleet capital equivalent: 7.7 cars, $0.9M–$1.5M')).toBeInTheDocument();
    expect(screen.getByText('The capital lens, never added to the savings above')).toBeInTheDocument();
  });
});

describe('honest signs', () => {
  it('says "higher", never "lower", and uses no green where OTTO-Q\'s bill is higher', async () => {
    const s = clone();
    const v = tenChargers(s);
    v.otto_q!.power_bill_usd_month = 54_500;
    v.vs_plain!.power_bill_saved_usd_month = { low: -3_900, mid: -1_600, high: -400 };
    v.vs_plain!.power_bill_saved_pct = { low: -7.4, mid: -3.1, high: -0.8 };
    v.split = { energy_planning_usd_month: -1_000, charger_assignment_usd_month: -600 };
    answer(s);
    render(<TwinValueTab />);

    const power = await screen.findByTestId('value-card-power');
    expect(power).toHaveTextContent('3.1% higher');
    expect(power).not.toHaveTextContent('lower');
    expect(power).toHaveTextContent('$52,900 → $54,500 a month');
    expect(power).toHaveTextContent('From energy planning −$1,000; from charger assignment −$600');
    expect(power).toHaveTextContent('range over 3 test days: 0.8–7.4% higher');
    expect(power.innerHTML).not.toMatch(/emerald|green|teal/);

    const bill = screen.getByTestId('value-kpi-bill');
    expect(bill).toHaveTextContent('+$1,600');
    expect(bill).toHaveTextContent('worse');
    expect(bill.innerHTML).not.toMatch(/emerald|green|teal/);
  });

  it('prints a revenue loss as a minus in neutral ink', async () => {
    const s = clone();
    const v = tenChargers(s);
    v.vs_plain!.revenue_hours_per_car_day_delta = { low: -0.6, mid: -0.4, high: -0.1 };
    v.vs_plain!.revenue_usd_per_car_day = { low: -12, mid: -8, high: -2 };
    v.vs_plain!.revenue_usd_per_car_day_band = [-6.4, -9.6];
    answer(s);
    render(<TwinValueTab />);

    const revenue = await screen.findByTestId('value-card-revenue');
    expect(revenue).toHaveTextContent('−0.4 h per car a day');
    expect(revenue).toHaveTextContent('−$8.00 per car a day (−$6.40 to −$9.60)');
    expect(revenue).toHaveTextContent('range over 3 test days: 0.1–0.6 h less');
    expect(revenue.innerHTML).not.toMatch(/emerald|green|teal/);
  });
});

describe('the guarantee', () => {
  it('turns amber and counts the cars that left short', async () => {
    const s = clone();
    s.guarantee = { departures: 2_628, full_and_serviced: 2_625 };
    answer(s);
    render(<TwinValueTab />);

    const strip = await screen.findByTestId('value-guarantee');
    expect(strip).toHaveTextContent('3 left short');
    expect(strip).toHaveTextContent('2,625 of 2,628 departures');
    expect(strip).not.toHaveTextContent('Every car left');
    expect(strip.className).toMatch(/amber/);
    expect(strip.className).not.toMatch(/emerald/);
  });
});

describe('not measured yet', () => {
  /** The calm panel is up, and nothing that looks like a measured result is on the page (the guarantee aside). */
  async function expectCalmPanel(container: HTMLElement) {
    expect(await screen.findByTestId('value-not-measured')).toHaveTextContent(
      'Night 2 measures this: 24 test days on the calibrated twin, each OTTO-Q against a plain depot.',
    );
    const promise = screen.queryByTestId('value-guarantee')?.textContent ?? '';
    expect((container.textContent ?? '').replace(promise, '')).not.toMatch(/\$|%|kW|¢/);
    expect(screen.queryByTestId('value-card-power')).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByText(/OTTOYARD Nashville Flagship/)).toBeNull();
  }

  it('when the RPC errors: a small muted note, no red error wall', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: 'Could not find the function public.ottoq_value_summary(p_sweep_code) in the schema cache', code: 'PGRST202' },
    });
    const { container } = render(<TwinValueTab />);
    await expectCalmPanel(container);
    expect(container.textContent).not.toMatch(/\$|%|kW|¢/);
    const note = screen.getByText(/checks again every minute/);
    expect(note.className).toMatch(/text-ink-faint/);
    expect(container.innerHTML).not.toMatch(/text-red|brand-red|otto-red/);
  });

  it('when the RPC throws', async () => {
    rpc.mockRejectedValue(new Error('network down'));
    const { container } = render(<TwinValueTab />);
    await expectCalmPanel(container);
    expect(screen.getByText(/checks again every minute/)).toBeInTheDocument();
  });

  it("when the status is 'none'", async () => {
    answer({
      status: 'none', sweep: null, depot: EXAMPLE.depot, views: [], investor: null, guarantee: null, runs: [],
      sources: EXAMPLE.sources, notes: ['No value sweep is defined yet.'],
    });
    const { container } = render(<TwinValueTab />);
    await expectCalmPanel(container);
    expect(container.textContent).not.toMatch(/\$|%|kW|¢/);
    expect(screen.queryByText(/checks again every minute/)).toBeNull();
  });

  it("when the status is 'measuring' with no pair complete: the sweep's progress, and the promise counted so far", async () => {
    const s = clone();
    s.status = 'measuring';
    s.sweep = { ...s.sweep!, arms_done: 3, seeds_done: 0 };
    s.views = [{ ...tenChargers(s), plain: null, vs_plain: null, split: null }];
    s.investor = null;
    s.guarantee = { departures: 214, full_and_serviced: 214 };
    answer(s);
    const { container } = render(<TwinValueTab />);
    await expectCalmPanel(container);
    expect(screen.getByText('3 of 24 test days done')).toBeInTheDocument();
    expect(screen.getByTestId('value-guarantee')).toHaveTextContent('214 of 214 departures');
  });

  it('draws a payload of the wrong shape as missing, not as a crash', async () => {
    answer({
      status: 'measured', sweep: 'nope', depot: null, investor: 7, guarantee: [], runs: 'x', sources: null, notes: [1, 'kept'],
      views: [{ fast_chargers: 10, otto_q: {}, plain: {}, vs_plain: { power_bill_saved_pct: { low: 'a', mid: 1, high: 2 } } }],
    });
    render(<TwinValueTab />);
    const power = await screen.findByTestId('value-card-power');
    expect(power).toHaveTextContent('— not measured');
    expect(power).toHaveTextContent('— → — a month');
    expect(screen.getByTestId('value-kpi-peak')).toHaveTextContent('———');
    expect(screen.queryByTestId('value-guarantee')).toBeNull();
    expect(screen.queryByRole('button', { name: /For investors/ })).toBeNull();
  });
});

describe('the tab bar', () => {
  it('lists Value after Copilot, with only Background after it', () => {
    render(<TabBar />);
    const tabs = screen.getAllByRole('button').map((b) => b.textContent);
    expect(tabs.slice(-3)).toEqual(['Copilot', 'Value', 'Background']);
  });
});

describe('formatting', () => {
  it('rounds dollars a month to the nearest hundred, with a real minus', () => {
    expect(fmtUsdMonth(38_249)).toBe('$38,200');
    expect(fmtUsdMonth(38_250)).toBe('$38,300');
    expect(fmtUsdMonth(-1_234)).toBe('−$1,200');
    expect(fmtUsdMonth(null)).toBe('—');
  });

  it('words a seed range in the direction each end went', () => {
    const pct = { digits: 1, unit: '%', up: 'lower', down: 'higher' };
    expect(spreadWords({ low: 25.1, mid: 27.8, high: 30.2 }, pct)).toBe('25.1–30.2% lower');
    expect(spreadWords({ low: -7.4, mid: -3.1, high: -0.8 }, pct)).toBe('0.8–7.4% higher');
    expect(spreadWords({ low: -2.1, mid: 1.6, high: 5.3 }, pct)).toBe('2.1% higher to 5.3% lower');
  });

  it('takes a Change between the rounded figures it prints beside', () => {
    const v = tenChargers(clone());
    v.plain!.peak_kw = 1890.4;
    v.otto_q!.peak_kw = 1179.6;
    const peak = kpiRows(v).find((r) => r.key === 'peak')!;
    expect([peak.plain, peak.ottoQ, peak.change, peak.verdict]).toEqual(['1,890', '1,180', '−710', 'better']);
  });

  it('shows the full-day peak under the billed one only when the opening moved it', () => {
    const v = tenChargers(clone());
    v.plain!.peak_kw = 1400;
    v.plain!.peak_kw_incl_opening = 1900;
    v.otto_q!.peak_kw = 1000;
    v.otto_q!.peak_kw_incl_opening = 1000.2;
    const peak = kpiRows(v).find((r) => r.key === 'peak')!;
    expect([peak.plain, peak.plainNote, peak.ottoQ, peak.ottoQNote]).toEqual(['1,400', '1,900 with the opening', '1,000', null]);
    const sweep = { ...EXAMPLE.sweep!, peak_read_from_min: 60 };
    expect(footnoteText(sweep)).toContain('Peak demand counts from 60 minutes into each day');
    expect(footnoteText({ ...sweep, peak_read_from_min: 0 })).not.toContain('Peak demand counts');
  });

  it('never calls a short departure "every car"', () => {
    expect(guaranteeText({ departures: 10, full_and_serviced: 10 })).toEqual({
      short: false, text: 'Every car left 100% charged with every needed service done: 10 of 10 departures.',
    });
    expect(guaranteeText({ departures: 10, full_and_serviced: 9 })?.text).toBe(
      '1 left short: 9 of 10 departures left 100% charged with every needed service done.',
    );
  });

  it('promises Thursday morning only until Thursday', () => {
    expect(notMeasuredText(null, Date.parse('2026-09-30T20:00:00Z')).lead).toContain('First results Thursday morning.');
    expect(notMeasuredText(null, Date.parse('2026-10-02T15:00:00Z')).lead).not.toContain('Thursday');
  });
});
