

# Replace WashBays and StagingZone with Prop-Based Versions

## Changes

### `src/components/canvas/three/WashBays.tsx` — Full replace
Replace with user's provided code:
- Accepts `count` prop instead of reading from `useDepotStore`
- Renders wash bay structures with roofs, wall supports, and door openings using direct 3D positioning
- "WASH BAYS" label via `<Html>`
- Removes `toWorld` and depot store dependency

### `src/components/canvas/three/StagingZone.tsx` — Full replace
Replace with user's provided code:
- Accepts `count` prop instead of reading from `useDepotStore`
- Renders flat amber-colored ground markers arranged in a row
- "STAGING / QUEUE" label via `<Html>`
- Removes `toWorld` and depot store dependency

### `src/components/canvas/DepotScene3D.tsx` — Pass count props
- Read `washBayCount` and `stagingStalls` from `config`
- Change `<WashBays />` to `<WashBays count={config.washBayCount} />`
- Change `<StagingZone />` to `<StagingZone count={config.stagingStalls} />`

