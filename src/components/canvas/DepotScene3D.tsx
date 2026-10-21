import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Suspense, useCallback, useEffect, useRef, useMemo } from 'react';
import * as THREE from 'three';
import { ACESFilmicToneMapping, PCFSoftShadowMap, FogExp2, SRGBColorSpace } from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { useVehicleStore } from '@/store/vehicleStore';
import { useSimulationStore } from '@/store/simulationStore';
import { useDepotStore } from '@/store/depotStore';
import { DepotGround } from './three/DepotGround';
import { DepotBuilding } from './three/DepotBuilding';
import { SolarCanopy } from './three/SolarCanopy';
import { armStallsKey } from '@/lib/ottoCleanArm/cleanArmPlacement';
import { ChargingField } from './three/ChargingField';
import { WashBays } from './three/WashBays';
import { WashGantries } from './three/WashGantry';
import { RoofXray } from './three/RoofXray';
import { ServiceBays } from './three/ServiceBays';
import { StagingZone } from './three/StagingZone';
import { ChargingArm } from './three/ChargingArm';
import { makeArmFleet } from './three/armInstances';
import { CleanArm } from './three/CleanArm';
import { makeCleanArmFleet } from './three/cleanArmInstances';
import { Lanes3D } from './three/Lanes3D';
import { UtilityEquipment } from './three/UtilityEquipment';
import { VehicleFleet } from './three/Vehicle3D';
import { WeatherEffects } from './three/WeatherEffects';
import { DayNightLighting } from './three/DayNightLighting';
import { DAY_SKY } from './three/dayNight';
import { DepotPostProcessing } from './three/DepotPostProcessing';
import { SiteDetails } from './three/SiteDetails';
import { UrbanSurround } from './three/UrbanSurround';
import { CITY_VIEW_FAR } from './three/cityPlan';
import { MATERIALS } from './three/materials';
import { skyTexture } from './three/textures';
import { PerfProbe } from './three/perf/PerfProbe';
import { CameraRig } from './three/CameraRig';
import { carName } from './three/carName';
import { StaticMerge } from './three/StaticMerge';
import { useCameraFollow } from './three/cameraFollow';
import { CAMERA_PRESETS, CAMERA_PRESET_NAMES, useCameraCommands, type CameraPreset } from './three/cameraPresets';
import { QCardProjector, qCardAnchor3D } from './three/QCardProjector';
import { AnchoredQCard } from './VehicleQCard';


// Seeded random for consistent tree placement
function seededRandom(seed: number) {
  const x = Math.sin(seed * 127.1) * 43758.5453;
  return x - Math.floor(x);
}

