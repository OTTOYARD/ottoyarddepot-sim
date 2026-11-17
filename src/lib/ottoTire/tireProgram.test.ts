// OTTO-TIRE's spec and program, held to the bay they stand in and to every fleet car they serve.
//   1. The machine fits the bay: inside the partitions and end walls, nothing in the door opening's width but what a car
//      passes under, the portal's beam over the tallest car on the lift.
//   2. Every fleet model's wheels are reachable: the trolley, the mast, the clamp, the pitch circle and the pads inside
//      their ranges, at every frame of every model's cycle.
//   3. The head stays off each car: while it travels its rollers stand clear of the widest flank, and it turns only
//      high enough to pass over the racked wheels.
//   4. The lift: the posts stand between each car's axles, the arms reach each car's lift points under its sills, and
//      the rams lift the rated load at a low pressure.
//   5. The socket change: a car with 17 mm wheel bolts gets the head's second socket set, and the head has its 21 mm set
//      back when the car leaves.
import { describe, expect, it } from 'vitest';
import { FLEET_SPECS } from '@/lib/fleetModels';
import {
  COVER_NEST, FACE_AHEAD_OF_MAST, HEAD, HEAD_Y_MAX, HEAD_Y_MIN, LIFT, PORTAL, RACK, SLEW, SLEW_SWEEP, SOCKET_RACK, TIRE_BAY, TROLLEY,
  ramBar,
} from './tireSpec';
import {
  CUPS_AHEAD_OF_MAST, CYCLE_MODEL, HUB_ANGLE, SOCKETS_AHEAD_OF_MAST, TIRE_VEHICLES, TRAVEL_FACE_X, TURN_TROL, WHEEL_FACTS, clampContactAngle,
  clampFor, coverNestY, homeState, needsSocketSwap, serviceLift, tireAngles, tireCycle,
} from './tireProgram';

const widest = Math.max(...FLEET_SPECS.map((s) => s.dims.width)) / 2;

describe('OTTO-TIRE: the bay it stands in', () => {
  it('reads the bay from the site plan: 4.21 m to the partition, 6.89 m to each end wall', () => {
    expect(TIRE_BAY.halfWidth).toBeCloseTo(4.2108, 3);
    expect(TIRE_BAY.north).toBeCloseTo(6.8904, 3);
    expect(TIRE_BAY.south).toBeCloseTo(6.8904, 3);
    expect(TIRE_BAY.doorHalfWidth).toBeCloseTo(2.6318, 3);
  });

  it('keeps the portal\'s rails and the racks outside the door opening, and the rails off the partition', () => {
    expect(PORTAL.railX - PORTAL.truckW / 2).toBeGreaterThan(TIRE_BAY.doorHalfWidth + 0.5);
    expect(PORTAL.railX + PORTAL.truckW / 2).toBeLessThan(TIRE_BAY.halfWidth - 0.3);
    expect(RACK.frameX0).toBeGreaterThan(TIRE_BAY.doorHalfWidth);
    expect(RACK.frameX1).toBeLessThan(PORTAL.railX - PORTAL.truckW / 2 - 0.15);
    expect(Math.max(-PORTAL.railFrom, PORTAL.railTo)).toBeLessThan(Math.min(TIRE_BAY.north, TIRE_BAY.south) - 1.5);
  });

  it('puts the beam 0.5 m or more over the tallest fleet car on the lift at service height', () => {
    const tallest = Math.max(...FLEET_SPECS.map((s) => s.dims.height));
    expect(PORTAL.beamUnder - (tallest + LIFT.serviceRise)).toBeGreaterThan(0.5);
    // and under the roof deck with room for the trolleys
    expect(PORTAL.beamUnder + PORTAL.beamDepth + 0.6).toBeLessThan(TIRE_BAY.roofDeck);
  });
});

