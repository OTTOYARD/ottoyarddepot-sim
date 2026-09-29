import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Suspense, useCallback, useEffect, useRef, useMemo, useState } from 'react';
import * as THREE from 'three';
import { ACESFilmicToneMapping, PCFShadowMap, PCFSoftShadowMap, FogExp2, SRGBColorSpace } from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { useVehicleStore } from '@/store/vehicleStore';
import { useSimulationStore } from '@/store/simulationStore';
import { useDepotStore } from '@/store/depotStore';
import { DepotGround } from './three/DepotGround';
import { DepotBuilding } from './three/DepotBuilding';
import { SolarCanopy } from './three/SolarCanopy';
import { ChargingField } from './three/ChargingField';
import { WashBays } from './three/WashBays';
import { ServiceBays } from './three/ServiceBays';
import { StagingZone } from './three/StagingZone';
import { ChargingArm } from './three/ChargingArm';
import { makeArmFleet } from './three/armInstances';
import { Lanes3D } from './three/Lanes3D';
import { UtilityEquipment } from './three/UtilityEquipment';
import { VehicleFleet } from './three/Vehicle3D';
import { WeatherEffects } from './three/WeatherEffects';
import { DayNightLighting } from './three/DayNightLighting';
import { DepotPostProcessing } from './three/DepotPostProcessing';
import { SiteDetails } from './three/SiteDetails';
import { MATERIALS } from './three/materials';
import { skyTexture } from './three/textures';
import { PerfProbe } from './three/perf/PerfProbe';
import { QualityGovernor } from './three/quality/QualityGovernor';
import { useQualityStore, useTierBudget } from './three/quality/qualityStore';
import { BUDGETS, initialTier, type TierBudget } from './three/quality/tiers';
import { CameraRig } from './three/CameraRig';
import { StaticMerge } from './three/StaticMerge';
import { BakedGroundAO } from './three/BakedGroundAO';
import { useCameraFollow } from './three/cameraFollow';

// toWorld negates X (east=-X) to un-mirror the scene. Bird Eye views from the
// SOUTH (z<0) so it is north-up / east-right, matching the 2D. Oblique presets
// negate their X so they frame the same physical subject in the flipped world.
// (Tuned + live-verified per camera 2026-07-22.)
const CAMERA_PRESETS = {
  'Bird Eye': { position: [0, 210, -60] as [number, number, number], target: [0, 0, -4] as [number, number, number] },
  'Entrance': { position: [50, 6, -135] as [number, number, number], target: [50, 3, -70] as [number, number, number] },
  'Canopy': { position: [75, 7, -50] as [number, number, number], target: [47, 5, 30] as [number, number, number] },
  'Operator': { position: [170, 90, -120] as [number, number, number], target: [0, 0, 20] as [number, number, number] },
  'Service': { position: [10, 9, 30] as [number, number, number], target: [25, 6, 75] as [number, number, number] },
  'Hero': { position: [-95, 14, -75] as [number, number, number], target: [-47, 6, 25] as [number, number, number] },
  // The pull-through bays from the forecourt (south), and their exits from the
  // rear apron (north): the two views that show a car driving THROUGH a building.
  'Bays': { position: [-70, 10, 38] as [number, number, number], target: [5, 3.5, 66] as [number, number, number] },
  'Rear': { position: [-30, 12, 108] as [number, number, number], target: [-10, 4, 70] as [number, number, number] },
};

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

/**
 * The tier's shadow filter on the renderer. PCFSoft takes ~4x the taps of PCF;
 * switching needs every lit material recompiled, which happens only here, on a
 * tier change — never per frame.
 */
function ShadowBudget({ budget }: { budget: TierBudget }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    const type = budget.softShadows ? PCFSoftShadowMap : PCFShadowMap;
    if (gl.shadowMap.enabled === budget.shadows && gl.shadowMap.type === type) return;
    gl.shadowMap.enabled = budget.shadows;
    gl.shadowMap.type = type;
    gl.shadowMap.needsUpdate = true;
    scene.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (!m) return;
      for (const x of Array.isArray(m) ? m : [m]) x.needsUpdate = true;
    });
  }, [gl, scene, budget.shadows, budget.softShadows]);
  return null;
}

