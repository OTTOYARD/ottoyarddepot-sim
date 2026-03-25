
I checked the current 3D code, and this does look like the same class of regression.

What I found
- `src/components/canvas/DepotScene3D.tsx` still mounts `<DepotPostProcessing ... />`.
- `src/components/canvas/three/DepotPostProcessing.tsx` still uses `EffectComposer` with `N8AO + Bloom + Vignette + SMAA`.
- That matches the previously fixed root cause: the post-processing chain is still in the live render path, so it can still black out the WebGL output.
- There are also a few remaining dimming risks:
  - very dark / reflective materials in `materials.ts`
  - leftover point lights in `DepotBuilding.tsx`, `DriveAisles.tsx`, and `ChargingField.tsx`
  - some components still use `meshPhysicalMaterial {...MATERIALS.xxx()}` instead of directly attaching the shared cached material

Implementation plan
1. Remove the unstable post-processing path
   - In `DepotScene3D.tsx`, stop rendering `DepotPostProcessing`.
   - Remove or disable the FX toggle so the broken composer path cannot be re-enabled accidentally.
   - Keep the existing camera presets, controls, and recent performance optimizations.

2. Rebalance lighting for stable visibility
   - Keep `DayNightLighting` as the main light rig.
   - Remove redundant decorative point lights that can darken/flatten the scene or add cost without helping readability:
     - building interior glow lights
     - drive aisle gate point lights
     - charger offline point light
   - Preserve the brighter exposure/fog settings already added unless one needs a very small tweak.

3. Lighten the materials that are still too dependent on reflections
   - In `materials.ts`, reduce metalness / reflection reliance on the large dark surfaces:
     - `structuralSteel`
     - `brushedAluminum`
     - `darkCladding`
     - `anodizedPanel`
     - `solarPanelGlass`
   - Keep emissive LED materials unchanged.

4. Normalize material attachment
   - Replace remaining `meshPhysicalMaterial {...MATERIALS.xxx()}` usage in the 3D scene files with direct shared material attachment (`<primitive object={...} attach="material" />`).
   - Focus first on `DepotBuilding.tsx` and `DriveAisles.tsx`, where this pattern still appears.

5. Do a small z-fighting sanity pass
   - Review the overlapping ground/marking heights and only increase offsets where surfaces are still too close.
   - Keep layout and visuals the same otherwise.

Files to update
- `src/components/canvas/DepotScene3D.tsx`
- `src/components/canvas/three/DepotPostProcessing.tsx`
- `src/components/canvas/three/materials.ts`
- `src/components/canvas/three/DepotBuilding.tsx`
- `src/components/canvas/three/DriveAisles.tsx`
- `src/components/canvas/three/ChargingField.tsx`
- possibly `src/components/canvas/three/DayNightLighting.tsx` if a small cleanup is needed

Expected result
- No more full-scene blackouts from the composer path
- Brighter, more readable 3D surfaces without relying on post FX
- Better runtime stability while preserving the current simulation behavior and camera views

Technical note
- I would not use Anthropic or any external API for this. The issue is inside the local Three.js render pipeline, so the correct fix is in the scene code itself.
