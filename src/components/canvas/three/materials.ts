import * as THREE from 'three';
import {
  pvCellTexture, grassTexture, foliageTexture, asphaltFineTexture, concreteSlabTexture,
  paintWearTexture, barkTexture, ribbedSteelTexture, chainLinkTexture, bollardTexture,
  weatherTexture, spangleTexture, rustTexture, rippleTexture,
} from './textures';

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
  // cast concrete, laid by world position along all three axes: 8 u slabs with a joint between
  // them on a pad, the same pores and stains up a canopy pier
  return cached('polishedConcrete', () => concreted(new THREE.MeshPhysicalMaterial({
    color: '#dfe1e2', roughness: 0.7, metalness: 0.0,
    clearcoat: 0.04, clearcoatRoughness: 0.6,
    reflectivity: 0.4, envMapIntensity: 0.6,
  })));
}

export function asphalt() {
  return cached('asphalt', () => asphalted(new THREE.MeshPhysicalMaterial({
    color: '#c9c9d2', // multiplies the texture — keeps it dark but alive
    roughness: 0.92, metalness: 0.0, envMapIntensity: 0.3,
  })));
}

export function epoxyFloor() {
  return cached('epoxyFloor', () => new THREE.MeshPhysicalMaterial({
    color: '#2a2a35', roughness: 0.15, metalness: 0.0,
    clearcoat: 0.6, clearcoatRoughness: 0.1,
    reflectivity: 0.8, envMapIntensity: 1.2,
  }));
}

export function laneMarkingWhite() {
  return cached('laneMarkingWhite', () => worn(new THREE.MeshPhysicalMaterial({
    color: '#E8E8E0', roughness: 0.6, metalness: 0.0, envMapIntensity: 0.3,
  })));
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
  return cached('structuralSteel', () => weathered(new THREE.MeshPhysicalMaterial({
    color: '#2A2A3E', roughness: 0.5, metalness: 0.4, envMapIntensity: 0.6,
  })));
}

export function brushedAluminum() {
  return cached('brushedAluminum', () => new THREE.MeshPhysicalMaterial({
    color: '#AABBCC', roughness: 0.4, metalness: 0.5, envMapIntensity: 0.8,
  }));
}

export function darkCladding() {
  return cached('darkCladding', () => weathered(new THREE.MeshPhysicalMaterial({
    color: '#2A2A34', roughness: 0.4, metalness: 0.05,
    envMapIntensity: 0.5, clearcoat: 0.1, clearcoatRoughness: 0.5,
  })));
}

export function anodizedPanel() {
  return cached('anodizedPanel', () => new THREE.MeshPhysicalMaterial({
    color: '#2C2C38', roughness: 0.35, metalness: 0.3,
    envMapIntensity: 0.6, clearcoat: 0.15, clearcoatRoughness: 0.4,
  }));
}

