// ============================================================================
// L1 SHIELD — the last gate before anything leaves OTTO-Q.
//
// This is a Simplex-architecture safety shield: a small, simple, fully
// auditable supervisor sitting in front of a large, clever, opaque controller.
// cuOpt is a GPU solver. Nemotron is a 550B reasoning model. Neither can be
// proven correct. The shield can, because it does exactly one thing:
//
//     IT REMOVES COMMANDS. IT NEVER CREATES OR MODIFIES ONE.
//
// That property is the whole guarantee. If the shield cannot invent an action,
// then no shield bug can cause an action — the worst it can do is suppress one,
// which is the safe direction. Every rule below is therefore a predicate that
// either admits a command unchanged or removes it with a named reason.
//
// A suppressed command is never silently dropped: it lands in the batch's
// `suppressed` list with the rule that caught it. "Why didn't OTTO-Q assign
// that stall?" must always have an answer.
//
// ── WHY THE FRESHNESS RULE MATTERS MOST ─────────────────────────────────────
// Rule `stale_world` rejects commands computed from a bundle that was not
// ready. It is the join between this file and the inbound contract: the boot
// gate measures whether OTTO-Q can see the world, and the shield refuses to let
// it act when it cannot. Without that link, a run with no weather feed and no
// charger health still emits confident commands.
// ============================================================================

import {
  findActuationFields,
  TERMINAL_STATUSES,
  type ChargerParams,
  type CommandRecord,
  type CommandTarget,
  type EnergyParams,
  type OttoQCommand,
  type SuppressedCommand,
  type VehicleParams,
} from "./commands";
import type { ChannelBundle } from "./contracts";

export interface ShieldConfig {
  /** refuse to emit anything when the input bundle is not_ready */
  requireReadyBundle: boolean;
  /** also refuse when the bundle is merely degraded (stricter posture) */
  requireUndegradedBundle: boolean;
  /** never discharge the BESS below this state of charge */
  bessFloorPct: number;
  /** never charge the BESS above this state of charge */
  bessCeilingPct: number;
  /** hard site ceiling, kW — used when no DR call supplies one */
  siteCapKw: number | null;
  /** max open (non-terminal) commands per target, to stop command thrash */
  maxOpenPerTarget: number;
  /** max commands in a single batch — a plan bigger than this is a bug upstream */
  maxBatchSize: number;
  /** reject a window that ends before it begins, or runs longer than this */
  maxWindowSeconds: number;
}

export const DEFAULT_SHIELD_CONFIG: ShieldConfig = {
  requireReadyBundle: true,
  // Today every frame is `degraded` (service timers + OCPP health are unfed),
  // so demanding an undegraded bundle would suppress everything. Flip this to
  // true once backlog items 4.1 and 4.2 land — see docs/OTTO-Q-WORLD-CONTRACT.md.
  requireUndegradedBundle: false,
  bessFloorPct: 15,
  bessCeilingPct: 95,
  siteCapKw: null,
  maxOpenPerTarget: 1,
  maxBatchSize: 200,
  maxWindowSeconds: 4 * 3600,
};

export interface ShieldContext {
  bundle: ChannelBundle;
  /** commands still in flight from earlier ticks, keyed by command_id */
  openCommands: Map<string, CommandRecord>;
  config?: Partial<ShieldConfig>;
}

export interface ShieldResult {
  admitted: OttoQCommand[];
  suppressed: SuppressedCommand[];
  /** true when the shield refused the entire batch (bad world state) */
  vetoedAll: boolean;
  vetoReason: string | null;
  /** open commands displaced by a strictly higher-priority admission. The
   *  shield only removes; the CALLER closes these in the ledger so a preempted
   *  command does not linger as a phantom hold on its target. */
  preempted: PreemptedCommand[];
}

/** A rule inspects one command against the world; a string means "remove it". */
interface Rule {
  name: string;
  check: (cmd: OttoQCommand, ctx: EvalContext) => string | null;
}

