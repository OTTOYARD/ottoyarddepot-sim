// ============================================================================
// OttoQStack — the OTTO-Q engine as an exploded stack of plates, in 3D, alive with its own records.
//
// Chase, 2026-09-30 ~1 AM CT: "majorly upgrade the visual depiction of the Otto-q funnel. Not just 2D, but More 3D and
// moving nodes/scaffolding etc." with two reference renders (agentic / solver / deterministic / dispatch plates).
//
// What is drawn, and from what (stackModel.ts places everything; this file only draws and moves it):
//   agent plate      red glass; a chrome sphere per agent pass, joined to a pearl for the objective it chose
//   planners plate   brushed metal; a bar per offer in its planner's lane, coloured by its disposition
//   decide plate     a tile per car decision; the red rim is the safety check and flares when it overrides a choice
//   depot base       a puck per car, in the zone of the site its state puts it (real charger and bay counts)
//   scaffolding      the posts the plates hang on (structure, carries no data)
//
// What moves, and why (every motion is one record or one change the engine reported):
//   a new agent pass      its sphere appears; a scan rises from the depot to the glass (it read the depot's frame);
//                         if it handed off to the solver, a bead falls to the planners
//   a new offer           its bar slides into its lane; an enacted one drops a bead to the decide plate
//   a new car decision    its tile flips up; one that places a car drops a bead to that car's puck; an override
//                         flares the rim
//   a car changing state  its puck glides to its new zone (two polls of ottoq_depot_cards)
// Records that were already there when the tab opened appear without playing. Nothing moves while the sim is paused,
// because nothing new is read. The loop renders only while something is moving (frameloop "demand").
// ============================================================================
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import {
  ENTRY_POINT, EXIT_POINT, PLATES, PLATE_D, PLATE_W, PLATE_Y, TILE_COLS, TILE_ROWS, zoneCenter,
  type BarTone, type PlateId, type PlateLabel, type PlateTag, type StackEvent, type StackModel,
} from "./stackModel";
import {
  contactShadowTexture, decideTexture, depotTexture, floorTexture, glassEtchTexture, glowTexture, plannerTexture, shieldTexture,
} from "./stackTextures";
import type { NodeTone } from "@/lib/ottoqFunnel";

// ── palette ─────────────────────────────────────────────────────────────────
const BG = "#0A0B0E";
const TONE_BODY: Record<NodeTone, string> = { ok: "#2FBF86", held: "#D9A13B", refused: "#E0424F", idle: "#8A8F99" };
const TONE_LIGHT: Record<NodeTone, THREE.Color> = {
  ok: new THREE.Color("#34D399").multiplyScalar(2.2),
  held: new THREE.Color("#FBBF24").multiplyScalar(1.6),
  refused: new THREE.Color("#FF4D5E").multiplyScalar(2.6),
  idle: new THREE.Color("#9AA0AA").multiplyScalar(0.6),
};
const TILE_COLOR: Record<NodeTone, string> = { ok: "#BFDCCB", held: "#C08E3C", refused: "#B8222E", idle: "#3D4048" };
const BAR_COLOR: Record<BarTone, string> = { ok: "#E4F1EA", refused: "#B3202C", replaced: "#7D828C", declined: "#2B2E35" };
const BAR_GLOW: Partial<Record<BarTone, THREE.Color>> = {
  ok: new THREE.Color("#34D399").multiplyScalar(2.4),
  refused: new THREE.Color("#FF4D5E").multiplyScalar(2.8),
};
const RED_HOT = new THREE.Color("#FF3347").multiplyScalar(2.4);
const SAFE_GLOW = new THREE.Color("#5CFFC0").multiplyScalar(1.3);

// ── runtime shared by every piece of the scene (mutable, never React state) ──
export type PickKind = "pass" | "offer" | "decision" | "car";
interface Waypoint { plate: PlateId | "floor"; x: number; z: number; dy: number }
interface Bead { t0: number; dur: number; from: Waypoint; to: Waypoint; color: THREE.Color; size: number; arc: number; onLand?: () => void; landed?: boolean; replay?: boolean }
/** A burst of light where a record's journey starts or ends: grows and fades. */
interface Flash { t0: number; dur: number; at: Waypoint; color: THREE.Color; size: number; replay?: boolean }
interface Runtime {
  mount: number;
  busyUntil: number;
  reduced: boolean;
  plateY: Record<PlateId, number>;
  plateFade: Record<PlateId, number>;
  reveal: Map<string, number>;
  rimFlash: number;
  /** When a decision last passed the safety check (the membrane brightens briefly). */
  shieldPass: number;
  laneFlash: Map<string, number>;
  puckPulse: Map<string, number>;
  beads: Bead[];
  flashes: Flash[];
  scans: number[];
  az: number;
  dragged: boolean;
  materials: Record<PlateId, { m: THREE.Material & { opacity: number }; base: number }[]>;
  /** Frames rendered since mount: an idle stack renders none. */
  frames: number;
  /** Hover and tap on a record's object (set by the component each render; the layers call them). */
  pick: { hover?: (kind: PickKind, key: string, e: ThreeEvent<PointerEvent>) => void; out?: () => void; tap?: (kind: PickKind, key: string) => void };
  /** Draw calls and triangles of the last frame, all passes. */
  lastInfo: { calls: number; triangles: number } | null;
}
const nowS = () => performance.now() / 1000;
const easeOutBack = (t: number) => { const c1 = 1.4, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

function useRuntime(reduced: boolean): Runtime {
  const ref = useRef<Runtime | null>(null);
  if (!ref.current) {
    ref.current = {
      mount: nowS(), busyUntil: nowS() + 2, reduced,
      plateY: { ...PLATE_Y }, plateFade: { agent: 1, planners: 1, decide: 1, safety: 1, depot: 1 },
      reveal: new Map(), rimFlash: -99, shieldPass: -99, laneFlash: new Map(), puckPulse: new Map(), beads: [], flashes: [], scans: [],
      az: 0, dragged: false, materials: { agent: [], planners: [], decide: [], safety: [], depot: [] }, frames: 0, lastInfo: null, pick: {},
    };
  }
  ref.current.reduced = reduced;
  return ref.current;
}

/** A plate's material that fades when another plate is in focus. */
function useFadeMaterial<T extends THREE.Material>(rt: Runtime, plate: PlateId, make: () => T): T {
  // Transparent from birth: three.js compiles an OPAQUE shader for a material first drawn opaque, and that shader
  // ignores opacity for good. Set in an effect, it raced the first frame and some plates would not fade.
  const m = useMemo(() => { const x = make(); x.transparent = true; return x; }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const entry = { m: m as unknown as THREE.Material & { opacity: number }, base: (m as unknown as { opacity: number }).opacity ?? 1 };
    rt.materials[plate].push(entry);
    return () => { rt.materials[plate] = rt.materials[plate].filter((e) => e !== entry); m.dispose(); };
  }, [m, plate, rt]);
  return m;
}

/** Appear scale for a record's object: 0 until its event plays, then a quick overshoot to full size. */
function appear(rt: Runtime, key: string, t: number): number {
  const at = rt.reveal.get(key);
  if (at == null) {
    // present when the tab opened: a staggered build-in, once
    if (rt.reduced) return 1;
    const k = clamp01((t - rt.mount - 0.35 - (key.charCodeAt(key.length - 1) % 10) * 0.035) / 0.4);
    return k >= 1 ? 1 : easeOutBack(k) * (k > 0 ? 1 : 0);
  }
  if (t < at) return 0;
  const k = clamp01((t - at) / 0.35);
  return rt.reduced || k >= 1 ? 1 : easeOutBack(k);
}

/** Hover and tap handlers for an instanced layer whose instance i is the record order[i]. */
function pickHandlers(rt: Runtime, kind: PickKind, order: React.MutableRefObject<string[]>) {
  const keyOf = (e: ThreeEvent<PointerEvent | MouseEvent>) => (e.instanceId != null ? order.current[e.instanceId] : undefined);
  return {
    onPointerMove: (e: ThreeEvent<PointerEvent>) => {
      const k = keyOf(e);
      if (!k) return;
      e.stopPropagation();
      document.body.style.cursor = "pointer";
      rt.pick.hover?.(kind, k, e);
    },
    onPointerOut: () => { document.body.style.cursor = ""; rt.pick.out?.(); },
    onClick: (e: ThreeEvent<MouseEvent>) => {
      const k = keyOf(e);
      if (!k) return;
      e.stopPropagation();
      if (!rt.dragged) rt.pick.tap?.(kind, k);
    },
  };
}

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();
const tmpC = new THREE.Color();

interface Tween { x: number; z: number; fx: number; fz: number; tx: number; tz: number; t0: number; dur: number; arc: number }
/** Glide every keyed object from where it is to where the model now puts it. */
function retarget(map: Map<string, Tween>, targets: { key: string; x: number; z: number }[], t: number, dur: number, arc = 0, rt?: Runtime) {
  const keep = new Set<string>();
  for (const o of targets) {
    keep.add(o.key);
    const tw = map.get(o.key);
    if (!tw) map.set(o.key, { x: o.x, z: o.z, fx: o.x, fz: o.z, tx: o.x, tz: o.z, t0: 0, dur, arc });
    else if (tw.tx !== o.x || tw.tz !== o.z) {
      map.set(o.key, { ...tw, fx: tw.x, fz: tw.z, tx: o.x, tz: o.z, t0: t, dur: rt?.reduced ? 0.001 : dur, arc });
      if (rt) rt.busyUntil = Math.max(rt.busyUntil, t + dur + 0.1);
    }
  }
  for (const k of [...map.keys()]) if (!keep.has(k)) map.delete(k);
}
function stepTween(tw: Tween, t: number): number {
  const k = tw.t0 ? clamp01((t - tw.t0) / tw.dur) : 1;
  const e = easeInOut(k);
  tw.x = tw.fx + (tw.tx - tw.fx) * e;
  tw.z = tw.fz + (tw.tz - tw.fz) * e;
  return k < 1 ? Math.sin(Math.PI * k) * tw.arc : 0;
}

// ── environment and light ───────────────────────────────────────────────────
function Env() {
  const { gl, scene } = useThree();
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    scene.background = new THREE.Color(BG);
    return () => { scene.environment = null; env.dispose(); pmrem.dispose(); };
  }, [gl, scene]);
  return (
    <>
      <ambientLight intensity={0.25} />
      <directionalLight position={[-4, 18, 10]} intensity={1.3} color="#ffffff" />
      <directionalLight position={[-9, 6, -6]} intensity={0.6} color="#ff3a4c" />
      <pointLight position={[0, -1.2, 5]} intensity={6} distance={14} color="#c8102e" />
    </>
  );
}

