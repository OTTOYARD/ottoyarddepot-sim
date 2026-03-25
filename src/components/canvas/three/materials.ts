import * as THREE from 'three';

export const BRAND = {
  teal: new THREE.Color('#00D4AA'),
  tealDark: new THREE.Color('#009977'),
  emerald: new THREE.Color('#00B894'),
  dark: new THREE.Color('#0A0A0F'),
  darkPanel: new THREE.Color('#1A1A2E'),
  warmWhite: new THREE.Color('#F5F5F0'),
  charcoal: new THREE.Color('#2C2C3A'),
};

// Singleton cache
const _cache = new Map<string, THREE.MeshPhysicalMaterial>();
const _paintCache = new Map<string, THREE.MeshPhysicalMaterial>();

function cached(key: string, factory: () => THREE.MeshPhysicalMaterial): THREE.MeshPhysicalMaterial {
  let mat = _cache.get(key);
  if (!mat) {
    mat = factory();
    _cache.set(key, mat);
  }
  return mat;
}

// ===================== GROUND & PAVING =====================

export function polishedConcrete() {
  return cached('polishedConcrete', () => new THREE.MeshPhysicalMaterial({
    color: '#3a3a42', roughness: 0.35, metalness: 0.0,
    clearcoat: 0.1, clearcoatRoughness: 0.4,
    reflectivity: 0.5, envMapIntensity: 0.8,
  }));
}

export function asphalt() {
  return cached('asphalt', () => new THREE.MeshPhysicalMaterial({
    color: '#1f1f24', roughness: 0.9, metalness: 0.0, envMapIntensity: 0.2,
  }));
}

export function epoxyFloor() {
  return cached('epoxyFloor', () => new THREE.MeshPhysicalMaterial({
    color: '#2a2a35', roughness: 0.15, metalness: 0.0,
    clearcoat: 0.6, clearcoatRoughness: 0.1,
    reflectivity: 0.8, envMapIntensity: 1.2,
  }));
}

export function laneMarkingWhite() {
  return cached('laneMarkingWhite', () => new THREE.MeshPhysicalMaterial({
    color: '#E8E8E0', roughness: 0.6, metalness: 0.0, envMapIntensity: 0.3,
  }));
}

export function laneMarkingTeal() {
  return cached('laneMarkingTeal', () => new THREE.MeshPhysicalMaterial({
    color: '#00D4AA', roughness: 0.5, metalness: 0.0,
    emissive: new THREE.Color('#00D4AA'), emissiveIntensity: 0.15,
    envMapIntensity: 0.4,
  }));
}

// ===================== STRUCTURAL METALS =====================

export function structuralSteel() {
  return cached('structuralSteel', () => new THREE.MeshPhysicalMaterial({
    color: '#2A2A3E', roughness: 0.5, metalness: 0.4, envMapIntensity: 0.6,
  }));
}

export function brushedAluminum() {
  return cached('brushedAluminum', () => new THREE.MeshPhysicalMaterial({
    color: '#AABBCC', roughness: 0.4, metalness: 0.5, envMapIntensity: 0.8,
  }));
}

export function darkCladding() {
  return cached('darkCladding', () => new THREE.MeshPhysicalMaterial({
    color: '#2A2A34', roughness: 0.4, metalness: 0.05,
    envMapIntensity: 0.5, clearcoat: 0.1, clearcoatRoughness: 0.5,
  }));
}

export function anodizedPanel() {
  return cached('anodizedPanel', () => new THREE.MeshPhysicalMaterial({
    color: '#2C2C38', roughness: 0.35, metalness: 0.3,
    envMapIntensity: 0.6, clearcoat: 0.15, clearcoatRoughness: 0.4,
  }));
}

export function cortenSteel() {
  return cached('cortenSteel', () => new THREE.MeshPhysicalMaterial({
    color: '#8B4513', roughness: 0.8, metalness: 0.6, envMapIntensity: 0.5,
  }));
}

// ===================== GLASS =====================

export function architecturalGlass() {
  return cached('architecturalGlass', () => new THREE.MeshPhysicalMaterial({
    color: '#88CCBB', roughness: 0.05, metalness: 0.0,
    transmission: 0.85, thickness: 0.5, ior: 1.52,
    envMapIntensity: 2.0, transparent: true, opacity: 0.9,
    side: THREE.DoubleSide,
    attenuationColor: new THREE.Color('#00D4AA'), attenuationDistance: 5,
  }));
}

export function screenGlass() {
  return cached('screenGlass', () => new THREE.MeshPhysicalMaterial({
    color: '#0A0A1A', roughness: 0.02, metalness: 0.0,
    transmission: 0.3, thickness: 0.3, ior: 1.52,
    envMapIntensity: 2.5, transparent: true,
    clearcoat: 1.0, clearcoatRoughness: 0.05,
  }));
}

export function solarPanelGlass() {
  return cached('solarPanelGlass', () => new THREE.MeshPhysicalMaterial({
    color: '#1A2535', roughness: 0.15, metalness: 0.05,
    envMapIntensity: 0.8, clearcoat: 0.6, clearcoatRoughness: 0.15,
    emissive: new THREE.Color('#001020'), emissiveIntensity: 0.05,
  }));
}

// ===================== VEHICLES =====================

export function automotivePaint(color = '#1a1a1a') {
  let mat = _paintCache.get(color);
  if (!mat) {
    mat = new THREE.MeshPhysicalMaterial({
      color, roughness: 0.15, metalness: 0.4,
      clearcoat: 1.0, clearcoatRoughness: 0.03,
      envMapIntensity: 2.0, reflectivity: 1.0,
      sheen: 0.3, sheenRoughness: 0.2,
      sheenColor: new THREE.Color('#333344'),
    });
    _paintCache.set(color, mat);
  }
  return mat;
}

