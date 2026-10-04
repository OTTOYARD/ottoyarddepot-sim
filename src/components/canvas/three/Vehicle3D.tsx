import { memo, useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { toWorld, yawFromHeading2D, DECK_Y } from './coordUtils';
import { VEHICLE_GEO as GEO, PORT_GEO, CAR_W_PU } from './vehicleBody';
import { poseStore } from '@/engine/motion/poseStore';
import { useVehicleStore } from '@/store/vehicleStore';
import { useQCard } from '@/store/qCardStore';
import { useDepotStore } from '@/store/depotStore';
import { portFor } from '@/lib/ottoChargeArm/chargePort';
import { towardFor, portInVehicleFrame } from '@/lib/ottoChargeArm/depotPlacement';
import { useTierBudget } from './quality/qualityStore';
import { writeYaw, writeZero, portWorld } from './fleetMath';
import { OwnerMarkers } from './OwnerMarkers';
import type { Vehicle } from '@/engine/types';

// ── PERF: the fleet used to clone a 22.5MB GLB per car (176 meshes / 684k tris
// EACH → ~20,000 draw calls + ~79M triangles/frame at 115 cars, drawn AGAIN by
// the shadow pass). Every car then became a shared low-poly robotaxi: ONE
// geometry + material set shared fleet-wide, 7 draw calls a car (+2 for the
// charge port). At 116 cars that was still ~1,000 draw calls — a third of the
// whole frame, measured by scripts/perfHarness.mjs — and 116 React components
// each running their own useFrame.
//
// THE WHOLE FLEET IS NOW INSTANCED (phone lane, 2026-09-29): one InstancedMesh
// per car part, one useFrame for every car. The body, glass, trim, tyres, rims
// and lamps share ONE instance-matrix buffer (they ride the same transform), so
// a pose is written once per car per frame. Paint and status colour are per
// instance (instanceColor), the charge port its own three instanced meshes
// (socket, idle ring, live ring). Nine draw calls for the fleet, one of them in
// the shadow pass (only the body casts, as before), however many cars.
//
// What each car LOOKS like did not change: same geometry, same materials, same
// paint pick, same port position — the transforms are written from the same
// poseStore pose through the same toWorld / yawFromHeading2D.

// Realistic fleet paint mix (weights ≈ real-world car-color distribution),
// picked stably per vehicle id. Ops color-coding stays on the 2D dots/badges.
const PAINTS: [string, number][] = [
  ['#e9eaec', 28], ['#101216', 20], ['#c4c8cd', 14], ['#6d7178', 12],
  ['#1b3a6b', 9], ['#7a1622', 8], ['#0e6f63', 5], ['#2e4a31', 4],
];
const PAINT_TOTAL = PAINTS.reduce((n, p) => n + p[1], 0);
function hash(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h;
}
function paintFor(id: string): string {
  let r = hash(id) % PAINT_TOTAL;
  for (const [c, w] of PAINTS) { if (r < w) return c; r -= w; }
  return PAINTS[0][0];
}
// Exterior status lighting (vehicleBody's beltline strips + pod band): lit only
// while the car is being WORKED ON; a car driving, queued or parked shows none,
// as a real one would not.
const STATUS_LIGHT: Record<string, string> = {
  charging: '#00d2c0',
  washing: '#2f8cff',
  detailing: '#2f8cff',
  maintenance: '#ff9a1f',
};

const MAT = {
  glass: new THREE.MeshStandardMaterial({ color: '#0d1418', roughness: 0.10, metalness: 0.25 }),
  // One dark trim material for cladding AND sensor pod. The viewer gave them
  // slightly different roughness; at depot camera range that difference is
  // invisible and it costs a whole extra draw call per car to keep.
  trim: new THREE.MeshStandardMaterial({ color: '#171b21', roughness: 0.55, metalness: 0.45 }),
  tyre: new THREE.MeshStandardMaterial({ color: '#0b0d10', roughness: 0.92 }),
  rim: new THREE.MeshStandardMaterial({ color: '#6a7280', roughness: 0.3, metalness: 0.9 }),
  portSocket: new THREE.MeshStandardMaterial({ color: '#3a4048', roughness: 0.35, metalness: 0.9 }),
  // Idle vs live: the ring is a fixture, so it is dimly lit at rest and bright
  // while current is flowing. Two shared materials, not one per vehicle.
  portRing: new THREE.MeshStandardMaterial({
    color: '#00e5ff', emissive: '#00e5ff', emissiveIntensity: 0.6, roughness: 1, metalness: 0, toneMapped: false,
  }),
  portRingLive: new THREE.MeshStandardMaterial({
    color: '#00e5ff', emissive: '#00e5ff', emissiveIntensity: 2.2, roughness: 1, metalness: 0, toneMapped: false,
  }),
  // Head / tail lamps: unlit, coloured per vertex (white nose, red tail), over
  // 1.0 so the bloom pass catches them. Coplanar with the bevelled end face by
  // design (see vehicleBody), so they are pulled forward in depth to win.
  lamps: new THREE.MeshBasicMaterial({
    vertexColors: true, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
  }),
  // Paint is per car through instanceColor, which multiplies the material's
  // (white) base colour: exactly the colour a per-paint material used to carry.
  // Automotive paint is a pigment coat under a clear coat: the clear coat is the
  // sharp sky reflection a car body reads by, the base the soft colour under it.
  // Low tier drops the clear coat (a second specular lobe per pixel).
  paint: new THREE.MeshPhysicalMaterial({
    color: '#ffffff', roughness: 0.42, metalness: 0.45, clearcoat: 1, clearcoatRoughness: 0.06,
  }),
  paintLite: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.38, metalness: 0.45 }),
  // Unlit status strips: colour per car through instanceColor (x1.8, over 1.0
  // so the bloom pass catches them), as the per-colour materials did.
  status: new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }),
};

