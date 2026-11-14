import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { calcLighting, nightFromSun, sunPosition, twilight, DAY_SKY, NIGHT_SKY } from './dayNight';

/**
 * THE SKY, DRAWN (2026-11-13). The backdrop used to be the sky texture itself
 * (textures.skyTexture): a 1024 x 512 picture wrapped round the whole world, whose soft
 * cloud blobs came out forty degrees wide and, at the backdrop's dimmed brightness, one
 * flat gray. That texture still LIGHTS the scene (scene.environment); this dome is only
 * what the eye sees behind it.
 *
 * One sphere around the camera, one draw call, no textures:
 *   - a zenith-to-horizon gradient that follows the sim clock (day, dusk, night);
 *   - the sun's disc and glow where the sun light actually stands (dayNight.sunPosition);
 *   - cumulus on a flat layer overhead: five octaves of noise for the shapes, lit from the
 *     sun's side with shaded bases, drifting on the wind; thin high cirrus above them;
 *   - haze at the horizon in the scene's own fog colour, so the city fades into the sky;
 *   - stars after dark.
 * Rain and snow close the cover and gray it; extreme heat thins it and whitens the haze.
 * A picture only: nothing here is read by the twin or changes what a car does.
 */

const VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww; // on the far plane: behind everything, whatever the camera's range
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  varying vec3 vDir;
  uniform vec3 uSun;        // unit vector to the sun
  uniform float uNight;     // 0 day .. 1 full night
  uniform float uDusk;      // 0 .. 1 at dawn and dusk
  uniform float uTime;      // seconds, for the wind
  uniform float uCover;     // 0 clear .. 1 overcast
  uniform float uGray;      // 0 fair-weather white .. 1 rain gray
  uniform vec3 uFogDay;
  uniform vec3 uFogNight;

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
    for (int i = 0; i < 5; i++) { v += a * noise(p); p = r * p * 2.03 + 11.7; a *= 0.5; }
    return v;
  }
  /** cloud density at a point of the layer: billowed shapes with crisp tops and wispy edges */
  float cloud(vec2 p) {
    float shape = fbm(p * 0.55);
    float billow = 1.0 - abs(2.0 * fbm(p * 1.9 + 31.0) - 1.0);   // rounded puffs on the outline
    float d = shape + 0.20 * (billow - 0.62);
    float lo = mix(0.635, 0.30, uCover);
    return smoothstep(lo, lo + 0.15, d);
  }

  void main() {
    vec3 dir = normalize(vDir);
    float up = dir.y;
    float day = 1.0 - uNight;

    // ── the air: zenith to horizon
    vec3 zenith = mix(vec3(0.115, 0.30, 0.66), vec3(0.006, 0.010, 0.028), uNight);
    vec3 mid    = mix(vec3(0.30, 0.52, 0.84), vec3(0.012, 0.020, 0.048), uNight);
    vec3 fog    = mix(uFogDay, uFogNight, uNight);
    vec3 haze   = mix(fog * 1.12, vec3(0.92, 0.50, 0.30) * (0.35 + 0.65 * day), uDusk * 0.7);
    float t = clamp(up, 0.0, 1.0);
    vec3 sky = mix(mid, zenith, smoothstep(0.0, 0.75, t));
    sky = mix(haze, sky, smoothstep(0.0, 0.32, pow(t, 0.75)));
    // overcast drains the blue
    sky = mix(sky, vec3(dot(sky, vec3(0.33))) * vec3(0.92, 0.96, 1.02), uGray * 0.75);

    // ── the sun
    float sd = max(dot(dir, uSun), 0.0);
    vec3 sunCol = mix(vec3(1.0, 0.96, 0.86), vec3(1.0, 0.62, 0.34), uDusk);
    float sunUp = smoothstep(-0.02, 0.06, uSun.y) * (1.0 - uGray * 0.85);
    sky += sunCol * (pow(sd, 6.0) * 0.10 + pow(sd, 48.0) * 0.22 + pow(sd, 900.0) * 1.6) * sunUp * day;
    // the dusk glow lies along the horizon on the sun's side
    sky += vec3(1.0, 0.45, 0.20) * uDusk * 0.35 * pow(1.0 - t, 6.0) * (0.35 + 0.65 * pow(sd, 2.0));

    // ── stars
    if (uNight > 0.3 && up > 0.0) {
      vec2 sp = dir.xz / (abs(dir.y) + 0.35) * 190.0;
      vec2 cell = floor(sp);
      float h = hash(cell);
      vec2 o = vec2(hash(cell + 3.1), hash(cell + 7.7)) - 0.5;
      float star = smoothstep(0.09, 0.0, length(fract(sp) - 0.5 - o * 0.6)) * step(0.955, h);
      float tw = 0.75 + 0.25 * sin(uTime * (1.0 + h * 3.0) + h * 40.0);
      sky += vec3(0.85, 0.9, 1.0) * star * tw * (uNight - 0.3) * 1.3 * smoothstep(0.0, 0.25, up) * (1.0 - uGray);
    }

    // ── clouds: a flat layer overhead, seen in perspective
    if (up > 0.004) {
      vec2 wind = vec2(0.012, 0.005) * uTime;
      vec2 p = dir.xz / (up + 0.10) * 2.1 + wind;
      float d = cloud(p);
      if (d > 0.001) {
        // toward the sun the cloud is thinner: lit edges, shaded hearts and bases
        vec2 toSun = normalize(uSun.xz + 1e-4) * 0.22;
        float lit = clamp(0.68 + 1.1 * (d - cloud(p + toSun)), 0.0, 1.0);
        float heart = smoothstep(0.35, 1.0, d);
        vec3 bright = mix(vec3(0.91, 0.91, 0.91), vec3(0.66, 0.68, 0.71), uGray);
        vec3 shade  = mix(vec3(0.56, 0.63, 0.75), vec3(0.34, 0.37, 0.42), uGray);
        vec3 c = mix(shade, bright, lit) * (1.0 - 0.13 * heart);
        c = mix(c, c * vec3(1.0, 0.70, 0.52), uDusk * 0.75);            // dusk warms them
        c += sunCol * pow(sd, 10.0) * 0.10 * (1.0 - heart) * sunUp;      // a silver lining by the sun
        c *= mix(1.0, 0.055, uNight);                                    // and night all but puts them out
        c += vec3(0.010, 0.013, 0.022) * uNight;
        float far = smoothstep(0.004, 0.16, up);                          // they thin into the haze
        sky = mix(sky, mix(haze, c, 0.35 + 0.65 * far), d * (0.25 + 0.75 * far));
      }
      // high cirrus: long faint streaks across the wind
      float ci = fbm(vec2(p.x * 0.35 + p.y * 0.9, p.y * 2.6 - p.x * 0.5) * 0.9 + 60.0 + wind * 0.4);
      ci = smoothstep(0.52, 0.80, ci) * smoothstep(0.10, 0.45, up) * (1.0 - uGray) * 0.34;
      sky = mix(sky, mix(vec3(0.95, 0.96, 0.98), vec3(1.0, 0.72, 0.55), uDusk * 0.7) * mix(1.0, 0.06, uNight), ci * (1.0 - d));
    }

    // below the horizon: the haze the far plain fades into
    sky = mix(sky, fog, smoothstep(0.0, -0.06, up));

    gl_FragColor = vec4(sky, 1.0);
    #include <colorspace_fragment>
  }
