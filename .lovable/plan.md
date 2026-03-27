

# Scale Up Charging Pedestals 2.5×

## What changes
**File**: `src/components/canvas/three/ChargingField.tsx`

Wrap the entire `ChargerPedestal` group in a `<group scale={[2.5, 2.5, 2.5]}>` so all parts (body, base, screen, cable, bollards, LED) scale uniformly without needing to edit every individual geometry dimension. The cable curve control points remain internal to the scaled group so they scale correctly too.

Adjust the outer positioning so scaled chargers don't clip into the ground — raise the group's Y origin by a small offset if needed.

No other files change. This is a one-line scale wrapper.

## Technical detail
- Current charger body is `0.45 × 1.36 × 0.3` units, topping out at Y≈1.6
- At 2.5× scale: effective size becomes `1.125 × 3.4 × 0.75`, height ≈4.0 — clearly visible from bird's-eye camera
- The `OfflineBeacon` sphere also scales proportionally
- Bollard spacing scales with the group so proportions stay correct

## Note on AI API
This is a straightforward scale change — no external API call needed. Using an AI model to determine a scale factor would add latency without benefit here.

