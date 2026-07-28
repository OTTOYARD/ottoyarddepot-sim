// ============================================================================
// worldBoot — load the world BEFORE anyone is allowed to orchestrate in it.
//
// THE PROBLEM THIS SOLVES
// The cockpit currently boots opportunistically: `useTwinFeed` fires a layout
// fetch and a snapshot poll in two independent effects, the Operator Console
// fetches the catalog and scenario list in two more, and Start immediately
// calls play(). Nothing anywhere asserts that the world finished loading. A run
// can be live, ticking, and rendering while the layout is still in flight, the
// weather channel has produced no row, and the variability profile is empty.
// Every one of those states looks identical on screen to a healthy run.
//
// A game engine does not do this. It loads the level, verifies every required
// asset resolved, and only then hands control to the player. That is what this
// module is: a level loader with a hard readiness gate.
//
// WHAT IT GUARANTEES
//   · every boot stage is attempted, timed, and reported — including failures
//   · a stage that fails does not abort the boot; it lands in the report, so
//     the operator sees WHICH part of the world is missing, not just "error"
//   · `ready` is true only when every REQUIRED stage succeeded AND the first
//     packed frame's required channels are all present
//   · the report is serializable — attach it to the Black Box bundle and a run
//     becomes reproducible from its own boot record
//
// WHAT IT DELIBERATELY DOES NOT DO
// It does not start, resume, or tick the run. Booting the world and running the
// world are separate concerns; conflating them is how the cockpit ended up
// auto-starting runs it had not finished loading.
// ============================================================================

import { twin, NASHVILLE_DEPOT, type CatalogVar, type Scenario, type TwinEventsWindow, type TwinFleetCondition, type TwinLaborWindow, type TwinLayout, type TwinOffsiteWindow, type TwinWearWindow, type TwinRunContext, type TwinSnapshot } from "@/lib/ottoTwin";
import { packChannels } from "./channels";
import { auditCoverage, type CoverageReport } from "./coverage";
import {
  CHANNEL_IDS,
  CHANNEL_CONTRACT_VERSION,
  REQUIRED_CHANNELS,
  type ChannelBundle,
  type ChannelId,
  type ChannelStatus,
} from "./contracts";

export type BootStageId =
  | "geometry"
  | "registry"
  | "scenarios"
  | "run_context"
  | "first_frame"
  | "events_window"
  | "fleet_condition"
  | "labor"
  | "offsite"
  | "wear"
  | "variability_profile"
  | "channels";

export interface BootStageReport {
  id: BootStageId;
  label: string;
  /** a failed required stage makes the whole boot not-ready */
  required: boolean;
  status: "ok" | "empty" | "failed";
  duration_ms: number;
  /** stage-specific count: stalls loaded, catalog rows, scenarios, tick, … */
  count: number | null;
  detail: string;
}

export interface ChannelReadiness {
  channel: ChannelId;
  required: boolean;
  status: ChannelStatus;
  completeness: number;
  missing: string[];
  notes: string[];
}

export interface WorldBootReport {
  contract_version: string;
  depot_id: string;
  sim_run_id: string | null;
  scenario: string | null;
  seed: number | null;
  tick: number | null;
  started_at: string;
  finished_at: string;
  duration_ms: number;
  /** TRUE only when every required stage AND every required channel is good */
  ready: boolean;
  /** short reason when ready === false */
  blocked_by: string[];
  stages: BootStageReport[];
  channels: ChannelReadiness[];
  coverage: CoverageReport | null;
}

/** Loaded world assets, handed to the caller so nothing is re-fetched. */
export interface BootedWorld {
  report: WorldBootReport;
  layout: TwinLayout | null;
  catalog: CatalogVar[];
  scenarios: Scenario[];
  snapshot: TwinSnapshot | null;
  bundle: ChannelBundle | null;
}

/**
 * Transport seam. Defaults to the real `twin` client; tests and replay
 * harnesses inject their own without touching the network.
 */
