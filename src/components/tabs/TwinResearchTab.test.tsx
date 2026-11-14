// ============================================================================
// TwinResearchTab.test.tsx — the Research tab draws the research wing's findings, and says they are not live.
//
// The feed is mocked with the served capture of 2026-11-03 (__fixtures__/researchFeed.served1103.json, read through
// public.ottoq_research_feed at 16:24 UTC): five Phase 0 findings. No network.
//
// What is asserted, and why:
//   1. The banner is there in every state: findings, empty, error.
//   2. Each finding is a card with its title, status badge, kind, summary, metrics, evidence, CT time and short run id,
//      and no raw UTC reaches the screen.
//   3. Empty and error are their own states; a failed refresh keeps the last reading and says so.
//   4. It reads when it opens and every 60 seconds while open, and stops when closed.
//   5. A payload it cannot draw shows a calm line, not a blank cockpit.
//   6. It is reachable: the tenth tab in the bar (Robotics follows it), the side panel draws it, and the 0 key opens it.
// ============================================================================
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, within } from '@testing-library/react';

const { researchFeed } = vi.hoisted(() => ({ researchFeed: vi.fn() }));
vi.mock('@/lib/ottoTwin', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ottoTwin')>();
  return { ...actual, twin: { ...actual.twin, researchFeed } };
});
// The side panel's other tabs are markers: this file is about the Research tab.
vi.mock('@/components/cockpit/OperatorConsole', () => ({ OperatorConsole: () => <div data-testid="tab-controls" /> }));
vi.mock('@/components/tabs/TwinKpisTab', () => ({ TwinKpisTab: () => <div /> }));
vi.mock('@/components/tabs/TwinHistoryTab', () => ({ TwinHistoryTab: () => <div /> }));
vi.mock('@/components/tabs/TwinCopilotTab', () => ({ TwinCopilotTab: () => <div /> }));
vi.mock('@/components/tabs/WorldContractTab', () => ({ WorldContractTab: () => <div /> }));
vi.mock('@/components/tabs/TwinOttoQTab', () => ({ TwinOttoQTab: () => <div /> }));
vi.mock('@/components/tabs/TwinAgentTab', () => ({ TwinAgentTab: () => <div /> }));
vi.mock('@/components/tabs/TwinValueTab', () => ({ TwinValueTab: () => <div /> }));
vi.mock('@/components/tabs/TwinBackgroundTab', () => ({ TwinBackgroundTab: () => <div data-testid="tab-background" /> }));

import served from './__fixtures__/researchFeed.served1103.json';
import { ResearchBoundary, TwinResearchTab } from './TwinResearchTab';
import { TabBar } from '@/components/layout/TabBar';
import { SidePanel } from '@/components/layout/SidePanel';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { RESEARCH_POLL_MS } from '@/hooks/useResearchFeed';
import { NASHVILLE_DEPOT, type ResearchFeed } from '@/lib/ottoTwin';
import { useSimulationStore } from '@/store/simulationStore';

const SERVED = served as unknown as ResearchFeed;
const BANNER = 'Research. Not live. These findings come from the research lab. Nothing here changes the depot until a person ships it.';
const card = (slug: string) => screen.getAllByTestId('research-finding').find((c) => c.dataset.slug === slug)!;
/** Let the mocked read settle (it resolves in microtasks, not timers). */
const settle = () => act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); });

