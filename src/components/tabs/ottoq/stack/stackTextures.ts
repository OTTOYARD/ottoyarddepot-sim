// stackTextures — every surface the OTTO-Q stack wears, drawn at runtime on 2D canvases (nothing fetched). Only the
// depot's silkscreen and the planners' lane names carry information; both come from the model, never from guesses.
import * as THREE from "three";
import { PLATE_D, PLATE_W, ZONES, SITE_COUNTS, type ZoneDef } from "./stackModel";

const PX = 1024;
const PZ = Math.round((PX * PLATE_D) / PLATE_W);
/** Plate-local (x, z) → texture pixel. */
const u = (x: number) => ((x + PLATE_W / 2) / PLATE_W) * PX;
const v = (z: number) => ((z + PLATE_D / 2) / PLATE_D) * PZ;

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

/** A tiny deterministic PRNG, so the brushing and the traces are identical on every load. */
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

/** Brushed metal: fine horizontal streaks over a base tone. */
function brush(ctx: CanvasRenderingContext2D, w: number, h: number, base: string, seed: number, strength = 0.05) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  const r = rng(seed);
  for (let i = 0; i < 2600; i++) {
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

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}


/** Soft round glow, for sprites and bead halos. */
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

/** The agent's glass: a faint etched grid and an inner border, drawn in light on transparency. */
export function glassEtchTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas();
  ctx.clearRect(0, 0, PX, PZ);
  ctx.strokeStyle = "rgba(255,120,130,0.10)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= PX; x += PX / 20) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, PZ); ctx.stroke(); }
  for (let y = 0; y <= PZ; y += PZ / 13) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(PX, y); ctx.stroke(); }
  ctx.strokeStyle = "rgba(255,150,160,0.35)";
  ctx.lineWidth = 2;
  roundRect(ctx, 14, 14, PX - 28, PZ - 28, 10);
  ctx.stroke();
  const r = rng(7);
  for (let i = 0; i < 90; i++) {
    ctx.fillStyle = `rgba(255,170,180,${0.05 + r() * 0.12})`;
    ctx.beginPath();
    ctx.arc(r() * PX, r() * PZ, 0.8 + r() * 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
  return finish(c);
}

/** The safety membrane: a fine hexagonal lattice, brightest at its rim (decoration: the checks are its tags and flashes). */
export function shieldTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas();
  ctx.clearRect(0, 0, PX, PZ);
  const R = 22, h = Math.sqrt(3) * R;
  ctx.lineWidth = 1.2;
  for (let row = -1, y = 0; y < PZ + h; row++, y = row * h * 0.5) {
    for (let x = (row % 2 ? 1.5 * R : 0); x < PX + 3 * R; x += 3 * R) {
      const edge = Math.min(x, PX - x, y, PZ - y);
      const a = 0.08 + 0.22 * Math.max(0, 1 - edge / 160);
      ctx.strokeStyle = `rgba(120,255,200,${a})`;
      ctx.beginPath();
      for (let k = 0; k <= 6; k++) {
        const t = (Math.PI / 3) * k;
        const px = x + R * Math.cos(t), py = y + R * Math.sin(t);
        k ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.stroke();
    }
  }
  ctx.strokeStyle = "rgba(150,255,210,0.45)";
  ctx.lineWidth = 3;
  roundRect(ctx, 10, 10, PX - 20, PZ - 20, 12);
  ctx.stroke();
  return finish(c);
}

/** The planners' plate: brushed dark metal, one groove per lane, the lane's planner named at its far end. */
export function plannerTexture(lanes: { word: string; z: number }[]): THREE.CanvasTexture {
  const [c, ctx] = canvas();
  brush(ctx, PX, PZ, "#1b1d22", 11, 0.06);
  // time ticks along the plate (decoration: the lanes run newest-left to oldest-right)
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  for (let x = u(-4.5); x <= u(4.6); x += (PX / PLATE_W) * 0.78) {
    ctx.beginPath(); ctx.moveTo(x, 18); ctx.lineTo(x, 34); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x, PZ - 34); ctx.lineTo(x, PZ - 18); ctx.stroke();
  }
  for (const l of lanes) {
    const y = v(l.z);
    const g = ctx.createLinearGradient(0, y - 22, 0, y + 22);
    g.addColorStop(0, "rgba(0,0,0,0.55)");
    g.addColorStop(0.5, "rgba(0,0,0,0.25)");
    g.addColorStop(1, "rgba(255,255,255,0.06)");
    ctx.fillStyle = g;
    roundRect(ctx, u(-4.75), y - 22, u(4.75) - u(-4.75), 44, 8);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  return finish(c);
}

/** The decide plate: brushed metal with one recessed socket per tile position, and SAFETY etched along the rim. */
export function decideTexture(cols: number, rows: number, x0: number, z0: number, pitch: number): THREE.CanvasTexture {
  const [c, ctx] = canvas();
  brush(ctx, PX, PZ, "#25272d", 23, 0.05);
  const s = (PX / PLATE_W) * 0.7;
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < cols; k++) {
      const cx = u(x0 + k * pitch), cy = v(z0 - r * pitch);
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      roundRect(ctx, cx - s / 2, cy - s / 2, s, s, 5);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.07)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
  return finish(c);
}

function zoneBox(z: ZoneDef, cap: number) {
  const cols = z.cols, rows = Math.max(1, Math.ceil(cap / cols));
  const x0 = u(z.x0 - z.px / 2), y0 = v(z.z0 - z.pz / 2);
  const x1 = u(z.x0 + (cols - 0.5) * z.px), y1 = v(z.z0 + (rows - 0.5) * z.pz);
  return { x0, y0, x1, y1, rows };
}