// ── plates ──────────────────────────────────────────────────────────────────
function PlateGroup({ rt, plate, children }: { rt: Runtime; plate: PlateId; children: React.ReactNode }) {
  const g = useRef<THREE.Group>(null);
  useFrame(() => {
    if (!g.current) return;
    g.current.position.y = rt.plateY[plate];
    // a plate faded out behind a zoom is taken away altogether (from above, a faded plate still sits in the view)
    g.current.visible = rt.plateFade[plate] > 0.075;
  });
  return <group ref={g} position={[0, PLATE_Y[plate], 0]}>{children}</group>;
}

function edgesOf(w: number, h: number, d: number): THREE.BufferGeometry {
  return new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d));
}

function PlateClick({ rt, plate, onFocus, w = PLATE_W, d = PLATE_D, y = 0.02 }: { rt: Runtime; plate: PlateId; onFocus: (p: PlateId) => void; w?: number; d?: number; y?: number }) {
  // An invisible hit-box above the plate's top: a tap on a plate focuses it (a drag does not).
  const onClick = (e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); if (!rt.dragged) onFocus(plate); };
  return (
    <mesh position={[0, y, 0]} rotation={[-Math.PI / 2, 0, 0]} onClick={onClick}
      onPointerOver={() => { document.body.style.cursor = "pointer"; }} onPointerOut={() => { document.body.style.cursor = ""; }}>
      <planeGeometry args={[w, d]} />
      <meshBasicMaterial visible={false} />
    </mesh>
  );
}

function AgentPlate({ rt, model, onFocus }: { rt: Runtime; model: StackModel["agent"]; onFocus: (p: PlateId) => void }) {
  const glass = useFadeMaterial(rt, "agent", () => new THREE.MeshPhysicalMaterial({
    color: "#7a0c17", roughness: 0.2, metalness: 0.05, clearcoat: 0.6, clearcoatRoughness: 0.25,
    emissive: "#3a0409", emissiveIntensity: 0.9, opacity: 0.42, envMapIntensity: 0.9, depthWrite: false,
  }));
  const etchTex = useMemo(glassEtchTexture, []);
  const etch = useFadeMaterial(rt, "agent", () => new THREE.MeshBasicMaterial({ map: etchTex, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending }));
  const edge = useFadeMaterial(rt, "agent", () => new THREE.LineBasicMaterial({ color: RED_HOT, toneMapped: false, opacity: 1 }));
  const edges = useMemo(() => edgesOf(PLATE_W, 0.1, PLATE_D), []);
  return (
    <PlateGroup rt={rt} plate="agent">
      <mesh material={glass} renderOrder={2}><boxGeometry args={[PLATE_W, 0.1, PLATE_D]} /></mesh>
      <mesh material={etch} position={[0, 0.052, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={3}><planeGeometry args={[PLATE_W, PLATE_D]} /></mesh>
      <lineSegments geometry={edges} material={edge} />
      <AgentNodes rt={rt} model={model} />
      <PlateClick rt={rt} plate="agent" onFocus={onFocus} y={0.06} />
    </PlateGroup>
  );
}

const MAX_SPHERES = 40;
function AgentNodes({ rt, model }: { rt: Runtime; model: StackModel["agent"] }) {
  const spheres = useRef<THREE.InstancedMesh>(null);
  const order = useRef<string[]>([]);
  const chrome = useFadeMaterial(rt, "agent", () => new THREE.MeshStandardMaterial({ metalness: 1, roughness: 0.16, envMapIntensity: 1.6, opacity: 1 }));
  const pearl = useFadeMaterial(rt, "agent", () => new THREE.MeshPhysicalMaterial({ color: "#f3eee6", roughness: 0.22, metalness: 0, clearcoat: 1, sheen: 1, sheenColor: new THREE.Color("#ffd9dd"), envMapIntensity: 1.3, opacity: 1 }));
  const lineMat = useFadeMaterial(rt, "agent", () => new THREE.LineBasicMaterial({ color: new THREE.Color("#ff4a5a").multiplyScalar(1.6), toneMapped: false, opacity: 0.55, depthWrite: false }));
  const chainMat = useFadeMaterial(rt, "agent", () => new THREE.LineBasicMaterial({ color: new THREE.Color("#ff8a95"), toneMapped: false, opacity: 0.22, depthWrite: false }));
  const glowTex = useMemo(glowTexture, []);
  const hubGlow = useFadeMaterial(rt, "agent", () => new THREE.SpriteMaterial({ map: glowTex, color: new THREE.Color("#ffd2d6").multiplyScalar(1.4), blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, opacity: 0.9 }));
  // The threads: pass → its objective, and pass → the pass before it. Each grows out as its pass appears, so a pass
  // still to come (a replay's, or one landing now) has no thread yet.
  const segs = () => { const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX_SPHERES * 6), 3)); g.setDrawRange(0, 0); return g; };
  const lines = useMemo(segs, []);
  const chain = useMemo(segs, []);
  useEffect(() => () => { lines.dispose(); chain.dispose(); glowTex.dispose(); }, [lines, chain, glowTex]);
  useEffect(() => { rt.busyUntil = Math.max(rt.busyUntil, nowS() + 0.1); }, [model, rt]);

  useEffect(() => {
    const m = spheres.current;
    if (!m) return;
    for (let i = 0; i < MAX_SPHERES; i++) m.setColorAt(i, tmpC.set("#ffffff"));
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, []);

  useFrame(() => {
    const m = spheres.current;
    if (!m) return;
    const t = nowS();
    let i = 0;
    for (const p of model.passes) {
      if (i >= MAX_SPHERES) break;
      const s = appear(rt, p.key, t) * p.r;
      tmpP.set(p.x, 0.05 + p.r, p.z);
      tmpS.setScalar(Math.max(0.0001, s));
      m.setMatrixAt(i, tmpM.compose(tmpP, tmpQ.identity(), tmpS));
      m.setColorAt(i, tmpC.set(p.tone === "held" ? "#E0A43E" : p.newest ? "#ffffff" : "#d9dbe0"));
      order.current[i] = p.key;
      i++;
    }
    m.count = i;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    const lp = lines.getAttribute("position") as THREE.BufferAttribute, cp = chain.getAttribute("position") as THREE.BufferAttribute;
    const grown = model.passes.slice(0, MAX_SPHERES).map((p) => Math.min(1, appear(rt, p.key, t)));
    let nl = 0, nc = 0;
    grown.forEach((a, k) => {
      const e = model.hubEdges[k];
      if (a <= 0.001 || !e) return;
      lp.setXYZ(nl * 2, e[2], 0.12, e[3]);
      lp.setXYZ(nl * 2 + 1, e[2] + (e[0] - e[2]) * a, 0.12, e[3] + (e[1] - e[3]) * a);
      nl++;
      const c = model.chainEdges[k];
      if (!c || (grown[k + 1] ?? 0) <= 0.001) return;
      cp.setXYZ(nc * 2, c[2], 0.12, c[3]);
      cp.setXYZ(nc * 2 + 1, c[2] + (c[0] - c[2]) * a, 0.12, c[3] + (c[1] - c[3]) * a);
      nc++;
    });
    lines.setDrawRange(0, nl * 2); chain.setDrawRange(0, nc * 2);
    lp.needsUpdate = true; cp.needsUpdate = true;
  });

  return (
    <group>
      <lineSegments geometry={chain} material={chainMat} renderOrder={4} frustumCulled={false} />
      <lineSegments geometry={lines} material={lineMat} renderOrder={4} frustumCulled={false} />
      <instancedMesh ref={spheres} args={[undefined, undefined, MAX_SPHERES]} material={chrome} frustumCulled={false} {...pickHandlers(rt, "pass", order)}>
        <sphereGeometry args={[1, 28, 18]} />
      </instancedMesh>
      {model.hubs.map((h) => (
        <group key={h.key} position={[h.x, 0.34, h.z]}>
          <mesh material={pearl}><sphereGeometry args={[0.27, 32, 20]} /></mesh>
          <sprite material={hubGlow} scale={[1.1, 1.1, 1]} />
        </group>
      ))}
    </group>
  );
}