describe('OTTO-TIRE: the head and the mast', () => {
  it('reaches from a racked wheel\'s centre (0.44 m) to over the wheels on the lift (0.83 m)', () => {
    const lowest = Math.min(...TIRE_VEHICLES.map((v) => RACK.tyreBottom + v.tyreR));
    const highest = Math.max(...TIRE_VEHICLES.map((v) => v.centreY));
    expect(HEAD_Y_MIN).toBeLessThanOrEqual(lowest);
    expect(HEAD_Y_MAX).toBeGreaterThanOrEqual(highest + 0.15);
    for (const v of TIRE_VEHICLES.filter((t) => t.facts.cover)) expect(coverNestY(v), v.key).toBeLessThanOrEqual(SLEW.maxHeadY);
  });

  it('turns where its sweep clears the widest car\'s body by 0.15 m and its top stays under every door mirror', () => {
    expect(TURN_TROL - SLEW_SWEEP - widest).toBeGreaterThanOrEqual(0.15 - 1e-6);
    // the head's top (its housing, 0.18 m over its axis) at the turning height, against the lowest mirror on the lift
    const mirrors = FLEET_SPECS.filter((s) => s.mirrors).map((s) => s.mirrors!.y - 0.065 + LIFT.serviceRise);
    expect(SLEW.maxHeadY + 0.18 + 0.20).toBeLessThan(Math.min(...mirrors));
    expect(SLEW_SWEEP).toBeLessThan(0.85);
  });

  it('carries a wheel past the racked wheels: turned to the wall at the turning line, its far face stays off the racks', () => {
    const widestTyre = Math.max(...TIRE_VEHICLES.map((v) => v.tyreW));
    expect(RACK.faceX - (TURN_TROL + FACE_AHEAD_OF_MAST + widestTyre)).toBeGreaterThan(0.05);
  });

  it('closes its rollers on every fleet tyre 30 to 40 degrees from the bottom, inside the arms\' travel', () => {
    for (const v of TIRE_VEHICLES) {
      const c = clampFor(v.tyreR);
      expect(c, v.key).toBeGreaterThanOrEqual(HEAD.clampMin);
      expect(c + 0.08, v.key).toBeLessThanOrEqual(HEAD.clampMax);       // and opens 0.08 m wider to let the tyre in
      const deg = clampContactAngle(v.tyreR) * 180 / Math.PI;
      expect(deg, v.key).toBeGreaterThan(30);
      expect(deg, v.key).toBeLessThan(40);
    }
  });

  it('sets its pitch circle to every fleet model\'s', () => {
    for (const [k, f] of Object.entries(WHEEL_FACTS)) {
      expect(f.pcd, k).toBeGreaterThanOrEqual(HEAD.pcdMin);
      expect(f.pcd, k).toBeLessThanOrEqual(HEAD.pcdMax);
    }
  });
});

