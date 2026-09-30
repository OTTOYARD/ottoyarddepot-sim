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
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useTwinStore } from "@/store/twinStore";
import { useActivityFeed } from "@/hooks/useActivityFeed";
import { useActivityFeedStore, type ActivityFeedRow } from "@/store/activityFeedStore";
import { useIntelligenceStack } from "@/hooks/useIntelligenceStack";
import { useDepotCards } from "@/hooks/useDepotCards";
import { useDispositions } from "@/hooks/useDispositions";
import { useDecisionTrail } from "@/hooks/useDecisionTrail";
import { StreamState } from "@/components/tabs/TwinDecisionLogTab";
import { FunnelCanvas } from "@/components/tabs/ottoq/FunnelCanvas";
import { TONE_COLOR } from "@/components/tabs/ottoq/funnelGeometry";
import { BAND_H, PAD_Y } from "@/components/tabs/ottoq/funnelGeometry";
import {
  AWAY_STATES, LAYERS, carsFromCards, latestByCar, layerOverviews, sparkFromDisposition, sparkFromRow, stackSlice,
  stateWord, type FunnelCar, type LayerId, type NodeTone, type Spark,
} from "@/lib/ottoqFunnel";
import { buildTrail, type Trail } from "@/lib/decisionTrail";
import { describeDecision, formatClockCT } from "@/lib/decisionText";
import { MISSING, clockCT } from "@/lib/plainWords";

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
function LayerDetail({ layer, cars, recent, overview }: {
  layer: LayerId; cars: FunnelCar[]; recent: { key: string; at: string | null; title: string; detail: string | null; tone: NodeTone }[]; overview: string;
}) {
  const def = LAYERS.find((l) => l.id === layer)!;
  const [picked, setPicked] = useState<string | null>(null);
  const [limit, setLimit] = useState(24);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    setPicked(null); setLimit(24);
    try { ref.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" }); } catch { /* a nicety */ }
  }, [layer]);
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

// ── the tab ──────────────────────────────────────────────────────────────────
export function TwinOttoQTab() {
  const simRunId = useTwinStore((s) => s.activeSimRunId);
  useActivityFeed();
  const { rows, frozen } = useActivityFeedStore();
  const { stack } = useIntelligenceStack(!!simRunId);
  const cards = useDepotCards();
  const disp = useDispositions();
  const [selected, setSelected] = useState<LayerId | null>(null);

  const cardsRead = cards.status === "ok";
  const vehicles = useMemo(() => cards.vehicles ?? [], [cards.vehicles]);
  const latest = useMemo(() => latestByCar(rows), [rows]);
  const cars = useMemo(() => (cardsRead ? carsFromCards(vehicles, latest) : []), [cardsRead, vehicles, latest]);
  const away = cardsRead ? vehicles.filter((v) => AWAY_STATES.has(v.state ?? "")).length : null;

  const overviews = useMemo(
    () => layerOverviews({ vehicles, rows, dispositions: disp.rows, stack: stackSlice(stack), cardsRead }),
    [vehicles, rows, disp.rows, stack, cardsRead],
  );

  // Sparks: only records that ARRIVED while watching. The backlog present at first read seeds the seen set silently,
  // so opening the tab never replays history as if it were happening now.
  const seen = useRef<{ run: string | null; keys: Set<string>; seededFeed: boolean; seededDisp: boolean }>({ run: null, keys: new Set(), seededFeed: false, seededDisp: false });
  if (seen.current.run !== simRunId) seen.current = { run: simRunId, keys: new Set(), seededFeed: false, seededDisp: false };
  const [sparks, setSparks] = useState<Spark[]>([]);
  useEffect(() => {
    const s = seen.current;
    const all: Spark[] = [];
    const feedSparks = rows.map(sparkFromRow).filter((x): x is Spark => !!x);
    const dispSparks = (disp.rows ?? []).map(sparkFromDisposition);
    if (!s.seededFeed && rows.length) { feedSparks.forEach((x) => s.keys.add(x.key)); s.seededFeed = true; }
    if (!s.seededDisp && disp.rows) { dispSparks.forEach((x) => s.keys.add(x.key)); s.seededDisp = true; }
    for (const x of [...feedSparks, ...dispSparks]) if (!s.keys.has(x.key)) { s.keys.add(x.key); all.push(x); }
    if (all.length) {
      all.sort((a, b) => Date.parse(a.at ?? "") - Date.parse(b.at ?? ""));
      setSparks(all.slice(-60));
    }
  }, [rows, disp.rows]);

  const recentFor = useMemo(() => {
    const m = new Map<LayerId, { key: string; at: string | null; title: string; detail: string | null; tone: NodeTone; t: number }[]>();
    const push = (l: LayerId, e: { key: string; at: string | null; title: string; detail: string | null; tone: NodeTone }) =>
      (m.get(l) ?? m.set(l, []).get(l)!).push({ ...e, t: Date.parse(e.at ?? "") || 0 });
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

  if (!simRunId) {
    return (
      <div className="flex-1 p-4">
        <p className="text-[12px] leading-5 text-ink-dim">
          No simulation is active. When a run is going, every car in the depot appears here as a dot moving through
          OTTO-Q's layers, and each decision the engine records flashes along the path it took.
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
            <div className="font-display text-[12px] uppercase tracking-[0.08em] text-ink">How OTTO-Q moves the depot</div>
            <p className="mt-0.5 text-[10px] leading-4 text-ink-faint">
              Each dot is a car. Each flash is a decision the engine just recorded. Tap a layer to look inside.
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <StreamState frozen={frozen} />
            <span className="font-mono text-[9px] text-ink-faint">{cards.simClock ? formatClockCT(cards.simClock) : ""}</span>
          </div>
        </div>

        {cards.status === "other_run" && (
          <p className="rounded border border-white/[0.08] p-2 text-[11px] leading-4 text-ink-dim">
            The depot is not running this run right now, so there are no cars to place. Decisions already recorded for it
            are still listed inside each layer.
          </p>
        )}

        {/* The funnel: drawing on the left, each layer's line on the right, one row per layer. */}
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

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-ink-dim" aria-label="Legend">
          {(["ok", "held", "refused", "idle"] as NodeTone[]).map((t) => (
            <span key={t} className="inline-flex items-center gap-1"><Dot tone={t} /> {TONE_WORD[t]}</span>
          ))}
        </div>
        <p className="text-[10px] leading-4 text-ink-faint">
          {away == null ? "Cars outside the depot: —" : `${away} ${away === 1 ? "car is" : "cars are"} out working and not drawn.`}{" "}
          A car in Ready is green only when its battery has reached its target and nothing it needs is open.
        </p>

        {selected && (
          <LayerDetail layer={selected} cars={carsIn(selected)} overview={overviews[selected]}
            recent={(recentFor.get(selected) ?? []).slice(0, 12)} />
        )}
      </div>
    </ScrollArea>
  );
}

export default TwinOttoQTab;
