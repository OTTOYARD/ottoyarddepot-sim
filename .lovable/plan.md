

# Replace SolarCanopy with Prop-Based Version

## Overview
Replace the current `SolarCanopy` component with the user's provided version that accepts `solarKWdc` as a prop, scales dynamically based on solar capacity, and features detailed panel geometry with LED edge lights.

## Changes

### `src/components/canvas/three/SolarCanopy.tsx` — Full replace
Replace with user's provided code:
- Accepts `solarKWdc` prop; returns null when 0
- Dynamically scales width/depth/columns based on `solarKWdc / 500`
- Detailed structure: roof slab, solar panel rows, cylindrical support columns, teal LED edge lights with pulsing via `useFrame`
- Teal point light underneath

### `src/components/canvas/DepotScene3D.tsx` — Pass prop
- Read `config.solarCanopy` from `useSimulationStore`
- Change `<SolarCanopy />` to `<SolarCanopy solarKWdc={config.solarCanopy} />`

