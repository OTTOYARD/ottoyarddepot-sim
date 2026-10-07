// stackTextures — every surface the OTTO-Q stack wears, drawn at runtime on 2D canvases (nothing fetched). Only the
// planners' lane names and the depot's zone names carry information; both come from the model, never from guesses.
//
// 2026-10-06 redesign: every plate is a rounded slab now, so every top texture is cut to the same rounded rectangle
// (transparent outside it) and its corners can never overhang the slab. The words that used to appear only when a
// plate was zoomed (the planner of each lane, the name of each depot zone) are engraved on the plate itself, so the
// stack can be read without tapping it.
import * as THREE from "three";
import { LANE_BARS_X0, LANE_LABEL_X, PLATE_D, PLATE_W, ZONES, SITE_COUNTS, laneName, zoneCapacity, type ZoneDef } from "./stackModel";

const PX = 1024;
const PZ = Math.round((PX * PLATE_D) / PLATE_W);
/** Plate-local (x, z) → texture pixel. */
const u = (x: number) => ((x + PLATE_W / 2) / PLATE_W) * PX;
const v = (z: number) => ((z + PLATE_D / 2) / PLATE_D) * PZ;
/** The slab's corner radius in plate units (OttoQStack draws the slab with the same number). */
export const PLATE_RADIUS = 0.42;
const RPX = (PLATE_RADIUS / PLATE_W) * PX;

const DISPLAY = '"Chakra Petch", "Inter Tight", system-ui, sans-serif';
const MONO = '"JetBrains Mono", ui-monospace, monospace';

function canvas(w = PX, h = PZ): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!];
}

function finish(c: HTMLCanvasElement, anisotropy = 8): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = anisotropy;
  t.needsUpdate = true;
  return t;
}

/** A tiny deterministic PRNG, so the brushing and the grain are identical on every load. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Clip everything after this to the plate's own rounded outline. */
function clipPlate(ctx: CanvasRenderingContext2D, inset = 0) {
  roundRect(ctx, inset, inset, PX - 2 * inset, PZ - 2 * inset, Math.max(2, RPX - inset));
  ctx.clip();
}

/** Brushed metal: fine horizontal streaks over a base tone. */
function brush(ctx: CanvasRenderingContext2D, w: number, h: number, base: string, seed: number, strength = 0.05) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  const r = rng(seed);
  for (let i = 0; i < 2200; i++) {
    const y = r() * h;
    const len = 40 + r() * 260;
    const x = r() * w;
    ctx.strokeStyle = r() > 0.5 ? `rgba(255,255,255,${strength * r()})` : `rgba(0,0,0,${strength * 1.6 * r()})`;
    ctx.lineWidth = 0.6 + r() * 0.8;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + len, y + (r() - 0.5) * 1.5);
    ctx.stroke();
  }
}

