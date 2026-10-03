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
    case "no_run": return { tone: "idle", text: "No simulation running · the depot is empty until one starts" };
    case "live": {
      const clock = clockCT(s.simClock);
      const paused = s.status.toLowerCase() === "paused";
      return { tone: paused ? "warn" : "live",
        text: `${paused ? "Paused" : "Live"} · run ${s.runId.slice(0, 8)}${clock ? ` · sim ${clock}` : ""} · ${s.cars} ${s.cars === 1 ? "car" : "cars"} on site` };
    }
    case "ended": return { tone: "idle", text: `Run ${s.runId.slice(0, 8)} has ended (${s.status}) · the depot was cleared` };
    case "not_found": return { tone: "warn", text: `Run ${s.runId.slice(0, 8)} was not found` };
    case "other_depot": return { tone: "warn", text: `Run ${s.runId.slice(0, 8)} is not a twin-depot run` };
    case "offline": return { tone: "warn", text: "The twin is not answering · retrying" };
  }
}