/**
 * Which flank this vehicle presents its charge port on.
 *
 * chargePort.ts models the vehicle as ARRIVING CORRECTLY ORIENTED — a
 * pedestal-mounted arm cannot serve the far flank, so an AV picks its approach
 * so the inlet presents to the charger, the way a driver picks a pump side.
 * That makes the port side a property of the ASSIGNED STALL, not of the car:
 * the pedestal sits on the car's -toward flank, so the port does too.
 *
 * Away from a charging stall there is no pedestal to present to, so the side
 * falls back to a stable per-vehicle choice rather than flipping about.
 */
function portSideFor(id: string, stallToward: 1 | -1 | 0): 1 | -1 {
  if (stallToward !== 0) return (-stallToward) as 1 | -1;
  return hash(id) % 2 === 0 ? 1 : -1;
}

// Vehicles face their direction of travel while moving (one-way circulation),
// then settle to their stall's site-plan angle when parked.

/** Per-car data that changes with the roster, not per frame. */
interface CarRow {
  id: string;
  paint: THREE.Color;
  status: THREE.Color | null;
  port: { pos: [number, number, number]; yaw: number };
  live: boolean;
  /** Initial mount position (plan), used until the driver publishes a pose. */
  plan: { x: number; y: number };
}

function matrixBuffer(capacity: number): THREE.InstancedBufferAttribute {
  const b = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 16), 16);
  b.setUsage(THREE.DynamicDrawUsage);
  return b;
}

function makeFleet(capacity: number) {
  const carM = matrixBuffer(capacity);
  const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, m: THREE.InstancedBufferAttribute) => {
    const x = new THREE.InstancedMesh(geo, mat, capacity);
    x.instanceMatrix = m;
    // the fleet spans the lot; per-instance culling is not what InstancedMesh does
    x.frustumCulled = false;
    x.count = 0;
    return x;
  };
  const body = mesh(GEO.body, MAT.paint, carM);
  body.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  body.castShadow = true; // the ONLY shadow caster on the car (shadow pass stays cheap)
  const status = mesh(GEO.status, MAT.status, matrixBuffer(capacity));
  status.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  return {
    capacity,
    carM,
    body,
    parts: [
      body,
      mesh(GEO.glass, MAT.glass, carM),
      mesh(GEO.trim, MAT.trim, carM),
      mesh(GEO.tyres, MAT.tyre, carM),
      mesh(GEO.rims, MAT.rim, carM),
      mesh(GEO.lamps, MAT.lamps, carM),
    ],
    status,
    socket: mesh(PORT_GEO.socket, MAT.portSocket, matrixBuffer(capacity)),
    ring: mesh(PORT_GEO.ring, MAT.portRing, matrixBuffer(capacity)),
    ringLive: mesh(PORT_GEO.ring, MAT.portRingLive, matrixBuffer(capacity)),
  };
}
type Fleet = ReturnType<typeof makeFleet>;
const allMeshes = (f: Fleet) => [...f.parts, f.status, f.socket, f.ring, f.ringLive];

/** Last pose drawn per car, so a car the driver stops publishing holds still. */
interface Drawn { x: number; z: number; yaw: number }

