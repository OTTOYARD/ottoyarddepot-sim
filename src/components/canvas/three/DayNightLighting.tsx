import { useMemo } from 'react';

/**
 * Consolidated site lighting rig driven by sim time.
 * One shadow-casting sun (full-lot coverage), sky/ground hemisphere,
 * cool fill, and a soft front kick. Pole fixtures live in UtilityEquipment.
 */

function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }

// keyframes: [hour, sunIntensity, sunColor, sunElev(0..1), hemi, ambient, sky, ground]
const KEYS: [number, number, string, number, number, number, string, string][] = [
  [0,    0.0, '#223a66', 0.05, 0.16, 0.10, '#0e1626', '#10141c'],
  [5,    0.0, '#223a66', 0.05, 0.16, 0.10, '#101a2e', '#10141c'],
  [6.5,  1.6, '#ffbe86', 0.18, 0.55, 0.30, '#ff9d6e', '#4a3b2e'],
  [8,    3.8, '#fff3df', 0.62, 1.55, 0.92, '#9cc4ec', '#5d6258'],
  [12,   4.5, '#fffaf2', 1.00, 1.85, 1.05, '#87b7ea', '#6a6f64'],
  [16,   4.1, '#fff0d8', 0.80, 1.65, 0.95, '#8fb9e8', '#665f54'],
  [18.5, 2.2, '#ffb066', 0.30, 0.70, 0.36, '#ff8a55', '#4a3b2e'],
  [20,   0.4, '#7a5f8a', 0.10, 0.30, 0.18, '#28304e', '#1c1c22'],
  [24,   0.0, '#223a66', 0.05, 0.16, 0.10, '#0e1626', '#10141c'],
];

function mixHex(x: string, y: string, t: number) {
  const px = parseInt(x.slice(1), 16);
  const py = parseInt(y.slice(1), 16);
  const r = Math.round(lerp((px >> 16) & 255, (py >> 16) & 255, t));
  const g = Math.round(lerp((px >> 8) & 255, (py >> 8) & 255, t));
  const b = Math.round(lerp(px & 255, py & 255, t));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

function calcLighting(simTime: number) {
  const hour = (simTime / 3600) % 24;
  let i = 0;
  while (i < KEYS.length - 2 && hour > KEYS[i + 1][0]) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const t = Math.min(1, Math.max(0, (hour - a[0]) / Math.max(0.0001, b[0] - a[0])));

  return {
    hour,
    sunI: lerp(a[1], b[1], t),
    sunCol: mixHex(a[2], b[2], t),
    elev: lerp(a[3], b[3], t),
    hemiI: lerp(a[4], b[4], t),
    ambI: lerp(a[5], b[5], t),
    skyCol: mixHex(a[6], b[6], t),
    gndCol: mixHex(a[7], b[7], t),
  };
}

export function DayNightLighting({ simTime }: { simTime: number }) {
  const l = useMemo(() => calcLighting(simTime), [simTime]);

  // sun sweeps east→west across the day; elevation from the curve
  const az = ((l.hour - 6) / 12) * Math.PI;
  const R = 420;
  const sunPos: [number, number, number] = [
    Math.cos(az) * R * 0.8,
    60 + l.elev * 300,
    Math.sin(az) * R * 0.45 + 80,
  ];

  return (
    <>
      <ambientLight intensity={l.ambI} color="#cdd8e6" />
      <hemisphereLight color={l.skyCol} groundColor={l.gndCol} intensity={l.hemiI} />

      {/* Sun — single shadow caster, covers the entire fenced lot */}
      <directionalLight
        position={sunPos}
        intensity={l.sunI}
        color={l.sunCol}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-near={50}
        shadow-camera-far={900}
        shadow-camera-left={-185}
        shadow-camera-right={185}
        shadow-camera-top={185}
        shadow-camera-bottom={-185}
        shadow-bias={-0.0002}
        shadow-normalBias={0.03}
      />

      {/* Cool sky fill from the opposite side */}
      <directionalLight position={[-220, 160, -120]} intensity={l.sunI * 0.16} color="#bcd2ea" />
      {/* Soft front kick so south facades never go dead */}
      <directionalLight position={[40, 120, -260]} intensity={l.sunI * 0.10} color="#dde8f4" />
    </>
  );
}
