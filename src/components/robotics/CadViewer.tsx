// ============================================================================
// CadViewer — one robot's engineering CAD (public/cad/<robot>.glb) in a 3D view you can turn, explode, cut and pick.
//
// It draws the CAD and decides nothing: the pose is a set of joint angles from the twin's own code (catalog.ts
// posePresets), the explode and the section are views. The car beside the robot is the twin's car profile
// (vehicleEnvelope.bodyProfile, the one the clearance tests measure against), drawn as a ghost in the robot's frame.
// All model handling (pose, explode, isolate, highlight, pick) is src/lib/robotics/cadModel.ts.
// ============================================================================
import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  explodeCad, highlightCad, indexCad, partAt, poseCad, visibleBounds, type CadModel,
} from '@/lib/robotics/cadModel';
import { cadUrl, type CycleScript, type RobotKey } from '@/lib/robotics/catalog';
import { flexDefs } from '@/lib/robotics/flexLines';
import { makeFlexFleet } from '@/lib/robotics/flexMesh';
import { bodyProfile, CAR_LENGTH_M, CAR_WIDTH_M } from '@/lib/ottoChargeArm/vehicleEnvelope';
import { PEDESTAL_TO_CAR_CENTRE_M, MOUNT_HEIGHT_M } from '@/lib/ottoChargeArm/cobotSpec';

export type ViewDir = 'iso' | 'front' | 'side' | 'top';
export type SectionAxis = 'off' | 'x' | 'z';

export interface CadViewState {
  angles: Record<string, number>;
  explode: number;
  isolate: string | null;
  selected: string | null;
  showFasteners: boolean;
  showCar: boolean;
  section: SectionAxis;
  sectionAt: number;          // -1 .. 1 across the model's bounds
  view: ViewDir;
  /** bumped to re-frame the camera on what is visible */
  fitKey: number;
  /** frame the car with the robot (while a cycle plays, the robot reaches to the car) */
  frameCar?: boolean;
}

export interface CadJointSummary { name: string; kind: 'revolute' | 'prismatic'; limits: [number, number]; stowed: number }
export interface CadCycle { script: CycleScript; playing: boolean; speed: number }

interface Props {
  robot: RobotKey;
  /** play the robot's cycle (the twin's own choreography) on the model; null or paused: the state's pose */
  cycle?: CadCycle | null;
  /** follow a running robot: called on every frame, its joint values pose the model in place of the state's pose
   *  and the cycle. null: no robot is followed. The viewer only draws what it is given. */
  live?: (() => Record<string, number> | null) | null;
  onCycle?: (t: number, step: number) => void;
  onJoints?: (joints: CadJointSummary[]) => void;
  glb: string;
  state: CadViewState;
  fasteners: ReadonlySet<string>;
  onPick: (partId: string | null) => void;
  onHover?: (partId: string | null) => void;
  onStatus?: (s: { loading: boolean; progress: number; error: string | null; parts: number }) => void;
}

// One load per robot for the life of the page: switching robots and back does not fetch again.
const cache = new Map<string, Promise<THREE.Object3D>>();
function loadScene(url: string, onProgress: (p: number) => void): Promise<THREE.Object3D> {
  let p = cache.get(url);
  if (!p) {
    p = new GLTFLoader().loadAsync(url, (e) => { if (e.total) onProgress(e.loaded / e.total); }).then((g) => g.scene);
    cache.set(url, p);
    p.catch(() => cache.delete(url));
  }
  return p;
}

/** The twin's car, as a ghost, placed in each robot's frame. */
function carGhostTransform(robot: RobotKey): { position: [number, number, number]; rotationY: number } {
  if (robot === 'charge_arm') return { position: [0, -MOUNT_HEIGHT_M, PEDESTAL_TO_CAR_CENTRE_M], rotationY: 0 };
  if (robot === 'clean_arm') return { position: [0, 0, 0], rotationY: 0 };
  return { position: [0, 0, 0], rotationY: -Math.PI / 2 };   // the wash bay: the car faces north, +Z
}