export function VehicleFleet({ vehicles }: { vehicles: Vehicle[] }) {
  const budget = useTierBudget();
  const setHovered = useVehicleStore((s) => s.setHoveredVehicle);

  // Pedestal side of each car's stall, keyed by stall id, 0 when not a charger.
  // A string, so the fleet recomputes only when a charger assignment's side flips.
  const stallsKey = useDepotStore((s) =>
    s.stalls.filter((st) => st.type === 'dcfc' || st.type === 'l2').map((st) => `${st.id}:${towardFor(st.position.x)}`).join('|'));
  const towardOf = useMemo(
    () => new Map(stallsKey ? stallsKey.split('|').map((kv) => { const i = kv.lastIndexOf(':'); return [kv.slice(0, i), Number(kv.slice(i + 1)) as 1 | -1]; }) : []),
    [stallsKey],
  );

  const rows = useMemo<CarRow[]>(() => vehicles.map((v) => {
    const stallToward = (v.assignedStall ? towardOf.get(v.assignedStall) : undefined) ?? 0;
    const p = portFor(v.id, v.oem);
    const side = portSideFor(v.id, stallToward);
    const pv = portInVehicleFrame(p.along, p.height, CAR_W_PU / 2, side);
    const light = STATUS_LIGHT[v.status];
    return {
      id: v.id,
      paint: new THREE.Color(paintFor(v.id)),
      status: light ? new THREE.Color(light).multiplyScalar(1.8) : null,
      // The socket is authored with its normal on +X; on the -X flank the whole
      // group turns about Y so the recess still sinks INTO the bodywork.
      port: { pos: [pv.x, pv.y, pv.z], yaw: side > 0 ? 0 : Math.PI },
      live: v.status === 'charging',
      plan: v.position,
    };
  }), [vehicles, towardOf]);

  // Capacity grows in steps of 64 so a car arriving never rebuilds the buffers.
  const capacity = Math.max(64, Math.ceil(rows.length / 64) * 64);
  const fleet = useMemo(() => makeFleet(capacity), [capacity]);
  useEffect(() => () => { for (const m of allMeshes(fleet)) m.dispose(); }, [fleet]);

  useEffect(() => { fleet.body.material = budget.clearcoat ? MAT.paint : MAT.paintLite; }, [fleet, budget.clearcoat]);

  // colours change with the roster, not per frame
  useEffect(() => {
    const n = rows.length;
    const pc = fleet.body.instanceColor!.array as Float32Array;
    const sc = fleet.status.instanceColor!.array as Float32Array;
    rows.forEach((r, i) => {
      r.paint.toArray(pc, i * 3);
      (r.status ?? BLACK).toArray(sc, i * 3);
    });
    fleet.body.instanceColor!.needsUpdate = true;
    fleet.status.instanceColor!.needsUpdate = true;
    for (const m of allMeshes(fleet)) m.count = n;
  }, [fleet, rows]);

  const drawn = useRef(new Map<string, Drawn>());
  const portScratch = useRef({ x: 0, y: 0, z: 0, yaw: 0 }).current;

  useFrame(() => {
    const car = fleet.carM.array as Float32Array;
    const st = fleet.status.instanceMatrix.array as Float32Array;
    const so = fleet.socket.instanceMatrix.array as Float32Array;
    const ri = fleet.ring.instanceMatrix.array as Float32Array;
    const rl = fleet.ringLive.instanceMatrix.array as Float32Array;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      let d = drawn.current.get(r.id);
      // Faithful render of the physics pose: the driver already integrates a smooth
      // 60fps kinematic pose, so it is set DIRECTLY — no lerp (lerp was the slide) —
      // facing by the TRUE steering heading, not a guess from the frame delta.
      // Yaw comes from coordUtils so it can never again disagree with toWorld's
      // signs (the old inline atan2 rendered every east/west car backwards).
      const lp = poseStore.get(r.id);
      if (lp) {
        const [wx, , wz] = toWorld({ x: lp.x, y: lp.y });
        if (!d) { d = { x: wx, z: wz, yaw: 0 }; drawn.current.set(r.id, d); }
        d.x = wx; d.z = wz; d.yaw = yawFromHeading2D(lp.heading);
      } else if (!d) {
        const [tx, , tz] = toWorld(r.plan);
        d = { x: tx, z: tz, yaw: 0 };
        drawn.current.set(r.id, d);
      }
      // Tyres rest ON the deck, the same grade the OTTO-CHARGE ARM mounts off.
      writeYaw(car, i, d.x, DECK_Y, d.z, d.yaw);
      if (r.status) writeYaw(st, i, d.x, DECK_Y, d.z, d.yaw); else writeZero(st, i);
      // Charge port — the inlet the OTTO-CHARGE ARM actually mates with, positioned
      // from portFor() through the same resolver the arm solves against, so what
      // the robot plugs into is what you can see.
      const pw = portWorld(d.x, d.z, d.yaw, r.port.pos, r.port.yaw, portScratch);
      writeYaw(so, i, pw.x, pw.y, pw.z, pw.yaw);
      if (r.live) { writeYaw(rl, i, pw.x, pw.y, pw.z, pw.yaw); writeZero(ri, i); }
      else { writeYaw(ri, i, pw.x, pw.y, pw.z, pw.yaw); writeZero(rl, i); }
    }
    fleet.carM.needsUpdate = true;
    fleet.status.instanceMatrix.needsUpdate = true;
    fleet.socket.instanceMatrix.needsUpdate = true;
    fleet.ring.instanceMatrix.needsUpdate = true;
    fleet.ringLive.instanceMatrix.needsUpdate = true;
  });

  // forget cars that left the roster
  useEffect(() => {
    const live = new Set(rows.map((r) => r.id));
    for (const id of drawn.current.keys()) if (!live.has(id)) drawn.current.delete(id);
  }, [rows]);

  const idAt = (i: number | undefined) => (i !== undefined && i < rows.length ? rows[i].id : null);

  return (
    <group name="fleet">
      {/* the body carries the pointer events: hovering a car shows its badge */}
      <primitive
        object={fleet.body}
        onPointerMove={(e: { stopPropagation: () => void; instanceId?: number }) => {
          e.stopPropagation();
          const id = idAt(e.instanceId);
          if (id !== useVehicleStore.getState().hoveredVehicleId) setHovered(id);
        }}
        onPointerOut={() => setHovered(null)}
      />
      {fleet.parts.slice(1).map((m, i) => <primitive key={i} object={m} />)}
      <primitive object={fleet.status} />
      <primitive object={fleet.socket} />
      <primitive object={fleet.ring} />
      <primitive object={fleet.ringLive} />
      <HoverBadge drawn={drawn.current} />
      {/* a violet badge over each car its owner's agent set something on (one draw call, read from the same poses) */}
      <OwnerMarkers drawn={drawn.current} />
    </group>
  );
}