/** A soft sheen across a metal plate: light from the top-left, as the key light falls. */
function sheen(ctx: CanvasRenderingContext2D, a = 0.07) {
  const g = ctx.createLinearGradient(0, 0, PX, PZ);
  g.addColorStop(0, `rgba(255,255,255,${a})`);
  g.addColorStop(0.45, "rgba(255,255,255,0)");
  g.addColorStop(1, `rgba(0,0,0,${a * 1.4})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, PX, PZ);
}

/** A thin bright inner border, the machined chamfer of the slab's top. */
function chamfer(ctx: CanvasRenderingContext2D, color: string, inset = 7, width = 2) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  roundRect(ctx, inset, inset, PX - 2 * inset, PZ - 2 * inset, Math.max(2, RPX - inset));
  ctx.stroke();
}

/** Engraved words: dark cut with a light lower lip, so they read as cut into the metal. */
function engrave(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, align: CanvasTextAlign = "left", alpha = 0.62, font = DISPLAY) {
  ctx.font = `600 ${size}px ${font}`;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillText(text, x, y - 1);
  ctx.fillStyle = `rgba(235,240,248,${alpha})`;
  ctx.fillText(text, x, y + 1);
}

/** Soft round glow, for sprites and halos. */
export function glowTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(128, 128);
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.25, "rgba(255,255,255,0.55)");
  g.addColorStop(0.6, "rgba(255,255,255,0.12)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return finish(c, 1);
}

/** The agent's glass: a fine dot grid and a bright inner border, in violet light on transparency. */
export function glassEtchTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas();
  ctx.clearRect(0, 0, PX, PZ);
  ctx.save();
  clipPlate(ctx);
  // a faint inner glow toward the centre, where the goals sit
  const g = ctx.createRadialGradient(PX / 2, PZ / 2, 20, PX / 2, PZ / 2, PX * 0.55);
  g.addColorStop(0, "rgba(167,139,250,0.10)");
  g.addColorStop(1, "rgba(167,139,250,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, PX, PZ);
  const step = PX / 40;
  for (let x = step / 2; x < PX; x += step) {
    for (let y = step / 2; y < PZ; y += step) {
      ctx.fillStyle = "rgba(196,181,253,0.16)";
      ctx.fillRect(x - 0.9, y - 0.9, 1.8, 1.8);
    }
  }
  chamfer(ctx, "rgba(196,181,253,0.42)", 12, 2);
  chamfer(ctx, "rgba(196,181,253,0.12)", 26, 1);
  ctx.restore();
  return finish(c);
}

/** The safety membrane: a fine hexagonal lattice in cyan light, brightest at its rim. */
export function shieldTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas();
  ctx.clearRect(0, 0, PX, PZ);
  ctx.save();
  clipPlate(ctx);
  const R = 20, h = Math.sqrt(3) * R;
  ctx.lineWidth = 1.1;
  for (let row = -1, y = 0; y < PZ + h; row++, y = row * h * 0.5) {
    for (let x = (row % 2 ? 1.5 * R : 0); x < PX + 3 * R; x += 3 * R) {
      const edge = Math.min(x, PX - x, y, PZ - y);
      const a = 0.07 + 0.2 * Math.max(0, 1 - edge / 170);
      ctx.strokeStyle = `rgba(103,232,249,${a})`;
      ctx.beginPath();
      for (let k = 0; k <= 6; k++) {
        const t = (Math.PI / 3) * k;
        const px = x + R * Math.cos(t), py = y + R * Math.sin(t);
        if (k) ctx.lineTo(px, py);
        else ctx.moveTo(px, py);
      }
      ctx.stroke();
    }
  }
  chamfer(ctx, "rgba(103,232,249,0.5)", 10, 3);
  ctx.restore();
  return finish(c);
}

/** The planners' plate: graphite, one recessed channel per lane, the planner's name engraved at its left end. */
export function plannerTexture(lanes: { word: string; z: number }[]): THREE.CanvasTexture {
  const [c, ctx] = canvas();
  ctx.save();
  clipPlate(ctx);
  brush(ctx, PX, PZ, "#1a1c21", 11, 0.05);
  sheen(ctx, 0.06);
  for (const l of lanes) {
    const y = v(l.z);
    const g = ctx.createLinearGradient(0, y - 24, 0, y + 24);
    g.addColorStop(0, "rgba(0,0,0,0.6)");
    g.addColorStop(0.5, "rgba(0,0,0,0.3)");
    g.addColorStop(1, "rgba(255,255,255,0.06)");
    ctx.fillStyle = g;
    roundRect(ctx, u(LANE_LABEL_X - 0.12), y - 24, u(4.78) - u(LANE_LABEL_X - 0.12), 48, 22);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    ctx.stroke();
    // the planner's name, then a divider: offers start to its right, newest first. A long name ("Lexicographic") is
    // set smaller rather than run under the divider.
    const name = laneName(l.word);
    const room = u(LANE_BARS_X0 - 0.42) - u(LANE_LABEL_X + 0.06) - 8;
    ctx.font = `600 25px ${DISPLAY}`;
    const wide = ctx.measureText?.(name)?.width ?? 0;
    engrave(ctx, name, u(LANE_LABEL_X + 0.06), y, wide > room ? Math.max(16, Math.floor((25 * room) / wide)) : 25, "left", 0.8);
    ctx.fillStyle = "rgba(255,255,255,0.10)";
    ctx.fillRect(u(LANE_BARS_X0 - 0.42), y - 15, 2, 30);
  }
  chamfer(ctx, "rgba(226,232,240,0.22)", 8, 2);
  ctx.restore();
  return finish(c);
}

/** The decide plate: gunmetal with one recessed socket per tile position. */
export function decideTexture(cols: number, rows: number, x0: number, z0: number, pitch: number): THREE.CanvasTexture {
  const [c, ctx] = canvas();
  ctx.save();
  clipPlate(ctx);
  brush(ctx, PX, PZ, "#23262c", 23, 0.045);
  sheen(ctx, 0.07);
  const s = (PX / PLATE_W) * 0.7;
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < cols; k++) {
      const cx = u(x0 + k * pitch), cy = v(z0 - r * pitch);
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      roundRect(ctx, cx - s / 2, cy - s / 2, s, s, 9);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
  chamfer(ctx, "rgba(241,245,249,0.3)", 8, 2);
  ctx.restore();
  return finish(c);
}

function zoneBox(z: ZoneDef, cap: number) {
  const cols = z.cols, rows = Math.max(1, Math.ceil(cap / cols));
  const x0 = u(z.x0 - z.px / 2), y0 = v(z.z0 - z.pz / 2);
  const x1 = u(z.x0 + (cols - 0.5) * z.px), y1 = v(z.z0 + (rows - 0.5) * z.pz);
  return { x0, y0, x1, y1, rows };
}

/** Short names engraved on the depot map, one per zone. */
const ZONE_ENGRAVING: Record<string, string> = {
  road: "", gate: "GATE", waiting: "WAITING", booked: "BOOKED", dcfc: "DCFC", l2: "L2",
  hold: "BETWEEN STEPS", wash: "WASH", service: "SERVICE", repair: "REPAIR", ready: "READY",
};

/** The depot base: asphalt, painted zones and lanes, every charger and bay socket one of the site's real stalls. */
export function depotTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas();
  ctx.save();
  clipPlate(ctx);
  // asphalt: a dark base with fine grain
  ctx.fillStyle = "#121317";
  ctx.fillRect(0, 0, PX, PZ);
  const r = rng(31);
  for (let i = 0; i < 9000; i++) {
    ctx.fillStyle = r() > 0.5 ? `rgba(255,255,255,${0.025 * r()})` : `rgba(0,0,0,${0.08 * r()})`;
    ctx.fillRect(r() * PX, r() * PZ, 1.2, 1.2);
  }
  sheen(ctx, 0.05);
  // the approach lane down the east edge: darker asphalt with a dashed centre line
  {
    const x0 = u(3.95), x1 = u(4.85), y0 = v(-3.1), y1 = v(2.95);
    ctx.fillStyle = "rgba(4,5,7,0.8)";
    roundRect(ctx, x0, y0, x1 - x0, y1 - y0, 10);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.28)";
    ctx.setLineDash([14, 12]);
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo((x0 + x1) / 2, y0 + 10); ctx.lineTo((x0 + x1) / 2, y1 - 10); ctx.stroke();
    ctx.setLineDash([]);
  }
  // zones: painted outlines, sockets for the real stalls, and each zone's name
  for (const z of ZONES) {
    if (z.id === "road") continue;
    const cap = zoneCapacity(z);
    const b = zoneBox(z, cap);
    ctx.fillStyle = z.fixed ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.022)";
    roundRect(ctx, b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0, 8);
    ctx.fill();
    ctx.strokeStyle = z.fixed ? "rgba(255,255,255,0.26)" : "rgba(255,255,255,0.14)";
    ctx.setLineDash(z.fixed ? [] : [7, 6]);
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.setLineDash([]);
    if (z.fixed) {
      for (let i = 0; i < cap; i++) {
        const sx = u(z.x0 + (i % z.cols) * z.px), sy = v(z.z0 + Math.floor(i / z.cols) * z.pz);
        const w = (PX / PLATE_W) * z.px * 0.78, h = (PZ / PLATE_D) * z.pz * 0.62;
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        roundRect(ctx, sx - w / 2, sy - h / 2, w, h, 4);
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.18)";
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
    }
    const name = ZONE_ENGRAVING[z.id];
    if (name) {
      // above the zone's top edge, left-aligned: painted road lettering
      ctx.font = `600 15px ${DISPLAY}`;
      ctx.textAlign = "left";
      ctx.textBaseline = "bottom";
      ctx.fillStyle = "rgba(226,232,240,0.62)";
      ctx.fillText(name, b.x0 + 2, b.y0 - 4);
    }
  }
  // the gates, as notches in the south edge: in at the east, out at the west
  for (const [x, word] of [[4.4, "IN"], [-4.4, "OUT"]] as const) {
    ctx.fillStyle = "rgba(226,232,240,0.75)";
    roundRect(ctx, u(x) - 26, v(3.3) - 9, 52, 9, 3);
    ctx.fill();
    ctx.font = `600 14px ${MONO}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillStyle = "rgba(226,232,240,0.7)";
    ctx.fillText(word, u(x), v(3.3) - 12);
  }
  chamfer(ctx, "rgba(231,229,228,0.28)", 8, 2);
  ctx.restore();
  return finish(c);
}

