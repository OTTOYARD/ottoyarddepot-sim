

# Replace DepotOverlays with Live Status HUD

## Issue
The user's code reads `s.kpis`, `s.vehicles`, and `s.stalls` from `useSimulationStore`, but those properties don't exist there. They live in separate stores:
- KPIs → `useKPIStore` (has `fleetUptimePct`, `peakPowerDraw`, etc. — note: no `currentPowerDraw` or `fleetUptime`, will map to closest equivalents)
- Vehicles → `useVehicleStore`
- Stalls → `useDepotStore`
- Status → `useSimulationStore`

## Changes

### `src/components/canvas/three/DepotOverlays.tsx` — Full replace
Replace with user's provided code, correcting store references:
- `useSimulationStore(s => s.status)` — kept as-is
- `useKPIStore` for KPI data: `fleetUptimePct`, `avgTurnaroundMin`, `avgQueueWaitMin`, `peakPowerDraw`
- `useVehicleStore` for vehicles (queue count)
- `useDepotStore` for stalls (DCFC/L2 occupancy)
- Map `kpis?.fleetUptime` → `fleetUptimePct`, `kpis?.currentPowerDraw` → `peakPowerDraw`
- Renders two floating HUD panels: "Live Depot Status" with KPIs and utilization bars, and "Power" with current draw
- Hidden when simulation is idle

### No changes to `DepotScene3D.tsx`
Already renders `<DepotOverlays />` with no props.