const QUALITY_CYCLE = ['auto', 'high', 'medium', 'low'] as const;
// Finger-sized on touch screens (44 px tall, the platform minimum), unchanged with a mouse.
const PRESET_BTN = 'px-2 py-1 text-[10px] font-mono rounded bg-black/60 text-otto-gray border border-white/10 hover:bg-white/10 hover:text-white transition-colors [@media(pointer:coarse)]:min-h-[44px] [@media(pointer:coarse)]:px-3 [@media(pointer:coarse)]:text-[11px]';

export default function DepotScene3D() {
  const vehicles = useVehicleStore((s) => s.vehicles);
  const config = useSimulationStore((s) => s.config);
  const simTime = useSimulationStore((s) => s.simTime);
  const stalls = useDepotStore((s) => s.stalls);
  // Robotic arms are DCFC-only (10 stalls, canopy A). High-power fast charging
  // with hard turnaround pressure is what justifies the hardware; fitting all
  // 30 L2 trickle stalls would inflate the capex story and cost 40 IK solves a
  // frame for arms nobody would buy.
  const roboticStalls = useMemo(() => stalls.filter((s) => s.type === 'dcfc'), [stalls]);
  // Every arm draws into one set of instanced meshes (armInstances.ts): the
  // canopy costs the same draw calls at 10, 15 or 20 fast chargers. Capacity
  // grows in steps of 8 so a build-out change rarely rebuilds the buffers.
  const armCapacity = Math.max(8, Math.ceil(roboticStalls.length / 8) * 8);
  const armFleet = useMemo(() => makeArmFleet(armCapacity), [armCapacity]);
  useEffect(() => () => armFleet.dispose(), [armFleet]);
  // draw only the slots in use (the rest of the capacity costs no vertices)
  useEffect(() => { for (const m of armFleet.meshes) m.count = roboticStalls.length; }, [armFleet, roboticStalls.length]);
  const controlsRef = useRef<OrbitControlsImpl>(null);

  // Render tier: probed ONCE before the canvas exists, so its first frame is
  // already drawn at it (and MSAA, fixed at context creation, matches it).
  const [probe] = useState(() => initialTier());
  useEffect(() => {
    const q = useQualityStore.getState();
    q.setCeiling(probe.tier, `auto: ${probe.reason}`);
    if (q.mode !== 'auto') q.setMode(q.mode);
  }, [probe]);
  const budget = useTierBudget();
  const tier = useQualityStore((s) => s.tier);
  const mode = useQualityStore((s) => s.mode);
  const setMode = useQualityStore((s) => s.setMode);
  const followId = useCameraFollow((s) => s.followId);
  const setFollow = useCameraFollow((s) => s.setFollow);
  const followAv = useVehicleStore((s) => (followId ? s.vehicles.find((v) => v.id === followId)?.label ?? followId : null));
  const startBudget = BUDGETS[useQualityStore.getState().mode === 'auto' ? probe.tier : useQualityStore.getState().mode as keyof typeof BUDGETS];

  const handleCameraPreset = useCallback((preset: keyof typeof CAMERA_PRESETS) => {
    const ctrl = controlsRef.current;
    if (!ctrl) return;
    useCameraFollow.getState().setFollow(null); // a preset is a new framing
    const { position, target } = CAMERA_PRESETS[preset];
    ctrl.object.position.set(...position);
    ctrl.target.set(...target);
    ctrl.update();
  }, []);

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
        camera={{ position: [0, 180, -10], fov: 45, near: 1, far: 500 }}
        gl={{
          // MSAA on the default framebuffer: only High keeps it (the post stack
          // anti-aliases with SMAA; this matters only when no composer runs).
          antialias: startBudget.antialias,
          toneMapping: ACESFilmicToneMapping,
          toneMappingExposure: 2.2,
          outputColorSpace: SRGBColorSpace,
          powerPreference: 'high-performance',
        }}
        dpr={Math.min(window.devicePixelRatio, startBudget.dprMax)}
        // how far a camera drag may drop the resolution on Medium / Low (QualityGovernor)
        performance={{ min: 0.6 }}
        onCreated={({ gl, scene }) => {
          gl.shadowMap.enabled = startBudget.shadows;
          gl.shadowMap.type = startBudget.softShadows ? PCFSoftShadowMap : PCFShadowMap;
          scene.fog = new FogExp2('#b9cde4', 0.00065);
          // Procedural gradient sky: backdrop + PBR environment in one
          const sky = skyTexture();
          scene.background = sky;
          scene.environment = sky;
          // The backdrop is drawn through the same exposure (2.2) as the lit
          // scene, which burned the horizon band to white. Dim the BACKDROP only;
          // the environment keeps full strength for reflections and fill.
          scene.backgroundIntensity = 0.42;
        }}
      >
        <Suspense fallback={null}>
          <QualityGovernor />
          <ShadowBudget budget={budget} />
          <DayNightLighting simTime={simTime} shadows={budget.shadows} shadowMapSize={budget.shadowMapSize} />

          <StaticMerge name="ground"><DepotGround /></StaticMerge>
          <StaticMerge name="building"><DepotBuilding /></StaticMerge>
          <StaticMerge name="serviceBays"><ServiceBays /></StaticMerge>
          <StaticMerge name="solarCanopy" version={config.solarCanopy}><SolarCanopy solarKWdc={config.solarCanopy} /></StaticMerge>
          <group name="chargersDcfc"><ChargingField type="dcfc" count={config.dcfcCount} /></group>
          <group name="chargersL2"><ChargingField type="l2" count={config.l2Count} /></group>
          <StaticMerge name="washBays" version={config.washBayCount}><WashBays count={config.washBayCount} /></StaticMerge>
          <StaticMerge name="staging" version={config.stagingStalls}><StagingZone count={config.stagingStalls} /></StaticMerge>
          <group name="lanes"><Lanes3D /></group>
          {/* Medium / Low drop the N8AO pass; the static occlusion is baked instead */}
          <group name="bakedAO"><BakedGroundAO visible={!budget.ao} /></group>
          <StaticMerge name="utility" version={`${config.bessCapacity}/${config.bessPower}`}><UtilityEquipment bessCapacity={config.bessCapacity} bessPower={config.bessPower} /></StaticMerge>
          <group name="arms">
            {armFleet.meshes.map((m, i) => <primitive key={`armpart-${i}`} object={m} />)}
            {roboticStalls.map((s, i) => (
              <ChargingArm key={`arm-${s.id}`} stallId={s.id} stallType={s.type as 'dcfc' | 'l2'} fleet={armFleet} slot={i} />
            ))}
          </group>
          <StaticMerge name="landscaping"><Landscaping /></StaticMerge>
          <group name="siteDetails"><SiteDetails /></group>

          <group name="vehicles"><VehicleFleet vehicles={vehicles} /></group>

          <WeatherEffects weather={config.weather} share={budget.weatherShare} />
          <DepotPostProcessing mode="interactive" budget={budget} />
          <PerfProbe />

          <OrbitControls
            ref={controlsRef}
            enableDamping
            dampingFactor={0.08}
            maxPolarAngle={Math.PI / 2.05}
            minDistance={5}
            maxDistance={300}
            regress
          />
          <CameraRig controls={controlsRef} />
        </Suspense>
      </Canvas>

      {followId && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-2 px-2.5 py-1 rounded bg-black/70 border border-white/10 text-[11px] font-mono text-white">
          <span className="w-1.5 h-1.5 rounded-full bg-otto-red animate-pulse" />
          Following {followAv}
          <button
            onClick={() => setFollow(null)}
            aria-label="Stop following"
            className="ml-1 w-6 h-6 -my-1 flex items-center justify-center rounded text-otto-gray hover:text-white hover:bg-white/10"
          >
            ✕
          </button>
        </div>
      )}

      {/* on a touch screen the row scrolls sideways instead of wrapping over the view */}
      <div
        className="absolute bottom-4 right-4 flex gap-1.5 flex-wrap justify-end [@media(pointer:coarse)]:left-4 [@media(pointer:coarse)]:flex-nowrap [@media(pointer:coarse)]:justify-start [@media(pointer:coarse)]:overflow-x-auto"
        style={{ paddingRight: 'env(safe-area-inset-right, 0px)', paddingLeft: 'env(safe-area-inset-left, 0px)', marginBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <button
          onClick={() => setMode(QUALITY_CYCLE[(QUALITY_CYCLE.indexOf(mode) + 1) % QUALITY_CYCLE.length])}
          title="Render quality: Auto picks a tier for this device and holds the frame rate"
          className={`${PRESET_BTN} shrink-0`}
        >
          {mode === 'auto' ? `Auto · ${tier[0].toUpperCase()}${tier.slice(1)}` : `${tier[0].toUpperCase()}${tier.slice(1)}`}
        </button>
        {(Object.keys(CAMERA_PRESETS) as (keyof typeof CAMERA_PRESETS)[]).map((label) => (
          <button
            key={label}
            onClick={() => handleCameraPreset(label)}
            className={`${PRESET_BTN} shrink-0`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