function CarGhost({ robot }: { robot: RobotKey }) {
  const geo = useMemo(() => {
    const prof = bodyProfile(CAR_LENGTH_M);
    const shape = new THREE.Shape(prof.map(([x, y]) => new THREE.Vector2(x, y)));
    const g = new THREE.ExtrudeGeometry(shape, { depth: CAR_WIDTH_M, bevelEnabled: false });
    g.translate(0, 0, -CAR_WIDTH_M / 2);
    return g;
  }, []);
  const mat = useMemo(() => new THREE.MeshStandardMaterial({
    color: 0x9fb4c8, transparent: true, opacity: 0.13, depthWrite: false, roughness: 0.6, metalness: 0,
  }), []);
  const edges = useMemo(() => new THREE.EdgesGeometry(geo, 25), [geo]);
  const t = carGhostTransform(robot);
  return (
    <group position={t.position} rotation={[0, t.rotationY, 0]}>
      <mesh geometry={geo} material={mat} renderOrder={2} />
      <lineSegments geometry={edges}>
        <lineBasicMaterial color={0x9fb4c8} transparent opacity={0.35} />
      </lineSegments>
    </group>
  );
}

/** The car ghost's bounds in the robot's frame, for framing the robot and the car together. */
function carBounds(robot: RobotKey): THREE.Box3 {
  const t = carGhostTransform(robot);
  const hl = CAR_LENGTH_M / 2, hw = CAR_WIDTH_M / 2;
  const along = Math.abs(t.rotationY) > 0.1;               // the wash bay's car runs along Z
  const [x, y, z] = t.position;
  return new THREE.Box3(
    new THREE.Vector3(x - (along ? hw : hl), y, z - (along ? hl : hw)),
    new THREE.Vector3(x + (along ? hw : hl), y + 1.64, z + (along ? hl : hw)),
  );
}

function Environment() {
  const { gl, scene } = useThree();
  useEffect(() => {
    const pm = new THREE.PMREMGenerator(gl);
    const tex = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = tex;
    return () => { scene.environment = null; tex.dispose(); pm.dispose(); };
  }, [gl, scene]);
  return null;
}

const DIRS: Record<ViewDir, [number, number, number]> = {
  iso: [1, 0.6, 1.15], front: [0, 0.12, 1], side: [1, 0.12, 0], top: [0.0001, 1, 0.02],
};

