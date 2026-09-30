// ============================================================================
// TwinOttoQTab — OTTO-Q itself: every car in the depot moving through the engine's layers, live.
//
// Chase, 2026-09-29: "Maybe for the OTTO-Q, it gives more of an illustrative funnel and layering design and rendering
// in that tab. So it's not just blocks and tiles with data and numbers and clipart symbols. ... it's alive and shows
// movement and maybe nodes moving between each funnel with an overview within each one, maybe you can even see or zoom
// in if needed to each layer, it has either decisions being made or nodes green-lit."
//
// Replaces the Intelligence, Orchestration and Events tabs' picture of the depot (design note:
// docs/OTTO-Q-FUNNEL-AND-AGENT-TABS.md). Shaping: src/lib/ottoqFunnel.ts. Drawing: ./ottoq/FunnelCanvas.tsx.
// Every dot is a car from ottoq_depot_cards; every spark is one engine record that arrived since the last poll.
// ============================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, Play, Square } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useTwinStore } from "@/store/twinStore";
import { useActivityFeed } from "@/hooks/useActivityFeed";
import { useActivityFeedStore, type ActivityFeedRow } from "@/store/activityFeedStore";
import { useIntelligenceStack } from "@/hooks/useIntelligenceStack";
import { useDepotCards } from "@/hooks/useDepotCards";
import { useDispositions } from "@/hooks/useDispositions";
import { useDecisionTrail } from "@/hooks/useDecisionTrail";
import { EndedState, StreamState } from "@/components/tabs/TwinDecisionLogTab";
import { useSimulationStore } from "@/store/simulationStore";
import { useQualityStore } from "@/components/canvas/three/quality/qualityStore";
import { OttoQStack, type PickKind, type StackReplay } from "@/components/tabs/ottoq/stack/OttoQStack";
import {
  PLATES, REPLAY_STEP_S, plateLabels, plateTags, recordKeys, replayEvents, stackModel, takeNewEvents,
  type PlateId, type PlateLabel, type StackEvent,
} from "@/components/tabs/ottoq/stack/stackModel";
import { agentPass, isLiveStatus, namesFromRows, offerBatches, offerLine, tickClocks } from "@/lib/agentStream";
import { FunnelCanvas } from "@/components/tabs/ottoq/FunnelCanvas";
import { TONE_COLOR } from "@/components/tabs/ottoq/funnelGeometry";
import { BAND_H, PAD_Y } from "@/components/tabs/ottoq/funnelGeometry";
import {
  AWAY_STATES, LAYERS, carsFromCards, latestByCar, layerOverviews, sparkFromDisposition, sparkFromRow,
  stackSlice, stateWord, type DispositionRow, type FunnelCar, type LayerId, type NodeTone, type Spark,
} from "@/lib/ottoqFunnel";
import { buildTrail, type Trail } from "@/lib/decisionTrail";
import { decisionKey, describeDecision, formatClockCT, holdText } from "@/lib/decisionText";
import { MISSING, clockCT, ruleWords } from "@/lib/plainWords";

const TONE_WORD: Record<NodeTone, string> = {
  ok: "enacted · cleared",
  held: "held · waiting",
  refused: "refused",
  idle: "no decision yet",
};

const Dot = ({ tone, size = 7 }: { tone: NodeTone; size?: number }) => (
  <span className="inline-block shrink-0 rounded-full" style={{ width: size, height: size, background: TONE_COLOR[tone] }} />
);