/** The depot base: a circuit-board silkscreen of the site. Every charger and bay socket is one of the site's real stalls. */
export function depotTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas();
  brush(ctx, PX, PZ, "#141519", 31, 0.05);
  // traces: the flow a car takes, in PCB manner (east gate → waiting → chargers → bays → ready → west gate)
  const r = rng(99);
  ctx.lineCap = "round";
  const trace = (pts: [number, number][], a = 0.22) => {
    ctx.strokeStyle = `rgba(200,16,46,${a})`;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    pts.forEach(([x, z], i) => (i ? ctx.lineTo(u(x), v(z)) : ctx.moveTo(u(x), v(z))));
    ctx.stroke();
    for (const [x, z] of [pts[0], pts[pts.length - 1]]) {
      ctx.fillStyle = `rgba(255,80,95,${a + 0.2})`;
      ctx.beginPath(); ctx.arc(u(x), v(z), 4.5, 0, Math.PI * 2); ctx.fill();
    }
  };
  // road → east gate → waiting → chargers and bays → ready → west gate
  trace([[4.4, 1.9], [4.4, 2.5], [4.0, 2.5]], 0.3);
  trace([[1.1, 2.5], [0.9, 2.5], [0.9, -1.2], [1.1, -1.2]]);
  trace([[1.1, 0.7], [0.75, 0.7], [0.75, -0.2], [0.45, -0.2]]);
  trace([[-2.2, 0.35], [-2.2, 1.9], [-3.4, 1.9], [-3.4, 1.6]]);
  trace([[-1.4, -2.35], [-1.4, -2.05], [-0.9, -2.05]], 0.18);
  trace([[-4.2, 1.7], [-4.2, 2.75], [-4.75, 2.75]], 0.3);
  for (let i = 0; i < 22; i++) {
    const x = -4.6 + r() * 9.2, z = -3.0 + r() * 6.0;
    const dx = (r() > 0.5 ? 1 : -1) * (0.3 + r() * 0.8);
    trace([[x, z], [x + dx, z], [x + dx, z + (r() - 0.5) * 0.6]], 0.07);
  }
  // the approach lane down the east edge: asphalt with a dashed centre line
  {
    const x0 = u(3.95), x1 = u(4.85), y0 = v(-3.1), y1 = v(2.95);
    ctx.fillStyle = "rgba(4,5,7,0.75)";
    roundRect(ctx, x0, y0, x1 - x0, y1 - y0, 10);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.22)";
    ctx.setLineDash([14, 12]);
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo((x0 + x1) / 2, y0 + 10); ctx.lineTo((x0 + x1) / 2, y1 - 10); ctx.stroke();
    ctx.setLineDash([]);
  }
  // zones
  for (const z of ZONES) {
    if (z.id === "road") continue;
    const cap = z.id === "dcfc" ? SITE_COUNTS.dcfc : z.id === "l2" ? SITE_COUNTS.l2 : z.id === "wash" ? SITE_COUNTS.wash : z.id === "service" ? SITE_COUNTS.service : z.cols * z.rows;
    const b = zoneBox(z, cap);
    ctx.fillStyle = z.fixed ? "rgba(255,255,255,0.035)" : "rgba(255,255,255,0.02)";
    roundRect(ctx, b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0, 8);
    ctx.fill();
    ctx.strokeStyle = z.fixed ? "rgba(255,255,255,0.20)" : "rgba(255,255,255,0.10)";
    ctx.setLineDash(z.fixed ? [] : [6, 5]);
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.setLineDash([]);
    if (z.fixed) {
      // one socket per real stall
      for (let i = 0; i < cap; i++) {
        const sx = u(z.x0 + (i % z.cols) * z.px), sy = v(z.z0 + Math.floor(i / z.cols) * z.pz);
        const w = (PX / PLATE_W) * z.px * 0.78, h = (PZ / PLATE_D) * z.pz * 0.62;
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        roundRect(ctx, sx - w / 2, sy - h / 2, w, h, 4);
        ctx.fill();
        ctx.strokeStyle = z.id === "dcfc" ? "rgba(255,70,85,0.55)" : "rgba(255,255,255,0.14)";
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
    }
  }
  // the gates, as notches in the south edge: in at the east, out at the west
  ctx.fillStyle = "rgba(255,80,95,0.8)";
  for (const x of [4.4, -4.4]) { roundRect(ctx, u(x) - 26, v(3.3) - 10, 52, 10, 3); ctx.fill(); }
  return finish(c);
}

/** Dashed road for the approach and the exit, off the plate's edge. */
export function roadTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(256, 64);
  ctx.fillStyle = "#101114";
  ctx.fillRect(0, 0, 256, 64);
  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.setLineDash([14, 12]);
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, 32); ctx.lineTo(256, 32); ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = "rgba(255,255,255,0.10)";
  ctx.beginPath(); ctx.moveTo(0, 4); ctx.lineTo(256, 4); ctx.moveTo(0, 60); ctx.lineTo(256, 60); ctx.stroke();
  return finish(c, 4);
}

/** A soft dark rectangle: the plate above's shadow on the plate below. */
export function contactShadowTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(256, 170);
  const g = ctx.createRadialGradient(128, 85, 10, 128, 85, 140);
  g.addColorStop(0, "rgba(0,0,0,0.55)");
  g.addColorStop(0.7, "rgba(0,0,0,0.25)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 170);
  return finish(c, 1);
}

/** The floor under the stack: a dark pool of light that fades to the panel. */
export function floorTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(512, 512);
  const g = ctx.createRadialGradient(256, 256, 20, 256, 256, 256);
  g.addColorStop(0, "rgba(90,14,24,0.55)");
  g.addColorStop(0.35, "rgba(40,10,16,0.35)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 512);
  return finish(c, 1);
}