export interface BootTransport {
  layout: (depotId: string) => Promise<TwinLayout>;
  catalog: () => Promise<{ catalog: CatalogVar[] }>;
  scenarios: () => Promise<{ scenarios: Scenario[] }>;
  snapshot: (simRunId: string) => Promise<TwinSnapshot>;
  /**
   * Run-to-date reliability / charging / forecast aggregates. Separate from
   * `snapshot` because it is a separate RPC and is allowed to fail on its own:
   * a boot without it is degraded, not broken.
   */
  eventsWindow: (simRunId: string) => Promise<TwinEventsWindow>;
  /** which depot this run actually simulates — the layout must follow it */
  runContext: (simRunId: string) => Promise<TwinRunContext>;
  /** per-vehicle condition, dealt once at run boot */
  fleetCondition: (simRunId: string) => Promise<TwinFleetCondition>;
  /** staffing-imposed lane limits and the service backlog */
  labor: (simRunId: string) => Promise<TwinLaborWindow>;
  /** trips, and why they end — the half of the fleet that is not here */
  offsite: (simRunId: string) => Promise<TwinOffsiteWindow>;
  /** realized wear, service-due state and open DTCs */
  wear: (simRunId: string) => Promise<TwinWearWindow>;
}

export const defaultTransport: BootTransport = {
  layout: (id) => twin.layout(id),
  catalog: () => twin.catalog(),
  scenarios: () => twin.scenarios(),
  snapshot: (id) => twin.snapshot(id),
  eventsWindow: (id) => twin.eventsWindow(id),
  runContext: (id) => twin.runContext(id),
  fleetCondition: (id) => twin.fleetCondition(id),
  labor: (id) => twin.labor(id),
  offsite: (id) => twin.offsite(id),
  wear: (id) => twin.wear(id),
};

export interface BootOptions {
  simRunId: string;
  depotId?: string;
  transport?: BootTransport;
  /** attempts to get a first frame with data before giving up */
  frameAttempts?: number;
  /** delay between frame attempts, ms */
  frameDelayMs?: number;
  /** injectable sleep + clock keep tests instant and deterministic */
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
}

const CHANNEL_STAGE_LABEL: Record<BootStageId, string> = {
  geometry: "Depot geometry",
  registry: "Variability registry",
  scenarios: "Scenario deck",
  run_context: "Run depot binding",
  first_frame: "First world frame",
  events_window: "Event signal window",
  fleet_condition: "Per-vehicle condition",
  labor: "Staffing & lane limits",
  offsite: "Off-site trips",
  wear: "Wear & service due",
  variability_profile: "Run variability profile",
  channels: "Channel bundle",
};

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Run one boot stage, timing it and converting any throw into a report row. */
async function stage<T>(
  id: BootStageId,
  required: boolean,
  now: () => Date,
  fn: () => Promise<{ value: T; count: number | null; empty?: boolean; detail: string }>,
): Promise<{ report: BootStageReport; value: T | null }> {
  const t0 = now().getTime();
  try {
    const { value, count, empty, detail } = await fn();
    return {
      report: {
        id, label: CHANNEL_STAGE_LABEL[id], required,
        status: empty ? "empty" : "ok",
        duration_ms: now().getTime() - t0,
        count, detail,
      },
      value,
    };
  } catch (e) {
    return {
      report: {
        id, label: CHANNEL_STAGE_LABEL[id], required,
        status: "failed",
        duration_ms: now().getTime() - t0,
        count: null,
        detail: e instanceof Error ? e.message : String(e),
      },
      value: null,
    };
  }
}

/**
 * Load the complete world for a run and report exactly what resolved.
 *
 * Geometry, registry and scenarios load CONCURRENTLY (they are independent
 * reads); the first frame is then polled until the twin produces a snapshot,
 * because a run that has not ticked yet has no world state to pack.
 */
