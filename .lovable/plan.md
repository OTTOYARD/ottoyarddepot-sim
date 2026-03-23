

# Add 2D/3D View Toggle with React Three Fiber

## Overview
Install 3D packages, add `viewMode` to simulation store, add a 2D/3D toggle in the TopBar, and conditionally render either the existing SVG depot or a placeholder 3D component.

## Package Installation
- `@react-three/fiber@^8.18`
- `@react-three/drei@^9.122.0`
- `three@>=0.133`
- `@types/three` (dev)

## Files to Modify

### `src/store/simulationStore.ts`
- Add `viewMode: '2d' | '3d'` (default `'2d'`) to state interface and initial state
- Add `setViewMode` action

### `src/components/layout/TopBar.tsx`
- Add 2D/3D toggle button group between the play controls and the Settings icon
- Active button: `bg-[#C00000] text-white rounded`, Inactive: `bg-transparent text-gray-500 border border-gray-700`

### `src/components/canvas/DepotCanvas.tsx`
- Read `viewMode` from store
- Conditionally render `<DepotSVG>` (with tooltips, overlays) for 2D, or `<DepotScene3D>` for 3D
- Lazy-load DepotScene3D with `React.lazy` + `Suspense`

## Files to Create

### `src/components/canvas/DepotScene3D.tsx`
- Placeholder component: dark background div with "3D Loading..." text
- Exported as default for lazy loading

