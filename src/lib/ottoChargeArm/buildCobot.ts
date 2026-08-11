/**
 * OTTO-CHARGE ARM — procedural geometry builder.
 *
 * ONE source of truth. This module is imported by:
 *   - scripts/exportGlb.mts   (headless Node -> ottoyard-otto-charge-arm.glb)
 *   - the OTTOYARD depot renderer's ChargingArm component
 *   - the standalone viewer page
 *
 * It depends on nothing but `three`, so it runs in Node and in the browser.
 *
 * UNITS: metres (see cobotSpec.ts). Convert at the point of insertion.
 *
 * FRAME CONVENTION
 *   +Y is up. The arm's "forward" (the direction it reaches when every joint is
 *   at zero) is +Z. Mount the root so +Z points at the vehicle.
 *
 * JOINT CONVENTION
 *   Every link extends along its parent joint's local +Y. Pitch joints rotate
 *   about local X; the base yaws about Y; the wrist rolls about Y; the tool
 *   rolls about Z. At the all-zero pose the arm stands straight up, which is
 *   also the stowed pose. This is what makes the analytic IK in cobotIK.ts a
 *   plain two-link planar solve.
 */

import * as THREE from 'three';
import { OTTO_CHARGE_ARM, type CobotSpec, TCP_NODE_NAME } from './cobotSpec';

// ---------------------------------------------------------------- palette ---
// OTTOYARD brand: near-black #06070A, signal red #C8102E. Aluminium is kept
// slightly warm so it separates from the depot's cool concrete under the
// scene's ACES tone mapping.
export const COBOT_COLORS = {
  aluminium: 0xd8dade,
  aluminiumDark: 0x9aa0a8,
  charcoal: 0x1c1f24,
  nearBlack: 0x06070a,
  red: 0xc8102e,
  cable: 0x14161a,
  lens: 0x0b1418,
};

export interface CobotMaterials {
  alu: THREE.MeshStandardMaterial;
  aluDark: THREE.MeshStandardMaterial;
  charcoal: THREE.MeshStandardMaterial;
  rubber: THREE.MeshStandardMaterial;
  accent: THREE.MeshStandardMaterial;
  status: THREE.MeshStandardMaterial;
  lens: THREE.MeshStandardMaterial;
}

export function makeCobotMaterials(): CobotMaterials {
  return {
    alu: new THREE.MeshStandardMaterial({
      name: 'OTTO_Aluminium', color: COBOT_COLORS.aluminium, metalness: 0.92, roughness: 0.26,
    }),
    aluDark: new THREE.MeshStandardMaterial({
      name: 'OTTO_AluminiumDark', color: COBOT_COLORS.aluminiumDark, metalness: 0.9, roughness: 0.34,
    }),
    charcoal: new THREE.MeshStandardMaterial({
      name: 'OTTO_Charcoal', color: COBOT_COLORS.charcoal, metalness: 0.72, roughness: 0.42,
    }),
    rubber: new THREE.MeshStandardMaterial({
      name: 'OTTO_Rubber', color: COBOT_COLORS.cable, metalness: 0.05, roughness: 0.86,
    }),
    accent: new THREE.MeshStandardMaterial({
      name: 'OTTO_Accent', color: COBOT_COLORS.red, metalness: 0.35, roughness: 0.45,
      emissive: new THREE.Color(COBOT_COLORS.red), emissiveIntensity: 0.12,
    }),
    // Status ring — recoloured at runtime by state (stowed/moving/mated/fault).
    status: new THREE.MeshStandardMaterial({
      name: 'OTTO_Status', color: 0x00e5ff, metalness: 0.1, roughness: 0.35,
      emissive: new THREE.Color(0x00e5ff), emissiveIntensity: 1.4,
    }),
    lens: new THREE.MeshStandardMaterial({
      name: 'OTTO_Lens', color: COBOT_COLORS.lens, metalness: 0.2, roughness: 0.08,
    }),
  };
}

// ------------------------------------------------------------- primitives ---

