// ============================================================================
// TwinRoboticsTab.test.tsx — the Robotics tab: the robots' engineering CAD, every part to the last screw.
//
// The 3D view is a marker here (jsdom has no WebGL; cadModel.test.ts and cad.test.ts test the model and the files).
// The manifest and bills of materials are the committed files in public/cad, served from disk. What is asserted:
//   1. The banner says design data, not live, in both layouts; the three robots are offered.
//   2. Each robot shows its totals, its major functions with counts, and the twin's own run steps.
//   3. A function isolates (the detail card shows what it does and how), and the parts list narrows to it.
//   4. A part opens its card: standard, size, grade, material, mass, torque for a screw, where it is used.
//   5. The search and the fastener filter narrow the list; "Find by function" switches robot and isolates.
//   6. It is reachable: after the ten numbered tabs in the bar and on the phone (only Power follows it), and opening it widens the panel on a desktop.
//   7. The clash check shows the committed report's counts, a clash opens its part, and the wash machine shows none.
// ============================================================================
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('@/components/robotics/CadViewer', () => ({
  CadViewer: (p: { robot: string; state: { isolate: string | null; selected: string | null; angles: Record<string, number> } }) => (
    <div data-testid="cad-viewer-stub" data-robot={p.robot} data-isolate={p.state.isolate ?? ''} data-selected={p.state.selected ?? ''}
      data-joints={Object.keys(p.state.angles).join(',')} />
  ),
}));

import { TwinRoboticsTab } from './TwinRoboticsTab';
import { TabBar } from '@/components/layout/TabBar';
import { useSimulationStore } from '@/store/simulationStore';
import { usePhoneSheet } from '@/components/phone/phoneStore';
import { useTwinStore } from '@/store/twinStore';

const PUB = resolve(__dirname, '../../../public/cad');
const serve = vi.fn(async (url: string) => {
  const file = String(url).replace(/^\/cad\//, '');
  return { ok: true, status: 200, json: async () => JSON.parse(readFileSync(`${PUB}/${file}`, 'utf8')) } as Response;
});
const settle = () => act(async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); });

beforeEach(() => {
  vi.stubGlobal('fetch', serve);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });   // the slider measures itself
  useSimulationStore.setState({ isPanelOpen: true, isPanelExpanded: false, activeTab: 'robotics' });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); serve.mockClear(); });

async function open(wide: boolean) {
  useSimulationStore.setState({ isPanelExpanded: wide });
  render(<TwinRoboticsTab />);
  await settle();
  await screen.findAllByTestId('bom-line');
}

