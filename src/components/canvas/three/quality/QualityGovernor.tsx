import { useEffect, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { PerformanceMonitor } from '@react-three/drei';
import { BUDGETS, TIERS, detectTier, readDeviceHints, rememberCap, rememberTier, stepDown, stepUp, type Tier } from './tiers';
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
 *              The governor is not armed until the bench is done: the first
 *              frames carry shader compiles, not the device's real pace.
 *   3. GOVERN  drei's PerformanceMonitor watches fps against a 50-58 band and
 *              moves a 0..1 factor; the device pixel ratio follows it inside
 *              the tier's [dprMin, dprMax]. Pinned at dprMin and still
 *              declining, auto steps DOWN a tier; pinned at dprMax and still
 *              climbing, it steps UP (never past the ceiling).
 *              A step UP is on PROBATION for PROBATION_MS: a decline inside it
 *              steps straight back and caps auto below that tier (for the
 *              session, and on this device for a week), so a phone that cannot
 *              hold High costs one short try, not a stutter while the
 *              resolution walks all the way down, nor the same try every visit.
 *              A tier held for HOLD_MS without a decline is remembered on the
 *              device (rememberTier), so the next visit starts there.
 *              drei counts EVERY incline and decline toward `flipflops`, not
 *              just reversals — at 6 a smooth device gave up governing after
 *              ~14 s. It is unbounded here; the 50-58 band is the hysteresis.
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
const PROBATION_MS = 7000;
const HOLD_MS = 20000;
const rank = (t: Tier) => TIERS.indexOf(t);

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
  const [armed, setArmed] = useState(false);
  const governed = !(mode === 'high' && tier === 'high');
  /** The last step up, while it is on probation. */
  const probation = useRef<{ from: Tier; at: number } | null>(null);
  const lastDecline = useRef(0);

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
    setArmed(true);
    const benchMs = b.sum / b.n;
    const q = useQualityStore.getState();
    if (q.mode !== 'auto') return;
    const verdict = detectTier({ ...readDeviceHints(gl.getContext()), benchMs });
    if (rank(verdict.ceiling) < rank(q.ceiling)) q.setCeiling(verdict.ceiling, verdict.reason);
  });

  // Remember a tier auto has HELD (no decline for HOLD_MS), for the next visit.
  useEffect(() => {
    if (mode !== 'auto' || !armed) return;
    const since = performance.now();
    const t = window.setTimeout(() => {
      if (lastDecline.current < since) rememberTier(useQualityStore.getState().tier);
    }, HOLD_MS);
    return () => window.clearTimeout(t);
  }, [mode, tier, armed]);

  const onDecline = ({ factor: f }: { factor: number }) => {
    const now = performance.now();
    lastDecline.current = now;
    setFactor(f);
    const q = useQualityStore.getState();
    if (mode !== 'auto') return;
    const p = probation.current;
    if (p && now - p.at < PROBATION_MS) {
      // the step up did not hold: straight back, and not again this session
      probation.current = null;
      q.setCeiling(p.from, `auto: ${q.tier} did not hold 50 fps on this device`);
      rememberTier(p.from);
      rememberCap(p.from);
      setFactor(1); setStartFactor(1);
      return;
    }
    if (f <= 0.001 && q.tier !== 'low') {
      q.setTier(stepDown(q.tier), 'auto: frame rate below 50 at the lowest resolution');
      setFactor(0.5); setStartFactor(0.5);
    }
  };
  const onIncline = ({ factor: f }: { factor: number }) => {
    setFactor(f);
    const q = useQualityStore.getState();
    if (mode === 'auto' && f >= 0.999) {
      const up = stepUp(q.tier, q.ceiling);
      if (up !== q.tier) {
        probation.current = { from: q.tier, at: performance.now() };
        q.setTier(up, 'auto: holding 60 at full resolution, trying the next tier');
        setFactor(1); setStartFactor(1);
      }
    }
  };

  if (!governed || !armed) return null;
  return (
    <PerformanceMonitor
      key={tier}
      factor={startFactor}
      ms={250}
      iterations={8}
      step={0.2}
      bounds={() => [50, 58]}
      flipflops={Infinity}
      onDecline={onDecline}
      onIncline={onIncline}
    />
  );
}
