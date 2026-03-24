

# Fix 3D Scene Flashing

## Root Cause

`AccumulativeShadows` with `temporal` mode accumulates shadow samples over 60 frames, visibly transitioning from dark to clear each cycle. Meanwhile, `DayNightLighting` updates the directional light's position and intensity every frame via `useFrame`, which invalidates the shadow accumulation — causing it to restart repeatedly, producing a constant dark-flash-clear loop.

## Solution

Remove `AccumulativeShadows` entirely from `DepotScene3D.tsx`. The directional light in `DayNightLighting` already has `castShadow` enabled with a 4096x4096 shadow map, which provides proper real-time shadows without flicker.

## Changes

### `src/components/canvas/DepotScene3D.tsx`
- Remove `AccumulativeShadows` and `RandomizedLight` imports from `@react-three/drei`
- Delete the `<AccumulativeShadows>` block (lines 79–83)
- Keep all other scene elements unchanged

One file, ~5 lines removed. No structural changes.

