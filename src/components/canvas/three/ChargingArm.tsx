import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { toWorld } from './coordUtils';
import { useTwinStore } from '@/store/twinStore';
import { MATERIALS } from './materials';

interface ChargingArmProps {
  stallId: string;
  stallType: 'dcfc' | 'l2';
}

const ARM_LENGTH = 4.0; // Base arm length in plan units
const CONNECTOR_SIZE = 0.8; // Size of the connector sphere

export function ChargingArm({ stallId, stallType }: ChargingArmProps) {
  const armRef = useRef<THREE.Group>(null);
  const pivotRef = useRef<THREE.Object3D>(null);
  
  // Get current stall status from twin store
  const stallStatus = useTwinStore((s) => 
    s.snapshot?.stalls_status.find(stall => stall.id === stallId)?.status || 'available'
  );
  
  // Determine if arm should be extended (charging)
  const isExtended = stallStatus === 'charging';
  
  // Arm geometry based on type
  const armGeo = useMemo(() => {
    const geo = new THREE.CylinderGeometry(
      0.15, // radiusTop
      0.15, // radiusBottom
      ARM_LENGTH,
      16    );
    // Position so rotation happens at base
    geo.translate(0, ARM_LENGTH / 2, 0);
    return geo;
  }, []);
  
  // Connector geometry
  const connectorGeo = useMemo(() => {
    return new THREE.SphereGeometry(CONNECTOR_SIZE, 16, 16);
  }, []);
  
  // Materials
  const armMaterial = useMemo(() => MATERIALS.chargerHousing(), []);
  const connectorMaterial = useMemo(() => 
    stallType === 'dcfc' ? 
      MATERIALS.tealLED(2.0) : 
      MATERIALS.amberIndicator()
  , [stallType]);
  
  // Animation state
  const animationState = useRef({
    progress: isExtended ? 1 : 0,
    target: isExtended ? 1 : 0
  });
  
  // Update animation on frame
  useFrame((state, delta) => {
    if (!armRef.current || !pivotRef.current) return;
    
    // Update animation target based on current state
    animationState.current.target = isExtended ? 1 : 0;
    
    // Smoothly animate extension/retraction
    const speed = 2.0; // Animation speed
    const deltaProgress = speed * delta;
    
    if (animationState.current.progress < animationState.current.target) {
      animationState.current.progress = Math.min(
        animationState.current.progress + deltaProgress,
        animationState.current.target
      );
    } else if (animationState.current.progress > animationState.current.target) {
      animationState.current.progress = Math.max(
        animationState.current.progress - deltaProgress,
        animationState.current.target
      );
    }
    
    // Apply animation transform
    const progress = animationState.current.progress;
    
    // Extend arm along its local Z axis
    armRef.current.position.z = progress * ARM_LENGTH;
    
    // Rotate pivot to lower the arm during extension
    pivotRef.current.rotation.x = progress * (Math.PI / 3); // ~60 degrees
    
    // Make connector visible/invisible and scale based on connection
    const connectorScale = 0.8 + progress * 0.4; // Slight pulsing effect when connected
    armRef.current.scale.set(connectorScale, connectorScale, connectorScale);
  });
  
  return (
    <group ref={pivotRef} position={[0, 2.1, 0]}>
      {/* Pivot point for arm angle */}
      <group ref={armRef}>
        {/* Main arm segment */}
        <mesh
          geometry={armGeo}
          material={armMaterial}
          castShadow
        />
        {/* Connector head */}
        <mesh
          geometry={connectorGeo}
          material={connectorMaterial}
          position={[0, 0, ARM_LENGTH]}
          castShadow
        />
      </group>
    </group>
  );
}