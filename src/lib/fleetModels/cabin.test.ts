// Each fleet vehicle's cabin profile against its own spec: the openings lie on the body between the wheels, the sill
// is at the floor and the top under the roof, the seats stand in the cabin, each open door leaf stands as its kind
// says, and the door rigs are the ones the drawn model carries.
import { describe, expect, it } from 'vitest';
import { FLEET_SPECS } from './fleet';
import { cabinProfile, CABIN_LINER_M, PILLAR_HALF_M } from './cabin';
import { doorPointAt, doorRigOf } from './doorRigs';
import { doorPose } from './rig';
import { fleetDoorPlanLines } from './doorPlan';
import { makeSurface, polyline } from './surface';
import * as THREE from 'three';

describe.each(FLEET_SPECS.map((spec) => ({ key: spec.key, spec })))('$key: the cabin the cleaning arm works to', ({ spec }) => {
  const cabin = cabinProfile(spec);
  const L = spec.dims.length;

  it('has the door openings its doors make, between the wheels, sill at the floor and top under the roof', () => {
    const doors = spec.doors(makeSurface(spec.curves)).filter((d) => d.side === 1);
    const hinged = doors.every((d) => d.kind === 'hinge');
    // two sliding panels that part from one line make one opening; a butterfly door is one; hinged doors one each
    expect(cabin.apertures.length).toBe(hinged ? doors.length : 1);
    expect(cabin.apertures.flatMap((a) => a.doorIds).sort()).toEqual(doors.map((d) => d.id).sort());
    const axles = [spec.dims.frontAxle, spec.dims.frontAxle + spec.dims.wheelbase].map((xr) => L / 2 - xr);
    let prev = Infinity;
    for (const a of cabin.apertures) {
      expect(a.x1).toBeGreaterThan(a.x0 + 0.9);            // at least 0.9 m clear along the car
      expect(a.x1).toBeLessThan(prev);                      // front to rear, none overlapping
      prev = a.x0;
      expect(a.x1).toBeLessThan(axles[0]);                  // behind the front axle
      expect(a.x0).toBeGreaterThan(axles[1]);               // ahead of the rear axle
      expect(Math.abs(a.sill - cabin.floorTop)).toBeLessThan(0.08);
      expect(a.belt).toBeGreaterThan(a.sill + 0.3);
      expect(a.top).toBeGreaterThan(a.belt);
      expect(a.top).toBeLessThan(spec.dims.bodyHeight ?? spec.dims.height);
      expect(a.z).toBeGreaterThan(spec.dims.width / 2 - 0.03);
      expect(a.z).toBeLessThanOrEqual(spec.dims.width / 2 + 1e-9);
      // the middle of the opening is inside it by a hand's width; a point on the body ahead of it is not
      expect(cabin.openingMargin((a.x0 + a.x1) / 2, (a.sill + a.belt) / 2, cabin.apertures.indexOf(a))).toBeGreaterThan(0.2);
      expect(cabin.openingMargin(a.x1 + 0.2, (a.sill + a.belt) / 2, cabin.apertures.indexOf(a))).toBeLessThan(0);
      for (const [x, y] of a.outline) {
        expect(Math.abs(x)).toBeLessThan(L / 2);
        expect(y).toBeGreaterThan(0.2);
        expect(y).toBeLessThan(spec.dims.height);
      }
    }
    // two hinged doors on one cut line: a pillar is taken between their openings
    if (hinged && cabin.apertures.length === 2) {
      expect(cabin.apertures[0].x0 - cabin.apertures[1].x1).toBeCloseTo(2 * PILLAR_HALF_M, 6);
    }
  });

  it('is the same on both flanks: every left door is a right door mirrored', () => {
    const s = makeSurface(spec.curves);
    const doors = spec.doors(s);
    const right = doors.filter((d) => d.side === 1), left = doors.filter((d) => d.side === -1);
    expect(left.length).toBe(right.length);
    right.forEach((r, i) => {
      const l = left[i];
      expect(l.kind).toBe(r.kind);
      for (const tt of [3, 4.2, 6, 7.5]) {
        expect(polyline(l.front)(tt)).toBe(polyline(r.front)(tt));
        expect(polyline(l.rear)(tt)).toBe(polyline(r.rear)(tt));
      }
      const a = doorPointAt(doorRigOf(r, s), 1, s.point(polyline(r.rear)(4.2), 4.2, 1));
      const b = doorPointAt(doorRigOf(l, s), 1, s.point(polyline(l.rear)(4.2), 4.2, -1));
      expect(b[0]).toBeCloseTo(a[0], 9);
      expect(b[1]).toBeCloseTo(a[1], 9);
      expect(b[2]).toBeCloseTo(-a[2], 9);
    });
  });

  it('places each open door leaf as its kind says: hinged out from its hinge, sliding along the body, butterfly up', () => {
    const half = spec.dims.width / 2;
    for (const leaf of cabin.leaves) {
      if (leaf.stands === 'out') {
        expect(leaf.box.z1).toBeGreaterThan(half + 0.7);     // the leaf's free edge is well out from the flank
        expect(leaf.box.y1).toBeLessThan(spec.dims.height);
      } else if (leaf.stands === 'along') {
        expect(leaf.box.z1).toBeLessThan(half + 0.45);       // the panel lies along the body (its mirror stands further out)
        expect(leaf.box.z0).toBeGreaterThan(half - 0.35);
      } else {
        expect(leaf.box.y1).toBeGreaterThan(spec.dims.height + 0.3);  // the door stands over the roof line
        expect(leaf.box.z1).toBeGreaterThan(half + 0.7);
      }
    }
    // an open sliding panel has left its opening: the opening's middle is clear air beside the body
    for (const a of cabin.apertures) {
      if (a.kind !== 'slide') continue;
      expect(cabin.leafClearance({ x: (a.x0 + a.x1) / 2, y: (a.sill + a.belt) / 2, z: a.z + 0.15 })).toBeGreaterThan(0.25);
    }
  });

  it('moves a door as the drawn model\'s rig does (doorPointAt is rig.doorPose without three.js)', () => {
    const s = makeSurface(spec.curves);
    for (const d of spec.doors(s)) {
      const rig = doorRigOf(d, s);
      const p = s.point((polyline(d.front)(5) + polyline(d.rear)(5)) / 2, 5, d.side);
      for (const t of [0, 0.3, 0.7, 1]) {
        const pose = doorPose(rig, t);
        // the node sits at the pivot shut; a point of the panel is (p - pivot) in the node, moved by the node's pose
        const want = new THREE.Vector3(p[0] - rig.pivot[0], p[1] - rig.pivot[1], p[2] - rig.pivot[2]).applyQuaternion(pose.quaternion).add(pose.position);
        const got = doorPointAt(rig, t, p);
        expect(Math.hypot(got[0] - want.x, got[1] - want.y, got[2] - want.z)).toBeLessThan(1e-9);
      }
      // and the 2D plan's door line ends on that same leaf
      const lines = fleetDoorPlanLines(spec.key, d.side, 1);
      expect(lines.length).toBe(spec.doors(s).filter((q) => q.side === d.side).length);
    }
  });

  it('has its seats in the cabin, on the floor, under the headliner, and off the door openings\' plane', () => {
    expect(cabin.seats.length).toBe(spec.seats.length);
    expect(cabin.floorTop).toBeGreaterThan(0.2);
    expect(cabin.headliner).toBeLessThan((spec.dims.bodyHeight ?? spec.dims.height) - 0.04);
    expect(cabin.headliner - cabin.floorTop).toBeGreaterThan(1.0);
    expect(cabin.x1).toBeGreaterThan(cabin.x0 + 0.9);
    for (const seat of cabin.seats) {
      expect(seat.cushion.y0).toBeCloseTo(cabin.floorTop, 9);
      expect(seat.cushionTop).toBeGreaterThan(cabin.floorTop + 0.3);
      for (const b of [seat.cushion, ...seat.back, ...seat.head]) {
        expect(b.x0).toBeGreaterThanOrEqual(cabin.x0 - 1e-9);
        expect(b.x1).toBeLessThanOrEqual(cabin.x1 + 1e-9);
        expect(Math.max(Math.abs(b.z0), Math.abs(b.z1))).toBeLessThan(spec.dims.width / 2 - 0.1);
        // a cushion and a backrest stand under the headliner; a headrest stands under the roof's skin (the drawn
        // model's headrests reach into the 0.065 m taken for the liner on the lowest roof, the Cybercab's)
        const roof = cabin.ceilingAt((b.x0 + b.x1) / 2, 0) + (seat.head.includes(b) ? CABIN_LINER_M : 0);
        expect(b.y1).toBeLessThan(roof);
        // the box's centre is inside the body's skin
        expect(cabin.skin({ x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2, z: (b.z0 + b.z1) / 2 }).sd).toBeLessThan(-CABIN_LINER_M);
      }
      // the backrest leans away from the way the seat faces
      expect((seat.back[2].x0 - seat.back[0].x0) * seat.facing).toBeLessThan(0);
    }
    // a point over a cushion is in free cabin; a point in a cushion is not; a point outside the body has no room
    const s0 = cabin.seats[0];
    const over = { x: (s0.cushion.x0 + s0.cushion.x1) / 2 + s0.facing * 0.1, y: s0.cushionTop + 0.15, z: s0.z };
    expect(cabin.room(over)).toBeGreaterThan(0.05);
    expect(cabin.seatClearance(over)).toBeGreaterThan(0.1);
    expect(cabin.seatClearance({ ...over, y: s0.cushionTop - 0.05 })).toBeLessThan(0);
    expect(cabin.room({ x: 0, y: 1, z: spec.dims.width / 2 + 0.3 })).toBeLessThan(0);
    expect(cabin.skin({ x: 0, y: 1, z: spec.dims.width / 2 + 0.3 }).sd).toBeGreaterThan(0.25);
    expect(cabin.bodyClearance({ x: 0, y: 1, z: spec.dims.width / 2 + 0.3 })).toBeCloseTo(0.3, 6);
  });
});

