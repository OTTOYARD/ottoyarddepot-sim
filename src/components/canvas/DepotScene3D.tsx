import { Canvas, useFrame } from '@react-three/fiber';
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
import { ChargingField } from './three/ChargingField';
import { WashBays } from './three/WashBays';
import { ServiceBays } from './three/ServiceBays';
import { StagingZone } from './three/StagingZone';
import { ChargingArm } from './three/ChargingArm';
import { Lanes3D } from './three/Lanes3D';
import { UtilityEquipment } from './three/UtilityEquipment';
import { Vehicle3D } from './three/Vehicle3D';
import { WeatherEffects } from './three/WeatherEffects';
import { DayNightLighting } from './three/DayNightLighting';
import { DepotPostProcessing } from './three/DepotPostProcessing';
import { SiteDetails } from './three/SiteDetails';
import { MATERIALS } from './three/materials';
import { skyTexture } from './three/textures';

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

export default function DepotScene3D() {
  const vehicles = useVehicleStore((s) => s.vehicles);
  const config = useSimulationStore((s) => s.config);
  const simTime = useSimulationStore((s) => s.simTime);
  const simSpeed = useSimulationStore((s) => s.simSpeed);
  const stalls = useDepotStore((s) => s.stalls);
  // Robotic arms are DCFC-only (10 stalls, canopy A). High-power fast charging
  // with hard turnaround pressure is what justifies the hardware; fitting all
  // 30 L2 trickle stalls would inflate the capex story and cost 40 IK solves a
  // frame for arms nobody would buy.
  const roboticStalls = useMemo(() => stalls.filter((s) => s.type === 'dcfc'), [stalls]);
  const controlsRef = useRef<OrbitControlsImpl>(null);
  

  const handleCameraPreset = useCallback((preset: keyof typeof CAMERA_PRESETS) => {
    const ctrl = controlsRef.current;
    if (!ctrl) return;
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
          <DayNightLighting simTime={simTime} />



          <DepotGround />
          <DepotBuilding />
          <ServiceBays />
          <SolarCanopy solarKWdc={config.solarCanopy} />
          <ChargingField type="dcfc" count={config.dcfcCount} />
          <ChargingField type="l2" count={config.l2Count} />
          <WashBays count={config.washBayCount} />
          <StagingZone count={config.stagingStalls} />
          <Lanes3D />
          <UtilityEquipment bessCapacity={config.bessCapacity} bessPower={config.bessPower} />
          {roboticStalls.map((s) => (
            <ChargingArm key={`arm-${s.id}`} stallId={s.id} stallType={s.type as 'dcfc' | 'l2'} />
          ))}
          <Landscaping />
          <SiteDetails />

          {vehicles.map((v) => (
            <Vehicle3D key={v.id} vehicle={v} simSpeed={simSpeed} />
          ))}

          <WeatherEffects weather={config.weather} />
          <DepotPostProcessing mode="interactive" />

          <OrbitControls
            ref={controlsRef}
            enableDamping
            dampingFactor={0.08}
            maxPolarAngle={Math.PI / 2.05}
            minDistance={5}
            maxDistance={300}
          />
        </Suspense>
      </Canvas>

      <div className="absolute bottom-4 right-4 flex gap-1.5 flex-wrap justify-end">
        {(Object.keys(CAMERA_PRESETS) as (keyof typeof CAMERA_PRESETS)[]).map((label) => (
          <button
            key={label}
            onClick={() => handleCameraPreset(label)}
            className="px-2 py-1 text-[10px] font-mono rounded bg-black/60 text-otto-gray border border-white/10 hover:bg-white/10 hover:text-white transition-colors"
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}