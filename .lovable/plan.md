

# Reposition L2 CHARGING Label and Badge

## Changes

### `src/components/canvas/DepotSVG.tsx` (line 123)
Move "L2 CHARGING" label from `y={72}` to `y={80}` — below DCFC stalls (y=57) and above L2 rows (y=85).

### `src/components/canvas/ZoneBadges.tsx`
Move the L2 badge from `x={185} y={113}` to `x={210} y={78}` — placing it right beside the "L2 CHARGING" label text at the same vertical level.

Two one-line changes.