export function autoGlass() {
  return cached('autoGlass', () => new THREE.MeshPhysicalMaterial({
    color: '#224444', roughness: 0.02, metalness: 0.0,
    transmission: 0.7, thickness: 0.4, ior: 1.52,
    envMapIntensity: 2.5, transparent: true, side: THREE.DoubleSide,
  }));
}

export function chromeTrim() {
  return cached('chromeTrim', () => new THREE.MeshPhysicalMaterial({
    color: '#CCCCCC', roughness: 0.05, metalness: 1.0,
    envMapIntensity: 3.0, reflectivity: 1.0,
  }));
}

export function tireRubber() {
  return cached('tireRubber', () => new THREE.MeshPhysicalMaterial({
    color: '#1A1A1A', roughness: 0.85, metalness: 0.0, envMapIntensity: 0.3,
  }));
}

export function headlightLens() {
  return cached('headlightLens', () => new THREE.MeshPhysicalMaterial({
    color: '#FFFFFF', roughness: 0.02, metalness: 0.0,
    transmission: 0.9, thickness: 0.2, ior: 1.49,
    envMapIntensity: 2.0, transparent: true,
    clearcoat: 1.0, clearcoatRoughness: 0.02,
  }));
}

// ===================== EMISSIVE / LEDs =====================

export function tealLED(intensity = 3.0) {
  const key = `tealLED_${intensity}`;
  return cached(key, () => new THREE.MeshPhysicalMaterial({
    color: '#00D4AA',
    emissive: new THREE.Color('#00D4AA'), emissiveIntensity: intensity,
    roughness: 0.3, metalness: 0.0, toneMapped: false,
  }));
}

export function whiteLED(intensity = 2.0) {
  const key = `whiteLED_${intensity}`;
  return cached(key, () => new THREE.MeshPhysicalMaterial({
    color: '#F5F5F0',
    emissive: new THREE.Color('#F5F5F0'), emissiveIntensity: intensity,
    roughness: 0.4, metalness: 0.0, toneMapped: false,
  }));
}

export function greenIndicator() {
  return cached('greenIndicator', () => new THREE.MeshPhysicalMaterial({
    color: '#00FF66',
    emissive: new THREE.Color('#00FF66'), emissiveIntensity: 4.0,
    roughness: 0.2, metalness: 0.0, toneMapped: false,
  }));
}

export function amberIndicator() {
  return cached('amberIndicator', () => new THREE.MeshPhysicalMaterial({
    color: '#FFAA00',
    emissive: new THREE.Color('#FFAA00'), emissiveIntensity: 4.0,
    roughness: 0.2, metalness: 0.0, toneMapped: false,
  }));
}

// ===================== BUILDING =====================

export function concreteBlock() {
  return cached('concreteBlock', () => new THREE.MeshPhysicalMaterial({
    color: '#555560', roughness: 0.75, metalness: 0.0, envMapIntensity: 0.3,
  }));
}

export function woodAccent() {
  return cached('woodAccent', () => new THREE.MeshPhysicalMaterial({
    color: '#8B6914', roughness: 0.6, metalness: 0.0, envMapIntensity: 0.4,
    sheen: 0.2, sheenRoughness: 0.5, sheenColor: new THREE.Color('#AA8833'),
  }));
}

// ===================== CHARGER EQUIPMENT =====================

export function chargerHousing() {
  return cached('chargerHousing', () => new THREE.MeshPhysicalMaterial({
    color: '#1A1A24', roughness: 0.5, metalness: 0.2, envMapIntensity: 0.6,
  }));
}

export function chargerCable() {
  return cached('chargerCable', () => new THREE.MeshPhysicalMaterial({
    color: '#222222', roughness: 0.7, metalness: 0.0, envMapIntensity: 0.3,
  }));
}

export function chargerConnector() {
  return cached('chargerConnector', () => new THREE.MeshPhysicalMaterial({
    color: '#444444', roughness: 0.2, metalness: 0.8, envMapIntensity: 1.2,
  }));
}

// ===================== LANDSCAPING =====================

export function grass() {
  return cached('grass', () => new THREE.MeshPhysicalMaterial({
    color: '#2D5A1E', roughness: 0.85, metalness: 0.0, envMapIntensity: 0.3,
  }));
}

export function gravel() {
  return cached('gravel', () => new THREE.MeshPhysicalMaterial({
    color: '#7A7568', roughness: 0.95, metalness: 0.0, envMapIntensity: 0.2,
  }));
}

export function curbing() {
  return cached('curbing', () => new THREE.MeshPhysicalMaterial({
    color: '#999999', roughness: 0.7, metalness: 0.0, envMapIntensity: 0.3,
  }));
}

export const MATERIALS = {
  polishedConcrete, asphalt, epoxyFloor, laneMarkingWhite, laneMarkingTeal,
  structuralSteel, brushedAluminum, darkCladding, anodizedPanel, cortenSteel,
  architecturalGlass, screenGlass, solarPanelGlass,
  automotivePaint, autoGlass, chromeTrim, tireRubber, headlightLens,
  tealLED, whiteLED, greenIndicator, amberIndicator,
  concreteBlock, woodAccent,
  chargerHousing, chargerCable, chargerConnector,
  grass, gravel, curbing,
} as const;
