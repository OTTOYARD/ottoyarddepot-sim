import { Canvas } from '@react-three/fiber';
import { OrbitControls, Environment, AccumulativeShadows, RandomizedLight } from '@react-three/drei';
import { Suspense, useCallback, useRef } from 'react';
import { ACESFilmicToneMapping, SRGBColorSpace } from 'three';
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
import { PostProcessing } from './three/PostProcessing';

const CAMERA_PRESETS = {
  'Bird Eye': { position: [0, 180, 10] as [number, number, number], target: [0, 0, 0] as [number, number, number] },
  'Street Level': { position: [0, 15, -130] as [number, number, number], target: [0, 0, 20] as [number, number, number] },
  'Operator': { position: [-120, 60, -80] as [number, number, number], target: [0, 0, 0] as [number, number, number] },
};

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
        camera={{ position: [0, 180, 10], fov: 45, near: 1, far: 500 }}
        gl={{
          antialias: true,
          toneMapping: ACESFilmicToneMapping,
          toneMappingExposure: 1.2,
          outputColorSpace: SRGBColorSpace,
          powerPreference: 'high-performance',
        }}
        dpr={Math.min(window.devicePixelRatio, 2)}
      >
        <Suspense fallback={null}>
          <DayNightLighting simTime={simTime} />
          <Environment preset="city" background={false} environmentIntensity={0.4} />

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

          {vehicles.map((v) => (
            <Vehicle3D key={v.id} vehicle={v} simSpeed={simSpeed} />
          ))}

          <WeatherEffects weather={config.weather} />

          <AccumulativeShadows temporal frames={60} alphaTest={0.65} opacity={0.6}
            scale={300} position={[0, 0.01, 0]}>
            <RandomizedLight amount={8} radius={8} ambient={0.5}
              position={[50, 80, 30]} bias={0.001} />
          </AccumulativeShadows>

          <PostProcessing />

          <OrbitControls
            ref={controlsRef}
            enableDamping
            dampingFactor={0.1}
            maxPolarAngle={Math.PI / 2.1}
            minDistance={20}
            maxDistance={250}
          />
        </Suspense>
      </Canvas>

      {/* Camera preset buttons */}
      <div className="absolute bottom-4 right-4 flex gap-1.5">
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