export function cortenSteel() {
  return cached('cortenSteel', () => worldMapped(new THREE.MeshPhysicalMaterial({
    color: '#ffffff', map: rustTexture(), roughness: 0.85, metalness: 0.35, envMapIntensity: 0.4,
  }), { tile: 5, patch: 0, gain: 1.5, solid: true }));
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

/**
 * The charger screens: dark gloss under a clearcoat, OPAQUE. They carried transmission
 * 0.3, and one transmissive material anywhere in the scene makes three render every
 * opaque object a second time each frame (the transmission pass), for a see-through
 * effect nobody could see on a 0.6 x 0.86 u screen. Measured 2026-10-04 on the
 * recorded run at Low: the main pass drew 441 calls for ~230 meshes.
 */
export function screenGlass() {
  return cached('screenGlass', () => new THREE.MeshPhysicalMaterial({
    color: '#0A0A1A', roughness: 0.02, metalness: 0.0,
    envMapIntensity: 2.5,
    clearcoat: 1.0, clearcoatRoughness: 0.05,
  }));
}

export function solarPanelGlass() {
  return cached('solarPanelGlass', () => new THREE.MeshPhysicalMaterial({
    map: pvCellTexture(),
    color: '#e8edf2', // near-white multiplier; the cell texture carries the blue
    roughness: 0.22, metalness: 0.05,
    envMapIntensity: 1.1, clearcoat: 0.8, clearcoatRoughness: 0.12,
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

/** A charger that is out of use: its status bar. (It used to borrow a dim tealLED(0.4),
 *  so an offline charger's "red" LED was a faint teal.) */
export function redIndicator() {
  return cached('redIndicator', () => new THREE.MeshPhysicalMaterial({
    color: '#FF2D2D',
    emissive: new THREE.Color('#FF2D2D'), emissiveIntensity: 4.0,
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

/**
 * Lay a material's texture by WORLD position instead of the mesh's own UVs, so a 2 u planter
 * and a 300 u lawn show blades the same size and neighbouring lawns join without a seam.
 * The texture is read at two scales (the second turned, so the tile's repeat never lines up)
 * and tinted by a third, very slow read of itself: patches tens of metres across, the way real
 * turf is greener in one corner than another. `stripes` adds a mower's light and dark passes.
 * `solid` is for a hedge or a tree crown: the texture is read along all three axes, so upright
 * faces are leafed too, not streaked.
 */
function worldMapped<M extends THREE.MeshStandardMaterial>(m: M, o: { tile: number; stripes?: number; patch?: number; gain?: number; solid?: boolean; mid?: number; amp?: number }): M {
  const mid = (o.mid ?? (o.solid ? 0.3 : 0.62)).toFixed(3), amp = (o.amp ?? (o.solid ? 3 : 2.2)).toFixed(2);
  const gain = (o.gain ?? 1).toFixed(2), patch = (o.patch ?? 0.55).toFixed(3), stripes = (o.stripes ?? 0).toFixed(3), tile = o.tile.toFixed(2);
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTurfPos;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vec4 turfWorld = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          turfWorld = instanceMatrix * turfWorld;
        #endif
        vTurfPos = (modelMatrix * turfWorld).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTurfPos;')
      // the bump height is read where the colour is, not at the mesh's own UVs
      .replace('#include <bumpmap_pars_fragment>', THREE.ShaderChunk.bumpmap_pars_fragment
        .replace(/vBumpMapUv/g, `(vTurfPos.xz / ${tile})`))
      .replace('#include <map_fragment>', o.solid ? /* glsl */ `
        // a solid (a hedge, a tree crown): read the texture along each axis and blend by which way the face looks
        vec3 turfN = abs(normalize(cross(dFdx(vTurfPos), dFdy(vTurfPos))));
        turfN = turfN * turfN / dot(turfN, turfN);
        vec3 turfP = vTurfPos / ${tile};
        vec3 turf = texture2D(map, turfP.xz).rgb * turfN.y + texture2D(map, turfP.xy + 0.31).rgb * turfN.z + texture2D(map, turfP.zy + 0.67).rgb * turfN.x;
        float turfSlow = texture2D(map, turfP.xz / 9.0 + turfP.y * 0.07).g;
        turf *= max(0.0, 1.0 + ${patch} * (turfSlow - ${mid}) * ${amp});
        diffuseColor.rgb *= turf * ${gain};
      ` : /* glsl */ `
        vec2 turfUv = vTurfPos.xz;
        vec3 turfA = texture2D(map, turfUv / ${tile}).rgb;
        vec3 turfB = texture2D(map, mat2(0.8, -0.6, 0.6, 0.8) * turfUv / (${tile} * 3.7) + 0.37).rgb;
        float turfSlow = texture2D(map, mat2(0.6, 0.8, -0.8, 0.6) * turfUv / (${tile} * 23.0) + 0.11).g
                       + texture2D(map, turfUv / (${tile} * 61.0) + 0.53).g;
        vec3 turf = mix(turfA, turfB, 0.4) * max(0.0, 1.0 + ${patch} * (turfSlow - ${mid}) * ${amp});
        turf *= 1.0 + ${stripes} * (smoothstep(-0.25, 0.25, sin(dot(vTurfPos.xz, vec2(0.6, 0.8)) * 0.52)) - 0.5);
        diffuseColor.rgb *= turf * ${gain};
      `);
  };
  // one program per (tile, stripes, patch), not one shared with every other mapped material
  m.customProgramCacheKey = () => `turf:${tile}:${stripes}:${patch}:${gain}:${o.solid ? 1 : 0}:${mid}:${amp}`;
  return m;
}

/** Yard asphalt on any standard material: aggregate up close, worn and resealed patches from the air. */
export function asphalted<M extends THREE.MeshStandardMaterial>(m: M): M {
  m.map = asphaltFineTexture();
  m.bumpMap = asphaltFineTexture();
  m.bumpScale = 0.35;
  return worldMapped(m, { tile: 13, patch: 0.5, mid: 0.045, amp: 14, gain: 1.15 });
}

/** Cast concrete on any standard material, slab or upright. */
export function concreted<M extends THREE.MeshStandardMaterial>(m: M, slab = 8): M {
  m.map = concreteSlabTexture();
  return worldMapped(m, { tile: slab, patch: 0.1, mid: 0.44, amp: 2.2, gain: 1.5, solid: true });
}

/** Road paint that has been driven on: chips and scuffs over the paint's own colour. */
export function worn<M extends THREE.MeshStandardMaterial>(m: M): M {
  m.map = paintWearTexture();
  return worldMapped(m, { tile: 7, patch: 0.25, mid: 1.7, amp: 0.6, gain: 1.12 });
}

/** Bark on a trunk's material. */
export function barked<M extends THREE.MeshStandardMaterial>(m: M): M {
  m.color.set('#ffffff');
  m.map = barkTexture();
  return worldMapped(m, { tile: 2.2, patch: 0, gain: 1.15, solid: true });
}

/** Ribbed, painted steel over the material's own colour (battery enclosures, switchgear). */
export function ribbed<M extends THREE.MeshStandardMaterial>(m: M): M {
  m.map = ribbedSteelTexture();
  return worldMapped(m, { tile: 4, patch: 0, gain: 1.18, solid: true });
}

/**
 * Chain-link infill for a fence panel `len` u long and `h` u high: woven wire you can see
 * through, where a translucent dark slab used to stand. Lay it on a plane (its UVs run 0..1).
 */
export function chainLink(len: number, h: number): THREE.MeshStandardMaterial {
  const map = chainLinkTexture().clone();
  map.repeat.set(len / 0.55, h / 0.55);
  map.needsUpdate = true;
  return new THREE.MeshStandardMaterial({
    map, color: '#7f8690', transparent: true, alphaTest: 0.08, side: THREE.DoubleSide, depthWrite: false,
    // little of the (always daytime) sky in it, or the wire glows white after dark
    roughness: 0.6, metalness: 0.25, envMapIntensity: 0.15,
  });
}

/** A safety bollard: yellow, with its reflective band, scuffs and grime (bollardTexture). */
export function bollard() {
  return cached('bollard', () => new THREE.MeshPhysicalMaterial({
    map: bollardTexture(), color: '#ffffff', roughness: 0.55, metalness: 0.0, envMapIntensity: 0.45,
    clearcoat: 0.3, clearcoatRoughness: 0.4,
  }));
}

/** Weather a painted or bare metal: dust, scratches and rain streaks over its own colour. */
export function weathered<M extends THREE.MeshStandardMaterial>(m: M, tile = 6): M {
  m.map = weatherTexture();
  return worldMapped(m, { tile, patch: 0, gain: 1.22, solid: true });
}

/** Hot-dip galvanised steel: the zinc's spangle over the material's own gray. */
export function galvanised<M extends THREE.MeshStandardMaterial>(m: M): M {
  m.map = spangleTexture();
  return worldMapped(m, { tile: 3, patch: 0, gain: 1.5, solid: true });
}

/** River and fountain water: ripples over the material's own colour. */
export function rippled<M extends THREE.MeshStandardMaterial>(m: M): M {
  m.map = rippleTexture();
  m.bumpMap = rippleTexture();
  m.bumpScale = 1.4;
  return worldMapped(m, { tile: 34, patch: 0.5, mid: 0.72, amp: 1.6, gain: 2.3 });
}

/** The plain beyond the city: rough pasture, the turf texture at field scale. */
export function pastured<M extends THREE.MeshStandardMaterial>(m: M): M {
  m.map = grassTexture();
  return worldMapped(m, { tile: 120, patch: 0.9, gain: 1.0 });
}

/** Turn any standard material into mown turf (the city's lawns use their own material). */
export function turfed<M extends THREE.MeshStandardMaterial>(m: M): M {
  m.color.set('#ffffff');
  m.map = grassTexture();
  m.bumpMap = grassTexture();
  m.bumpScale = 0.6;
  return worldMapped(m, { tile: 26, stripes: 0.09 });
}

export function grass() {
  // The turf texture carries the colour (grassTexture); it used to be one flat green, #4a7a36.
  return cached('grass', () => turfed(new THREE.MeshPhysicalMaterial({
    roughness: 0.92, metalness: 0.0, envMapIntensity: 0.35,
  })));
}

/** Leaf a tree crown's material: the foliage texture over whatever green each tree already has. */
export function leafed<M extends THREE.MeshStandardMaterial>(m: M): M {
  m.map = foliageTexture();
  return worldMapped(m, { tile: 9, patch: 0.3, gain: 3.5, solid: true });
}

export function shrubGreen() {
  return cached('shrubGreen', () => worldMapped(new THREE.MeshPhysicalMaterial({
    color: '#ffffff', map: foliageTexture(),
    roughness: 0.9, metalness: 0.0, envMapIntensity: 0.35,
  }), { tile: 7, patch: 0.3, gain: 1.25, solid: true }));
}

export function safetyYellow() {
  return cached('safetyYellow', () => new THREE.MeshPhysicalMaterial({
    color: '#f2b705', roughness: 0.45, metalness: 0.0, envMapIntensity: 0.6,
    clearcoat: 0.3, clearcoatRoughness: 0.3,
  }));
}

export function safetyOrange() {
  return cached('safetyOrange', () => new THREE.MeshPhysicalMaterial({
    color: '#ff5f1f', roughness: 0.4, metalness: 0.0, envMapIntensity: 0.7,
    clearcoat: 0.35, clearcoatRoughness: 0.25,
    emissive: new THREE.Color('#ff5f1f'), emissiveIntensity: 0.18,
  }));
}

export function gravel() {
  return cached('gravel', () => new THREE.MeshPhysicalMaterial({
    color: '#7A7568', roughness: 0.95, metalness: 0.0, envMapIntensity: 0.2,
  }));
}

export function curbing() {
  return cached('curbing', () => concreted(new THREE.MeshPhysicalMaterial({
    color: '#b4b4b4', roughness: 0.75, metalness: 0.0, envMapIntensity: 0.3,
  }), 5));
}

export const MATERIALS = {
  polishedConcrete, asphalt, epoxyFloor, laneMarkingWhite, laneMarkingTeal,
  structuralSteel, brushedAluminum, darkCladding, anodizedPanel, cortenSteel,
  architecturalGlass, screenGlass, solarPanelGlass,
  automotivePaint, autoGlass, chromeTrim, tireRubber, headlightLens,
  tealLED, whiteLED, greenIndicator, amberIndicator, redIndicator,
  concreteBlock, woodAccent,
  chargerHousing, chargerCable, chargerConnector,
  grass, gravel, curbing, shrubGreen, safetyYellow, safetyOrange, bollard,
} as const;