/** An open command displaced by a strictly higher-priority admission. */
export interface PreemptedCommand {
  command_id: string;
  by: string;
  target: CommandTarget;
}

interface EvalContext {
  bundle: ChannelBundle;
  cfg: ShieldConfig;
  openByTarget: Map<string, number>;
  /** highest-priority open command per target, for cross-tick preemption */
  openByPriority: Map<string, { command_id: string; priority: number }>;
  preempted: PreemptedCommand[];
  /** stall_id → vehicle_id already claimed by an admitted command this batch */
  claimedStalls: Map<string, string>;
  /** vehicle ids already commanded this batch */
  commandedVehicles: Set<string>;
  /** running total of charger ceiling changes admitted this batch, kW */
  admittedCeilingKw: number;
}

/** Statuses meaning "not assignable" in the RENDERER's richer vocabulary. The
 *  backend emits only available/occupied; this is a secondary guard. */
const OFFLINE_STATUS_NAMES = new Set(["offline", "faulted", "fault", "out_of_service", "maintenance"]);

const targetKey = (t: CommandTarget) => `${t.kind}:${t.id}`;
const parseSim = (s: string | null) => (s ? Date.parse(s) : NaN);

// ── rules ───────────────────────────────────────────────────────────────────
// Ordered cheapest-and-most-fundamental first. The first rule to fire wins, so
// a command that violates the actuation doctrine is reported as such rather
// than as some downstream symptom.