describe('OTTO-TIRE: every fleet model\'s cycle', () => {
  for (const v of TIRE_VEHICLES) {
    describe(v.name, () => {
      const cyc = tireCycle(v);
      const frames = (() => {
        const out: { id: string; s: ReturnType<typeof cyc.stateAt> }[] = [];
        cyc.steps.forEach((st, i) => { for (const u of [0, 0.25, 0.5, 0.75, 1]) out.push({ id: st.id, s: cyc.stateAt(i, u) }); });
        return out;
      })();

      it('keeps every axis inside its range at every frame', () => {
        for (const { id, s } of frames) {
          expect(s.portal, id).toBeGreaterThanOrEqual(PORTAL.travelFrom - 1e-9);
          expect(s.portal, id).toBeLessThanOrEqual(PORTAL.travelTo + 1e-9);
          for (const q of [s.W, s.E]) {
            expect(q.trol, id).toBeGreaterThanOrEqual(TROLLEY.from - 1e-9);
            expect(q.trol, id).toBeLessThanOrEqual(TROLLEY.to + 1e-9);
            expect(q.slew, id).toBeGreaterThanOrEqual(SLEW.from);
            expect(q.slew, id).toBeLessThanOrEqual(SLEW.to);
            expect(q.headY, id).toBeGreaterThanOrEqual(HEAD_Y_MIN - 1e-9);
            expect(q.headY, id).toBeLessThanOrEqual(HEAD_Y_MAX + 1e-9);
            expect(q.grip, id).toBeLessThanOrEqual(HEAD.grip + 1e-9);
            expect(q.clamp, id).toBeGreaterThanOrEqual(HEAD.clampMin - 1e-9);
            expect(q.clamp, id).toBeLessThanOrEqual(HEAD.clampMax + 1e-9);
            expect(Math.abs(q.a), id).toBeLessThanOrEqual(HEAD.aRange);
          }
          expect(Math.max(s.liftF, s.liftR), id).toBeLessThanOrEqual(LIFT.fullRise);
          for (const q of [s.armF, s.armR]) {
            expect(q.reach, id).toBeGreaterThanOrEqual(LIFT.reach[0] - 1e-9);
            expect(q.reach, id).toBeLessThanOrEqual(LIFT.reach[1] + 1e-9);
            expect(q.swing, id).toBeGreaterThanOrEqual(-1e-9);
            expect(q.swing, id).toBeLessThanOrEqual(Math.PI * 0.6);
          }
          // the arms swing only at the clearing rise, under every sill
          const prev = cyc.steps[Math.max(0, cyc.steps.findIndex((t) => t.id === id) - 1)].end;
          if (Math.abs(s.armF.swing - prev.armF.swing) > 1e-9) expect(s.liftF, id).toBeCloseTo(LIFT.armClearRise, 9);
        }
      });

      it('turns a robot only with its head at the turning height, and never beside the car', () => {
        cyc.steps.forEach((st, i) => {
          const a = i === 0 ? st.end : cyc.steps[i - 1].end;
          for (const side of ['W', 'E'] as const) {
            if (Math.abs(st.end[side].slew - a[side].slew) < 1e-9) continue;
            expect(Math.max(a[side].headY, st.end[side].headY), st.id).toBeLessThanOrEqual(SLEW.maxHeadY + 1e-9);
            // the turn sweeps SLEW_SWEEP about the mast: it stays off the widest car's flank even beside it
            const trol = Math.min(a[side].trol, st.end[side].trol);
            expect(trol - SLEW_SWEEP, st.id).toBeGreaterThan(widest + 0.05);
          }
        });
      });

      it('moves along the car only with the rollers clear of the widest flank, and lowers only outside it', () => {
        cyc.steps.forEach((st, i) => {
          const a = i === 0 ? st.end : cyc.steps[i - 1].end;
          if (Math.abs(st.end.portal - a.portal) < 1e-9) return;
          for (const side of ['W', 'E'] as const) {
            for (const q of [a[side], st.end[side]]) {
              // turned to the car, the rollers' tips stand (FACE_AHEAD_OF_MAST + roller length) inside the mast's axis
              const tips = q.slew < 1 ? q.trol - FACE_AHEAD_OF_MAST - HEAD.rollerL : q.trol - (HEAD.backFromMast);
              expect(tips, `${st.id} ${side}`).toBeGreaterThan(widest + 0.08);
            }
          }
        });
      });

      it('keeps the head off the portal\'s end truck when it reaches out to the leg or the racks', () => {
        // turned to the wall, the rollers' tips stand FACE_AHEAD_OF_MAST + rollerL - rollerBack past the mast's axis, and
        // their underside (and the clamp posts') HEAD.rollerY + rollerR under the head's axis
        const truckIn = PORTAL.railX - PORTAL.truckW / 2;
        for (const { id, s } of frames) {
          for (const q of [s.W, s.E]) {
            if (Math.abs(q.slew - Math.PI) > 0.3) continue;
            const tips = q.trol + FACE_AHEAD_OF_MAST + HEAD.rollerL - HEAD.rollerBack;
            const under = q.headY + HEAD.rollerY - HEAD.rollerR;
            if (tips > truckIn - 0.03) expect(under, id).toBeGreaterThan(PORTAL.truckTop + 0.03);
          }
        }
      });

      it('grips each wheel at its own face and height, and sets each wheel down in its cradle', () => {
        const grip = cyc.steps.find((s) => s.id === 'f_grip')!.end;
        expect(grip.W.trol - FACE_AHEAD_OF_MAST).toBeCloseTo(v.faceX + 0.01, 6);
        expect(grip.W.headY).toBeCloseTo(v.centreY, 6);
        const down = cyc.steps.find((s) => s.id === 'f_rack_down')!.end;
        expect(down.W.trol + FACE_AHEAD_OF_MAST).toBeCloseTo(RACK.faceX, 6);
        expect(down.W.headY).toBeCloseTo(RACK.tyreBottom + v.tyreR, 6);
      });

      it('takes an aero cover off and puts it back only on a model that has one', () => {
        const ids = cyc.steps.map((s) => s.id);
        expect(ids.includes('f_cover_off')).toBe(v.facts.cover);
        if (v.facts.cover) {
          const nest = cyc.steps.find((s) => s.id === 'f_cover_nest')!.end;
          expect(nest.W.trol + CUPS_AHEAD_OF_MAST).toBeCloseTo(COVER_NEST.x, 6);
          expect(nest.W.slew).toBeCloseTo(Math.PI, 9);
          expect(nest.W.cover).toBeCloseTo(HEAD.cover, 9);
        }
      });

      it('ends where it started, with the car back on the floor', () => {
        const end = cyc.steps[cyc.steps.length - 1].end;
        expect(end.liftF).toBe(0);
        expect(end.liftR).toBe(0);
        expect(end.portal).toBe(PORTAL.park);
        expect(end.armF).toEqual({ swing: 0, reach: LIFT.reach[0] });
        expect(end.armR).toEqual({ swing: 0, reach: LIFT.reach[0] });
      });
    });
  }

  it('plays the Model Y (an aero cover on each wheel) in the tab, in about 10 minutes for all 4 wheels', () => {
    const v = TIRE_VEHICLES.find((t) => t.key === CYCLE_MODEL)!;
    const c = tireCycle(v);
    expect(v.facts.cover).toBe(true);
    expect(c.total).toBeGreaterThan(400);
    expect(c.total).toBeLessThan(720);
    expect(Object.keys(c.at(10).angles).length).toBe(Object.keys(tireAngles(homeState())).length);
  });
});

