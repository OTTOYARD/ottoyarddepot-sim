

# Replace ChargingField with Prop-Based Version

## Overview
Replace the current `ChargingField` component (which reads stalls from `depotStore`) with the user's provided version that accepts `type` and `count` props and reads stalls from `simulationStore`. Update `DepotScene3D` to render two separate instances for DCFC and L2.

## Issue
The new component reads `s.stalls` from `useSimulationStore`, but that store has no `stalls` property. It should continue reading from `useDepotStore`. The plan will use `useDepotStore` instead.

## Changes

### `src/components/canvas/three/ChargingField.tsx` — Full replace
- Accepts `{ type: 'dcfc'|'l2', count: number }` props
- Reads stalls from `useDepotStore` (not simulationStore, which lacks stalls)
- Renders charger pedestals with type-colored indicator strips (red for DCFC, teal for L2)
- Status-based glow sphere per stall
- `OfflineBeacon` sub-component with pulsing red light for offline stalls
- Zone label via `<Html>` showing occupied/total count

### `src/components/canvas/DepotScene3D.tsx` — Split into two instances
- Read `dcfcCount` and `l2Count` from `useSimulationStore(s => s.config)`
- Replace single `<ChargingField />` with:
  ```
  <ChargingField type="dcfc" count={config.dcfcCount} />
  <ChargingField type="l2" count={config.l2Count} />
  ```

