

# Supabase Persistence & History Tab

## Overview
Create a `simulation_runs` table, auto-save runs on pause/stop, and build the History tab with run list, comparison view, and config loading.

## Database Migration

Create `simulation_runs` table with RLS policies allowing anonymous insert/select/delete (no auth required — this is a single-user simulation tool):

```sql
create table simulation_runs (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default now(),
  name text,
  duration_seconds integer,
  config jsonb,
  kpi_results jsonb,
  ai_summary text,
  vehicles_processed integer,
  avg_turnaround_minutes numeric,
  peak_queue_depth integer,
  peak_power_draw_kw numeric,
  alert_count_critical integer default 0,
  alert_count_warning integer default 0,
  alert_count_info integer default 0
);

alter table simulation_runs enable row level security;

create policy "Allow all access" on simulation_runs
  for all using (true) with check (true);
```

## Files to Create

### 1. `src/store/historyStore.ts`
Zustand store managing:
- `runs: SimulationRun[]` — fetched from database
- `selectedForCompare: [string?, string?]` — up to 2 run IDs
- `compareMode: boolean`
- `isLoading: boolean`
- Actions: `fetchRuns`, `deleteRun`, `toggleCompare`, `setCompareMode`, `renameRun`

### 2. `src/lib/runPersistence.ts`
- `saveRun()`: Collects final state from simulationStore, kpiStore, aiStore, alertStore, vehicleStore. Computes peak queue depth (track in vehicleStore or kpiStore). Inserts row via Supabase client. Returns the saved run. Shows toast on success.
- `deleteRun(id)`: Deletes from Supabase.
- `fetchRuns()`: Select all, order by created_at desc.
- `loadConfig(run)`: Parses config JSON, calls `simulationStore.updateConfig()` and `depotStore.regenerateStalls()`. Shows toast.

## Files to Modify

### `src/engine/SimulationEngine.ts`
- In `stop()`: After triggering AI analysis, call `saveRun()` (async, fire-and-forget with error handling)
- Track `peakQueueDepth` during the tick loop — add to kpiStore

### `src/store/kpiStore.ts`
- Add `peakQueueDepth: number` and `peakPowerDraw: number` fields, updated each tick if current value exceeds stored peak

### `src/components/tabs/HistoryTab.tsx` — Full rebuild
**Run List View:**
- Fetch runs on mount via `historyStore.fetchRuns()`
- Each card: run name (editable on click), date, duration, key stats row (vehicles, turnaround, uptime), truncated AI summary
- Buttons: "Load Config", "Compare" checkbox, "Delete" (with confirm dialog)
- Top bar: "Compare Runs" button (enabled when exactly 2 selected)

**Comparison View:**
- Side-by-side columns for Run A and Run B
- KPI rows with values and delta arrows (green = improved, red = worse, direction-aware)
- Config diff section highlighting differences in amber
- AI summaries side by side
- "Back to List" button

## Component Hierarchy
```text
HistoryTab
├── RunListView (default)
│   ├── CompareButton (top, enabled when 2 selected)
│   └── ScrollArea
│       └── RunCard[] (name, stats, Load/Compare/Delete)
└── ComparisonView (when compareMode)
    ├── BackButton
    ├── KPIComparisonGrid
    ├── ConfigDiffSection
    └── AISummaryComparison
```

## Key Details
- No auth required — RLS allows all access (public simulation tool)
- Graceful degradation: if Supabase calls fail, show error in tab, simulation unaffected
- Auto-generated run names: `Run #N - Mar 19 2:30PM` format
- Peak queue depth tracked via new kpiStore field updated each tick

