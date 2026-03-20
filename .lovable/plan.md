

# L2 Charger Utilization & DCFC/L2 Overflow

## Problem
1. **Fleet vehicles always use DCFC** — never L2, even when all 10 DCFC stalls are occupied and 40 L2 stalls sit empty
2. **No overflow logic** — vehicles wait indefinitely in queue for their assigned charger type instead of falling back
3. **Consumer split is fixed at 30/70 DCFC/L2** — no user control over the mix

## Changes

### `src/engine/ArrivalGenerator.ts` — Smarter service queue assignment
- Fleet vehicles: Use SoC to decide charger type. If SoC > 40%, assign `l2_charge` instead of always `dcfc_charge` (~30% of fleet will naturally go L2)
- Consumer vehicles: Use config-driven DCFC/L2 ratio instead of hardcoded 30%
- Add `dcfcVsL2Ratio` to SimulationConfig (0-100 slider, default 30 = "30% DCFC / 70% L2")

### `src/engine/SimulationEngine.ts` — DCFC→L2 overflow
In step 4 (stall assignment), after failing to find an available stall of the needed type:
- If the needed service is `dcfc_charge` and no DCFC stalls are available, check for available `l2` stalls
- If found, reassign the vehicle's current service to `l2_charge` and assign the L2 stall
- This creates natural overflow behavior — DCFC fills up, vehicles spill into L2

### `src/store/simulationStore.ts`
- Add `dcfcVsL2Ratio: number` (default 30) to `SimulationConfig` and `defaultConfig`

### `src/components/tabs/ControlsTab.tsx`
- Add a slider in the Fleet section: "DCFC / L2 Split" (0-100, where value = % preferring DCFC)
- Label shows e.g. "30% DCFC / 70% L2"

### `src/engine/scheduling/priorityWeighted.ts` (and other schedulers)
- No changes needed — overflow is handled at the assignment level, not scoring

## Behavior Summary
```text
Vehicle arrives → buildServiceQueue assigns charger type based on:
  - Fleet: SoC ≤ 40% → DCFC, else L2
  - Consumer: random based on dcfcVsL2Ratio slider

Vehicle queued → engine tries to assign matching stall
  - If DCFC needed but none available → overflow to L2 stall
  - If L2 needed but none available → wait (L2 has 40 stalls, unlikely)
```

This means L2 stalls get used both by direct assignment AND by DCFC overflow, creating the natural utilization pattern you're looking for.

