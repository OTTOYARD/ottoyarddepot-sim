/**
 * Frame statistics for the 3D perf harness — pure, so the maths the PR's
 * numbers rest on is unit-tested rather than trusted.
 *
 * A frame time is the wall interval between two consecutive rendered frames
 * (rAF to rAF), which is what a viewer feels. fps is frames / elapsed wall time
 * over the window, NOT 1000 / mean — one 400 ms hitch among 59 fast frames
 * reads as the stutter it is in p95/max, and as the ~50 fps it cost in fps.
 */

export interface FrameSummary {
  frames: number;
  fps: number;
  meanMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
}

/** Nearest-rank percentile of an ASCENDING array (p in 0..100). */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

const r1 = (x: number) => Math.round(x * 10) / 10;

export function summarizeFrames(ms: readonly number[]): FrameSummary {
  if (ms.length === 0) return { frames: 0, fps: 0, meanMs: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0, maxMs: 0 };
  const sorted = [...ms].sort((a, b) => a - b);
  const total = ms.reduce((a, b) => a + b, 0);
  return {
    frames: ms.length,
    fps: r1(total > 0 ? (ms.length * 1000) / total : 0),
    meanMs: r1(total / ms.length),
    p50Ms: r1(percentile(sorted, 50)),
    p95Ms: r1(percentile(sorted, 95)),
    p99Ms: r1(percentile(sorted, 99)),
    maxMs: r1(sorted[sorted.length - 1]),
  };
}

/** Fixed-capacity ring of samples: the overlay and the harness read a sliding window. */
export class Ring {
  private buf: Float64Array;
  private n = 0;
  private head = 0;
  constructor(readonly capacity: number) { this.buf = new Float64Array(capacity); }
  push(x: number): void {
    this.buf[this.head] = x;
    this.head = (this.head + 1) % this.capacity;
    if (this.n < this.capacity) this.n++;
  }
  clear(): void { this.n = 0; this.head = 0; }
  get size(): number { return this.n; }
  /** Oldest first. */
  values(): number[] {
    const out: number[] = new Array(this.n);
    const start = (this.head - this.n + this.capacity) % this.capacity;
    for (let i = 0; i < this.n; i++) out[i] = this.buf[(start + i) % this.capacity];
    return out;
  }
  mean(): number {
    if (!this.n) return 0;
    let s = 0;
    for (const v of this.values()) s += v;
    return s / this.n;
  }
}