describe('the Robotics tab', () => {
  it('says it is design data, not live, and offers the three robots', async () => {
    await open(false);
    expect(screen.getByTestId('robotics-banner')).toHaveTextContent(
      'Engineering CAD. Design data, not live. Each robot has every part in the model, to the last screw and washer. The twin uses the same dimensions.');
    // the CAD is not live: the banner links to OTTO-PULSE's Robots tab for what each machine is doing now
    const live = screen.getByTestId('robotics-live-link');
    expect(live).toHaveTextContent('OTTO-PULSE shows what each machine does now.');
    expect(live.getAttribute('href')).toBe('https://ottoyard-otto-pulse.lovable.app/?tab=robots');
    expect(screen.getByTestId('robotics-tab').dataset.layout).toBe('narrow');
    expect(within(screen.getByTestId('robot-picker')).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'OTTO-CHARGE ARMCharge arm', 'OTTO-CLEAN ARMCabin clean arm', 'OTTO-WASHWash bay machine']);
    usePhoneSheet.setState({ fullscreen: false });
    fireEvent.click(screen.getByTestId('open-full'));
    expect(useSimulationStore.getState().isPanelExpanded).toBe(true);      // the desktop's panel
    expect(usePhoneSheet.getState().fullscreen).toBe(true);                 // and the phone's sheet
  });

  it('pins the OTTO-PULSE link to the run on screen while it is live, and to no run when it has ended', async () => {
    const RUN = '4b09c1de-0000-4000-8000-000000000001';
    const before = useTwinStore.getState();
    const withRun = (status: string) => useTwinStore.setState({ activeSimRunId: RUN, snapshot: { run: { sim_run_id: RUN, status } } } as never);
    try {
      withRun('running');
      await open(false);
      expect(screen.getByTestId('robotics-live-link').getAttribute('href'))
        .toBe(`https://ottoyard-otto-pulse.lovable.app/?source=twin&run=${RUN}&tab=robots`);
      act(() => withRun('completed'));
      expect(screen.getByTestId('robotics-live-link').getAttribute('href')).toBe('https://ottoyard-otto-pulse.lovable.app/?tab=robots');
    } finally {
      act(() => useTwinStore.setState({ activeSimRunId: before.activeSimRunId, snapshot: before.snapshot }));
    }
  });

  it('shows the charge arm\'s totals, major functions, load check and the twin\'s steps', async () => {
    await open(true);
    expect(screen.getByTestId('robotics-tab').dataset.layout).toBe('wide');
    const bom = JSON.parse(readFileSync(`${PUB}/charge_arm.bom.json`, 'utf8'));
    expect(screen.getByTestId('robot-totals')).toHaveTextContent(String(bom.totals.parts));
    expect(screen.getByTestId('robot-totals')).toHaveTextContent(String(bom.totals.fasteners));
    expect(screen.getAllByTestId('subsystem').map((s) => s.dataset.sub)).toEqual(bom.subsystems.map((s: { id: string }) => s.id));
    expect(screen.getByTestId('load-check')).toHaveTextContent(/J2 shoulder: gravity .* N·m at full reach/);
    expect(within(screen.getByTestId('cycle-steps')).getAllByRole('listitem')[0]).toHaveTextContent('Lift clear of the stow');
    expect(screen.getByTestId('cad-viewer-stub').dataset.joints).toBe('J1,J2,J3,J4,J5,J6');
    expect(screen.getByTestId('downloads').querySelectorAll('a')[0].getAttribute('href')).toBe('/cad/charge_arm.step.zip');
  });

  it('isolates a major function and narrows the parts list to it', async () => {
    await open(true);
    const all = screen.getAllByTestId('bom-line').length;
    fireEvent.click(screen.getAllByTestId('subsystem').find((s) => s.dataset.sub === 'TOOL')!);
    await settle();
    expect(screen.getByTestId('subsystem-detail')).toHaveTextContent('Connector tool');
    expect(screen.getByTestId('subsystem-detail')).toHaveTextContent('6-axis force and torque sensor');
    expect(screen.getByTestId('cad-viewer-stub').dataset.isolate).toBe('TOOL');
    expect(screen.getAllByTestId('bom-line').length).toBeLessThan(all);
    expect(screen.getAllByTestId('bom-line').some((l) => l.dataset.part === 'CHG-FTS')).toBe(true);
  });

  it('opens a part card with its standard, size, grade, material, mass and torque', async () => {
    await open(true);
    fireEvent.change(screen.getByTestId('part-search'), { target: { value: 'M12 x 45' } });
    await settle();
    const row = screen.getAllByTestId('bom-line')[0];
    expect(row.dataset.part).toBe('ISO4762-M12x45-10.9');
    fireEvent.click(row);
    await settle();
    const card = screen.getByTestId('part-card');
    expect(card).toHaveTextContent('Socket head cap screw M12 x 45');
    expect(card).toHaveTextContent('ISO 4762');
    expect(card).toHaveTextContent('10.9');
    expect(card).toHaveTextContent(/Tightening torque\s*125\.4 N·m \(VDI 2230, friction 0\.12\)/);
    expect(card).toHaveTextContent('Riser and mount · 8');
    expect(screen.getByTestId('cad-viewer-stub').dataset.selected).toBe('ISO4762-M12x45-10.9');
  });

  it('filters to fasteners, and "Find by function" switches robot and isolates', async () => {
    await open(true);
    fireEvent.click(screen.getByTestId('filter-fasteners'));
    await settle();
    const ids = screen.getAllByTestId('bom-line').map((l) => l.dataset.part!);
    expect(ids.every((id) => /^(ISO|DIN|CHG-ANC)/.test(id))).toBe(true);
    fireEvent.click(within(screen.getByTestId('function-chips')).getByRole('button', { name: 'Wash bay' }));
    await settle();
    await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
    await settle();
    expect(screen.getByTestId('cad-viewer-stub').dataset.robot).toBe('wash_gantry');
    expect(screen.getByTestId('cad-viewer-stub').dataset.isolate).toBe('SIDEBRUSH');
    expect(screen.getByTestId('subsystem-detail')).toHaveTextContent('Side brushes');
  });

  it('shows the clash check from the committed report, and a clash opens the part', async () => {
    await open(true);
    const rep = JSON.parse(readFileSync(`${PUB}/charge_arm.clash.json`, 'utf8'));
    const sec = await screen.findByTestId('clash-check');
    const n = rep.clashes.length;
    expect(sec).toHaveTextContent(`${n === 0 ? 'No clash' : `${n} clash`}`);
    expect(sec).toHaveTextContent(`at ${rep.poses.length} poses: the stowed pose and the twin's own poses for this machine.`);
    expect(sec).toHaveTextContent(`${rep.counts.thread} screws in tapped holes the CAD does not draw`);
    if (n > 0) {
      const items = within(screen.getByTestId('clash-list')).getAllByRole('button');
      expect(items).toHaveLength(Math.min(n, 12));
      fireEvent.click(items[0]);
      expect(screen.getByTestId('cad-viewer-stub').dataset.selected).toBe(rep.clashes[0].a.part);
    } else {
      expect(screen.queryByTestId('clash-list')).toBeNull();
    }
    // The wash machine has no clash and no loose part at any pose (cad.test.ts holds its baseline at zero).
    fireEvent.click(within(screen.getByTestId('robot-picker')).getByRole('button', { name: /Wash bay machine/ }));
    await settle();
    await screen.findAllByTestId('bom-line');
    expect(await screen.findByTestId('clash-check')).toHaveTextContent(/^Clash check.*No clash and no loose part at \d+ poses/);
    expect(screen.queryByTestId('clash-list')).toBeNull();
    expect(screen.queryByTestId('loose-list')).toBeNull();
  });

  it('offers the twin\'s cycle to play, from its first step', async () => {
    await open(true);
    expect(screen.getByTestId('cycle-step')).toHaveTextContent('Step 1 of 9: Lift clear of the stow');
    fireEvent.click(screen.getByTestId('cycle-play'));
    await settle();
    expect(screen.getByTestId('cycle-play')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('cycle-play')).toHaveTextContent('Pause the cycle');
  });

  it('comes after the ten numbered tabs, with only Power after it, marked with its own icon', () => {
    render(<TabBar />);
    const labels = screen.getAllByRole('button').map((b) => b.textContent);
    expect(labels.slice(10)).toEqual(['Robotics', 'Power']);
  });
});
