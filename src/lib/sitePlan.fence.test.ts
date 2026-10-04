import { describe, it, expect } from 'vitest';
import { southFenceSpans, INGRESS, EGRESS, GATE_W, LOT } from './sitePlan';

// The south fence was drawn as three runs typed for an ingress WEST of the egress. The
// gates later swapped sides (enter east, exit west) and the runs overlapped, closing the
// fence across both gate openings: every arriving and departing car drove through it.
describe('south fence', () => {
  const spans = southFenceSpans();

  it('leaves both gate openings clear', () => {
    for (const g of [INGRESS.x, EGRESS.x]) {
      for (const [a, b] of spans) expect(b <= g - GATE_W / 2 || a >= g + GATE_W / 2, `span ${a}..${b} vs gate at ${g}`).toBe(true);
    }
  });

  it('closes the rest of the frontage, run after run, west to east', () => {
    expect(spans[0][0]).toBe(LOT.x);
    expect(spans[spans.length - 1][1]).toBe(LOT.x + LOT.w);
    for (const [a, b] of spans) expect(b).toBeGreaterThan(a);
    const open = spans.slice(1).map(([a], i) => a - spans[i][1]);
    expect(open).toEqual([GATE_W, GATE_W]);
  });
});
