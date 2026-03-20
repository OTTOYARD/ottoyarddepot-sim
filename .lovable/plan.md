

# OTTOYARD Depot Simulator

## Overview
A full-viewport fleet depot simulation tool with three main zones: top bar, simulation canvas, and collapsible side panel.

## What We'll Build

### Custom Color Palette
Add otto-charcoal, otto-red, otto-teal, otto-amber, otto-white, otto-gray, and otto-dark as Tailwind custom colors.

### Dependencies
- **Zustand** for state management
- **Recharts** (installed, not used yet)
- **Supabase client** (configured, tables later)

### Zustand Store (`simulationStore.ts`)
Manages simulation status (idle/running/paused), sim time, speed multiplier, panel visibility, active tab, and a `tick()` action to advance time.

### Layout Components

1. **TopBar** (h-14, fixed top) — "OTTOYARD" branding + status pill, monospace clock + speed indicator, play/pause/reset/settings buttons. Dark background with red bottom border.

2. **DepotCanvas** (fills remaining space) — Dark placeholder with "Depot Canvas — Prompt 2" message. Resizes smoothly when side panel toggles.

3. **SidePanel** (w-[420px], collapsible right) — Chevron toggle tab, 300ms slide transition, contains TabBar with 5 tabs (Controls, KPIs, AI Summary, Alerts, History) with red underline active state.

4. **BottomBar** (h-12, bottom of canvas) — Timeline slider (0–24h) with teal track and red thumb, time labels on both sides.

5. **Tab placeholder components** — ControlsTab, KPIsTab, AISummaryTab, AlertsTab, HistoryTab — each showing centered placeholder text.

### Supabase Client
Set up `lib/supabase.ts` with client initialization (env vars for URL and anon key).

### Layout Strategy
Full viewport flex layout, no scrollbars. Canvas area flexes between top bar and fills remaining space. Side panel collapse smoothly resizes canvas via CSS transition.

