

# Vehicle Rendering & Animation

## Overview
Replace the simple circle vehicle dots with rich VehicleDot components featuring car-shaped rounded rectangles, status-based animations, vehicle tooltips, and zone occupancy badges.

## Files to Create

### 1. `src/components/canvas/VehicleDot.tsx` — Memoized SVG vehicle component
- Rounded rect (8x5 units) oriented by travel direction, colored by type (fleet=#00B4A6, core=#FFFFFF, concierge=#C0C0C0, elite=#FFD700)
- Darker stroke derived from fill color
- Opacity: 0.9 default, 0.6 for queued/staging
- Status effects via SVG animations:
  - **Charging**: `<animateTransform>` pulse (scale 1.0→1.1), plus a small teal glow `<circle>` with animated opacity
  - **Washing**: Expanding/fading ripple rings using `<circle>` with `<animate>` on r and opacity
  - **Approaching**: fade-in via `<animate>` on opacity from 0→0.9
  - **Departing**: fade-out via `<animate>` on opacity from 0.9→0
  - **Queued**: small clock icon (tiny SVG circle+hands) badge offset from vehicle
- Rotation: calculate angle from position→targetPosition, or default 0 (facing north)
- Wrapped in `React.memo` comparing id, position.x, position.y, status, currentSoC

### 2. `src/components/canvas/VehicleTooltip.tsx` — Hover tooltip for vehicles
- HTML overlay positioned via SVG→screen coordinate transform (same pattern as StallTooltip)
- Shows: vehicle ID, type with color dot, mini battery bar (red <20%, amber 20-50%, teal 50%+), status + remaining service time, services completed/total
- Add `hoveredVehicleId` to vehicleStore

### 3. `src/components/canvas/ZoneBadges.tsx` — Zone occupancy counters
- SVG `<g>` elements positioned in each zone showing "occupied/total" counts
- DCFC badge (red) near zone label, L2 badge (teal), Wash (blue), Staging (amber), Queue (white)
- Reads from vehicleStore (vehicles by status/assignedStall) and depotStore (stall counts)
- Memoized, recalculates only when vehicles array reference changes

## Files to Modify

### `src/store/vehicleStore.ts`
- Add `hoveredVehicleId: string | null` and `setHoveredVehicle(id)` action

### `src/components/canvas/DepotSVG.tsx`
- Replace the simple `<circle>` vehicle rendering with `<VehicleDot>` components
- Add `<ZoneBadges />` after zone labels
- Remove inline VEHICLE_COLORS constant (moved to VehicleDot)

### `src/components/canvas/DepotCanvas.tsx`
- Add `<VehicleTooltip svgRef={svgRef} />` alongside existing tooltips

### `src/engine/SimulationEngine.ts`
- Increase LERP_SPEED from 4 to 30 SVG units per sim-second (per spec)
- Add waypoint-based pathing: vehicles move to left aisle (x:30) first when approaching, right aisle (x:275) when departing, rather than direct diagonal movement
- Add `waypoints: {x,y}[]` field usage — when targetPosition is reached and waypoints remain, pop next waypoint as new target

### `src/engine/types.ts`
- Add optional `waypoints?: {x:number; y:number}[]` to Vehicle interface
- Add optional `opacity?: number` for fade in/out tracking

## Movement Path Logic (in SimulationEngine)
- **Approaching**: Spawn at ingress (100,215) → waypoint to left aisle (30, 215) → north along aisle (30, QUEUE_Y) → queue position
- **Assigned to stall**: queue pos → left aisle x:30 at current y → left aisle x:30 at stall y → stall position
- **Departing**: stall → right aisle x:275 at stall y → south along aisle (275, 215) → egress (200, 215)
- Engine pops waypoints sequentially as each is reached

## Performance
- VehicleDot: `React.memo` with shallow compare on id + position + status + currentSoC
- ZoneBadges: `React.memo`, derives counts via `useMemo`
- VehicleTooltip: only renders when hoveredVehicleId is set