function PlannerPlate({ rt, lanes, onFocus }: { rt: Runtime; lanes: StackModel["planners"]; onFocus: (p: PlateId) => void }) {
  const laneKey = lanes.map((l) => `${l.word}@${l.z}`).join("|");
  const tex = useMemo(() => plannerTexture(lanes), [laneKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => tex.dispose(), [tex]);
  const body = useFadeMaterial(rt, "planners", () => new THREE.MeshStandardMaterial({ color: "#16181c", metalness: 0.85, roughness: 0.36, envMapIntensity: 1.1, opacity: 1 }));
  const top = useFadeMaterial(rt, "planners", () => new THREE.MeshStandardMaterial({ metalness: 0.7, roughness: 0.42, envMapIntensity: 0.9, opacity: 1 }));
  useEffect(() => { top.map = tex; top.needsUpdate = true; rt.busyUntil = Math.max(rt.busyUntil, nowS() + 0.1); }, [top, tex, rt]);
  const edge = useFadeMaterial(rt, "planners", () => new THREE.LineBasicMaterial({ color: "#8b909a", opacity: 0.5 }));
  const edges = useMemo(() => edgesOf(PLATE_W, 0.16, PLATE_D), []);
  return (
    <PlateGroup rt={rt} plate="planners">
      <mesh material={body}><boxGeometry args={[PLATE_W, 0.16, PLATE_D]} /></mesh>
      <mesh material={top} position={[0, 0.081, 0]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[PLATE_W, PLATE_D]} /></mesh>
      <lineSegments geometry={edges} material={edge} />
      <ContactShadow rt={rt} plate="planners" />
      <PlannerBars rt={rt} lanes={lanes} />
      <PlateClick rt={rt} plate="planners" onFocus={onFocus} y={0.1} />
    </PlateGroup>
  );
}

const MAX_BARS = 48;
function PlannerBars({ rt, lanes }: { rt: Runtime; lanes: StackModel["planners"] }) {
  const bars = useRef<THREE.InstancedMesh>(null);
  const order = useRef<string[]>([]);
  const glows = useRef<THREE.InstancedMesh>(null);
  const tw = useRef(new Map<string, Tween>());
  const barMat = useFadeMaterial(rt, "planners", () => new THREE.MeshStandardMaterial({ metalness: 0.55, roughness: 0.3, envMapIntensity: 1.2, opacity: 1 }));
  const glowMat = useFadeMaterial(rt, "planners", () => new THREE.MeshBasicMaterial({ toneMapped: false, opacity: 1 }));
  const flat = useMemo(() => lanes.flatMap((l) => l.bars.map((b) => ({ ...b, z: l.z, word: l.word }))), [lanes]);
  useEffect(() => { retarget(tw.current, flat.map((b) => ({ key: b.key, x: b.x, z: b.z })), nowS(), 0.55, 0, rt); rt.busyUntil = Math.max(rt.busyUntil, nowS() + 0.2); }, [flat, rt]);
  useEffect(() => {
    for (const m of [bars.current, glows.current]) {
      if (!m) continue;
      for (let i = 0; i < MAX_BARS; i++) m.setColorAt(i, tmpC.set("#ffffff"));
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }, []);
  useFrame(() => {
    const b = bars.current, g = glows.current;
    if (!b || !g) return;
    const t = nowS();
    let i = 0, j = 0;
    for (const bar of flat) {
      if (i >= MAX_BARS) break;
      const w = tw.current.get(bar.key);
      if (!w) continue;
      stepTween(w, t);
      const a = appear(rt, bar.key, t);
      // a new bar slides in from the lane's start
      const slide = (1 - a) * -1.2;
      const h = bar.tone === "declined" ? 0.05 : 0.16;
      tmpP.set(w.x + slide, 0.08 + h / 2, w.z);
      tmpS.set(Math.max(0.0001, bar.len * a), h, bar.tone === "declined" ? 0.26 : 0.34);
      b.setMatrixAt(i, tmpM.compose(tmpP, tmpQ.identity(), tmpS));
      b.setColorAt(i, tmpC.set(BAR_COLOR[bar.tone]));
      order.current[i] = bar.key;
      i++;
      const glow = BAR_GLOW[bar.tone];
      if (glow && j < MAX_BARS) {
        const flash = rt.laneFlash.get(bar.key);
        const boost = flash != null && t > flash && t < flash + 0.9 ? 1 + 2 * (1 - (t - flash) / 0.9) : 1;
        tmpP.set(w.x + slide, 0.08 + h + 0.004, w.z);
        tmpS.set(Math.max(0.0001, bar.len * a * 0.86), 0.01, 0.09);
        g.setMatrixAt(j, tmpM.compose(tmpP, tmpQ.identity(), tmpS));
        g.setColorAt(j, tmpC.copy(glow).multiplyScalar(boost));
        j++;
      }
    }
    b.count = i; g.count = j;
    b.instanceMatrix.needsUpdate = true; g.instanceMatrix.needsUpdate = true;
    if (b.instanceColor) b.instanceColor.needsUpdate = true;
    if (g.instanceColor) g.instanceColor.needsUpdate = true;
  });
  return (
    <group>
      <instancedMesh ref={bars} args={[undefined, undefined, MAX_BARS]} material={barMat} frustumCulled={false} {...pickHandlers(rt, "offer", order)}><boxGeometry args={[1, 1, 1]} /></instancedMesh>
      <instancedMesh ref={glows} args={[undefined, undefined, MAX_BARS]} material={glowMat} frustumCulled={false}><boxGeometry args={[1, 1, 1]} /></instancedMesh>
    </group>
  );
}

const TILE_X0 = -4.4, TILE_Z0 = 2.15, TILE_PITCH = 0.8;
function DecidePlate({ rt, tiles, onFocus }: { rt: Runtime; tiles: StackModel["tiles"]; onFocus: (p: PlateId) => void }) {
  const tex = useMemo(() => decideTexture(TILE_COLS, TILE_ROWS, TILE_X0, TILE_Z0, TILE_PITCH), []);
  useEffect(() => () => tex.dispose(), [tex]);
  const body = useFadeMaterial(rt, "decide", () => new THREE.MeshStandardMaterial({ color: "#202227", metalness: 0.8, roughness: 0.34, envMapIntensity: 1.1, opacity: 1 }));
  const top = useFadeMaterial(rt, "decide", () => new THREE.MeshStandardMaterial({ map: tex, metalness: 0.65, roughness: 0.4, envMapIntensity: 0.9, opacity: 1 }));
  const rim = useFadeMaterial(rt, "decide", () => new THREE.LineBasicMaterial({ color: "#9aa0aa", opacity: 0.6 }));
  const rimEdges = useMemo(() => edgesOf(PLATE_W + 0.02, 0.17, PLATE_D + 0.02), []);
  return (
    <PlateGroup rt={rt} plate="decide">
      <mesh material={body}><boxGeometry args={[PLATE_W, 0.16, PLATE_D]} /></mesh>
      <mesh material={top} position={[0, 0.081, 0]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[PLATE_W, PLATE_D]} /></mesh>
      <lineSegments geometry={rimEdges} material={rim} />
      <ContactShadow rt={rt} plate="decide" />
      <DecideTiles rt={rt} tiles={tiles} />
      <PlateClick rt={rt} plate="decide" onFocus={onFocus} y={0.1} />
    </PlateGroup>
  );
}

/**
 * The safety check (the L1 shield), as its own plate between the decide plate and the depot: a lattice membrane every
 * decision passes through on its way down. A choice the check overrides stops here: a red block sits under its tile
 * and the rim flares. The membrane itself is structure; the blocks are records (decisions written overridden_to_default).
 */
function SafetyPlate({ rt, tiles, onFocus }: { rt: Runtime; tiles: StackModel["tiles"]; onFocus: (p: PlateId) => void }) {
  const tex = useMemo(shieldTexture, []);
  useEffect(() => () => tex.dispose(), [tex]);
  const glass = useFadeMaterial(rt, "safety", () => new THREE.MeshPhysicalMaterial({
    color: "#0d2a22", roughness: 0.15, metalness: 0.1, clearcoat: 0.8, emissive: "#062a1c", emissiveIntensity: 0.8,
    opacity: 0.32, envMapIntensity: 1.0, depthWrite: false,
  }));
  const lattice = useFadeMaterial(rt, "safety", () => new THREE.MeshBasicMaterial({ map: tex, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  const rim = useFadeMaterial(rt, "safety", () => new THREE.LineBasicMaterial({ color: SAFE_GLOW.clone(), toneMapped: false, opacity: 1 }));
  const edges = useMemo(() => edgesOf(PLATE_W, 0.06, PLATE_D), []);
  const blockMat = useFadeMaterial(rt, "safety", () => new THREE.MeshBasicMaterial({ color: RED_HOT.clone(), toneMapped: false, opacity: 0.95 }));
  const blocks = useMemo(() => tiles.filter((t) => t.tone === "refused"), [tiles]);
  const order = useRef<string[]>([]);
  const blockMesh = useRef<THREE.InstancedMesh>(null);
  useFrame(() => {
    // Steady green while nothing is blocked; a block flares the rim red for 1.2 s.
    const t = nowS();
    const k = clamp01(1 - (t - rt.rimFlash) / 1.2);
    rim.color.copy(SAFE_GLOW).lerp(RED_HOT, k).multiplyScalar(0.7 + 1.4 * k);
    const pass = clamp01(1 - (t - rt.shieldPass) / 0.6);
    lattice.color.setScalar(0.8 + 1.2 * pass);
    const m = blockMesh.current;
    if (!m) return;
    let i = 0;
    for (const b of blocks) {
      const a = appear(rt, b.key, t);
      tmpS.set(0.5 * Math.max(0.0001, a), 0.06, 0.5 * Math.max(0.0001, a));
      m.setMatrixAt(i, tmpM.compose(tmpP.set(b.x, 0.06, b.z), tmpQ.identity(), tmpS));
      order.current[i] = b.key;
      i++;
    }
    m.count = i;
    m.instanceMatrix.needsUpdate = true;
  });
  return (
    <PlateGroup rt={rt} plate="safety">
      <mesh material={glass} renderOrder={2}><boxGeometry args={[PLATE_W, 0.06, PLATE_D]} /></mesh>
      <mesh material={lattice} position={[0, 0.032, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={3}><planeGeometry args={[PLATE_W, PLATE_D]} /></mesh>
      <lineSegments geometry={edges} material={rim} />
      <instancedMesh ref={blockMesh} args={[undefined, undefined, MAX_TILES]} material={blockMat} frustumCulled={false} {...pickHandlers(rt, "decision", order)}>
        <boxGeometry args={[1, 1, 1]} />
      </instancedMesh>
      <PlateClick rt={rt} plate="safety" onFocus={onFocus} y={0.05} />
    </PlateGroup>
  );
}

const MAX_TILES = TILE_COLS * TILE_ROWS;
function DecideTiles({ rt, tiles }: { rt: Runtime; tiles: StackModel["tiles"] }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const order = useRef<string[]>([]);
  const caps = useRef<THREE.InstancedMesh>(null);
  const tw = useRef(new Map<string, Tween>());
  const mat = useFadeMaterial(rt, "decide", () => new THREE.MeshStandardMaterial({ metalness: 0.25, roughness: 0.5, envMapIntensity: 0.8, opacity: 1 }));
  const capMat = useFadeMaterial(rt, "decide", () => new THREE.MeshBasicMaterial({ toneMapped: false, opacity: 0.95 }));
  useEffect(() => { retarget(tw.current, tiles, nowS(), 0.5, 0, rt); rt.busyUntil = Math.max(rt.busyUntil, nowS() + 0.2); }, [tiles, rt]);
  useEffect(() => {
    for (const m of [mesh.current, caps.current]) {
      if (!m) continue;
      for (let i = 0; i < MAX_TILES; i++) m.setColorAt(i, tmpC.set("#ffffff"));
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }, []);
  const axis = useMemo(() => new THREE.Vector3(1, 0, 0), []);
  useFrame(() => {
    const m = mesh.current, c = caps.current;
    if (!m || !c) return;
    const t = nowS();
    let i = 0, j = 0;
    for (const tile of tiles) {
      if (i >= MAX_TILES) break;
      const w = tw.current.get(tile.key);
      if (!w) continue;
      stepTween(w, t);
      const a = appear(rt, tile.key, t);
      // a new tile flips up out of its socket
      const flip = (1 - Math.min(1, a)) * Math.PI;
      const h = tile.tone === "ok" ? 0.16 : tile.tone === "refused" ? 0.2 : tile.tone === "held" ? 0.1 : 0.06;
      tmpQ.setFromAxisAngle(axis, flip);
      tmpP.set(w.x, 0.08 + (h / 2) * Math.max(0.2, a), w.z);
      tmpS.set(0.66 * Math.max(0.0001, Math.min(1.08, a)), h, 0.66 * Math.max(0.0001, Math.min(1.08, a)));
      m.setMatrixAt(i, tmpM.compose(tmpP, tmpQ, tmpS));
      m.setColorAt(i, tmpC.set(TILE_COLOR[tile.tone]));
      order.current[i] = tile.key;
      i++;
      const at = rt.reveal.get(tile.key);
      const fresh = at != null && t >= at && t < at + 1.4 ? 1 - (t - at) / 1.4 : 0;
      if ((tile.tone === "refused" || tile.tone === "ok" || fresh > 0) && a > 0.6) {
        tmpQ.identity();
        tmpP.set(w.x, 0.08 + h + 0.003, w.z);
        const big = tile.tone === "refused" || fresh > 0;
        tmpS.set(big ? 0.56 : 0.2, 0.004, big ? 0.56 : 0.2);
        c.setMatrixAt(j, tmpM.compose(tmpP, tmpQ, tmpS));
        c.setColorAt(j, tmpC.copy(TONE_LIGHT[tile.tone]).multiplyScalar((tile.tone === "ok" ? 0.55 : 1) + 1.6 * fresh));
        j++;
      }
    }
    m.count = i; c.count = j;
    m.instanceMatrix.needsUpdate = true; c.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    if (c.instanceColor) c.instanceColor.needsUpdate = true;
  });
  return (
    <group>
      <instancedMesh ref={mesh} args={[undefined, undefined, MAX_TILES]} material={mat} frustumCulled={false} {...pickHandlers(rt, "decision", order)}><boxGeometry args={[1, 1, 1]} /></instancedMesh>
      <instancedMesh ref={caps} args={[undefined, undefined, MAX_TILES]} material={capMat} frustumCulled={false}><boxGeometry args={[1, 1, 1]} /></instancedMesh>
    </group>
  );
}

function DepotPlate({ rt, depot, onFocus }: { rt: Runtime; depot: StackModel["depot"]; onFocus: (p: PlateId) => void }) {
  const tex = useMemo(depotTexture, []);
  useEffect(() => () => { tex.dispose(); }, [tex]);
  const body = useFadeMaterial(rt, "depot", () => new THREE.MeshStandardMaterial({ color: "#121316", metalness: 0.8, roughness: 0.42, envMapIntensity: 1, opacity: 1 }));
  const top = useFadeMaterial(rt, "depot", () => new THREE.MeshStandardMaterial({ map: tex, metalness: 0.6, roughness: 0.46, envMapIntensity: 0.8, opacity: 1 }));
  const portBody = useFadeMaterial(rt, "depot", () => new THREE.MeshStandardMaterial({ color: "#2a2c31", metalness: 0.9, roughness: 0.3, opacity: 1 }));
  const portSlot = useFadeMaterial(rt, "depot", () => new THREE.MeshBasicMaterial({ color: new THREE.Color("#ff2a3d").multiplyScalar(1.5), toneMapped: false, opacity: 1 }));
  const edge = useFadeMaterial(rt, "depot", () => new THREE.LineBasicMaterial({ color: new THREE.Color("#c8102e").multiplyScalar(1.2), toneMapped: false, opacity: 0.8 }));
  const edges = useMemo(() => edgesOf(PLATE_W + 0.4, 0.55, PLATE_D + 0.4), []);
  // The chassis' ports: structure, like the reference's. They carry no data and never change.
  const ports = useMemo(() => {
    const out: [number, number, number, number][] = [];
    for (let i = 0; i < 7; i++) out.push([-4.2 + i * 1.4, -0.26, PLATE_D / 2 + 0.22, 0]);
    for (let i = 0; i < 4; i++) out.push([PLATE_W / 2 + 0.22, -0.26, -2.5 + i * 1.5, Math.PI / 2]);
    return out;
  }, []);
  return (
    <PlateGroup rt={rt} plate="depot">
      <mesh material={body} position={[0, -0.275, 0]}><boxGeometry args={[PLATE_W + 0.4, 0.55, PLATE_D + 0.4]} /></mesh>
      <lineSegments geometry={edges} material={edge} position={[0, -0.275, 0]} />
      <mesh material={top} position={[0, 0.002, 0]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[PLATE_W, PLATE_D]} /></mesh>
      <Ports ports={ports} body={portBody} slot={portSlot} />
      <ContactShadow rt={rt} plate="depot" />
      <Pucks rt={rt} depot={depot} />
      <PlateClick rt={rt} plate="depot" onFocus={onFocus} y={0.05} />
    </PlateGroup>
  );
}

/** The chassis' ports, instanced: bodies and their lit slots. */
function Ports({ ports, body, slot }: { ports: [number, number, number, number][]; body: THREE.Material; slot: THREE.Material }) {
  const b = useRef<THREE.InstancedMesh>(null);
  const s = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const B = b.current, S = s.current;
    if (!B || !S) return;
    const e = new THREE.Euler();
    const off = new THREE.Vector3();
    ports.forEach(([x, y, z, ry], i) => {
      tmpQ.setFromEuler(e.set(0, ry, 0));
      B.setMatrixAt(i, tmpM.compose(tmpP.set(x, y, z), tmpQ, tmpS.set(0.62, 0.3, 0.2)));
      off.set(0, 0, 0.101).applyQuaternion(tmpQ);
      S.setMatrixAt(i, tmpM.compose(tmpP.set(x + off.x, y, z + off.z), tmpQ, tmpS.set(0.4, 0.08, 1)));
    });
    B.instanceMatrix.needsUpdate = true; S.instanceMatrix.needsUpdate = true;
  }, [ports]);
  return (
    <group>
      <instancedMesh ref={b} args={[undefined, undefined, ports.length]} material={body} frustumCulled={false}><boxGeometry args={[1, 1, 1]} /></instancedMesh>
      <instancedMesh ref={s} args={[undefined, undefined, ports.length]} material={slot} frustumCulled={false}><planeGeometry args={[1, 1]} /></instancedMesh>
    </group>
  );
}

const MAX_PUCKS = 170;
function Pucks({ rt, depot }: { rt: Runtime; depot: StackModel["depot"] }) {
  const body = useRef<THREE.InstancedMesh>(null);
  const order = useRef<string[]>([]);
  const light = useRef<THREE.InstancedMesh>(null);
  const tw = useRef(new Map<string, Tween>());
  const born = useRef(new Map<string, number>());
  /** Cars the last read no longer places in the depot: they drive out through the west gate and fade. */
  const leaving = useRef(new Map<string, { tw: Tween; t0: number; tone: NodeTone }>());
  const lastTone = useRef(new Map<string, NodeTone>());
  const mat = useFadeMaterial(rt, "depot", () => new THREE.MeshStandardMaterial({ metalness: 0.5, roughness: 0.28, envMapIntensity: 1.2, opacity: 1 }));
  const lmat = useFadeMaterial(rt, "depot", () => new THREE.MeshBasicMaterial({ toneMapped: false, opacity: 1 }));
  const lastRead = useRef(false);
  useEffect(() => {
    const t = nowS();
    // Arrivals and departures are drawn only between two real reads of the cards, and only as the engine reports them:
    // a new car on the road or at the gate comes up the east road; a car the engine now reports DEPLOYED drives out
    // through the west gate. Any other car that appears or vanishes (a missed read, a run change, a car powered down in
    // place) simply appears or fades where it is. Motion is never invented to explain a gap in the data.
    const animate = depot.read && lastRead.current && !rt.reduced;
    for (const p of depot.pucks) {
      if (!tw.current.has(p.id) && animate && (p.zone === "road" || p.zone === "gate")) {
        tw.current.set(p.id, { x: ENTRY_POINT.x, z: ENTRY_POINT.z, fx: ENTRY_POINT.x, fz: ENTRY_POINT.z, tx: ENTRY_POINT.x, tz: ENTRY_POINT.z, t0: 0, dur: 1.4, arc: 0 });
      }
      if (!born.current.has(p.id)) born.current.set(p.id, t);
    }
    const now = new Set(depot.pucks.map((p) => p.id));
    if (animate) {
      for (const [id, w] of tw.current) {
        if (now.has(id)) continue;
        const out = depot.deployed.has(id);
        leaving.current.set(id, {
          tw: { ...w, fx: w.x, fz: w.z, tx: out ? EXIT_POINT.x : w.x, tz: out ? EXIT_POINT.z : w.z, t0: t, dur: out ? 1.6 : 0.5, arc: out ? 0.3 : 0 },
          t0: t, tone: lastTone.current.get(id) ?? "idle",
        });
        rt.busyUntil = Math.max(rt.busyUntil, t + 1.8);
      }
    }
    for (const p of depot.pucks) { lastTone.current.set(p.id, p.tone); leaving.current.delete(p.id); }
    retarget(tw.current, depot.pucks.map((p) => ({ key: p.id, x: p.x, z: p.z })), t, 1.4, 0.55, rt);
    lastRead.current = depot.read;
    rt.busyUntil = Math.max(rt.busyUntil, t + 0.2);
  }, [depot, rt]);
  useEffect(() => {
    for (const m of [body.current, light.current]) {
      if (!m) continue;
      for (let i = 0; i < MAX_PUCKS; i++) m.setColorAt(i, tmpC.set("#ffffff"));
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }, []);
  useFrame(() => {
    const b = body.current, l = light.current;
    if (!b || !l) return;
    const t = nowS();
    let i = 0;
    for (const p of depot.pucks) {
      if (i >= MAX_PUCKS) break;
      const w = tw.current.get(p.id);
      if (!w) continue;
      const lift = stepTween(w, t);
      const a = appear(rt, `car:${p.id}`, t);
      const pulseAt = rt.puckPulse.get(p.id);
      const pulse = pulseAt != null && t > pulseAt && t < pulseAt + 0.8 ? 1 + 0.6 * Math.sin(((t - pulseAt) / 0.8) * Math.PI) : 1;
      tmpP.set(w.x, 0.08 + lift, w.z);
      tmpS.set(0.34 * a * pulse, 0.16 * a, 0.26 * a * pulse);
      b.setMatrixAt(i, tmpM.compose(tmpP, tmpQ.identity(), tmpS));
      b.setColorAt(i, tmpC.set(TONE_BODY[p.tone]));
      tmpP.set(w.x, 0.165 + lift, w.z);
      tmpS.set(0.24 * a * pulse, 0.012, 0.16 * a * pulse);
      l.setMatrixAt(i, tmpM.compose(tmpP, tmpQ.identity(), tmpS));
      l.setColorAt(i, tmpC.copy(TONE_LIGHT[p.tone]).multiplyScalar(pulse));
      order.current[i] = p.id;
      i++;
    }
    for (const [id, g] of leaving.current) {
      if (i >= MAX_PUCKS) break;
      const k = (t - g.t0) / g.tw.dur;
      if (k >= 1) { leaving.current.delete(id); continue; }
      const lift = stepTween(g.tw, t);
      const a = 1 - clamp01((k - 0.7) / 0.3);
      tmpP.set(g.tw.x, 0.08 + lift, g.tw.z);
      tmpS.set(0.34 * a, 0.16 * a, 0.26 * a);
      b.setMatrixAt(i, tmpM.compose(tmpP, tmpQ.identity(), tmpS));
      b.setColorAt(i, tmpC.set(TONE_BODY[g.tone]));
      tmpP.set(g.tw.x, 0.165 + lift, g.tw.z);
      tmpS.set(0.24 * a, 0.012, 0.16 * a);
      l.setMatrixAt(i, tmpM.compose(tmpP, tmpQ.identity(), tmpS));
      l.setColorAt(i, tmpC.copy(TONE_LIGHT[g.tone]));
      order.current[i] = "";
      i++;
    }
    b.count = i; l.count = i;
    b.instanceMatrix.needsUpdate = true; l.instanceMatrix.needsUpdate = true;
    if (b.instanceColor) b.instanceColor.needsUpdate = true;
    if (l.instanceColor) l.instanceColor.needsUpdate = true;
  });
  return (
    <group>
      <instancedMesh ref={body} args={[undefined, undefined, MAX_PUCKS]} material={mat} frustumCulled={false} {...pickHandlers(rt, "car", order)}><boxGeometry args={[1, 1, 1]} /></instancedMesh>
      <instancedMesh ref={light} args={[undefined, undefined, MAX_PUCKS]} material={lmat} frustumCulled={false}><boxGeometry args={[1, 1, 1]} /></instancedMesh>
    </group>
  );
}

function ContactShadow({ rt, plate }: { rt: Runtime; plate: PlateId }) {
  const tex = useMemo(contactShadowTexture, []);
  useEffect(() => () => tex.dispose(), [tex]);
  const mat = useFadeMaterial(rt, plate, () => new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.8 }));
  return (
    <mesh material={mat} position={[0.25, plate === "depot" ? 0.006 : 0.084, -0.2]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[PLATE_W * 1.02, PLATE_D * 1.02]} />
    </mesh>
  );
}

// ── scaffolding: the posts the plates hang on ───────────────────────────────
function Scaffold({ rt }: { rt: Runtime }) {
  // Instanced: four posts, a collar where each post meets each plate, and two thin light pipes. Three draw calls.
  const posts = useRef<THREE.InstancedMesh>(null);
  const collars = useRef<THREE.InstancedMesh>(null);
  const pipes = useRef<THREE.InstancedMesh>(null);
  const metal = useMemo(() => new THREE.MeshStandardMaterial({ color: "#8d929c", metalness: 1, roughness: 0.25, envMapIntensity: 1.4, transparent: true, opacity: 1 }), []);
  const pipe = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color("#ff2a3d").multiplyScalar(1.3), toneMapped: false, transparent: true, opacity: 0.55 }), []);
  useEffect(() => () => { metal.dispose(); pipe.dispose(); }, [metal, pipe]);
  const corners = useMemo<[number, number][]>(() => [[-PLATE_W / 2 + 0.18, -PLATE_D / 2 + 0.18], [PLATE_W / 2 - 0.18, -PLATE_D / 2 + 0.18], [-PLATE_W / 2 + 0.18, PLATE_D / 2 - 0.18], [PLATE_W / 2 - 0.18, PLATE_D / 2 - 0.18]], []);
  const pipeXZ = useMemo<[number, number][]>(() => [[-2.2, 0.35], [2.6, -0.9]], []);
  const last = useRef("");
  useFrame(() => {
    const P = posts.current, C = collars.current, R = pipes.current;
    if (!P || !C || !R) return;
    // structure recedes when one plate is being read (its posts would otherwise cross the plate in front of it)
    const f = Math.min(rt.plateFade.agent, rt.plateFade.planners, rt.plateFade.decide, rt.plateFade.depot);
    metal.opacity = 0.08 + 0.92 * ((f - 0.07) / 0.93);
    // the light pipes brighten while a record is travelling down the stack, and only then
    const t = nowS();
    const travelling = rt.beads.filter((b) => t >= b.t0 && t < b.t0 + b.dur).length;
    pipe.opacity = (0.4 + 0.5 * Math.min(1, travelling / 2)) * ((f - 0.07) / 0.93);
    const key = PLATES.map((p) => rt.plateY[p.id].toFixed(3)).join(",");
    if (key === last.current) return;
    last.current = key;
    const y0 = rt.plateY.depot, y1 = rt.plateY.agent;
    tmpQ.identity();
    corners.forEach(([x, z], i) => {
      P.setMatrixAt(i, tmpM.compose(tmpP.set(x, (y0 + y1) / 2, z), tmpQ, tmpS.set(1, y1 - y0, 1)));
      PLATES.forEach((p, j) => C.setMatrixAt(i * PLATES.length + j, tmpM.compose(tmpP.set(x, rt.plateY[p.id] - 0.02, z), tmpQ, tmpS.set(1, 1, 1))));
    });
    pipeXZ.forEach(([x, z], i) => R.setMatrixAt(i, tmpM.compose(tmpP.set(x, (y0 + y1) / 2, z), tmpQ, tmpS.set(1, y1 - y0, 1))));
    P.instanceMatrix.needsUpdate = true; C.instanceMatrix.needsUpdate = true; R.instanceMatrix.needsUpdate = true;
  });
  return (
    <group>
      <instancedMesh ref={posts} args={[undefined, undefined, 4]} material={metal} frustumCulled={false}><cylinderGeometry args={[0.05, 0.05, 1, 12]} /></instancedMesh>
      <instancedMesh ref={collars} args={[undefined, undefined, 4 * PLATES.length]} material={metal} frustumCulled={false}><cylinderGeometry args={[0.11, 0.11, 0.12, 16]} /></instancedMesh>
      <instancedMesh ref={pipes} args={[undefined, undefined, 2]} material={pipe} frustumCulled={false}><cylinderGeometry args={[0.012, 0.012, 1, 6]} /></instancedMesh>
    </group>
  );
}

// ── beads, scans and landing rings ──────────────────────────────────────────
const MAX_BEADS = 48;
const TRAIL = 9;
const MAX_FLASH = 64;
const beadVert = /* glsl */ `
  attribute float aSize; attribute vec3 aColor; attribute float aRing; varying vec3 vColor; varying float vRing; uniform float uScale;
  void main() { vColor = aColor; vRing = aRing; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = aSize * uScale / -mv.z; gl_Position = projectionMatrix * mv; }`;
const beadFrag = /* glsl */ `
  varying vec3 vColor; varying float vRing;
  void main() {
    vec2 c = gl_PointCoord - 0.5; float d = length(c);
    float core = smoothstep(0.5, 0.0, d); core *= core;
    float ring = smoothstep(0.08, 0.0, abs(d - 0.4)) * smoothstep(0.5, 0.42, d);
    float a = mix(core, ring, vRing);
    gl_FragColor = vec4(vColor * a, a);
  }`;

function worldOf(rt: Runtime, w: Waypoint, out: THREE.Vector3): THREE.Vector3 {
  const y = w.plate === "floor" ? -0.6 : rt.plateY[w.plate];
  return out.set(w.x, y + w.dy, w.z);
}

function Beads({ rt }: { rt: Runtime }) {
  const { size, camera } = useThree();
  const N = MAX_BEADS * TRAIL + MAX_FLASH;
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    g.setAttribute("aColor", new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(new Float32Array(N), 1));
    g.setAttribute("aRing", new THREE.BufferAttribute(new Float32Array(N), 1));
    return g;
  }, [N]);
  const mat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 1 } }, vertexShader: beadVert, fragmentShader: beadFrag,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
  }), []);
  // one beam per bead: the path the record takes, lit while it travels
  const beamGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX_BEADS * 2 * 3), 3));
    g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(MAX_BEADS * 2 * 3), 3));
    return g;
  }, []);
  const beamMat = useMemo(() => new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }), []);
  const scanTex = useMemo(() => {
    const c = document.createElement("canvas"); c.width = 256; c.height = 170;
    const x = c.getContext("2d")!;
    x.strokeStyle = "rgba(255,140,150,1)"; x.lineWidth = 7; x.strokeRect(4, 4, 248, 162);
    x.strokeStyle = "rgba(255,120,130,0.4)"; x.lineWidth = 2; x.strokeRect(18, 18, 220, 134);
    const g = x.createLinearGradient(0, 0, 0, 170);
    g.addColorStop(0, "rgba(255,80,95,0.10)"); g.addColorStop(0.5, "rgba(255,80,95,0.02)"); g.addColorStop(1, "rgba(255,80,95,0.10)");
    x.fillStyle = g; x.fillRect(8, 8, 240, 154);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }, []);
  const scanMat = useMemo(() => new THREE.MeshBasicMaterial({ map: scanTex, color: new THREE.Color(1.6, 1.6, 1.6), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, opacity: 0, side: THREE.DoubleSide }), [scanTex]);
  const scan = useRef<THREE.Mesh>(null);
  useEffect(() => () => { geo.dispose(); mat.dispose(); beamGeo.dispose(); beamMat.dispose(); scanTex.dispose(); scanMat.dispose(); }, [geo, mat, beamGeo, beamMat, scanTex, scanMat]);
  const a = useMemo(() => new THREE.Vector3(), []);
  const b = useMemo(() => new THREE.Vector3(), []);

  useFrame(() => {
    const t = nowS();
    const persp = camera as THREE.PerspectiveCamera;
    mat.uniforms.uScale.value = (size.height * Math.min(2, window.devicePixelRatio || 1)) / (2 * Math.tan((persp.fov * Math.PI) / 360));
    const pos = geo.getAttribute("position") as THREE.BufferAttribute;
    const col = geo.getAttribute("aColor") as THREE.BufferAttribute;
    const sz = geo.getAttribute("aSize") as THREE.BufferAttribute;
    const ring = geo.getAttribute("aRing") as THREE.BufferAttribute;
    const bpos = beamGeo.getAttribute("position") as THREE.BufferAttribute;
    const bcol = beamGeo.getAttribute("color") as THREE.BufferAttribute;
    let n = 0, nb = 0;
    rt.beads = rt.beads.filter((bd) => t < bd.t0 + bd.dur + 0.3);
    for (const bd of rt.beads) {
      const k = (t - bd.t0) / bd.dur;
      if (k < 0) continue;
      if (k >= 1 && !bd.landed) {
        bd.landed = true;
        rt.flashes.push({ t0: t, dur: 0.9, at: bd.to, color: bd.color, size: bd.size * 3.2 });
        bd.onLand?.();
      }
      worldOf(rt, bd.from, a);
      worldOf(rt, bd.to, b);
      const fade = k >= 1 ? clamp01(1 - (t - bd.t0 - bd.dur) / 0.3) : 1;
      // the beam: the whole path, brightest mid-flight
      if (nb < MAX_BEADS) {
        const glow = Math.sin(Math.PI * clamp01(k)) * 0.35 * fade + (k >= 1 ? 0.12 * fade : 0);
        bpos.setXYZ(nb * 2, a.x, a.y, a.z); bpos.setXYZ(nb * 2 + 1, b.x, b.y, b.z);
        bcol.setXYZ(nb * 2, bd.color.r * glow, bd.color.g * glow, bd.color.b * glow);
        bcol.setXYZ(nb * 2 + 1, bd.color.r * glow, bd.color.g * glow, bd.color.b * glow);
        nb++;
      }
      for (let s2 = 0; s2 < TRAIL && n < MAX_BEADS * TRAIL; s2++) {
        const kk = clamp01(k - s2 * 0.035);
        const e = easeInOut(kk);
        const x = a.x + (b.x - a.x) * e, z = a.z + (b.z - a.z) * e;
        const y = a.y + (b.y - a.y) * e + Math.sin(Math.PI * e) * bd.arc;
        pos.setXYZ(n, x, y, z);
        const w = (1 - s2 / TRAIL) * fade;
        col.setXYZ(n, bd.color.r * w, bd.color.g * w, bd.color.b * w);
        sz.setX(n, bd.size * (s2 === 0 ? 1.25 : 0.8 - s2 * 0.06));
        ring.setX(n, 0);
        n++;
      }
    }
    // flashes: a ring that opens where a journey starts or lands
    rt.flashes = rt.flashes.filter((f) => t < f.t0 + f.dur);
    for (const f of rt.flashes) {
      if (n >= N) break;
      const k = (t - f.t0) / f.dur;
      if (k < 0) continue;
      worldOf(rt, f.at, a);
      pos.setXYZ(n, a.x, a.y + 0.05, a.z);
      const w = (1 - k) * (1 - k);
      col.setXYZ(n, f.color.r * w, f.color.g * w, f.color.b * w);
      sz.setX(n, f.size * (0.4 + 0.9 * easeInOut(k)));
      ring.setX(n, 1);
      n++;
      if (n < N) {
        pos.setXYZ(n, a.x, a.y + 0.05, a.z);
        col.setXYZ(n, f.color.r * w * 0.8, f.color.g * w * 0.8, f.color.b * w * 0.8);
        sz.setX(n, f.size * 0.5 * (1 - k));
        ring.setX(n, 0);
        n++;
      }
    }
    geo.setDrawRange(0, n);
    pos.needsUpdate = true; col.needsUpdate = true; sz.needsUpdate = true; ring.needsUpdate = true;
    beamGeo.setDrawRange(0, nb * 2);
    bpos.needsUpdate = true; bcol.needsUpdate = true;
    // The read scan: a frame of light that rises from the depot to the glass when the agent reads the depot.
    const m = scan.current;
    if (m) {
      rt.scans = rt.scans.filter((sc) => t < sc + 1.5);
      const s0 = rt.scans.find((sc) => t >= sc);
      if (s0 != null) {
        const k = clamp01((t - s0) / 1.4);
        m.visible = true;
        m.position.y = rt.plateY.depot + (rt.plateY.agent - rt.plateY.depot) * easeInOut(k);
        scanMat.opacity = Math.sin(Math.PI * k) * 0.9;
      } else m.visible = false;
    }
  });
  return (
    <group>
      <lineSegments geometry={beamGeo} material={beamMat} frustumCulled={false} renderOrder={9} />
      <points geometry={geo} material={mat} frustumCulled={false} renderOrder={10} />
      <mesh ref={scan} material={scanMat} rotation={[-Math.PI / 2, 0, 0]} visible={false} renderOrder={9}>
        <planeGeometry args={[PLATE_W * 1.04, PLATE_D * 1.04]} />
      </mesh>
    </group>
  );
}

