import { useMemo } from 'react';
import * as THREE from 'three';
import { MATERIALS } from './materials';
import { PARK_RUNS } from '@/lib/sitePlan';
import { carportFrames, CARPORT_COLUMN, type CarportFrame } from '@/lib/structurePlan';
import { StaticBatch } from './staticBatch';
import { galvanizedSteel, darkSteel, ledPanel, aluminiumTrim } from './buildingSkin';
import { toWorld, DECK_Y } from './coordUtils';

/** Stall lines sit ON the asphalt deck (they were at 0.05, under it, and invisible). */
const STRIPE_Y = DECK_Y + 0.01;

/**
 * Perimeter parking: painted stall lines + SOLAR CARPORTS over every run
 * (weather cover + extra PV capacity). Geometry from the site plan.
 */
export function StagingZone({ count: _count }: { count: number }) {
  const mats = useMemo(() => ({
    roof: MATERIALS.darkCladding(),
    steel: MATERIALS.structuralSteel(),
  }), []);

  // instanced stall side-lines (2 per stall)
  const stripes = useMemo(() => {
    const total = PARK_RUNS.reduce((n, r) => n + r.n, 0) * 2;
    const inst = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.28, 0.05, 10.5), MATERIALS.laneMarkingWhite(), total,
    );
    const d = new THREE.Object3D();
    let i = 0;
    for (const run of PARK_RUNS) {
      const across = run.angle === 90 || run.angle === 270; // car oriented east-west
      for (let k = 0; k < run.n; k++) {
        const x = run.x0 + k * run.dx, y = run.y0 + k * run.dy;
        const [wx, , wz] = toWorld({ x, y }, 0);
        for (const side of [-1, 1]) {
          if (across) {
            d.position.set(wx, STRIPE_Y, wz + side * 2.9);
            d.rotation.set(0, Math.PI / 2, 0);
          } else {
            d.position.set(wx + side * 2.9, STRIPE_Y, wz);
            d.rotation.set(0, 0, 0);
          }
          d.updateMatrix();
          inst.setMatrixAt(i++, d.matrix);
        }
      }
    }
    inst.instanceMatrix.needsUpdate = true;
    return inst;
  }, []);

  // carports: cantilever frames from structurePlan (overflow/temp runs are open-air)
  const carportGeos = useMemo(() => buildCarports(), []);
  const carportMats = useMemo<Record<string, THREE.Material>>(() => ({
    steel: galvanizedSteel(), dark: darkSteel(), pv: MATERIALS.solarPanelGlass(),
    pier: MATERIALS.polishedConcrete(), led: ledPanel(1.6), trim: aluminiumTrim(),
  }), []);

  return (
    <group>
      <primitive object={stripes} />
      {[...carportGeos.entries()].map(([k, g]) => (
        <mesh key={k} geometry={g} material={carportMats[k]} castShadow={k !== 'led'} receiveShadow={k !== 'pv' && k !== 'led'} />
      ))}
    </group>
  );
}

/**
 * Cantilever solar carports over the perimeter runs, from structurePlan.carportFrames():
 * one column line at the stall HEADS (or in the stall gaps where the fence leaves
 * no room behind the heads), tapered beams cantilevering over the cars to the
 * aisle-side edge, purlins, PV modules. Mono-slope: high at the aisle, draining
 * to the back. No column stands in a stall (structurePlan.test.ts).
 */
const H_TIP = 8.4;   // 4.0 m at the aisle edge
const H_BACK = 7.5;  // 3.6 m at the back edge

function buildCarports(): Map<string, THREE.BufferGeometry> {
  const b = new StaticBatch();
  for (const f of carportFrames()) buildFrame(b, f);
  return b.build();
}

