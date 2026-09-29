import { describe, it, expect } from 'vitest';
import { percentile, summarizeFrames, Ring } from './perfStats';

describe('perfStats — the numbers the perf PR quotes', () => {
  it('nearest-rank percentile', () => {
    const a = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100
    expect(percentile(a, 50)).toBe(50);
    expect(percentile(a, 95)).toBe(95);
    expect(percentile(a, 100)).toBe(100);
    expect(percentile([], 95)).toBe(0);
  });

  it('fps is frames over wall time, so one hitch costs what it cost', () => {
    // 59 frames at 16 ms and one 400 ms hitch: ~41 fps over the window, not 1000/mean of the fast ones
    const ms = [...Array(59).fill(16), 400];
    const s = summarizeFrames(ms);
    expect(s.frames).toBe(60);
    expect(s.fps).toBeCloseTo((60 * 1000) / (59 * 16 + 400), 1);
    expect(s.p50Ms).toBe(16);
    expect(s.maxMs).toBe(400);
    expect(s.p99Ms).toBe(400);
  });

  it('a steady 60 Hz reads as 60 fps with a flat distribution', () => {
    const s = summarizeFrames(Array(120).fill(1000 / 60));
    expect(s.fps).toBe(60);
    expect(s.p95Ms).toBeCloseTo(16.7, 1);
  });

  it('Ring keeps the newest `capacity` samples, oldest first', () => {
    const r = new Ring(3);
    [1, 2, 3, 4, 5].forEach((x) => r.push(x));
    expect(r.values()).toEqual([3, 4, 5]);
    expect(r.mean()).toBe(4);
    r.clear();
    expect(r.size).toBe(0);
    expect(r.values()).toEqual([]);
  });
});