const BLACK = new THREE.Color(0, 0, 0);

/**
 * SoC badge — only on the hovered car. One <Html>, never one per car: drei
 * re-projects every Html label to screen each frame, a huge cost at fleet size.
 */
function HoverBadge({ drawn }: { drawn: Map<string, Drawn> }) {
  const hovered = useVehicleStore((s) => s.hoveredVehicleId);
  // the open Q card already shows this car's battery, over the same spot
  const cardOpen = useQCard((s) => s.openId);
  const id = hovered && hovered !== cardOpen ? hovered : null;
  const vehicle = useVehicleStore((s) => (id ? s.vehicles.find((v) => v.id === id) : undefined));
  const grp = useRef<THREE.Group>(null);
  useFrame(() => {
    const d = id ? drawn.get(id) : undefined;
    if (grp.current && d) grp.current.position.set(d.x, 6.66, d.z);
  });
  if (!vehicle) return null;
  return (
    <group ref={grp}>
      <Badge vehicle={vehicle} />
    </group>
  );
}

const Badge = memo(function Badge({ vehicle }: { vehicle: Vehicle }) {
  return (
    <Html center>
      <div className="px-1.5 py-0.5 rounded text-[7px] font-mono bg-black/80 text-white whitespace-nowrap border border-white/10 flex items-center gap-1"
        style={{ backdropFilter: 'blur(4px)' }}>
        <div className="w-6 h-1 bg-white/20 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full"
            style={{
              width: `${vehicle.currentSoC}%`,
              backgroundColor: vehicle.currentSoC > 60 ? '#22c55e' : vehicle.currentSoC > 30 ? '#eab308' : '#ef4444',
            }}
          />
        </div>
        {Math.round(vehicle.currentSoC)}%
      </div>
    </Html>
  );
}, vehicleRenderEqual);

// The badge's memo predicate. The roster array is rebuilt on every twin poll
// (new object identities); the badge only needs to re-render when the car's
// id / status / SoC actually change (stall and OEM kept from when this gated
// the whole per-car component, where they decided the charge port).
//
// SoC IS COMPARED AT THE PRECISION IT IS DRAWN AT, and no coarser. The old
// `Math.round(soc / 5)` bucketed the roster into 5-point steps, so a hovered
// car's badge — which prints Math.round(soc) — kept re-rendering the SoC
// captured at the last bucket crossing. A car climbing 4 points while you
// watched it charge showed a completely unchanging number, which is exactly
// the "SoC never increases" report. The 5-point bucketing was a perf tactic,
// not a display choice, and it silently became the display.
//
// Exported so the SoC precision can be asserted directly — the defect it caused
// was invisible to every test in the suite because it lived in a memo predicate.
export function vehicleRenderEqual(
  a: { vehicle: Vehicle }, b: { vehicle: Vehicle },
): boolean {
  return a.vehicle.id === b.vehicle.id &&
    a.vehicle.status === b.vehicle.status &&
    a.vehicle.assignedStall === b.vehicle.assignedStall &&
    a.vehicle.oem === b.vehicle.oem &&
    Math.round(a.vehicle.currentSoC) === Math.round(b.vehicle.currentSoC);
}
