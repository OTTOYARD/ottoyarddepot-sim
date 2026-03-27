

# Redesign Staging as 50 Parking Spaces + Add 2 Service Bays

## Overview
Replace the current glowing-ring staging zone with 50 realistic parking stalls distributed around the depot perimeter, and add 2 service/maintenance bays attached to the main building.

## Changes

### 1. Rewrite `StagingZone.tsx` — 50 parking spaces around depot perimeter
Replace the current torus-ring layout with actual parking space markings (white lane lines, asphalt pads) arranged in rows along the left, right, and front edges of the depot — away from chargers but clearly visible.

Layout:
- **Left side** (X ≈ -120, Z from -60 to 60): 20 spaces in a single row, angled 60°
- **Right side** (X ≈ 120, Z from -60 to 60): 20 spaces in a single row, angled 60°  
- **Front/south edge** (Z ≈ 85, X from -60 to 60): 10 spaces in a row

Each space gets:
- Asphalt pad (shared per row, one mesh)
- White lane marking lines (like the existing charging stall dividers)
- A small "STAGE-XX" number painted on the ground (teal accent line at front of space)
- No charger pedestal — just an empty parking bay

This mirrors the visual style of the charging stalls (lane lines, concrete/asphalt surface) but without any equipment.

Accept `count` prop (default 50) and distribute proportionally across the 3 edges.

### 2. Add `ServiceBays.tsx` — 2 maintenance bays on building
New component attached to the main building (which is at Z=-90). Position two enclosed bays on the **right side** of the building facade (X ≈ 35 and X ≈ 50), similar in style to `WashBays` but labeled "SERVICE BAY":

Each bay:
- Dark cladding walls (same as building), 14×6×12 units
- Roll-up door frame with aluminum trim on the front (facing Z=-72)
- Interior dark opening
- Teal LED strip above door
- Interior emissive light mesh
- Concrete floor pad

Label: "SERVICE / MAINTENANCE" via Html overlay.

### 3. Update `DepotScene3D.tsx`
- Import and render `<ServiceBays />` next to `<DepotBuilding />`
- Keep `<StagingZone count={config.stagingStalls} />` (which now renders parking spaces)

### 4. Update `depotStore.ts`
- Add `serviceBayCount: 2` to state
- Add `'service'` to `StallType` union
- Generate 2 service bay stalls in `generateStalls()`
- Update `regenerateStalls` to accept service bay count

### 5. Update `simulationStore.ts`
- Add `serviceBayCount: 2` to `SimulationConfig` interface and defaults

## Files to create/modify
- **Create**: `src/components/canvas/three/ServiceBays.tsx`
- **Modify**: `src/components/canvas/three/StagingZone.tsx` (full rewrite)
- **Modify**: `src/components/canvas/DepotScene3D.tsx` (add ServiceBays import/render)
- **Modify**: `src/store/depotStore.ts` (add service type + stalls)
- **Modify**: `src/store/simulationStore.ts` (add serviceBayCount config)

## Technical details
- Parking spaces use shared materials from `MATERIALS` (asphalt, laneMarkingWhite, laneMarkingTeal) — no new materials needed
- Each row of parking spaces shares one asphalt pad mesh to minimize draw calls
- Lane divider lines use the same pattern as `DepotGround` white lane markings
- Service bays reuse the same architectural style as `WashBays` (dark cladding, aluminum frames, teal LED strips) but positioned flush against the building