/**
 * Detail level. 'studio' is the full part, for the .glb and the standalone
 * viewer. 'depot' drops fasteners, ribs, connector pins and sensor glass —
 * sub-centimetre features that are invisible past a couple of metres but which
 * would otherwise multiply by ten arms in a scene that is already heavy.
 */
export type CobotLOD = 'studio' | 'depot';
let LOD: CobotLOD = 'studio';
const detailed = () => LOD === 'studio';

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, name: string): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.name = name;
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** A ring of bolt heads on a joint face — cheap detail that reads as machined. */
function boltCircle(
  radius: number, count: number, boltR: number, boltH: number, mat: THREE.Material, name: string,
): THREE.Group {
  const g = new THREE.Group();
  g.name = name;
  if (!detailed()) return g;
  const geo = new THREE.CylinderGeometry(boltR, boltR, boltH, 6);
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const b = mesh(geo, mat, `${name}_${i}`);
    b.position.set(Math.cos(a) * radius, 0, Math.sin(a) * radius);
    b.castShadow = false; // too small to matter, saves shadow cost
    g.add(b);
  }
  return g;
}

/**
 * A cast link housing: a capsule spine with a slight taper, plus two cooling
 * ribs. Extends from y=0 to y=length along local +Y.
 */
function linkBody(
  length: number, rTop: number, rBot: number, mats: CobotMaterials, name: string,
): THREE.Group {
  const g = new THREE.Group();
  g.name = name;

  const spineLen = Math.max(0.001, length - rBot - rTop);
  const spine = mesh(
    new THREE.CylinderGeometry(rTop, rBot, spineLen, 20, 1, false),
    mats.alu, `${name}_Spine`,
  );
  spine.position.y = rBot + spineLen / 2;
  g.add(spine);

  // rounded shoulders top and bottom so the link reads as cast, not tubular
  const capBot = mesh(new THREE.SphereGeometry(rBot, 20, 12), mats.alu, `${name}_CapLower`);
  capBot.position.y = rBot;
  g.add(capBot);
  const capTop = mesh(new THREE.SphereGeometry(rTop, 20, 12), mats.alu, `${name}_CapUpper`);
  capTop.position.y = length - rTop;
  g.add(capTop);

  // two cooling ribs
  for (let i = 0; detailed() && i < 2; i++) {
    const t = 0.34 + i * 0.3;
    const rHere = THREE.MathUtils.lerp(rBot, rTop, t);
    const rib = mesh(
      new THREE.TorusGeometry(rHere * 1.03, rHere * 0.10, 6, 20),
      mats.aluDark, `${name}_Rib${i}`,
    );
    rib.rotation.x = Math.PI / 2;
    rib.position.y = length * t;
    rib.castShadow = false;
    g.add(rib);
  }

  // brand stripe
  const stripe = mesh(
    new THREE.TorusGeometry(rBot * 1.04, rBot * 0.055, 6, 20),
    mats.accent, `${name}_Stripe`,
  );
  stripe.rotation.x = Math.PI / 2;
  stripe.position.y = length * 0.16;
  stripe.castShadow = false;
  g.add(stripe);

  return g;
}

/** A pitch-joint housing: a drum whose axis lies along local X. */
function pitchJointHousing(
  r: number, width: number, mats: CobotMaterials, name: string, withStatusRing = false,
): THREE.Group {
  const g = new THREE.Group();
  g.name = name;

  const drum = mesh(new THREE.CylinderGeometry(r, r, width, 24), mats.charcoal, `${name}_Drum`);
  drum.rotation.z = Math.PI / 2; // axis -> X
  g.add(drum);

  // end caps in aluminium so the joint reads as a separate machined part
  for (const s of [-1, 1]) {
    const cap = mesh(new THREE.CylinderGeometry(r * 0.82, r * 0.82, width * 0.16, 24), mats.alu, `${name}_Cap${s > 0 ? 'R' : 'L'}`);
    cap.rotation.z = Math.PI / 2;
    cap.position.x = s * (width / 2 + width * 0.06);
    g.add(cap);

    const bolts = boltCircle(r * 0.55, 8, r * 0.055, width * 0.2, mats.aluDark, `${name}_Bolts${s > 0 ? 'R' : 'L'}`);
    bolts.rotation.z = Math.PI / 2;
    bolts.position.x = s * (width / 2 + width * 0.1);
    g.add(bolts);
  }

  if (withStatusRing) {
    for (const s of [-1, 1]) {
      const ring = mesh(new THREE.TorusGeometry(r * 0.94, r * 0.07, 8, 28), mats.status, `${name}_StatusRing${s > 0 ? 'R' : 'L'}`);
      ring.rotation.y = Math.PI / 2;
      ring.position.x = s * (width / 2 + 0.002);
      ring.castShadow = false;
      g.add(ring);
    }
  }

  return g;
}

