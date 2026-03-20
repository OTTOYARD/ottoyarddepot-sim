

# On-Demand AI Summary (Post-Run Only)

## What Changes

Remove all live AI observations during simulation. Instead, after a run completes, the user visits the AI Summary tab and clicks "Generate Summary" to get a one-time analysis. The summary can be downloaded as a text file.

## Files to Modify

### `src/engine/SimulationEngine.ts`
- **Remove** the entire block at lines 310-319 (live AI observations every 60 sim-seconds)
- **Remove** the auto `requestAnalysis('run_summary')` call from `stop()` (line 86) — summary is now user-triggered

### `src/lib/aiAnalysis.ts`
- Remove `live_observation` mode entirely
- Simplify `requestAnalysis` to only support `run_summary`
- Remove throttle logic (no longer needed — single on-demand call)
- Keep `collectContext` but only for `run_summary` mode

### `src/store/aiStore.ts`
- Remove `observations`, `addObservation`, `isLoadingObservation`, `setLoadingObservation`, `lastObservationSimTime`, `setLastObservationSimTime`
- Keep: `runSummary`, `isLoadingSummary`, `apiCallCount`, `error`

### `src/components/tabs/AISummaryTab.tsx` — Full rebuild
New layout:
- **Empty state** (no summary yet, sim idle): "Run a simulation, then generate an AI summary here"
- **Post-run state** (sim paused/idle, no summary): Show a "Generate Summary" button with Brain icon. Below it, brief text: "Analyze your last simulation run with AI"
- **Loading state**: Pulsing dots + "Analyzing run data..."
- **Summary state**: Rendered markdown summary with:
  - "Copy" button (clipboard)
  - "Download" button — downloads as `.md` file with run name and timestamp
  - "Regenerate" button to request a new summary
- Remove all live observation rendering (ObservationBubble, observation list)

### `supabase/functions/analyze-simulation/index.ts`
- Update system prompt: remove "live observations" language, focus on run summary format
- Keep the same API structure (receives context, returns analysis)

## Download Feature
- "Download Summary" button generates a `.md` file
- Filename: `OTTOYARD-Summary-{date}.md`
- Content includes a header with run config + the AI-generated summary
- Uses `Blob` + `URL.createObjectURL` + programmatic `<a>` click

## AI Model
Uses the existing Lovable AI gateway with `google/gemini-3-flash-preview` (already configured and working). Anthropic models are not available through this gateway — the closest equivalent would be `openai/gpt-5` or `google/gemini-2.5-pro` for higher quality summaries.

