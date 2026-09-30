import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { Ring, summarizeFrames, type FrameSummary } from './perfStats';
import { useQualityStore } from '../quality/qualityStore';

/**
 * PERF PROBE — the measuring half of the phone lane. Mounted inside the
 * <Canvas>, it records every frame and exposes the numbers two ways:
 *
 *   - window.__perf, read by scripts/perfHarness.mjs (and by hand from a console):
 *       __perf.reset()      start a fresh window
 *       __perf.summary()    fps, p50/p95/p99 frame time, draw calls, triangles,
 *                           CPU ms inside renderer.render, GPU memory estimate
 *       __perf.inventory()  draw-call sources, by top-level scene group
 *   - a small on-screen overlay, when the URL carries ?perf=1 (or
 *     localStorage ottoq_perf = 1) — the way to read a real phone.
 *
 * Draw calls and triangles are the WHOLE frame: shadow pass, main pass and every
 * post-processing pass. three's info.autoReset zeroes them on each render()
 * call, and the composer makes several per frame, so the probe turns autoReset
 * off and resets once per frame itself. Otherwise the number read would be the
 * last full-screen quad's: 1 call, 1 triangle.
 *
 * The probe only reads. It never changes what is drawn.
 */

const WINDOW_FRAMES = 600;

interface PerfState {
  frameMs: Ring;
  cpuMs: Ring;
  jsMs: Ring;
  calls: Ring;
  tris: Ring;
  last: { calls: number; tris: number; cpuMs: number };
}

const state: PerfState = {
  frameMs: new Ring(WINDOW_FRAMES),
  cpuMs: new Ring(WINDOW_FRAMES),
  jsMs: new Ring(WINDOW_FRAMES),
  calls: new Ring(WINDOW_FRAMES),
  tris: new Ring(WINDOW_FRAMES),
  last: { calls: 0, tris: 0, cpuMs: 0 },
};

export interface PerfSummary extends FrameSummary {
  calls: number;
  triangles: number;
  cpuRenderMs: number;
  cpuRenderP95Ms: number;
  /** Main-thread ms of the whole R3F frame: every useFrame plus every render() call. */
  cpuFrameMs: number;
  memory: GpuMemory;
  tier: string;
  mode: string;
  dpr: number;
  canvas: [number, number];
}

export interface GpuMemory {
  geometries: number;
  textures: number;
  programs: number;
  geometryMB: number;
  textureMB: number;
  targetMB: number;
  totalMB: number;
}

const MB = 1 / (1024 * 1024);
const TEX_KEYS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap',
  'alphaMap', 'bumpMap', 'envMap', 'clearcoatNormalMap', 'lightMap', 'displacementMap'] as const;

function textureBytes(t: THREE.Texture): number {
  const img = t.image as { width?: number; height?: number } | undefined;
  const w = img?.width ?? 0, h = img?.height ?? 0;
  // RGBA8 with a full mip chain (x 4/3) unless mipmaps are off
  return w * h * 4 * (t.generateMipmaps && t.minFilter !== THREE.LinearFilter && t.minFilter !== THREE.NearestFilter ? 4 / 3 : 1);
}

/**
 * GPU memory, ESTIMATED from what the scene holds: every unique geometry's
 * buffers (instance matrices included), every unique texture at RGBA8 with
 * mips, and the render targets three and the composer own (drawing buffer,
 * shadow maps). Browsers expose no real GPU memory counter; this is the
 * number that moves when a change moves it.
 */
