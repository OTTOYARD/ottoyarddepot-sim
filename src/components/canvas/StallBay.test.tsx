import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { Stall } from './Stall';
import type { StallState } from '@/store/depotStore';
import { BAY_STALL_Y, WASH, WASH_BAY_XS, SERVICE_BAY_XS, generateStallsV2 } from '@/lib/sitePlan';

// A bay's square on the 2D plan stands where its car stands. The bay's position is the car's centre
// (sitePlan.bayStalls), and the cars, the wash machines and the bay outlines are all drawn from it.
afterEach(cleanup);

/** The drawn square's [x0, y0, x1, y1] on the plan, from its group's translate and its polygon. */
function drawnBox(stall: StallState): [number, number, number, number] {
  const { container } = render(<svg><Stall stall={stall} /></svg>);
  const g = container.querySelector(`[data-stall="${stall.id}"]`)!;
  const [, tx, ty] = /translate\(([-\d.]+), ([-\d.]+)\)/.exec(g.getAttribute('transform') ?? '')!.map(Number);
  const pts = g.querySelector('polygon')!.getAttribute('points')!.split(' ').map((p) => p.split(',').map(Number));
  const xs = pts.map(([x]) => x + tx), ys = pts.map(([, y]) => y + ty);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

describe('2D: a bay square is centred on the car it holds', () => {
  const stalls = generateStallsV2();
  const bays = stalls.filter((s) => s.type === 'wash' || s.type === 'service');

  it('draws every wash and service bay centred on its position', () => {
    expect(bays.map((b) => b.id)).toEqual(['SVC-01', 'SVC-02', 'WASH-01', 'WASH-02', 'WASH-03']);
    for (const b of bays) {
      const [x0, y0, x1, y1] = drawnBox(b);
      expect((x0 + x1) / 2, b.id).toBeCloseTo(b.position.x, 6);
      expect((y0 + y1) / 2, b.id).toBeCloseTo(b.position.y, 6);
    }
  });

  it('keeps each wash bay square inside its own bay outline, clear of the next bay', () => {
    for (const [i, x] of WASH_BAY_XS.entries()) {
      const b = bays.find((s) => s.id === `WASH-0${i + 1}`)!;
      expect(b.position).toMatchObject({ x, y: BAY_STALL_Y });
      const [x0, y0, x1, y1] = drawnBox(b);
      // DepotSVG's dashed bay outline: 16 wide about the bay's x, inset 2 from the hall's walls
      expect(x0).toBeGreaterThanOrEqual(x - 8);
      expect(x1).toBeLessThanOrEqual(x + 8);
      expect(y0).toBeGreaterThanOrEqual(WASH.y + 2);
      expect(y1).toBeLessThanOrEqual(WASH.y + WASH.h - 2);
    }
    for (const x of SERVICE_BAY_XS) expect(bays.some((s) => s.type === 'service' && s.position.x === x)).toBe(true);
  });

  it('leaves the staging stalls drawn as they were', () => {
    const s = stalls.find((t) => t.type === 'staging' && t.position.angle === 0)!;
    const [x0, y0] = drawnBox(s);
    expect([x0, y0]).toEqual([s.position.x, s.position.y]);
  });
});
