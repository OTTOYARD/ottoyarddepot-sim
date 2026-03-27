

# Fix Staging Stall Placement — Align to Depot Perimeter

## Problem
- Back-right staging row (X=85, Z=-75) overlaps with wash bays (X=80, Z=-60)
- Back-left staging row (X=-85, Z=-75) is too far inward
- Some staging rows extend through charging stall areas
- Staging needs to be along the **outer edge of the asphalt perimeter**, not mixed into the interior

## Depot Layout Reference
- Asphalt pad: 300×220, centered at origin → edges at X=±150, Z=±110
- Curbing: X=±140, Z=±100
- Building/lounge: roughly X ∈ [-60, 60], Z ≈ -72 to -108 (north side)
- Wash bays: X=80, Z=-60
- Charging fields: central area (X ≈ -105 to +95, Z ≈ -35 to +53)
- Service bays: attached to building on right side

## Fix: `src/components/canvas/three/StagingZone.tsx`

Reposition all 5 rows to hug the perimeter, just inside the curbing at X=±130 and Z=±90, with the building exclusion zone maintained:

| Row | Position | Direction | Notes |
|-----|----------|-----------|-------|
| Left/west | X=-130, Z from -80 to +80 | along Z | Far west edge, clear of chargers |
| Right/east | X=+130, Z from -80 to +80 | along Z | Far east edge, clear of wash bays |
| Front/south | Z=+90, X centered | along X | South perimeter |
| Back-left wing | X=-130 to -70, Z=-90 | along X | North perimeter, west of building |
| Back-right wing | X=+70 to +130, Z=-90 | along X | North perimeter, east of building |

Key changes:
- Move left/right rows from X=±120 to X=±130 (closer to curb)
- Move back wings from vertical (Z-direction) rows at X=±85 to **horizontal (X-direction) rows along Z=-90** on either side of the building gap
- Keep front row at Z=90 (just inside south curbing)
- All rows now trace the asphalt perimeter with no interior overlap

## Files Modified
- `src/components/canvas/three/StagingZone.tsx` — update all 5 row origin positions and directions