export async function bootWorld(opts: BootOptions): Promise<BootedWorld> {
  const {
    simRunId,
    depotId = NASHVILLE_DEPOT,
    transport = defaultTransport,
    frameAttempts = 10,
    frameDelayMs = 1500,
    sleep = defaultSleep,
    now = () => new Date(),
  } = opts;

  const started = now();
  const stages: BootStageReport[] = [];

  // ── which depot does this run simulate? ───────────────────────────────────
  //
  // MUST come before geometry. `ottoq_twin_snapshot` publishes no depot_id, so
  // the layout used to be fetched for a hardcoded depot. The backend has two
  // seeded 150-stall depots sharing ZERO stall ids ("Nashville Flagship" and
  // "Benchmark (CRN A/B)"), and most runs are on the second — so the layout and
  // the fleet routinely described different buildings, and nothing said so.
  let resolvedDepotId = depotId;
  const context = await stage("run_context", false, now, async () => {
    const c = await transport.runContext(simRunId);
    if (c?.error) throw new Error(String(c.error));
    if (c?.depot_id) resolvedDepotId = c.depot_id;
    return {
      value: c, count: c.stall_count,
      detail: `${c.depot_name ?? c.depot_id} · ${c.stall_count} stalls · ${c.fleet_count} vehicles`
        + (c.depot_id !== depotId ? ` (overrides requested depot ${depotId})` : ""),
    };
  });
  stages.push(context.report);

  // ── static assets, in parallel ────────────────────────────────────────────
  const [geometry, registry, scenarioDeck] = await Promise.all([
    stage("geometry", true, now, async () => {
      const l = await transport.layout(resolvedDepotId);
      const n = l?.stalls?.length ?? 0;
      return {
        value: l, count: n, empty: n === 0,
        detail: n === 0
          ? "layout returned no stalls — stall inventory will be partial"
          : `${n} stalls · ${l.structures?.length ?? 0} structures`,
      };
    }),
    stage("registry", true, now, async () => {
      const { catalog } = await transport.catalog();
      const n = catalog?.length ?? 0;
      return {
        value: catalog ?? [], count: n, empty: n === 0,
        detail: n === 0 ? "variability catalog is empty" : `${n} registered variables`,
      };
    }),
    stage("scenarios", false, now, async () => {
      const { scenarios } = await transport.scenarios();
      const n = scenarios?.length ?? 0;
      return { value: scenarios ?? [], count: n, empty: n === 0, detail: `${n} scenarios available` };
    }),
  ]);
  stages.push(geometry.report, registry.report, scenarioDeck.report);

  // ── first frame: poll until the twin has world state to give us ───────────
  let snapshot: TwinSnapshot | null = null;
  const frame = await stage("first_frame", true, now, async () => {
    let lastErr = "";
    for (let attempt = 1; attempt <= frameAttempts; attempt++) {
      try {
        const snap = await transport.snapshot(simRunId);
        if (snap?.error) {
          lastErr = String(snap.error);
        } else if (snap?.run) {
          // A frame with a fleet is a frame we can pack. Tick 0 with an empty
          // depot is a legitimate pre-roll state, not a usable world.
          const fleet = snap.fleet?.vehicles?.length ?? 0;
          if (fleet > 0 || Number(snap.run.tick_count ?? 0) > 0) {
            snapshot = snap;
            return {
              value: snap,
              count: Number(snap.run.tick_count ?? 0),
              detail: `tick ${snap.run.tick_count} · ${fleet} vehicles · attempt ${attempt}`,
            };
          }
          snapshot = snap; // keep the last frame even if it is pre-roll
          lastErr = `tick ${snap.run.tick_count ?? 0} with no fleet yet`;
        } else {
          lastErr = "snapshot returned no run";
        }
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e);
      }
      if (attempt < frameAttempts) await sleep(frameDelayMs);
    }
    throw new Error(`no usable frame after ${frameAttempts} attempts: ${lastErr}`);
  });
  stages.push(frame.report);

  // ── variability profile: derived from the frame we already hold ───────────
  const profile = await stage("variability_profile", false, now, async () => {
    const knobs = (snapshot?.variability ?? {}) as Record<string, unknown>;
    const n = Object.keys(knobs).length;
    return {
      value: knobs, count: n, empty: n === 0,
      detail: n === 0
        ? "no profile rows — run is on the calibrated baseline"
        : `${n} knob group(s) shaping this run`,
    };
  });
  stages.push(profile.report);

  // ── events window: rates the snapshot cannot express ─────────────────────
  // NOT required. If this fails the frame still packs; the reliability and
  // forecast blocks come back NULL and the coverage audit grades their
  // variables dark. A boot that silently reported a calm depot because one RPC
  // 500'd would be worse than a boot that says it could not see.
  let fleetCondition: TwinFleetCondition | null = null;
  const condition = await stage("fleet_condition", false, now, async () => {
    const c = await transport.fleetCondition(simRunId);
    if (c?.error) throw new Error(String(c.error));
    fleetCondition = c;
    // A fleet wearing ANOTHER run's condition is not a soft warning: the run is
    // no longer reproducible from its seed, and any per-vehicle claim about it
    // is about different vehicles. Fail the stage so it shows up in the report.
    if (c.drawn_for_this_run === false) {
      throw new Error(
        `fleet condition was drawn for ${(c.drawn_run_ids ?? []).join(", ") || "another run"}, not this run`,
      );
    }
    return {
      value: c, count: c.with_condition, empty: c.with_condition === 0,
      detail: c.with_condition === 0
        ? `no condition drawn for any of ${c.fleet_size} vehicles`
        : `${c.with_condition}/${c.fleet_size} vehicles · SoH spread ${c.spread?.battery_soh_pct?.spread ?? "?"} pts`,
    };
  });
  stages.push(condition.report);

  let laborWindow: TwinLaborWindow | null = null;
  const laborStage = await stage("labor", false, now, async () => {
    const l = await transport.labor(simRunId);
    if (l?.error) throw new Error(String(l.error));
    laborWindow = l;
    const caps = l.lanes?.wash_cap === null
      ? "no lane contended yet — caps unstamped"
      : `wash ${l.lanes.wash_cap} · service ${l.lanes.service_cap} · deploy ${l.lanes.deploy_cap}`;
    return {
      value: l, count: l.overflow?.events ?? 0,
      detail: `${caps} · ${l.overflow?.events ?? 0} overflow event(s), ${l.backlog?.open ?? 0} open backlog`,
    };
  });
  stages.push(laborStage.report);

  let offsiteWindow: TwinOffsiteWindow | null = null;
  const offsiteStage = await stage("offsite", false, now, async () => {
    const o = await transport.offsite(simRunId);
    if (o?.error) throw new Error(String(o.error));
    offsiteWindow = o;
    const ratio = o.duration?.ratio_p50;
    return {
      value: o, count: o.dispatches?.total ?? 0,
      empty: (o.dispatches?.total ?? 0) === 0,
      detail: (o.dispatches?.completed ?? 0) === 0
        ? `${o.dispatches?.active ?? 0} out now, none returned yet`
        : `${o.dispatches.completed} trips · median ${o.duration.actual_min_p50} min`
          + (ratio != null ? ` (${ratio}x plan)` : ""),
    };
  });
  stages.push(offsiteStage.report);

  let wearWindow: TwinWearWindow | null = null;
  const wearStage = await stage("wear", false, now, async () => {
    const wv = await transport.wear(simRunId);
    if (wv?.error) throw new Error(String(wv.error));
    wearWindow = wv;
    return {
      value: wv, count: wv.fleet_size, empty: wv.fleet_size === 0,
      detail: `${wv.fleet_size} vehicles · ${wv.due?.pm_overdue ?? 0} PM overdue · `
        + `${wv.dtc?.open_total ?? 0} open DTC`,
    };
  });
  stages.push(wearStage.report);

  let eventsWindow: TwinEventsWindow | null = null;
  const events = await stage("events_window", false, now, async () => {
    const w = await transport.eventsWindow(simRunId);
    if (w?.error) throw new Error(String(w.error));
    eventsWindow = w;
    const n = w?.window?.signal_events ?? 0;
    return {
      value: w, count: n, empty: n === 0,
      detail: n === 0
        ? "run has logged no signal events yet"
        : `${n} signal events · ${w.reliability.charge_sessions} charge session(s) · ${w.reliability.arrival_delays} delay(s)`,
    };
  });
  stages.push(events.report);

  // ── channels: pack the frame and grade it ────────────────────────────────
  let bundle: ChannelBundle | null = null;
  const packed = await stage("channels", true, now, async () => {
    if (!snapshot) throw new Error("cannot pack channels without a frame");
    const b = packChannels(snapshot, geometry.value, now(), eventsWindow, fleetCondition, laborWindow, offsiteWindow, wearWindow, context.value);
    bundle = b;
    const ok = CHANNEL_IDS.filter((c) => b.channels[c].integrity.status === "ok").length;
    return {
      value: b, count: ok,
      empty: b.status === "not_ready",
      detail: `${ok}/${CHANNEL_IDS.length} channels ok · bundle ${b.status}`,
    };
  });
  stages.push(packed.report);

  // ── grade ─────────────────────────────────────────────────────────────────
  const channels: ChannelReadiness[] = bundle
    ? CHANNEL_IDS.map((id) => {
        const env = bundle!.channels[id];
        return {
          channel: id,
          required: REQUIRED_CHANNELS.includes(id),
          status: env.integrity.status,
          completeness: env.integrity.completeness,
          missing: env.integrity.missing,
          notes: env.integrity.notes,
        };
      })
    : CHANNEL_IDS.map((id) => ({
        channel: id,
        required: REQUIRED_CHANNELS.includes(id),
        status: "missing" as ChannelStatus,
        completeness: 0,
        missing: ["<channel never packed>"],
        notes: ["boot did not reach the channel stage"],
      }));

  const blocked_by: string[] = [];
  for (const s of stages) {
    if (s.required && s.status !== "ok") blocked_by.push(`${s.label}: ${s.status} — ${s.detail}`);
  }
  for (const c of channels) {
    if (c.required && c.status !== "ok") {
      blocked_by.push(`${c.channel}: ${c.status} (missing ${c.missing.join(", ") || "—"})`);
    }
  }

  // undefined, NOT [] — a failed registry stage must read as "drift unknown",
  // not as "the catalog is empty and every binding is stale".
  const catalogKeys = registry.value ? registry.value.map((v) => v.var_key) : undefined;
  const coverage = bundle ? auditCoverage(bundle, catalogKeys) : null;

  const finished = now();
  const report: WorldBootReport = {
    contract_version: CHANNEL_CONTRACT_VERSION,
    depot_id: resolvedDepotId,
    sim_run_id: simRunId,
    scenario: snapshot?.run?.scenario ?? null,
    seed: snapshot?.run?.seed ?? null,
    tick: snapshot?.run?.tick_count ?? null,
    started_at: started.toISOString(),
    finished_at: finished.toISOString(),
    duration_ms: finished.getTime() - started.getTime(),
    ready: blocked_by.length === 0,
    blocked_by,
    stages,
    channels,
    coverage,
  };

  return {
    report,
    layout: geometry.value,
    catalog: registry.value ?? [],
    scenarios: scenarioDeck.value ?? [],
    snapshot,
    bundle,
  };
}

/** Operator-facing one-liner for the console / toast. */
export function bootHeadline(r: WorldBootReport): string {
  if (r.ready) {
    const ok = r.channels.filter((c) => c.status === "ok").length;
    return `World loaded · ${ok}/${r.channels.length} channels ok · ${r.duration_ms}ms`;
  }
  return `World INCOMPLETE · ${r.blocked_by.length} blocker(s) · ${r.blocked_by[0] ?? ""}`;
}
