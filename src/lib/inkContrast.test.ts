// inkContrast — the text palette must stay readable on the surfaces it is drawn on.
//
// Chase, 2026-09-22: "a lot of the text within the controls tab is hard to read
// again, specifically in the intelligence tab. I think this is due to a dark gray
// text used over top of the dark or charcoal background of the tab display."
//
// He was right and it was measurable: `ink.faint` (#4A4E57) on `canvas.panel`
// (#111317) computed to **2.23:1**, half the WCAG 2.1 AA floor of 4.5:1, and the
// side panel carries 176 uses of it — most at 8–9px, which is the size where a
// weak ratio stops being a nicety.
//
// This test exists so that a future palette edit that darkens the ink again fails
// CI rather than shipping. It reads the SAME tailwind.config.ts the build reads,
// so it cannot drift from what is rendered.
import { describe, expect, it } from 'vitest';
import config from '../../tailwind.config';

// WCAG 2.1 relative luminance, verbatim from the spec.
function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const ch = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const lin = ch.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function contrast(fg: string, bg: string): number {
  const a = luminance(fg);
  const b = luminance(bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const colors = (config as any).theme.extend.colors as Record<string, Record<string, string>>;
const ink = colors.ink as { DEFAULT: string; dim: string; faint: string };
const canvas = colors.canvas as Record<string, string>;

describe('ink contrast', () => {
  // A sanity anchor: the formula itself. Black on white is exactly 21:1.
  it('computes the WCAG reference ratio', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrast('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
  });

  // canvas.panel is what the intelligence cards, the decision rows and every
  // other side-panel surface are drawn on. canvas.raised is the panel shell
  // behind them. Both must hold.
  const surfaces = ['panel', 'raised', 'base', 'elev'] as const;

  for (const s of surfaces) {
    it(`keeps every ink level at WCAG AA (4.5:1) on canvas.${s}`, () => {
      for (const [name, value] of Object.entries(ink)) {
        const ratio = contrast(value, canvas[s]);
        expect(
          ratio,
          `ink.${name} (${value}) on canvas.${s} (${canvas[s]}) is ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    });
  }

  // The three levels must stay a HIERARCHY, not three shades of the same thing.
  // Brightening faint to clear AA is only correct if dim and DEFAULT stay above
  // it — otherwise the fix flattens the panel into one tone.
  it('keeps DEFAULT brighter than dim, and dim brighter than faint', () => {
    const d = contrast(ink.DEFAULT, canvas.panel);
    const m = contrast(ink.dim, canvas.panel);
    const f = contrast(ink.faint, canvas.panel);
    expect(d).toBeGreaterThan(m);
    expect(m).toBeGreaterThan(f);
    // and each step is a real step, not a rounding difference
    expect(d - m).toBeGreaterThan(1);
    expect(m - f).toBeGreaterThan(1);
  });

  // The regression itself, named so a `git log -S` finds it.
  it('the pre-2026-09-22 values would fail this test', () => {
    expect(contrast('#4A4E57', canvas.panel)).toBeLessThan(4.5);   // old ink.faint: 2.23:1
  });
});