function buildFrame(b: StaticBatch, f: CarportFrame) {
  const r = f.roof;
  // local frame: u runs back -> tip across the carport, v runs along it
  const alongX = f.beamAxis === 'x';
  const uBack = alongX ? (f.tipLine === r.x1 ? r.x0 : r.x1) : (f.tipLine === r.y0 ? r.y1 : r.y0);
  const uTip = f.tipLine;
  const du = uTip - uBack;                    // signed
  const span = Math.abs(du);
  const [v0, v1] = alongX ? [r.y0, r.y1] : [r.x0, r.x1];
  const topAt = (u: number) => H_BACK + ((H_TIP - H_BACK) * (u - uBack)) / du;
  const plan = (u0: number, u1: number, w0: number, w1: number) => alongX
    ? { x0: Math.min(u0, u1), x1: Math.max(u0, u1), y0: Math.min(w0, w1), y1: Math.max(w0, w1) }
    : { x0: Math.min(w0, w1), x1: Math.max(w0, w1), y0: Math.min(u0, u1), y1: Math.max(u0, u1) };
  const hc = CARPORT_COLUMN / 2;

  for (const c of f.columns) {
    const cu = alongX ? c.x : c.y;
    const cv = alongX ? c.y : c.x;
    // pier + column up to the beam soffit
    b.planBox('pier', plan(cu - 0.6, cu + 0.6, cv - 0.6, cv + 0.6), 0, 0.35);
    b.planBox('steel', plan(cu - hc, cu + hc, cv - hc, cv + hc), 0.35, topAt(cu) - 0.75);
    // tapered beam, back edge -> tip, in 6 steps (a stepped taper reads as one member)
    const n = 6;
    for (let i = 0; i < n; i++) {
      const ua = uBack + (du * i) / n, ub = uBack + (du * (i + 1)) / n;
      const depth = 0.75 - 0.4 * ((i + 0.5) / n);
      const top = (topAt(ua) + topAt(ub)) / 2;
      b.planBox('steel', plan(ua, ub, cv - 0.18, cv + 0.18), top - depth, top);
    }
    // LED fixture under the beam, over the car
    const um = uBack + du * 0.62;
    b.planBox('dark', plan(um - 1.4, um + 1.4, cv - 0.3, cv + 0.3), topAt(um) - 1.0, topAt(um) - 0.8);
    b.planBox('led', plan(um - 1.3, um + 1.3, cv - 0.22, cv + 0.22), topAt(um) - 1.03, topAt(um) - 0.99);
  }
  // purlins along the run on top of the beams
  for (let k = 0; k <= 4; k++) {
    const u = uBack + (du * (0.06 + 0.88 * (k / 4)));
    b.planBox('steel', plan(u - 0.16, u + 0.16, v0 + 0.3, v1 - 0.3), topAt(u), topAt(u) + 0.28);
  }
  // tip fascia
  b.planBox('trim', plan(uTip - 0.1 * Math.sign(du), uTip, v0, v1), H_TIP - 0.1, H_TIP + 0.5);
  // PV modules
  const modA = 2.4, modL = 4.3, gap = 0.1;
  const nA = Math.max(1, Math.floor((span - 0.4) / (modA + gap)));
  const nL = Math.max(1, Math.floor((v1 - v0 - 0.6) / (modL + gap)));
  const l0 = v0 + (v1 - v0 - nL * (modL + gap)) / 2 + modL / 2;
  const tilt = Math.atan2(H_TIP - H_BACK, span);
  for (let i = 0; i < nA; i++) {
    const u = uBack + Math.sign(du) * (0.2 + (i + 0.5) * (modA + gap));
    const h = topAt(u) + 0.36;
    for (let j = 0; j < nL; j++) {
      const v = l0 + j * (modL + gap);
      const g = new THREE.BoxGeometry(alongX ? modA : modL, 0.12, alongX ? modL : modA);
      // world tilt: rises toward the tip. plan x -> world -x, plan y -> world -z.
      if (alongX) g.rotateZ(-Math.sign(du) * tilt);
      else g.rotateX(Math.sign(du) * tilt);
      const px = alongX ? u : v, py = alongX ? v : u;
      g.translate(150 - px, h, 110 - py);
      b.geometry('pv', g);
    }
  }
}
