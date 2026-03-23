import { Canvas } from '@react-three/fiber';
import { OrbitControls, ContactShadows } from '@react-three/drei';
import { Suspense, useCallback, useRef } from 'react';
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

const CAMERA_PRESETS = {
  'Bird Eye': { position: [0, 180, 10] as [number, number, number], target: [0, 0, 0] as [number, number, number] },
  'Street Level': { position: [0, 15, -130] as [number, number, number], target: [0, 0, 20] as [number, number, number] },
  'Operator': { position: [-120, 60, -80] as [number, number, number], target: [0, 0, 0] as [number, number, number] },
};

export default function DepotScene3D() {
  const vehicles = useVehicleStore((s) => s.vehicles);
  const weather = useSimulationStore((s) => s.config.weather);
  const solarCanopy = useSimulationStore((s) => s.config.solarCanopy);
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
        gl={{ antialias: true }}
      >
        <Suspense fallback={null}>
          <DayNightLighting simTime={simTime} />

          <DepotGround />
          <DepotBuilding />
          <SolarCanopy solarKWdc={solarCanopy} />
          <ChargingField type="dcfc" count={solarCanopy ? useSimulationStore.getState().config.dcfcCount : 10} />
          <ChargingField type="l2" count={useSimulationStore.getState().config.l2Count} />
          <WashBays />
          <StagingZone />
          <DriveAisles />
          <UtilityEquipment />
          <DepotOverlays />

          {vehicles.map((v) => (
            <Vehicle3D key={v.id} vehicle={v} simSpeed={simSpeed} />
          ))}

          <WeatherEffects weather={weather} />
          <ContactShadows position={[0, 0, 0]} opacity={0.3} scale={300} blur={2} far={20} />
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
