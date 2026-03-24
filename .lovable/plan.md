
Fix the 3D darkness/flashing as a rendering-pipeline issue, not a backend/API issue.

## Likely root causes
1. Double tone mapping: the scene applies ACES on the WebGL renderer and again in `PostProcessing`, which can crush midtones and make exposure feel unstable.
2. Angle-dependent PBR materials: many large surfaces use very dark `meshPhysicalMaterial` colors with high `metalness`, so they read almost black until they catch an HDRI reflection at certain camera angles.
3. Overactive light updates: `DayNightLighting` mutates light values every frame via `useFrame`, which is unnecessary and can contribute to shadow/exposure instability while orbiting.

## Implementation plan

### 1. Stabilize the render pipeline
Update `src/components/canvas/three/PostProcessing.tsx` and `src/components/canvas/DepotScene3D.tsx` to avoid conflicting exposure control:
- Remove the post-processing `ToneMapping` pass and let the renderer own tone mapping/exposure.
- Reduce or temporarily disable `Vignette`, since it makes already-dark materials feel even darker.
- Keep bloom subtle so emissive accents still read without washing the scene.

### 2. Make daylight lighting deterministic
Refactor `src/components/canvas/three/DayNightLighting.tsx`:
- Replace `useFrame` light mutation with values derived directly from `simTime` on render.
- Keep stronger daytime sun/ambient/hemi settings.
- Add a subtle non-shadow-casting daylight fill light so building faces do not go black when the camera rotates.

### 3. Fix angle-dependent dark materials
Rebalance the biggest surfaces first:
- `DepotGround.tsx`: convert concrete/asphalt from glossy dark physical materials to more diffuse materials with near-zero metalness.
- `DepotBuilding.tsx`: lighten the shell slightly and reduce metalness on large wall masses; keep glass/trim more reflective.
- `SolarCanopy.tsx`, `UtilityEquipment.tsx`, `Vehicle3D.tsx`, and `ChargingField.tsx`: reduce metalness on broad dark meshes so they stay readable under direct light instead of relying on HDRI reflections.

### 4. Improve environment reflections for daytime
In `DepotScene3D.tsx`:
- Swap the HDRI preset from a moodier one to a brighter daylight-friendly preset if needed.
- Keep environment intensity, but use it to support materials rather than compensate for overly metallic dark assets.

### 5. Verify the fix
After implementation, validate in the 3D view that:
- daytime stays bright from multiple orbit angles,
- no dark/bright flashing occurs while rotating,
- ground/building details remain visible without needing reflective highlights to “pop in.”

## Technical details
Main files to update:
- `src/components/canvas/DepotScene3D.tsx`
- `src/components/canvas/three/PostProcessing.tsx`
- `src/components/canvas/three/DayNightLighting.tsx`
- `src/components/canvas/three/DepotGround.tsx`
- `src/components/canvas/three/DepotBuilding.tsx`
- likely also `SolarCanopy.tsx`, `UtilityEquipment.tsx`, `Vehicle3D.tsx`, `ChargingField.tsx`

This should fix both symptoms together: the scene is dark because large assets are too metallic/dark, and the occasional bright-detail “flash” happens when those materials briefly catch favorable reflections under an over-processed lighting stack.
