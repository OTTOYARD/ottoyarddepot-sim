// Materials shared by every fleet vehicle. Colours that differ per vehicle come from its spec.
import * as THREE from 'three';
import type { VehicleSpec } from './spec';

export type MaterialSet = Record<string, THREE.Material>;

export function makeMaterials(c: VehicleSpec['colors'], paintFinish: 'solid' | 'metallic' | 'satin' = 'solid'): MaterialSet {
  const phys = (o: THREE.MeshPhysicalMaterialParameters & { name: string }) => new THREE.MeshPhysicalMaterial(o);
  const std = (o: THREE.MeshStandardMaterialParameters & { name: string }) => new THREE.MeshStandardMaterial(o);
  const paintBase = paintFinish === 'metallic'
    ? { metalness: 0.75, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.05 }
    : paintFinish === 'satin'
      ? { metalness: 0.55, roughness: 0.42, clearcoat: 0.35, clearcoatRoughness: 0.3 }
      : { metalness: 0.05, roughness: 0.38, clearcoat: 1, clearcoatRoughness: 0.05 };
  return {
    paint: phys({ name: 'paint', color: c.paint, ...paintBase }),
    paint2: phys({ name: 'paint2', color: c.paint2 ?? 0x101214, ...paintBase }),
    accent: std({ name: 'accent', color: c.accent ?? 0x1f6fd0, roughness: 0.4, metalness: 0.2 }),
    glass: phys({ name: 'glass', color: 0x0b1116, metalness: 0.1, roughness: 0.04, transparent: true, opacity: 0.62, side: THREE.DoubleSide, depthWrite: false, envMapIntensity: 1.4 }),
    glassDark: phys({ name: 'glassDark', color: 0x05080a, metalness: 0.2, roughness: 0.05, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false, envMapIntensity: 1.4 }),
    glassBlack: phys({ name: 'glassBlack', color: 0x050607, metalness: 0.3, roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.03 }),
    trim: std({ name: 'trim', color: c.trim ?? 0x0c0d0f, roughness: 0.45, metalness: 0.2 }),
    cladding: std({ name: 'cladding', color: 0x17191c, roughness: 0.78, metalness: 0.05 }),
    rubber: std({ name: 'rubber', color: 0x0b0b0c, roughness: 0.92, metalness: 0 }),
    rim: std({ name: 'rim', color: c.rim ?? 0xb9bcc1, roughness: 0.32, metalness: 0.85, side: THREE.DoubleSide }),
    rimDark: std({ name: 'rimDark', color: 0x151618, roughness: 0.5, metalness: 0.6, side: THREE.DoubleSide }),
    lampHead: std({ name: 'lampHead', color: 0xf2f6ff, emissive: 0xdfe9ff, emissiveIntensity: 1.6, roughness: 0.2 }),
    lampTail: std({ name: 'lampTail', color: 0x8a0d10, emissive: 0xff1a1a, emissiveIntensity: 1.1, roughness: 0.25 }),
    lampAmber: std({ name: 'lampAmber', color: 0xc46a0a, emissive: 0xff8a1a, emissiveIntensity: 0.6, roughness: 0.3 }),
    lens: phys({ name: 'lens', color: 0x1b2026, metalness: 0.4, roughness: 0.08, clearcoat: 1 }),
    interior: std({ name: 'interior', color: c.interior ?? 0x2a2c30, roughness: 0.85, metalness: 0, side: THREE.DoubleSide }),
    seat: std({ name: 'seat', color: c.interior ? new THREE.Color(c.interior).multiplyScalar(1.25).getHex() : 0x3a3d42, roughness: 0.8, metalness: 0 }),
    cavity: std({ name: 'cavity', color: 0x0d0e10, roughness: 0.9, metalness: 0, side: THREE.DoubleSide }),
    sensorGloss: phys({ name: 'sensorGloss', color: 0x07080a, metalness: 0.4, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05 }),
    sensorBody: std({ name: 'sensorBody', color: 0x1a1c1f, roughness: 0.55, metalness: 0.3 }),
    sensorWhite: phys({ name: 'sensorWhite', color: c.paint, ...paintBase }),
    plate: std({ name: 'plate', color: 0xe9e9e4, roughness: 0.6, metalness: 0 }),
  };
}