// ── floor ───────────────────────────────────────────────────────────────────
function Floor() {
  const tex = useMemo(floorTexture, []);
  useEffect(() => () => tex.dispose(), [tex]);
  return (
    <mesh position={[0, -0.9, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[26, 26]} />
      <meshBasicMaterial map={tex} transparent depthWrite={false} />
    </mesh>
  );
}

// ── camera, focus, labels ───────────────────────────────────────────────────
const BASE_AZ = 0.9;      // radians to the east of south: the stack is seen from its south-east corner
const BASE_EL = 0.5;
/** Share of the canvas the stack is moved left by, so its labels have the right-hand column to themselves. */
const STACK_SHIFT = 0.16;
export interface LabelRefs {
  box: (HTMLElement | null)[];
  line: (SVGPolylineElement | null)[];
  /** The zoomed plate's tags, placed on the plate every frame. */
  tags: { plate: PlateId | null; items: readonly PlateTag[]; els: (HTMLElement | null)[] };
}

/** Points that must stay in frame: every plate's corners (the depot's underside too). */
function framePoints(rt: Runtime, only: PlateId | null): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  const hw = PLATE_W / 2 + 0.2, hd = PLATE_D / 2 + 0.2;
  for (const p of PLATES) {
    if (only && p.id !== only) continue;
    const y = rt.plateY[p.id];
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      pts.push(new THREE.Vector3(sx * hw, y + 0.35, sz * hd));
      if (p.id === "depot") pts.push(new THREE.Vector3(sx * hw, y - 0.55, sz * hd));
    }
  }
  return pts;
}

