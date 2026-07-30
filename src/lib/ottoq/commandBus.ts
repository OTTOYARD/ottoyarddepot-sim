// ============================================================================
// L0 — THE WIRE. One transport, one sequence space, one ledger.
//
// Everything OTTO-Q decides leaves through `transmit()`. Nothing else in the
// codebase may hand a command to the twin. That single choke point is what
// makes the questions an OEM will ask answerable:
//
//   "What did OTTO-Q tell vehicle AV-14, and when?"      → ledger lookup
//   "Did the fleet accept it?"                            → ack record
//   "What did it decide NOT to do, and why?"              → suppressed list
//   "Was anything lost in transit?"                       → sequence gaps
//
// ── DELIVERY SEMANTICS ──────────────────────────────────────────────────────
// At-least-once with idempotency. A transport may retry; command ids are
// content-hashed (run + tick + target + intent), so a redelivered command is
// recognised and does not double-apply. The ledger is the deduplicator.
//
// ── SEQUENCING ──────────────────────────────────────────────────────────────
// Every command carries a monotonic per-run sequence number. The executor can
// detect a gap and ask for a resend. Without this, a dropped batch looks
// exactly like a tick where OTTO-Q chose to do nothing — and those two must
// never be confusable.
//
// ── THE EXECUTOR IS NOT US ──────────────────────────────────────────────────
// `CommandExecutor` is the twin today and a real fleet API later. The bus does
// not know or care which. It hands over an envelope and records what comes
// back. It never moves a vehicle, never sets a power level, never retries a
// rejection into an acceptance.
// ============================================================================

import {
  TERMINAL_STATUSES,
  type CommandAck,
  type CommandBatch,
  type CommandOutcome,
  type CommandRecord,
  type CommandStatus,
  type OttoQCommand,
} from "./commands";

/**
 * The far side of the wire. Implementations: `TwinExecutor` (in-process, drives
 * the simulator), and later an HTTP client against an OEM fleet API and an
 * OpenADR endpoint.
 *
 * `deliver` returns one ack per command. An executor that returns fewer acks
 * than it was given has lost commands, and the bus records that as such.
 */
export interface CommandExecutor {
  /** stable identity recorded on every ack and outcome */
  id: string;
  deliver: (batch: CommandBatch) => Promise<CommandAck[]>;
}

export interface TransmitResult {
  batch_id: string;
  sent: number;
  accepted: number;
  rejected: number;
  /** commands sent that the executor never acknowledged either way */
  unacknowledged: number;
  /** transport-level failure; the whole batch is unsent and stays pending */
  transportError: string | null;
}

export interface LedgerStats {
  total: number;
  open: number;
  byStatus: Record<CommandStatus, number>;
  /** missing sequence numbers below the high-water mark — lost commands */
  sequenceGaps: number[];
}

/**
 * The command ledger and transmitter.
 *
 * One instance per run. Reset it when the run changes: sequence numbers and
 * idempotency are only meaningful within a run.
 */
export class CommandBus {
  private records = new Map<string, CommandRecord>();
  private nextSequence = 0;
  private highWaterSequence = -1;

  constructor(private executor: CommandExecutor) {}

  /** Sequence number the next batch should start at. */
  get sequenceStart(): number {
    return this.nextSequence;
  }

  /** Commands still awaiting a terminal state — what the shield reads. */
  get openCommands(): Map<string, CommandRecord> {
    const open = new Map<string, CommandRecord>();
    for (const [id, rec] of this.records) {
      if (!TERMINAL_STATUSES.includes(rec.status)) open.set(id, rec);
    }
    return open;
  }

  /** Full history, for the Black Box bundle. */
  get ledger(): CommandRecord[] {
    return [...this.records.values()];
  }

  /**
   * Send a batch and record everything that happens to it.
   *
   * A transport failure leaves every command in `issued` — pending, not lost —
   * so the next tick's shield still counts them against the per-target limit
   * and OTTO-Q does not pile a second instruction on top of an unconfirmed one.
   */
  async transmit(batch: CommandBatch): Promise<TransmitResult> {
    // Idempotency: drop anything already in the ledger before it hits the wire.
    const fresh = batch.commands.filter((c) => !this.records.has(c.command_id));
    for (const cmd of fresh) this.record(cmd);

    if (fresh.length === 0) {
      return {
        batch_id: batch.batch_id, sent: 0, accepted: 0, rejected: 0,
        unacknowledged: 0, transportError: null,
      };
    }

    const outgoing: CommandBatch = { ...batch, commands: fresh };
    this.nextSequence = Math.max(this.nextSequence, ...fresh.map((c) => c.sequence + 1));
    this.highWaterSequence = Math.max(this.highWaterSequence, ...fresh.map((c) => c.sequence));

    let acks: CommandAck[];
    try {
      acks = await this.executor.deliver(outgoing);
    } catch (e) {
      return {
        batch_id: batch.batch_id, sent: fresh.length, accepted: 0, rejected: 0,
        unacknowledged: fresh.length,
        transportError: e instanceof Error ? e.message : String(e),
      };
    }

    for (const cmd of fresh) this.advance(cmd.command_id, "delivered", batch.issued_sim);

    let accepted = 0, rejected = 0;
    const seen = new Set<string>();
    for (const ack of acks) {
      const rec = this.records.get(ack.command_id);
      if (!rec) continue; // an ack for something we never sent — ignore, do not invent
      seen.add(ack.command_id);
      rec.ack = ack;
      this.advance(ack.command_id, ack.status, ack.at_sim, ack.reason);
      if (ack.status === "accepted") accepted++; else rejected++;
    }

    return {
      batch_id: batch.batch_id,
      sent: fresh.length,
      accepted, rejected,
      unacknowledged: fresh.filter((c) => !seen.has(c.command_id)).length,
      transportError: null,
    };
  }

