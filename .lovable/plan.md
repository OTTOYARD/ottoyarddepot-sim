

# Build Full 3D Depot Scene

## Overview
Replace the placeholder `DepotScene3D` with a full React Three Fiber scene, creating ~10 new sub-components in `src/components/canvas/three/`. The scene mirrors the 2D SVG layout using `toWorld()` for coordinate mapping.

## Files to Create

### `src/components/canvas/three/DepotGround.tsx`
- Dark asphalt plane (300x220 mapped via toWorld)
- Subtle grid lines matching the 2D grid
- Road strip at y=215 (south edge) with yellow dashed center line
- Ingress/egress markers (teal/red boxes with text labels using `<Html>` from drei)

### `src/components/canvas/three/DepotBuilding.tsx`
- Operations building: box geometry at 2D coords (60,5) to (180,40)
- Sub-sections for Service bays, Control Room, Lounge — different colored boxes
- BESS/XFMR/SWGR utility boxes at (245,5) area

### `src/components/canvas/three/SolarCanopy.tsx`
- Semi-transparent green plane at y=190 area, slightly elevated (height ~4)
- Thin pole supports at corners

### `src/components/canvas/three/ChargingField.tsx`
- Reads stalls from `useDepotStore` filtered by type `dcfc` and `l2`
- Each stall: small box (charger pedestal) + colored top indicator
  - DCFC: red accent, L2: teal accent
  - Status colors: available=dim, charging=bright glow, offline=dark
- Uses `toWorld(stall.position)` for placement

### `src/components/canvas/three/WashBays.tsx`
- Reads wash stalls from depot store
- Box geometry with blue accent, positioned via `toWorld`

### `src/components/canvas/three/StagingZone.tsx`
- Reads staging stalls from depot store
- Flat marked areas with amber accent

### `src/components/canvas/three/DriveAisles.tsx`
- Two vertical aisle strips matching 2D positions (x=20-40, x=265-285)
- Arrow indicators (small cone geometries) for traffic direction

### `src/components/canvas/three/UtilityEquipment.tsx`
- BESS, XFMR, SWGR boxes at northeast corner matching 2D positions
- Gray metallic appearance with text labels via `<Html>`

### `src/components/canvas/three/Vehicle3D.tsx`
- Takes a `Vehicle` prop from vehicle store
- Simple box geometry (car shape) colored by vehicle type:
  - fleet=#C00000, core=#00B4A6, concierge=#F59E0B, elite=#9C27B0
- Positioned via `toWorld(vehicle.position)`
- Small SoC bar floating above (thin box or `<Html>` badge)

### `src/components/canvas/three/DepotOverlays.tsx`
- Zone boundary lines (dashed) matching 2D zone outlines
- Zone labels using `<Html>` or `<Text>` from drei: "DCFC CHARGING", "L2 CHARGING", "STAGING", "WASH"

### `src/components/canvas/three/WeatherEffects.tsx`
- Reads `config.weather` from simulation store
- Clear: nothing extra; Rain: particle system (Points geometry falling); Overcast: fog adjustment
- Lightweight — just atmospheric hints

### `src/components/canvas/three/DayNightLighting.tsx`
- Reads `simTime` from store
- Adjusts ambient light intensity and directional light color/position based on time of day
- Daytime (6AM-6PM): bright warm directional light; Night: dim blue ambient + point lights at stalls

## File to Replace

### `src/components/canvas/DepotScene3D.tsx`
- Full Canvas with OrbitControls
- Suspense-wrapped scene containing all sub-components
- Reads vehicles from `useVehicleStore` (not simulationStore — vehicles live in vehicleStore)
- Reads config/simTime from simulationStore
- Camera preset buttons (Bird Eye, Street Level, Operator) as HTML overlay
- ContactShadows for grounding

## Key Technical Decisions
- Use `useVehicleStore` for vehicles (not simulationStore — that store doesn't have vehicles)
- Use `useDepotStore` for stalls in ChargingField, WashBays, StagingZone
- All 3D positions derived via `toWorld()` from existing 2D coordinates
- Drei `<Html>` for text labels, `<Text>` for in-scene text
- Keep components lightweight — simple box/plane geometries, no heavy models

