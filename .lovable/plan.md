

# AI Analysis System for AISummaryTab

## Problem
Direct calls to Anthropic's API from the browser will fail due to CORS restrictions. Instead, we'll use the **Lovable AI Gateway** via a Supabase edge function, which is pre-configured and supports the same capabilities.

## Architecture

```text
AISummaryTab
├── Run Summary Card (red left border, loading spinner, copy button)
├── Live Observations List (reverse chronological)
│   └── ObservationBubble (timestamp badge + markdown content)
└── Footer (API call count + status)

Flow:
  SimulationEngine tick → every 60 sim-seconds → collect context → throttle (10s real) → edge function → Lovable AI Gateway → append observation
  Sim paused/stopped → collect full context → edge function → display run summary
```

## Files to Create

### 1. `supabase/functions/analyze-simulation/index.ts`
Edge function that receives SimulationContext, calls Lovable AI Gateway with the OTTO-AI system prompt. Uses `google/gemini-3-flash-preview` model. Returns the analysis text. Handles 429/402 errors gracefully.

### 2. `src/store/aiStore.ts`
Zustand store with:
- `observations: {simTime: string, text: string, timestamp: number}[]`
- `runSummary: string | null`
- `isLoadingObservation: boolean`, `isLoadingSummary: boolean`
- `apiCallCount: number`
- `error: string | null`
- `lastObservationSimTime: number` (track 60 sim-second intervals)
- `lastRealCallTime: number` (track 10s real-time throttle)
- Actions: `addObservation`, `setRunSummary`, `reset`, `incrementCallCount`

### 3. `src/lib/aiAnalysis.ts`
- `SimulationContext` interface matching the spec (mode, simTime, kpis, zoneStatus, etc.)
- `collectContext(mode)`: gathers data from simulation/kpi/vehicle/depot stores
- `requestAnalysis(context)`: calls the edge function via `supabase.functions.invoke('analyze-simulation', ...)`
- Throttle logic: skip if last real call was <10s ago

### 4. `src/components/tabs/AISummaryTab.tsx` — Full rebuild
- **Top**: Run summary card with `otto-red` left border, loading spinner, "Copy Summary" button
- **Middle**: ScrollArea with observation bubbles (sim time badge left, markdown text right, `otto-dark` bg)
- **Bottom**: "X API calls this session" counter + error message if any
- Subscribes to `aiStore`
- Uses `react-markdown` or simple markdown rendering for formatted text

## Files to Modify

### `src/engine/SimulationEngine.ts`
At end of tick loop, check if 60 sim-seconds have passed since last observation. If yes and throttle permits, call `requestAnalysis` with `live_observation` mode.

When `stop()` or status changes to `paused`, trigger `run_summary` analysis.

### `src/engine/SimulationEngine.ts` (reset)
Call `aiStore.getState().reset()` on engine reset.

## System Prompt
The OTTO-AI prompt from the spec will be embedded in the edge function (not client-side), keeping prompt logic server-side per best practices.

## Key Details
- **No API key needed from user**: Lovable AI Gateway uses the pre-configured `LOVABLE_API_KEY`
- **Graceful degradation**: If edge function fails or Lovable Cloud isn't set up, the tab shows a friendly message and the simulation continues normally
- **Throttle**: Real-time 10-second minimum between API calls regardless of sim speed
- **Markdown rendering**: Use simple regex-based formatting (bold, headers, bullets) to avoid adding a dependency
- **Lovable Cloud required**: Need to enable Lovable Cloud for the edge function to work