/** The camera distance at which the points fill `w` of the width and `h` of the height (NDC is -1..1). */
function fitDistance(cam: THREE.PerspectiveCamera, target: THREE.Vector3, az: number, el: number, pts: THREE.Vector3[], w: number, h: number): number {
  const v = new THREE.Vector3();
  let d = 40;
  for (let iter = 0; iter < 3; iter++) {
    cam.position.set(target.x + d * Math.cos(el) * Math.sin(az), target.y + d * Math.sin(el), target.z + d * Math.cos(el) * Math.cos(az));
    cam.lookAt(target);
    cam.filmOffset = 0;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of pts) {
      v.copy(p).project(cam);
      x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
    }
    const k = Math.max((x1 - x0) / (2 * w), (y1 - y0) / (2 * h));
    d *= k;
  }
  return d;
}

function Rig({ rt, focus, labels, labelColumn }: { rt: Runtime; focus: PlateId | null; labels: React.MutableRefObject<LabelRefs>; labelColumn: number }) {
  const { camera, size, invalidate, gl } = useThree();
  const cur = useRef<{ dist: number; ty: number; el: number; az: number; shift?: number }>({ dist: 0, ty: 4.6, el: BASE_EL, az: BASE_AZ });
  const v = useMemo(() => new THREE.Vector3(), []);
  const corner = useMemo(() => new THREE.Vector3(), []);
  const target = useMemo(() => new THREE.Vector3(), []);
  useFrame((_, dt) => {
    const t = nowS();
    // what the last frame cost, every pass of it (the bloom composer's included): counted, then reset
    rt.frames++;
    rt.lastInfo = { calls: gl.info.render.calls, triangles: gl.info.render.triangles };
    gl.info.reset();
    const cam = camera as THREE.PerspectiveCamera;
    const fi = focus ? PLATES.findIndex((p) => p.id === focus) : -1;
    // plates: an intro drop, then the focus spread
    const intro = rt.reduced ? 1 : easeInOut(clamp01((t - rt.mount) / 1.1));
    let moving = false;
    PLATES.forEach((p, i) => {
      const spread = fi >= 0 ? (fi - i) * 6.5 : 0;
      const goal = p.y + spread + (1 - intro) * (i + 1) * 1.6;
      const y = rt.plateY[p.id];
      const ny = rt.reduced ? goal : y + (goal - y) * Math.min(1, dt * 7);
      if (Math.abs(ny - goal) > 0.001) moving = true;
      rt.plateY[p.id] = Math.abs(ny - goal) < 0.001 ? goal : ny;
      const fadeGoal = fi < 0 || fi === i ? 1 : 0.07;
      const f = rt.plateFade[p.id];
      const nf = rt.reduced ? fadeGoal : f + (fadeGoal - f) * Math.min(1, dt * 6);
      if (Math.abs(nf - fadeGoal) > 0.002) moving = true;
      rt.plateFade[p.id] = Math.abs(nf - fadeGoal) < 0.002 ? fadeGoal : nf;
      for (const e of rt.materials[p.id]) e.m.opacity = e.base * rt.plateFade[p.id] * intro;
    });
    // camera: fitted, from the stack's south-east. The whole stack slides left for its labels; a focused plate is
    // centred, steeper, and fills the width.
    const fitW = fi >= 0 ? 0.9 : 1 - STACK_SHIFT * 2 - 0.04;
    const tyGoal = fi >= 0 ? PLATES[fi].y : (PLATES[0].y + PLATES[PLATES.length - 1].y) / 2 - 0.2;
    // A zoomed plate turns to a plan view: from the south, steep, north at the top (the depot reads as the site map).
    const elGoal = fi >= 0 ? 1.12 : BASE_EL;
    const azGoal = fi >= 0 ? 0 : BASE_AZ;
    target.set(0, tyGoal, 0);
    const distGoal = fitDistance(cam, target, azGoal, elGoal, framePoints({ ...rt, plateY: { ...PLATE_Y } } as Runtime, fi >= 0 ? PLATES[fi].id : null), fitW, 0.9);
    const c = cur.current;
    if (!c.dist) c.dist = distGoal;
    const shiftGoal = fi >= 0 ? 0 : STACK_SHIFT;
    c.shift = c.shift == null ? shiftGoal : c.shift + (shiftGoal - c.shift) * (rt.reduced ? 1 : Math.min(1, dt * 4));
    if (Math.abs(shiftGoal - c.shift) > 0.001) moving = true;
    const k = rt.reduced ? 1 : Math.min(1, dt * 4);
    c.dist += (distGoal - c.dist) * k; c.ty += (tyGoal - c.ty) * k; c.el += (elGoal - c.el) * k; c.az += (azGoal - c.az) * k;
    if (Math.abs(distGoal - c.dist) > 0.02 || Math.abs(tyGoal - c.ty) > 0.005 || Math.abs(elGoal - c.el) > 0.002 || Math.abs(azGoal - c.az) > 0.002) moving = true;
    const az = c.az + rt.az;
    target.set(0, c.ty, 0);
    cam.position.set(
      target.x + c.dist * Math.cos(c.el) * Math.sin(az),
      target.y + c.dist * Math.sin(c.el),
      target.z + c.dist * Math.cos(c.el) * Math.cos(az),
    );
    cam.lookAt(target);
    // Slide the picture left without changing the perspective (a film offset), so the labels get their column.
    cam.filmOffset = (c.shift ?? STACK_SHIFT) * cam.getFilmWidth() * 2 * Math.tan((cam.fov * Math.PI) / 360) * cam.aspect;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    // labels follow each plate's right-most corner; with a plate in focus, only its label shows, parked top-left
    if (fi >= 0) {
      const L = labels.current;
      const T = L.tags;
      if (T.plate === PLATES[fi].id) {
        // project each tag, then nudge any that would cover one already placed (top to bottom, left to right)
        const boxes: { x0: number; x1: number; y0: number; y1: number }[] = [];
        // the zoomed plate's own label, parked top-left, is an obstacle too
        const lb = L.box[fi];
        if (lb) boxes.push({ x0: 12, x1: 12 + (lb.offsetWidth || 200), y0: 10, y1: 10 + (lb.offsetHeight || 70) });
        const order = T.items.map((tag, i) => {
          corner.set(tag.x, rt.plateY[PLATES[fi].id] + 0.3, tag.z);
          v.copy(corner).project(cam);
          return { i, px: (v.x * 0.5 + 0.5) * size.width, py: (-v.y * 0.5 + 0.5) * size.height, vis: v.z < 1 };
        }).sort((a, b) => a.py - b.py || a.px - b.px);
        for (const o of order) {
          const el = T.els[o.i];
          if (!el) continue;
          const w = el.offsetWidth || 60, h = el.offsetHeight || 16;
          let x0 = Math.max(2, Math.min(size.width - w - 2, o.px - w / 2)), y0 = o.py - h;
          for (let guard = 0; guard < 8; guard++) {
            const hit = boxes.find((b) => x0 < b.x1 + 2 && b.x0 < x0 + w + 2 && y0 < b.y1 + 1 && b.y0 < y0 + h + 1);
            if (!hit) break;
            y0 = hit.y1 + 2;
          }
          boxes.push({ x0, x1: x0 + w, y0, y1: y0 + h });
          el.style.transform = `translate(${Math.round(x0)}px, ${Math.round(y0)}px)`;
          const onScreen = o.vis && y0 > -h && y0 < size.height;
          // tags wait for the zoom to settle, so they never smear across the move
          el.style.opacity = onScreen && !moving ? "1" : "0";
        }
      }
      PLATES.forEach((_, i) => {
        const box = L.box[i];
        if (box) {
          box.style.transform = "translate(12px, 10px)";
          box.style.opacity = i === fi ? "1" : "0";
          box.style.pointerEvents = i === fi ? "auto" : "none";
        }
        L.line[i]?.setAttribute("points", "");
      });
      if (moving || t < rt.busyUntil || rt.beads.length || rt.flashes.length || rt.scans.length) invalidate();
      return;
    }
    const L = labels.current;
    const ys: { i: number; ax: number; ay: number }[] = [];
    PLATES.forEach((p, i) => {
      let best = -Infinity, bx = 0, by = 0;
      for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        corner.set((sx * PLATE_W) / 2, rt.plateY[p.id], (sz * PLATE_D) / 2);
        v.copy(corner).project(cam);
        const px = (v.x * 0.5 + 0.5) * size.width, py = (-v.y * 0.5 + 0.5) * size.height;
        if (px > best) { best = px; bx = px; by = py; }
      }
      ys.push({ i, ax: bx, ay: by });
    });
    // keep the labels from overlapping, top to bottom
    const GAP = 62;
    let floor = -Infinity;
    const lx = size.width - labelColumn;
    const placed = ys.map((it) => { const y = Math.max(it.ay - 14, floor); floor = y + GAP; return y; });
    // pushed past the bottom: lift the column (never above the top)
    const over = Math.max(0, floor - GAP + 56 - size.height);
    for (const [k, it] of ys.entries()) {
      const y = Math.max(4 + k * GAP, placed[k] - over);
      const box = L.box[it.i];
      if (box) { box.style.transform = `translate(${lx}px, ${y}px)`; box.style.opacity = "1"; box.style.pointerEvents = "auto"; }
      const line = L.line[it.i];
      if (line) line.setAttribute("points", `${Math.min(it.ax + 4, lx - 10)},${it.ay} ${lx - 10},${y + 8} ${lx - 2},${y + 8}`);
    }
    if (moving || t < rt.busyUntil || rt.beads.length || rt.flashes.length || rt.scans.length) invalidate();
  });
  return null;
}

