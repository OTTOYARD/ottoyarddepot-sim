

# Move L2 CHARGING Label Above the Stalls

## Change
In `src/components/canvas/DepotSVG.tsx`, move the "L2 CHARGING" text label from `y={115}` (middle of the L2 zone, where stalls cover it) to `y={72}` — just above the L2 charging area so it's clearly visible and not overlapped by stall elements.

## File: `src/components/canvas/DepotSVG.tsx` (line 123)
```
// Before
<text x={150} y={115} ...>L2 CHARGING</text>

// After
<text x={150} y={72} ...>L2 CHARGING</text>
```

One-line change.