/**
 * Distance from the flange face to the connector tip, in the units the parts
 * below are authored in: the pin cluster at y=0.196 plus its 0.028 m length.
 *
 * This number exists so the drawn connector can be normalised against
 * `spec.tool`, which is DEFINED as "tool flange face -> connector tip".
 */
const AUTHORED_TOOL_LENGTH = 0.196 + 0.028 / 2;

/**
 * The end effector: a CCS1/NACS-class connector body on a compliant flange,
 * flanked by the stereo/ToF sensor pod that real automatic-connection devices
 * use to find the inlet.
 *
 * Connector dimensions are deliberately conservative: a CCS1 handle is roughly
 * 0.09 m across the body and ~0.22 m long including the cable gland, which is
 * what `tool` in the spec accounts for.
 *
 * ══════════════════ THE CONNECTOR DID NOT REACH THE PORT ════════════════════
 * The parts below are authored at fixed metres, sized for a scale-1.0 arm, and
 * they reach 0.210 m past the flange. `spec.tool` scales with ARM_SCALE. At
 * ARM_SCALE 1.5 the TCP therefore sat 0.330 m past the flange while the drawn
 * connector stopped at 0.210 — so the IK put the WORKING POINT exactly on the
 * charge port, every existing test agreed it was exact to 1e-9, and on screen
 * the connector hung 0.120 m short of the inlet it was supposedly plugged into.
 * MEASURED, on origin/main: 0.1200 m at full mate.
 *
 * That is the renderer's recurring sin — claiming more than it delivers — and
 * no assertion caught it because every assertion was about the TCP, which is an
 * empty. The parts are now scaled so the drawn tip IS the TCP, and
 * armClearance.test.ts checks the MESH against the port rather than the empty.
 *
 * The tip is taken as the PIN CLUSTER, which is what actually enters an inlet.
 * 'depot' LOD drops the pins, so at that detail the connector's nose face sits
 * 26 mm off the inlet mouth at full mate — a coupler shroud resting on the
 * socket, which is what one looks like, and 26 mm is 0.05 plan units on screen.
 */
