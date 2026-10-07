// stackLegend — what every colour and shape on the OTTO-Q stack means, in one table. The 3D scene takes its colours
// from HUE, and the labels, the key under the stack and the opened plates take their words from PLATE_KEY, so a colour
// on screen and the word beside it can never disagree. Pure: no React, no three.js.
//
// Chase, 2026-10-06: "no idea what the beads/bars represent and mean. It just looks like little squares and
// rectangles with no full/clear context like 'Red = Failed proposals' and green = passed proposals."
//
// One colour, one meaning, on every plate:
//   green  used, carried out, ready          amber  held, waiting, fell back
//   red    refused or blocked, and only that  grey   replaced, expired, no change, arriving
// Two hues belong to one plate each: the agent's own answer (white with violet light, a pass is not a decision) and
// the depot's "in service" (blue: a car on a charger or in a bay). Red is never a plate's own colour: the agent's glass
// was red until 2026-10-06, and a red plate full of red "refused" bars read as one thing.
import type { PlateId } from "./stackModel";

export type Hue = "ok" | "held" | "refused" | "idle" | "agent" | "active";
export type Shape = "orb" | "pill" | "tile" | "block" | "car" | "beam";

/** fill: the object's body. glow: its lit part (the 3D scene multiplies it past 1 so it blooms). */
export const HUE: Record<Hue, { fill: string; glow: string }> = {
  ok: { fill: "#10B981", glow: "#34D399" },
  held: { fill: "#F59E0B", glow: "#FBBF24" },
  refused: { fill: "#E11D48", glow: "#FB7185" },
  idle: { fill: "#64748B", glow: "#94A3B8" },
  agent: { fill: "#EDE9FE", glow: "#C4B5FD" },
  active: { fill: "#0EA5E9", glow: "#38BDF8" },
};

/** Each plate's own accent: its edge light and its index chip. Never a status hue. */
export const PLATE_ACCENT: Record<PlateId, string> = {
  agent: "#A78BFA",
  planners: "#CBD5E1",
  decide: "#E2E8F0",
  safety: "#22D3EE",
  depot: "#E7E5E4",
};

export interface KeyItem {
  hue: Hue;
  shape: Shape;
  /** One to three words, said after the count ("12 refused"). */
  word: string;
  /** Shown beside the plate even at zero (a zero there is news: "0 blocked"). Otherwise a zero is left out. */
  always?: boolean;
}

export interface PlateKey {
  /** One sentence: what one object on this plate is. */
  object: string;
  /** Where the newest object sits, when the plate has an order. */
  order?: string;
  items: KeyItem[];
}

export const PLATE_KEY: Record<PlateId, PlateKey> = {
  agent: {
    object: "Each orb is one agent pass. A line joins it to the goal it chose, the large pearl. Green: its order for the charge line seated cars.",
    items: [
      { hue: "agent", shape: "orb", word: "answered", always: true },
      { hue: "ok", shape: "orb", word: "seated cars" },
      { hue: "refused", shape: "orb", word: "order refused" },
      { hue: "held", shape: "orb", word: "fell back", always: true },
    ],
  },
  planners: {
    object: "Each pill is one offer from a planner: a car, a stall and a time.",
    order: "One lane per planner. The newest offer is on the left.",
    items: [
      { hue: "ok", shape: "pill", word: "used", always: true },
      { hue: "refused", shape: "pill", word: "refused", always: true },
      { hue: "idle", shape: "pill", word: "replaced" },
      { hue: "idle", shape: "pill", word: "expired" },
    ],
  },
  decide: {
    object: "Each tile is one decision for one car.",
    order: "The newest decision is at the front left.",
    items: [
      { hue: "ok", shape: "tile", word: "carried out", always: true },
      { hue: "held", shape: "tile", word: "held", always: true },
      { hue: "idle", shape: "tile", word: "no change" },
    ],
  },
  safety: {
    object: "Every decision passes through this plate. A red block is a decision the shield stopped.",
    items: [{ hue: "refused", shape: "block", word: "blocked", always: true }],
  },
  depot: {
    object: "Each car stands in the zone that matches what it does now.",
    items: [
      { hue: "ok", shape: "car", word: "ready", always: true },
      { hue: "active", shape: "car", word: "in service", always: true },
      { hue: "held", shape: "car", word: "waiting", always: true },
      { hue: "refused", shape: "car", word: "out of service" },
      { hue: "idle", shape: "car", word: "arriving" },
      { hue: "idle", shape: "car", word: "not reported" },
    ],
  },
};

/** The colour key under the stack: the four meanings that hold on every plate. */
export const COLOR_KEY: { hue: Hue; word: string; means: string }[] = [
  { hue: "ok", word: "Green", means: "used, carried out or ready" },
  { hue: "held", word: "Amber", means: "held, waiting or fell back" },
  { hue: "refused", word: "Red", means: "refused or blocked" },
  { hue: "idle", word: "Grey", means: "replaced, no change, arriving or not reported" },
];

/** The light that moves: what a travelling bead is. */
export const MOTION_KEY = "A moving light is one new record. It falls from the layer that wrote it to the layer it changes.";

export interface Stat { hue: Hue; shape: Shape; n: number | null; word: string }

/**
 * A plate's key items with their counts, in key order: the line beside the plate. An item with a zero count is left
 * out unless it is marked `always`; an unknown count (the source has not answered) is kept and drawn as "—".
 */
export function plateStats(plate: PlateId, counts: Partial<Record<string, number | null>>): Stat[] {
  return PLATE_KEY[plate].items
    .map((it) => ({ hue: it.hue, shape: it.shape, word: it.word, n: counts[it.word] === undefined ? null : counts[it.word]! }))
    .filter((s, i) => s.n == null || s.n > 0 || PLATE_KEY[plate].items[i].always);
}
