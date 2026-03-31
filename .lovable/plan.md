

# Separate Wash Bays from Operations Center

## Problem
The wash bays and operations center overlap in both 2D and 3D. Need to shift wash bays left and/or operations center right to create clear separation.

## Approach
Shift wash bays further left by ~20 units AND nudge the operations center ~10 units to the right — creating ~30 units of gap.

## Changes

### File 1: `src/components/canvas/three/WashBays.tsx`
- Move group position from `[-90, 0, -80]` to `[-110, 0, -80]` (20 units further left)

### File 2: `src/components/canvas/three/DepotBuilding.tsx`
- Shift the entire building group ~10 units right by wrapping contents in `<group position={[10, 0, 0]}>` (moves building center from x=0 to x=10, left edge from -60 to -50)

### File 3: `src/store/depotStore.ts`
- Move wash stall 2D positions from `{x: 35 + i*16, y: 20}` to `{x: 15 + i*16, y: 20}` (shift left ~20px)

### File 4: `src/components/canvas/DepotSVG.tsx`
- Shift operations building rect from `x={60}` to `x={70}` (and associated inner elements: service bays, control room, lounge labels — all +10px)
- Update WASH label position to match new wash bay location
- Update OPERATIONS label x-position accordingly

### File 5: `src/components/canvas/three/Vehicle3D.tsx`
- Update wash bay world coordinates from `[-90 + i*16, -, -80]` to `[-110 + i*16, -, -80]` to match new WashBays position

