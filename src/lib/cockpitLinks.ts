// ============================================================================
// cockpitLinks — the "View in" jump from the twin to the two cockpits.
//
// OrchestrAV (one fleet owner's view) and OTTO-PULSE (the depot crew's view) are
// standalone apps on the same OTTO-Q backend. The twin only builds their URLs:
//   ?source=twin&run=<sim_run_id>            pin the cockpit to this run
//   &owner=<fleet_operator_id>               OrchestrAV only: open as that owner
//   &embed=1                                 the side-by-side panel: hide the cockpit's nav
// A cockpit without these parameters behaves exactly as before. Pure: no fetch, no store.
//
// The other way, a cockpit opens the twin at  /?run=<sim_run_id>  ("Back to the twin") or at
// /?tab=robotics&robot=<charge_arm|clean_arm|wash_gantry>  (a machine's engineering model).
// The Robotics tab links back to PULSE's Robots tab (&tab=robots) for what each machine is doing now.
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

/**
 * OTTO-PULSE's Robots tab: what each machine is doing now, and its results for the run. The Robotics tab here holds
 * the engineering CAD and links to it. Pinned to the run on screen while one is live, as every "View in" link is.
 * With no live run PULSE opens by itself, and its Robots tab says that no run is live.
 */
export function pulseRobotsUrl(runId: string | null | undefined, env?: Record<string, string | undefined>): string {
  const url = new URL(cockpitBaseUrl('pulse', env));
  if (runId) {
    url.searchParams.set('source', 'twin');
    url.searchParams.set('run', runId);
  }
  url.searchParams.set('tab', 'robots');
  return url.toString();
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The run a cockpit's "Back to the twin" link asks for (?run=<uuid>), or null. */
export function runFromSearch(search: string): string | null {
  const run = new URLSearchParams(search).get('run');
  return run && UUID.test(run) ? run.toLowerCase() : null;
}

/** The twin's tabs a link may open (simulationStore's CockpitTab). */
const LINK_TABS = ['background', 'controls', 'ottoq', 'agent', 'kpis', 'history', 'world', 'copilot', 'value', 'research', 'robotics', 'power'] as const;
export type LinkTab = (typeof LINK_TABS)[number];
const LINK_ROBOTS = ['charge_arm', 'clean_arm', 'wash_gantry'] as const;
export type LinkRobot = (typeof LINK_ROBOTS)[number];

/**
 * The tab a link asks the twin to open (?tab=robotics), or null. OTTO-PULSE's Robots tab links here for the engineering
 * model: the twin keeps the CAD, the cockpits keep what a machine does.
 */
export function tabFromSearch(search: string): LinkTab | null {
  const tab = new URLSearchParams(search).get('tab');
  return (LINK_TABS as readonly string[]).includes(tab ?? '') ? (tab as LinkTab) : null;
}

/** The machine a link asks the Robotics tab to show (?robot=clean_arm), or null. */
export function robotFromSearch(search: string): LinkRobot | null {
  const robot = new URLSearchParams(search).get('robot');
  return (LINK_ROBOTS as readonly string[]).includes(robot ?? '') ? (robot as LinkRobot) : null;
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
