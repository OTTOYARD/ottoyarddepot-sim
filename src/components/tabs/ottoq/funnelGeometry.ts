// funnelGeometry — where each layer, car and spark sits in the OTTO-Q funnel. Pure, so it is tested without a canvas.
//
// The silhouette is an hourglass: wide where cars arrive, narrow through the three layers where OTTO-Q thinks (every
// car passes through that neck), wide again where cars are served, and a little narrower where they leave.
import { LAYERS, LAYER_INDEX, type LayerId, type NodeTone } from "@/lib/ottoqFunnel";

/** Green enacted, amber held, red refused, grey no decision. Shared by the drawing and the lists. */
export const TONE_COLOR: Record<NodeTone, string> = {
  ok: "#34D399",
  held: "#FBBF24",
  refused: "#F87171",
  idle: "rgba(231,234,240,0.38)",
};

export const BAND_H = 60;
export const PAD_Y = 6;
/** Share of the drawing's width each layer's band takes. */
export const BAND_WIDTH: Record<LayerId, number> = {
  arriving: 0.96,
  needs: 0.84,
  proposers: 0.6,
  decide: 0.46,
  shield: 0.6,
  booked: 0.8,
  service: 0.96,
  ready: 0.84,
};

export const funnelHeight = (): number => PAD_Y * 2 + BAND_H * LAYERS.length;

export interface Band { id: LayerId; x0: number; x1: number; y0: number; y1: number; cx: number; cy: number }

export function bandOf(id: LayerId, width: number): Band {
  const i = LAYER_INDEX[id];
  const w = BAND_WIDTH[id] * width;
  const x0 = (width - w) / 2;
  const y0 = PAD_Y + i * BAND_H;
  return { id, x0, x1: x0 + w, y0, y1: y0 + BAND_H, cx: width / 2, cy: y0 + BAND_H / 2 };
}

/** FNV-1a: a car's slot and a spark's lane are a pure function of its id, so a redraw never reshuffles them. */
export function hash01(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 0) % 100000) / 100000;
}

export const DOT_R = 2.6;
export const DOT_GAP = 7.5;

/** Grid slots inside a band, row-major from the centre row out, inset from the slanted edges. */
export function slotsFor(band: Band): { x: number; y: number }[] {
  const inset = 8;
  const cols = Math.max(1, Math.floor((band.x1 - band.x0 - inset * 2) / DOT_GAP));
  const rows = Math.max(1, Math.floor((BAND_H - 14) / DOT_GAP));
  const left = band.cx - ((cols - 1) * DOT_GAP) / 2;
  const top = band.cy - ((rows - 1) * DOT_GAP) / 2;
  const order = [...Array(rows).keys()].sort((a, b) => Math.abs(a - (rows - 1) / 2) - Math.abs(b - (rows - 1) / 2));
  const out: { x: number; y: number }[] = [];
  for (const r of order) for (let c = 0; c < cols; c++) out.push({ x: left + c * DOT_GAP, y: top + r * DOT_GAP });
  return out;
}

/** Each car's target position. Cars in a band are ordered by id hash, so a car keeps its place while others come and go
 *  around it as far as the count allows. Cars beyond the band's slots are returned in `overflow`. */
export function layoutCars(
  cars: readonly { id: string; layer: LayerId }[],
  width: number,
): { pos: Map<string, { x: number; y: number }>; overflow: Partial<Record<LayerId, number>> } {
  const pos = new Map<string, { x: number; y: number }>();
  const overflow: Partial<Record<LayerId, number>> = {};
  const byLayer = new Map<LayerId, { id: string; h: number }[]>();
  for (const c of cars) (byLayer.get(c.layer) ?? byLayer.set(c.layer, []).get(c.layer)!).push({ id: c.id, h: hash01(c.id) });
  for (const [layer, list] of byLayer) {
    const slots = slotsFor(bandOf(layer, width));
    list.sort((a, b) => a.h - b.h || (a.id < b.id ? -1 : 1));
    list.forEach((c, i) => {
      if (i < slots.length) pos.set(c.id, slots[i]);
    });
    if (list.length > slots.length) overflow[layer] = list.length - slots.length;
  }
  return { pos, overflow };
}

/** A spark's horizontal lane: inside the narrower of the two bands it joins. */
export function sparkLaneX(key: string, from: LayerId, to: LayerId, width: number): number {
  const a = bandOf(from, width), b = bandOf(to, width);
  const x0 = Math.max(a.x0, b.x0) + 10, x1 = Math.min(a.x1, b.x1) - 10;
  return x0 + hash01(key) * Math.max(0, x1 - x0);
}
