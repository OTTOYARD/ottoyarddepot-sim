import type { ElementType } from "react";
import { Activity, AlertTriangle, BatteryWarning, Gauge, Snowflake, Sun } from "lucide-react";

/**
 * Curated quick-launch scenarios, shared by the desktop Control tab and the phone's
 * Start sheet. A chip is hidden if its deck isn't in the backend scenario list.
 * busy_day leads: it is the scenario the engine is validated on, and the default.
 */
export interface FeaturedScenario { code: string; label: string; icon: ElementType; tint: string }

export const FEATURED: FeaturedScenario[] = [
  { code: "busy_day",                    label: "Busy Day",       icon: Gauge,          tint: "text-brand-red" },
  { code: "normal_day",                  label: "Normal Day",     icon: Activity,       tint: "text-ink-dim" },
  { code: "heat_wave",                   label: "Heat Wave",      icon: Sun,            tint: "text-brand-hot" },
  { code: "winter_storm",                label: "Winter Storm",   icon: Snowflake,      tint: "text-state-info" },
  { code: "dr_event_cascade",            label: "DR Cascade",     icon: BatteryWarning, tint: "text-state-warn" },
  { code: "charger_outage_morning_rush", label: "Charger Outage", icon: AlertTriangle,  tint: "text-state-warn" },
];

/** The scenario a start offers first. */
export const DEFAULT_SCENARIO = "busy_day";
