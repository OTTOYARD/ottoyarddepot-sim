import { describe, expect, it } from 'vitest';
import {
  OPS_SHELL, WASH_SHELL, SHELLS, MIN_JAMB_CLEARANCE, doorSpan, solidWallRuns, shellSolids,
  bayEquipmentSolids, canopyColumnYs, cabinetFootprints, CANOPY_MAX_SPAN, CANOPY_COLUMN,
  carportFrames, allStructureSolids, parkedBox, boxesOverlap, boxGap, boxOf, bodyHitsRect,
  SIGN_WALL, signWallRect,
} from './structurePlan';
import {
  CANOPIES, NORTH_LANE_Y, REAR_LANE_Y, SERVICE_BAY_XS, WASH_BAY_XS, BAY_STALL_Y,
  generateStallsV2, routeToStall, routeToEgress,
  LOT, INGRESS, EGRESS, GATE_W, STALL_HALF_DEPTH_U,
} from './sitePlan';
import { CAR_WIDTH } from '@/engine/motion/traffic';

const stalls = generateStallsV2();

describe('building shells — every bay is a real pull-through', () => {
  it('cuts one door per bay, on the bay drive line, in both walls', () => {
    expect(OPS_SHELL.doors.map((d) => d.x)).toEqual([...SERVICE_BAY_XS]);
    expect(WASH_SHELL.doors.map((d) => d.x)).toEqual([...WASH_BAY_XS]);
  });

  it('gives a parked car at least MIN_JAMB_CLEARANCE of daylight to each jamb', () => {
    for (const st of stalls.filter((s) => s.type === 'service' || s.type === 'wash')) {
      const shell = st.type === 'service' ? OPS_SHELL : WASH_SHELL;
      const door = shell.doors.find((d) => Math.abs(d.x - st.position.x) < 1e-9);
      expect(door, st.id).toBeDefined();
      const [a, b] = doorSpan(door!);
      expect(st.position.x - CAR_WIDTH / 2 - a).toBeGreaterThanOrEqual(MIN_JAMB_CLEARANCE);
      expect(b - (st.position.x + CAR_WIDTH / 2)).toBeGreaterThanOrEqual(MIN_JAMB_CLEARANCE);
    }
  });

  it('never lets a door opening run into a partition or an end wall', () => {
    for (const s of SHELLS) {
      for (const d of s.doors) {
        const [a, b] = doorSpan(d);
        expect(a).toBeGreaterThan(s.footprint.x0 + s.wallT);
        expect(b).toBeLessThan(s.footprint.x1 - s.wallT);
        for (const px of s.partitions) expect(px < a || px > b, `${s.id} partition ${px} in door ${d.bayId}`).toBe(true);
      }
    }
  });

  it('leaves solid wall between every pair of doors', () => {
    for (const s of SHELLS) {
      const runs = solidWallRuns(s);
      expect(runs.length).toBe(s.doors.length + 1);
      for (const [a, b] of runs) expect(b - a).toBeGreaterThan(1.5);
    }
  });

  it('lets a car drive straight through every bay — collector to rear apron — touching nothing', () => {
    for (const s of SHELLS) {
      const solids = [...shellSolids(s), ...bayEquipmentSolids(s)];
      for (const d of s.doors) {
        for (let y = NORTH_LANE_Y; y >= REAR_LANE_Y; y -= 0.25) {
          const pose = { x: d.x, y, heading: -Math.PI / 2 }; // facing north
          for (const k of solids) {
            expect(bodyHitsRect(pose, k.r), `${d.bayId} at y=${y} hits ${k.kind}`).toBe(false);
          }
        }
      }
    }
  });

  it('routes every bay stall through its own doors (router agrees with the openings)', () => {
    for (const st of stalls.filter((s) => s.type === 'service' || s.type === 'wash')) {
      const shell = st.type === 'service' ? OPS_SHELL : WASH_SHELL;
      const solids = shellSolids(shell);
      const legs = [
        routeToStall({ x: st.position.x, y: NORTH_LANE_Y }, st.position),
        routeToEgress(st.position),
      ];
      for (const path of legs) {
        for (let i = 1; i < path.length; i++) {
          const a = path[i - 1], b = path[i];
          const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.5));
          const heading = Math.atan2(b.y - a.y, b.x - a.x);
          for (let k = 0; k <= n; k++) {
            const pose = { x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n, heading };
            for (const sd of solids) expect(bodyHitsRect(pose, sd.r, 0.05), `${st.id} route hits ${sd.kind}`).toBe(false);
          }
        }
      }
    }
  });
});