function Framer({ model, state, controls }: { model: CadModel | null; state: CadViewState; controls: React.RefObject<OrbitControlsImpl> }) {
  const { camera } = useThree();
  useEffect(() => {
    if (!model) return;
    const box = visibleBounds(model);
    if (box.isEmpty()) return;
    if (state.frameCar) box.union(carBounds(model.robot as RobotKey));
    const c = box.getCenter(new THREE.Vector3());
    const size = Math.max(0.3, box.getSize(new THREE.Vector3()).length());
    const d = new THREE.Vector3(...DIRS[state.view]).normalize();
    camera.position.copy(c).addScaledVector(d, size * 1.15);
    camera.near = size / 400;
    camera.far = size * 40;
    camera.updateProjectionMatrix();
    controls.current?.target.copy(c);
    controls.current?.update();
    // re-frame on an explicit request (robot, view, fit, pose, isolate, a selected part): never on an explode change
  }, [model, state.view, state.fitKey, state.isolate, state.selected, state.angles]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

function Model({ model, state, fasteners, onPick, onHover, cycle, onCycle, live }: {
  model: CadModel; state: CadViewState; fasteners: ReadonlySet<string>;
  onPick: Props['onPick']; onHover?: Props['onHover']; cycle?: CadCycle | null; onCycle?: Props['onCycle']; live?: Props['live'];
}) {
  const [hover, setHover] = useState<string | null>(null);
  const { gl } = useThree();
  const clock = useRef({ t: 0, sent: -1, step: -1 });

  const playing = !!cycle?.playing;
  const following = !!live;
  useEffect(() => { if (!playing && !following) poseCad(model, state.angles); }, [model, state.angles, playing, following]);
  useEffect(() => { clock.current = { t: 0, sent: -1, step: -1 }; }, [cycle?.script]);
  // The cycle plays on the frame clock: the model is posed here, and the tab hears about it at most 8 times a
  // second (and on every step change), so a playing cycle never re-renders the parts list each frame.
  useFrame((_, dt) => {
    const followed = live?.();
    if (followed) { poseCad(model, followed); return; }
    if (!cycle?.playing) return;
    const c = clock.current;
    c.t = (c.t + Math.min(dt, 0.25) * cycle.speed) % cycle.script.total;
    const f = cycle.script.at(c.t);
    poseCad(model, f.angles);
    if (f.step !== c.step || Math.abs(c.t - c.sent) > 0.125 * cycle.speed) {
      c.step = f.step;
      c.sent = c.t;
      onCycle?.(c.t, f.step);
    }
  });
  useEffect(() => { explodeCad(model, state.explode); }, [model, state.explode]);
  useEffect(() => {
    highlightCad(model, {
      isolate: state.isolate, ghostOthers: true, selected: state.selected, hover,
      hideFasteners: !state.showFasteners, fasteners, xraySelected: true,
    });
  }, [model, state.isolate, state.selected, state.showFasteners, hover, fasteners]);

  // the section plane: one clipping plane on every material in the model
  useEffect(() => {
    gl.localClippingEnabled = state.section !== 'off';
    const mats = new Set<THREE.Material>();
    model.root.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (!m) return;
      (Array.isArray(m) ? m : [m]).forEach((x) => mats.add(x));
    });
    model.baseMaterial.forEach((m) => mats.add(m));
    let planes: THREE.Plane[] = [];
    if (state.section !== 'off') {
      const box = new THREE.Box3().setFromObject(model.root);
      const c = box.getCenter(new THREE.Vector3());
      const half = box.getSize(new THREE.Vector3()).multiplyScalar(0.5);
      const n = state.section === 'x' ? new THREE.Vector3(-1, 0, 0) : new THREE.Vector3(0, 0, -1);
      const along = state.section === 'x' ? c.x + half.x * state.sectionAt : c.z + half.z * state.sectionAt;
      planes = [new THREE.Plane(n, along)];
    }
    mats.forEach((m) => { m.clippingPlanes = planes; m.clipShadows = true; m.side = planes.length ? THREE.DoubleSide : THREE.FrontSide; m.needsUpdate = true; });
  }, [gl, model, state.section, state.sectionAt]);

  const partOf = (e: ThreeEvent<PointerEvent | MouseEvent>) => {
    for (const hit of e.intersections) {
      if (!hit.object.visible) continue;
      const mat = (hit.object as THREE.Mesh).material as THREE.Material;
      if (mat && (mat as THREE.MeshStandardMaterial).opacity < 0.5) continue;   // a ghost is not a target
      const p = partAt(model, hit.object);
      if (p) return p.part;
    }
    return null;
  };

  return (
    <primitive
      object={model.root}
      onClick={(e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); onPick(partOf(e)); }}
      onPointerMove={(e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation();
        const id = partOf(e);
        if (id !== hover) { setHover(id); onHover?.(id); }
      }}
      onPointerOut={() => { setHover(null); onHover?.(null); }}
    />
  );
}

/**
 * The robot's flexible lines (cables, hoses, ducts, energy chains): solved at the model's pose every frame, after the
 * pose is set, so they bend with the joints as the CAD's flex check says they do. Hidden while the model is exploded
 * (the parts fly apart, the lines' ends do not). A selected or isolated line is picked out; the rest ghost with the parts.
 */