describe('OTTO-TIRE: the lift', () => {
  it('stands both posts between each car\'s axles, stows the arms between its wheels and sets each pad clear of its tyre', () => {
    for (const v of TIRE_VEHICLES) {
      // a post's saddle and stowed arms lie inside the tyres' inner faces (the casings' covers are drive-over)
      const innerFace = v.faceX - v.tyreW;
      expect(LIFT.pivotX + LIFT.armW / 2 + 0.10, v.key).toBeLessThan(innerFace);
      expect(LIFT.postZ[0], v.key).toBeLessThan(v.frontZ);
      expect(LIFT.postZ[1], v.key).toBeGreaterThan(v.rearZ);
      // at its lift point a pad stands 0.15 m or more off its tyre's tread at the pad's own height
      for (const [axle, pz, sill] of [[v.frontZ, v.padFrontZ, v.sillFront], [v.rearZ, v.padRearZ, v.sillRear]] as const) {
        const y = Math.min(v.tyreR, sill);
        const chord = Math.sqrt(v.tyreR ** 2 - (v.tyreR - y) ** 2);
        expect(Math.abs(axle - pz) - chord - LIFT.padD / 2, v.key).toBeGreaterThan(0.15);
      }
    }
    // the front post's stowed arms and the rear's do not meet
    expect(LIFT.postZ[0] - LIFT.reach[0] - LIFT.padD / 2).toBeGreaterThan(LIFT.postZ[1] + LIFT.reach[0] + LIFT.padD / 2 + 0.05);
  });

  it('reaches every model\'s lift points with the arms\' swing and slide', () => {
    for (const v of TIRE_VEHICLES) {
      for (const a of [v.armFront, v.armRear]) {
        expect(a.reach, v.key).toBeGreaterThanOrEqual(LIFT.reach[0]);
        expect(a.reach, v.key).toBeLessThanOrEqual(LIFT.reach[1]);
        expect(a.swing * 180 / Math.PI, v.key).toBeGreaterThan(60);
        expect(a.swing * 180 / Math.PI, v.key).toBeLessThan(120);
      }
      // the posts lift the car its 0.50 m inside their stroke
      expect(serviceLift(Math.max(v.sillFront, v.sillRear)), v.key).toBeLessThan(LIFT.fullRise);
    }
  });

  it('swings its arms under each car with 0.05 m or more under the lowest sill', () => {
    const lowest = Math.min(...TIRE_VEHICLES.flatMap((v) => [v.sillFront, v.sillRear]));
    expect(lowest - LIFT.armClearRise).toBeGreaterThanOrEqual(0.05);
  });

  it('lifts the rated load at about 7 bar on each 200 mm ram', () => {
    // 4,500 kg on 2 rams: 22.1 kN on 0.0314 m2 each
    expect(ramBar(LIFT.ratedKg / 2 * 9.81)).toBeCloseTo(7.03, 2);
  });
});

