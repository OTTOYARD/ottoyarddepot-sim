

# Photorealistic OTTOYARD Depot — Full Visual Overhaul

## Summary

Two-part deliverable: (1) Upgrade the live interactive 3D scene to near-photorealistic quality using PBR materials, HDRI environment lighting, post-processing effects, and detailed geometry. (2) Generate static 4K concept renders using AI image generation for investor/VC presentations.

## Part 1 — Live 3D Scene Upgrade

### Current State
The scene uses flat `meshStandardMaterial` with hardcoded hex colors, no environment maps, no post-processing, basic point lights, and primitive box/plane geometry. It looks like a debug prototype.

### Target Aesthetic
Ultra-modern / Tesla-like: sleek glass facades, brushed steel, polished concrete, clean LED accent lighting, minimalist signage.

### A. Add `@react-three/postprocessing` dependency

Install `@react-three/postprocessing@3.0` to enable the effects pipeline.

### B. New file: `src/components/canvas/three/PostProcessing.tsx`

Add an `EffectComposer` with:
- **Bloom** — subtle glow on emissive elements (charging indicators, LED strips, BESS SoC bar, headlights). `luminanceThreshold: 0.9`, `intensity: 0.4`.
- **SSAO (N8AO)** — screen-space ambient occlusion for depth and realism in corners, under vehicles, between charger pedestals. `intensity: 2`, `radius: 6`.
- **ToneMapping** — ACES Filmic for cinematic color response.
- **Vignette** — subtle darkening at edges for a polished look.

### C. Upgrade `DepotScene3D.tsx` — Canvas & Renderer Config

- Set `gl` props: `toneMapping: ACESFilmicToneMapping`, `toneMappingExposure: 1.2`, `outputColorSpace: SRGBColorSpace`, `powerPreference: 'high-performance'`, `pixelRatio: Math.min(window.devicePixelRatio, 2)`.
- Add `<Environment preset="city" />` from drei for HDRI reflections on all metallic/glass surfaces — gives the Tesla showroom look instantly.
- Replace `<ContactShadows>` with `<AccumulativeShadows>` + `<RandomizedLight>` for softer, more realistic ground shadows.
- Add `<PostProcessing />` component inside the Canvas.

### D. Upgrade `DepotGround.tsx` — Polished Concrete

- Replace flat dark planes with `meshPhysicalMaterial` using:
  - Main pad: color `#2a2a2a`, roughness `0.6`, metalness `0.1`, clearcoat `0.3` (wet concrete look).
  - Driving surfaces: slightly lighter with lane markings using thin raised planes with emissive white strips.
  - Perimeter landscaping: green strips with slight height offset and rougher material.
  - Add subtle grid-line texture via repeated thin plane geometry (expansion joints in concrete).

### E. Upgrade `DepotBuilding.tsx` — Glass & Steel Architecture

- **Main structure**: Replace single box with multi-part composition:
  - Steel frame: dark brushed metal (`metalness: 0.8`, `roughness: 0.3`).
  - Glass curtain wall: `meshPhysicalMaterial` with `transmission: 0.9`, `roughness: 0.05`, `ior: 1.5`, `thickness: 0.5` — actual transparent glass with environment reflections.
  - Interior warm glow visible through glass (point light behind facade).
  - Roof parapet with subtle teal LED accent strip (emissive).
- **Service bay doors**: Dark recessed panels with subtle frame geometry.
- **OTTOYARD signage**: Backlit channel letters using emissive material with glow bloom pickup.

### F. Upgrade `SolarCanopy.tsx` — Realistic Solar Structure

- Steel columns: `meshPhysicalMaterial` with brushed metal finish.
- Solar panels: dark blue-black with `metalness: 0.6`, `roughness: 0.15` — reflective like real panels.
- Add thin aluminum edge frames around each panel row.
- Subtle under-canopy lighting (warm downlights).

### G. Upgrade `ChargingField.tsx` — Sleek Charger Pedestals

- Charger body: rounded geometry (beveled box or capsule shape), white/light gray body with dark screen face.
- Status LED ring on top using emissive torus geometry.
- Cable management arm: thin cylinder geometry extending from pedestal.
- Ground-level bollard/bumper at each stall.

### H. Upgrade `Vehicle3D.tsx` — More Detailed Vehicle Model

