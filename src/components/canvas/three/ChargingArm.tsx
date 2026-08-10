import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useVehicleStore } from '@/store/vehicleStore';
import { useDepotStore } from '@/store/depotStore';
import { toWorld } from '@/lib/sitePlan';

interface ChargingArmProps {
  stallId: string;
  stallType: 'dcfc' | 'l2';
  position?: [number, number, number];
}

export function ChargingArm({ stallId, stallType, position: override }: ChargingArmProps) {
  const upperRef = useRef<THREE.Group>(null);
  const forearmRef = useRef<THREE.Group>(null);
  const connectorRef = useRef<THREE.Mesh>(null);

  const color = stallType === 'dcfc' ? '#00BCD4' : '#FFC107';
  const metal = useMemo(() => new THREE.MeshStandardMaterial({ color, metalness: 0.85, roughness: 0.3 }), [color]);
  const darkMetal = useMemo(() => new THREE.MeshStandardMaterial({ color: '#1A1A2E', metalness: 0.9, roughness: 0.2 }), []);

  // Resolve stall position from depot store
  const stalls = useDepotStore(s => s.stalls);
  const stall = stalls.find(s => s.id === stallId || s.code === stallId);
  
  // Use actual stall position, falling back to override
  const pos: [number, number, number] = override || (
    stall 
      ? (() => { const w = toWorld({ x: stall.position.x, y: stall.position.y }, 0); return [w[0], 0, w[1]] as [number, number, number]; })()
      : [0, 0, 0]
  );

  const vehicles = useVehicleStore(s => s.vehicles);
  const vehicleAtStall = vehicles.find(v => v.assignedStall === stallId && v.status === 'charging');
  const isCharging = !!vehicleAtStall;
  const chargePct = vehicleAtStall?.currentSoC ?? 0;
  const isTargetReached = chargePct >= (vehicleAtStall?.targetSoC ?? 80);

  const targetRef = useRef({ shoulder: 0, elbow: 0 });

  useFrame((_, delta) => {
    if (!upperRef.current || !forearmRef.current) return;
    const speed = 3;

    if (isCharging && !isTargetReached) {
      targetRef.current.shoulder = Math.PI / 3;
      targetRef.current.elbow = -Math.PI / 4;
    } else {
      targetRef.current.shoulder = 0;
      targetRef.current.elbow = 0;
    }

    const t = Math.min(speed * delta, 1);
    upperRef.current.rotation.x = THREE.MathUtils.lerp(upperRef.current.rotation.x, targetRef.current.shoulder, t);
    forearmRef.current.rotation.x = THREE.MathUtils.lerp(forearmRef.current.rotation.x, targetRef.current.elbow, t);

    if (connectorRef.current) {
      const mat = connectorRef.current.material as THREE.MeshStandardMaterial;
      mat.emissive = new THREE.Color(color);
      mat.emissiveIntensity = isCharging && !isTargetReached ? 0.7 : 0;
    }
  });

  return (
    <group position={pos}>
      {/* Wall mount plate */}
      <mesh position={[0, 1.5, 0]} material={darkMetal}>
        <boxGeometry args={[0.4, 0.25, 0.08]} />
      </mesh>
      {/* Base pivot */}
      <group position={[0, 1.7, 0]}>
        <mesh material={darkMetal}>
          <cylinderGeometry args={[0.1, 0.12, 0.15, 16]} />
        </mesh>
        {/* Upper arm */}
        <group ref={upperRef} position={[0, 0.08, 0]}>
          <mesh position={[0, 1.0, 0]} material={metal}>
            <boxGeometry args={[0.06, 2.0, 0.06]} />
          </mesh>
          {/* Elbow joint */}
          <group position={[0, 2.0, 0]}>
            <mesh material={darkMetal}>
              <cylinderGeometry args={[0.06, 0.06, 0.12, 12]} />
            </mesh>
            {/* Forearm */}
            <group ref={forearmRef} position={[0, 0.06, 0]}>
              <mesh position={[0, 0.8, 0.4]} material={metal}>
                <boxGeometry args={[0.05, 1.6, 0.05]} />
              </mesh>
              {/* Connector */}
              <mesh ref={connectorRef} position={[0, 1.6, 0.4]} material={
                new THREE.MeshStandardMaterial({ color, metalness: 0.7, roughness: 0.3 })
              }>
                <cylinderGeometry args={[0.05, 0.03, 0.16, 12]} />
              </mesh>
            </group>
          </group>
        </group>
      </group>
    </group>
  );
}
