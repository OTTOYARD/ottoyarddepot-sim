

# Replace DayNightLighting with useFrame-based Version

## Overview
Replace the current `DayNightLighting` component (which uses `useMemo` and reads `simTime` from the store directly) with the user's provided version that uses `useFrame` for per-frame light updates and accepts `simTime` as a prop.

## Changes

### `src/components/canvas/three/DayNightLighting.tsx` — Full replace
Replace with user's provided code:
- Accepts `simTime` as a prop instead of reading from store
- Uses `useFrame` + refs for smooth per-frame light updates
- More nuanced sunrise (6-8), daytime (8-17), sunset (17-20), night phases
- Higher shadow map resolution (2048)
- Adds themed point lights: teal accent, warm building light, red OTTO-branded glow

### `src/components/canvas/DepotScene3D.tsx` — Pass simTime prop
- Read `simTime` from `useSimulationStore`
- Change `<DayNightLighting />` to `<DayNightLighting simTime={simTime} />`