describe('OTTO-TIRE: the travel line', () => {
  it('keeps the rollers 0.10 m or more off the widest fleet car while the portal moves', () => {
    expect(TRAVEL_FACE_X - HEAD.rollerL + HEAD.rollerBack - widest).toBeGreaterThan(0.10);
  });
});

describe('OTTO-TIRE: the socket change', () => {
  it('swaps to the 17 mm set only for a car with 17 mm fasteners, and swaps back before the car leaves', () => {
    for (const v of TIRE_VEHICLES) {
      const c = tireCycle(v);
      const ids = c.steps.map((s) => s.id);
      expect(ids.includes('sock_out_take'), v.key).toBe(needsSocketSwap(v.facts));
      expect(ids.includes('sock_back_take'), v.key).toBe(needsSocketSwap(v.facts));
      if (needsSocketSwap(v.facts)) {
        // the swap out comes before the lift rises, the swap back after the last wheel and before the portal parks
        expect(ids.indexOf('sock_out_back'), v.key).toBeLessThan(ids.indexOf('arms_up'));
        expect(ids.indexOf('sock_back_take'), v.key).toBeGreaterThan(ids.indexOf('r_up'));
        expect(ids.indexOf('sock_back_back'), v.key).toBeLessThan(ids.indexOf('park'));
      }
    }
    expect(TIRE_VEHICLES.filter((v) => needsSocketSwap(v.facts)).map((v) => v.key)).toEqual(['waymo_ojai']);
  });

  it('puts the sockets into the rack\'s holders inside the trolley\'s travel, with the head turned and at its ring', () => {
    const v = TIRE_VEHICLES.find((t) => needsSocketSwap(t.facts))!;
    const c = tireCycle(v);
    const put = c.steps.find((s) => s.id === 'sock_out_put')!.end;
    const take = c.steps.find((s) => s.id === 'sock_out_take')!.end;
    expect(put.portal).toBe(SOCKET_RACK.z);
    expect(put.W.slew).toBeCloseTo(Math.PI, 9);
    expect(put.W.trol + SOCKETS_AHEAD_OF_MAST).toBeCloseTo(SOCKET_RACK.faceX + SOCKET_RACK.engage, 9);
    expect(put.W.trol).toBeLessThanOrEqual(TROLLEY.to);
    expect(put.W.headY).toBeCloseTo(SOCKET_RACK.ringY[0], 9);
    expect(take.W.headY).toBeCloseTo(SOCKET_RACK.ringY[1], 9);
    expect(put.W.pcd).toBeCloseTo(SOCKET_RACK.pcd, 9);
    expect(put.W.a).toBe(0);
    // the rack stands outside the door opening (no car passes it) and south of the OLD racks' frame
    expect(SOCKET_RACK.faceX).toBeGreaterThan(TIRE_BAY.doorHalfWidth + 0.3);
    expect(SOCKET_RACK.z + 0.20).toBeLessThan(RACK.oldZ[0] - 0.45);
  });

  it('keeps the cluster on the nuts while the sockets are on them', () => {
    for (const v of TIRE_VEHICLES) {
      const c = tireCycle(v);
      for (const axle of ['f', 'r']) {
        const at = (id: string) => c.steps.find((s) => s.id === `${axle}_${id}`)!.end.W.a;
        const hub = axle === 'f' ? HUB_ANGLE[0] : HUB_ANGLE[1];
        for (const id of ['nuts_on', 'unbolt', 'nuts_back', 'align', 'mount', 'nuts_in', 'torque']) expect(at(id), `${v.key} ${axle}_${id}`).toBe(hub);
        expect(at('nuts_out'), v.key).toBe(0);
      }
    }
  });
});

