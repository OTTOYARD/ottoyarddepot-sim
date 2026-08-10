import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useVehicleStore } from '@/store/vehicleStore';

interface ChargingArmProps {
  stallId: string;
  stallType: 'dcfc' | 'l2';
  position?: [number, number, number];
}

export function ChargingArm({ stallId, stallType, position = [0, 0, 0] }: ChargingArmProps) {
  const upperRef = useRef<THREE.Group>(null);
  const forearmRef = useRef<THREE.Group>(null);
  const connectorRef = useRef<THREE.Mesh>(null);
  
  const color = stallType === 'dcfc' ? '#00BCD4' : '#FFC107';
  const metal = useMemo(() => new THREE.MeshStandardMaterial({ color, metalness: 0.85, roughness: 0.3 }), [color]);
  const darkMetal = useMemo(() => new THREE.MeshStandardMaterial({ color: '#2A2A2A', metalness: 0.9, roughness: 0.2 }), []);
  
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
    <group position={position}>
      <mesh position={[0, 0.1, 0]} material={darkMetal}>
        <boxGeometry args={[0.5, 0.3, 0.1]} />
      </mesh>
      <group position={[0, 0.3, 0]}>
        <mesh material={darkMetal}>
          <cylinderGeometry args={[0.12, 0.15, 0.2, 16]} />
        </mesh>
        <group ref={upperRef} position={[0, 0.1, 0]}>
          <mesh position={[0, 1.5, 0]} material={metal}>
            <boxGeometry args={[0.08, 3.0, 0.08]} />
          </mesh>
          <group position={[0, 3.0, 0]}>
            <mesh material={darkMetal}>
              <cylinderGeometry args={[0.08, 0.08, 0.15, 12]} />
            </mesh>
            <group ref={forearmRef} position={[0, 0.08, 0]}>
              <mesh position={[0, 1.0, 0.5]} material={metal}>
                <boxGeometry args={[0.06, 2.0, 0.06]} />
              </mesh>
              <mesh ref={connectorRef} position={[0, 2.0, 0.5]} material={
                new THREE.MeshStandardMaterial({ color, metalness: 0.7, roughness: 0.3 })
              }>
                <cylinderGeometry args={[0.06, 0.04, 0.2, 12]} />
              </mesh>
            </group>
          </group>
        </group>
      </group>
      <mesh position={[0, 0.3, 0]} material={darkMetal}>
        <cylinderGeometry args={[0.08, 0.08, 0.6, 8]} />
      </mesh>
    </group>
  );
}
