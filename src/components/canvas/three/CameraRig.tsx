import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { poseStore } from '@/engine/motion/poseStore';
import { useVehicleStore } from '@/store/vehicleStore';
import { toWorld, DECK_Y } from './coordUtils';
import { useCameraFollow } from './cameraFollow';
import { aimFromMast } from './followMath';
import { useQCard } from '@/store/qCardStore';

/**
 * Touch and follow for the 3D view — camera only, it never touches the world.
 *
 * OrbitControls already gives one-finger orbit, pinch-to-zoom and two-finger
 * pan. This adds:
 *
 *   - TWIST: two fingers rotating about each other spin the view about its
 *     target (azimuth), the way a phone map turns — so two fingers orbit AND
 *     pan AND zoom, without lifting.
 *   - TAP A CAR TO FOLLOW (or click, on a desktop): the camera keeps its angle
 *     and distance and glides onto the car, then rides with it. A tap on open
 *     ground stops following. Hit-testing is by the car's pose on the deck
 *     plane with a finger-sized radius, not by exact mesh picking: at a phone's
 *     Bird Eye a car is a few pixels long.
 *
 * The followed car's position is read from poseStore — the same pose the fleet
 * is drawn at — so the camera never leads or lags the car it is showing.
 *
 * FROM THE POLE (`pole`: the live view's mast camera, src/viewer) following
 * turns the camera instead of carrying it: the lens stays on its mast and the
 * view swings onto the car and holds it, as a camera on a pole would
 * (followMath.ts). A drag, or a second finger, takes the camera back: it stops
 * following, because the pole's only gesture is turning and following is
 * turning too.
 */

const TAP_MAX_MS = 350;
const TAP_MAX_PX = 10;
/** Tap radius on the ground, in plan units, grown with camera distance. */
const pickRadius = (camDist: number) => Math.max(5, camDist * 0.045);
/** When following starts from far away, close in to this distance. */
const FOLLOW_DIST = 48;

export function CameraRig({ controls, pole = false }: {
  controls: React.RefObject<OrbitControlsImpl>;
  /** The camera is the live view's pole: it turns on its mast and does not zoom or pan. */
  pole?: boolean;
}) {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const followId = useCameraFollow((s) => s.followId);
  const glide = useRef<{ dist: number | null }>({ dist: null });
  // read by the pointer handlers and the frame loop without re-binding either
  const poleRef = useRef(pole);
  poleRef.current = pole;

  // ── tap-to-follow and two-finger twist ────────────────────────────────────
  useEffect(() => {
    const el = gl.domElement;
    const pts = new Map<number, { x: number; y: number }>();
    let tap: { id: number; x: number; y: number; t: number } | null = null;
    let twist: number | null = null;
    const ray = new THREE.Raycaster();
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -DECK_Y);
    const hit = new THREE.Vector3();
    const ndc = new THREE.Vector2();
    // from the pole, a gesture on the camera takes it back from the car it is following
    const letGo = () => {
      if (poleRef.current && useCameraFollow.getState().followId) useCameraFollow.getState().setFollow(null);
    };

    const pickCar = (clientX: number, clientY: number): string | null | undefined => {
      const r = el.getBoundingClientRect();
      ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      if (!ray.ray.intersectPlane(plane, hit)) return undefined;
      const radius = pickRadius(camera.position.distanceTo(hit));
      let best: string | null = null;
      let bestD = radius;
      for (const v of useVehicleStore.getState().vehicles) {
        const p = poseStore.get(v.id) ?? v.position;
        const [wx, , wz] = toWorld(p);
        const d = Math.hypot(wx - hit.x, wz - hit.z);
        if (d < bestD) { bestD = d; best = v.id; }
      }
      return best;
    };

    const down = (e: PointerEvent) => {
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      tap = pts.size === 1 ? { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() } : null;
      twist = null;
      if (pts.size > 1) letGo();
    };
    const move = (e: PointerEvent) => {
      const p = pts.get(e.pointerId);
      if (!p) return;
      p.x = e.clientX; p.y = e.clientY;
      if (tap && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > TAP_MAX_PX) { tap = null; letGo(); }
      if (pts.size !== 2 || !controls.current) return;
      const [a, b] = [...pts.values()];
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      if (twist !== null) {
        let d = ang - twist;
        if (d > Math.PI) d -= 2 * Math.PI;
        if (d < -Math.PI) d += 2 * Math.PI;
        // rotate the camera about the target's vertical axis; OrbitControls
        // re-reads the camera position on its next update
        const c = controls.current;
        const off = camera.position.clone().sub(c.target).applyAxisAngle(THREE.Object3D.DEFAULT_UP, d);
        camera.position.copy(c.target).add(off);
      }
      twist = ang;
    };
    const up = (e: PointerEvent) => {
      pts.delete(e.pointerId);
      if (pts.size < 2) twist = null;
      const t = tap;
      tap = null;
      if (!t || t.id !== e.pointerId || e.button > 0) return;
      if (performance.now() - t.t > TAP_MAX_MS) return;
      const id = pickCar(e.clientX, e.clientY);
      if (id === undefined) return;
      const cur = useCameraFollow.getState().followId;
      if (id !== cur) useCameraFollow.getState().setFollow(id);
      // a tap on open ground stops following; a tap on the followed car keeps it.
      // The same tap opens that car's Q card, or closes the card on open ground.
      if (id) useQCard.getState().open(id);
      else useQCard.getState().close();
    };
    const cancel = (e: PointerEvent) => { pts.delete(e.pointerId); tap = null; twist = null; };

    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', cancel);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', cancel);
    };
  }, [gl, camera, controls]);

  // a car that leaves the roster is no longer followed
  const present = useVehicleStore((s) => (followId ? s.vehicles.some((v) => v.id === followId) : true));
  useEffect(() => { if (!present) useCameraFollow.getState().setFollow(null); }, [present]);

  // on a new follow, close in if the camera is far out (not from the pole: it turns, it does not move)
  useEffect(() => {
    const c = controls.current;
    glide.current.dist = followId && c && !poleRef.current ? Math.min(camera.position.distanceTo(c.target), FOLLOW_DIST) : null;
  }, [followId, camera, controls]);

  // ── follow: runs before OrbitControls' own update (priority -1) ───────────
  const tmp = useRef(new THREE.Vector3());
  useFrame((_s, dt) => {
    const c = controls.current;
    if (!followId || !c) return;
    const p = poseStore.get(followId);
    if (!p) return;
    const [wx, , wz] = toWorld(p, 0);
    if (poleRef.current) {
      // from the pole: the lens stays put and the view turns onto the car
      aimFromMast(camera.position, c.target, tmp.current.set(wx, DECK_Y + 1.5, wz), 1 - Math.exp(-Math.min(dt, 0.1) * 6), c.target);
      return;
    }
    const d = tmp.current.set(wx, DECK_Y + 1.5, wz).sub(c.target);
    // glide on, then ride exactly: the lerp only matters while catching up
    const k = d.lengthSq() > 0.25 ? 1 - Math.exp(-Math.min(dt, 0.1) * 6) : 1;
    d.multiplyScalar(k);
    c.target.add(d);
    camera.position.add(d);
    const want = glide.current.dist;
    if (want !== null) {
      const off = camera.position.clone().sub(c.target);
      const len = off.length();
      if (Math.abs(len - want) < 0.5) glide.current.dist = null;
      else camera.position.copy(c.target).add(off.setLength(len + (want - len) * (1 - Math.exp(-Math.min(dt, 0.1) * 4))));
    }
  }, -2);

  return null;
}
