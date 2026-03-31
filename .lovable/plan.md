

# Fix 2D Depot Layout — Service Bays, Labels & Staging

## Changes

### 1. `src/store/depotStore.ts` — Service bays & south staging
- **Service bays**: Move down from `y: 10` to `y: 18` so they sit within the "2 BAYS" area (y=22–40) and don't overlap the lounge (y=5–17)
  - `position: { x: 75 + i * 20, y: 10 }` → `{ x: 75 + i * 20, y: 25 }`
- **South staging stalls**: Shift up from `y: 195` to `y: 188` to clear the INGRESS/EGRESS labels at y=209

### 2. `src/components/canvas/ZoneBadges.tsx` — Move wash badge left
- Move wash badge from `x={240} y={26}` to `x={50} y={15}` — right beside the "WASH" text label at `x=30, y=15`

### 3. `src/components/canvas/DepotSVG.tsx` — Couple STAGING label with its badge
- Move "STAGING" text from `x={150} y={207}` to `x={165} y={165}` — beside the yellow 0/50 badge at `x=185, y=165`

### 4. `src/components/canvas/ZoneBadges.tsx` — Adjust staging badge position
- Move staging badge from `x={185} y={165}` to `x={195} y={165}` to leave room for the "STAGING" label to its left

## Result
- Service bay stalls fit inside the "2 BAYS" rectangle, no lounge overlap
- Blue wash badge sits beside "WASH" label on the left
- "STAGING" label coupled beside the yellow occupancy badge
- South staging row clears INGRESS/EGRESS labels

