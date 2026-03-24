

# Photorealistic 3D Depot Visual Overhaul

## Summary
Complete visual upgrade of all 3D depot components using a centralized PBR material library (`MeshPhysicalMaterial` throughout), new post-processing pipeline (N8AO + Bloom + Vignette + SMAA), detailed geometry for chargers/canopy/building, and environmental landscaping (trees, planters, signage).

## Scope — 14 files touched

| # | Action | File |
|---|--------|------|
| 1 | Install | `postprocessing` npm package (already have `@react-three/postprocessing`) |
| 2 | Create | `src/components/canvas/three/materials.ts` — full PBR material library |
| 3 | Create | `src/components/canvas/three/DepotPostProcessing.tsx` — N8AO, Bloom, Vignette, SMAA |
| 4 | Modify | `src/components/canvas/DepotScene3D.tsx` — new post-processing, fog, hemisphere light, teal accent lights, landscaping (trees/planters/signage), camera presets, FX toggle |
| 5 | Rebuild | `src/components/canvas/three/DepotGround.tsx` — multi-layer ground (grass, asphalt, polished concrete, epoxy bays, curbing, gravel, lane markings, teal center-line) |
| 6 | Rebuild | `src/components/canvas/three/SolarCanopy.tsx` — HSS columns with base plates and cap brackets, I-beam profiles (web + 2 flanges), purlins, individual panel grid, anodized fascia with teal LED strips, downlight fixtures |
| 7 | Rebuild | `src/components/canvas/three/ChargingField.tsx` — detailed pedestal (base/body/cap), screen with backlight, pulsing status LED, teal accent strips, CatmullRom cable with connector, bollards with teal caps |
| 8 | Rebuild | `src/components/canvas/three/DepotBuilding.tsx` — dark cladding body, architectural glass facade, mullions, roof overhang, entrance canopy with wood accent, teal LED roofline, interior glow |
| 9 | Rebuild | `src/components/canvas/three/StagingZone.tsx` — glowing torus rings, center dots, epoxy pad, teal label strip |
| 10 | Upgrade | `src/components/canvas/three/Vehicle3D.tsx` — swap to automotive paint (clearcoat+sheen), auto glass (transmission), chrome trim, tire rubber, headlight lens materials |
| 11 | Upgrade | `src/components/canvas/three/WashBays.tsx` — dark cladding walls, structural steel frame, wet concrete floor, aluminum door frame, teal LED strip, interior lights |
| 12 | Upgrade | `src/components/canvas/three/DriveAisles.tsx` — asphalt surface, white lane markings, teal directional arrows |
| 13 | Upgrade | `src/components/canvas/three/UtilityEquipment.tsx` — structural steel frame, anodized panels, polished concrete pad, green indicators |

## Technical Details

### Material System
- Single `materials.ts` file exports factory functions (each returns a new `MeshPhysicalMaterial` instance)
- All emissive/LED materials use `toneMapped: false` so bloom catches them
- Brand colors: primary dark `#0A0A0F`, accent teal `#00D4AA`, emerald `#00B894`, warm white `#F5F5F0`

### Post-Processing Pipeline
- `N8AO` for screen-space ambient occlusion (intensity 4, aoRadius 0.8)
- `Bloom` with luminanceThreshold 0.9, intensity 0.4, mipmap blur
- `Vignette` offset 0.3, darkness 0.5
- `SMAA` for anti-aliasing (replaces multisampling)
- Three presets: `interactive` (default), `hero`, `night`
- User toggle button (FX ON/OFF) in the camera preset bar

### Scene Enhancements
- `FogExp2('#1a1a2e', 0.006)` for atmospheric depth
- `PCFSoftShadowMap` for softer shadows
- `toneMappingExposure: 1.55` maintained
- 10 teal accent point lights around the depot (low intensity, short distance)
- `hemisphereLight` sky/ground fill added
- 3 new camera presets: Hero, Approach, Night Showcase

### Landscaping (inline in DepotScene3D)
- 12-16 trees around perimeter (cylinder trunk + 3 overlapping sphere crowns, varying heights 5-8m)
- 6 corten steel planters with grass fill at entry points
- Brand signage: dark panel with teal LED border and glowing bar, backlit point light

### Geometry Detail Standards
- I-beams: 3 boxes (web + top flange + bottom flange)
- Charger pedestals: base plate + body + top cap + screen + cable (CatmullRom curve via TubeGeometry) + connector + 2 bollards
- Solar columns: HSS box section + base plate + cap bracket
- Trees: cylinder trunk + 3 offset spheres for crown
- All structural elements: `castShadow={true}`
- All ground surfaces: `receiveShadow={true}`

### What Stays Unchanged
- All Zustand stores and their interfaces
- Component prop interfaces
- Vehicle simulation engine
- DayNightLighting logic (existing light calculations)
- WeatherEffects
- DepotOverlays
- All 2D canvas components
- Routing, layout, tabs

