import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { MATERIALS } from './materials';

const _dummy = new THREE.Object3D();

export function SolarCanopy({ solarKWdc }: { solarKWdc: number }) {
  const led = useRef<THREE.Mesh>(null);

  const s = solarKWdc / 500;
  const w = 180 * Math.min(s, 1.6);
  const d = 90 * Math.min(s, 1.4);
  const h = 16;
  const colsX = Math.max(4, Math.floor(6 * s));
  const spanX = w - 20;
  const purlinCount = Math.max(4, Math.floor(d / 5));
  const panelCols = Math.floor((w - 8) / 2.05);
  const panelRows = Math.floor((d - 8) / 1.05);
  const panelCount = panelCols * panelRows;

  // Instanced panels + frames
  const panelGeo = useMemo(() => new THREE.BoxGeometry(2.0, 0.04, 1.0), []);
  const frameGeo = useMemo(() => new THREE.BoxGeometry(2.04, 0.02, 1.04), []);

  const panelMesh = useMemo(() => {
    const mesh = new THREE.InstancedMesh(panelGeo, MATERIALS.solarPanelGlass(), panelCount);
    const ox = -(panelCols * 2.05) / 2 + 1;
    const oz = -(panelRows * 1.05) / 2;
    let idx = 0;
    for (let ci = 0; ci < panelCols; ci++) {
      for (let ri = 0; ri < panelRows; ri++) {
        _dummy.position.set(ox + ci * 2.05, h + 0.38, oz + ri * 1.05);
        _dummy.rotation.set(-0.087, 0, 0);
        _dummy.updateMatrix();
        mesh.setMatrixAt(idx++, _dummy.matrix);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.receiveShadow = true;
    return mesh;
  }, [panelCols, panelRows, panelCount, panelGeo]);

  const frameMesh = useMemo(() => {
    const mesh = new THREE.InstancedMesh(frameGeo, MATERIALS.brushedAluminum(), panelCount);
    const ox = -(panelCols * 2.05) / 2 + 1;
    const oz = -(panelRows * 1.05) / 2;
    let idx = 0;
    for (let ci = 0; ci < panelCols; ci++) {
      for (let ri = 0; ri < panelRows; ri++) {
        _dummy.position.set(ox + ci * 2.05, h + 0.36, oz + ri * 1.05);
        _dummy.rotation.set(-0.087, 0, 0);
        _dummy.updateMatrix();
        mesh.setMatrixAt(idx++, _dummy.matrix);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    return mesh;
  }, [panelCols, panelRows, panelCount, frameGeo]);

  useFrame(({ clock }) => {
    if (led.current)
      (led.current.material as THREE.MeshPhysicalMaterial)
        .emissiveIntensity = 2.0 + Math.sin(clock.elapsedTime * 2) * 1.0;
  });

  if (solarKWdc === 0) return null;

  return (
    <group position={[0, 0, 20]}>
      {/* HSS Columns with base plates and cap brackets */}
      {Array.from({ length: colsX }, (_, i) => {
        const x = -w / 2 + 10 + i * (spanX / (colsX - 1));
        return [d / 2 - 5, -d / 2 + 5].map((z, j) => (
          <group key={`col${i}${j}`} position={[x, 0, z]}>
            <mesh position={[0, 0.02, 0]} castShadow receiveShadow>
              <boxGeometry args={[0.8, 0.04, 0.8]} />
              <primitive object={MATERIALS.structuralSteel()} attach="material" />
            </mesh>
            <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
              <boxGeometry args={[0.3, h, 0.3]} />
              <primitive object={MATERIALS.structuralSteel()} attach="material" />
            </mesh>
            <mesh position={[0, h - 0.05, 0]} castShadow receiveShadow>
              <boxGeometry args={[0.45, 0.1, 0.45]} />
              <primitive object={MATERIALS.brushedAluminum()} attach="material" />
            </mesh>
          </group>
        ));
      })}

      {/* Main I-Beams spanning width */}
      {[d / 2 - 5, -d / 2 + 5].map((z, bi) => (
        <group key={`beam${bi}`} position={[0, h, z]}>
          <mesh castShadow receiveShadow>
            <boxGeometry args={[w - 10, 0.5, 0.08]} />
            <primitive object={MATERIALS.structuralSteel()} attach="material" />
          </mesh>
          <mesh position={[0, 0.25, 0]} castShadow>
            <boxGeometry args={[w - 10, 0.03, 0.2]} />
            <primitive object={MATERIALS.structuralSteel()} attach="material" />
          </mesh>
          <mesh position={[0, -0.25, 0]} castShadow>
            <boxGeometry args={[w - 10, 0.03, 0.2]} />
            <primitive object={MATERIALS.structuralSteel()} attach="material" />
          </mesh>
        </group>
      ))}

      {/* Purlins */}
      {Array.from({ length: purlinCount }, (_, i) => (
        <mesh key={`purlin${i}`} position={[0, h + 0.28, -d / 2 + 5 + i * ((d - 10) / (purlinCount - 1))]} castShadow>
          <boxGeometry args={[w - 10, 0.12, 0.12]} />
          <primitive object={MATERIALS.structuralSteel()} attach="material" />
        </mesh>
      ))}

      {/* Instanced Solar Panels */}
      <primitive object={panelMesh} />
      <primitive object={frameMesh} />

      {/* Anodized Fascia — front & back */}
      {[d / 2 - 3, -d / 2 + 3].map((z, i) => (
        <group key={`fascia_fb${i}`}>
          <mesh position={[0, h - 0.2, z]}>
            <boxGeometry args={[w - 4, 0.4, 0.06]} />
            <primitive object={MATERIALS.anodizedPanel()} attach="material" />
          </mesh>
          <mesh ref={i === 0 ? led : undefined} position={[0, h - 0.42, z]}>
            <boxGeometry args={[w - 4, 0.04, 0.02]} />
            <primitive object={MATERIALS.tealLED(3.0)} attach="material" />
          </mesh>
        </group>
      ))}
      {/* Left & right */}
      {[-w / 2 + 2, w / 2 - 2].map((x, i) => (
        <group key={`fascia_lr${i}`}>
          <mesh position={[x, h - 0.2, 0]}>
            <boxGeometry args={[0.06, 0.4, d - 4]} />
            <primitive object={MATERIALS.anodizedPanel()} attach="material" />
          </mesh>
          <mesh position={[x, h - 0.42, 0]}>
            <boxGeometry args={[0.02, 0.04, d - 4]} />
            <primitive object={MATERIALS.tealLED(3.0)} attach="material" />
          </mesh>
        </group>
      ))}

      {/* Under-canopy downlights — emissive mesh only, NO pointLights */}
      {Array.from({ length: Math.floor(w / 16) }, (_, i) =>
        Array.from({ length: Math.max(2, Math.floor(d / 16)) }, (_, j) => {
          const lx = -w / 2 + 8 + i * 16;
          const lz = -d / 2 + 8 + j * ((d - 16) / Math.max(1, Math.floor(d / 16) - 1));
          return (
            <mesh key={`dl${i}_${j}`} position={[lx, h - 0.5, lz]}>
              <cylinderGeometry args={[0.15, 0.15, 0.04, 8]} />
              <primitive object={MATERIALS.whiteLED(1.5)} attach="material" />
            </mesh>
          );
        })
      )}
    </group>
  );
}
