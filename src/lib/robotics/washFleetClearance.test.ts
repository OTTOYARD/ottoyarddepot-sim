// OTTO-WASH, as the yard draws it (its CAD), against each fleet vehicle's own body, playing that vehicle's own program
// (ottoWash/washProgram.ts). cadYard.test.ts holds the machine to the yard's one generic car, and fleetEnvelope.test.ts
// to each vehicle's size with the machine stowed. This holds it to the six real ones at work: the gantry's passes over
// each vehicle's own height, width and length, and the detail arms at every place of each vehicle's program, on every
// path between places, and through seats that end early. The margins are cadYard.test.ts's own:
//   - the frame 1.0 u off the vehicle;
//   - the pad's face no deeper in it than its foam gives, 15 mm, and on it at every place;
//   - the head behind the pad, and the camera beside it, 0.045 m off it;
//   - every link and joint of an arm 0.08 m off it, and every other moving part (the air knives, the carriages) 0.1 m.
// The vehicle is its wash solid (fleetModels/washSolid.ts): its own skin, sensors, housings, mirrors and tyres.
// Vertices are sampled (the depot model's own). No network: the model is read from disk.
import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { depotSceneFromDisk } from '@/test/cadDisk';
import { METRES_PER_PLAN_UNIT } from '@/lib/ottoChargeArm/cobotSpec';
import { FLEET_SPECS } from '@/lib/fleetModels';
import { fleetWashSolid } from '@/lib/fleetModels/washSolid';
import { advanceWashSession, IDLE_WASH, type WashSession } from '@/lib/ottoWash/washSession';
import { programPoseAt, washPoseAt, type WashPose } from '@/lib/ottoWash/washPose';
import { washProgramFor } from '@/lib/ottoWash/washProgram';
import { WASH_PHASE_S, WASH_TRAVEL, WASH_WIPE, isWipe, stationOf } from '@/lib/ottoWash/washSpec';
import { partOfMesh, subOf } from './cadClearance';
import { indexCad, poseCad, type CadModel } from './cadModel';
import { washJoints } from './catalog';

const M = METRES_PER_PLAN_UNIT;

interface Sampled { mesh: THREE.Mesh; part: string; kind: Kind; verts: Float32Array; c: THREE.Vector3; r: number }
type Kind = 'frame' | 'pad' | 'head' | 'arm' | 'tool';
const onJoint = (o: THREE.Object3D, re: RegExp): boolean => {
  for (let n: THREE.Object3D | null = o; n; n = n.parent) {
    const j = (n.userData as { joint?: { name?: string } }).joint;
    if (j?.name && re.test(j.name)) return true;
  }
  return false;
};
/** cadYard.test.ts's own sorting of the machine's parts. */
function kindOf(m: THREE.Mesh): Kind {
  const part = partOfMesh(m) ?? m.name, sub = subOf(m) ?? '';
  if (part === 'WSH-PAD') return 'pad';
  if (onJoint(m, /^DARM_[LR]_J6$/) || sub === 'POLISH') return 'head';
  if (onJoint(m, /^DARM_[LR]_J[1-5]$/)) return 'arm';
  return ['RAILS', 'TRAVEL', 'PORTAL', 'ARCH', 'CONTROL', 'TRACK', 'DOCK'].includes(sub) ? 'frame' : 'tool';
}

/** A session's poses for a vehicle: stepped a frame at a time, kept every `keep` sim seconds, and through an early end. */
function poses(model: string, seat: number, endAt: number | undefined, keep: number, from = 0): WashPose[] {
  const out: WashPose[] = [];
  let s: WashSession = IDLE_WASH;
  let next = from;
  for (let t = 0; t < seat + 60; t += 0.1) {
    const on = endAt === undefined ? t < seat : t < endAt;
    s = advanceWashSession(s, { dt: 0.1, vehicleId: 'car', active: on, interior: false, model, endsInS: on ? seat - t : null });
    if (t >= next) { out.push(washPoseAt(s)); next = t + keep; }
  }
  return out;
}