const RULES: Rule[] = [
  // ── doctrine ──────────────────────────────────────────────────────────────
  {
    name: "no_actuation",
    check: (cmd) => {
      // Scan the WHOLE command, not just params. `materialize` copies the
      // advisor's `target` object onto the envelope by reference, so a target
      // carrying a waypoint/heading/speed sailed straight through and the
      // batch was reported clean — in the one rule that exists to make that
      // impossible. The doc claimed the scan was recursive over the command;
      // now it is.
      //
      // Scanning the envelope means skipping the fields the contract itself
      // owns; none of them can carry actuation, and `window`/`provenance` are
      // free text an advisor could otherwise trip the scan with.
      const hits = [
        ...findActuationFields(cmd.params, "params"),
        ...findActuationFields(cmd.target, "target"),
      ];
      return hits.length
        ? `command carries actuation field(s) ${hits.join(", ")} — OTTO-Q orchestrates, it does not actuate`
        : null;
    },
  },

  // ── structural sanity ─────────────────────────────────────────────────────
  {
    name: "window_sane",
    check: (cmd, ctx) => {
      const { not_before_sim, not_after_sim, expires_sim } = cmd.window;
      const exp = parseSim(expires_sim);
      if (!Number.isFinite(exp)) return "expires_sim is missing or unparseable";
      const clock = parseSim(ctx.bundle.sim_clock);
      if (Number.isFinite(clock) && exp <= clock) return "command expires at or before the current sim clock";
      if (not_before_sim && not_after_sim) {
        const a = parseSim(not_before_sim), b = parseSim(not_after_sim);
        if (!Number.isFinite(a) || !Number.isFinite(b)) return "window bounds are unparseable";
        if (b <= a) return "window ends at or before it begins";
        if ((b - a) / 1000 > ctx.cfg.maxWindowSeconds) {
          return `window spans ${Math.round((b - a) / 1000)}s, over the ${ctx.cfg.maxWindowSeconds}s limit`;
        }
      }
      return null;
    },
  },
  {
    name: "target_identified",
    check: (cmd) => (cmd.target?.id ? null : "command has no target id"),
  },

  // ── anti-thrash ───────────────────────────────────────────────────────────
  {
    name: "target_not_saturated",
    check: (cmd, ctx) => {
      const key = targetKey(cmd.target);
      const open = ctx.openByTarget.get(key) ?? 0;
      if (open < ctx.cfg.maxOpenPerTarget) return null;

      // PRIORITY MUST SURVIVE ACROSS TICKS.
      //
      // This limit exists to stop command thrash, and it did that — but it was
      // a bare count, and the priority sort below it only orders commands
      // WITHIN one batch. Across ticks a stale low-priority command outranked
      // everything: an open `charge_bess` (priority ~268) vetoed the
      // demand-response `discharge_bess` (priority 1000) on the same battery
      // for the full hour of its window, so the site kept importing into the
      // battery straight through a DR event. The operator trace blamed command
      // thrash rather than a compliance conflict, and the doctrine that
      // "compliance outranks price" held only inside the advisor.
      //
      // A strictly higher-priority command now PREEMPTS the open one. The
      // displaced command is recorded so the caller can supersede it in the
      // ledger — the shield still only removes, it just records what its
      // admission implies.
      const incumbent = ctx.openByPriority.get(key);
      if (incumbent && cmd.priority > incumbent.priority) {
        ctx.preempted.push({ command_id: incumbent.command_id, by: cmd.command_id, target: cmd.target });
        return null;
      }
      return `target already has ${open} open command(s); limit is ${ctx.cfg.maxOpenPerTarget}`
        + (incumbent ? ` (held by priority ${incumbent.priority}, this is ${cmd.priority})` : "");
    },
  },
  {
    name: "one_command_per_vehicle_per_batch",
    check: (cmd, ctx) => {
      if (cmd.target.kind !== "vehicle") return null;
      return ctx.commandedVehicles.has(cmd.target.id)
        ? "vehicle already has a command in this batch"
        : null;
    },
  },

  // ── vehicle feasibility ───────────────────────────────────────────────────
  {
    name: "vehicle_exists",
    check: (cmd, ctx) => {
      if (cmd.target.kind !== "vehicle") return null;
      const fleet = ctx.bundle.channels.fleet_telemetry.payload.vehicles;
      return fleet.some((v) => v.id === cmd.target.id)
        ? null
        : "vehicle is not present in the fleet telemetry channel";
    },
  },
  {
    name: "stall_exists_and_is_free",
    check: (cmd, ctx) => {
      if (cmd.intent !== "assign_stall") return null;
      const stallId = (cmd.params as VehicleParams).stall_id;
      if (!stallId) return "assign_stall carries no stall_id";

      const stall = ctx.bundle.channels.depot_ops.payload.stalls.find((s) => s.id === stallId);
      if (!stall) return "stall is not in the depot inventory";

      // Occupied by someone ELSE is a hard no. Occupied by the target vehicle
      // is a benign re-issue of an assignment already in effect.
      const occupant = stall.vehicle_id;
      if (occupant && occupant !== cmd.target.id) {
        return `stall is occupied by ${occupant}`;
      }
      // The backend's stalls.status only ever holds 'available' or 'occupied'
      // (verified against pg_enum + live data). The old blacklist named five
      // values that never occur and never checked the one that does, so
      // occupancy rested entirely on a nullable vehicle_id — an occupied stall
      // whose vehicle_id had not yet been populated read as free.
      //
      // Be POSITIVE about the real vocabulary: anything not 'available' is not
      // assignable. The blacklist stays as a secondary guard for
      // renderer-sourced statuses, which use a richer set.
      const st = stall.status.toLowerCase();
      if (st !== "available") {
        return `stall status is ${stall.status}, not available`;
      }
      if (OFFLINE_STATUS_NAMES.has(st)) {
        return `stall status is ${stall.status}`;
      }
      // Two vehicles cannot be given the same stall in one plan.
      const claimedBy = ctx.claimedStalls.get(stallId);
      if (claimedBy && claimedBy !== cmd.target.id) {
        return `stall already assigned to ${claimedBy} in this batch`;
      }
      return null;
    },
  },
  {
    name: "connector_compatible",
    check: (cmd, ctx) => {
      if (cmd.intent !== "assign_stall") return null;
      const p = cmd.params as VehicleParams;
      if (!p.stall_id || !p.service) return null;
      // Only charge services care about the connector.
      if (!/charge/i.test(p.service)) return null;
      const stall = ctx.bundle.channels.depot_ops.payload.stalls.find((s) => s.id === p.stall_id);
      if (!stall) return null; // already caught by stall_exists_and_is_free
      if (stall.connector_kw === null) {
        return "charge assignment to a stall with no rated connector power";
      }
      return null;
    },
  },

  // ── energy envelope ───────────────────────────────────────────────────────
  {
    name: "bess_soc_bounds",
    check: (cmd, ctx) => {
      if (cmd.intent !== "discharge_bess" && cmd.intent !== "charge_bess") return null;
      const soc = ctx.bundle.channels.energy_grid.payload.bess.soc_pct;
      if (soc === null) return "BESS state of charge is unknown — cannot bound the action";
      if (cmd.intent === "discharge_bess" && soc <= ctx.cfg.bessFloorPct) {
        return `BESS at ${soc}% is at or below the ${ctx.cfg.bessFloorPct}% discharge floor`;
      }
      if (cmd.intent === "charge_bess" && soc >= ctx.cfg.bessCeilingPct) {
        return `BESS at ${soc}% is at or above the ${ctx.cfg.bessCeilingPct}% charge ceiling`;
      }

      // The shield checked WHERE THE BATTERY IS but never what the command
      // ASKED FOR. A discharge declaring soc_bound_pct: 5 — below the shield's
      // own 15% floor — was admitted whole, and the only thing standing between
      // it and a deep discharge was the controller choosing to be stricter than
      // the gate. The gate must not delegate its own floor.
      const bound = (cmd.params as EnergyParams).soc_bound_pct;
      if (cmd.intent === "discharge_bess") {
        if (bound === null || bound === undefined) return "discharge_bess declares no soc_bound_pct — an unbounded discharge is not admissible";
        if (bound < ctx.cfg.bessFloorPct) return `declared floor ${bound}% is below the shield's ${ctx.cfg.bessFloorPct}% discharge floor`;
      }
      if (cmd.intent === "charge_bess") {
        if (bound !== null && bound !== undefined && bound > ctx.cfg.bessCeilingPct) {
          return `declared ceiling ${bound}% is above the shield's ${ctx.cfg.bessCeilingPct}% charge ceiling`;
        }
      }
      return null;
    },
  },
  {
    name: "respects_dr_cap",
    check: (cmd, ctx) => {
      // While a demand-response call is live, OTTO-Q may not ask the site to
      // draw MORE. Charging the battery from the grid under a DR call is
      // exactly the mistake this rule exists to prevent.
      const dr = ctx.bundle.channels.energy_grid.payload.demand_response;

      // UNKNOWN IS NOT "NO CALL". `active` is now tri-state, and a missing grid
      // row lands here as null. Treating that as false is what silently
      // disarmed this entire rule: with no grid observation the shield admitted
      // a +250 kW grid charge during a live demand-response event and reported
      // zero suppressions.
      //
      // Under uncertainty the shield refuses the action that is only safe if
      // the uncertainty resolves favourably. Charging from the grid is exactly
      // that action; everything else proceeds.
      if (dr.active === null) {
        if (cmd.intent === "charge_bess") {
          const kw = (cmd.params as EnergyParams).power_kw ?? 0;
          const solar = ctx.bundle.channels.energy_grid.payload.site.solar_kw;
          if (solar === null || kw > solar) {
            return "demand-response state is unknown (no grid observation) — grid charging is not permitted until it can be confirmed";
          }
        }
        return null;
      }

      if (!dr.active) return null;
      if (cmd.intent === "charge_bess") {
        const kw = (cmd.params as EnergyParams).power_kw ?? 0;
        // Charging from surplus solar is fine; charging from the grid is not.
        const solar = ctx.bundle.channels.energy_grid.payload.site.solar_kw ?? 0;
        if (kw > solar) {
          return `DR call active: charging ${kw}kW exceeds the ${solar}kW of available solar`;
        }
      }
      if (cmd.intent === "release_curtailment") {
        return "DR call is still active — curtailment cannot be released";
      }
      if (cmd.intent === "set_power_ceiling" && dr.headroom_kw !== null && dr.headroom_kw < 0) {
        const ceiling = (cmd.params as ChargerParams).power_ceiling_kw ?? 0;
        const current = ctx.bundle.channels.charger_systems.payload.committed_kw;
        if (current !== null && ceiling > current) {
          return `site is ${Math.abs(dr.headroom_kw)}kW over the DR cap; raising a charger ceiling is not permitted`;
        }
      }
      return null;
    },
  },
  {
    name: "curtailment_cap_is_positive",
    check: (cmd) => {
      if (cmd.intent !== "curtail_site") return null;
      const cap = (cmd.params as EnergyParams).site_cap_kw;
      if (cap === null || cap === undefined) return "curtail_site carries no site_cap_kw";
      if (cap <= 0) return `site_cap_kw of ${cap} would command a full site shutdown`;
      return null;
    },
  },

  // ── charger feasibility ───────────────────────────────────────────────────
  {
    name: "charger_exists",
    check: (cmd, ctx) => {
      if (cmd.target.kind !== "charger") return null;
      const chargers = ctx.bundle.channels.charger_systems.payload.chargers;
      const hit = chargers.find((c) => c.stall_id === cmd.target.id);
      if (!hit) return "charger is not in the charger systems channel";
      // Raising the ceiling on a faulted charger is meaningless and masks the
      // fault in the operator view.
      if (hit.faulted && cmd.intent === "set_power_ceiling") {
        return "charger is faulted; a power ceiling has no meaning";
      }
      return null;
    },
  },
  {
    name: "ceiling_within_rating",
    check: (cmd, ctx) => {
      if (cmd.intent !== "set_power_ceiling") return null;
      const want = (cmd.params as ChargerParams).power_ceiling_kw;
      if (want === null || want === undefined) return "set_power_ceiling carries no power_ceiling_kw";
      if (want < 0) return "power ceiling is negative";
      const hit = ctx.bundle.channels.charger_systems.payload.chargers.find((c) => c.stall_id === cmd.target.id);
      // An UNKNOWN rating is not permission. This used to skip the check
      // entirely when the charger was absent from the channel or carried no
      // connector_kw — the inverse of its sibling connector_compatible, which
      // correctly refuses on a null rating. A ceiling cannot be bounded
      // against a rating nobody published.
      if (!hit) return "charger is not in the charger systems channel — cannot bound a ceiling against an unknown rating";
      if (hit.rated_kw === null || hit.rated_kw === undefined) {
        return "charger has no rated power on this frame — cannot bound a ceiling against an unknown rating";
      }
      if (want > hit.rated_kw) {
        return `ceiling ${want}kW exceeds the charger's ${hit.rated_kw}kW rating`;
      }
      return null;
    },
  },
];

