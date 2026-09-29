import { useEffect, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { PerformanceMonitor } from '@react-three/drei';
import { BUDGETS, detectTier, readDeviceHints, stepDown, stepUp, type Tier } from './tiers';
import { useQualityStore } from './qualityStore';

/**
 * Holds the frame rate: picks the tier, then moves the resolution.
 *
 *   1. PROBE   the tier the device should start at (memory, GPU string, phone
 *              or not) — decided before the canvas mounts (initialTier) so the
 *              first frame is already drawn at it.
 *   2. BENCH   a short warm-up benchmark: the mean frame time of ~1.5 s of real
 *              frames after the scene has built. A device slower than its
 *              class drops a tier (auto mode only) and that becomes its ceiling.
 *   3. GOVERN  drei's PerformanceMonitor watches fps against a 50-58 band and
 *              moves a 0..1 factor; the device pixel ratio follows it inside
 *              the tier's [dprMin, dprMax]. Pinned at dprMin and still
 *              declining, auto steps DOWN a tier; pinned at dprMax and still
 *              climbing, it steps back UP (never past the ceiling).
 *   4. REGRESS while the camera is being dragged, Medium and Low draw at a
 *              lower resolution and snap back when it stops (R3F's
 *              performance.regress, called by OrbitControls). drei's
 *              AdaptiveDpr does the same but restores the Canvas's INITIAL dpr,
 *              which would undo the governor, so it is done here.
 *
 * High never regresses and never drops its resolution below 1.0. PICKED High
 * (not auto) is not governed at all: it draws at the desktop's old fixed
 * min(devicePixelRatio, 1.5) whatever the frame rate — "desktop High must not
 * look worse" — for a presenter who wants the full picture regardless.
 */

const BENCH_WARMUP_MS = 1200;
const BENCH_FRAMES = 90;

export function QualityGovernor() {
  const gl = useThree((s) => s.gl);
  const setDpr = useThree((s) => s.setDpr);
  const perfCurrent = useThree((s) => s.performance.current);
  const mode = useQualityStore((s) => s.mode);
  const tier = useQualityStore((s) => s.tier);
  const budget = BUDGETS[tier];
  const deviceDpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  // The governor's 0..1 resolution factor, and the factor a (re)mounted
  // PerformanceMonitor starts from: it keeps its own copy, so a tier change
  // remounts it (key) at the factor the new tier should start at.
  const [factor, setFactor] = useState(1);
  const [startFactor, setStartFactor] = useState(1);
  const governed = !(mode === 'high' && tier === 'high');

  // The dpr the tier and the governor want, then the drag regression on top.
  useEffect(() => {
    const top = Math.min(budget.dprMax, deviceDpr);
    const bottom = Math.min(budget.dprMin, top);
    let dpr = governed ? bottom + (top - bottom) * factor : top;
    if (tier !== 'high') dpr *= perfCurrent;
    dpr = Math.max(0.5, Math.round(dpr * 20) / 20);
    setDpr(dpr);
  }, [budget, deviceDpr, factor, perfCurrent, tier, governed, setDpr]);

  // Warm-up benchmark (auto only): the first real frames after the scene built.
  const bench = useRef<{ t0: number | null; last: number | null; n: number; sum: number; done: boolean }>({ t0: null, last: null, n: 0, sum: 0, done: false });
  useFrame(() => {
    const b = bench.current;
    if (b.done) return;
    const now = performance.now();
    if (b.t0 === null) { b.t0 = now; return; }
    if (now - b.t0 < BENCH_WARMUP_MS) { b.last = now; return; }
    if (b.last !== null) { b.sum += now - b.last; b.n++; }
    b.last = now;
    if (b.n < BENCH_FRAMES) return;
    b.done = true;
    const benchMs = b.sum / b.n;
    const q = useQualityStore.getState();
    if (q.mode !== 'auto') return;
    const verdict = detectTier({ ...readDeviceHints(gl.getContext()), benchMs });
    const rank = (t: Tier) => ['low', 'medium', 'high'].indexOf(t);
    if (rank(verdict.tier) < rank(q.ceiling)) q.setCeiling(verdict.tier, verdict.reason);
  });

  const onDecline = ({ factor: f }: { factor: number }) => {
    setFactor(f);
    const q = useQualityStore.getState();
    if (mode === 'auto' && f <= 0.001 && q.tier !== 'low') {
      q.setTier(stepDown(q.tier), 'auto: frame rate below 50 at the lowest resolution');
      setFactor(1); setStartFactor(1);
    }
  };
  const onIncline = ({ factor: f }: { factor: number }) => {
    setFactor(f);
    const q = useQualityStore.getState();
    if (mode === 'auto' && f >= 0.999) {
      const up = stepUp(q.tier, q.ceiling);
      if (up !== q.tier) { q.setTier(up, 'auto: frame rate headroom at full resolution'); setFactor(0); setStartFactor(0); }
    }
  };

  if (!governed) return null;
  return (
    <PerformanceMonitor
      key={tier}
      factor={startFactor}
      ms={250}
      iterations={8}
      bounds={() => [50, 58]}
      flipflops={6}
      onDecline={onDecline}
      onIncline={onIncline}
    />
  );
}