function estimateMemory(gl: THREE.WebGLRenderer, scene: THREE.Scene): GpuMemory {
  const geos = new Set<THREE.BufferGeometry>();
  const texs = new Set<THREE.Texture>();
  const inst = new Set<THREE.BufferAttribute>();
  let lightTargets = 0;
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) geos.add(m.geometry);
    const im = o as THREE.InstancedMesh;
    if (im.isInstancedMesh) {
      inst.add(im.instanceMatrix);
      if (im.instanceColor) inst.add(im.instanceColor);
    }
    const mats = m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : [];
    for (const mat of mats) {
      for (const k of TEX_KEYS) {
        const t = (mat as unknown as Record<string, unknown>)[k];
        if (t && (t as THREE.Texture).isTexture) texs.add(t as THREE.Texture);
      }
    }
    const l = o as THREE.DirectionalLight;
    if (l.isLight && l.castShadow && l.shadow?.map) {
      lightTargets += l.shadow.mapSize.x * l.shadow.mapSize.y * 4;
    }
  });
  for (const t of [scene.background, scene.environment]) {
    if (t && (t as THREE.Texture).isTexture) texs.add(t as THREE.Texture);
  }
  let geoBytes = 0;
  for (const g of geos) {
    for (const a of Object.values(g.attributes)) geoBytes += (a as THREE.BufferAttribute).array?.byteLength ?? 0;
    geoBytes += g.index?.array.byteLength ?? 0;
  }
  for (const a of inst) geoBytes += a.array.byteLength;
  let texBytes = 0;
  for (const t of texs) texBytes += textureBytes(t);
  const size = gl.getDrawingBufferSize(new THREE.Vector2());
  // colour + depth for the default framebuffer, and ~3 full-size composer buffers
  const targetBytes = size.x * size.y * 4 * 2 + size.x * size.y * 8 * 3 + lightTargets;
  const r = (x: number) => Math.round(x * MB * 10) / 10;
  return {
    geometries: gl.info.memory.geometries,
    textures: gl.info.memory.textures,
    programs: gl.info.programs?.length ?? 0,
    geometryMB: r(geoBytes),
    textureMB: r(texBytes),
    targetMB: r(targetBytes),
    totalMB: r(geoBytes + texBytes + targetBytes),
  };
}

export interface InventoryRow {
  group: string;
  meshes: number;
  instanced: number;
  instances: number;
  triangles: number;
  shadowCasters: number;
}

/**
 * Where the draw calls come from: every visible mesh, by top-level child of the
 * scene (named by its first named descendant or its component's group name).
 * One mesh with one material is one draw call in the main pass, and one more in
 * the shadow pass if it casts.
 */
function inventory(scene: THREE.Scene): InventoryRow[] {
  const rows: InventoryRow[] = [];
  scene.children.forEach((child, i) => {
    if (!child.visible) return;
    const row: InventoryRow = { group: child.name || `${child.type}#${i}`, meshes: 0, instanced: 0, instances: 0, triangles: 0, shadowCasters: 0 };
    child.traverseVisible((o) => {
      const m = o as THREE.Mesh;
      if (!(m.isMesh || (o as THREE.Points).isPoints || (o as THREE.Line).isLine)) return;
      const g = m.geometry as THREE.BufferGeometry;
      const count = (o as THREE.InstancedMesh).isInstancedMesh ? (o as THREE.InstancedMesh).count : 1;
      const tris = g ? (g.index ? g.index.count : (g.attributes.position?.count ?? 0)) / 3 : 0;
      row.meshes++;
      if (count !== 1 || (o as THREE.InstancedMesh).isInstancedMesh) { row.instanced++; row.instances += count; }
      row.triangles += Math.round(tris * count);
      if (m.castShadow) row.shadowCasters++;
    });
    if (row.meshes) rows.push(row);
  });
  return rows.sort((a, b) => b.meshes - a.meshes);
}

function wantOverlay(): boolean {
  try {
    if (new URLSearchParams(window.location.search).get('perf') === '1') return true;
    return window.localStorage.getItem('ottoq_perf') === '1';
  } catch { return false; }
}

