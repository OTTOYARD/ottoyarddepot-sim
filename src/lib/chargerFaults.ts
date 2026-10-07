// chargerFaults — what the cockpit says about a charger the twin has taken out of use.
//
// Chase, 2026-10-07: "make sure it indicates somewhere visually that that charging station is down due to a fault
// and cars are not routed to it." The engine (otto-q-core 0612) lists every stall whose OCPP charger is Faulted in the
// snapshot's `stalls_status`, with `status: 'faulted'`, `charger_state: 'Faulted'`, a `fault_code` and the sim-clock
// instant its drawn repair ends (`fault_until`). The engine sends no car to such a stall (measured on run fd6ed035:
// 14 faults, 0 bookings, cars or sessions on a faulted stall during its repair).
//
// Pure: no React, no stores. The motion driver reads `stallDownOf` to keep cars off the stall; the 2D plan, the 3D
// field, the tooltips and the "chargers down" chip read the words from here, so every surface says the same thing.

import type { TwinLayout, TwinSnapshot } from "@/lib/ottoTwin";
import { clockCT, DEPOT_TZ } from "@/lib/plainWords";

export type TwinStallStatus = TwinSnapshot["stalls_status"][number];

/** Why the twin has taken a stall out of use. */
export interface ChargerDown {
  /** 'fault': the stall's charger is Faulted. 'offline': the twin reports the stall offline for another reason. */
  kind: "fault" | "offline";
  /** The twin's fault code (an open set), or null when it gave none. */
  code: string | null;
  /** Sim-clock instant the repair ends, or null when the twin has no end for it. */
  until: string | null;
}

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

/**
 * Is this stall down, and why? A fault is read from either field: `status` 'faulted' (the snapshot's own verdict) or
 * `charger_state` 'Faulted' (the charger's), so a frame that carries one without the other still keeps cars off it.
 * 'offline' is the older status the twin uses for a stall out of use for another reason.
 */
export function stallDownOf(ss: TwinStallStatus | null | undefined): ChargerDown | null {
  if (!ss) return null;
  const status = String(ss.status ?? "").toLowerCase();
  const charger = String(ss.charger_state ?? "").toLowerCase();
  if (status === "faulted" || charger === "faulted") {
    return { kind: "fault", code: text(ss.fault_code), until: text(ss.fault_until) };
  }
  if (status === "offline") return { kind: "offline", code: null, until: null };
  return null;
}

/** Two readings of a stall say the same thing (so a store write can be skipped). */
export function sameDown(a: ChargerDown | null | undefined, b: ChargerDown | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  return a.kind === b.kind && a.code === b.code && a.until === b.until;
}

/** Fault codes in plain words. An unknown code gets no words: its label is "Charger fault" alone. */
export const FAULT_WORDS: Record<string, string> = {
  "fault.communication_dropout": "communication dropout",
  "fault.station_hardware": "hardware",
  "fault.connector_cable": "connector cable",
  "fault.thermal_emergency": "high temperature",
  "fault.ground_fault_safety": "ground fault",
  "fault.operator_injected": "operator injection",
  "fault.injected_offline": "operator injection",
};

export function faultWords(code: string | null | undefined): string | null {
  return code ? FAULT_WORDS[code.trim().toLowerCase()] ?? null : null;
}

/** "Charger fault: communication dropout", "Charger fault" (no code, or one we do not know) or "Charger offline". */
export function downLabel(d: ChargerDown): string {
  if (d.kind === "offline") return "Charger offline";
  const w = faultWords(d.code);
  return w ? `Charger fault: ${w}` : "Charger fault";
}

/** The word on the stall itself in the 2D plan. */
export function downTag(d: ChargerDown): string {
  return d.kind === "fault" ? "FAULT" : "OFFLINE";
}

const dayCT = (ms: number): string =>
  new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: DEPOT_TZ });

/**
 * When the charger comes back, on the SIM clock, in depot time (CT):
 *   "Back about 11:07 AM sim."             the repair ends later today on the run's clock
 *   "Back about Oct 8, 6:30 AM sim."       on another day
 *   "Repair was due Sep 2, 6:07 AM sim."   the repair end is already behind the run's clock
 * Null when the twin gave no end (or one that does not parse): the time is left out, never guessed.
 */
