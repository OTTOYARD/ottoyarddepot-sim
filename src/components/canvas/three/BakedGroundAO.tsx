import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { LOT, CANOPIES } from '@/lib/sitePlan';
import {
  SHELLS, shellSolids, canopyColumnSolids, carportFrames, cabinetFootprints, boxCorners,
  CARPORT_COLUMN, type Rect,
} from '@/lib/structurePlan';
import { DECK_Y } from './coordUtils';

/**
 * BAKED AMBIENT OCCLUSION for the static structures — the phone tiers' stand-in
 * for the N8AO pass (phone lane, 2026-09-29).
 *
 * N8AO is a screen-space pass over every pixel, every frame: the costliest thing
 * in the post stack on a phone GPU, and Medium / Low turn it off. Without it the
 * deck goes flat — walls, columns and cabinets stop sitting ON the ground. The
 * occluders that matter here never move, so their occlusion is painted ONCE into
 * a texture over the lot, from the same plan the clearance tests drive against
 * (structurePlan): wall runs, canopy and carport columns, charger cabinets, and
 * the broad sky occlusion under each roof. Drawn as one transparent layer just
 * above the deck: one draw call, no per-frame cost.
 *
 * High keeps N8AO and does not draw this.
 */

const PX_PER_UNIT = 3;
const MARGIN = 8;

interface Occluder {
  poly: { x: number; y: number }[];
  /** darkness at the core, 0..1 */
  alpha: number;
  /** blur radius, plan units */
  blur: number;
}

const rectPoly = (r: Rect, grow = 0) => [
  { x: r.x0 - grow, y: r.y0 - grow }, { x: r.x1 + grow, y: r.y0 - grow },
  { x: r.x1 + grow, y: r.y1 + grow }, { x: r.x0 - grow, y: r.y1 + grow },
];

function occluders(): Occluder[] {
  const out: Occluder[] = [];
  // sky occlusion under the roofs: broad and faint
  for (const c of CANOPIES) out.push({ poly: rectPoly({ x0: c.x, y0: c.y, x1: c.x + c.w, y1: c.y + c.h }), alpha: 0.16, blur: 5 });
  for (const f of carportFrames()) out.push({ poly: rectPoly(f.roof), alpha: 0.12, blur: 3.5 });
  // contact occlusion where solids meet the deck: tight and dark
  for (const s of SHELLS) for (const w of shellSolids(s)) out.push({ poly: rectPoly(w.r, 0.3), alpha: 0.5, blur: 1.6 });
  for (const c of canopyColumnSolids()) out.push({ poly: rectPoly(c.r, 0.2), alpha: 0.5, blur: 0.9 });
  const h = CARPORT_COLUMN / 2 + 0.15;
  for (const f of carportFrames()) for (const c of f.columns) {
    out.push({ poly: rectPoly({ x0: c.x - h, y0: c.y - h, x1: c.x + h, y1: c.y + h }), alpha: 0.45, blur: 0.7 });
  }
  for (const cab of cabinetFootprints()) out.push({ poly: boxCorners(cab.box), alpha: 0.42, blur: 0.8 });
  return out;
}

/** Paint the occluders into an alpha texture over the lot (plan space, both axes mirrored to world). */
function bake(): { texture: THREE.CanvasTexture; w: number; h: number; cx: number; cz: number } | null {
  const X0 = LOT.x - MARGIN, Y0 = LOT.y - MARGIN;
  const W = LOT.w + 2 * MARGIN, H = LOT.h + 2 * MARGIN;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(W * PX_PER_UNIT);
  canvas.height = Math.round(H * PX_PER_UNIT);
  const g = canvas.getContext('2d');
  if (!g) return null;
  const S = PX_PER_UNIT;
  // three samples an alphaMap's GREEN channel, not its alpha: paint on opaque
  // black so a shadow of rgba(255,255,255,a) leaves green = a, accumulating
  // where occluders overlap.
  g.fillStyle = '#000';
  g.fillRect(0, 0, canvas.width, canvas.height);
  // toWorld negates both plan axes, and the plane below is laid with its UVs
  // running along world +X / -Z: plan (X0 + W, Y0 + H) lands in the canvas's
  // top-left corner. One transform, so every occluder is drawn in plan units.
  g.setTransform(-S, 0, 0, -S, (X0 + W) * S, (Y0 + H) * S);
  // The blur is a canvas SHADOW (supported everywhere, unlike ctx.filter): each
  // shape is drawn far off-canvas and only its blurred shadow lands in place.
  // Shadow offset and blur are in device pixels, outside the transform.
  const OFF = 10000;
  for (const o of occluders()) {
    g.shadowColor = `rgba(255,255,255,${o.alpha})`;
    g.shadowBlur = o.blur * S * 2;
    g.shadowOffsetX = OFF * S;
    g.shadowOffsetY = OFF * S;
    g.fillStyle = '#fff';
    g.beginPath();
    o.poly.forEach((p, i) => (i ? g.lineTo(p.x + OFF, p.y + OFF) : g.moveTo(p.x + OFF, p.y + OFF)));
    g.closePath();
    g.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.anisotropy = 4;
  // world centre of the baked rectangle (toWorld: x -> 150 - x, y -> 110 - y)
  return { texture, w: W, h: H, cx: 150 - (X0 + W / 2), cz: 110 - (Y0 + H / 2) };
}

export function BakedGroundAO({ visible }: { visible: boolean }) {
  const baked = useMemo(() => (visible ? bake() : null), [visible]);
  const material = useMemo(() => baked && new THREE.MeshBasicMaterial({
    color: '#000000', alphaMap: baked.texture, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2,
  }), [baked]);
  useEffect(() => () => { baked?.texture.dispose(); material?.dispose(); }, [baked, material]);
  if (!baked || !material) return null;
  return (
    <mesh name="baked-ao" rotation-x={-Math.PI / 2} position={[baked.cx, DECK_Y + 0.008, baked.cz]} material={material} renderOrder={-1}>
      <planeGeometry args={[baked.w, baked.h]} />
    </mesh>
  );
}
