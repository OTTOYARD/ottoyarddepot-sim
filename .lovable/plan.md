

# Replace UtilityEquipment with Prop-Based Version

## Issue
The user's code reads `s.kpis` from `useSimulationStore`, but that store has no `kpis` property. The BESS SoC is in `useKPIStore`. Will fix this in implementation.

## Changes

### `src/components/canvas/three/UtilityEquipment.tsx` — Full replace
Replace with user's provided code, but use `useKPIStore` for `bessSOC` instead of `useSimulationStore(s => s.kpis)`:
- Accepts `bessCapacity` and `bessPower` props
- Renders transformer, switchgear, BESS (scaled by capacity), and solar inverters
- BESS shows SoC bar with color coding (green/yellow/red)
- Labels via `<Html>`

### `src/components/canvas/DepotScene3D.tsx` — Pass props
- Change `<UtilityEquipment />` to `<UtilityEquipment bessCapacity={config.bessCapacity} bessPower={config.bessPower} />`

