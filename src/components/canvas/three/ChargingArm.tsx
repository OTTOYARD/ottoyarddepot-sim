import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useVehicleStore } from '@/store/vehicleStore';
import { useDepotStore } from '@/store/depotStore';
import { toWorld } from './coordUtils';

/**
 * ChargingArm — realistic articulated robotic arm for EV charging.
 * Modeled after industrial arms (Flexiv Rizon style): silver metallic body,
 * multiple articulated joints with LED rings, extends to vehicle charge port.
 *
 * Behavior:
 *   - Folded at rest beside the charging pedestal
 *   - Vehicle arrives in stall → arm extends to charge port
 *   - Charging active → joint LEDs pulse glow
 *   - Charge complete → arm retracts to folded position
 */

interface ChargingArmProps {
  stallId: string;
  stallType: 'dcfc' | 'l2';
  position?: [number, number, number];
}

export function ChargingArm({ stallId, stallType, position: override }: ChargingArmProps) {
  const groupRef = useRef<THREE.Group>(null);
  const shoulderRef = useRef<THREE.Group>(null);
  const elbowRef = useRef<THREE.Group>(null);
  const wristRef = useRef<THREE.Group>(null);
  const connectorRef = useRef<THREE.Mesh>(null);

  const accentColor = stallType === 'dcfc' ? '#00BCD4' : '#FFC107';

  // Materials
  const silverBody = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#C0C0C0', metalness: 0.9, roughness: 0.25,
  }), []);
  const darkMetal = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#2A2A2A', metalness: 0.95, roughness: 0.15,
  }), []);
  const connectorMat = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#F5F5F5', metalness: 0.3, roughness: 0.4,
  }), []);
  const ledRing = useMemo(() => new THREE.MeshStandardMaterial({
    color: accentColor, emissive: accentColor, emissiveIntensity: 0.8,
    metalness: 0.2, roughness: 0.3,
  }), [accentColor]);

  // Resolve stall position
  const stalls = useDepotStore(s => s.stalls);
  const stall = stalls.find(s => s.id === stallId);
  const pos: [number, number, number] = override || (
    stall
      ? (() => { const w = toWorld({ x: stall.position.x, y: stall.position.y }, 0); return [w[0], 0, w[1]] as [number, number, number]; })()
      : [0, 0, 0]
  );

  // Charging state
  const vehicles = useVehicleStore(s => s.vehicles);
  const vehicleAtStall = vehicles.find(v => v.assignedStall === stallId);
  const isCharging = vehicleAtStall?.status === 'charging';
  const chargePct = vehicleAtStall?.currentSoC ?? 0;
  const isTargetReached = chargePct >= (vehicleAtStall?.targetSoC ?? 80);

  // Animation targets
  const animRef = useRef({ shoulder: 0, elbow: 0 });
  const glowRef = useRef(0);

  useFrame((_, delta) => {
    if (!shoulderRef.current || !elbowRef.current) return;

    if (isCharging && !isTargetReached) {
      animRef.current.shoulder = -Math.PI / 2.5;  // rotate forward
      animRef.current.elbow = Math.PI / 3;         // bend down toward car
    } else {
      animRef.current.shoulder = 0;
      animRef.current.elbow = 0;
    }

    const t = Math.min(4 * delta, 1);
    shoulderRef.current.rotation.x = THREE.MathUtils.lerp(shoulderRef.current.rotation.x, animRef.current.shoulder, t);
    elbowRef.current.rotation.x = THREE.MathUtils.lerp(elbowRef.current.rotation.x, animRef.current.elbow, t);

    // Pulse LED glow during charging
    glowRef.current = isCharging ? 0.6 + Math.sin(Date.now() * 0.005) * 0.4 : 0;
    ledRing.emissiveIntensity = glowRef.current;
  });

  return (
    <group ref={groupRef} position={pos} rotation={[0, Math.PI / 2, 0]}>
      {/* Base pedestal */}
      <mesh position={[0, 0.6, 0]} material={darkMetal}>
        <boxGeometry args={[0.3, 1.2, 0.3]} />
      </mesh>
      {/* Base plate */}
      <mesh position={[0, 0.05, 0]} material={darkMetal}>
        <cylinderGeometry args={[0.25, 0.28, 0.1, 16]} />
      </mesh>

      {/* Shoulder joint (turret) */}
      <group position={[0, 1.2, 0]}>
        {/* Joint housing */}
        <mesh material={darkMetal}>
          <cylinderGeometry args={[0.15, 0.15, 0.2, 24]} />
        </mesh>
        {/* LED ring around joint */}
        <mesh position={[0, 0, 0]} material={ledRing}>
          <torusGeometry args={[0.16, 0.02, 8, 24]} />
        </mesh>

        {/* Upper arm — rotates on X */}
        <group ref={shoulderRef} position={[0, 0.1, 0]}>
          {/* Arm segment */}
          <mesh position={[0, 1.2, 0]} material={silverBody}>
            <boxGeometry args={[0.08, 2.4, 0.08]} />
          </mesh>

          {/* Elbow joint */}
          <group position={[0, 2.4, 0]}>
            <mesh material={darkMetal}>
              <cylinderGeometry args={[0.1, 0.12, 0.15, 24]} />
            </mesh>
            <mesh material={ledRing}>
              <torusGeometry args={[0.13, 0.015, 8, 24]} />
            </mesh>

            {/* Forearm — rotates on X */}
            <group ref={elbowRef} position={[0, 0.08, 0]}>
              {/* Forearm segment */}
              <mesh position={[0, 0.7, -0.3]} rotation={[0.3, 0, 0]} material={silverBody}>
                <boxGeometry args={[0.06, 1.4, 0.06]} />
              </mesh>

              {/* Wrist joint */}
              <group ref={wristRef} position={[0, 1.4, -0.6]}>
                <mesh material={darkMetal}>
                  <cylinderGeometry args={[0.05, 0.06, 0.1, 20]} />
                </mesh>
                <mesh material={ledRing}>
                  <torusGeometry args={[0.07, 0.012, 8, 20]} />
                </mesh>

                {/* Connector plug */}
                <mesh ref={connectorRef} position={[0, 0.15, 0]} rotation={[Math.PI/2, 0, 0]} material={connectorMat}>
                  <cylinderGeometry args={[0.04, 0.04, 0.18, 16]} />
                </mesh>
                {/* Plug tip */}
                <mesh position={[0, 0.25, 0]} material={connectorMat}>
                  <sphereGeometry args={[0.05, 12, 8]} />
                </mesh>
              </group>
            </group>
          </group>
        </group>
      </group>
    </group>
  );
}