// ── evaluation ──────────────────────────────────────────────────────────────

/**
 * Gate a candidate plan.
 *
 * Two levels of refusal:
 *   · BATCH VETO — the world itself is not fit to act on. Nothing is emitted.
 *   · PER-COMMAND — the world is fine, this particular command is not.
 */
export function applyShield(
  candidates: OttoQCommand[],
  ctx: ShieldContext,
): ShieldResult {
  const cfg = { ...DEFAULT_SHIELD_CONFIG, ...(ctx.config ?? {}) };
  const suppressed: SuppressedCommand[] = [];

  const suppressAll = (rule: string, detail: string): ShieldResult => ({
    admitted: [],
    suppressed: candidates.map((c) => ({
      intent: c.intent, target: c.target, advisor: c.provenance.advisor, rule, detail,
    })),
    vetoedAll: true,
    vetoReason: detail,
    preempted: [],
  });

  // ── batch-level vetoes ───────────────────────────────────────────────────
  if (cfg.requireReadyBundle && ctx.bundle.status === "not_ready") {
    return suppressAll(
      "stale_world",
      "input bundle is not_ready — a required channel is missing, so no command may be issued",
    );
  }
  if (cfg.requireUndegradedBundle && ctx.bundle.status !== "ready") {
    return suppressAll("stale_world", `input bundle is ${ctx.bundle.status} and strict mode is on`);
  }
  if (candidates.length > cfg.maxBatchSize) {
    return suppressAll(
      "batch_too_large",
      `${candidates.length} commands exceeds the ${cfg.maxBatchSize} batch limit — upstream produced an implausible plan`,
    );
  }

  // ── per-command evaluation ───────────────────────────────────────────────
  const openByTarget = new Map<string, number>();
  const openByPriority = new Map<string, { command_id: string; priority: number }>();
  // Stalls already claimed by commands still in flight from EARLIER ticks.
  // Without this, only within-batch contention was tracked, so a second
  // vehicle could be commanded to a stall an in-flight command already owned.
  const claimedStalls = new Map<string, string>();
  for (const rec of ctx.openCommands.values()) {
    if (TERMINAL_STATUSES.includes(rec.status)) continue;
    const k = targetKey(rec.command.target);
    openByTarget.set(k, (openByTarget.get(k) ?? 0) + 1);
    const cur = openByPriority.get(k);
    if (!cur || rec.command.priority > cur.priority) {
      openByPriority.set(k, { command_id: rec.command.command_id, priority: rec.command.priority });
    }
    if (rec.command.intent === "assign_stall") {
      const sid = (rec.command.params as VehicleParams).stall_id;
      if (sid) claimedStalls.set(sid, rec.command.target.id);
    }
  }

  const evalCtx: EvalContext = {
    bundle: ctx.bundle,
    cfg,
    openByTarget,
    openByPriority,
    preempted: [],
    claimedStalls,
    commandedVehicles: new Set(),
    admittedCeilingKw: 0,
  };

  const admitted: OttoQCommand[] = [];
  // Highest priority first, so when two commands contend for one stall the
  // more important one is admitted and the other is the one reported.
  const ordered = [...candidates].sort((a, b) => b.priority - a.priority);

  for (const cmd of ordered) {
    let failure: { rule: string; detail: string } | null = null;
    for (const rule of RULES) {
      const detail = rule.check(cmd, evalCtx);
      if (detail) { failure = { rule: rule.name, detail }; break; }
    }

    if (failure) {
      suppressed.push({
        intent: cmd.intent, target: cmd.target,
        advisor: cmd.provenance.advisor,
        rule: failure.rule, detail: failure.detail,
      });
      continue;
    }

    // Admitted — claim the resources it consumes so later commands in the same
    // batch see them as taken.
    admitted.push(cmd);
    if (cmd.target.kind === "vehicle") evalCtx.commandedVehicles.add(cmd.target.id);
    if (cmd.intent === "assign_stall") {
      const stallId = (cmd.params as VehicleParams).stall_id;
      if (stallId) evalCtx.claimedStalls.set(stallId, cmd.target.id);
    }
    const k = targetKey(cmd.target);
    evalCtx.openByTarget.set(k, (evalCtx.openByTarget.get(k) ?? 0) + 1);
  }

  return { admitted, suppressed, vetoedAll: false, vetoReason: null, preempted: evalCtx.preempted };
}

/** One-line operator summary of what the shield did. */
export function shieldHeadline(r: ShieldResult): string {
  if (r.vetoedAll) return `Shield VETOED the batch — ${r.vetoReason}`;
  if (!r.suppressed.length) return `Shield admitted all ${r.admitted.length} command(s)`;
  const byRule = r.suppressed.reduce<Record<string, number>>((a, s) => {
    a[s.rule] = (a[s.rule] ?? 0) + 1;
    return a;
  }, {});
  const detail = Object.entries(byRule).map(([k, v]) => `${k}×${v}`).join(", ");
  return `Shield admitted ${r.admitted.length}, suppressed ${r.suppressed.length} (${detail})`;
}
