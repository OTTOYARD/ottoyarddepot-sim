

# 3D Scene: Performance + Visibility Fix

## Problems Identified

### Performance (why it's slow)
1. **Solar panel mesh explosion**: `SolarCanopy` creates `panelCols × panelRows × 2` individual meshes. At default config that's potentially **6,000–13,000 meshes** just for panels + frames — each with its own draw call
2. **Material re-creation**: `MATERIALS.xxx()` is called via spread (`{...MATERIALS.foo()}`) on every charger pedestal part, bollard, accent strip, etc. — creating **thousands of unique material instances** instead of sharing one
3. **Too many point lights**: ~10 teal accent lights + 4 pole lights + canopy downlights (grid of ~6–12) + wash bay interior lights + signage backlight + building interior + camera fill light + DayNightLighting point lights = **25+ point lights**. Each costs a full lighting pass
4. **N8AO on every frame**: Screen-space AO at `quality: 'medium'` with `halfRes: true` is still a full-screen multi-pass effect
5. **DPR 2** on high-DPI screens means 4x the pixel fill rate
6. **useFrame per charger**: Each `ChargerPedestal` runs its own animation loop for LED pulsing

### Visual (why it's dark)
1. **FogExp2 color `#1a1a2e`** (dark purple) absorbs light at distance
2. **Procedural environment** is just a flat `#87CEEB` sphere — provides zero realistic reflections for all those `MeshPhysicalMaterial` surfaces with `envMapIntensity > 1.0`
3. **toneMappingExposure: 1.8** with ACESFilmic compresses highlights — combined with dark fog and weak env, everything trends dark
4. **Night post-processing** has vignette darkness 0.5 which further crushes edges

## Plan

### 1. Instance solar panels (biggest perf win)
**File**: `src/components/canvas/three/SolarCanopy.tsx`
- Replace the `panelCols × panelRows` individual `<mesh>` loop with a single `THREE.InstancedMesh` using a shared `boxGeometry` and `solarPanelGlass` material
- Pre-compute a `Matrix4` array in `useMemo` for panel positions
- Same for aluminum frames — one `InstancedMesh` instead of thousands of meshes
- This alone reduces draw calls from ~13,000 to ~2

### 2. Share materials globally (major perf win)
**File**: `src/components/canvas/three/materials.ts`
- Change factory functions to **singletons** using a module-level cache. Each function creates the material once on first call and returns the same instance thereafter
- Exception: `automotivePaint(color)` stays as a factory since color varies, but cache by color string
- This eliminates thousands of duplicate material compilations

### 3. Cull excess lights
**File**: `src/components/canvas/DepotScene3D.tsx`
- Remove `TealAccentLights` entirely (10 point lights providing minimal visual contribution)
- Remove the signage backlight `pointLight` (intensity 10 is expensive and the emissive mesh already glows via bloom)

**File**: `src/components/canvas/three/SolarCanopy.tsx`
- Remove all under-canopy `pointLight` fixtures (the emissive cylinder mesh is enough for visual with bloom)
- Remove the canopy-wide teal accent `pointLight`

**File**: `src/components/canvas/three/WashBays.tsx`
- Remove interior `pointLight` per bay (keep the emissive LED mesh)

**File**: `src/components/canvas/three/DayNightLighting.tsx`
- Keep only: 1 shadow-casting directional + 2 fill directionals (no shadow) + 1 ambient + 1 hemisphere = 5 lights total
- Remove the 3 decorative point lights (teal accent, warm fill, signage glow)
- Night pole lights: keep the mesh geometry but remove the `pointLight` — use emissive material on the light fixture instead

**Target**: Reduce from ~25+ lights to **5–7 total**, with only **1 shadow caster**

### 4. Lighten post-processing
**File**: `src/components/canvas/three/DepotPostProcessing.tsx`
- Change N8AO quality to `'low'` for interactive mode and `halfRes: true` always
- Reduce vignette darkness across all modes (0.3 → 0.15 interactive, 0.5 → 0.25 night)
- Reduce bloom intensity slightly to avoid washing out

### 5. Brighten the scene
**File**: `src/components/canvas/DepotScene3D.tsx`
- Change fog color from `#1a1a2e` (dark purple) to `#4a5568` (neutral gray-blue) and reduce density from 0.002 to 0.0015
- Increase `toneMappingExposure` from 1.8 to 2.2
- Cap DPR at 1.5 instead of 2: `dpr={Math.min(window.devicePixelRatio, 1.5)}`
- Increase hemisphere light intensity from 0.6 to 0.9
- Increase environment intensity from 1.0 to 1.5

### 6. Reduce geometry complexity on small parts
**File**: `src/components/canvas/three/ChargingField.tsx`
- Reduce cylinder segments: status LED 16→8, bollard 12→6, cable connector 12→6
- Reduce tube segments on cable: 20→12
- Remove `castShadow` from small detail meshes (accent strips, screen, cable, connector, bollards) — only body and base need shadows

**File**: `src/components/canvas/three/Vehicle3D.tsx`
- Reduce sphere segments on headlights: 8→6
- Remove `castShadow` from small parts (headlights, tail lights, chrome trim)

### 7. Batch charger LED animation
**File**: `src/components/canvas/three/ChargingField.tsx`
- Move the `useFrame` from individual `ChargerPedestal` up to the parent `ChargingField` component
- Use a single `useFrame` that updates a shared emissive intensity value via a ref, passed down as a prop

## Technical Details

### Material singleton pattern
```ts
let _structuralSteel: THREE.MeshPhysicalMaterial | null = null;
export function structuralSteel() {
  if (!_structuralSteel) {
    _structuralSteel = new THREE.MeshPhysicalMaterial({...});
  }
  return _structuralSteel;
}
```
This means components use `material={MATERIALS.structuralSteel()}` (direct ref) instead of `{...MATERIALS.structuralSteel()}` (spread into new inline material).

### InstancedMesh for solar panels
```tsx
const panelGeo = useMemo(() => new THREE.BoxGeometry(2.0, 0.04, 1.0), []);
const panelMat = useMemo(() => MATERIALS.solarPanelGlass(), []);
const mesh = useMemo(() => {
  const m = new THREE.InstancedMesh(panelGeo, panelMat, count);
  // set matrices...
  return m;
}, [count]);
return <primitive object={mesh} />;
```

### What stays unchanged
- All store interfaces and component prop interfaces
- Vehicle simulation, scheduling engine
- WeatherEffects, DepotOverlays, DemoBanner
- 2D canvas mode
- All tab components
- Camera presets and FX toggle button

### Expected impact
- Draw calls: ~15,000 → ~200 (mainly from solar panel instancing + material sharing)
- Lights: 25+ → 5–7
- Materials: thousands of instances → ~30 singletons
- Scene should be noticeably brighter and render at 30–60fps on mid-range hardware