describe('OTTO-WASH (its CAD) against each fleet vehicle, playing that vehicle\'s own program', () => {
  let model: CadModel;
  let parts: Sampled[];
  beforeAll(async () => {
    const scene = await depotSceneFromDisk('wash_gantry');
    model = indexCad(scene);
    parts = [];
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
      const bs = m.geometry.boundingSphere!;
      parts.push({
        mesh: m, part: partOfMesh(m) ?? m.name, kind: kindOf(m),
        verts: new Float32Array((m.geometry.getAttribute('position') as THREE.BufferAttribute).array as ArrayLike<number>),
        c: bs.center.clone(), r: bs.radius,
      });
    });
  }, 120_000);

  it.each(FLEET_SPECS.map((s) => ({ key: s.key, spec: s })))('$key: only the pads touch it, no deeper than a pad gives, and every rigid part keeps its margin', ({ key, spec }) => {
    const solid = fleetWashSolid(spec);
    const prog = washProgramFor(key);
    // the CAD's bay frame is metres, +X west, +Y up, +Z north; the solid's is x east, dy south
    const gap = (q: THREE.Vector3) => solid.gap({ x: -q.x, dy: -q.z, y: q.y });
    const seat = 390;
    const all: WashPose[] = [
      // the whole program, every 2 s; ended early in a pass and through the arms' work, every 0.5 s of the way home
      ...poses(key, seat, undefined, 2),
      ...poses(key, seat, 120, 1, 118),
      ...[0.2, 0.45, 0.7, 0.9].flatMap((f) => { const at = seat - 10 - prog.wipeS * (1 - f); return poses(key, seat, at, 0.5, at - 1); }),
    ];
    // and the arms at every place of the program, pad pressed on it: each polish at its middle
    const pressed = new Set<string>();
    for (const phase of WASH_WIPE) {
      if (!isWipe(phase)) continue;
      const len = prog.zoneS[stationOf(phase)];
      for (let t = 0; t <= len; t += 0.1) {
        const p = programPoseAt(phase, t / len, key);
        const tag = p.arms.map((a) => (a.engage > 0 && Math.abs(a.q.j6) < 0.3 ? a.sensor : '')).join('|');
        if (tag !== '|' && !pressed.has(tag)) { pressed.add(tag); all.push(p); }
      }
    }
    const places = prog.detail.sensors[1].length + prog.detail.sensors[-1].length;
    expect(new Set([...pressed].flatMap((t) => t.split('|').map((id, k) => (id ? `${k}:${id}` : ''))).filter(Boolean)).size).toBe(places);

    const worst: Record<Kind, number> = { frame: Infinity, pad: Infinity, head: Infinity, arm: Infinity, tool: Infinity };
    const at: Record<Kind, string> = { frame: '', pad: '', head: '', arm: '', tool: '' };
    const vs = new THREE.Vector3(), vw = new THREE.Vector3();
    for (const p of all) {
      poseCad(model, washJoints(p)); model.root.updateMatrixWorld(true);
      for (const s of parts) {
        const e = s.mesh.matrixWorld.elements;
        vs.copy(s.c).applyMatrix4(s.mesh.matrixWorld);
        const r = s.r * Math.hypot(e[0], e[1], e[2]);
        // nothing of this part is nearer than its centre less its radius: skip it when that is no new least
        if (gap(vs) - r >= Math.min(worst[s.kind], s.kind === 'frame' ? 2 * M : 0.5)) continue;
        const a = s.verts;
        for (let j = 0; j < a.length; j += 3) {
          const d = gap(vw.set(a[j], a[j + 1], a[j + 2]).applyMatrix4(s.mesh.matrixWorld));
          if (d < worst[s.kind]) { worst[s.kind] = d; at[s.kind] = `${s.part} (${p.station ?? 'no zone'}: ${p.arms.map((x) => x.sensor ?? '-').join(' ')})`; }
        }
      }
    }
    console.log(`WASHCAD ${key} poses ${all.length} places ${places} m: ${JSON.stringify(Object.fromEntries(Object.entries(worst).map(([k, v]) => [k, +v.toFixed(4)])))} ${JSON.stringify(at)}`);
    expect(worst.frame / M, `${at.frame} comes ${(worst.frame / M).toFixed(3)} u from the vehicle`).toBeGreaterThan(1.0);
    expect(worst.pad, `${at.pad}: the pad goes ${(-worst.pad * 1000).toFixed(1)} mm into the vehicle`).toBeGreaterThanOrEqual(-0.015);
    expect(worst.pad, 'the pads do reach the vehicle').toBeLessThan(0.005);
    expect(worst.head, `${at.head} comes ${worst.head.toFixed(3)} m from the vehicle`).toBeGreaterThan(0.045);
    expect(worst.arm, `${at.arm} comes ${worst.arm.toFixed(3)} m from the vehicle`).toBeGreaterThan(0.08);
    expect(worst.tool, `${at.tool} comes ${worst.tool.toFixed(3)} m from the vehicle`).toBeGreaterThan(0.1);
  }, 900_000);

  it.each(FLEET_SPECS.map((s) => ({ key: s.key, spec: s })))('$key drives through the bay under the stowed machine and between the docked arms', ({ key, spec }) => {
    const solid = fleetWashSolid(spec);
    const home = washPoseAt({ phase: 'home', t: 1, from: null, model: key });
    let worst = Infinity, where = '';
    const vw = new THREE.Vector3();
    for (const dy of [WASH_TRAVEL.north, -5, -2.5, 0, 2.5, 5, WASH_TRAVEL.south, WASH_TRAVEL.home]) {
      poseCad(model, washJoints({ ...home, dy })); model.root.updateMatrixWorld(true);
      for (const s of parts) {
        const a = s.verts;
        for (let j = 0; j < a.length; j += 3) {
          vw.set(a[j], a[j + 1], a[j + 2]).applyMatrix4(s.mesh.matrixWorld);
          // the vehicle's swept box: its widest and its highest, mirrors and roof sensors counted
          const out = Math.max(Math.abs(vw.x) - solid.halfWidth, vw.y - solid.top);
          if (out < worst) { worst = out; where = s.part; }
        }
      }
    }
    // fleetEnvelope.test.ts holds 0.25 m to each vehicle's published width and height; this is to all that is on it
    expect(worst, `${key}: ${where} stands ${worst.toFixed(3)} m from the vehicle's swept box`).toBeGreaterThan(0.25);
    expect(WASH_PHASE_S.settle).toBeGreaterThan(0);
  }, 120_000);
});
