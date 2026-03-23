

# Create 3D Coordinate Utility

## Overview
Create `src/components/canvas/three/coordUtils.ts` — a utility that converts 2D SVG coordinates (0-300 x, 0-220 y) into 3D world coordinates centered at the origin. This is foundational for mapping all existing depot positions (stalls, vehicles, ingress/egress) into the upcoming 3D scene.

## File to Create

### `src/components/canvas/three/coordUtils.ts`
Exactly as provided — a `toWorld` function that:
- Takes a 2D position `{x, y}` and optional height
- Returns `[x3d, y3d, z3d]` tuple: `x - 150`, `height`, `110 - y`
- Centers the 300×220 SVG coordinate space at the 3D origin

One new file, no modifications to existing files.

