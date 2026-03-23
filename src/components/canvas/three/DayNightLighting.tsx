import { useSimulationStore } from '@/store/simulationStore';
import { useMemo } from 'react';

export function DayNightLighting() {
  const simTime = useSimulationStore((s) => s.simTime);

  const { ambientIntensity, dirIntensity, dirColor, dirPos } = useMemo(() => {
    const hour = simTime / 3600;
    // 6AM-6PM = daytime
    if (hour >= 6 && hour < 18) {
      const noon = 12;
      const dist = Math.abs(hour - noon);
      const factor = 1 - dist / 6; // 1 at noon, 0 at edges
      return {
        ambientIntensity: 0.3 + factor * 0.4,
        dirIntensity: 0.5 + factor * 0.8,
        dirColor: '#FFF5E0',
        dirPos: [50 + (hour - 6) * 10, 80, 30] as [number, number, number],
      };
    }
    // Night
    return {
      ambientIntensity: 0.08,
      dirIntensity: 0.05,
      dirColor: '#4466AA',
      dirPos: [0, 40, 0] as [number, number, number],
    };
  }, [simTime]);

  return (
    <>
      <ambientLight intensity={ambientIntensity} color="#B0C4DE" />
      <directionalLight
        position={dirPos}
        intensity={dirIntensity}
        color={dirColor}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-far={200}
        shadow-camera-left={-160}
        shadow-camera-right={160}
        shadow-camera-top={120}
        shadow-camera-bottom={-120}
      />
      {/* Nighttime point lights at stall areas */}
      {(simTime < 21600 || simTime >= 64800) && (
        <>
          <pointLight position={[-50, 12, 50]} intensity={0.3} color="#FFE4B5" distance={80} />
          <pointLight position={[50, 12, 50]} intensity={0.3} color="#FFE4B5" distance={80} />
          <pointLight position={[0, 12, -30]} intensity={0.2} color="#FFE4B5" distance={60} />
          <pointLight position={[0, 12, -80]} intensity={0.2} color="#FFE4B5" distance={60} />
        </>
      )}
    </>
  );
}
