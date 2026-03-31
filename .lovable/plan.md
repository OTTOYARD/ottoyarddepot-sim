

# Fix 2D Depot Layout Issues & Collapsible Legend

## Issues Identified

1. **Service bays (SVC-01, SVC-02)** at `{x: 235, y: 10}` and `{x: 255, y: 10}` overlap the BESS/XFMR/SWGR utility equipment footprint (x=245–288, y=5–25), making tooltips/popups unreadable. Move them left to sit inside/beside the operations building.

2. **WASH label** at `x=25, y=15` needs to move left to align over the actual wash bay stall positions at `x=15, x=31, x=47`.

3. **South-edge staging stalls** (STAGE-14 through ~37) use `angle: 60` (diagonal parallelograms). User wants them as rectangles (`angle: 0`) and shifted up slightly so they don't overlap the INGRESS/EGRESS labels at y=209–213.

4. **Legend** should be collapsible with a toggle button, sliding in/out from the left side similar to the side panel.

## Changes

### File 1: `src/store/depotStore.ts`
- **Service bays**: Move from `{x: 235 + i*20, y: 10}` to `{x: 75 + i*20, y: 10}` — inside the operations building service bay area (matching the SVG "SERVICE / 2 BAYS" label at x=70–110)
- **South staging stalls**: Change `angle` from `60` to `0` (rectangles) and shift `y` from `200` to `195` so they sit above the INGRESS/EGRESS labels

### File 2: `src/components/canvas/DepotSVG.tsx`
- Move WASH label from `x={25}` to `x={30}` (centered over the 3 wash bays spanning x=15 to x=47)
- Optionally adjust INGRESS/EGRESS label positions if still overlapping after staging shift

### File 3: `src/components/canvas/DepotLegend.tsx`
- Add state for collapsed/expanded
- Add a small toggle button (chevron icon) that shows when collapsed
- Animate the legend panel sliding in/out from the left
- When collapsed, only show the toggle button; when expanded, show full legend content

### File 4: `src/components/canvas/StallTooltip.tsx`
- Add boundary clamping so tooltip doesn't render off-screen or behind other elements (ensures readability for edge stalls)

## Files Modified
- `src/store/depotStore.ts` — service bay positions, south staging angle + y
- `src/components/canvas/DepotSVG.tsx` — WASH label position
- `src/components/canvas/DepotLegend.tsx` — collapsible with toggle button
- `src/components/canvas/StallTooltip.tsx` — tooltip boundary clamping

