import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Environment } from '@react-three/drei';
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
import { StagingZone } from './three/StagingZone';
import { DriveAisles } from './three/DriveAisles';
import { UtilityEquipment } from './three/UtilityEquipment';
import { Vehicle3D } from './three/Vehicle3D';
import { DepotOverlays } from './three/DepotOverlays';
import { WeatherEffects } from './three/WeatherEffects';
import { DayNightLighting } from './three/DayNightLighting';
import { MATERIALS } from './three/materials';

const CAMERA_PRESETS = {
  'Bird Eye': { position: [0, 180, 10] as [number, number, number], target: [0, 0, 0] as [number, number, number] },
  'Street Level': { position: [0, 15, -130] as [number, number, number], target: [0, 0, 20] as [number, number, number] },
  'Operator': { position: [-120, 60, -80] as [number, number, number], target: [0, 0, 0] as [number, number, number] },
  'Hero': { position: [55, 12, 40] as [number, number, number], target: [0, 4, 0] as [number, number, number] },
  'Approach': { position: [-80, 3, 0] as [number, number, number], target: [0, 3, 0] as [number, number, number] },
  'Night Showcase': { position: [30, 8, -25] as [number, number, number], target: [0, 3, 0] as [number, number, number] },
};

// Seeded random for consistent tree placement
function seededRandom(seed: number) {
  const x = Math.sin(seed * 127.1) * 43758.5453;
  return x - Math.floor(x);
}

function Landscaping() {
  const trees = useMemo(() => {
    const t: { pos: [number, number, number]; h: number }[] = [];
    const positions: [number, number][] = [
      [-145, -80], [-145, -40], [-145, 0], [-145, 40], [-145, 80],
      [145, -80], [145, -40], [145, 0], [145, 40], [145, 80],
      [-60, -110], [-20, -110], [20, -110], [60, -110],
      [-60, 105], [20, 105],
    ];
    positions.forEach(([x, z], i) => {
      t.push({ pos: [x, 0, z], h: 5 + seededRandom(i) * 3 });
    });
    return t;
  }, []);

  const planterPositions: [number, number, number][] = useMemo(() => [
    [-110, 0, -95], [110, 0, -95], [-50, 0, -72], [50, 0, -72], [-80, 0, 60], [80, 0, 60],
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

      {/* Brand Signage — emissive only, no pointLight */}
      <group position={[0, 9.5, -115]}>
        <mesh castShadow>
          <boxGeometry args={[12, 1.8, 0.15]} />
          <meshPhysicalMaterial color="#0A0A0F" roughness={0.3} metalness={0.1} envMapIntensity={0.5} />
        </mesh>
        <mesh position={[0, 0.92, 0]}>
          <boxGeometry args={[12.2, 0.04, 0.02]} />
          <primitive object={MATERIALS.tealLED(5.0)} attach="material" />
        </mesh>
        <mesh position={[0, -0.92, 0]}>
          <boxGeometry args={[12.2, 0.04, 0.02]} />
          <primitive object={MATERIALS.tealLED(5.0)} attach="material" />
        </mesh>
        <mesh position={[0, 0, 0.08]}>
          <boxGeometry args={[8, 0.8, 0.02]} />
          <primitive object={MATERIALS.tealLED(5.0)} attach="material" />
        </mesh>
      </group>
    </group>
  );
}

export default function DepotScene3D() {
  const vehicles = useVehicleStore((s) => s.vehicles);
  const config = useSimulationStore((s) => s.config);
  const simTime = useSimulationStore((s) => s.simTime);
  const simSpeed = useSimulationStore((s) => s.simSpeed);
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const [ppEnabled, setPpEnabled] = useState(true);

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
        camera={{ position: [0, 180, 10], fov: 45, near: 1, far: 500 }}
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
          scene.fog = new FogExp2('#4a5568', 0.0015);
        }}
      >
        <Suspense fallback={null}>
          <DayNightLighting simTime={simTime} />
          <hemisphereLight args={['#87CEEB', '#2D5A1E', 0.9]} />
          <Environment background={false} environmentIntensity={1.5}>
            <mesh scale={50}>
              <sphereGeometry args={[1, 16, 16]} />
              <meshBasicMaterial color="#9BB8D0" side={1} />
            </mesh>
          </Environment>

          <DepotPostProcessing mode={ppMode} enabled={ppEnabled} />

          <DepotGround />
          <DepotBuilding />
          <SolarCanopy solarKWdc={config.solarCanopy} />
          <ChargingField type="dcfc" count={config.dcfcCount} />
          <ChargingField type="l2" count={config.l2Count} />
          <WashBays count={config.washBayCount} />
          <StagingZone count={config.stagingStalls} />
          <DriveAisles />
          <UtilityEquipment bessCapacity={config.bessCapacity} bessPower={config.bessPower} />
          <DepotOverlays />
          <Landscaping />

          {vehicles.map((v) => (
            <Vehicle3D key={v.id} vehicle={v} simSpeed={simSpeed} />
          ))}

          <WeatherEffects weather={config.weather} />

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
        <button
          onClick={() => setPpEnabled(!ppEnabled)}
          className={`px-2 py-1 text-[10px] font-mono rounded border transition-colors ${
            ppEnabled ? 'bg-[#00D4AA]/15 text-[#00D4AA] border-[#00D4AA]/30' : 'bg-black/60 text-gray-500 border-white/10'
          }`}
        >
          FX {ppEnabled ? 'ON' : 'OFF'}
        </button>
      </div>
    </div>
  );
}
