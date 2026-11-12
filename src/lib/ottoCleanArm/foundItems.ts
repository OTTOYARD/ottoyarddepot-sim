// foundItems — an item the cleaning arm found in a car's cabin, and the stop it causes.
//
// Chase, 2026-11-11: "a flag for 'items found in vehicle' that an attendent has to walk over and pick up to secure. ...
// The machine can pause and let out an alert that an attendent has to walk over and clear and then. Manually confirm
// reactivation from the pulse app."
//
// THE TWIN OWNS THE STOP, THE RENDERER DRAWS IT. The engine (otto-q-core 0814) decides that an item is in a cabin, when
// the arm reaches it (found_at), when the twin's own attendant is due (attendant_due_at) and when it was secured, by
// the twin's attendant or by a person in OTTO-PULSE. It publishes them in public.ottoq_cabin_found_items_feed, on the
// run's sim clock. This file reads that feed and says one thing: at this instant, does this car's arm stand still, and
// for how long yet. It decides nothing.
//
// Pure: no React, no stores.

/** One row of ottoq_cabin_found_items_feed.items (otto-q-core 0814). Times are the run's sim clock, ISO. */
export interface FoundItem {
  item_key: string;
  item_kind: string;
  status: 'awaiting_attendant' | 'secured' | string;
  stall_id: string;
  stall_code: string | null;
  vehicle_id: string;
  vehicle_name: string | null;
  fleet_operator_id?: string | null;
  found_at: string;
  attendant_due_at: string;
  secured_at: string | null;
  secured_by: string | null;
  pause_seconds: number | null;
}

export interface FoundItemsFeed {
  sim_run_id: string;
  sim_clock: string | null;
  waiting: number;
  items: FoundItem[];
}

const ms = (iso: string | null | undefined): number => (iso ? Date.parse(iso) : NaN);

/** The window in which the arm stands still for this item: from the find to the securing (or to the attendant's due time). */
export function stopWindow(it: Pick<FoundItem, 'found_at' | 'attendant_due_at' | 'secured_at'>): { fromMs: number; untilMs: number } | null {
  const from = ms(it.found_at);
  const until = Number.isFinite(ms(it.secured_at)) ? ms(it.secured_at) : ms(it.attendant_due_at);
  if (!Number.isFinite(from) || !Number.isFinite(until) || until < from) return null;
  return { fromMs: from, untilMs: until };
}

export interface ArmStop {
  item: FoundItem;
  /** sim seconds the arm still stands still */
  remainingS: number;
}

/**
 * Does this car's cleaning arm stand still at `nowMs` (the sim clock)? The newest item wins when a car has more than
 * one (a second clean of the same car in one run).
 */
export function stopFor(items: readonly FoundItem[], vehicleId: string, nowMs: number): ArmStop | null {
  if (!Number.isFinite(nowMs)) return null;
  let best: ArmStop | null = null;
  for (const it of items) {
    if (it.vehicle_id !== vehicleId) continue;
    const w = stopWindow(it);
    if (!w || nowMs < w.fromMs || nowMs >= w.untilMs) continue;
    if (!best || ms(it.found_at) > ms(best.item.found_at)) best = { item: it, remainingS: (w.untilMs - nowMs) / 1000 };
  }
  return best;
}

const KIND_WORD: Record<string, string> = {
  phone: 'a phone', wallet: 'a wallet', keys: 'keys', bag: 'a bag', glasses: 'glasses', earbuds: 'earbuds',
  umbrella: 'an umbrella', 'card holder': 'a card holder',
};
/** "a wallet", "keys"; an unknown kind reads "an item". */
export const itemWords = (kind: string | null | undefined): string => (kind && KIND_WORD[kind]) || 'an item';

/** Who secured it, in words. */
export function securedByWords(by: string | null | undefined): string {
  if (!by) return 'not yet secured';
  if (by === 'twin_attendant') return "the twin's attendant";
  return 'an attendant';
}