  /** Executor reports progress: the command is now being carried out. */
  markExecuting(commandId: string, atSim: string): void {
    this.advance(commandId, "executing", atSim);
  }

  /** Executor reports a terminal result. */
  complete(outcome: CommandOutcome): void {
    const rec = this.records.get(outcome.command_id);
    if (!rec) return;
    rec.outcome = outcome;
    this.advance(outcome.command_id, outcome.status, outcome.at_sim, outcome.reason);
  }

  /**
   * Expire anything whose window has closed. Called once per tick with the
   * world clock — a command nobody acted on must not linger and block its
   * target forever.
   */
  expireStale(simClock: string | null): number {
    if (!simClock) return 0;
    const now = Date.parse(simClock);
    if (!Number.isFinite(now)) return 0;
    let expired = 0;
    for (const rec of this.records.values()) {
      if (TERMINAL_STATUSES.includes(rec.status)) continue;
      const exp = Date.parse(rec.command.window.expires_sim);
      if (Number.isFinite(exp) && exp <= now) {
        this.advance(rec.command.command_id, "expired", simClock, "window closed without completion");
        expired++;
      }
    }
    return expired;
  }

  /** Mark a command replaced by a newer one for the same target. */
  supersede(commandId: string, atSim: string, byCommandId: string): void {
    this.advance(commandId, "superseded", atSim, `replaced by ${byCommandId}`);
  }

  stats(): LedgerStats {
    const byStatus = {
      issued: 0, delivered: 0, accepted: 0, executing: 0,
      completed: 0, rejected: 0, expired: 0, superseded: 0,
    } as Record<CommandStatus, number>;
    const seen = new Set<number>();
    for (const rec of this.records.values()) {
      byStatus[rec.status]++;
      seen.add(rec.command.sequence);
    }
    const gaps: number[] = [];
    for (let s = 0; s <= this.highWaterSequence; s++) if (!seen.has(s)) gaps.push(s);
    return {
      total: this.records.size,
      open: this.openCommands.size,
      byStatus,
      sequenceGaps: gaps,
    };
  }

  reset(): void {
    this.records.clear();
    this.nextSequence = 0;
    this.highWaterSequence = -1;
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private record(cmd: OttoQCommand): void {
    this.records.set(cmd.command_id, {
      command: cmd,
      status: "issued",
      history: [{ status: "issued", at_sim: cmd.issued_sim }],
      ack: null,
      outcome: null,
    });
  }

  /**
   * Advance a command's state. Terminal states are sticky: once a command is
   * completed or rejected, a late ack cannot resurrect it. That is what keeps
   * the ledger a truthful account rather than a last-writer-wins cache.
   */
  private advance(id: string, status: CommandStatus, atSim: string, note?: string | null): void {
    const rec = this.records.get(id);
    if (!rec) return;
    if (TERMINAL_STATUSES.includes(rec.status)) return;
    if (rec.status === status) return;
    rec.status = status;
    rec.history.push({ status, at_sim: atSim, note: note ?? null });
  }
}

// ── the twin executor ───────────────────────────────────────────────────────

/**
 * What the twin can actually carry out today, and what it must decline.
 *
 * This is deliberately honest. The twin's motion system does not yet consume
 * `assign_stall` (it invents motion from stall state — see backlog 4.11), and
 * there is no energy controller listening for a BESS directive. Rather than
 * pretend, this executor ACCEPTS what a subscriber exists for and REJECTS the
 * rest with a reason naming the missing piece.
 *
 * A rejection here is not a failure of OTTO-Q. It is the twin telling the truth
 * about its own capabilities, which is exactly what a real fleet API does when
 * asked for something the vehicle cannot do.
 */
export interface TwinSubscribers {
  /** motion system: move this vehicle to this stall within this window */
  vehicle?: (cmd: OttoQCommand) => boolean | string;
  /** energy controller: charge/discharge/curtail */
  energy?: (cmd: OttoQCommand) => boolean | string;
  /** charger manager: ceilings, pause/resume, quarantine */
  charger?: (cmd: OttoQCommand) => boolean | string;
  /** ops queue */
  depot?: (cmd: OttoQCommand) => boolean | string;
}

export function twinExecutor(subs: TwinSubscribers, id = "twin"): CommandExecutor {
  const routeFor = (cmd: OttoQCommand) => {
    switch (cmd.command_class) {
      case "vehicle.orchestration": return { fn: subs.vehicle, name: "motion system" };
      case "energy.orchestration": return { fn: subs.energy, name: "energy controller" };
      case "charger.orchestration": return { fn: subs.charger, name: "charger manager" };
      case "depot.orchestration": return { fn: subs.depot, name: "ops queue" };
    }
  };

  return {
    id,
    deliver: async (batch: CommandBatch): Promise<CommandAck[]> =>
      batch.commands.map((cmd) => {
        const { fn, name } = routeFor(cmd);
        if (!fn) {
          return {
            command_id: cmd.command_id, status: "rejected", executor: id,
            at_sim: batch.issued_sim,
            reason: `no ${name} is subscribed in this twin — command understood but cannot be carried out`,
          };
        }
        let verdict: boolean | string;
        try {
          verdict = fn(cmd);
        } catch (e) {
          verdict = e instanceof Error ? e.message : String(e);
        }
        return verdict === true
          ? { command_id: cmd.command_id, status: "accepted", executor: id, at_sim: batch.issued_sim }
          : {
              command_id: cmd.command_id, status: "rejected", executor: id,
              at_sim: batch.issued_sim,
              reason: typeof verdict === "string" ? verdict : "executor declined",
            };
      }),
  };
}
