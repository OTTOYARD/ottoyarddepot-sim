

# Replace DriveAisles with Simplified Version

## Changes

### `src/components/canvas/three/DriveAisles.tsx` — Full replace
Replace with user's provided code:
- Removes `toWorld` dependency and uses direct 3D coordinates
- Two drive aisle planes at x=±110
- Directional arrow markers (circle geometry triangles) along each aisle
- Entry/exit gates with colored posts (teal for entry, red for exit) and point lights

### No other files affected
`DepotScene3D.tsx` already renders `<DriveAisles />` with no props — no changes needed.

