

# Real-Time Alert System

## Overview
Build an alert engine that monitors simulation state every tick, generates categorized alerts (critical/warning/info), displays toast notifications on the canvas, and populates the AlertsTab with a filterable alert log. Wire up the "Inject Incident" button.

## Files to Create

### 1. `src/store/alertStore.ts`
Zustand store with:
- `alerts: Alert[]` (id, timestamp, severity, title, message, acknowledged)
- Actions: `addAlert`, `acknowledgeAlert`, `clearAlerts`, `reset`
- Dedup logic: don't add duplicate alerts within 60 sim-seconds (same title)

### 2. `src/engine/AlertEngine.ts`
Pure function `checkAlerts(vehicles, config, stalls, simTime, kpis)` called every tick from SimulationEngine. Tracks internal state (timers for sustained conditions) via module-level variables.

**Critical checks:**
- Queue overflow: queue depth > 15 sustained for 5 sim-minutes (300s)
- Charger failure: random roll per tick based on `equipmentFailureRate`, marks a random occupied stall as 'offline'
- Demand spike: total power > `utilityService * 1000` kW
- BESS depleted: bessSOC < 10% during 7AM-9PM

**Warning checks:**
- High utilization: DCFC or L2 > 85% for 10 sim-minutes
- Fleet block incoming: 15 min before dcfcBlockStart, check available DCFC stalls
- Weather impact: weather !== 'Clear' → one-time warning
- Staff shortage: servicing vehicles > staffingLevel * 3

**Info checks:**
- VIP override, OTTO-Q reroute, BESS discharge start, maintenance bay available
- Triggered contextually when relevant state changes occur

Includes `resetAlertEngine()` for clearing internal timers.

### 3. `src/components/canvas/AlertToasts.tsx`
Positioned absolute in top-right of canvas area. Subscribes to alertStore, shows last 3 unacknowledged alerts as toast cards:
- Critical: red bg, white text, auto-dismiss 8s
- Warning: amber bg, dark text, auto-dismiss 5s
- Info: teal bg, white text, auto-dismiss 3s
- Slide-in-right animation, stack vertically, X button to dismiss
- Uses internal state to track visible toasts with timers

### 4. `src/components/tabs/AlertsTab.tsx` — Full rebuild
- **Summary bar**: Color-coded badge counts (Critical | Warning | Info)
- **Filter toggles**: 3 toggle buttons to show/hide each severity
- **Alert list**: ScrollArea, reverse chronological, each card has severity icon + color left border, sim time, title (bold), message, "Acknowledge" button
- Unacknowledged critical alerts get `animate-pulse` on left border
- Acknowledged alerts dim to 50% opacity

### 5. `src/engine/IncidentInjector.ts`
`injectRandomIncident()` function that randomly picks one of:
- Charger failure: set random occupied stall to 'offline', add critical alert
- Vehicle breakdown: remove random in-service vehicle, add critical alert
- Power fluctuation: temporarily flag in kpiStore (reduces available power 20% for 5 sim-min)
- Queue surge: spawn 5 vehicles into queue simultaneously

## Files to Modify

### `src/engine/SimulationEngine.ts`
- Import and call `checkAlerts()` at end of tick loop (after KPI calculation)
- On reset, call `alertStore.reset()` and `resetAlertEngine()`

### `src/components/tabs/ControlsTab.tsx`
- Wire "Inject Incident" button onClick to call `injectRandomIncident()`

### `src/components/canvas/DepotCanvas.tsx`
- Add `<AlertToasts />` component inside the canvas relative container

### `src/store/simulationStore.ts`
- No changes needed (activeTab already supports 'alerts')

## Alert Deduplication
Same alert title won't fire again within 60 sim-seconds to prevent spam during sustained conditions.

## Performance
- Alert checks are O(n) over vehicles + stalls, negligible cost
- AlertToasts renders max 3 items
- AlertsTab only renders when active tab is 'alerts'

