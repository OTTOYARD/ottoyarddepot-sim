

# Simulation Engine Implementation

## Overview
Build a discrete-event simulation engine that spawns vehicles, queues them via OTTO-Q scheduling algorithms, assigns them to stalls, runs service timers, and moves vehicles through a complete lifecycle — all driven by `requestAnimationFrame` and the speed multiplier.

## Files to Create

### 1. `src/engine/types.ts` — Vehicle & service types
- `Vehicle` interface (id, type, priority, batteryCapacity, currentSoC, targetSoC, status, assignedStall, serviceQueue, currentServiceIndex, serviceStartTime, arrivalTime, position, targetPosition)
- `ServiceType` union: `'dcfc_charge' | 'l2_charge' | 'exterior_wash' | 'interior_detail' | 'maintenance' | 'staging'`
- Vehicle status union: `'approaching' | 'queued' | 'charging' | 'washing' | 'detailing' | 'maintenance' | 'staging' | 'departing'`

### 2. `src/engine/scheduling/fifo.ts`
Score = negative arrival time (earlier = higher score).

### 3. `src/engine/scheduling/priorityWeighted.ts`
Score = `(priority * 3) + (waitTime / 60) + (fleet ? 5 : 0) + (elite ? 3 : concierge ? 1 : 0)`.

### 4. `src/engine/scheduling/socOptimized.ts`
Score = `(100 - currentSoC) + (priority * 2)`.

### 5. `src/engine/scheduling/revenueMax.ts`
Fleet first, then Elite > Concierge > Core. Within tier, FIFO.

### 6. `src/engine/scheduling/index.ts`
Exports a `getScheduler(algorithm: string)` function that returns the appropriate scoring function.

### 7. `src/engine/ArrivalGenerator.ts`
- `shouldSpawnVehicle(simTime, config, existingCount)` — returns vehicles to spawn this tick
- **Staggered Blocks:** Fleet vehicles in groups during DCFC block window, consumers spread outside
- **Continuous:** Steady rate throughout the day
- **Overnight Batch:** 80% fleet between 22:00-02:00, consumers daytime only
- Randomizes vehicle properties (SoC, battery capacity, service queue) based on config

### 8. `src/engine/SimulationEngine.ts` — Core engine class
- Holds `rafId`, `lastTimestamp`, reference to stores
- `start()`: begins rAF loop, sets status to 'running'
- `stop()`: cancels rAF, sets status to 'paused'
- `reset()`: clears vehicles, resets time, resets stalls
- `tick(timestamp)`: the per-frame function:
  1. Calculate `deltaSimSeconds = (realDeltaMs / 1000) * simSpeed`
  2. Advance `simTime`
  3. Call ArrivalGenerator for new spawns
  4. Run OTTO-Q: find queued vehicles, score them, match to available stalls
  5. Update service timers — decrement remaining time for occupied stalls
  6. Handle service completion — advance to next service or depart
  7. Animate vehicle positions (lerp toward target)
  8. Sync stall statuses to depotStore
  9. Update KPI counters

### 9. `src/store/vehicleStore.ts` — New Zustand store for vehicle state
- `vehicles: Vehicle[]`
- `vehiclesProcessed: number`
- `queueDepth: number`
- Actions: `addVehicle`, `removeVehicle`, `updateVehicle`, `updateVehicles` (batch), `reset`
- Kept separate from simulationStore to avoid excessive re-renders

## Files to Modify

### `src/store/simulationStore.ts`
- No new vehicle state here (it stays in vehicleStore)
- The `resetConfig` action will also call engine reset

### `src/components/layout/TopBar.tsx`
- Wire Play/Pause to `engine.start()`/`engine.stop()`
- Wire Reset to `engine.reset()`

### `src/components/tabs/ControlsTab.tsx`
- Wire Run/Pause button to engine start/stop
- Wire Reset button to engine reset

### `src/components/canvas/DepotSVG.tsx`
- Render vehicle dots from vehicleStore — small colored circles at each vehicle's position
- Fleet = teal dot, consumer tiers = varying shades

### `src/components/canvas/DepotCanvas.tsx`
- Import and instantiate engine via a `useEffect` that creates/destroys the engine singleton

## Engine Singleton Pattern
The engine is instantiated once in `DepotCanvas` via `useEffect`. It reads from stores directly (not via hooks) using `useSimulationStore.getState()` and `useDepotStore.getState()`. It writes to stores via their actions. This avoids React render coupling in the hot loop.

## Key Calculations
- **Charge time:** `(targetSoC - currentSoC) / 100 * batteryCapacity / chargerPower * 60` minutes, clamped to config min/max
- **Vehicle position lerp:** Move 2 units/sim-second toward target position
- **Spawn rate:** Derived from `activeFleetSize` and `activeConsumerMembers` spread across configured arrival windows

## Technical Details
- Stall positions from depotStore are used as target positions for assigned vehicles
- Ingress gate position: `{x: 100, y: 215}`, Egress: `{x: 200, y: 215}`
- Queue area positions: spread along staging zone y~175
- Service-to-stall type mapping: `dcfc_charge → dcfc`, `l2_charge → l2`, `exterior_wash/interior_detail → wash`, `staging → staging`

