import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useEffect } from 'react';

// The tabs are replaced by markers: this is about the panel's frame, not its contents. The
// Control marker counts its mounts, so a remount on expand would show.
const { mounts } = vi.hoisted(() => ({ mounts: { controls: 0 } }));
vi.mock('@/components/cockpit/OperatorConsole', () => ({
  OperatorConsole: () => { useEffect(() => { mounts.controls++; }, []); return <div data-testid="tab-controls" />; },
}));
vi.mock('@/components/tabs/TwinKpisTab', () => ({ TwinKpisTab: () => <div data-testid="tab-kpis" /> }));
vi.mock('@/components/tabs/TwinHistoryTab', () => ({ TwinHistoryTab: () => <div /> }));
vi.mock('@/components/tabs/TwinCopilotTab', () => ({ TwinCopilotTab: () => <div /> }));
vi.mock('@/components/tabs/WorldContractTab', () => ({ WorldContractTab: () => <div /> }));
vi.mock('@/components/tabs/TwinOttoQTab', () => ({ TwinOttoQTab: () => <div /> }));
vi.mock('@/components/tabs/TwinAgentTab', () => ({ TwinAgentTab: () => <div /> }));
vi.mock('@/components/tabs/TwinValueTab', () => ({ TwinValueTab: () => <div /> }));

import { SidePanel } from './SidePanel';
import { useSimulationStore } from '@/store/simulationStore';

const panelRoot = () => screen.getByTestId('tab-controls').parentElement!.parentElement!;
const expandBtn = () => screen.getByTestId('panel-expand');

beforeEach(() => {
  mounts.controls = 0;
  useSimulationStore.setState({ isPanelOpen: true, isPanelExpanded: false, activeTab: 'controls' });
});
afterEach(cleanup);

describe('SidePanel — full-width expand', () => {
  it('the header button expands the panel over the view and back, without remounting the tab', () => {
    render(<SidePanel />);
    expect(panelRoot().getAttribute('data-panel-expanded')).toBeNull();
    expect(panelRoot().style.width).toBe('420px');
    expect(expandBtn().getAttribute('aria-label')).toBe('Expand panel to full width');

    fireEvent.click(expandBtn());
    expect(useSimulationStore.getState().isPanelExpanded).toBe(true);
    expect(panelRoot().getAttribute('data-panel-expanded')).toBe('true');
    expect(panelRoot().className).toContain('absolute inset-0');
    expect(panelRoot().style.width).toBe('');
    expect(expandBtn().getAttribute('aria-label')).toBe('Exit full width');

    fireEvent.click(expandBtn());
    expect(useSimulationStore.getState().isPanelExpanded).toBe(false);
    expect(panelRoot().style.width).toBe('420px');
    expect(mounts.controls).toBe(1);
  });

  it('Esc leaves full width', () => {
    render(<SidePanel />);
    fireEvent.click(expandBtn());
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(useSimulationStore.getState().isPanelExpanded).toBe(false);
  });

  it('Esc that closes an open popup (a select list) does not also leave full width', () => {
    render(<SidePanel />);
    fireEvent.click(expandBtn());
    const list = document.createElement('div');
    list.setAttribute('role', 'listbox');
    document.body.appendChild(list);
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(useSimulationStore.getState().isPanelExpanded).toBe(true);
    list.remove();
  });

  it('tabs switch inside the expanded panel', () => {
    render(<SidePanel />);
    fireEvent.click(expandBtn());
    fireEvent.click(screen.getByRole('button', { name: 'KPIs' }));
    expect(screen.getByTestId('tab-kpis')).toBeTruthy();
    expect(useSimulationStore.getState().isPanelExpanded).toBe(true);
  });
});

describe('simulationStore — panel expansion', () => {
  it('expanding opens a closed panel; closing the panel leaves full width', () => {
    useSimulationStore.setState({ isPanelOpen: false, isPanelExpanded: false });
    useSimulationStore.getState().togglePanelExpanded();
    expect(useSimulationStore.getState()).toMatchObject({ isPanelOpen: true, isPanelExpanded: true });
    useSimulationStore.getState().togglePanel();
    expect(useSimulationStore.getState()).toMatchObject({ isPanelOpen: false, isPanelExpanded: false });
    useSimulationStore.getState().togglePanel();
    expect(useSimulationStore.getState()).toMatchObject({ isPanelOpen: true, isPanelExpanded: false });
    useSimulationStore.getState().setPanelExpanded(true);
    useSimulationStore.getState().setPanelExpanded(false);
    expect(useSimulationStore.getState()).toMatchObject({ isPanelOpen: true, isPanelExpanded: false });
  });
});
