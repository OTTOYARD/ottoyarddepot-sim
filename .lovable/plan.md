

# Final Polish, Branding & Demo Mode

## Overview
Apply OTTOYARD branding, loading states, demo mode, responsive behavior, keyboard shortcuts, canvas enhancements, and meta tags.

## Files to Create

### 1. `src/store/demoStore.ts`
Zustand store:
- `isDemoMode: boolean`
- `isLoading: boolean` (for startup overlay)
- `isSaving: boolean` (for save indicator)
- Actions: `enterDemo`, `exitDemo`, `setLoading`, `setSaving`

### 2. `src/components/canvas/LoadingOverlay.tsx`
Full-screen overlay on canvas with pulsing hexagon logo + "Initializing Fleet Command..." text. Shown for 1.5s when simulation starts. Fades out via CSS transition.

### 3. `src/components/canvas/DemoBanner.tsx`
Semi-transparent banner at top of canvas: "DEMO MODE — OTTOYARD Depot Simulation" with "Exit Demo" button. Only rendered when `isDemoMode`.

### 4. `src/components/canvas/CanvasWatermark.tsx`
Low-opacity hexagon SVG centered in canvas. Subtle animated gradient border around depot perimeter that pulses when running.

### 5. `src/hooks/useKeyboardShortcuts.ts`
Global keyboard listener (useEffect in App):
- Space: play/pause, R: reset, D: demo toggle, P: panel toggle
- 1-5: switch tabs, +/-: speed adjust
- Only fires when no input/textarea is focused.

### 6. `src/components/layout/ResponsiveGuard.tsx`
- `< 900px`: Full-screen message "For the best experience, use a desktop browser..."
- `< 1200px`: Auto-collapse side panel, show floating toggle button
- Uses `useIsMobile` pattern with ResizeObserver.

### 7. `public/favicon.svg`
Small red hexagon SVG for favicon.

## Files to Modify

### `index.html`
- Title: "OTTOYARD | Depot Simulator"
- OG tags: title "OTTOYARD Depot Simulator", description "AI-powered fleet depot simulation platform..."
- Favicon link to `/favicon.svg`

### `src/components/layout/TopBar.tsx`
- Replace text "OTTOYARD" with inline hexagon SVG (28px) + "OTTOYARD" in bold 20px otto-red tracking-[2px]
- Add tagline "Depot Simulation Platform" in 10px otto-gray, hidden on narrow screens
- Add "Demo Mode" button (Presentation icon) left of play/pause
- Add saving indicator (spinner → checkmark) when `isSaving`
- Wire demo mode: sets config, speed 30x, opens KPIs tab, starts sim

### `src/store/simulationStore.ts`
- Add `controlsLocked: boolean` field + `setControlsLocked` action

### `src/components/tabs/ControlsTab.tsx`
- When `controlsLocked` (demo mode), add `pointer-events-none opacity-50` to all controls
- Show a small "Controls locked during demo" notice

### `src/components/tabs/AISummaryTab.tsx`
- Replace loading spinner with typing indicator (three pulsing dots) when `isLoadingObservation`

### `src/components/canvas/DepotCanvas.tsx`
- Add `<LoadingOverlay />`, `<DemoBanner />`, `<CanvasWatermark />`
- The watermark and animated border go inside/around the SVG container

### `src/components/canvas/DepotSVG.tsx`
- Add low-opacity hexagon watermark at center (SVG element)
- Add animated gradient border `<rect>` around depot perimeter, conditional on simulation running
- Add shimmer effect on solar canopy dashed outline during daytime (6AM-6PM)

### `src/App.tsx`
- Add `useKeyboardShortcuts()` hook
- Wrap with `<ResponsiveGuard>`

### `src/index.css`
- Add keyframes: `typing-dot` pulse for AI loading dots
- Add keyframes: `border-glow` for depot perimeter animation
- Add keyframes: `shimmer` for solar canopy

### `tailwind.config.ts`
- Add new animation entries for `border-glow`, `typing-dot`

## Demo Mode Flow
1. User clicks "Demo Mode" → `demoStore.enterDemo()`
2. Set preset config (50 fleet, 150 consumer, Priority-Weighted, 10 DCFC / 40 L2)
3. Lock controls (`controlsLocked = true`)
4. Show loading overlay for 1.5s
5. Set speed to 30x, open KPIs tab
6. Auto-start simulation
7. Show demo banner on canvas
8. "Exit Demo" → unlock controls, hide banner, sim keeps running

## Key Details
- Keyboard shortcuts ignore events when user is typing in inputs
- Responsive guard uses `window.innerWidth` with resize listener
- Canvas watermark is pure SVG, no extra DOM
- Demo config values match the spec exactly
- Saving indicator subscribes to `demoStore.isSaving`, set by `runPersistence.saveRun()`