- Smoother body: use rounded box or extruded shape instead of sharp box.
- Proper windshield: `meshPhysicalMaterial` with `transmission`, slight tint.
- Reflective body paint: `metalness: 0.7`, `roughness: 0.2`, `clearcoat: 1.0`, `clearcoatRoughness: 0.1`.
- Distinct wheel wells and tire geometry (torus for tires).
- Tail lights: red emissive small planes.

### I. Upgrade `WashBays.tsx` — Enclosed Bay Structure

- Concrete enclosure with roller-door opening.
- Interior blue-tinted lighting visible from outside.
- Water drainage grate detail (thin striped plane on ground).

### J. Upgrade `UtilityEquipment.tsx` — Industrial Detail

- Transformer: add cooling fins (repeated thin planes on sides).
- BESS containers: corrugated texture via repeated thin ridges, proper door detail, ventilation louvers.
- Color-coded conduit runs connecting equipment (thin colored cylinders).

### K. Upgrade `DayNightLighting.tsx` — Refined Light Rig

- Add hemisphere light for sky/ground color bleed.
- Increase shadow map resolution to 4096.
- Add fill lights at key positions for golden hour warmth.
- Night mode: activate pole-mounted area lights (new geometry) around the lot.

### L. Upgrade `DriveAisles.tsx` — Road Detail

- Lane markings: white dashed lines (repeated small planes with emissive white).
- Directional arrows: triangular planes with emissive material.
- Entry/exit gates: proper boom barrier geometry with red/green lights.

---

## Part 2 — Static 4K Concept Renders (AI-Generated)

### Approach
Use the Lovable AI image generation capability (Gemini image models) to produce 4-6 photorealistic architectural concept renders of the OTTOYARD depot.

### Render Views to Generate
1. **Hero aerial** — Bird's eye golden-hour shot showing the full depot: solar canopy, charging field, operations building, vehicles.
2. **Street-level entry** — Eye-level view approaching the depot entrance, sleek signage, vehicles arriving.
3. **Charging plaza close-up** — Detail shot of DCFC chargers with vehicles plugged in, LED status indicators glowing.
4. **Night operations** — The depot at night, lit by teal accent LEDs, charger glow, operations building interior warmth visible through glass.
5. **Investor site plan** — Clean top-down architectural rendering with zone labels.

Each render will be generated via the AI image generation script, saved to `/mnt/documents/`, and delivered as downloadable artifacts.

### Prompt Engineering
Each prompt will reference: Tesla Supercharger V4 aesthetic, modern EV fleet depot, solar canopy, DCFC/L2 chargers, BESS containers, operations building with glass curtain wall, OTTOYARD branding in red, teal LED accent lighting, polished concrete surfaces, autonomous vehicles.

---

## Technical Details

### New dependency
- `@react-three/postprocessing@3.0`

### Files modified
- `src/components/canvas/DepotScene3D.tsx` — Canvas config, Environment, AccumulativeShadows, PostProcessing
- `src/components/canvas/three/DepotGround.tsx` — PBR concrete materials, lane markings
- `src/components/canvas/three/DepotBuilding.tsx` — Glass curtain wall, steel frame, backlit signage
- `src/components/canvas/three/SolarCanopy.tsx` — Reflective panels, brushed steel columns
- `src/components/canvas/three/ChargingField.tsx` — Rounded pedestals, LED rings, bollards
- `src/components/canvas/three/Vehicle3D.tsx` — Clearcoat paint, glass windshield, torus tires
- `src/components/canvas/three/WashBays.tsx` — Enclosed structure, interior lighting
- `src/components/canvas/three/UtilityEquipment.tsx` — Cooling fins, corrugated BESS, conduit
- `src/components/canvas/three/DayNightLighting.tsx` — Hemisphere light, higher shadow res, pole lights
- `src/components/canvas/three/DriveAisles.tsx` — Lane markings, boom barriers

### New files
- `src/components/canvas/three/PostProcessing.tsx` — EffectComposer with Bloom, SSAO, ToneMapping, Vignette

### Execution order
1. Install dependency
2. PostProcessing + DepotScene3D (foundation)
3. DepotGround + DayNightLighting (environment)
4. DepotBuilding (hero structure)
5. SolarCanopy + ChargingField (infrastructure)
6. Vehicle3D (fleet)
7. WashBays + UtilityEquipment + DriveAisles (detail)
8. Generate 4K concept renders via AI