beforeEach(() => {
  researchFeed.mockReset();
  useSimulationStore.setState({ isPanelOpen: true, isPanelExpanded: false, activeTab: 'background' });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('the findings', () => {
  it('draws the banner, one Phase 0 group and a card for each finding, read for the twin depot', async () => {
    researchFeed.mockResolvedValue(SERVED);
    render(<TwinResearchTab />);

    expect(await screen.findAllByTestId('research-finding')).toHaveLength(5);
    expect(researchFeed).toHaveBeenCalledWith(NASHVILLE_DEPOT);
    expect(screen.getByTestId('research-banner')).toHaveTextContent(BANNER);
    expect(screen.getByRole('note')).toBe(screen.getByTestId('research-banner'));

    const phases = screen.getAllByTestId('research-phase');
    expect(phases).toHaveLength(1);
    expect(phases[0]).toHaveTextContent('Phase 0 · 5 findings');
    expect(screen.getByTestId('research-read')).toHaveTextContent(/^5 findings · read Nov 3, 10:24 AM CT$/);

    // newest first in the phase; the five share one update time, so by slug, as the feed orders them
    expect(screen.getAllByTestId('research-finding').map((c) => c.dataset.slug)).toEqual([
      'p0-lab-building', 'p0-referee-key-clustered', 'p0-research-area-live', 'p0-safety-model-building', 'p0-yardstick-priced',
    ]);
  });

  it('gives every card its status badge and kind', async () => {
    researchFeed.mockResolvedValue(SERVED);
    render(<TwinResearchTab />);
    await screen.findAllByTestId('research-finding');

    expect(screen.getAllByTestId('research-status').map((b) => b.textContent)).toEqual([
      'In progress', 'Measured', 'Built', 'In progress', 'Measured',
    ]);
    expect(screen.getAllByTestId('research-kind').map((k) => k.textContent)).toEqual([
      'Lab', 'Measurement', 'Build', 'Safety', 'Measurement',
    ]);
  });

  it('draws a measured card whole: title, summary, metrics, evidence and its time in CT', async () => {
    researchFeed.mockResolvedValue(SERVED);
    render(<TwinResearchTab />);
    await screen.findAllByTestId('research-finding');

    const c = card('p0-referee-key-clustered');
    expect(within(c).getByRole('heading')).toHaveTextContent(
      "The referee ranks the AI's orders better than chance, but its percentages aren't trustworthy yet",
    );
    expect(c).toHaveTextContent('Counted by the 18 independent test days rather than 370 separate decisions');
    expect(c).toHaveTextContent('P0.0');
    const metrics = within(c).getAllByRole('listitem').map((li) => li.textContent);
    expect(metrics).toContain('AUC: 0.6535');
    expect(metrics).toContain('AUC 95% CI by key: 0.5803–0.707');
    expect(metrics).toContain('Brier skill 95% CI by key: −0.0608 to 0.0998');
    expect(metrics).toContain('Decisions: 370');
    expect(c).toHaveTextContent('Evidence: otto-q-core db/checks/0475');
    expect(c).toHaveTextContent('Measured: Nov 3, 9:40 AM CT');
  });

  it('indents a nested metric under its heading line', async () => {
    researchFeed.mockResolvedValue(SERVED);
    render(<TwinResearchTab />);
    await screen.findAllByTestId('research-finding');

    const items = within(card('p0-yardstick-priced')).getAllByRole('listitem');
    const head = items.findIndex((li) => li.textContent === 'Equal prices:');
    expect(head).toBeGreaterThanOrEqual(0);
    expect(items[head + 1]).toHaveTextContent('Agent better: 102');
    expect(items[head + 1].style.paddingLeft).toBe('8px');
    expect(items[head].style.paddingLeft).toBe('');
    expect(items.map((li) => li.textContent)).toContain('Kernel better: 185');
  });

  it('shows an unmeasured finding as not yet measured, and a run id as 8 characters with the full id on hover', async () => {
    researchFeed.mockResolvedValue(SERVED);
    render(<TwinResearchTab />);
    await screen.findAllByTestId('research-finding');

    const safety = card('p0-safety-model-building');
    expect(safety).toHaveTextContent('Measured: not yet');
    const run = within(safety).getByTestId('research-run');
    expect(run).toHaveTextContent(/^8c0b2e04$/);
    expect(run).toHaveAttribute('title', '8c0b2e04-8ea9-49a8-bfed-bed10ddfbc8b');
    expect(within(card('p0-lab-building')).queryByTestId('research-metrics')).toBeNull(); // {} draws no metrics box
  });

  it('never puts raw UTC on screen', async () => {
    researchFeed.mockResolvedValue(SERVED);
    const { container } = render(<TwinResearchTab />);
    await screen.findAllByTestId('research-finding');
    expect(container.textContent).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
    expect(container.textContent).not.toMatch(/UTC|\+00:00/);
  });
});

describe('empty, error and stale', () => {
  it('says "No findings yet" for an empty feed, under the banner', async () => {
    researchFeed.mockResolvedValue({ ...SERVED, findings: [] });
    render(<TwinResearchTab />);
    expect(await screen.findByTestId('research-empty')).toHaveTextContent('No findings yet.');
    expect(screen.getByTestId('research-banner')).toHaveTextContent(BANNER);
    expect(screen.queryByTestId('research-finding')).toBeNull();
  });

  it('shows the error with a retry, under the banner, and draws the findings once a retry answers', async () => {
    researchFeed.mockRejectedValueOnce(new Error('rpc ottoq_research_feed failed: 503 upstream'));
    render(<TwinResearchTab />);

    const err = await screen.findByTestId('research-error');
    expect(err).toHaveTextContent('Could not read the research findings.');
    expect(err).toHaveTextContent('rpc ottoq_research_feed failed: 503 upstream');
    expect(screen.getByTestId('research-banner')).toHaveTextContent(BANNER);
    expect(screen.queryByTestId('research-empty')).toBeNull();

    researchFeed.mockResolvedValueOnce(SERVED);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findAllByTestId('research-finding')).toHaveLength(5);
    expect(screen.queryByTestId('research-error')).toBeNull();
  });

  it('calls an answer it cannot read an error, not an empty feed', async () => {
    researchFeed.mockResolvedValue(null);
    render(<TwinResearchTab />);
    expect(await screen.findByTestId('research-error')).toHaveTextContent('The research feed sent data that this tab cannot read.');
    expect(screen.queryByTestId('research-empty')).toBeNull();
  });

  it('keeps the last reading when a refresh fails, and says how old it is', async () => {
    researchFeed.mockResolvedValueOnce(SERVED).mockRejectedValueOnce(new Error('network down'));
    render(<TwinResearchTab />);
    await screen.findAllByTestId('research-finding');

    fireEvent.click(screen.getByRole('button', { name: 'Read the findings again' }));
    expect(await screen.findByTestId('research-stale')).toHaveTextContent(
      'The last refresh did not answer. These findings are from Nov 3, 10:24 AM CT.',
    );
    expect(screen.getAllByTestId('research-finding')).toHaveLength(5);
  });
});

describe('refresh', () => {
  it('reads when the tab opens and every 60 seconds while it is open, and stops when it closes', async () => {
    vi.useFakeTimers();
    researchFeed.mockResolvedValue(SERVED);
    const { unmount } = render(<TwinResearchTab />);
    await settle();
    expect(researchFeed).toHaveBeenCalledTimes(1);
    expect(screen.getAllByTestId('research-finding')).toHaveLength(5);

    expect(RESEARCH_POLL_MS).toBe(60_000);
    await act(async () => { await vi.advanceTimersByTimeAsync(59_000); });
    expect(researchFeed).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(researchFeed).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(researchFeed).toHaveBeenCalledTimes(3);

    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(180_000); });
    expect(researchFeed).toHaveBeenCalledTimes(3);
  });

  it('drops an answer that arrives after a newer read started', async () => {
    let answerFirst: (v: ResearchFeed) => void = () => {};
    researchFeed
      .mockImplementationOnce(() => new Promise<ResearchFeed>((resolve) => { answerFirst = resolve; }))
      .mockResolvedValueOnce({ ...SERVED, findings: [] });
    render(<TwinResearchTab />);
    fireEvent.click(screen.getByRole('button', { name: 'Read the findings again' }));
    expect(await screen.findByTestId('research-empty')).toBeTruthy();
    answerFirst(SERVED);
    await settle();
    expect(screen.getByTestId('research-empty')).toBeTruthy(); // the older answer did not replace the newer one
    expect(screen.queryByTestId('research-finding')).toBeNull();
  });
});