// ── one car's trail, opened from a layer ─────────────────────────────────────
function CarTrail({ car }: { car: FunnelCar }) {
  const d = useDecisionTrail(car.id);
  const trail: Trail | null = useMemo(() => {
    if (!d.carRows.length) return null;
    const card = d.cards.find((c) => c.vehicle_id === car.id) ?? d.cardMemory.get(car.id) ?? null;
    return buildTrail({ vehicleId: car.id, name: car.name, rows: d.carRows, decisions: d.decisions, proposals: d.proposals, choices: d.choices, card });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.carRows, d.decisions, d.proposals, d.choices, d.cards, car.id, car.name]);
  if (!trail) {
    return (
      <div className="flex items-center gap-2 px-2 py-2 text-[11px] text-ink-faint">
        {d.error ? "Could not read this car's decisions." : <><Loader2 size={12} className="animate-spin" /> Reading this car's decisions…</>}
      </div>
    );
  }
  return (
    <ol className="px-2 pb-1 pt-1.5" aria-label={`${car.name} decision trail`}>
      {trail.steps.map((s, i) => (
        <li key={`${s.kind}-${s.at}-${i}`} className={`flex gap-2 ${s.branch ? "pl-3" : ""}`}>
          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ background: s.tone === "ok" ? TONE_COLOR.ok : s.tone === "warn" ? TONE_COLOR.held : s.tone === "branch" ? "#7DD3FC" : "rgba(255,255,255,0.25)" }} />
          <div className="min-w-0 flex-1 pb-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[11px] text-ink">{s.title}</span>
              <span className="shrink-0 font-mono text-[9px] text-ink-faint">{s.at ? clockCT(s.at) : MISSING}</span>
            </div>
            {s.detail && <p className="break-words text-[10px] leading-4 text-ink-dim">{s.detail}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

// ── the opened layer ─────────────────────────────────────────────────────────
function LayerDetail({ layer, cars, recent, overview, scroll = true }: {
  layer: LayerId; cars: FunnelCar[]; recent: { key: string; at: string | null; title: string; detail: string | null; tone: NodeTone }[]; overview: string;
  /** Bring the opened layer into view (the flat funnel); off inside a 3D plate, whose zoom is the point of the tap. */
  scroll?: boolean;
}) {
  const def = LAYERS.find((l) => l.id === layer)!;
  const [picked, setPicked] = useState<string | null>(null);
  const [limit, setLimit] = useState(24);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    setPicked(null); setLimit(24);
    if (scroll) try { ref.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" }); } catch { /* a nicety */ }
  }, [layer, scroll]);
  const shown = [...cars].sort((a, b) => toneRank(a.tone) - toneRank(b.tone) || a.name.localeCompare(b.name)).slice(0, limit);

  return (
    <section ref={ref} aria-label={`${def.label} layer`} className="rounded border border-white/[0.08] bg-canvas-panel/70 p-2.5">
      <div className="font-display text-[11px] uppercase tracking-[0.08em] text-ink">{def.label}</div>
      <p className="mt-0.5 text-[11px] leading-4 text-ink-dim">{def.does}</p>
      <p className="mt-1 font-mono text-[10px] text-ink">{overview}</p>

      {def.kind === "place" && (
        <div className="mt-2">
          <div className="text-[10px] text-ink-faint">{cars.length ? `${cars.length} ${cars.length === 1 ? "car" : "cars"} here` : "No car here right now."}</div>
          <ul className="mt-1 space-y-1">
            {shown.map((c) => (
              <li key={c.id} className={`rounded border ${picked === c.id ? "border-brand-red/50" : "border-white/[0.06]"}`}>
                <button type="button" onClick={() => setPicked(picked === c.id ? null : c.id)} aria-expanded={picked === c.id}
                  className="flex w-full items-center gap-2 px-2 py-1.5 text-left">
                  {picked === c.id ? <ChevronDown size={11} className="shrink-0 text-ink-dim" /> : <ChevronRight size={11} className="shrink-0 text-ink-faint" />}
                  <Dot tone={c.tone} />
                  <span className="min-w-0 truncate font-mono text-[11px] text-ink">{c.name}</span>
                  <span className="ml-auto min-w-0 truncate text-right text-[10px] text-ink-dim">
                    {[stateWord(c.state), c.soc != null ? `${Math.round(c.soc)}%` : null].filter(Boolean).join(" · ")}
                  </span>
                </button>
                {c.why && picked !== c.id && <p className="-mt-1 px-2 pb-1.5 pl-[34px] text-[10px] text-ink-faint">{c.why}</p>}
                {picked === c.id && <CarTrail car={c} />}
              </li>
            ))}
          </ul>
          {cars.length > limit && (
            <button type="button" onClick={() => setLimit((n) => n + 24)} className="mt-1 w-full rounded border border-white/10 py-1 text-[10px] text-ink-dim hover:text-ink">
              Show more ({cars.length - limit} more)
            </button>
          )}
        </div>
      )}

      <div className="mt-2">
        <div className="text-[10px] text-ink-faint">Newest decisions in this layer</div>
        {recent.length === 0 ? (
          <p className="mt-0.5 text-[10px] text-ink-faint">None in the last two sim-hours.</p>
        ) : (
          <ul className="mt-1 space-y-1">
            {recent.map((r) => (
              <li key={r.key} className="flex items-start gap-2">
                <span className="mt-1"><Dot tone={r.tone} size={6} /></span>
                <div className="min-w-0 flex-1">
                  <span className="text-[11px] text-ink">{r.title}</span>
                  {r.detail && <span className="text-[10px] text-ink-faint"> · {r.detail}</span>}
                </div>
                <span className="shrink-0 font-mono text-[9px] text-ink-faint">{r.at ? formatClockCT(r.at) : "—"}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

const toneRank = (t: NodeTone) => ({ refused: 0, held: 1, idle: 2, ok: 3 })[t];

/** The layer a feed row's decision belongs to, for the drill-in list. */
function rowLayer(r: ActivityFeedRow): LayerId | null {
  const s = sparkFromRow(r);
  if (!s) return null;
  if (s.tone === "refused") return "shield";
  if (r.action === "orchestrator_agent") return "proposers";
  if (s.from === "ready") return "ready";
  if (s.from === "needs" || s.from === "arriving") return s.from;
  return "decide";
}

// ── plates: what a tapped plate opens ──────────────────────────────────────
type Recent = { key: string; at: string | null; title: string; detail: string | null; tone: NodeTone };

function RecentList({ items, empty }: { items: Recent[]; empty: string }) {
  if (!items.length) return <p className="mt-0.5 text-[10px] text-ink-faint">{empty}</p>;
  return (
    <ul className="mt-1 space-y-1">
      {items.map((r) => (
        <li key={r.key} className="flex items-start gap-2">
          <span className="mt-1"><Dot tone={r.tone} size={6} /></span>
          <div className="min-w-0 flex-1">
            <span className="text-[11px] text-ink">{r.title}</span>
            {r.detail && <span className="text-[10px] text-ink-faint"> · {r.detail}</span>}
          </div>
          <span className="shrink-0 font-mono text-[9px] text-ink-faint">{r.at ? formatClockCT(r.at) : "—"}</span>
        </li>
      ))}
    </ul>
  );
}

const DEPOT_ZONES: { layer: LayerId; label: string }[] = [
  { layer: "arriving", label: "Arriving" },
  { layer: "needs", label: "Waiting" },
  { layer: "booked", label: "Booked" },
  { layer: "service", label: "Service" },
  { layer: "ready", label: "Ready" },
];

function PlateDetail({ plate, rows, dispositions, names, recentFor, cars, overviews, shield, onAgentTab }: {
  plate: PlateId;
  rows: ActivityFeedRow[];
  dispositions: DispositionRow[] | null;
  names: Map<string, string>;
  recentFor: Map<LayerId, (Recent & { t: number })[]>;
  cars: FunnelCar[];
  overviews: Record<LayerId, string>;
  shield: { evaluations: number | null; refused: number | null; recordedOnly: number | null } | null;
  onAgentTab: () => void;
}) {
  const def = PLATES.find((p) => p.id === plate)!;
  const ref = useRef<HTMLElement>(null);
  // No scroll here: the plate's zoom in the stack above is the point of tapping it; the detail waits below.
  const [zone, setZone] = useState<LayerId>(() => DEPOT_ZONES.find((z) => cars.some((c) => c.layer === z.layer))?.layer ?? "arriving");

  const passes = useMemo(() => rows.filter((r) => r.action === "orchestrator_agent").map(agentPass).sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 6), [rows]);
  const batches = useMemo(() => offerBatches(dispositions ?? [], names, tickClocks(rows)), [dispositions, names, rows]);
  const loud = batches.filter((b) => !b.quiet).slice(0, 8);
  const n = (x: number | null | undefined) => (x == null ? "—" : x.toLocaleString("en-US"));

  return (
    <section ref={ref} aria-label={`${def.label} plate`} className="rounded border border-white/[0.08] bg-canvas-panel/70 p-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <div className="font-display text-[11px] uppercase tracking-[0.08em] text-ink">{def.label}</div>
        <div className="text-[10px] text-ink-faint">{def.tagline}</div>
      </div>

      {plate === "agent" && (
        <>
          <p className="mt-0.5 text-[11px] leading-4 text-ink-dim">
            Each chrome sphere is one pass of the agent; the pearl it joins is the objective it chose. It reads the whole
            depot (the scan that rises through the stack) and proposes; it never decides. Amber: the model did not answer
            and the deterministic path kept the objective.
          </p>
          <p className="mt-1 font-mono text-[10px] text-ink">{overviews.proposers.split(" · offers")[0]}</p>
          {passes.length === 0 ? <p className="mt-1 text-[10px] text-ink-faint">No agent pass in the last two sim-hours.</p> : (
            <ul className="mt-1.5 space-y-1.5">
              {passes.map((p) => (
                <li key={p.key} className="flex items-start gap-2">
                  <span className="mt-1"><Dot tone={p.tone === "ok" ? "ok" : "held"} size={6} /></span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] text-ink">{p.headline}</div>
                    <div className="text-[10px] leading-4 text-ink-dim">{[p.chose, ...p.outcome.slice(0, 2)].join(" ")}</div>
                  </div>
                  <span className="shrink-0 font-mono text-[9px] text-ink-faint">{formatClockCT(p.at)}</span>
                </li>
              ))}
            </ul>
          )}
          <button type="button" onClick={onAgentTab} className="mt-2 w-full rounded border border-white/10 py-1.5 text-[11px] text-ink-dim hover:text-ink">
            Everything it read and asked for, on the Agent tab
          </button>
        </>
      )}

      {plate === "planners" && (
        <>
          <p className="mt-0.5 text-[11px] leading-4 text-ink-dim">
            Each bar is one offer from a planner, newest on the left of its lane. Green: the decide path enacted it. Red: it
            refused it. Silver: a newer offer replaced it or it expired. A thin dark bar: the planner made no offer for that
            car. Planners propose; they never place a car.
          </p>
          <p className="mt-1 font-mono text-[10px] text-ink">{overviews.proposers.split(" · ").slice(-1)[0]}</p>
          {loud.length === 0 ? <p className="mt-1 text-[10px] text-ink-faint">No offer was enacted or refused in what has been read.</p> : (
            <ul className="mt-1.5 space-y-1">
              {loud.map((b) => (
                <li key={b.key} className="flex items-start gap-2">
                  <span className="mt-1"><Dot tone={b.tone === "ok" ? "ok" : b.tone === "refused" ? "refused" : "idle"} size={6} /></span>
                  <span className="min-w-0 flex-1 text-[11px] leading-4 text-ink">{b.headline}</span>
                  <span className="shrink-0 font-mono text-[9px] text-ink-faint">{b.at ? formatClockCT(b.at) : b.tick != null ? `tick ${b.tick}` : "—"}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {plate === "decide" && (
        <>
          <p className="mt-0.5 text-[11px] leading-4 text-ink-dim">
            Each tile is one decision the deterministic decide path made for a car, newest at the front: it takes one of the
            planners' offers, or makes its own choice, or holds the car when nothing fits. Green: enacted. Amber: held.
            Every enacted choice then drops through the safety plate below before the depot carries it out.
          </p>
          <div className="mt-2 text-[10px] text-ink-faint">Newest decisions</div>
          <RecentList
            items={[...(recentFor.get("decide") ?? []), ...(recentFor.get("ready") ?? [])].sort((a, b) => b.t - a.t).slice(0, 12)}
            empty="None in the last two sim-hours." />
        </>
      )}

      {plate === "safety" && (
        <>
          <p className="mt-0.5 text-[11px] leading-4 text-ink-dim">
            The last gate before anything happens in the depot. Every choice the decide path makes is checked against the
            enforced rules as it is enacted (for example: no car leaves below its charge target or with a service still
            open). A choice that breaks one is overridden to a safe default: its light stops on this plate, a red block
            marks it, and the rim flares.
          </p>
          <p className="mt-1 text-[11px] leading-4 text-ink">
            {shield && shield.evaluations != null
              ? `The check has run ${n(shield.evaluations)} times this run and blocked ${n(shield.refused)} choices.${shield.recordedOnly ? ` ${n(shield.recordedOnly)} advisory notes were recorded; those are notes, not blocks.` : ""}`
              : "Safety check counts: —"}
          </p>
          <div className="mt-2 text-[10px] text-ink-faint">Newest blocks</div>
          <RecentList items={(recentFor.get("shield") ?? []).slice(0, 12)} empty="Nothing blocked in the last two sim-hours." />
        </>
      )}

      {plate === "depot" && (
        <>
          <p className="mt-0.5 text-[11px] leading-4 text-ink-dim">
            Each puck is a car, in the part of the site its state puts it: cars come in by the east gate, wait for a plan,
            charge or go to a bay, and leave ready by the west gate. The DCFC, L2, wash and service sockets are the site's
            real stalls.
          </p>
          <div role="tablist" className="mt-2 flex flex-wrap gap-1">
            {DEPOT_ZONES.map((z) => {
              const count = cars.filter((c) => c.layer === z.layer).length;
              return (
                <button key={z.layer} type="button" role="tab" aria-selected={zone === z.layer} onClick={() => setZone(z.layer)}
                  className={`rounded-full border px-2 py-0.5 text-[10px] ${zone === z.layer ? "border-brand-red/60 bg-brand-red/10 text-ink" : "border-white/10 text-ink-dim"}`}>
                  {z.label} <span className="font-mono">{count}</span>
                </button>
              );
            })}
          </div>
          <div className="mt-2">
            <LayerDetail layer={zone} cars={cars.filter((c) => c.layer === zone)} overview={overviews[zone]}
              recent={(recentFor.get(zone) ?? []).slice(0, 8)} scroll={false} />
          </div>
        </>
      )}
    </section>
  );
}

// ── one record, tapped in the stack ─────────────────────────────────────────
type Picked = { kind: PickKind; key: string };
const PLATE_OF: Record<PickKind, PlateId> = { pass: "agent", offer: "planners", decision: "decide", car: "depot", objective: "agent" };

function PickedCard({ picked, onClose, onPick, rowByKey, dispByKey, passByKey, cars, names, clocks }: {
  picked: Picked;
  onClose: () => void;
  onPick: (p: Picked) => void;
  rowByKey: Map<string, ActivityFeedRow>;
  dispByKey: Map<string, DispositionRow>;
  passByKey: Map<string, ReturnType<typeof agentPass>>;
  cars: FunnelCar[];
  names: Map<string, string>;
  clocks: Map<number, string>;
}) {
  const carButton = (id: string | null | undefined) => {
    if (!id) return null;
    const car = cars.find((c) => c.id === id);
    return car ? (
      <button type="button" onClick={() => onPick({ kind: "car", key: id })} className="mt-1.5 text-[10px] text-brand-hot hover:underline">
        Open {car.name}'s trail
      </button>
    ) : null;
  };
  let body: React.ReactNode = <p className="text-[11px] text-ink-faint">This record is no longer in what was read.</p>;
  let title = "";
  let at: string | null = null;
  if (picked.kind === "pass") {
    const p = passByKey.get(picked.key);
    if (p) {
      title = p.headline; at = p.at;
      body = (
        <>
          {p.read && <p className="text-[11px] leading-4 text-ink-dim"><span className="text-ink-faint">What it read: </span>{p.read}</p>}
          {p.directives.length > 0 && (
            <ul className="mt-1 space-y-1">{p.directives.map((d, i) => <li key={i} className="border-l border-violet-400/30 pl-2 text-[11px] leading-4 text-ink-dim">{d}</li>)}</ul>
          )}
          <p className="mt-1 text-[11px] leading-4 text-ink">{p.chose}</p>
          {p.outcome.length > 0 && <p className="mt-0.5 text-[11px] leading-4 text-ink-dim">{p.outcome.join(" ")}</p>}
        </>
      );
    }
  } else if (picked.kind === "offer") {
    const d = dispByKey.get(picked.key);
    if (d) {
      const line = offerLine(d, names);
      title = line.text; at = d.disposed_tick != null ? clocks.get(d.disposed_tick) ?? null : null;
      body = (
        <>
          <p className="text-[11px] leading-4 text-ink-dim">
            A planner's offer is a proposal for one car. The decide path disposes of every offer; planners never place a car.
            {d.disposed_tick != null ? ` Disposed on tick ${d.disposed_tick}.` : ""}
          </p>
          {carButton(d.entity_id)}
        </>
      );
    }
  } else if (picked.kind === "decision") {
    const r = rowByKey.get(picked.key);
    if (r) {
      const d = describeDecision(r);
      const who = r.display_name || "A car";
      title = `${who}: ${d.title}`; at = r.occurred_at;
      const codes = Array.isArray(r.rationale?.override_rule_codes) ? ruleWords(r.rationale!.override_rule_codes as string[]) : "";
      const hold = holdText(r);
      body = (
        <>
          {d.detail && <p className="text-[11px] leading-4 text-ink-dim">{d.detail}</p>}
          {r.outcome === "overridden_to_default" && (
            <p className="mt-1 text-[11px] leading-4 text-red-300">
              The safety check overrode this choice to a safe default{codes ? `: ${codes}` : ""}.
            </p>
          )}
          {hold && <p className="mt-1 text-[10px] text-ink-faint">{hold[0].toUpperCase() + hold.slice(1)}.</p>}
          {carButton(r.vehicle_id)}
        </>
      );
    }
  } else if (picked.kind === "car") {
    const car = cars.find((c) => c.id === picked.key);
    if (car) {
      title = `${car.name} · ${stateWord(car.state)}`;
      body = (
        <>
          <p className="text-[11px] leading-4 text-ink-dim">
            {[car.soc != null ? `Battery ${Math.round(car.soc)}%${car.targetSoc != null ? ` of its ${Math.round(car.targetSoc)}% target` : ""}` : "Battery not reported",
              car.why && !/battery/i.test(car.why) ? car.why[0].toUpperCase() + car.why.slice(1) : null].filter(Boolean).join(". ")}.
          </p>
          <div className="mt-1 rounded border border-white/[0.06]"><CarTrail car={car} /></div>
        </>
      );
    }
  }
  return (
    <section aria-label="Picked record" className="rounded border border-brand-red/40 bg-canvas-elev p-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[9px] uppercase tracking-[0.08em] text-ink-faint">{({ pass: "Agent pass", offer: "Planner offer", decision: "Decision", car: "Car" } as const)[picked.kind]}</div>
          <div className="text-[12px] font-medium leading-4 text-ink">{title || "—"}</div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="font-mono text-[9px] text-ink-faint">{at ? formatClockCT(at) : ""}</span>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded px-1 text-[12px] text-ink-dim hover:text-ink">×</button>
        </div>
      </div>
      <div className="mt-1.5">{body}</div>
    </section>
  );
}

// ── replay: records already written, played through the stack again when asked ──
function ReplayBar({ replay, at, count, line, onStart, onStop }: {
  replay: StackReplay | null; at: number; count: number; line: string | null; onStart: () => void; onStop: () => void;
}) {
  const btn = "inline-flex shrink-0 items-center gap-1.5 rounded border px-2 py-[3px] font-display text-[10px] uppercase tracking-[0.07em]";
  if (!replay) {
    return (
      <div className="flex h-[30px] items-center gap-2" data-replay-bar>
        <button type="button" onClick={onStart} disabled={!count} aria-label="Replay the newest records"
          className={`${btn} border-white/15 text-ink hover:border-brand-hot/60 hover:text-brand-hot disabled:opacity-40`}>
          <Play aria-hidden size={9} fill="currentColor" strokeWidth={0} /> Replay
        </button>
        <span className="min-w-0 truncate text-[10px] text-ink-faint">
          {count ? `the newest ${count} records, in the order they were written` : "nothing to replay yet"}
        </span>
      </div>
    );
  }
  const n = replay.events.length;
  const k = Math.max(0, Math.min(n - 1, at));
  return (
    <div className="h-[30px]" role="status" aria-live="off" data-replay-bar>
      <div className="flex items-center gap-2">
        <button type="button" onClick={onStop} aria-label="Stop the replay" className={`${btn} border-brand-hot/60 text-brand-hot`}>
          <Square aria-hidden size={8} fill="currentColor" strokeWidth={0} /> Stop
        </button>
        <span className="shrink-0 font-mono text-[10px] text-brand-hot">REPLAY {at < 0 ? "…" : `${k + 1} of ${n}`}</span>
        <span className="min-w-0 truncate text-[10px] text-ink-dim">{at < 0 || !line ? "records already written, played again, not live" : line}</span>
      </div>
      <div className="mt-1 h-px w-full bg-white/10">
        <div className="h-px bg-brand-hot" style={{ width: `${at < 0 ? 0 : ((k + 1) / n) * 100}%` }} />
      </div>
    </div>
  );
}

/** WebGL once per page: the stack needs it; without it the flat funnel stands in. */
let webglOk: boolean | null = null;
function hasWebGL(): boolean {
  if (webglOk != null) return webglOk;
  try {
    const c = document.createElement("canvas");
    const gl = (c.getContext("webgl2") ?? c.getContext("webgl")) as WebGLRenderingContext | null;
    webglOk = !!gl;
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch { webglOk = false; }
  return webglOk;
}
function prefersReducedMotion(): boolean {
  try { return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false; } catch { return false; }
}

// ── the tab ──────────────────────────────────────────────────────────────────
export function TwinOttoQTab() {
  const simRunId = useTwinStore((s) => s.activeSimRunId);
  // Running (not paused, not ended): the stack pulses while it is.
  const running = useTwinStore((s) => {
    const r = s.snapshot?.run;
    return !!r && r.sim_run_id === s.activeSimRunId && (r.status === "running" || r.status === "active");
  });
  const setActiveTab = useSimulationStore((s) => s.setActiveTab);
  const tier = useQualityStore((s) => s.tier);
  useActivityFeed();
  const { rows, frozen } = useActivityFeedStore();
  const { stack } = useIntelligenceStack(!!simRunId);
  const cards = useDepotCards();
  const disp = useDispositions();
  const [selected, setSelected] = useState<LayerId | null>(null);
  const [focus, setFocus] = useState<PlateId | null>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [threeD] = useState(hasWebGL);
  const [reduced] = useState(prefersReducedMotion);

  const cardsRead = cards.status === "ok";
  const vehicles = useMemo(() => cards.vehicles ?? [], [cards.vehicles]);
  const latest = useMemo(() => latestByCar(rows), [rows]);
  const cars = useMemo(() => (cardsRead ? carsFromCards(vehicles, latest) : []), [cardsRead, vehicles, latest]);
  const away = cardsRead ? vehicles.filter((v) => AWAY_STATES.has(v.state ?? "")).length : null;
  const slice = useMemo(() => stackSlice(stack), [stack]);
  const names = useMemo(() => namesFromRows(rows), [rows]);
  // Lookups for a record under the pointer or tapped: the stack's objects are keyed by their records.
  const rowByKey = useMemo(() => new Map(rows.map((r) => [decisionKey(r), r] as const)), [rows]);
  const dispByKey = useMemo(() => new Map<string, DispositionRow>((disp.rows ?? []).map((d) => [`p${d.disposition_id}`, d])), [disp.rows]);
  const passByKey = useMemo(() => new Map(rows.filter((r) => r.action === "orchestrator_agent").map((r) => { const p = agentPass(r); return [p.key, p] as const; })), [rows]);
  const clocks = useMemo(() => tickClocks(rows), [rows]);

  const overviews = useMemo(
    () => layerOverviews({ vehicles, rows, dispositions: disp.rows, stack: slice, cardsRead }),
    [vehicles, rows, disp.rows, slice, cardsRead],
  );

  // The stack: every object is a record; `events` are the records that ARRIVED while watching. The backlog present at
  // the first read seeds the seen set silently, so opening the tab never replays history as if it were happening now.
  const tones = useMemo(() => new Map(cars.map((c) => [c.id, c.tone] as const)), [cars]);
  const model = useMemo(() => stackModel(cardsRead ? vehicles : [], tones, rows, disp.rows, cardsRead), [cardsRead, vehicles, tones, rows, disp.rows]);
  const seen = useRef<{ run: string | null; keys: Set<string>; seededFeed: boolean; seededDisp: boolean }>({ run: null, keys: new Set(), seededFeed: false, seededDisp: false });
  if (seen.current.run !== simRunId) seen.current = { run: simRunId, keys: new Set(), seededFeed: false, seededDisp: false };
  const [events, setEvents] = useState<StackEvent[]>([]);
  const [sparks, setSparks] = useState<Spark[]>([]);
  useEffect(() => {
    const s = seen.current;
    if (!s.seededFeed && rows.length) { recordKeys(rows, null).forEach((k) => s.keys.add(k)); s.seededFeed = true; }
    if (!s.seededDisp && disp.rows) { recordKeys([], disp.rows).forEach((k) => s.keys.add(k)); s.seededDisp = true; }
    const fresh = takeNewEvents(s.keys, rows, disp.rows);
    if (!fresh.length) return;
    setEvents((prev) => [...prev, ...fresh].slice(-120));
    // the flat funnel's sparks, for a browser without WebGL
    const keys = new Set(fresh.map((e) => e.key));
    const sp = [...rows.map(sparkFromRow).filter((x): x is Spark => !!x), ...(disp.rows ?? []).map(sparkFromDisposition)].filter((x) => keys.has(x.key));
    if (sp.length) setSparks(sp.slice(-60));
  }, [rows, disp.rows]);

  const recentFor = useMemo(() => {
    const m = new Map<LayerId, (Recent & { t: number })[]>();
    const push = (l: LayerId, e: Recent) => (m.get(l) ?? m.set(l, []).get(l)!).push({ ...e, t: Date.parse(e.at ?? "") || 0 });
    for (const r of rows) {
      const l = rowLayer(r);
      if (!l) continue;
      const s = sparkFromRow(r)!;
      const d = describeDecision(r);
      const who = r.action === "orchestrator_agent" ? "Agent" : r.display_name || null;
      push(l, { key: s.key, at: r.occurred_at, title: who ? `${who}: ${d.title}` : d.title, detail: d.detail, tone: s.tone });
    }
    for (const d of disp.rows ?? []) {
      const s = sparkFromDisposition(d);
      push("proposers", { key: s.key, at: d.disposed_at, title: s.label, detail: d.disposition_reason ? d.disposition_reason.replace(/_/g, " ") : null, tone: s.tone });
    }
    for (const list of m.values()) list.sort((a, b) => b.t - a.t);
    return m;
  }, [rows, disp.rows]);

  const carById = useMemo(() => new Map(cars.map((c) => [c.id, c] as const)), [cars]);
  const describe = useCallback((kind: PickKind, key: string): string | null => {
    if (kind === "car") {
      const c = carById.get(key);
      return c ? [c.name, stateWord(c.state), c.soc != null ? `${Math.round(c.soc)}%` : null].filter(Boolean).join(" · ") : null;
    }
    if (kind === "decision") {
      const r = rowByKey.get(key);
      return r ? `${r.display_name || "A car"}: ${describeDecision(r).title} · ${formatClockCT(r.occurred_at)}` : null;
    }
    if (kind === "offer") {
      const d = dispByKey.get(key);
      return d ? offerLine(d, names).text : null;
    }
    const p = passByKey.get(key);
    return p ? `${p.headline} · ${formatClockCT(p.at)}` : null;
  }, [carById, rowByKey, dispByKey, passByKey, names]);
  const onPick = useCallback((kind: PickKind, key: string) => {
    setPicked({ kind, key });
    setFocus(PLATE_OF[kind]);
  }, []);
  const onFocusPlate = useCallback((p: PlateId | null) => {
    setFocus(p);
    if (!p) setPicked(null);
  }, []);

  const labels = useMemo<Record<PlateId, PlateLabel>>(
    () => plateLabels({ rows, dispositions: disp.rows, stack: slice, cars: cardsRead ? cars : null }),
    [disp.rows, slice, rows, cardsRead, cars],
  );

  const tags = useMemo(() => plateTags(model, slice?.shield ?? null), [model, slice]);

  // A replay: the newest records on the plates, played again only when asked, and labelled REPLAY while it plays.
  const [replay, setReplay] = useState<StackReplay | null>(null);
  const [replayAt, setReplayAt] = useState(-1);
  const replayable = useMemo(() => (threeD ? replayEvents(model, rows, disp.rows) : []), [threeD, model, rows, disp.rows]);
  const startReplay = useCallback(() => {
    if (!replayable.length) return;
    setReplayAt(-1);
    setReplay({ id: Date.now(), t0: performance.now() / 1000 + 0.4, step: REPLAY_STEP_S, events: replayable });
  }, [replayable]);
  useEffect(() => {
    if (!replay) return;
    const tick = () => {
      const k = Math.floor((performance.now() / 1000 - replay.t0) / replay.step);
      if (k >= replay.events.length + 3) { setReplay(null); setReplayAt(-1); return; }
      setReplayAt(Math.min(replay.events.length - 1, k));
    };
    tick();
    const iv = window.setInterval(tick, 150);
    return () => window.clearInterval(iv);
  }, [replay]);
  useEffect(() => { setReplay(null); setReplayAt(-1); }, [simRunId]);
  const playing = replay && replayAt >= 0 ? replay.events[Math.min(replayAt, replay.events.length - 1)] : null;
  const replayLine = playing ? describe(playing.kind, playing.key) : null;

  if (!simRunId) {
    return (
      <div className="flex-1 p-4">
        <p className="text-[12px] leading-5 text-ink-dim">
          No simulation is active. When a run is going, OTTO-Q appears here as a stack of layers: every car in the depot,
          every decision and every offer is an object on it, and each new record falls through the stack as it happens.
        </p>
      </div>
    );
  }

  const carsIn = (id: LayerId) => cars.filter((c) => c.layer === id);

  return (
    <ScrollArea className="flex-1">
      <div className="space-y-2.5 p-3 font-ui">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="bg-gradient-to-b from-white via-[#c9ccd3] to-[#6c707a] bg-clip-text font-display text-[22px] font-bold uppercase leading-none tracking-[0.04em] text-transparent">
              OTTO-Q
            </div>
            <p className="mt-1 text-[10px] leading-4 text-ink-faint">
              {threeD
                ? "Every object is a real record. Each new one falls through the stack as the engine writes it. Drag sideways to turn it; tap a plate to open it."
                : "Each dot is a car. Each flash is a decision the engine just recorded. Tap a layer to look inside."}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            {stack?.run?.status && !isLiveStatus(stack.run.status) ? <EndedState /> : <StreamState frozen={frozen} />}
            <span className="font-mono text-[9px] text-ink-faint">{cards.simClock ? formatClockCT(cards.simClock) : ""}</span>
          </div>
        </div>

        {cards.status === "other_run" && (
          <p className="rounded border border-white/[0.08] p-2 text-[11px] leading-4 text-ink-dim">
            The depot is not running this run right now, so there are no cars to place. Decisions already recorded for it
            are still on the stack.
          </p>
        )}

        {threeD && (
          <ReplayBar replay={replay} at={replayAt} count={replayable.length} line={replayLine}
            onStart={startReplay} onStop={() => { setReplay(null); setReplayAt(-1); }} />
        )}
        {threeD ? (
          /* capped, so the labels keep near their plates when the panel is expanded to full width */
          <div className="mx-auto w-full max-w-[760px]">
          <OttoQStack model={model} events={events} focus={focus} onFocus={onFocusPlate} labels={labels} tags={tags}
            height={520} tier={tier} reduced={reduced} describe={describe} onPick={onPick} picked={picked} replay={replay} live={running} />
          </div>
        ) : (
          /* No WebGL: the flat funnel, one row per layer. */
          <div className="flex gap-2">
            <div className="w-[52%] shrink-0">
              <FunnelCanvas cars={cars} sparks={sparks} selected={selected} />
            </div>
            <ol className="min-w-0 flex-1" style={{ paddingTop: PAD_Y }} aria-label="OTTO-Q layers">
              {LAYERS.map((l) => {
                const on = selected === l.id;
                const count = l.kind === "place" && cardsRead ? carsIn(l.id).length : null;
                return (
                  <li key={l.id} style={{ height: BAND_H }}>
                    <button type="button" onClick={() => setSelected(on ? null : l.id)} aria-expanded={on}
                      className={`flex h-full w-full flex-col justify-center rounded px-1.5 text-left transition-colors ${on ? "bg-brand-red/10" : "hover:bg-white/[0.03]"}`}>
                      <span className="flex items-baseline gap-1.5">
                        <span className={`font-display text-[10px] uppercase tracking-[0.06em] ${l.kind === "think" ? "text-violet-300" : "text-ink"}`}>{l.label}</span>
                        {count != null && <span className="font-mono text-[10px] text-ink-dim">{count}</span>}
                      </span>
                      <span className="line-clamp-3 break-words text-[10px] leading-[13px] text-ink-dim">{overviews[l.id]}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-ink-dim" aria-label="Legend">
          {(["ok", "held", "refused", "idle"] as NodeTone[]).map((t) => (
            <span key={t} className="inline-flex items-center gap-1"><Dot tone={t} /> {TONE_WORD[t]}</span>
          ))}
        </div>
        <p className="text-[10px] leading-4 text-ink-faint">
          {away == null ? "Cars outside the depot: —" : `${away} ${away === 1 ? "car is" : "cars are"} out working and not drawn.`}{" "}
          A car in Ready is green only when its battery has reached its target and nothing it needs is open.
        </p>

        {threeD && picked && (
          <PickedCard picked={picked} onClose={() => setPicked(null)} onPick={(p) => onPick(p.kind, p.key)}
            rowByKey={rowByKey} dispByKey={dispByKey} passByKey={passByKey} cars={cars} names={names} clocks={clocks} />
        )}
        {threeD && focus && (
          <PlateDetail plate={focus} rows={rows} dispositions={disp.rows} names={names} recentFor={recentFor} cars={cars}
            overviews={overviews} shield={slice?.shield ?? null} onAgentTab={() => setActiveTab("agent")} />
        )}
        {!threeD && selected && (
          <LayerDetail layer={selected} cars={carsIn(selected)} overview={overviews[selected]}
            recent={(recentFor.get(selected) ?? []).slice(0, 12)} />
        )}
      </div>
    </ScrollArea>
  );
}

export default TwinOttoQTab;
