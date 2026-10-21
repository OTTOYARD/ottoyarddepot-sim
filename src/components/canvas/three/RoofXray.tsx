import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { MATERIALS } from './materials';
import { roofMembrane } from './buildingSkin';

/**
 * SEE-THROUGH ROOFS FROM ABOVE.
 *
 * Chase, 2026-10-20: "I still do not visually see the full integration of new robotic DCFC's and
 * robovacs over them." Measured on the live view the same evening: from the Bird Eye camera the
 * canopies' solar modules and the halls' roofs cover every robot the depot has, the fast chargers'
 * arms and cleaning arms under canopy A and the rollover machines inside the wash hall, and every car
 * under a canopy or a carport. A twin that is a proof surface must show the work it claims.
 *
 * So, when the camera looks down steeply, the solar modules and the roof membranes fade to
 * XRAY_OPACITY and what is under them shows through. Looking across the depot (a person's view),
 * they are solid, as built. A view choice only: nothing in the world reads it, nothing moves, and the
 * shadows under a roof are kept (the shadow pass draws the roof solid).
 */

/** The camera's pitch below the horizon, radians, above which the roofs fade and below which they come back. */
export const XRAY_ON_PITCH = (40 * Math.PI) / 180;
export const XRAY_OFF_PITCH = (32 * Math.PI) / 180;
/** How much of a faded roof still shows. */
export const XRAY_OPACITY = 0.16;
/** How fast a roof fades, per second (a fade takes about a third of a second). */
const FADE_RATE = 3;

/** Is the camera looking down steeply enough to see through the roofs? Hysteresis keeps it from flickering. */
export function wantsXray(pitchBelowHorizon: number, wasOn: boolean): boolean {
  return wasOn ? pitchBelowHorizon > XRAY_OFF_PITCH : pitchBelowHorizon > XRAY_ON_PITCH;
}

export function RoofXray() {
  const mats = useMemo<THREE.Material[]>(() => [MATERIALS.solarPanelGlass(), roofMembrane()], []);
  const st = useRef({ on: false, k: 1, see: false });
  const dir = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera }, delta) => {
    camera.getWorldDirection(dir);
    const pitch = Math.asin(Math.max(-1, Math.min(1, -dir.y)));
    st.current.on = wantsXray(pitch, st.current.on);
    const target = st.current.on ? XRAY_OPACITY : 1;
    const k = st.current.k + (target - st.current.k) * Math.min(1, Math.min(delta, 0.1) * FADE_RATE * 4);
    st.current.k = Math.abs(k - target) < 0.004 ? target : k;
    const see = st.current.k < 0.999;
    for (const m of mats) {
      if (see !== st.current.see) {
        m.transparent = see;
        m.depthWrite = !see;
        m.needsUpdate = true;
      }
      m.opacity = see ? st.current.k : 1;
    }
    st.current.see = see;
  });
  return null;
}