describe('a payload it cannot draw', () => {
  it('shows the fallback instead of throwing, and draws again on the next reading', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    const Boom = (): JSX.Element => { throw new Error('cannot draw'); };
    const { rerender } = render(
      <ResearchBoundary resetKey="a" fallback={<p>fallback</p>}><Boom /></ResearchBoundary>,
    );
    expect(screen.getByText('fallback')).toBeTruthy();
    rerender(<ResearchBoundary resetKey="b" fallback={<p>fallback</p>}><p>drawn</p></ResearchBoundary>);
    expect(screen.getByText('drawn')).toBeTruthy();
    quiet.mockRestore();
  });
});

describe('navigation', () => {
  it('puts Robotics right after OTTO-Q and Research after Value (only Power follows it), and marks Research with the flask', () => {
    render(<TabBar />);
    const tabs = screen.getAllByRole('button');
    expect(tabs.map((b) => b.textContent)).toEqual([
      'Background', 'Control', 'OTTO-Q', 'Robotics', 'Agent', 'KPIs', 'Runs', 'Diagnostics', 'Copilot', 'Value', 'Research', 'Power',
    ]);
    expect(tabs[10].querySelector('svg')).not.toBeNull();
  });

  it('opens the Research tab from the side panel', async () => {
    researchFeed.mockResolvedValue(SERVED);
    render(<SidePanel />);
    expect(screen.queryByTestId('research-banner')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Research' }));
    expect(useSimulationStore.getState().activeTab).toBe('research');
    expect(screen.getByTestId('research-banner')).toHaveTextContent(BANNER);
    expect(await screen.findAllByTestId('research-finding')).toHaveLength(5);
  });

  it('has no number key: it is the eleventh tab, and 0 opens Value, the tenth', () => {
    renderHook(() => useKeyboardShortcuts());
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: '0' })); });
    expect(useSimulationStore.getState().activeTab).toBe('value');
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: '4' })); });
    expect(useSimulationStore.getState().activeTab).toBe('robotics');
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: '9' })); });
    expect(useSimulationStore.getState().activeTab).toBe('copilot');
  });
});
