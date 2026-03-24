import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { MATERIALS } from './materials';

export function SolarCanopy({ solarKWdc }: { solarKWdc: number }) {
  const led = useRef<THREE.Mesh>(null);
  if (solarKWdc === 0) return null;

  const s = solarKWdc / 500;
  const w = 180 * Math.min(s, 1.6);
  const d = 90 * Math.min(s, 1.4);
  const h = 16;
  const colsX = Math.max(4, Math.floor(6 * s));
  const spanX = w - 20;
  const purlinCount = Math.max(4, Math.floor(d / 5));
  const panelCols = Math.floor((w - 8) / 2.05);
  const panelRows = Math.floor((d - 8) / 1.05);

  useFrame(({ clock }) => {
    if (led.current)
      (led.current.material as THREE.MeshPhysicalMaterial)
        .emissiveIntensity = 2.0 + Math.sin(clock.elapsedTime * 2) * 1.0;
  });

  return (
    <group position={[0, 0, 20]}>
      {/* HSS Columns with base plates and cap brackets */}
      {Array.from({ length: colsX }, (_, i) => {
        const x = -w / 2 + 10 + i * (spanX / (colsX - 1));
        return [d / 2 - 5, -d / 2 + 5].map((z, j) => (
          <group key={`col${i}${j}`} position={[x, 0, z]}>
            {/* Base plate */}
            <mesh position={[0, 0.02, 0]} castShadow receiveShadow>
              <boxGeometry args={[0.8, 0.04, 0.8]} />
              <meshPhysicalMaterial {...MATERIALS.structuralSteel()} />
            </mesh>
            {/* HSS column */}
            <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
              <boxGeometry args={[0.3, h, 0.3]} />
              <meshPhysicalMaterial {...MATERIALS.structuralSteel()} />
            </mesh>
            {/* Cap bracket */}
            <mesh position={[0, h - 0.05, 0]} castShadow receiveShadow>
              <boxGeometry args={[0.45, 0.1, 0.45]} />
              <meshPhysicalMaterial {...MATERIALS.brushedAluminum()} />
            </mesh>
          </group>
        ));
      })}

      {/* Main I-Beams spanning width */}
      {[d / 2 - 5, -d / 2 + 5].map((z, bi) => (
        <group key={`beam${bi}`} position={[0, h, z]}>
          {/* Web */}
          <mesh castShadow receiveShadow>
            <boxGeometry args={[w - 10, 0.5, 0.08]} />
            <meshPhysicalMaterial {...MATERIALS.structuralSteel()} />
          </mesh>
          {/* Top flange */}
          <mesh position={[0, 0.25, 0]} castShadow>
            <boxGeometry args={[w - 10, 0.03, 0.2]} />
            <meshPhysicalMaterial {...MATERIALS.structuralSteel()} />
          </mesh>
          {/* Bottom flange */}
          <mesh position={[0, -0.25, 0]} castShadow>
            <boxGeometry args={[w - 10, 0.03, 0.2]} />
            <meshPhysicalMaterial {...MATERIALS.structuralSteel()} />
          </mesh>
        </group>
      ))}

      {/* Purlins */}
      {Array.from({ length: purlinCount }, (_, i) => (
        <mesh key={`purlin${i}`} position={[0, h + 0.28, -d / 2 + 5 + i * ((d - 10) / (purlinCount - 1))]} castShadow>
          <boxGeometry args={[w - 10, 0.12, 0.12]} />
          <meshPhysicalMaterial {...MATERIALS.structuralSteel()} />
        </mesh>
      ))}

      {/* Solar Panel Grid (tilted 5 degrees) */}
      <group position={[-(panelCols * 2.05) / 2 + 1, h + 0.38, -(panelRows * 1.05) / 2]}
        rotation-x={-0.087}>
        {Array.from({ length: panelCols }, (_, ci) =>
          Array.from({ length: panelRows }, (_, ri) => (
            <group key={`p${ci}_${ri}`} position={[ci * 2.05, 0, ri * 1.05]}>
              {/* Panel */}
              <mesh receiveShadow>
                <boxGeometry args={[2.0, 0.04, 1.0]} />
                <meshPhysicalMaterial {...MATERIALS.solarPanelGlass()} />
              </mesh>
              {/* Aluminum frame */}
              <mesh position={[0, -0.02, 0]}>
                <boxGeometry args={[2.04, 0.02, 1.04]} />
                <meshPhysicalMaterial {...MATERIALS.brushedAluminum()} />
              </mesh>
            </group>
          ))
        )}
      </group>

      {/* Anodized Fascia — all 4 edges */}
      {/* Front & back */}
      {[d / 2 - 3, -d / 2 + 3].map((z, i) => (
        <group key={`fascia_fb${i}`}>
          <mesh position={[0, h - 0.2, z]}>
            <boxGeometry args={[w - 4, 0.4, 0.06]} />
            <meshPhysicalMaterial {...MATERIALS.anodizedPanel()} />
          </mesh>
          {/* Teal LED strip at bottom */}
          <mesh ref={i === 0 ? led : undefined} position={[0, h - 0.42, z]}>
            <boxGeometry args={[w - 4, 0.04, 0.02]} />
            <meshPhysicalMaterial {...MATERIALS.tealLED(3.0)} />
          </mesh>
        </group>
      ))}
      {/* Left & right */}
      {[-w / 2 + 2, w / 2 - 2].map((x, i) => (
        <group key={`fascia_lr${i}`}>
          <mesh position={[x, h - 0.2, 0]}>
            <boxGeometry args={[0.06, 0.4, d - 4]} />
            <meshPhysicalMaterial {...MATERIALS.anodizedPanel()} />
          </mesh>
          <mesh position={[x, h - 0.42, 0]}>
            <boxGeometry args={[0.02, 0.04, d - 4]} />
            <meshPhysicalMaterial {...MATERIALS.tealLED(3.0)} />
          </mesh>
        </group>
      ))}

      {/* Under-canopy downlights */}
      {Array.from({ length: Math.floor(w / 16) }, (_, i) =>
        Array.from({ length: Math.max(2, Math.floor(d / 16)) }, (_, j) => {
          const lx = -w / 2 + 8 + i * 16;
          const lz = -d / 2 + 8 + j * ((d - 16) / Math.max(1, Math.floor(d / 16) - 1));
          return (
            <group key={`dl${i}_${j}`} position={[lx, h - 0.5, lz]}>
              <mesh>
                <cylinderGeometry args={[0.15, 0.15, 0.04, 16]} />
                <meshPhysicalMaterial {...MATERIALS.whiteLED(1.5)} />
              </mesh>
              <pointLight color="#F5F0E8" intensity={2} distance={12} decay={2} />
            </group>
          );
        })
      )}

      <pointLight position={[0, h - 2, 0]} color="#00D4AA" intensity={0.15} distance={w * 0.6} />
    </group>
  );
}
