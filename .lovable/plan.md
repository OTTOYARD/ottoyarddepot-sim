

# Replace Box Vehicles with Tesla Model 3 GLB

## What changes

### 1. Copy the GLB model into the project
Copy `user-uploads://2023_tesla_model_3_performance.glb` to `public/models/tesla_model3.glb` so it can be loaded at runtime via URL.

### 2. Rewrite `src/components/canvas/three/Vehicle3D.tsx`
- Remove all the hand-built box/torus geometry (body, cabin, wheels, headlights, taillights, chrome trim)
- Use `useGLTF` from `@react-three/drei` to load the Tesla GLB model
- Call `useGLTF.preload('/models/tesla_model3.glb')` at module level so the model is cached and shared across all vehicle instances
- Clone the loaded scene per vehicle instance so each can animate independently
- Scale the model to match the current vehicle footprint (~5 units long, ~2.6 wide) — GLB models vary in native scale so we'll normalize with a `scale` prop on the group
- Keep all existing logic unchanged:
  - `useFrame` lerp animation for smooth position transitions
  - Status glow sphere (charging/washing/maintenance pulse)
  - SoC badge HTML overlay
  - Color tinting per vehicle type (apply tint to the cloned model's body meshes by traversing the scene and setting material color on mesh nodes)

### 3. No other files change
- `DepotScene3D.tsx` already renders `<Vehicle3D>` — no import changes needed
- Store, engine, and types remain the same

## Technical details
- `useGLTF` caches the GLB; cloning via `scene.clone(true)` gives each vehicle its own scene graph while sharing geometry/textures in GPU memory
- The model's native orientation may need a Y-axis rotation (typically GLB cars face +Z or -Z) — will rotate to align with the depot's coordinate system
- Shadow casting preserved on the cloned meshes via `traverse` setting `castShadow = true`
- Vehicle type color tinting: traverse cloned scene, find mesh nodes whose material name suggests "body" or "paint", and set `material.color` to the type color

## Files
- **Copy**: `user-uploads://...glb` → `public/models/tesla_model3.glb`
- **Rewrite**: `src/components/canvas/three/Vehicle3D.tsx`

