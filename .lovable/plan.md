

# Replace DepotGround with Simplified Version

## Overview
Replace the current `DepotGround` component (which uses `toWorld`, `Html`, refs, gridHelper, and detailed road/ingress/egress markers) with a cleaner, simpler version using only basic mesh planes.

## Changes

### `src/components/canvas/three/DepotGround.tsx` — Full replace
Replace entire file with user's provided code:
- Main dark ground plane (300×220)
- Lighter inner depot area (220×120, offset z=10)
- Two green landscape strips at x=±145
- South green border at z=-105
- Road strip at z=-115
- No more `toWorld`, `Html`, `useRef`, gridHelper, ingress/egress markers, or dashed road lines

Single file change, no other files affected.

