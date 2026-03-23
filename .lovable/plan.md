

# Replace WeatherEffects with Prop-Based Version

## Changes

### `src/components/canvas/three/WeatherEffects.tsx` — Full replace
Replace with user's provided code:
- Accepts `weather` as a prop instead of reading from `useSimulationStore`
- Supports Rain (3000 particles, fast fall), Snow (1500 particles, slow drift), Extreme Heat (warm fog), and Clear (nothing)
- Uses `useFrame` + ref for per-frame particle animation
- Adds fog effects for Rain and Extreme Heat

### `src/components/canvas/DepotScene3D.tsx` — Pass weather prop
- Read `weather` from `useSimulationStore(s => s.config.weather)`
- Change `<WeatherEffects />` to `<WeatherEffects weather={weather} />`

