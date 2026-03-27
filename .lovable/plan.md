

# Fix Wash Bay Positions & 2D Staging U-Shape

## Summary
Three issues to fix:
1. **Wash bay 2D positions** were moved from their original location near the building — revert them back
2. **Vehicles assigned to wash** need to render inside the physical 3D wash bay structures, not at the 2D-converted position
3. **2D staging stalls** still render in a linear row — update to match the U-shaped 3D perimeter layout

## Changes

### File 1: `src/store/depotStore.ts`

**Wash stalls** — revert 2D positions from `{x: 230 + i*16, y: 170}` back to original `{x: 200 + i*16, y: 33}` (near building/operations area in the 2D view, where they were before).

**Staging stalls** — replace the single linear row at `y: 172` with a U-shaped distribution matching the 3D layout:
- West side (stalls 1–26): `x ≈ 20`, `y` distributed from ~50 to ~195
- South edge (stalls 27–73): `y ≈ 200`, `x` distributed from ~20 to ~280
- East side (stalls 74–100): `x ≈ 280`, `y` distributed from ~195 to ~50

This uses the same `toWorld` coordinate mapping in reverse: 3D `X=-130` → 2D `x=20`, 3D `Z=90` → 2D `y=20`, etc.

### File 2: `src/components/canvas/three/Vehicle3D.tsx`

For vehicles with status `washing` or assigned to a `WASH-*` stall, override the target 3D position to use the actual WashBays world coordinates: `[80 + (bayIndex) * 16, 0, -60]` instead of converting from the 2D stall position via `toWorld()`.

This way:
- The 2D map shows wash bays where they originally were (near the building)
- The 3D scene parks vehicles inside the physical wash bay structures

### File 3: `src/components/canvas/DepotSVG.tsx`

Update the WASH and STAGING labels to match the new positions if needed (WASH label stays near top-right, STAGING label repositioned to reflect U-shape).

## Files Modified
- `src/store/depotStore.ts` — revert wash 2D coords, update staging to U-shape
- `src/components/canvas/three/Vehicle3D.tsx` — wash bay 3D position override
- `src/components/canvas/DepotSVG.tsx` — label adjustments if needed

