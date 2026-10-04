import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useOwnerBoardStore } from '@/store/ownerBoardStore';
import { ROOF_POD } from '@/lib/ottoChargeArm/vehicleEnvelope';
import { PLAN_UNITS_PER_METRE } from '@/lib/ottoChargeArm/cobotSpec';
import { DECK_Y } from './coordUtils';

/**
 * A small violet badge over every car its owner's agent has set something on (a charge limit, a service order, a hold;
 * otto-q-core 0608 via ownerBoardStore), so a viewer can see which cars an agent touched. Tap the car for what was set.
 *
 * It is a VIEW mark, not a world object, and it is drawn like one:
 *   - ONE draw call for the whole fleet (a THREE.Points cloud), whatever the number of cars;
 *   - a constant size on screen (sizeAttenuation off: 20 px at the default camera and in a close-up alike), so it
 *     reads from the top-down view and never balloons over a car seen from beside it;
 *   - drawn over everything (depthTest off): from the default camera, every car on a charger is under the solar canopy's
 *     PV roof, and a mark the roof hid would hide exactly the cars an agent most often changes (how full they charge).
 * Positions are written each frame into one preallocated buffer from the fleet's own last-drawn poses (`drawn`, the map
 * VehicleFleet keeps), so the badge sits on the car as it moves, with no allocation per frame.
 */

/** Just above the roof's sensor pod. */
const MARK_Y = DECK_Y + ROOF_POD.yMax * PLAN_UNITS_PER_METRE + 1.2;
/** On-screen size in CSS pixels (three scales it by the renderer's pixel ratio): the violet disc is ~14 px of it. */
const MARK_PX = 20;

/** The badge: a violet disc with a light rim and core, ringed in dark so it reads on pale concrete, white roofs and blue
 *  PV glass alike. */
function badgeTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  if (g) {
    const halo = g.createRadialGradient(32, 32, 20, 32, 32, 31);
    halo.addColorStop(0, 'rgba(12, 6, 30, 0.85)');
    halo.addColorStop(0.45, 'rgba(12, 6, 30, 0.5)');
    halo.addColorStop(1, 'rgba(12, 6, 30, 0)');
    g.fillStyle = halo;
    g.beginPath(); g.arc(32, 32, 31, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#8b5cf6';
    g.beginPath(); g.arc(32, 32, 20, 0, Math.PI * 2); g.fill();
    g.lineWidth = 4.5; g.strokeStyle = '#ede9fe'; g.stroke();
    g.fillStyle = '#f5f3ff';
    g.beginPath(); g.arc(32, 32, 5, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function OwnerMarkers({ drawn }: { drawn: ReadonlyMap<string, { x: number; z: number }> }) {
  const marked = useOwnerBoardStore((s) => s.marked);
  const ids = useMemo(() => [...marked], [marked]);
  // capacity grows in steps of 32, so a car gaining a setting rarely rebuilds the buffer
  const capacity = Math.max(32, Math.ceil(ids.length / 32) * 32);
  const points = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const pos = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3);
    pos.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', pos);
    geo.setDrawRange(0, 0);
    const mat = new THREE.PointsMaterial({
      size: MARK_PX, sizeAttenuation: false, map: badgeTexture(), transparent: true,
      depthTest: false, depthWrite: false, toneMapped: false, fog: false,
    });
    const p = new THREE.Points(geo, mat);
    p.frustumCulled = false; // the cloud spans the lot; a stale bounding sphere must not cull it
    p.renderOrder = 20;      // after the canopy glass and the rest of the transparent scene
    p.name = 'ownerMarkers';
    return p;
  }, [capacity]);
  useEffect(() => () => {
    const m = points.material as THREE.PointsMaterial;
    m.map?.dispose();
    m.dispose();
    points.geometry.dispose();
  }, [points]);

  useFrame(() => {
    const attr = points.geometry.getAttribute('position') as THREE.BufferAttribute;
    const a = attr.array as Float32Array;
    let n = 0;
    for (let i = 0; i < ids.length; i++) {
      const d = drawn.get(ids[i]);
      if (!d) continue; // not on screen: out working, or not placed yet
      a[n * 3] = d.x; a[n * 3 + 1] = MARK_Y; a[n * 3 + 2] = d.z;
      n++;
    }
    if (n === 0 && points.geometry.drawRange.count === 0) return;
    points.geometry.setDrawRange(0, n);
    attr.needsUpdate = true;
  });

  return <primitive object={points} />;
}