// ── events → reveals and beads ─────────────────────────────────────────────
const BEAD_COLOR: Record<string, THREE.Color> = {
  ok: new THREE.Color("#7CFFC4").multiplyScalar(2.2),
  held: new THREE.Color("#FFD166").multiplyScalar(1.8),
  refused: new THREE.Color("#FF5566").multiplyScalar(2.4),
  white: new THREE.Color("#FFFFFF").multiplyScalar(2.2),
};

function schedule(rt: Runtime, model: StackModel, events: readonly StackEvent[], played: Set<string>) {
  const fresh = events.filter((e) => !played.has(e.key));
  if (!fresh.length) return;
  fresh.forEach((e) => played.add(e.key));
  const spread = rt.reduced ? 0 : Math.min(3.5, 0.45 * fresh.length);
  playEvents(rt, model, fresh, nowS(), fresh.length > 1 ? spread / (fresh.length - 1) : 0, false);
}

/** Each record's object appears at its turn (hidden until then), with the light that carries it down the stack. */
function playEvents(rt: Runtime, model: StackModel, list: readonly StackEvent[], t0: number, step: number, replay: boolean) {
  const passBy = new Map(model.agent.passes.map((p) => [p.key, p]));
  const tileBy = new Map(model.tiles.map((x) => [x.key, x]));
  const barBy = new Map(model.planners.flatMap((l) => l.bars.map((b) => [b.key, { ...b, z: l.z, word: l.word }] as const)));
  const puckBy = new Map(model.depot.pucks.map((p) => [p.id, p]));
  const firstLane = model.planners[0];
  const bead = (b: Bead) => rt.beads.push(replay ? { ...b, replay } : b);
  const flash = (f: Flash) => rt.flashes.push(replay ? { ...f, replay } : f);
  list.forEach((e, i) => {
    const at = t0 + i * step;
    rt.reveal.set(e.key, at);
    rt.busyUntil = Math.max(rt.busyUntil, at + 2.2);
    if (rt.reduced) {
      if (e.kind === "decision" && e.tone === "refused") rt.rimFlash = at;
      return;
    }
    if (e.kind === "pass") {
      rt.scans.push(at);
      const p = passBy.get(e.key);
      if (p) flash({ t0: at, dur: 1.0, at: { plate: "agent", x: p.x, z: p.z, dy: 0.3 }, color: e.tone === "ok" ? BEAD_COLOR.white : BEAD_COLOR.held, size: 2.6 });
      if (e.handoff && p && firstLane) {
        bead({ t0: at + 0.6, dur: 1.2, from: { plate: "agent", x: p.x, z: p.z, dy: 0.3 }, to: { plate: "planners", x: -4.3, z: firstLane.z, dy: 0.25 }, color: BEAD_COLOR.white, size: 0.95, arc: 0.3 });
      }
    } else if (e.kind === "offer") {
      const b = barBy.get(e.key);
      if (!b) return;
      if (e.tone === "ok") {
        flash({ t0: at + 0.3, dur: 0.8, at: { plate: "planners", x: b.x, z: b.z, dy: 0.3 }, color: BEAD_COLOR.ok, size: 2 });
        bead({ t0: at + 0.35, dur: 1.0, from: { plate: "planners", x: b.x, z: b.z, dy: 0.3 }, to: { plate: "decide", x: b.x, z: Math.max(-2.3, Math.min(2.3, b.z)), dy: 0.25 }, color: BEAD_COLOR.ok, size: 0.9, arc: 0.2 });
      } else if (e.tone === "refused") {
        rt.laneFlash.set(e.key, at + 0.2);
        flash({ t0: at + 0.2, dur: 0.9, at: { plate: "planners", x: b.x, z: b.z, dy: 0.3 }, color: BEAD_COLOR.refused, size: 2.2 });
      }
    } else if (e.kind === "decision") {
      const tile = tileBy.get(e.key);
      if (tile) flash({ t0: at + 0.15, dur: 0.8, at: { plate: "decide", x: tile.x, z: tile.z, dy: 0.25 }, color: BEAD_COLOR[e.tone === "ok" ? "ok" : e.tone === "refused" ? "refused" : "held"], size: e.tone === "refused" ? 2.8 : 1.6 });
      if (!tile || (e.tone !== "refused" && (e.tone !== "ok" || !e.dest))) return;
      // Every choice that is enacted meets the safety check on its way down; one it overrides stops there.
      if (e.tone === "refused") {
        bead({ t0: at + 0.3, dur: 0.7, from: { plate: "decide", x: tile.x, z: tile.z, dy: 0.2 }, to: { plate: "safety", x: tile.x, z: tile.z, dy: 0.08 }, color: BEAD_COLOR.refused, size: 1.0, arc: 0, onLand: () => { rt.rimFlash = nowS(); } });
        return;
      }
      const puck = e.carId ? puckBy.get(e.carId) : undefined;
      const to = e.dest === "exit"
        ? { x: EXIT_POINT.x, z: EXIT_POINT.z }
        : puck ?? zoneCenter(e.dest!);
      bead({ t0: at + 0.3, dur: 0.6, from: { plate: "decide", x: tile.x, z: tile.z, dy: 0.2 }, to: { plate: "safety", x: tile.x, z: tile.z, dy: 0.08 }, color: BEAD_COLOR.ok, size: 0.9, arc: 0, onLand: () => { rt.shieldPass = nowS(); } });
      bead({
        t0: at + 0.95, dur: 0.9, from: { plate: "safety", x: tile.x, z: tile.z, dy: 0.08 }, to: { plate: "depot", x: to.x, z: to.z, dy: 0.2 },
        color: BEAD_COLOR.ok, size: 0.95, arc: 0.15,
        onLand: () => { if (e.carId) rt.puckPulse.set(e.carId, nowS()); },
      });
    }
  });
  if (rt.beads.length > MAX_BEADS) rt.beads = rt.beads.slice(-MAX_BEADS);
}

