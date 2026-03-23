

# Integrate NVIDIA cuOpt into SimulationEngine Scheduling

## Problem
The user wants to wire the cuOpt optimizer into the engine's scheduling loop (step 4), replacing/augmenting the existing OTTO-Q assignment logic with async NVIDIA-powered scheduling every 30 sim-seconds.

## Key Architecture Constraint
The engine loop runs synchronously via `requestAnimationFrame`. The cuOpt call is async. We cannot `await` inside the RAF loop. Instead, we'll fire-and-forget the scheduling cycle and apply assignments when the response arrives.

## Changes

### `src/engine/SimulationEngine.ts`

**Add import** at top:
```ts
import { optimizeDepotSchedule } from '@/lib/nvidia-cuopt';
```

**Add module-level state** (near constants):
```ts
let lastScheduleTime = 0;
let cuoptPending = false;
```

**Add helper function** `getServiceTime`:
```ts
function getServiceTime(stallType: string, config: SimulationConfig): number {
  const map: Record<string, number> = {
    dcfc: config.dcfcChargeTime || 25,
    l2: (config.l2ChargeTime || 4) * 60,
    wash: config.exteriorWash || 10,
    staging: 5,
  };
  return map[stallType] || 30;
}
```

**Add async function** `runSchedulingCycle` that:
- Debounces to every 30 sim-seconds
- Gathers queued vehicles and available stalls from current state
- Calls `optimizeDepotSchedule` (which falls back to local if no API key)
- Applies returned assignments by finding the vehicle and stall in current state and performing the same assignment logic (set status, waypoints, stall status) as the existing code

**Modify step 4** in the loop:
- Keep the existing synchronous OTTO-Q logic as the **immediate** assignment path
- Additionally call `runSchedulingCycle(newSimTime, config)` (non-blocking) which will apply cuOpt assignments on next tick when results arrive
- The cuOpt results override/supplement the local scheduler — vehicles already assigned won't be re-assigned

**Reset** `lastScheduleTime` and `cuoptPending` in the `reset()` method.

### No other files change