function endEffector(spec: CobotSpec, mats: CobotMaterials): THREE.Group {
  const outer = new THREE.Group();
  outer.name = 'EndEffector';

  // Everything cosmetic hangs off `g`, which is scaled so the connector tip
  // lands at spec.tool. The TCP marker is parented to `outer` instead, because
  // it defines the working point and must not be moved by the cosmetics.
  const g = new THREE.Group();
  g.name = 'EndEffector_Parts';
  g.scale.setScalar(spec.tool / AUTHORED_TOOL_LENGTH);
  outer.add(g);

  // compliant flange — the sprung plate that absorbs residual misalignment
  const flange = mesh(new THREE.CylinderGeometry(0.062, 0.062, 0.018, 20), mats.alu, 'Tool_Flange');
  flange.position.y = 0.009;
  g.add(flange);
  const flangeBolts = boltCircle(0.044, 6, 0.005, 0.022, mats.aluDark, 'Tool_FlangeBolts');
  flangeBolts.position.y = 0.014;
  g.add(flangeBolts);

  // three compliance posts (visible springs on real ACD end effectors)
  for (let i = 0; detailed() && i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const post = mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.035, 8), mats.aluDark, `Tool_CompliancePost${i}`);
    post.position.set(Math.cos(a) * 0.042, 0.036, Math.sin(a) * 0.042);
    post.castShadow = false;
    g.add(post);
  }

  // connector body
  const body = mesh(new THREE.CylinderGeometry(0.047, 0.052, 0.086, 22), mats.charcoal, 'Connector_Body');
  body.position.y = 0.096;
  g.add(body);

  // grip shroud
  const shroud = mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.030, 22), mats.rubber, 'Connector_Grip');
  shroud.position.y = 0.072;
  shroud.castShadow = false;
  g.add(shroud);

  // coupler nose — the part that enters the inlet
  const nose = mesh(new THREE.CylinderGeometry(0.038, 0.044, 0.052, 22), mats.aluDark, 'Connector_Nose');
  nose.position.y = 0.163;
  g.add(nose);

  // pin cluster (reads as a real inlet face at close range)
  const pinGeo = new THREE.CylinderGeometry(0.0055, 0.0055, 0.028, 8);
  const pins: [number, number][] = [
    [0.0, 0.019], [-0.016, 0.010], [0.016, 0.010],
    [-0.016, -0.008], [0.016, -0.008], [0.0, -0.018],
  ];
  (detailed() ? pins : []).forEach(([px, pz], i) => {
    const p = mesh(pinGeo, mats.aluDark, `Connector_Pin${i}`);
    p.position.set(px, 0.196, pz);
    p.castShadow = false;
    g.add(p);
  });

  // latch collar — animates on mate in the app; static in the .glb
  const latch = new THREE.Group();
  latch.name = 'Connector_Latch';
  const latchRing = mesh(new THREE.TorusGeometry(0.049, 0.008, 8, 22), mats.accent, 'Connector_LatchRing');
  latchRing.rotation.x = Math.PI / 2;
  latch.add(latchRing);
  latch.position.y = 0.138;
  g.add(latch);

  // sensor pod: stereo pair + ToF, the thing that actually finds the inlet
  const pod = new THREE.Group();
  pod.name = 'Sensor_Pod';
  const podBody = mesh(new THREE.BoxGeometry(0.084, 0.030, 0.034), mats.charcoal, 'Sensor_PodBody');
  pod.add(podBody);
  for (const s of (detailed() ? [-1, 1] : [])) {
    const lens = mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.006, 14), mats.lens, `Sensor_Lens${s > 0 ? 'R' : 'L'}`);
    lens.rotation.x = Math.PI / 2;
    lens.position.set(s * 0.028, 0, 0.019);
    lens.castShadow = false;
    pod.add(lens);
  }
  const tof = mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.006, 12), mats.lens, 'Sensor_ToF');
  tof.rotation.x = Math.PI / 2;
  tof.position.set(0, 0, 0.019);
  tof.castShadow = false;
  pod.add(tof);
  // pod rides above the connector, looking along the insertion axis
  pod.position.set(0, 0.104, 0.062);
  pod.rotation.x = Math.PI / 2;
  g.add(pod);

  // work light so the mate is legible in the depot's night lighting
  const lamp = mesh(new THREE.CylinderGeometry(0.011, 0.013, 0.010, 14), mats.status, 'Tool_WorkLight');
  lamp.rotation.x = Math.PI / 2;
  lamp.position.set(0, 0.062, 0.056);
  lamp.castShadow = false;
  g.add(lamp);

  // TCP marker: an empty at the connector tip. This is the node the IK drives
  // onto the vehicle's charge port. Exported into the .glb so any consumer can
  // find the working point without guessing.
  //
  // Parented to the UNSCALED outer group on purpose: the working point is the
  // spec, the meshes are what have to agree with it.
  const tcp = new THREE.Object3D();
  tcp.name = TCP_NODE_NAME;
  tcp.position.y = spec.tool;
  outer.add(tcp);

  return outer;
}

export interface CobotHandles {
  root: THREE.Group;
  j1: THREE.Group;
  j2: THREE.Group;
  j3: THREE.Group;
  j4: THREE.Group;
  j5: THREE.Group;
  j6: THREE.Group;
  tcp: THREE.Object3D;
  latch: THREE.Group;
  statusMaterial: THREE.MeshStandardMaterial;
  materials: CobotMaterials;
}