/** A stopped replay: whatever it had hidden is back on its plate at once, and its light is gone. */
function stopReplay(rt: Runtime, keys: readonly string[]) {
  const t = nowS();
  for (const k of keys) {
    const at = rt.reveal.get(k);
    if (at != null && at > t - 0.4) rt.reveal.set(k, t - 2);
    rt.laneFlash.delete(k);
  }
  rt.beads = rt.beads.filter((b) => !b.replay);
  rt.flashes = rt.flashes.filter((f) => !f.replay);
  rt.scans = rt.scans.filter((sc) => sc <= t);
  if (rt.rimFlash > t) rt.rimFlash = -99;
  rt.busyUntil = Math.max(rt.busyUntil, t + 0.2);
}

/** A replay the tab asked for: these records, one every `step` seconds from `t0` (performance.now() seconds). */
export interface StackReplay { id: number; t0: number; step: number; events: readonly StackEvent[] }

/** A ring over the tapped record's object: selection, not activity, so it holds still. */
function Marker({ rt, model, picked }: { rt: Runtime; model: StackModel; picked: { kind: PickKind; key: string } | null }) {
  const g = useRef<THREE.Group>(null);
  const ringMat = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color("#ff3347").multiplyScalar(2.6), toneMapped: false, transparent: true, depthWrite: false, side: THREE.DoubleSide }), []);
  useEffect(() => () => ringMat.dispose(), [ringMat]);
  const where = useMemo(() => {
    if (!picked) return null;
    if (picked.kind === "car") { const p = model.depot.pucks.find((x) => x.id === picked.key); return p ? { plate: "depot" as PlateId, x: p.x, z: p.z, r: 0.34, dy: 0.2 } : null; }
    if (picked.kind === "decision") { const t = model.tiles.find((x) => x.key === picked.key); return t ? { plate: "decide" as PlateId, x: t.x, z: t.z, r: 0.5, dy: 0.3 } : null; }
    if (picked.kind === "offer") {
      for (const l of model.planners) { const b = l.bars.find((x) => x.key === picked.key); if (b) return { plate: "planners" as PlateId, x: b.x, z: l.z, r: 0.45, dy: 0.3 }; }
      return null;
    }
    const p = model.agent.passes.find((x) => x.key === picked.key);
    return p ? { plate: "agent" as PlateId, x: p.x, z: p.z, r: p.r + 0.2, dy: p.r + 0.05 } : null;
  }, [model, picked]);
  useFrame(() => {
    if (!g.current || !where) return;
    g.current.position.set(where.x, rt.plateY[where.plate] + where.dy, where.z);
  });
  if (!where) return null;
  return (
    <group ref={g}>
      <mesh material={ringMat} rotation={[-Math.PI / 2, 0, 0]} renderOrder={11}><ringGeometry args={[where.r, where.r + 0.07, 40]} /></mesh>
    </group>
  );
}

