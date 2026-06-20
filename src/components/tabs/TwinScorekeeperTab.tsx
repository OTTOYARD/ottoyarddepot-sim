// ============================================================================
// TwinScorekeeperTab — the OTTO-Q vs archaic/naive ops proof, live in the cockpit.
// Runs a CRN A/B on the isolated benchmark depot via the ottoq-benchmark-run edge fn
// (same world, same seed, swap only the brain) and renders the result two ways:
//   1) Scoreboard — throughput/hr, vehicles turned around, gate backlog, unsafe deploys.
//   2) Race — per-tick replay of the timeline: manual chokes at its monitoring cap while
//      arrivals pile at the gate; OTTO-Q flushes the queue through to deployment.
// Headline: ~13x the throughput of manual ops AND zero unsafe deploys where FIFO ships them.
// Data: ottoq-benchmark-run returns { scoreboard (ab_runs), timeline (per-policy frames) }.
// ============================================================================
import { useState, useRef, useEffect, useMemo } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";

type Policy = "otto_q" | "manual" | "fifo" | "greedy";

const META: Record<Policy, { name: string; role: string; accent: string }> = {
  otto_q: { name: "OTTO-Q", role: "52-rule shield + cuOpt orchestration", accent: "#00B4A6" },
  manual: { name: "Manual ops", role: "Archaic · human-monitored (~25 cap)", accent: "#F59E0B" },
  fifo: { name: "FIFO", role: "First-in-first-out · no safety brain", accent: "#C8102E" },
  greedy: { name: "Greedy", role: "Grab-nearest · no safety brain", accent: "#E8893F" },
};
const RUN_POLICIES: Policy[] = ["manual", "fifo", "otto_q"];

interface ScoreRow {
  policy: Policy;
  vehicles_turned_around: number;
  throughput_per_hr: number;
  gate_backlog: number;
  unsafe_deploys: number;
  fleet_ready_pct: number;
}
interface Frame { tick: number; gate: number; charging: number; servicing: number; ready: number; deployed: number; turned_around: number; }

const num = (v: unknown): number => (typeof v === "number" ? v : Number(v) || 0);

const Seg = ({ pct, color, title }: { pct: number; color: string; title: string }) => (
  <div className="h-full transition-all duration-300" style={{ width: `${pct}%`, background: color }} title={title} />
);