`;

/** How closed and how gray the sky is, per weather (simulationStore's config.weather). */
const WEATHER_SKY: Record<string, { cover: number; gray: number }> = {
  Clear: { cover: 0.42, gray: 0 },
  Rain: { cover: 0.97, gray: 1 },
  Snow: { cover: 0.9, gray: 0.8 },
  'Extreme Heat': { cover: 0.16, gray: 0 },
};

export function SkyDome({ simTime, weather }: { simTime: number; weather: string }) {
  const mesh = useRef<THREE.Mesh>(null);
  const material = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uSun: { value: new THREE.Vector3(0, 1, 0) },
      uNight: { value: 0 },
      uDusk: { value: 0 },
      uTime: { value: 0 },
      uCover: { value: WEATHER_SKY.Clear.cover },
      uGray: { value: 0 },
      uFogDay: { value: new THREE.Color(DAY_SKY.fog) },
      uFogNight: { value: new THREE.Color(NIGHT_SKY.fog) },
    },
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  }), []);

  // the sim clock: where the sun is and how dark it is
  useMemo(() => {
    const l = calcLighting(simTime);
    const u = material.uniforms;
    (u.uSun.value as THREE.Vector3).set(...sunPosition(l.hour, l.elev)).normalize();
    u.uNight.value = nightFromSun(l.sunI);
    u.uDusk.value = twilight(l.hour);
  }, [material, simTime]);

  useFrame(({ camera, clock }, dt) => {
    const u = material.uniforms;
    u.uTime.value = clock.elapsedTime;
    // weather closes in over a few seconds, it does not snap
    const w = WEATHER_SKY[weather] ?? WEATHER_SKY.Clear;
    const k = Math.min(1, dt * 0.5);
    u.uCover.value += (w.cover - u.uCover.value) * k;
    u.uGray.value += (w.gray - u.uGray.value) * k;
    mesh.current?.position.copy(camera.position);
  });

  return (
    <mesh ref={mesh} name="~skyDome" material={material} frustumCulled={false} renderOrder={-1000}>
      <sphereGeometry args={[10, 32, 20]} />
    </mesh>
  );
}