export function backText(until: string | null | undefined, simClock?: string | null): string | null {
  if (!until) return null;
  const u = Date.parse(until);
  if (!Number.isFinite(u)) return null;
  const now = simClock ? Date.parse(simClock) : NaN;
  const known = Number.isFinite(now);
  const when = known && dayCT(u) === dayCT(now) ? `${clockCT(until)} sim` : `${dayCT(u)}, ${clockCT(until)} sim`;
  if (known && u <= now) return `Repair was due ${when}.`;
  return `Back about ${when}.`;
}

/** The whole reading: "Charger fault: communication dropout. Back about 11:07 AM sim." */
export function downText(d: ChargerDown, simClock?: string | null): string {
  const back = backText(d.until, simClock);
  return back ? `${downLabel(d)}. ${back}` : `${downLabel(d)}.`;
}

/** The same reading about a named charger, for a list: "DCFC-02 has a charger fault: communication dropout. Back
 *  about 11:07 AM sim.", "L2-12 is offline." */
export function downSentence(name: string, d: ChargerDown, simClock?: string | null): string {
  const w = d.kind === "fault" ? faultWords(d.code) : null;
  const what = d.kind === "offline" ? `${name} is offline.`
    : w ? `${name} has a charger fault: ${w}.` : `${name} has a charger fault.`;
  const back = backText(d.until, simClock);
  return back ? `${what} ${back}` : what;
}

/** What the engine does about it, said once wherever a down charger is described. */
export const NO_CARS_SENT = "OTTO-Q sends no car to it.";

/** The status word on a stall's badge: "fault" where the twin says its charger faulted, else the stall's own status. */
export function stallBadge(stall: { status: string; down?: ChargerDown | null }): string {
  return stall.down?.kind === "fault" ? "fault" : stall.status;
}

/** "1 charger down", "3 chargers down". */
export function chargersDownLabel(n: number): string {
  return `${n} ${n === 1 ? "charger" : "chargers"} down`;
}

/** "NASH-DCFC-STALL-02" (type 'dcfc') -> "DCFC-02": the name the depot plan draws, when the renderer has not mapped it. */
export function chargerNameFromCode(code: string | null | undefined, type: string | null | undefined): string | null {
  const prefix = type === "dcfc" ? "DCFC" : type === "l2" ? "L2" : null;
  const n = /(\d+)\s*$/.exec(code ?? "")?.[1];
  if (prefix && n) return `${prefix}-${String(Number(n)).padStart(2, "0")}`;
  return text(code);
}

export interface DownCharger {
  /** the twin's stall id */
  id: string;
  /** what a viewer reads: the renderer's stall name ("DCFC-02") */
  name: string;
  type: "dcfc" | "l2" | null;
  down: ChargerDown;
}

/**
 * Every charger the frame says is down, by name. A faulted stall is a charger by definition (its OCPP charger
 * faulted); an 'offline' stall counts only when the layout says it is a charger (a wash bay offline is not a charger
 * down). `nameOf` is the renderer's own name for a twin stall (TwinMotionDriver.rendererStallFor), so the list names
 * the stall the plan draws; without it the layout code is turned into the same form.
 */
export function chargersDown(
  snap: TwinSnapshot | null | undefined,
  layout: TwinLayout | null | undefined,
  nameOf?: (twinStallId: string) => string | undefined,
): DownCharger[] {
  const byId = new Map((layout?.stalls ?? []).map((s) => [String(s.id), s]));
  const out: DownCharger[] = [];
  for (const ss of snap?.stalls_status ?? []) {
    const down = stallDownOf(ss);
    if (!down) continue;
    const ls = byId.get(String(ss.id));
    const t = String(ls?.type ?? "").toLowerCase();
    const type = t === "dcfc" || t === "l2" ? t : null;
    if (down.kind === "offline" && !type) continue;
    const name = nameOf?.(String(ss.id)) ?? chargerNameFromCode(ls?.code, type) ?? "Charger";
    out.push({ id: String(ss.id), name, type, down });
  }
  // DCFC first, then L2, each in number order: the order the plan reads
  const rank = (c: DownCharger) => (c.type === "dcfc" ? 0 : c.type === "l2" ? 1 : 2);
  return out.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, "en", { numeric: true }));
}
