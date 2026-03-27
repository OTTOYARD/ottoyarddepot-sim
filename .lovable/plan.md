

# Fix Vehicle Ground Clipping, Orientation, Staging Layout + Slider Max

## Issues to fix

1. **Vehicles rendering underground** — the GLB model's origin is likely at the center of the car, not the bottom. Need to raise the Y position so wheels sit on the ground.
2. **Vehicle orientation** — vehicles should face their respective charger/stall, not all face the same direction.
3. **Staging stalls layout** — should wrap around the entire depot perimeter *except* near the building/lounge (north side, Z ≈ -72 to -108).
4. **Staging slider max** — currently capped at 30, needs to go up to 100.

## Changes

### 1. `src/components/canvas/three/Vehicle3D.tsx`
- **Fix ground clipping**: Change the primitive's Y position from `0` to a positive offset (e.g. `0.8` to `1.2`) so the model sits on the ground rather than being half-buried. The exact offset depends on the GLB's bounding box — will compute via `new THREE.Box3().setFromObject(clone)` in the useMemo and use `box.min.y` to auto-correct.
- **Fix orientation**: Compute a facing rotation based on vehicle status/position. Vehicles at chargers should face the charger pedestal (toward the charger row center). Add a `rotation-y` to the primitive that derives from the vehicle's 2D position relative to the depot center — left-side vehicles face right, right-side face left, etc.

### 2. `src/components/canvas/three/StagingZone.tsx`
- **Expand to full perimeter**: Add a 4th row along the back/north edge but offset to avoid the building zone (building spans X ≈ -60 to +60, Z ≈ -72 to -108). Place back-edge stalls at Z ≈ -50 only on the far left (X < -65) and far right (X > 65) wings, or wrap stalls along the east and west sides extending further north.
- Distribution with `count=100`: ~25 left, ~25 right, ~15 front/south, ~20 back-left wing, ~15 back-right wing.

### 3. `src/components/tabs/ControlsTab.tsx`
- Change staging stalls slider max from `30` to `100`.

### 4. `src/store/simulationStore.ts`
- Update default `stagingStalls` from current value to `50` (reasonable default for 100 max).

## Files modified
- `src/components/canvas/three/Vehicle3D.tsx` — Y offset fix + orientation logic
- `src/components/canvas/three/StagingZone.tsx` — full perimeter layout with building exclusion
- `src/components/tabs/ControlsTab.tsx` — slider max 30 → 100
- `src/store/simulationStore.ts` — default staging stalls update

