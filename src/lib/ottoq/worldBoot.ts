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

import { twin, NASHVILLE_DEPOT, type CatalogVar, type Scenario, type TwinLayout, type TwinSnapshot } from "@/lib/ottoTwin";
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
  | "first_frame"
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
}

export const defaultTransport: BootTransport = {
  layout: (id) => twin.layout(id),
  catalog: () => twin.catalog(),
  scenarios: () => twin.scenarios(),
  snapshot: (id) => twin.snapshot(id),
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
  first_frame: "First world frame",
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

  // ── static assets, in parallel ────────────────────────────────────────────
  const [geometry, registry, scenarioDeck] = await Promise.all([
    stage("geometry", true, now, async () => {
      const l = await transport.layout(depotId);
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

  // ── channels: pack the frame and grade it ────────────────────────────────
  let bundle: ChannelBundle | null = null;
  const packed = await stage("channels", true, now, async () => {
    if (!snapshot) throw new Error("cannot pack channels without a frame");
    const b = packChannels(snapshot, geometry.value, now());
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

  const catalogKeys = (registry.value ?? []).map((v) => v.var_key);
  const coverage = bundle ? auditCoverage(bundle, catalogKeys) : null;

  const finished = now();
  const report: WorldBootReport = {
    contract_version: CHANNEL_CONTRACT_VERSION,
    depot_id: depotId,
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