function Landscaping() {
  // Perimeter trees OUTSIDE the security fence (lot is x ±144, z -96..104).
  // Instanced: one trunk mesh and one crown mesh for the whole ring (was four
  // draw calls a tree), with faceted low-poly crowns in three greens so the
  // ring reads as planted trees rather than identical green balls on sticks.
  const { trunks, crowns } = useMemo(() => {
    const positions: [number, number][] = [
      [-130, 112], [-95, 112], [-60, 112], [-25, 112], [10, 112], [45, 112], [80, 112], [115, 112],
      [-130, -118], [-90, -118], [0, -118], [130, -118],
      [-152, -70], [-152, -35], [-152, 0], [-152, 35], [-152, 70], [-152, 95],
      [152, -70], [152, -35], [152, 0], [152, 35], [152, 70], [152, 95],
    ];
    const trunkGeo = new THREE.CylinderGeometry(0.16, 0.3, 1, 7);
    trunkGeo.translate(0, 0.5, 0);
    const trunkMat = new THREE.MeshStandardMaterial({ color: '#4a3726', roughness: 0.9 });
    const crownGeo = new THREE.IcosahedronGeometry(1, 1);
    const crownMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85, flatShading: true });
    const BLOBS = 4;
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, positions.length);
    const crowns = new THREE.InstancedMesh(crownGeo, crownMat, positions.length * BLOBS);
    const greens = ['#2f5a24', '#3b6b2c', '#27491f', '#46783a'].map((c) => new THREE.Color(c));
    const o = new THREE.Object3D();
    positions.forEach(([x, z], i) => {
      const h = 5 + seededRandom(i) * 3;
      const trunkH = h * 0.55;
      o.position.set(x, 0, z); o.rotation.set(0, 0, 0); o.scale.set(1, trunkH, 1); o.updateMatrix();
      trunks.setMatrixAt(i, o.matrix);
      const r = 1.9 + seededRandom(i + 50) * 1.3;
      for (let b = 0; b < BLOBS; b++) {
        const a = seededRandom(i * 7 + b) * Math.PI * 2;
        const off = b === 0 ? 0 : r * 0.45;
        const s = r * (b === 0 ? 1 : 0.62 + seededRandom(i * 11 + b) * 0.25);
        o.position.set(x + Math.cos(a) * off, trunkH + r * (b === 0 ? 0.75 : 0.45 + seededRandom(i * 3 + b) * 0.5), z + Math.sin(a) * off);
        o.rotation.set(seededRandom(i + b) * 3, seededRandom(i * 5 + b) * 3, 0);
        o.scale.set(s, s * 0.85, s);
        o.updateMatrix();
        crowns.setMatrixAt(i * BLOBS + b, o.matrix);
        crowns.setColorAt(i * BLOBS + b, greens[(i + b) % greens.length]);
      }
    });
    for (const m of [trunks, crowns]) { m.castShadow = true; m.instanceMatrix.needsUpdate = true; }
    if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;
    return { trunks, crowns };
  }, []);

  const planterPositions: [number, number, number][] = useMemo(() => [
    [-62, 0, -90], [-38, 0, -90], [38, 0, -90], [62, 0, -90],  // gate plazas
    [-85, 0, 60], [66, 0, 60],                                  // building/wash flanks
  ], []);

  return (
    <group>
      <primitive object={trunks} />
      <primitive object={crowns} />

      {/* clipped hedges along the outside of the west, east and north fences (the south
          fence meets the road), 2 u off the fence line: a base and a narrower crown */}
      {([
        [147.6, 4, 1.8, 196], [-147.6, 4, 1.8, 196], [0, 107.6, 293, 1.8],
      ] as const).map(([x, z, w, d], i) => (
        <group key={`hedge${i}`} position={[x, 0, z]}>
          <mesh position={[0, 0.55, 0]} castShadow receiveShadow material={MATERIALS.shrubGreen()}>
            <boxGeometry args={[w, 1.1, d]} />
          </mesh>
          <mesh position={[0, 1.35, 0]} castShadow receiveShadow material={MATERIALS.shrubGreen()}>
            <boxGeometry args={[w === 1.8 ? 1.4 : w - 0.4, 0.5, d === 1.8 ? 1.4 : d - 0.4]} />
          </mesh>
        </group>
      ))}

      {planterPositions.map((pos, i) => (
        <group key={`planter${i}`} position={pos}>
          <mesh position={[0, 0.3, 0]} castShadow receiveShadow>
            <boxGeometry args={[2, 0.6, 2]} />
            <primitive object={MATERIALS.cortenSteel()} attach="material" />
          </mesh>
          <mesh rotation-x={-Math.PI / 2} position={[0, 0.61, 0]}>
            <planeGeometry args={[1.8, 1.8]} />
            <primitive object={MATERIALS.grass()} attach="material" />
          </mesh>
        </group>
      ))}

    </group>
  );
}

// Finger-sized on touch screens (44 px tall, the platform minimum), unchanged with a mouse.
const PRESET_BTN = 'px-2 py-1 text-[10px] font-mono rounded bg-black/60 text-white border border-white/10 hover:bg-white/10 hover:text-white transition-colors [@media(pointer:coarse)]:min-h-[44px] [@media(pointer:coarse)]:px-3 [@media(pointer:coarse)]:text-[11px]';

/**
 * The standalone live view (src/viewer, `/view.html`): a host outside the cockpit frames the camera, spins it, and
 * stops drawing while it cannot be seen. A view choice only: nothing in the world reads any of it.
 */
