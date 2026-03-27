

# Fix Vehicle Orientation + Wash Bay Positioning

## Root Causes

### 1. Vehicle Facing Direction
`getFacingRotation()` in `Vehicle3D.tsx` points all vehicles toward the depot center using a generic atan2 calculation. It doesn't consider where the vehicle's assigned charger/stall actually is. Vehicles at chargers should have their hood pointing directly at the charger pedestal.

**Fix**: Use the vehicle's `assignedStall` ID to look up the stall's 2D position from `depotStore`, then compute the rotation so the vehicle's front faces the charger. Fall back to the current depot-center logic for vehicles without an assigned stall (queued, approaching, departing).

### 2. Wash Bay Position Mismatch
The WashBays 3D component renders at `[80 + i*16, 0, -60]` in world space. Converting back to 2D coords: `{x: 230 + i*16, y: 170}`. But `depotStore.generateStalls()` places wash stalls at `{x: 200 + i*16, y: 33}`, which converts to 3D `[50 + i*16, h, 77]` — a completely different location. So vehicles assigned to wash drive to the wrong spot.

**Fix**: Update the wash stall 2D positions in `depotStore.ts` to match the actual 3D wash bay locations: `{x: 230 + i*16, y: 170}`.

## Changes

### File 1: `src/store/depotStore.ts`
- Fix wash stall positions from `{x: 200 + i*16, y: 33}` to `{x: 230 + i*16, y: 170}` so they align with where the WashBays component actually renders in 3D.

### File 2: `src/components/canvas/three/Vehicle3D.tsx`
- Import `useDepotStore` to access stall positions.
- Replace `getFacingRotation(pos2d)` with a function that:
  - If the vehicle has an `assignedStall`, looks up that stall's position, converts both to 3D, and computes the angle from vehicle to stall so the hood faces the charger/wash bay plug.
  - If no assigned stall (queued/approaching/departing), keeps the current depot-center fallback.
- Account for the model's default forward direction when computing the rotation angle.

## Files Modified
- `src/store/depotStore.ts` — fix wash stall 2D coordinates
- `src/components/canvas/three/Vehicle3D.tsx` — stall-aware facing rotation

