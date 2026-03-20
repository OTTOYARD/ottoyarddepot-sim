

# Build ControlsTab with Accordion Sections

## Overview
Replace the placeholder ControlsTab with a fully functional controls panel containing 6 collapsible accordion sections, all wired to a new `config` object in the simulation store.

## Files to Modify/Create

### 1. `src/store/simulationStore.ts` — Add config object
Add a `SimulationConfig` interface with all ~45 variables organized by section (fleet, consumer, infrastructure, serviceTimes, environment, simControl). Add `config` state and `updateConfig(partial)` action. Infrastructure count changes (`dcfcCount`, `l2Count`, `washBayCount`, `stagingCount`) will also call `useDepotStore`'s regeneration logic. `simSpeed` changes sync to the existing top-level `simSpeed`.

### 2. `src/store/depotStore.ts` — Add regenerateStalls action
Expose `generateStalls` as a parameterized function accepting counts, and add a `regenerateStalls(dcfc, l2, wash, staging)` action that rebuilds the stalls array and updates counts.

### 3. `src/components/tabs/ControlsTab.tsx` — Full rebuild
Scrollable container with 6 `Accordion` sections (using shadcn Accordion). Each section header: otto-charcoal bg, white text, 3px otto-red left border, lucide icon + label.

**Controls inside each section** use compact layout (8px gaps, text-xs gray labels, white values):
- **Sliders**: shadcn Slider with custom teal track / red thumb styles (via CSS overrides in index.css targeting Radix slider parts)
- **Dropdowns**: shadcn Select with dark bg styling
- **Toggles**: shadcn Switch
- **Tier Mix**: 3 linked sliders with proportional adjustment logic
- **Time pickers**: Two simple HH:MM inputs for DCFC block schedule

**Section 6** includes the Run/Pause button (full-width, otto-red bg), Reset (ghost), and Inject Incident (amber outline).

### 4. `src/index.css` — Slider styling overrides
Add CSS for Radix slider track (otto-teal) and thumb (otto-red) to match the design spec. Style Select dropdown with dark background.

## Key Behaviors
- All control changes immediately update `simulationStore.config`
- Infrastructure slider changes (DCFC/L2/Wash/Staging counts) call `depotStore.regenerateStalls()` to re-render the canvas
- Sim speed slider syncs to `simulationStore.simSpeed` (updates TopBar display)
- Run button sets `status: 'running'`, toggles to Pause when running
- Tier mix sliders: when one changes, redistribute the difference proportionally across the other two, always summing to 100

## Component Structure
```text
ControlsTab
└── ScrollArea
    └── Accordion (type="multiple", defaultValue=all open)
        ├── Section 1: Fleet Configuration (Truck icon)
        ├── Section 2: Consumer/VIP (Users icon)
        ├── Section 3: Infrastructure (Zap icon)
        ├── Section 4: Service Times (Clock icon)
        ├── Section 5: Environment & Ops (Cloud icon)
        └── Section 6: Simulation Control (Play icon)
```

Each control row: `<div className="flex items-center justify-between gap-2">` with label left, control + value right.

