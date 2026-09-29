// ============================================================================
// cockpitLinks — the "View in" jump from the twin to the two cockpits.
//
// OrchestrAV (one fleet owner's view) and OTTO-PULSE (the depot crew's view) are
// standalone apps on the same OTTO-Q backend. The twin only builds their URLs:
//   ?source=twin&run=<sim_run_id>            pin the cockpit to this run
//   &owner=<fleet_operator_id>               OrchestrAV only: open as that owner
//   &embed=1                                 the side-by-side panel: hide the cockpit's nav
// A cockpit without these parameters behaves exactly as before. Pure: no fetch, no store.
// ============================================================================

export type Cockpit = 'orchestrav' | 'pulse';

export const COCKPIT_LABEL: Record<Cockpit, string> = {
  orchestrav: 'OrchestrAV',
  pulse: 'PULSE',
};

const DEFAULT_URL: Record<Cockpit, string> = {
  orchestrav: 'https://ottoyard-orchestra-av.lovable.app',
  pulse: 'https://ottoyard-otto-pulse.lovable.app',
};

/** Env override (VITE_ORCHESTRAV_URL / VITE_PULSE_URL), else the live Lovable host. */
export function cockpitBaseUrl(
  cockpit: Cockpit,
  env: Record<string, string | undefined> = import.meta.env,
): string {
  const v = cockpit === 'orchestrav' ? env.VITE_ORCHESTRAV_URL : env.VITE_PULSE_URL;
  return (v && v.trim()) || DEFAULT_URL[cockpit];
}

export interface CockpitLinkOpts {
  runId: string;
  /** fleet_operator_id; read by OrchestrAV only, never sent to PULSE (it shows all owners). */
  owner?: string | null;
  embed?: boolean;
  env?: Record<string, string | undefined>;
}

export function cockpitUrl(cockpit: Cockpit, opts: CockpitLinkOpts): string {
  const url = new URL(cockpitBaseUrl(cockpit, opts.env));
  url.searchParams.set('source', 'twin');
  url.searchParams.set('run', opts.runId);
  if (cockpit === 'orchestrav' && opts.owner) url.searchParams.set('owner', opts.owner);
  if (opts.embed) url.searchParams.set('embed', '1');
  return url.toString();
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The run a cockpit's "Back to the twin" link asks for (?run=<uuid>), or null. */
export function runFromSearch(search: string): string | null {
  const run = new URLSearchParams(search).get('run');
  return run && UUID.test(run) ? run.toLowerCase() : null;
}

/** A run the switcher may open: the one the twin is showing, and only while it is live. */
export const isLiveRunStatus = (s: string | null | undefined) =>
  ['running', 'active', 'paused'].includes(String(s ?? '').toLowerCase());

export interface FleetOwner {
  id: string;
  name: string;
  vehicles: number;
}

/**
 * The owners present at the depot, read from `ottoq_depot_cards` (each card's
 * `operator: {id, name}`) — the same read the cockpits poll. `fleet_operators`
 * itself is service-role only, so the twin cannot list owners any other way.
 * Largest fleet first; a card with no operator is skipped, never invented.
 */
export function fleetOwnersFromCards(cards: unknown): FleetOwner[] {
  const vehicles = (cards as { vehicles?: unknown })?.vehicles;
  if (!Array.isArray(vehicles)) return [];
  const byId = new Map<string, FleetOwner>();
  for (const v of vehicles) {
    const op = (v as { operator?: { id?: unknown; name?: unknown } | null })?.operator;
    if (!op || typeof op.id !== 'string' || !op.id) continue;
    const cur = byId.get(op.id);
    if (cur) cur.vehicles += 1;
    else byId.set(op.id, { id: op.id, name: typeof op.name === 'string' && op.name ? op.name : op.id, vehicles: 1 });
  }
  return [...byId.values()].sort((a, b) => b.vehicles - a.vehicles || a.name.localeCompare(b.name));
}
