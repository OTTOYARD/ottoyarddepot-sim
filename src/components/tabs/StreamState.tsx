// StreamState — the two chips that say whether a stream on screen is live, paused or ended.
//
// One vocabulary for one fact: the OTTO-Q tab and the Agent tab both read the run's state from here, so a paused run
// reads "paused" in both and an ended run reads "ended" in both.
//
// Chase, 2026-09-21: "If I pause the depot or the simulation at any given point that should also pause the
// intelligence live stream ... so that I can toggle over to it and scroll through recent decisions or proposals."
// The polling half of that is in useActivityFeed. These chips are the half that says so on screen.
import { Pause, Radio } from "lucide-react";

/** ENDED chip: the run has finished, so nothing on screen is live. */
export const EndedState = () => (
  <span className="inline-flex shrink-0 items-center gap-1 rounded border border-white/15 bg-white/[0.04] px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-[0.06em] text-ink-faint"
    title="This run has ended. This shows what it recorded.">
    ended
  </span>
);

/** LIVE / PAUSED chip. */
export const StreamState = ({ frozen }: { frozen: boolean }) =>
  frozen ? (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-[0.06em] text-amber-300"
      title="The run is paused, so the stream is frozen and the tab does not ask for new data. You can still scroll all that it received."
    >
      <Pause size={9} /> paused
    </span>
  ) : (
    <span className="inline-flex shrink-0 items-center gap-1 rounded border border-emerald-400/30 bg-emerald-400/10 px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-[0.06em] text-emerald-300">
      <Radio size={9} /> live
    </span>
  );
