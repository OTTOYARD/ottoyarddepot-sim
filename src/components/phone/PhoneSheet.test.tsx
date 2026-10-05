import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useEffect } from 'react';

const { mounts } = vi.hoisted(() => ({ mounts: { controls: 0 } }));
vi.mock('@/components/cockpit/OperatorConsole', () => ({
  OperatorConsole: () => { useEffect(() => { mounts.controls++; }, []); return <div data-testid="tab-controls" />; },
}));
vi.mock('@/components/tabs/TwinKpisTab', () => ({ TwinKpisTab: () => <div /> }));
vi.mock('@/components/tabs/TwinHistoryTab', () => ({ TwinHistoryTab: () => <div /> }));
vi.mock('@/components/tabs/TwinCopilotTab', () => ({ TwinCopilotTab: () => <div /> }));
vi.mock('@/components/tabs/WorldContractTab', () => ({ WorldContractTab: () => <div /> }));
vi.mock('@/components/tabs/TwinOttoQTab', () => ({ TwinOttoQTab: () => <div /> }));
vi.mock('@/components/tabs/TwinAgentTab', () => ({ TwinAgentTab: () => <div /> }));
vi.mock('@/components/tabs/TwinValueTab', () => ({ TwinValueTab: () => <div /> }));

import { PhoneSheet } from './PhoneSheet';
import { usePhoneSheet } from './phoneStore';
import { useSimulationStore } from '@/store/simulationStore';

const sheet = () => screen.getByTestId('tab-controls').parentElement!.parentElement!;
const toggle = () => screen.getByTestId('sheet-fullscreen');

beforeEach(() => {
  mounts.controls = 0;
  usePhoneSheet.setState({ snap: 'half', fullscreen: false });
  useSimulationStore.setState({ activeTab: 'controls' });
});
afterEach(cleanup);

describe('PhoneSheet — full screen toggle', () => {
  for (const mode of ['floating', 'inline'] as const) {
    it(`${mode}: the toggle covers the whole screen and returns to where it was`, () => {
      render(<PhoneSheet mode={mode} topInset={56} />);
      expect(sheet().getAttribute('data-sheet-fullscreen')).toBeNull();
      const before = sheet().className;
      expect(toggle().getAttribute('aria-label')).toBe('Expand panels to full screen');

      fireEvent.click(toggle());
      expect(usePhoneSheet.getState().fullscreen).toBe(true);
      expect(sheet().getAttribute('data-sheet-fullscreen')).toBe('true');
      expect(sheet().className).toContain('fixed inset-0');
      expect(sheet().style.height).toBe(''); // not a snap height: the whole screen
      // the floating sheet's drag handle is gone while full screen
      expect(screen.queryByRole('button', { name: /^(Open|Close) panels$/ })).toBeNull();
      expect(toggle().getAttribute('aria-label')).toBe('Exit full screen');

      fireEvent.click(toggle());
      expect(usePhoneSheet.getState().fullscreen).toBe(false);
      expect(sheet().className).toBe(before);
      expect(usePhoneSheet.getState().snap).toBe('half');
      expect(mounts.controls).toBe(1); // the open tab was restyled, never rebuilt
    });
  }
});