const Scene = memo(function Scene({ rt, model, events, focus, onFocus, labels, labelColumn, bloom, picked, replay }: {
  rt: Runtime; model: StackModel; events: readonly StackEvent[]; focus: PlateId | null; onFocus: (p: PlateId) => void;
  labels: React.MutableRefObject<LabelRefs>; labelColumn: number; bloom: boolean; picked: { kind: PickKind; key: string } | null;
  replay: StackReplay | null;
}) {
  const { invalidate } = useThree();
  useEffect(() => { invalidate(); }, [picked, invalidate]);
  const played = useRef(new Set<string>());
  useEffect(() => { schedule(rt, model, events, played.current); invalidate(); }, [events, model, rt, invalidate]);
  // A replay is scheduled once, against the plates as they stood when it was asked for; stopping it (or starting
  // another) puts everything it had hidden straight back.
  const modelNow = useRef(model);
  modelNow.current = model;
  const replaying = useRef<{ id: number; keys: string[] } | null>(null);
  useEffect(() => {
    const prev = replaying.current;
    if (prev && prev.id !== replay?.id) { stopReplay(rt, prev.keys); replaying.current = null; }
    if (replay && !replaying.current) {
      playEvents(rt, modelNow.current, replay.events, replay.t0, replay.step, true);
      replaying.current = { id: replay.id, keys: replay.events.map((e) => e.key) };
    }
    invalidate();
  }, [replay, rt, invalidate]);
  useEffect(() => { invalidate(); }, [focus, invalidate]);
  return (
    <>
      <Env />
      <Rig rt={rt} focus={focus} labels={labels} labelColumn={labelColumn} />
      <Floor />
      <Scaffold rt={rt} />
      <DepotPlate rt={rt} depot={model.depot} onFocus={onFocus} />
      <SafetyPlate rt={rt} tiles={model.tiles} onFocus={onFocus} />
      <DecidePlate rt={rt} tiles={model.tiles} onFocus={onFocus} />
      <PlannerPlate rt={rt} lanes={model.planners} onFocus={onFocus} />
      <AgentPlate rt={rt} model={model.agent} onFocus={onFocus} />
      <Beads rt={rt} />
      <Marker rt={rt} model={model} picked={picked} />
      {bloom && (
        <EffectComposer multisampling={4} enableNormalPass={false}>
          <Bloom intensity={0.9} luminanceThreshold={1.05} luminanceSmoothing={0.2} mipmapBlur radius={0.5} />
        </EffectComposer>
      )}
    </>
  );
});

export type { PlateLabel } from "./stackModel";

export function OttoQStack({ model, events, focus, onFocus, labels, tags, height, tier, reduced, describe, onPick, picked = null, replay = null }: {
  model: StackModel;
  events: readonly StackEvent[];
  focus: PlateId | null;
  onFocus: (p: PlateId | null) => void;
  labels: Record<PlateId, PlateLabel>;
  /** Words pinned to a zoomed plate's parts. */
  tags?: Record<PlateId, readonly PlateTag[]>;
  height: number;
  tier: "high" | "medium" | "low";
  reduced: boolean;
  /** A few words for the record under the pointer (from the same records the stack is built from), or null. */
  describe?: (kind: PickKind, key: string) => string | null;
  /** A record's object was tapped. */
  onPick?: (kind: PickKind, key: string) => void;
  /** The record whose object carries the selection ring. */
  picked?: { kind: PickKind; key: string } | null;
  /** Records to play through the stack again, when someone asks (the tab labels it REPLAY while it plays). */
  replay?: StackReplay | null;
}) {
  const rt = useRuntime(reduced);
  const [hover, setHover] = useState<{ text: string; x: number; y: number } | null>(null);
  // Dev only (stripped from production builds): the scene's runtime, for the screenshot harness to read.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as { __ottoqStack?: Runtime }).__ottoqStack = rt;
    return () => { delete (window as unknown as { __ottoqStack?: Runtime }).__ottoqStack; };
  }, [rt]);
  const labelRefs = useRef<LabelRefs>({ box: [], line: [], tags: { plate: null, items: [], els: [] } });
  labelRefs.current.tags.plate = focus;
  labelRefs.current.tags.items = focus && tags ? tags[focus] : [];
  const wrap = useRef<HTMLDivElement>(null);
  rt.pick.hover = (kind, key, e) => {
    const text = describe?.(kind, key);
    const r = wrap.current?.getBoundingClientRect();
    if (!text || !r) return;
    const x = e.nativeEvent.clientX - r.left, y = e.nativeEvent.clientY - r.top;
    setHover((h) => (h && h.text === text && Math.abs(h.x - x) < 4 && Math.abs(h.y - y) < 4 ? h : { text, x, y }));
  };
  rt.pick.out = () => setHover(null);
  rt.pick.tap = (kind, key) => { setHover(null); onPick?.(kind, key); };
  const drag = useRef<{ x: number; az: number; id: number } | null>(null);
  const invalidateRef = useRef<(() => void) | null>(null);
  const labelColumn = 138;

  const onPlate = useCallback((p: PlateId) => onFocus(focus === p ? null : p), [focus, onFocus]);

  // drag sideways to turn the stack (vertical swipes still scroll the panel)
  const onDown = (e: React.PointerEvent) => { drag.current = { x: e.clientX, az: rt.az, id: e.pointerId }; rt.dragged = false; };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    if (Math.abs(dx) > 5) rt.dragged = true;
    if (rt.dragged) { rt.az = Math.max(-0.75, Math.min(0.75, d.az - dx * 0.006)); invalidateRef.current?.(); }
  };
  const onUp = () => { drag.current = null; setTimeout(() => { rt.dragged = false; }, 0); };

  useEffect(() => {
    const onVis = () => { if (!document.hidden) invalidateRef.current?.(); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  const dprMax = tier === "high" ? 1.75 : tier === "medium" ? 1.5 : 1;
  return (
    <div ref={wrap} className="relative w-full select-none overflow-hidden rounded" style={{ height, touchAction: "pan-y", background: BG }}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onPointerLeave={onUp}>
      <Canvas
        frameloop="demand"
        dpr={[1, dprMax]}
        gl={{ antialias: tier !== "low", alpha: false, powerPreference: "default", preserveDrawingBuffer: false }}
        camera={{ fov: 30, near: 0.5, far: 120, position: [14, 12, 18] }}
        onCreated={({ gl, invalidate }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.05;
          gl.info.autoReset = false; // the rig counts a whole frame, composer passes included
          invalidateRef.current = invalidate;
        }}
        onPointerMissed={() => { if (!rt.dragged && focus) onFocus(null); }}
        style={{ position: "absolute", inset: 0 }}
        aria-hidden
      >
        <Scene rt={rt} model={model} events={events} focus={focus} onFocus={onPlate} labels={labelRefs} labelColumn={labelColumn} bloom={tier !== "low"} picked={picked} replay={replay} />
      </Canvas>

      {hover && (
        <div className="pointer-events-none absolute z-20 max-w-[200px] rounded border border-white/15 bg-canvas-panel/95 px-2 py-1 text-[10px] leading-4 text-ink shadow-lg"
          style={{ left: Math.max(4, Math.min(hover.x + 12, (wrap.current?.clientWidth ?? 400) - 208)), top: Math.max(4, hover.y + 14) }}>
          {hover.text}
        </div>
      )}
      {/* leader lines and labels, placed every frame by the camera rig */}
      <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
        {PLATES.map((p, i) => (
          <polyline key={p.id} ref={(el) => { labelRefs.current.line[i] = el; }} fill="none"
            stroke={focus && focus !== p.id ? "rgba(231,234,240,0.18)" : "rgba(231,234,240,0.55)"} strokeWidth={1} />
        ))}
      </svg>
      {focus && tags && (
        <div className="pointer-events-none absolute inset-0" aria-hidden>
          {tags[focus].map((t, i) => (
            <div key={`${focus}:${t.key}`} ref={(el) => { labelRefs.current.tags.els[i] = el; }}
              className="absolute left-0 top-0 flex items-baseline gap-1 whitespace-nowrap rounded-sm bg-black/70 px-1.5 py-[1px] leading-tight shadow transition-opacity duration-300"
              style={{ opacity: 0 }}>
              <span className={`font-display text-[10.5px] font-semibold uppercase tracking-[0.04em] ${t.tone === "ok" ? "text-emerald-300" : t.tone === "held" ? "text-amber-300" : t.tone === "refused" ? "text-rose-300" : "text-white"}`}>{t.text}</span>
              {t.sub && <span className="font-mono text-[10px] text-ink">{t.sub}</span>}
            </div>
          ))}
        </div>
      )}
      {PLATES.map((p, i) => {
        const l = labels[p.id];
        const on = focus === p.id;
        return (
          <button key={p.id} type="button" ref={(el) => { labelRefs.current.box[i] = el; }}
            onClick={(e) => { e.stopPropagation(); onPlate(p.id); }} aria-pressed={on}
            className="absolute left-0 top-0 block text-left"
            style={{ width: on ? 200 : labelColumn - 6 }}>
            <span className={`block whitespace-nowrap font-display text-[12.5px] font-semibold uppercase leading-4 tracking-[0.07em] ${on ? "text-brand-hot" : "text-white"}`}>{l.title}</span>
            <span className="block text-[11px] leading-[14px] text-ink">{l.tagline}</span>
            <span className="mt-0.5 text-[11px] leading-[14px] text-ink-dim line-clamp-2">{l.line}</span>
            {on && <span className="mt-1 block text-[9px] text-ink-faint">Tap here, or anywhere off the plate, to see all five.</span>}
          </button>
        );
      })}
    </div>
  );
}

export default OttoQStack;