describe.each(FLEET_SPECS.map((spec) => ({ key: spec.key, spec })))('$key: one door, and one opening\'s doors, on their own', ({ spec }) => {
  const cabin = cabinProfile(spec);
  const W = spec.dims.width / 2;

  it('measures one leaf\'s travel alone: never nearer than the flank\'s, and all the leaves together are the flank', () => {
    const ids = cabin.leaves.map((l) => l.id);
    for (let x = -1.6; x <= 1.6; x += 0.4) for (const y of [0.6, 1.1, 1.6]) for (const out of [0.1, 0.4, 0.8]) {
      const p = { x, y, z: W + out };
      const all = cabin.leafSweptClearance(p);
      const each = ids.map((id) => cabin.leafSweptClearanceOf(p, [id]));
      for (const d of each) expect(d).toBeGreaterThanOrEqual(all - 1e-12);
      expect(Math.min(...each)).toBeCloseTo(all, 12);
      expect(cabin.leafSweptClearanceOf(p, ids)).toBeCloseTo(all, 12);
      // the left flank's leaves are the mirror of the right flank's
      expect(cabin.leafSweptClearanceOf({ ...p, z: -p.z }, [ids[0]])).toBeCloseTo(each[0], 12);
      // each door at its own opening: all alike is the flank's measure, and a door left shut is not measured
      const n = ids.length;
      expect(cabin.leafClearanceDoors(p, Array(n).fill(0.6), Array(n).fill(0))).toBeCloseTo(cabin.leafClearanceAt(p, 0.6, 0), 12);
      expect(cabin.leafClearanceDoors(p, Array(n).fill(0), Array(n).fill(0))).toBe(cabin.leafClearanceAt(p, 0, 0));
      if (n > 1) expect(cabin.leafClearanceDoors(p, [1, 0], [])).toBeGreaterThanOrEqual(cabin.leafClearanceAt(p, 1, 0) - 1e-12);
    }
  });

  it('with only one panel of a two-panel opening able to open: that panel\'s own part of the opening, one leaf, the same body', () => {
    const two = cabin.apertures.find((a) => a.doorIds.length === 2);
    if (!two) { expect(cabin.apertures.every((a) => a.doorIds.length === 1)).toBe(true); return; }
    const [front, rear] = two.doorIds;
    const f = cabinProfile(spec, [front]), r = cabinProfile(spec, [rear]);
    for (const part of [f, r]) {
      expect(part.apertures.length).toBe(1);
      expect(part.leaves.length).toBe(1);
      expect(part.seats).toEqual(cabin.seats);
      expect(part.apertures[0].z).toBeCloseTo(two.z, 2);
    }
    // the two parts meet at the line the panels part from, and together are the whole opening
    expect(f.apertures[0].x1).toBeCloseTo(two.x1, 9);
    expect(r.apertures[0].x0).toBeCloseTo(two.x0, 9);
    expect(f.apertures[0].x0).toBeCloseTo(r.apertures[0].x1, 9);
    // where the other panel is shut there is a wall: a point just inside the whole opening's rear half
    const y = (two.sill + two.top) / 2, x = (two.x0 + r.apertures[0].x1) / 2;
    expect(cabin.openingMargin(x, y, 0)).toBeGreaterThan(0.1);
    expect(f.openingMargin(x, y, 0)).toBeLessThan(0);
    // the profile is kept by its doors: the whole cabin is still the whole cabin
    expect(cabinProfile(spec)).toBe(cabin);
    expect(cabinProfile(spec, [front])).toBe(f);
  });
});
