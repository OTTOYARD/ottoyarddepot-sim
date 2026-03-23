import { useRef } from 'react';
import * as THREE from 'three';
import { Html } from '@react-three/drei';
import { toWorld } from './coordUtils';

export function DepotGround() {
  const groundRef = useRef<THREE.Mesh>(null);

  // Ground plane centered at origin, 300 wide x 220 deep
  const [gx, gy, gz] = toWorld({ x: 150, y: 110 }, 0);

  return (
    <group>
      {/* Main asphalt ground */}
      <mesh ref={groundRef} position={[gx, -0.01, gz]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[300, 220]} />
        <meshStandardMaterial color="#1A1A2E" roughness={0.9} />
      </mesh>

      {/* Subtle grid lines */}
      <gridHelper
        args={[300, 30, '#ffffff08', '#ffffff08']}
        position={[gx, 0.01, gz]}
        rotation={[0, 0, 0]}
      />

      {/* Road strip at south edge (y=215 in 2D) */}
      {(() => {
        const [rx, , rz] = toWorld({ x: 150, y: 217.5 }, 0);
        return (
          <mesh position={[rx, 0.02, rz]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[300, 5]} />
            <meshStandardMaterial color="#444444" roughness={0.8} />
          </mesh>
        );
      })()}

      {/* Yellow dashed center line on road */}
      {Array.from({ length: 15 }, (_, i) => {
        const startX = i * 20;
        const [lx, , lz] = toWorld({ x: startX + 5, y: 217.5 }, 0);
        return (
          <mesh key={`dash-${i}`} position={[lx, 0.03, lz]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[10, 0.3]} />
            <meshStandardMaterial color="#F59E0B" emissive="#F59E0B" emissiveIntensity={0.3} />
          </mesh>
        );
      })}

      {/* Ingress marker */}
      {(() => {
        const [ix, , iz] = toWorld({ x: 100, y: 212 }, 0);
        return (
          <group position={[ix, 0.05, iz]}>
            <mesh rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[10, 5]} />
              <meshStandardMaterial color="#00B4A6" opacity={0.4} transparent />
            </mesh>
            <Html position={[0, 1.5, 0]} center>
              <span className="text-[10px] font-bold text-otto-teal tracking-wider">INGRESS</span>
            </Html>
          </group>
        );
      })()}

      {/* Egress marker */}
      {(() => {
        const [ex, , ez] = toWorld({ x: 200, y: 212 }, 0);
        return (
          <group position={[ex, 0.05, ez]}>
            <mesh rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[10, 5]} />
              <meshStandardMaterial color="#C00000" opacity={0.4} transparent />
            </mesh>
            <Html position={[0, 1.5, 0]} center>
              <span className="text-[10px] font-bold text-otto-red tracking-wider">EGRESS</span>
            </Html>
          </group>
        );
      })()}
    </group>
  );
}