export function PerfProbe() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const lastT = useRef<number | null>(null);
  const cpuAcc = useRef(0);
  const frameStart = useRef<number | null>(null);
  const renderEnd = useRef<number | null>(null);

  useEffect(() => {
    gl.info.autoReset = false;
    // Time spent inside renderer.render — every pass. With a real GPU this is
    // the CPU cost of submitting the frame (the draw-call bill); in software GL
    // it also contains the rasterisation, so read it comparatively there.
    const orig = gl.render;
    gl.render = function render(this: THREE.WebGLRenderer, s: THREE.Object3D, c: THREE.Camera) {
      const t = performance.now();
      orig.call(this, s, c);
      const end = performance.now();
      cpuAcc.current += end - t;
      renderEnd.current = end;
    };
    const api = {
      reset: () => { state.frameMs.clear(); state.cpuMs.clear(); state.jsMs.clear(); state.calls.clear(); state.tris.clear(); },
      summary: (): PerfSummary => {
        const q = useQualityStore.getState();
        const size = gl.getDrawingBufferSize(new THREE.Vector2());
        const cpu = state.cpuMs.values().sort((a, b) => a - b);
        return {
          ...summarizeFrames(state.frameMs.values()),
          calls: Math.round(state.calls.mean()),
          triangles: Math.round(state.tris.mean()),
          cpuRenderMs: Math.round(state.cpuMs.mean() * 10) / 10,
          cpuRenderP95Ms: Math.round((cpu[Math.max(0, Math.ceil(cpu.length * 0.95) - 1)] ?? 0) * 10) / 10,
          cpuFrameMs: Math.round(state.jsMs.mean() * 10) / 10,
          memory: estimateMemory(gl, scene),
          tier: q.tier,
          mode: q.mode,
          dpr: Math.round(gl.getPixelRatio() * 100) / 100,
          canvas: [size.x, size.y],
        };
      },
      inventory: () => inventory(scene),
      // DEV only: hide a top-level group (or the shadow pass, or the composer) to
      // attribute frame cost by elimination. Stripped from production builds.
      ...(import.meta.env.DEV ? {
        show: (name: string, visible: boolean) => {
          const o = scene.getObjectByName(name);
          if (o) o.visible = visible;
          return !!o;
        },
        shadows: (on: boolean) => {
          gl.shadowMap.autoUpdate = on;
          return gl.shadowMap.enabled;
        },
      } : {}),
    };
    (window as unknown as { __perf?: typeof api }).__perf = api;

    let overlay: HTMLDivElement | null = null;
    let timer: number | undefined;
    if (wantOverlay()) {
      overlay = document.createElement('div');
      overlay.setAttribute('data-perf-overlay', '');
      Object.assign(overlay.style, {
        position: 'fixed', top: 'calc(env(safe-area-inset-top, 0px) + 64px)', left: 'calc(env(safe-area-inset-left, 0px) + 6px)',
        zIndex: '9999', pointerEvents: 'none', font: '10px/1.35 "JetBrains Mono", ui-monospace, monospace',
        color: '#e7eaf0', background: 'rgba(10,11,14,0.78)', border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: '4px', padding: '4px 6px', whiteSpace: 'pre',
      } as CSSStyleDeclaration);
      document.body.appendChild(overlay);
      timer = window.setInterval(() => {
        const f = summarizeFrames(state.frameMs.values().slice(-120));
        const q = useQualityStore.getState();
        overlay!.textContent =
          `${f.fps.toFixed(0)} fps  p95 ${f.p95Ms.toFixed(1)} ms\n` +
          `${Math.round(state.calls.mean())} calls  ${(state.tris.mean() / 1e6).toFixed(2)}M tris\n` +
          `${q.tier.toUpperCase()} (${q.mode})  dpr ${gl.getPixelRatio().toFixed(2)}`;
      }, 500);
    }

    return () => {
      gl.render = orig;
      gl.info.autoReset = true;
      delete (window as unknown as { __perf?: unknown }).__perf;
      if (timer) window.clearInterval(timer);
      overlay?.remove();
    };
  }, [gl, scene]);

  // Runs FIRST in every frame (negative priority does not take over rendering):
  // what info holds now is the whole of the previous frame.
  useFrame(() => {
    const now = performance.now();
    if (lastT.current !== null) {
      state.frameMs.push(now - lastT.current);
      state.calls.push(gl.info.render.calls);
      state.tris.push(gl.info.render.triangles);
      state.cpuMs.push(cpuAcc.current);
      if (frameStart.current !== null && renderEnd.current !== null && renderEnd.current > frameStart.current) {
        state.jsMs.push(renderEnd.current - frameStart.current);
      }
    }
    frameStart.current = now;
    lastT.current = now;
    cpuAcc.current = 0;
    gl.info.reset();
  }, -1000);

  return null;
}
