

# Relocate Wash Bays to Northwest (Upper-Left) of Depot

## Current State
- **3D**: WashBays component renders at `[80, 0, -60]` (east/right side of depot, near utility equipment)
- **2D store**: Wash stall positions at `{x: 230 + i*16, y: 170}` (lower-right area)
- **Vehicle3D**: Hardcoded wash override coords `[80 + i*16, 0, -60]`

## Target Location
Based on the red ovals in the screenshot: **upper-left of the depot, just to the left of the operations building** — northwest corner of the lot.

## Changes

### File 1: `src/components/canvas/three/WashBays.tsx`
- Move group position from `[80, 0, -60]` to `[-90, 0, -80]` — places the 3 bays to the left/west of the DepotBuilding (which sits at `[0, 4, -90]`)

### File 2: `src/store/depotStore.ts`
- Update wash stall 2D positions from `{x: 230 + i*16, y: 170}` to `{x: 35 + i*16, y: 20}` — upper-left of the 2D SVG, left of the operations building rectangle (which starts at x=60)

### File 3: `src/components/canvas/three/Vehicle3D.tsx`
- Update the hardcoded wash bay world coordinates from `[80 + i*16, 0, -60]` to `[-90 + i*16, 0, -80]` to match the new WashBays component position

### File 4: `src/components/canvas/DepotSVG.tsx`
- Move the "WASH" label from `x=215, y=28` to `x=40, y=15` to match the new 2D location

## Result
- Both 2D and 3D views show wash bays in the northwest/upper-left, adjacent to the operations building
- Vehicles assigned to wash will route to the correct physical wash bay structures in 3D

