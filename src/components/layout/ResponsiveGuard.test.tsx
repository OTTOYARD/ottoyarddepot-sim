import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ResponsiveGuard } from './ResponsiveGuard';

// The phone cockpit is lazy-loaded; replace it with a marker so this test needs
// no WebGL, no backend and no three.js.
vi.mock('@/components/phone/PhoneCockpit', () => ({ default: () => <div data-testid="phone-cockpit" /> }));

function viewport(width: number, height: number, coarse: boolean, search = '') {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
  window.matchMedia = ((q: string) => ({
    matches: q.includes('pointer: coarse') ? coarse : false,
    media: q, onchange: null,
    addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  window.history.replaceState(null, '', `/${search}`);
}

/**
 * The phone lane's promise to the founder (2026-09-30): the phone cockpit
 * changes nothing on a desktop. A desktop window renders the desktop cockpit
 * (the guard's children) and never the phone one; a phone gets the phone one
 * and never the desktop tree.
 */
describe('ResponsiveGuard — the desktop cockpit is untouched by the phone one', () => {
  afterEach(() => window.history.replaceState(null, '', '/'));

  it('a desktop window renders the desktop cockpit, not the phone one', () => {
    viewport(1440, 900, false);
    render(<ResponsiveGuard><div data-testid="desktop-cockpit" /></ResponsiveGuard>);
    expect(screen.getByTestId('desktop-cockpit')).toBeTruthy();
    expect(screen.queryByTestId('phone-cockpit')).toBeNull();
  });

  it('a landscape tablet keeps the desktop cockpit', () => {
    viewport(1180, 820, true);
    render(<ResponsiveGuard><div data-testid="desktop-cockpit" /></ResponsiveGuard>);
    expect(screen.getByTestId('desktop-cockpit')).toBeTruthy();
  });

  it('a phone, in either orientation, gets the phone cockpit and not the desktop tree', async () => {
    for (const [w, h] of [[852, 393], [393, 852]]) {
      viewport(w, h, true);
      const { unmount } = render(<ResponsiveGuard><div data-testid="desktop-cockpit" /></ResponsiveGuard>);
      expect(await screen.findByTestId('phone-cockpit')).toBeTruthy();
      expect(screen.queryByTestId('desktop-cockpit')).toBeNull();
      unmount();
    }
  });

  it('?phone=1 shows the phone cockpit on a desktop, for testing', async () => {
    viewport(1440, 900, false, '?phone=1');
    render(<ResponsiveGuard><div data-testid="desktop-cockpit" /></ResponsiveGuard>);
    expect(await screen.findByTestId('phone-cockpit')).toBeTruthy();
  });
});