function FlexLines({ model, state }: { model: CadModel; state: CadViewState }) {
  const fleet = useMemo(() => {
    const defs = flexDefs(model.root);
    return defs.length ? makeFlexFleet(defs, 1, { radial: 12, coilPerTurn: 16, split: true }) : null;
  }, [model]);
  useEffect(() => () => fleet?.dispose(), [fleet]);
  const skel = useMemo(() => {
    const byName = new Map<string, THREE.Object3D>();
    model.root.traverse((o) => { if (o.name && !byName.has(o.name)) byName.set(o.name, o); });
    return {
      root: model.root,
      node: (n: string) => {
        const o = byName.get(n);
        if (!o) throw new Error(`CadViewer: the model has no node ${n}`);
        return o;
      },
    };
  }, [model]);
  const subOf = useMemo(() => new Map(flexDefs(model.root).map((d) => [d.id, d.sub])), [model]);
  useEffect(() => {
    if (!fleet) return;
    for (const { ids, material } of fleet.meshes) {
      // a line belongs to its subsystem: isolating that subsystem keeps it, and selecting the line lights it up
      const inIsolated = !!state.isolate && ids.some((id) => id === state.isolate || subOf.get(id) === state.isolate);
      const mine = (!!state.selected && ids.includes(state.selected)) || (!!state.isolate && ids.includes(state.isolate));
      const ghost = !!state.isolate && !inIsolated;
      material.transparent = ghost;
      material.opacity = ghost ? 0.12 : 1;
      material.depthWrite = !ghost;
      material.emissive.setHex(mine ? 0x1d6fd6 : 0x000000);
      material.emissiveIntensity = mine ? 0.9 : 0;
      material.needsUpdate = true;
    }
  }, [fleet, subOf, state.isolate, state.selected]);
  useFrame(() => {
    if (!fleet) return;
    fleet.group.visible = state.explode < 0.02;
    if (!fleet.group.visible) return;
    model.root.updateMatrixWorld(true);
    fleet.write(0, skel);
  });   // registered after the model's own frame callback (which sets the pose), so it runs after it
  return fleet ? <primitive object={fleet.group} /> : null;
}

export function CadViewer({ robot, glb, state, fasteners, onPick, onHover, onStatus, cycle, onCycle, onJoints, live }: Props) {
  const [model, setModel] = useState<CadModel | null>(null);
  const controls = useRef<OrbitControlsImpl>(null);

  useEffect(() => {
    let live = true;
    setModel(null);
    onStatus?.({ loading: true, progress: 0, error: null, parts: 0 });
    loadScene(cadUrl(glb), (p) => onStatus?.({ loading: true, progress: p, error: null, parts: 0 }))
      .then((scene) => {
        if (!live) return;
        const m = indexCad(scene);
        setModel(m);
        onStatus?.({ loading: false, progress: 1, error: null, parts: m.parts.length });
        onJoints?.([...m.joints.values()].map((j) => ({ name: j.name, kind: j.kind, limits: j.limits, stowed: j.stowed ?? 0 })));
      })
      .catch((e: unknown) => {
        if (live) onStatus?.({ loading: false, progress: 0, error: e instanceof Error ? e.message : String(e), parts: 0 });
      });
    return () => { live = false; };
  }, [glb]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Canvas
      data-testid="cad-canvas"
      camera={{ fov: 35, position: [4, 3, 4], near: 0.01, far: 200 }}
      dpr={[1, 1.75]}
      gl={{ antialias: true, preserveDrawingBuffer: true }}
      onPointerMissed={() => onPick(null)}
      onCreated={({ gl }) => { gl.toneMapping = THREE.ACESFilmicToneMapping; gl.outputColorSpace = THREE.SRGBColorSpace; }}
      style={{ background: 'linear-gradient(180deg, #0f141b 0%, #0a0d12 100%)' }}
    >
      <Environment />
      <directionalLight position={[5, 9, 6]} intensity={1.5} />
      <directionalLight position={[-6, 4, -5]} intensity={0.35} />
      <hemisphereLight args={[0xdfe8ff, 0x1a1e24, 0.45]} />
      {model && <Model model={model} state={state} fasteners={fasteners} onPick={onPick} onHover={onHover} cycle={cycle} onCycle={onCycle} live={live} />}
      {model && <FlexLines model={model} state={state} />}
      {model && state.showCar && <CarGhost robot={robot} />}
      <gridHelper args={[20, 40, 0x2a3440, 0x161c24]} position={[0, robot === 'charge_arm' ? -MOUNT_HEIGHT_M : 0, 0]} />
      <Framer model={model} state={state} controls={controls} />
      <OrbitControls ref={controls} makeDefault enableDamping dampingFactor={0.12} />
    </Canvas>
  );
}

export default CadViewer;
