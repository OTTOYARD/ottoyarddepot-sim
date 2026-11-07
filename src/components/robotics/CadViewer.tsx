// ============================================================================
// CadViewer — one robot's engineering CAD (public/cad/<robot>.glb) in a 3D view you can turn, explode, cut and pick.
//
// It draws the CAD and decides nothing: the pose is a set of joint angles from the twin's own code (catalog.ts
// posePresets), the explode and the section are views. The car beside the robot is the twin's car profile
// (vehicleEnvelope.bodyProfile, the one the clearance tests measure against), drawn as a ghost in the robot's frame.
// All model handling (pose, explode, isolate, highlight, pick) is src/lib/robotics/cadModel.ts.
// ============================================================================
import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  explodeCad, highlightCad, indexCad, partAt, poseCad, visibleBounds, type CadModel,
} from '@/lib/robotics/cadModel';
import { cadUrl, type RobotKey } from '@/lib/robotics/catalog';
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
}

interface Props {
  robot: RobotKey;
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

function Model({ model, state, fasteners, onPick, onHover }: {
  model: CadModel; state: CadViewState; fasteners: ReadonlySet<string>;
  onPick: Props['onPick']; onHover?: Props['onHover'];
}) {
  const [hover, setHover] = useState<string | null>(null);
  const { gl } = useThree();

  useEffect(() => { poseCad(model, state.angles); }, [model, state.angles]);
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

export function CadViewer({ robot, glb, state, fasteners, onPick, onHover, onStatus }: Props) {
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
      {model && <Model model={model} state={state} fasteners={fasteners} onPick={onPick} onHover={onHover} />}
      {model && state.showCar && <CarGhost robot={robot} />}
      <gridHelper args={[20, 40, 0x2a3440, 0x161c24]} position={[0, robot === 'charge_arm' ? -MOUNT_HEIGHT_M : 0, 0]} />
      <Framer model={model} state={state} controls={controls} />
      <OrbitControls ref={controls} makeDefault enableDamping dampingFactor={0.12} />
    </Canvas>
  );
}

export default CadViewer;
