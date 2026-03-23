

# Replace DepotBuilding with Enhanced Version

## Overview
Replace the current `DepotBuilding` component with the user's provided version featuring a service wing, two-story lounge corner, glass facade, green wall, service bay doors, and an OTTOYARD sign.

## Changes

### `src/components/canvas/three/DepotBuilding.tsx` — Full replace
Replace entire file with user's provided code. The new version removes `toWorld` coordinate mapping and uses direct 3D positions instead. Key elements:
- Service wing box with dark material
- Two-story lounge corner with slightly different height
- Glass facade (transparent cyan plane)
- Green wall accent
- Two service bay doors (dark openings)
- Red OTTOYARD sign box
- "OPERATIONS BUILDING" label via `<Html>`

