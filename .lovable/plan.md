

# Brighten Daytime Lighting

## Problem
The 3D scene is too dark during daytime hours (8:00–17:00). Three values need bumping.

## Changes

### 1. `src/components/canvas/DepotScene3D.tsx`
- Increase `environmentIntensity` from `0.4` → `0.8`
- Increase `toneMappingExposure` from `1.2` → `1.5`

### 2. `src/components/canvas/three/DayNightLighting.tsx`
Boost the daytime (8–17h) lighting values:
- `sunI`: `0.9` → `1.8` (directional sun)
- `ambI`: `0.25` → `0.5` (ambient)
- `hemiI`: `0.3` → `0.5` (hemisphere)
- `sunCol`: `'#ffeedd'` → `'#fff5e6'` (slightly warmer/brighter white)
- Ambient light base color: `'#4a5568'` → `'#8899aa'` (lighter gray-blue)

Also proportionally adjust sunrise/sunset transitions so they blend smoothly into the brighter daytime values.

### Technical Detail
Only two files touched, only numeric/color constants changed. No structural or architectural changes.