/**
 * Build the arm. Returns the root group plus direct handles on every joint so
 * a caller can pose it without a name lookup every frame.
 *
 * @param opts.withPlinth  include the pedestal-mounted plinth + cable gland.
 *                         True for the standalone .glb (so it reads as a
 *                         complete product); the depot renderer also uses it,
 *                         since the plinth is what bolts to the charger.
 */
export function buildCobot(
  spec: CobotSpec = OTTO_CHARGE_ARM,
  opts: { withPlinth?: boolean; materials?: CobotMaterials; lod?: CobotLOD } = {},
): CobotHandles {
  const withPlinth = opts.withPlinth ?? true;
  const mats = opts.materials ?? makeCobotMaterials();
  LOD = opts.lod ?? 'studio';

  const root = new THREE.Group();
  root.name = 'OTTO_CHARGE_ARM';

  // ---- mount plinth (bolts to the charger cabinet's car-facing flank) ------
  // The plinth hangs BELOW the root origin. The root origin IS the J1 axis,
  // which is the kinematic origin the IK solves against, so mounting hardware
  // must never displace it — an earlier version raised J1 by the collar height
  // and put a constant 55 mm bias into every single solved pose.
  if (withPlinth) {
    const plinth = new THREE.Group();
    plinth.name = 'Mount_Plinth';
    plinth.position.y = -0.055;

    const plate = mesh(new THREE.BoxGeometry(0.30, 0.026, 0.30), mats.charcoal, 'Mount_Plate');
    plate.position.y = -0.013;
    plinth.add(plate);

    const collar = mesh(new THREE.CylinderGeometry(0.135, 0.155, 0.055, 24), mats.aluDark, 'Mount_Collar');
    collar.position.y = 0.0275;
    plinth.add(collar);

    const plateBolts = boltCircle(0.122, 8, 0.008, 0.03, mats.charcoal, 'Mount_Bolts');
    plateBolts.position.y = -0.004;
    plinth.add(plateBolts);

    // cable gland where the DC cable and the control umbilical enter the base
    const gland = mesh(new THREE.CylinderGeometry(0.030, 0.034, 0.052, 14), mats.charcoal, 'Mount_CableGland');
    gland.position.set(0, 0.026, -0.128);
    gland.rotation.x = Math.PI / 2.6;
    plinth.add(gland);

    root.add(plinth);
  }

  // ---- J1: base yaw --------------------------------------------------------
  const j1 = new THREE.Group();
  j1.name = 'J1_BaseYaw';
  j1.position.y = 0; // root origin == J1 axis == the IK's base frame origin
  root.add(j1);

  const baseHousing = mesh(
    new THREE.CylinderGeometry(spec.radii.base, spec.radii.base * 1.12, 0.13, 24),
    mats.alu, 'Base_Housing',
  );
  baseHousing.position.y = 0.065;
  j1.add(baseHousing);
  const baseBand = mesh(
    new THREE.TorusGeometry(spec.radii.base * 1.02, 0.008, 8, 26), mats.accent, 'Base_Band',
  );
  baseBand.rotation.x = Math.PI / 2;
  baseBand.position.y = 0.028;
  baseBand.castShadow = false;
  j1.add(baseBand);

  // shoulder yoke lifting the pitch axis clear of the base
  const yoke = mesh(
    new THREE.CylinderGeometry(spec.radii.shoulder * 0.92, spec.radii.base * 0.98, spec.shoulderHeight - 0.13, 20),
    mats.alu, 'Shoulder_Yoke',
  );
  yoke.position.y = 0.13 + (spec.shoulderHeight - 0.13) / 2;
  j1.add(yoke);

  // ---- J2: shoulder pitch --------------------------------------------------
  const j2 = new THREE.Group();
  j2.name = 'J2_Shoulder';
  j2.position.set(spec.shoulderOffset, spec.shoulderHeight, 0);
  j1.add(j2);

  j2.add(pitchJointHousing(spec.radii.shoulder, 0.135, mats, 'Shoulder_Joint', true));
  j2.add(linkBody(spec.upperArm, spec.radii.elbow * 0.86, spec.radii.upper * 1.18, mats, 'UpperArm'));

  // ---- J3: elbow pitch -----------------------------------------------------
  const j3 = new THREE.Group();
  j3.name = 'J3_Elbow';
  j3.position.y = spec.upperArm;
  j2.add(j3);

  j3.add(pitchJointHousing(spec.radii.elbow, 0.112, mats, 'Elbow_Joint', false));
  j3.add(linkBody(spec.forearm, spec.radii.wristR * 0.95, spec.radii.fore * 1.16, mats, 'Forearm'));

  // ---- SPHERICAL WRIST: J4/J5/J6 axes all intersect at the forearm end ------
  // The intersection is what makes the IK decouple into "position, then
  // orientation". Do not give these joints offsets from one another — an
  // offset wrist has no closed-form solution and the verifier will fail.

  // J4: forearm roll (about the link axis, +Y)
  const j4 = new THREE.Group();
  j4.name = 'J4_ForearmRoll';
  j4.position.y = spec.forearm;
  j3.add(j4);

  const rollHousing = mesh(
    new THREE.CylinderGeometry(spec.radii.wristR * 0.94, spec.radii.wristR * 1.02, 0.062, 22),
    mats.charcoal, 'Wrist_RollHousing',
  );
  rollHousing.position.y = -0.031;
  j4.add(rollHousing);
  const rollRing = mesh(
    new THREE.TorusGeometry(spec.radii.wristR * 0.97, 0.006, 8, 24), mats.status, 'Wrist_StatusRing',
  );
  rollRing.rotation.x = Math.PI / 2;
  rollRing.position.y = -0.062;
  rollRing.castShadow = false;
  j4.add(rollRing);

  // J5: wrist pitch (about local X) — coincident with J4
  const j5 = new THREE.Group();
  j5.name = 'J5_WristPitch';
  j4.add(j5);

  j5.add(pitchJointHousing(spec.radii.wristR * 0.88, 0.078, mats, 'Wrist_PitchJoint', false));

  // J6: tool roll (about the tool axis, +Y) — coincident with J4/J5
  const j6 = new THREE.Group();
  j6.name = 'J6_ToolRoll';
  j5.add(j6);

  const wristTube = mesh(
    new THREE.CylinderGeometry(spec.radii.wristR * 0.70, spec.radii.wristR * 0.80, spec.wrist, 20),
    mats.alu, 'Wrist_Tube',
  );
  wristTube.position.y = spec.wrist / 2;
  j6.add(wristTube);

  // End effector begins at the flange, spec.wrist above the wrist centre, so
  // the TCP lands at (wrist + tool) from the wrist centre — exactly the
  // toolLength() the IK backs off along the port normal.
  const ee = endEffector(spec, mats);
  ee.position.y = spec.wrist;
  j6.add(ee);

  // ---- dress pack: cable segments parented per link so they pose correctly --
  // (A single swept tube would have to be rebuilt every frame; per-link
  //  segments ride the joints for free and read the same at depot distance.)
  const dress = (
    parent: THREE.Object3D, length: number, offset: number, name: string,
  ) => {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0.02, -offset),
      new THREE.Vector3(0, length * 0.35, -offset * 1.9),
      new THREE.Vector3(0, length * 0.7, -offset * 1.6),
      new THREE.Vector3(0, length - 0.02, -offset),
    ]);
    const t = mesh(new THREE.TubeGeometry(curve, 12, 0.014, 7, false), mats.rubber, name);
    t.castShadow = false;
    parent.add(t);
  };
  dress(j2, spec.upperArm, spec.radii.upper * 1.5, 'DressPack_UpperArm');
  dress(j3, spec.forearm, spec.radii.fore * 1.6, 'DressPack_Forearm');

  const tcp = ee.getObjectByName(TCP_NODE_NAME)!;
  const latch = ee.getObjectByName('Connector_Latch') as THREE.Group;

  return { root, j1, j2, j3, j4, j5, j6, tcp, latch, statusMaterial: mats.status, materials: mats };
}
