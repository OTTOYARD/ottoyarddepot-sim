

# Replace Vehicle3D with Enhanced Version

## Overview
Replace the current `Vehicle3D` component with an enhanced version featuring smooth lerp movement scaled by `simSpeed`, status-based glow effects with pulsing, a more detailed car model (body, cabin, wheels, headlights), and a SoC badge with a visual bar indicator.

## Changes

### `src/components/canvas/three/Vehicle3D.tsx` — Full replace
Replace with user's provided code:
- Accepts `simSpeed` prop in addition to `vehicle`
- Smooth position lerping via `useFrame` scaled by `simSpeed`
- Status-based glow sphere with pulsing emissive intensity
- New color scheme: fleet=#00B4A6, core=#E0E0E0, concierge=#A0A0A0, elite=#FFD700
- Detailed car model: body + cabin + 4 wheels + 2 headlights
- SoC badge with colored bar (green/yellow/red based on charge level)

### `src/components/canvas/DepotScene3D.tsx` — Pass simSpeed prop
- Read `simSpeed` from `useSimulationStore`
- Update vehicle rendering: `<Vehicle3D key={v.id} vehicle={v} simSpeed={simSpeed} />`

