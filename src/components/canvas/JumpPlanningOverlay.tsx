// ============================================================================
// JumpPlanningOverlay — the fast-forward "planning moment".
//
// Founder spec (2026-07-25): "we can just JUMP forward... and when we jump
// forward, there can be a loading moment where it pauses and processes what's
// going on with the queueing sequence from OTTO-Q."
//
// While `ottoq_sim_jump_forward` is batch-running the skipped interval, the
// backend publishes snapshot.run.jump = {status:'planning', from_sim_clock,
// target_sim_clock}. Motion is held by useTwinSceneBridge (animating toward
// coarse batch targets would show cars teleporting), and this overlay explains
// the hold and shows real progress against the sim clock.
//
// Honesty rules: every number rendered comes from the snapshot. Progress is
// measured on the ACTUAL sim clock between from -> target, never a fake timer,
// so if the jump stalls the bar stalls. No store writes, no engine work.
// ============================================================================
import { useTwinStore } from "@/store/twinStore";

function hhmm(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

export function JumpPlanningOverlay() {
  const snapshot = useTwinStore((s) => s.snapshot);
  const jump = snapshot?.run?.jump;
  if (!jump || jump.status !== "planning") return null;

  const from = jump.from_sim_clock ? new Date(jump.from_sim_clock).getTime() : NaN;
  const target = jump.target_sim_clock ? new Date(jump.target_sim_clock).getTime() : NaN;
  const now = snapshot?.run?.sim_clock ? new Date(snapshot.run.sim_clock).getTime() : NaN;

  const span = target - from;
  const done = now - from;
  const pct =
    Number.isFinite(span) && span > 0 && Number.isFinite(done)
      ? Math.max(0, Math.min(100, (done / span) * 100))
      : 0;
  const remainingMin =
    Number.isFinite(target) && Number.isFinite(now)
      ? Math.max(0, Math.round((target - now) / 60000))
      : null;

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-canvas-base/80 backdrop-blur-sm">
      <div className="w-[min(420px,90%)] rounded-lg border border-white/10 bg-black/60 p-5 shadow-2xl">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 animate-pulse rounded-full bg-otto-red" />
          <span className="font-medium tracking-wide text-ink">
            OTTO-Q is planning the queue
          </span>
        </div>

        <p className="mt-2 text-sm text-ink-dim">
          Fast-forwarding the depot. OTTO-Q is sequencing every arrival, charge and
          service in the skipped window before play resumes.
        </p>

        <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-otto-red transition-[width] duration-300 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>

        <div className="mt-2 flex items-center justify-between font-mono text-xs text-ink-dim">
          <span>{hhmm(jump.from_sim_clock)}</span>
          <span className="text-ink">
            {hhmm(snapshot?.run?.sim_clock)}
            {remainingMin !== null && remainingMin > 0 && (
              <span className="ml-2 text-ink-dim">{remainingMin} sim-min to go</span>
            )}
          </span>
          <span>{hhmm(jump.target_sim_clock)}</span>
        </div>
      </div>
    </div>
  );
}