/** A soft dark rounded rectangle: the plate above's shadow on the plate below. */
export function contactShadowTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(256, 170);
  const g = ctx.createRadialGradient(128, 85, 10, 128, 85, 140);
  g.addColorStop(0, "rgba(0,0,0,0.5)");
  g.addColorStop(0.7, "rgba(0,0,0,0.22)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 170);
  return finish(c, 1);
}

/** The floor under the stack: a cool pool of light and a faint grid that fades out. */
export function floorTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(1024, 1024);
  const g = ctx.createRadialGradient(512, 512, 30, 512, 512, 512);
  g.addColorStop(0, "rgba(91,76,180,0.38)");
  g.addColorStop(0.35, "rgba(40,48,90,0.22)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1024, 1024);
  ctx.lineWidth = 1;
  for (let i = 0; i <= 32; i++) {
    const p = (i / 32) * 1024;
    for (const [x0, y0, x1, y1] of [[p, 0, p, 1024], [0, p, 1024, p]] as const) {
      const lg = ctx.createLinearGradient(x0, y0, x1, y1);
      // brightest at the middle of each line, so the grid fades toward the floor's rim
      lg.addColorStop(0, "rgba(148,163,184,0)");
      lg.addColorStop(0.5, `rgba(148,163,184,${0.09 * (1 - Math.abs(i - 16) / 16)})`);
      lg.addColorStop(1, "rgba(148,163,184,0)");
      ctx.strokeStyle = lg;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    }
  }
  return finish(c, 4);
}

/** The scene's backdrop: a deep blue-black, lighter behind the stack, darker at the edges. */
export function backdropTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(512, 512);
  const g = ctx.createRadialGradient(200, 230, 10, 256, 256, 380);
  g.addColorStop(0, "#171a2a");
  g.addColorStop(0.55, "#0d0f17");
  g.addColorStop(1, "#06070a");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 512);
  return finish(c, 1);
}

export const STACK_FONTS = { display: DISPLAY, mono: MONO };
export { SITE_COUNTS };
