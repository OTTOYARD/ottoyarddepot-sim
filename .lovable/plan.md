

# Redesign Staging Zone as a Continuous U-Shape

## Problem
- Stalls 25–50 extend off the depot asphalt (right/east row goes too far)
- Stalls 66–100 are placed near the operations center / building instead of on the opposite side
- Stalls are not in chronological order around the perimeter

## Solution
Replace the current 5-segment layout with a single continuous **U-shaped path** that traces the asphalt perimeter chronologically from stall 1 to 100, avoiding the building (X ∈ [-60,60] at Z≈-90) and wash bays (X=80, Z=-60).

### U-Path (top-down, tracing clockwise from northwest)

```text
        BUILDING (avoid)
    ┌───────────────────────┐
    │  ← stalls go north    │
    │                        │
    │ East side (74-100)     │
    │                        │
    │                        │ Wash bays (interior, clear)
    │                        │
    └────────────────────────┘
         South edge (27-73)
    ┌────────────────────────┐
    │                        │
    │ West side (1-26)       │
    │  ↓ stalls go south     │
    │                        │
    └────────────────────────┘
```

**Segment 1 — West side (stalls 1–26):** X=-130, Z from -60 → +85 (going south), direction='z', ~26 stalls  
**Segment 2 — South edge (stalls 27–73):** Z=+90, X from -130 → +130 (going east), direction='x', ~47 stalls  
**Segment 3 — East side (stalls 74–100):** X=+130, Z from +85 → -60 (going north), direction='z' reversed, ~27 stalls

### Key changes in `src/components/canvas/three/StagingZone.tsx`
- Remove all 5 current rows
- Compute 3 U-segments with stall counts proportional to edge length
- For the east side (segment 3), reverse the Z-direction so numbering continues chronologically from south to north
- Each stall remains within the asphalt pad (300×220, edges at X=±150, Z=±110)
- All stalls stay well inside curbing at X=±130, Z≈±90
- No stalls near the building zone (north center) or overlapping wash bays

### Files modified
- `src/components/canvas/three/StagingZone.tsx` — complete rewrite of row layout logic