export interface SceneViewer {
  /** Where to put the camera. `n` counts requests, so asking for the same framing twice frames it twice. */
  framing: { position: [number, number, number]; target: [number, number, number]; kind: 'orbit' | 'pole'; n: number } | null;
  /** Turn slowly about the target: around the depot from a corner, or around the mast from the pole. */
  spin: boolean;
  /** Draw nothing (hidden, or scrolled out of the host's view). The cars keep their places underneath. */
  paused: boolean;
  /** The viewer grabbed the view (drag, pinch, wheel): the host stops the spin. */
  onInteract?: () => void;
}

/** Applies a viewer framing to the orbit controls. Inside the canvas, after the controls, so their ref is set. */
function ViewerFraming({ controls, framing }: { controls: React.RefObject<OrbitControlsImpl>; framing: SceneViewer['framing'] }) {
  const n = framing?.n ?? 0;
  useEffect(() => {
    const ctrl = controls.current;
    if (!framing || !ctrl) return;
    useCameraFollow.getState().setFollow(null); // a framing is a new shot
    ctrl.object.position.set(...framing.position);
    ctrl.target.set(...framing.target);
    ctrl.update();
  }, [n]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/**
 * `chrome`: 'desktop' draws the view's own controls (camera presets) in a row
 * at the bottom right, as it always has; 'phone' leaves them to the phone
 * cockpit's camera menu (which drives the same presets through useCameraCommands)
 * and moves the follow chip below the phone's run bar (`overlayTop`); 'viewer'
 * draws no controls of its own and takes its camera from `viewer` (the standalone
 * live view the cockpits embed).
 */
export default function DepotScene3D({ chrome = 'desktop', overlayTop = 0, viewer }: {
  chrome?: 'desktop' | 'phone' | 'viewer'; overlayTop?: number; viewer?: SceneViewer;
} = {}) {
  const vehicles = useVehicleStore((s) => s.vehicles);
  const config = useSimulationStore((s) => s.config);
  const simTime = useSimulationStore((s) => s.simTime);
  const stalls = useDepotStore((s) => s.stalls);
  // Robotic arms stand on every fast charger, and only there: an L2 post has no
  // arm. The charger build decides how many (chargerBuild.ts): 10 on canopy A as
  // built, 20 on canopies A and B, 30 on all three once every L2 is gone.
  const roboticStalls = useMemo(() => stalls.filter((s) => s.type === 'dcfc'), [stalls]);
  // Every arm draws into one set of instanced meshes (armInstances.ts): the
  // canopy costs the same draw calls at 10, 20 or 30 fast chargers. Capacity
  // grows in steps of 8 so a build-out change rarely rebuilds the buffers.
  const armCapacity = Math.max(8, Math.ceil(roboticStalls.length / 8) * 8);
  const armFleet = useMemo(() => makeArmFleet(armCapacity), [armCapacity]);
  useEffect(() => () => armFleet.dispose(), [armFleet]);
  // draw only the slots in use (the rest of the capacity costs no vertices)
  useEffect(() => { for (const m of armFleet.meshes) m.count = roboticStalls.length; }, [armFleet, roboticStalls.length]);
  // …and so does every OTTO-CLEAN ARM, one over each robotic fast charger (cleanArmInstances.ts),
  // with its canopy steel drawn by the canopy, which is rebuilt only when those stalls move.
  const cleanFleet = useMemo(() => makeCleanArmFleet(armCapacity), [armCapacity]);
  useEffect(() => () => cleanFleet.dispose(), [cleanFleet]);
  useEffect(() => { for (const m of cleanFleet.meshes) m.count = roboticStalls.length; }, [cleanFleet, roboticStalls.length]);
  const armStalls = useMemo(() => roboticStalls.map((s) => s.position), [roboticStalls]);
  const armKey = armStallsKey(armStalls);
  const controlsRef = useRef<OrbitControlsImpl>(null);

  const followId = useCameraFollow((s) => s.followId);
  const setFollow = useCameraFollow((s) => s.setFollow);
  const followAv = useVehicleStore((s) => (followId ? carName(followId, s.vehicles.find((v) => v.id === followId)) : null));
  const pole = viewer?.framing?.kind === 'pole';

  const handleCameraPreset = useCallback((preset: CameraPreset) => {
    const ctrl = controlsRef.current;
    if (!ctrl) return;
    useCameraFollow.getState().setFollow(null); // a preset is a new framing
    const { position, target } = CAMERA_PRESETS[preset];
    ctrl.object.position.set(...position);
    ctrl.target.set(...target);
    ctrl.update();
  }, []);

  // presets asked for from outside the view (the phone cockpit's camera menu)
  const cameraRequest = useCameraCommands((s) => s.request);
  useEffect(() => { if (cameraRequest) handleCameraPreset(cameraRequest.preset); }, [cameraRequest, handleCameraPreset]);

  // Dev only: scripts/cockpitPlayback.mjs frames arbitrary shots (--cams @x:y:z/tx:ty:tz)
  // so a new camera preset can be tried before it is committed. Stripped from builds.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as { __depotCam?: (p: number[], t: number[]) => boolean };
    w.__depotCam = (p, t) => {
      const ctrl = controlsRef.current;
      if (!ctrl) return false;
      ctrl.object.position.set(p[0], p[1], p[2]);
      ctrl.target.set(t[0], t[1], t[2]);
      ctrl.update();
      return true;
    };
    return () => { delete w.__depotCam; };
  }, []);

  return (
    <div className="absolute inset-0 bg-otto-dark">
      <Canvas
        shadows
        // the standalone view never draws while it cannot be seen; the cockpit's view always draws
        frameloop={viewer?.paused ? 'never' : 'always'}
        camera={{ position: viewer?.framing?.position ?? [0, 180, -10], fov: 45, near: 1, far: CITY_VIEW_FAR }}
        // ONE render quality, High, on every device (Chase, 2026-10-12: no Auto,
        // Medium or Low): MSAA, soft 2048² sun shadows, the whole post stack,
        // clear-coated paint, and a fixed resolution that a slow frame never lowers.
        gl={{
          antialias: true,
          toneMapping: ACESFilmicToneMapping,
          toneMappingExposure: 2.2,
          outputColorSpace: SRGBColorSpace,
          powerPreference: 'high-performance',
        }}
        dpr={Math.min(window.devicePixelRatio, 1.5)}
        onCreated={({ gl, scene }) => {
          gl.shadowMap.enabled = true;
          gl.shadowMap.type = PCFSoftShadowMap;
          scene.fog = new FogExp2(DAY_SKY.fog, 0.00065);
          // Procedural gradient sky: backdrop + PBR environment in one
          const sky = skyTexture();
          scene.background = sky;
          scene.environment = sky;
          // The backdrop is drawn through the same exposure (2.2) as the lit
          // scene, which burned the horizon band to white. Dim the BACKDROP only;
          // the environment keeps full strength for reflections and fill.
          scene.backgroundIntensity = DAY_SKY.background;
        }}
      >
        <Suspense fallback={null}>
          <DayNightLighting simTime={simTime} />
          {/* from above, the roofs fade so the robots and cars under them show (a view choice only) */}
          <RoofXray />

          <StaticMerge name="ground"><DepotGround /></StaticMerge>
          <StaticMerge name="building"><DepotBuilding /></StaticMerge>
          <StaticMerge name="serviceBays"><ServiceBays /></StaticMerge>
          <StaticMerge name="solarCanopy" version={`${config.solarCanopy}/${armKey}`}><SolarCanopy solarKWdc={config.solarCanopy} armStalls={armStalls} /></StaticMerge>
          <group name="chargersDcfc"><ChargingField type="dcfc" count={config.dcfcCount} /></group>
          <group name="chargersL2"><ChargingField type="l2" count={config.l2Count} /></group>
          <StaticMerge name="washBays" version={config.washBayCount}><WashBays count={config.washBayCount} /></StaticMerge>
          {/* the wash bays' rollover machines move, so they stand outside the static merge */}
          <WashGantries count={config.washBayCount} />
          <StaticMerge name="staging" version={config.stagingStalls}><StagingZone count={config.stagingStalls} /></StaticMerge>
          <group name="lanes"><Lanes3D /></group>
          <StaticMerge name="utility" version={`${config.bessCapacity}/${config.bessPower}`}><UtilityEquipment bessCapacity={config.bessCapacity} bessPower={config.bessPower} /></StaticMerge>
          <group name="arms">
            {armFleet.meshes.map((m, i) => <primitive key={`armpart-${i}`} object={m} />)}
            {roboticStalls.map((s, i) => (
              <ChargingArm key={`arm-${s.id}`} stallId={s.id} stallType={s.type as 'dcfc' | 'l2'} fleet={armFleet} slot={i} />
            ))}
            {cleanFleet.meshes.map((m, i) => <primitive key={`cleanpart-${i}`} object={m} />)}
            {roboticStalls.map((s, i) => (
              <CleanArm key={`clean-${s.id}`} stallId={s.id} fleet={cleanFleet} slot={i} />
            ))}
          </group>
          <StaticMerge name="landscaping"><Landscaping /></StaticMerge>
          <UrbanSurround />
          <group name="siteDetails"><SiteDetails /></group>

          <group name="vehicles"><VehicleFleet vehicles={vehicles} /></group>

          <WeatherEffects weather={config.weather} />
          <DepotPostProcessing mode="interactive" />
          <PerfProbe />

          <OrbitControls
            ref={controlsRef}
            enableDamping
            dampingFactor={0.08}
            maxPolarAngle={Math.PI / 2.05}
            // from the pole the camera turns about a point just in front of the lens: it looks around the depot
            // from the mast instead of circling the mast, so it neither zooms nor pans there
            minDistance={pole ? 0.5 : 5}
            maxDistance={pole ? 2 : 300}
            enableZoom={!pole}
            enablePan={!pole}
            autoRotate={!!viewer?.spin && !followId}
            autoRotateSpeed={pole ? 0.5 : 0.3}
            onStart={viewer?.onInteract}
          />
          {viewer && <ViewerFraming controls={controlsRef} framing={viewer.framing} />}
          <CameraRig controls={controlsRef} pole={pole} />
          <QCardProjector />
        </Suspense>
      </Canvas>

      {/* the tapped car's Q card, over the car (the phone cockpit draws it as a bottom sheet instead) */}
      {chrome === 'desktop' && <AnchoredQCard getAnchor={qCardAnchor3D} />}

      {followId && (
        <div
          className={`absolute flex items-center gap-2 px-2.5 py-1 rounded bg-black/70 border border-white/10 text-[11px] font-mono text-white ${
            chrome === 'phone' ? '' : 'left-1/2 -translate-x-1/2'}`}
          // on a phone: top right, beside the camera button — the panel sheet owns the left half
          style={chrome === 'phone'
            ? { top: overlayTop + 14, right: 'calc(env(safe-area-inset-right, 0px) + 64px)' }
            : { top: overlayTop + 12 }}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-otto-red animate-pulse" />
          Follow mode: {followAv}
          <button
            onClick={() => setFollow(null)}
            aria-label="Stop follow mode"
            className="ml-1 w-6 h-6 -my-1 flex items-center justify-center rounded text-white hover:text-white hover:bg-white/10"
          >
            ✕
          </button>
        </div>
      )}

      {/* on a touch screen the row scrolls sideways instead of wrapping over the view;
          the phone cockpit draws these in its own camera menu instead */}
      {chrome === 'desktop' && (<div
        className="absolute bottom-4 right-4 flex gap-1.5 flex-wrap justify-end [@media(pointer:coarse)]:left-4 [@media(pointer:coarse)]:flex-nowrap [@media(pointer:coarse)]:justify-start [@media(pointer:coarse)]:overflow-x-auto"
        style={{ paddingRight: 'env(safe-area-inset-right, 0px)', paddingLeft: 'env(safe-area-inset-left, 0px)', marginBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        {CAMERA_PRESET_NAMES.map((label) => (
          <button
            key={label}
            onClick={() => handleCameraPreset(label)}
            className={`${PRESET_BTN} shrink-0`}
          >
            {label}
          </button>
        ))}
      </div>)}
    </div>
  );
}
