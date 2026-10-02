import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { poseStore } from '@/engine/motion/poseStore';
import { useVehicleStore } from '@/store/vehicleStore';
import { useQCard } from '@/store/qCardStore';
import { toWorld, DECK_Y } from './coordUtils';

/**
 * Where the open Q card's car is on screen, in client (viewport) pixels — written each frame by
 * <QCardProjector/> inside the Canvas, read by the card's own rAF outside it (AnchoredQCard). Camera only: the car's
 * point is the poseStore pose the fleet is drawn at, so the card never leads or lags the car it is over.
 */
const anchor = { id: null as string | null, x: 0, y: 0, r: 0, ok: false };

/** The car's middle, about half its height off the deck. */
const MID_Y = DECK_Y + 1.5;
/** How far round the middle the card keeps clear, in plan units: half the 9.8u body, plus a margin. */
const CLEAR_U = 6.5;

export function QCardProjector() {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const v = useRef(new THREE.Vector3()).current;
  const e = useRef(new THREE.Vector3()).current;

  // Dev only: scripts/qCardShots.mjs taps a car where it is drawn (client px of its deck point), so the screenshots
  // exercise the real tap path rather than opening the card by hand. Stripped from builds.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as { __carScreenPoint?: (id: string) => { x: number; y: number } | null };
    w.__carScreenPoint = (id) => {
      const p = poseStore.get(id);
      if (!p) return null;
      const [wx, , wz] = toWorld(p);
      const q = new THREE.Vector3(wx, DECK_Y, wz).project(camera);
      const r = gl.domElement.getBoundingClientRect();
      return { x: r.left + ((q.x + 1) / 2) * r.width, y: r.top + ((1 - q.y) / 2) * r.height };
    };
    return () => { delete w.__carScreenPoint; };
  }, [camera, gl]);

  useFrame(() => {
    const id = useQCard.getState().openId;
    anchor.id = id;
    anchor.ok = false;
    if (!id) return;
    const p = poseStore.get(id) ?? useVehicleStore.getState().vehicles.find((x) => x.id === id)?.position;
    if (!p) return;
    const [wx, , wz] = toWorld(p);
    const r = gl.domElement.getBoundingClientRect();
    const px = (p3: THREE.Vector3) => ({ x: r.left + ((p3.x + 1) / 2) * r.width, y: r.top + ((1 - p3.y) / 2) * r.height });
    v.set(wx, MID_Y, wz).project(camera);
    if (v.z > 1 || v.z < -1) return; // behind the camera
    const c = px(v);
    // the car's size on screen: its middle pushed CLEAR_U along the camera's right and up axes
    let rad = 0;
    for (const col of [0, 1]) {
      e.setFromMatrixColumn(camera.matrixWorld, col).multiplyScalar(CLEAR_U).add(v.set(wx, MID_Y, wz)).project(camera);
      const q = px(e);
      rad = Math.max(rad, Math.hypot(q.x - c.x, q.y - c.y));
    }
    anchor.x = c.x;
    anchor.y = c.y;
    anchor.r = rad;
    anchor.ok = true;
  });
  return null;
}

/** For AnchoredQCard: the open car's projected point, or null when it is not on screen. */
export function qCardAnchor3D(id: string): { x: number; y: number; r: number } | null {
  return anchor.ok && anchor.id === id ? { x: anchor.x, y: anchor.y, r: anchor.r } : null;
}
