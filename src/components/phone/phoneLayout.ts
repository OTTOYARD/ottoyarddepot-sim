import type { TwinSnapshot } from '@/lib/ottoTwin';

/**
 * The phone cockpit's pure half: who gets it, where its sheet snaps, and what
 * its header reads. No React, no stores — so the rules are unit-tested and the
 * desktop cockpit, which never calls any of this, cannot be moved by it.
 */

// ── who gets the phone cockpit ──────────────────────────────────────────────

export interface ViewportInfo {
  width: number;
  height: number;
  /** a touch-first primary pointer ((pointer: coarse)) */
  coarse: boolean;
  /** ?phone=1 — see the phone layout on a desktop, for testing */
  forced: boolean;
}

/**
 * A PHONE: a touch-first screen whose short side is under 600 px (in either
 * orientation — a landscape Pro Max is 932 px wide and would otherwise get a
 * cramped desktop cockpit), or any window narrower than 900 px, which the
 * desktop cockpit never supported. Everything else — every desktop and a
 * landscape tablet — keeps the desktop cockpit, unchanged.
 */
export function isPhoneViewport(v: ViewportInfo): boolean {
  return v.forced || v.width < 900 || (v.coarse && Math.min(v.width, v.height) < 600);
}

// ── the panel sheet ─────────────────────────────────────────────────────────

export type SheetSnap = 'peek' | 'half' | 'full';
export const SHEET_SNAPS: readonly SheetSnap[] = ['peek', 'half', 'full'];

/**
 * Sheet heights in px for a stage `stageH` tall: `peek` shows only the tab row,
 * `half` about half the stage, `full` all of it below the run bar.
 */
export function sheetHeights(stageH: number, peekH: number, topInset: number): Record<SheetSnap, number> {
  const full = Math.max(peekH, stageH - topInset - 8);
  const half = Math.min(full, Math.max(peekH + 120, Math.round(stageH * 0.55)));
  return { peek: peekH, half, full };
}

/**
 * Where a released drag settles: a fling (|v| > 0.5 px/ms) moves one snap in its
 * direction; a slow release goes to the nearest snap. `v` is px/ms, positive
 * when the sheet is being pulled UP (growing).
 */
export function settleSheet(h: number, v: number, heights: Record<SheetSnap, number>): SheetSnap {
  const order = SHEET_SNAPS;
  const nearest = order.reduce((best, s) => (Math.abs(heights[s] - h) < Math.abs(heights[best] - h) ? s : best), order[0]);
  if (Math.abs(v) <= 0.5) return nearest;
  if (v > 0) return order.find((s) => heights[s] > h + 1) ?? 'full';
  return [...order].reverse().find((s) => heights[s] < h - 1) ?? 'peek';
}

// ── the run bar's reading of the run ────────────────────────────────────────

const DEPOT_TZ = 'America/Chicago';

/** The depot's clock, CT, 24 h (the desktop header's format). */
export function depotClock(iso?: string | null): string {
  if (!iso) return '--:--';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '--:--';
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: DEPOT_TZ });
}

export type RunPhase = 'offline' | 'no-run' | 'running' | 'paused' | 'ended';

/** What the run bar's status chip says. Only a snapshot OF the adopted run counts. */
export function runPhase(snapshot: TwinSnapshot | null, activeSimRunId: string | null, connected: boolean): RunPhase {
  if (!activeSimRunId) return connected ? 'no-run' : 'offline';
  const run = snapshot?.run;
  if (!run || run.sim_run_id !== activeSimRunId) return connected ? 'running' : 'offline';
  const s = String(run.status).toLowerCase();
  if (s === 'running' || s === 'active') return 'running';
  if (s === 'paused') return 'paused';
  return 'ended';
}

export interface TelemetryCell {
  key: string;
  label: string;
  value: string;
  unit?: string;
}

const num = (v: unknown, digits = 0): string =>
  typeof v === 'number' && isFinite(v) ? v.toFixed(digits) : '—';

/**
 * The desktop header's telemetry strip, in the same derivation (TopBar): the
 * fleet counts only when the snapshot carries them — a missing frame reads "—",
 * never a zero that says "nothing is charging".
 */
export function phoneTelemetry(snapshot: TwinSnapshot | null): TelemetryCell[] {
  const counts = (snapshot?.fleet as { counts?: Record<string, number> } | undefined)?.counts;
  const c = (k: string) => (counts ? counts[k] ?? 0 : undefined);
  const sum = (...ks: string[]) => (counts ? ks.reduce((a, k) => a + (counts[k] ?? 0), 0) : undefined);
  const grid = snapshot?.grid as Record<string, number> | null | undefined;
  const bess = snapshot?.bess as Record<string, number> | null | undefined;
  const energy = snapshot?.energy as Record<string, number> | null | undefined;
  return [
    { key: 'deployed', label: 'Out', value: num(c('deployed')) },
    { key: 'charging', label: 'Charging', value: num(sum('charging_dcfc', 'charging_l2')) },
    { key: 'waiting', label: 'Waiting', value: num(sum('staged_awaiting_service', 'arrived_at_gate')) },
    { key: 'ready', label: 'Ready', value: num(c('staged_for_departure')) },
    { key: 'lmp', label: 'LMP', value: num(grid?.['lmp_usd_mwh']), unit: '$/MWh' },
    { key: 'bess', label: 'BESS', value: num(bess?.['soc_pct']), unit: '%' },
    { key: 'solar', label: 'Solar', value: num(energy?.['solar_kw']), unit: 'kW' },
  ];
}