export const TwinScorekeeperTab = () => {
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [scoreboard, setScoreboard] = useState<ScoreRow[]>([]);
  const [timeline, setTimeline] = useState<Record<string, Frame[]>>({});
  const [maxTick, setMaxTick] = useState(0);
  const [playTick, setPlayTick] = useState(0);
  const playRef = useRef<number | undefined>(undefined);

  const run = async () => {
    setRunning(true); setErr(null); setScoreboard([]); setTimeline({}); setMaxTick(0); setPlayTick(0);
    if (playRef.current) window.clearInterval(playRef.current);
    try {
      const { data, error } = await supabase.functions.invoke("ottoq-benchmark-run", {
        body: { policies: RUN_POLICIES, ticks: 16, async: false },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const tl: Record<string, Frame[]> = data.timeline || {};
      setScoreboard((data.scoreboard || []).map((r: any) => ({
        policy: r.policy, vehicles_turned_around: num(r.vehicles_turned_around), throughput_per_hr: num(r.throughput_per_hr),
        gate_backlog: num(r.gate_backlog), unsafe_deploys: num(r.unsafe_deploys), fleet_ready_pct: num(r.fleet_ready_pct),
      })));
      setTimeline(tl);
      setMaxTick(Math.max(0, ...Object.values(tl).map((a) => a.length)));
    } catch (e: any) {
      setErr(e?.message || "run failed");
    } finally {
      setRunning(false);
    }
  };

  // auto-play the replay once a timeline loads
  useEffect(() => {
    if (!maxTick) return;
    if (playRef.current) window.clearInterval(playRef.current);
    let t = 1; setPlayTick(1);
    playRef.current = window.setInterval(() => {
      t += 1;
      if (t > maxTick) { if (playRef.current) window.clearInterval(playRef.current); return; }
      setPlayTick(t);
    }, 380);
    return () => { if (playRef.current) window.clearInterval(playRef.current); };
  }, [maxTick]);

  const scoreByPolicy = useMemo(() => {
    const m = new Map<string, ScoreRow>();
    for (const r of scoreboard) m.set(r.policy, r);
    return m;
  }, [scoreboard]);

  const frameAt = (pol: Policy): Frame | null => {
    const arr = timeline[pol]; if (!arr || !arr.length) return null;
    return arr[Math.min(playTick, arr.length) - 1] ?? arr[arr.length - 1];
  };

  const ottoThru = num(scoreByPolicy.get("otto_q")?.throughput_per_hr);
  const manualThru = num(scoreByPolicy.get("manual")?.throughput_per_hr);
  const advantage = manualThru > 0 ? (ottoThru / manualThru) : 0;

  return (
    <ScrollArea className="flex-1">
      <div className="p-4 space-y-4">
        <div>
          <h2 className="text-sm font-display uppercase tracking-[0.08em] text-ink">Scorekeeper — OTTO-Q vs the field</h2>
          <p className="text-[11px] text-ink-faint mt-1 leading-relaxed">
            Same depot, same arrivals, same seed (CRN) on the isolated benchmark twin. Only the brain changes.
            Manual ops can monitor ~25 vehicles at once; FIFO has no safety shield; OTTO-Q orchestrates the whole site.
          </p>
        </div>

        <button
          onClick={run}
          disabled={running}
          className="w-full py-2.5 rounded-md font-display uppercase tracking-[0.06em] text-xs transition-colors disabled:opacity-50"
          style={{ background: running ? "#1a1d23" : "#C8102E", color: "#fff" }}
        >
          {running ? "Running 3-policy comparison on the twin…" : "Run comparison"}
        </button>
        {err && <div className="text-[11px] text-brand-red">{err}</div>}

        {advantage > 0 && (
          <div className="rounded-md border border-white/[0.06] bg-canvas-panel p-3 text-center">
            <div className="text-[10px] text-ink-faint uppercase tracking-wide">OTTO-Q throughput advantage vs manual</div>
            <div className="text-2xl font-display tabular-nums" style={{ color: "#00B4A6" }}>{advantage.toFixed(1)}×</div>
            <div className="text-[10px] text-ink-faint">{ottoThru.toFixed(1)} vs {manualThru.toFixed(1)} vehicles/hr · same world</div>
          </div>
        )}

        {/* Scoreboard */}
        {scoreboard.length > 0 && (
          <div className="space-y-2">
            {RUN_POLICIES.map((pol) => {
              const s = scoreByPolicy.get(pol); if (!s) return null;
              const m = META[pol]; const isHero = pol === "otto_q";
              return (
                <div key={pol} className="rounded-md border p-3" style={{ borderColor: isHero ? "rgba(0,180,166,0.4)" : "rgba(255,255,255,0.06)", background: isHero ? "rgba(0,180,166,0.05)" : "transparent" }}>
                  <div className="flex justify-between items-baseline">
                    <div>
                      <span className="text-xs font-display" style={{ color: m.accent }}>{m.name}</span>
                      <span className="text-[10px] text-ink-faint ml-2">{m.role}</span>
                    </div>
                    <span className="text-sm font-display tabular-nums text-ink">{s.throughput_per_hr.toFixed(1)}/hr</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 mt-2 text-center">
                    <div><div className="text-sm font-display tabular-nums text-ink">{s.vehicles_turned_around}</div><div className="text-[9px] text-ink-faint uppercase">turned around</div></div>
                    <div><div className="text-sm font-display tabular-nums" style={{ color: s.gate_backlog > 30 ? "#C8102E" : "#E7EAF0" }}>{s.gate_backlog}</div><div className="text-[9px] text-ink-faint uppercase">gate backlog</div></div>
                    <div><div className="text-sm font-display tabular-nums" style={{ color: s.unsafe_deploys > 0 ? "#C8102E" : "#00B4A6" }}>{s.unsafe_deploys}</div><div className="text-[9px] text-ink-faint uppercase">unsafe deploys</div></div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Race replay */}
        {maxTick > 0 && (
          <div className="space-y-2">
            <div className="flex justify-between items-baseline">
              <span className="text-[10px] text-ink-faint uppercase tracking-wide">Race replay</span>
              <span className="text-[10px] text-ink-faint tabular-nums">tick {playTick}/{maxTick}</span>
            </div>
            {RUN_POLICIES.map((pol) => {
              const f = frameAt(pol); const m = META[pol]; if (!f) return null;
              const total = Math.max(1, f.gate + f.charging + f.servicing + f.ready + f.deployed);
              return (
                <div key={pol}>
                  <div className="flex justify-between text-[10px] mb-1">
                    <span style={{ color: m.accent }}>{m.name}</span>
                    <span className="text-ink-faint tabular-nums">{f.turned_around} done · {f.gate} at gate</span>
                  </div>
                  <div className="h-3 rounded-sm overflow-hidden flex bg-black/40 border border-white/[0.05]">
                    <Seg pct={(f.gate / total) * 100} color="#C8102E" title={`gate ${f.gate}`} />
                    <Seg pct={(f.charging / total) * 100} color="#3B82F6" title={`charging ${f.charging}`} />
                    <Seg pct={(f.servicing / total) * 100} color="#F59E0B" title={`servicing ${f.servicing}`} />
                    <Seg pct={((f.ready + f.deployed) / total) * 100} color="#00B4A6" title={`done ${f.ready + f.deployed}`} />
                  </div>
                </div>
              );
            })}
            <div className="flex gap-3 text-[9px] text-ink-faint pt-1">
              <span><span className="inline-block w-2 h-2 rounded-sm mr-1 align-middle" style={{ background: "#C8102E" }} />gate backlog</span>
              <span><span className="inline-block w-2 h-2 rounded-sm mr-1 align-middle" style={{ background: "#3B82F6" }} />charging</span>
              <span><span className="inline-block w-2 h-2 rounded-sm mr-1 align-middle" style={{ background: "#F59E0B" }} />servicing</span>
              <span><span className="inline-block w-2 h-2 rounded-sm mr-1 align-middle" style={{ background: "#00B4A6" }} />turned around</span>
            </div>
          </div>
        )}

        {!scoreboard.length && !running && (
          <p className="text-[11px] text-ink-faint italic">Click “Run comparison” to race OTTO-Q against manual + FIFO on the twin.</p>
        )}
      </div>
    </ScrollArea>
  );
};
