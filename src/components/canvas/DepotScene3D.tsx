import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Suspense, useCallback, useRef, useMemo } from 'react';
import { ACESFilmicToneMapping, PCFSoftShadowMap, FogExp2, SRGBColorSpace } from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { useVehicleStore } from '@/store/vehicleStore';
import { useSimulationStore } from '@/store/simulationStore';
import { DepotGround } from './three/DepotGround';
import { DepotBuilding } from './three/DepotBuilding';
import { SolarCanopy } from './three/SolarCanopy';
import { ChargingField } from './three/ChargingField';
import { WashBays } from './three/WashBays';
import { ServiceBays } from './three/ServiceBays';
import { StagingZone } from './three/StagingZone';
import { Lanes3D } from './three/Lanes3D';
import { UtilityEquipment } from './three/UtilityEquipment';
import { Vehicle3D } from './three/Vehicle3D';
import { DepotOverlays } from './three/DepotOverlays';
import { WeatherEffects } from './three/WeatherEffects';
import { DayNightLighting } from './three/DayNightLighting';
import { DepotPostProcessing } from './three/DepotPostProcessing';
import { SiteDetails } from './three/SiteDetails';
import { MATERIALS } from './three/materials';
import { skyTexture } from './three/textures';
import { StagingZone } from './three/StagingZone';
// RAILS P2: right-of-way paint generated from the directed LaneGraph. Replaces
// the hand-drawn DriveAisles arrows, which claimed the west/east avenues were
// one-way when the graph actually makes them two-way divided — the markings
// were contradicting the rules the cars route on.
import { Lanes3D } from './three/Lanes3D';
import { UtilityEquipment } from './three/UtilityEquipment';
import { Vehicle3D } from './three/Vehicle3D';
import { DepotOverlays } from './three/DepotOverlays';
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
};

// Seeded random for consistent tree placement
function seededRandom(seed: number) {
  const x = Math.sin(seed * 127.1) * 43758.5453;
  return x - Math.floor(x);
}

function Landscaping() {
  const trees = useMemo(() => {
    const t: { pos: [number, number, number]; h: number }[] = [];
    // perimeter ring OUTSIDE the security fence (lot is x ±144, z -96..104)
    const positions: [number, number][] = [
      [-130, 112], [-95, 112], [-60, 112], [-25, 112], [10, 112], [45, 112], [80, 112], [115, 112],
      [-130, -118], [-90, -118], [0, -118], [130, -118],
      [-152, -70], [-152, -35], [-152, 0], [-152, 35], [-152, 70], [-152, 95],
      [152, -70], [152, -35], [152, 0], [152, 35], [152, 70], [152, 95],
    ];
    positions.forEach(([x, z], i) => {
      t.push({ pos: [x, 0, z], h: 5 + seededRandom(i) * 3 });
    });
    return t;
  }, []);

  const planterPositions: [number, number, number][] = useMemo(() => [
    [-62, 0, -90], [-38, 0, -90], [38, 0, -90], [62, 0, -90],  // gate plazas
    [-85, 0, 60], [66, 0, 60],                                  // building/wash flanks
  ], []);

  return (
    <group>
      {trees.map((tree, i) => {
        const trunkH = tree.h * 0.6;
        const crownR = 1.8 + seededRandom(i + 50) * 1.2;
        return (
          <group key={`tree${i}`} position={tree.pos}>
            <mesh position={[0, trunkH / 2, 0]} castShadow>
              <cylinderGeometry args={[0.15, 0.25, trunkH, 6]} />
              <meshPhysicalMaterial color="#4A3522" roughness={0.85} metalness={0} envMapIntensity={0.3} />
            </mesh>
            {[
              [0, trunkH + crownR * 0.6, 0] as [number, number, number],
              [-crownR * 0.3, trunkH + crownR * 0.3, crownR * 0.2] as [number, number, number],
              [crownR * 0.25, trunkH + crownR * 0.4, -crownR * 0.15] as [number, number, number],
            ].map((p, j) => (
              <mesh key={j} position={p} castShadow>
                <sphereGeometry args={[crownR * (0.8 + seededRandom(i * 3 + j) * 0.4), 8, 8]} />
                <meshPhysicalMaterial color="#2D5A1E" roughness={0.85} metalness={0} envMapIntensity={0.3} />
              </mesh>
            ))}
          </group>
        );
      })}

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
  const controlsRef = useRef<OrbitControlsImpl>(null);
  

  const handleCameraPreset = useCallback((preset: keyof typeof CAMERA_PRESETS) => {
    const ctrl = controlsRef.current;
    if (!ctrl) return;
    const { position, target } = CAMERA_PRESETS[preset];
    ctrl.object.position.set(...position);
    ctrl.target.set(...target);
    ctrl.update();
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

          <DepotOverlays />
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