describe('charging canopy spine columns', () => {
  const cabs = cabinetFootprints();

  it('stand clear of every charger cabinet', () => {
    for (const c of CANOPIES) {
      for (const y of canopyColumnYs(c, cabs)) {
        const col = boxOf({ x0: c.cx - CANOPY_COLUMN / 2, x1: c.cx + CANOPY_COLUMN / 2, y0: y - CANOPY_COLUMN / 2, y1: y + CANOPY_COLUMN / 2 });
        for (const k of cabs) expect(boxesOverlap(col, k.box), `${c.id} column y=${y} vs ${k.stallId}`).toBe(false);
      }
    }
  });

  it('stand clear of every parked charger car, measured as the angled body it is', () => {
    // The spine is where two columns of 60° noses meet, 1.53u either side of it at the
    // closest. A column is placed only where it clears every car's body (parkedBox).
    for (const c of CANOPIES) {
      for (const y of canopyColumnYs(c, cabs)) {
        const col = boxOf({ x0: c.cx - CANOPY_COLUMN / 2, x1: c.cx + CANOPY_COLUMN / 2, y0: y - CANOPY_COLUMN / 2, y1: y + CANOPY_COLUMN / 2 });
        for (const st of stalls.filter((s) => s.type === 'dcfc' || s.type === 'l2')) {
          expect(boxGap(col, parkedBox(st.position)), `${c.id} column y=${y} vs ${st.id}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('carry the roof with no span over the limit and a column near each end', () => {
    for (const c of CANOPIES) {
      const ys = canopyColumnYs(c, cabs);
      expect(ys.length, c.id).toBeGreaterThanOrEqual(4);
      expect(ys[0] - c.y).toBeLessThanOrEqual(6);
      expect(c.y + c.h - ys[ys.length - 1]).toBeLessThanOrEqual(6);
      for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeLessThanOrEqual(CANOPY_MAX_SPAN + 1e-9);
    }
  });
});

describe('perimeter carports', () => {
  it('put every column under its own roof', () => {
    for (const f of carportFrames()) {
      for (const c of f.columns) {
        expect(c.x).toBeGreaterThanOrEqual(f.roof.x0);
        expect(c.x).toBeLessThanOrEqual(f.roof.x1);
        expect(c.y).toBeGreaterThanOrEqual(f.roof.y0);
        expect(c.y).toBeLessThanOrEqual(f.roof.y1);
      }
      expect(f.columns.length, f.runId).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('no built thing stands inside a parking stall', () => {
  it('holds for every stall in the plan', () => {
    const solids = allStructureSolids();
    const hits: string[] = [];
    for (const st of stalls) {
      // the car as it lies — an angled charger car is not square to the plan
      const fp = parkedBox(st.position);
      for (const k of solids) {
        // the office block legitimately contains nothing; bays contain their own car
        if (boxesOverlap(fp, k.box)) hits.push(`${st.id} x ${k.kind}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it('parks no car on top of another (every stall body clears every other)', () => {
    const hits: string[] = [];
    for (let i = 0; i < stalls.length; i++) {
      for (let j = i + 1; j < stalls.length; j++) {
        if (boxesOverlap(parkedBox(stalls[i].position), parkedBox(stalls[j].position))) hits.push(`${stalls[i].id} x ${stalls[j].id}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it('keeps bay cars inside their bay (sanity: stall y is between the walls)', () => {
    for (const s of SHELLS) {
      expect(BAY_STALL_Y).toBeGreaterThan(s.footprint.y0 + s.wallT + 5.1);
      expect(BAY_STALL_Y).toBeLessThan(s.footprint.y1 - s.wallT - 5.1);
    }
  });
});

describe('the OTTOYARD entrance sign wall', () => {
  // Founder, 2026-10-01: the sign wall stood across the ends of S2 stalls 2..5.
  const sign = signWallRect();

  it('stands outside the fence and its curb, short of the public road', () => {
    expect(sign.y0).toBeGreaterThan(LOT.y + LOT.h + 0.8); // fence 206 + curb overhang
    expect(sign.y1).toBeLessThan(208.5);                  // road asphalt (DepotGround z -105 +/- 6.5)
    expect(sign.y1 - sign.y0).toBeCloseTo(SIGN_WALL.d, 9);
  });

  it('touches no stall footprint (its full painted depth, not just the car)', () => {
    const hits: string[] = [];
    for (const st of stalls) {
      const fp = { ...parkedBox(st.position), hl: Math.max(STALL_HALF_DEPTH_U, parkedBox(st.position).hl), hw: 3.5 };
      if (boxGap(fp, boxOf(sign)) < 0.5) hits.push(st.id);
    }
    expect(hits).toEqual([]);
  });

  it('keeps clear of both gate throats and of the arrival queue', () => {
    for (const g of [INGRESS, EGRESS]) {
      const gx0 = g.x - GATE_W / 2, gx1 = g.x + GATE_W / 2;
      expect(Math.max(gx0 - sign.x1, sign.x0 - gx1), `gate at x ${g.x}`).toBeGreaterThan(20);
    }
    // arrivals queue EAST of the IN gate on the approach road (TwinMotionDriver, x >= INGRESS.x + 6)
    expect(sign.x1).toBeLessThan(INGRESS.x - GATE_W / 2 - 20);
  });
});
