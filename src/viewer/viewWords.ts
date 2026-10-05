// The live view's words for what it is showing: the chip over the depot. Pure, so every state is tested.
import type { ViewState } from "./protocol";

const clockCT = (iso: string | null) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null
    : `${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" })} CT`;
};

/** The words for the view's state, as a chip over the depot. */
export function stateWords(s: ViewState): { tone: "live" | "idle" | "warn"; text: string } {
  switch (s.kind) {
    case "connecting": return { tone: "idle", text: "Connecting to the twin…" };
    case "no_run": return { tone: "idle", text: "No run is active · the depot is empty until a run starts" };
    case "live": {
      const clock = clockCT(s.simClock);
      const paused = s.status.toLowerCase() === "paused";
      return { tone: paused ? "warn" : "live",
        text: `${paused ? "Paused" : "Live"} · run ${s.runId.slice(0, 8)}${clock ? ` · sim ${clock}` : ""} · ${s.cars} ${s.cars === 1 ? "car" : "cars"} on site` };
    }
    case "ended": return { tone: "idle", text: `Run ${s.runId.slice(0, 8)} ended: ${s.status} · the twin cleared the depot` };
    case "not_found": return { tone: "warn", text: `The twin has no run ${s.runId.slice(0, 8)}` };
    case "other_depot": return { tone: "warn", text: `Run ${s.runId.slice(0, 8)} is not a twin-depot run` };
    case "offline": return { tone: "warn", text: "The twin does not answer · the view tries again" };
  }
}
