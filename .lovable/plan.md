

# Build KPIs Tab with Real-Time Metrics

## Overview
Replace the placeholder KPIsTab with a full dashboard of real-time simulation metrics using Recharts charts, stat cards, and collapsible detail sections. Add a KPI calculation engine that runs every tick and stores computed metrics in a dedicated Zustand store.

## Files to Create

### 1. `src/store/kpiStore.ts` — KPI state store
Zustand store holding all computed KPI values plus a time-series array for the energy demand chart (last N data points at 5-sim-minute intervals). Actions: `updateKPIs(data)`, `pushEnergyDataPoint(point)`, `reset()`.

Fields: `fleetUptimePct`, `avgTurnaroundMin`, `dcfcUtilization`, `l2Utilization`, `avgQueueWaitMin`, `queueWaitHistory: number[]` (last 30 points), `revenuePerBayPerHour`, `energyTimeSeries: {time, dcfc, l2, building, bessDischarge, utilityLimit}[]`, `vehiclesProcessed`, `bessSOC`, `solarSelfConsumption`, `ottoQAccuracy`, `serviceCompletionRate`, `bayIdleTime: {dcfc, l2, wash}`, `costPerVehicle`, `monthlyEBITDA`, `paybackYears`, `revenuePerMember`, `energyCostPerKwh`, `maintenanceScore`, `carbonOffsetKg`.

### 2. `src/engine/KPICalculator.ts` — Calculation logic
A pure function `calculateKPIs(vehicles, config, depotStalls, simTime, vehiclesProcessed)` that computes all metrics from current state. Called from `SimulationEngine.tick()` every frame, but only pushes energy data points every 5 sim-minutes (tracked via a `lastEnergySnapshot` timestamp).

Key formulas:
- Fleet Uptime: vehicles with status 'staging' and SoC >= targetSoC / total fleet vehicles
- Avg Turnaround: tracked via departure events (store running sum + count)
- Charger Utilization: occupied stalls of type / total stalls of type
- Queue Wait: average (simTime - arrivalTime) for queued vehicles
- Revenue: fleet=$4.17/hr, core=$0.21/hr, concierge=$0.35/hr, elite=$0.55/hr per active vehicle
- Energy: DCFC load = occupied DCFC stalls * dcfcPowerPerStall, L2 load = occupied L2 * l2PowerPerStall, building = 150kW constant
- BESS SOC: simulated drain/charge based on strategy
- Financial projections: EBITDA = (revenue - $106,064/mo OpEx), payback = $3.2M / annual EBITDA

### 3. `src/components/tabs/KPIsTab.tsx` — Full rebuild
Scrollable panel with three tiers:

**Tier 1 (always visible):**
- Top row: 3 `StatCard`s — Fleet Uptime (circular progress), Avg Turnaround (number + trend arrow), Queue Wait (number + sparkline)
- Second row: 2 horizontal utilization bars (DCFC red, L2 teal) showing percent with labels
- Third row: Revenue per Bay stat card
- Fourth row: Recharts `AreaChart` (energy demand curve, ~180px tall, stacked areas for DCFC/L2/building loads, dashed utility limit line)

**Tier 2 (collapsible "Detailed Metrics"):**
8 metrics in a 2-column grid of small stat cards: Optimal Charger Mix (text), Max Vehicles at SLA, Bay Idle Time %, Cost per Vehicle, BESS SoC (gauge), Solar Self-Consumption %, OTTO-Q Accuracy %, Service Completion Rate %

**Tier 3 (collapsible "Financial Projections"):**
6 metrics: Monthly EBITDA, Payback Period, Revenue per Member, Energy Cost per kWh, Maintenance Score, Carbon Offset

### 4. `src/components/tabs/StatCard.tsx` — Reusable stat card component
Props: `label`, `value`, `unit?`, `trend?` (up/down/neutral + percentage), `sparklineData?: number[]`, `variant?` ('default' | 'circular-progress' | 'bar-gauge')
- Dark background (#1A1A2E), rounded, subtle border
- Label in text-xs gray, value in text-lg white mono font
- Trend arrow colored (green=good direction, red=bad direction, configurable which is good)
- Optional sparkline rendered as a tiny Recharts LineChart (no axes, just the line)

## Files to Modify

### `src/engine/SimulationEngine.ts`
Add a call to `calculateKPIs()` at the end of the tick loop. Track `lastEnergySnapshotTime` to push energy time-series data every 5 sim-minutes. On reset, also reset the kpiStore.

### `src/index.css`
Add any Recharts tooltip/chart styling overrides to match the dark theme (dark tooltip backgrounds, white text).

## Component Hierarchy
```text
KPIsTab
├── ScrollArea
│   ├── Tier 1: Always Visible
│   │   ├── Row: StatCard(Fleet Uptime) | StatCard(Turnaround) | StatCard(Queue Wait)
│   │   ├── Row: UtilizationBar(DCFC) | UtilizationBar(L2)
│   │   ├── Row: StatCard(Revenue/Bay/Hr)
│   │   └── Row: AreaChart (Energy Demand Curve)
│   ├── Accordion: "Detailed Metrics"
│   │   └── 2-col grid of 8 StatCards
│   └── Accordion: "Financial Projections"
│       └── 2-col grid of 6 StatCards
```

## Performance
- KPI calculations are cheap (O(n) over vehicles array, n <= 200)
- Energy time-series capped at ~288 points (24 hours at 5-min intervals)
- StatCard components wrapped in React.memo
- KPIsTab only re-renders when the kpis tab is active (conditional subscription)

