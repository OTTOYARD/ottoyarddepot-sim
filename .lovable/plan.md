

# Depot Canvas — Full 2D SVG Rendering

## Overview
Replace the DepotCanvas placeholder with an interactive SVG-based top-down depot layout (~300x220ft) showing all zones, stalls, buildings, and infrastructure.

## Files to Create

### 1. `src/store/depotStore.ts` — Depot state (Zustand)
- `StallState` interface: id, type, status, vehicleId, position (x, y, angle)
- `DepotConfig` interface: counts + stalls array
- `selectedStallId: string | null` for click selection
- `hoveredStallId: string | null` for tooltip
- `initStalls()` — generates all 68 stalls with calculated positions:
  - 10 DCFC (y: 40-75, single row)
  - 40 L2 (y: 75-155, 4 rows of 10)
  - 3 Wash (y: 25-45, right of building)
  - 15 Staging (y: 155-190, single row)
- All stalls start as `available`
- `setStallStatus(id, status)` action
- `selectStall(id)` / `clearSelection()` actions

### 2. `src/components/canvas/Stall.tsx` — Reusable SVG stall component
- Props: StallState data
- Renders a parallelogram (60° angle) via `<polygon>` with transform
- Status-based fill: available=15% type color, occupied=50%, charging=80% + CSS pulse, servicing=blue 60%, offline=red + crosshatch `<pattern>`, reserved=amber outline only
- Hover: sets hoveredStallId in store
- Click: sets selectedStallId in store
- Small label text showing stall ID

### 3. `src/components/canvas/DepotSVG.tsx` — Main SVG depot layout
- SVG viewBox="0 0 300 220", preserveAspectRatio="xMidYMid meet"
- **Defs section**: crosshatch pattern, pulse animation keyframes
- **Grid background**: 10ft grid lines at ~5% opacity
- **Layers rendered bottom-to-top**:
  - Street/road strip (y: 215-220, dark gray)
  - Gates: Ingress (x=100) and Egress (x=200) markers with labels + arrows
  - Landscape buffer (y: 190-200, green strip)
  - Drive aisles (24ft wide, #333, directional arrows)
  - Staging zone stalls (15x, amber)
  - L2 charging field stalls (40x, teal) + dashed solar canopy rect
  - DCFC charging field stalls (10x, red)
  - Operations building (70x50ft, #3A3A3A, white border, internal subdivisions)
  - Wash bays (3x, blue)
  - Utility zone: BESS, Transformer, Switchgear rectangles (#9E9E9E, labeled)
  - Zone labels (colored text per spec)
- Iterates over `stalls` from depotStore, renders `<Stall>` for each

### 4. `src/components/canvas/StallTooltip.tsx` — Hover tooltip
- HTML overlay positioned based on SVG coordinates (using a ref to convert SVG→screen coords)
- Shows: stall ID, type badge, status, vehicle info placeholder

### 5. `src/components/canvas/StallPopup.tsx` — Click popup card
- Small card overlay near the clicked stall
- Shows detailed info + close button

### 6. `src/components/canvas/DepotLegend.tsx` — Floating legend
- Positioned bottom-left of canvas (HTML overlay)
- Color swatches: DCFC (red), L2 (teal), Wash (blue), Staging (amber)
- Status indicators: available, occupied, charging, servicing, offline, reserved

### 7. Update `src/components/canvas/DepotCanvas.tsx`
- Replace placeholder with `<DepotSVG />`, `<DepotLegend />`, tooltip/popup overlays
- Keep BottomBar at bottom
- Container uses `relative` for overlay positioning

## Position Calculation Logic
For 60° angled stalls in a row at base y, spacing ~9ft apart:
- `x = startX + i * stallSpacing`
- `y = rowBaseY`
- `angle = 60`
- Polygon points calculated from angle + stall dimensions (9w x 18d)

## Styling
- Pulse animation for "charging" status via CSS `@keyframes` in `index.css`
- Crosshatch SVG pattern defined in `<defs>`
- All zone fills use rgba for specified opacities

