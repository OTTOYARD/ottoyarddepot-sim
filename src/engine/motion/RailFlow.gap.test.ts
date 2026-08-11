// ============================================================================
// RailFlow — the following-gap budget must reserve the body the cockpit DRAWS.
//
// These tests exist because it did not. RailFlow budgeted `CAR_LENGTH * 0.55`
// = 4.125 u of following gap while the cockpit draws a 10.2 u body, so a queue
// that IDM had settled perfectly at its 5 u jam gap sat 9.125 u centre-to-
// centre — 1.075 u of permanent body overlap, with every car straight and
// every car stopped. Nothing in the sim was moving wrongly; the arithmetic was.
//
// Every assertion below measures BODY OVERLAP (spacing minus a whole body
// length), never centre distance. Centre distance is the wrong test in this
// depot: perimeter stalls pitch 5.7 u apart, so a centre-distance rule reads
// every pair of parked neighbours as a pile-up.
// ============================================================================
import { describe, it, expect } from "vitest";
import { buildRail, stepRail, RailLocks, type RailBody } from "./RailFlow";
import { CAR_BODY_LENGTH, CAR_BODY_WIDTH } from "./traffic";
import { CAR_L, CAR_W } from "../__fixtures__/replay";
import { DEFAULT_IDM } from "./idm";

/** A long straight rail heading east — no nodes, no column mouth, so the only
 *  thing that can slow a car on it is the leader gap under test. */
const straightRail = () => buildRail([{ x: 0, y: 0 }, { x: 300, y: 0 }], [], null);

/** Run `r` to a standstill (or `seconds`), with `bodies` re-read each step. */
function settle(id: string, r: ReturnType<typeof buildRail>, bodies: () => RailBody[], seconds = 120) {
  const locks = new RailLocks();
  const dt = 0.05;
  for (let t = 0; t < seconds / dt; t++) {
    if (stepRail(id, r, dt, bodies(), locks) === null) break;
  }
}

describe("RailFlow — the gap budget is the drawn body", () => {
  it("DRIFT PIN: the budgeted body is the body the overlap metric measures", () => {
    // The bug was never the number 4.125 on its own — it was that the gap
    // budget and the drawn footprint were two independent literals. This is the
    // alarm on that: replay.ts's CAR_L/CAR_W are the dimensions VehicleDot
    // draws and the dimensions bodiesOverlap() tests. If a renderer change
    // moves them and the traffic model is not moved with it, this fails here
    // rather than silently re-arming permanent overlap in the cockpit.
    expect(CAR_BODY_LENGTH).toBe(CAR_L);
    expect(CAR_BODY_WIDTH).toBe(CAR_W);
  });

  it("stops a whole body length behind a stationary car, not 40% of one", () => {
    const r = straightRail();
    const parked: RailBody[] = [{ id: "lead", x: 100, y: 0, heading: 0, moving: false }];
    settle("follower", r, () => parked);

    const spacing = 100 - r.s; // centre-to-centre along the rail
    const bodyClearance = spacing - CAR_BODY_LENGTH; // bumper-to-bumper
    expect(bodyClearance).toBeGreaterThanOrEqual(0); // THE defect: this was −1.075

    // IDM settles a stopped follower at its jam gap, so the clearance lands on
    // s0 — never under it, because the forward scan walks the rail in 2 u SAMPLE
    // steps and takes the NEAREST sample the body falls within, which rounds the
    // measured distance down and so errs conservative. Bounded above as well, so
    // "it stopped 80 u short" cannot pass as a fix. Measured 5.45.
    expect(bodyClearance).toBeGreaterThanOrEqual(DEFAULT_IDM.s0);
    expect(bodyClearance).toBeLessThanOrEqual(DEFAULT_IDM.s0 + 2);
  });

  it("holds no-overlap down a three-car queue, not just for the first follower", () => {
    // Overlap in the busy_day fixture was a QUEUE artefact — one pair proves the
    // arithmetic, a queue proves it composes, because each follower's stop point
    // is set by a leader that is itself stopped short.
    const parked: RailBody = { id: "lead", x: 100, y: 0, heading: 0, moving: false };
    const rails = [straightRail(), straightRail(), straightRail()];
    const ids = ["q1", "q2", "q3"];
    const locks = new RailLocks();
    const dt = 0.05;
    for (let t = 0; t < 240 / dt; t++) {
      const bodies: RailBody[] = [parked];
      rails.forEach((r, i) => bodies.push({ id: ids[i], x: r.s, y: 0, heading: 0, moving: true }));
      // stagger the starts so they queue up rather than launching abreast
      rails.forEach((r, i) => {
        if (t * dt < i * 6) return;
        stepRail(ids[i], r, dt, bodies, locks);
      });
    }

    const xs = [100, ...rails.map((r) => r.s)].sort((a, b) => b - a);
    for (let i = 1; i < xs.length; i++) {
      expect(xs[i - 1] - xs[i]).toBeGreaterThanOrEqual(CAR_BODY_LENGTH);
    }
  });

  it("does not brake for an ONCOMING car — the divided road still passes", () => {
    // The gap budget got 2.5x bigger, which is 2.5x more road on which a car
    // could wrongly decide an oncoming body is its leader. It must not: real
    // crossings are serialised by the node locks, and braking for the far lane
    // is what caused the pass-freeze this rule was added to kill.
    const r = straightRail();
    const oncoming: RailBody[] = [{ id: "opp", x: 40, y: 0, heading: Math.PI, moving: true }];
    const locks = new RailLocks();
    for (let t = 0; t < 200; t++) stepRail("me", r, 0.05, oncoming, locks);
    expect(r.v).toBeGreaterThan(1); // still rolling, not stopped short of it
  });

  it("breaks a co-spawn deadlock, and breaks it for exactly ONE of the pair", () => {
    // The driver can admit two cars onto two rails at the SAME ingress point
    // (measured 0.26 u apart in the docking probe). Each reads the other as a
    // leader ~2 u ahead, each brakes to zero for the other, and with the honest
    // 10.2 u budget both sat at s=0 forever — 5 of 40 cars in that probe never
    // reached their charger. The end-to-end case is TwinMotionDriver.docking
    // scenario B; what is pinned here is the rule that resolves it.
    //
    // `peer` is a MOVING body sitting on top of the car and going nowhere —
    // exactly what the other half of a deadlocked pair looks like.
    const peer: RailBody[] = [{ id: "mm", x: 2, y: 0.5, heading: 0, moving: true }];

    const lower = straightRail(); // id "aa" < "mm" — this one yields nothing and goes
    settle("aa", lower, () => peer, 60);
    expect(lower.s).toBeGreaterThan(20);

    const higher = straightRail(); // id "zz" > "mm" — this one keeps waiting
    settle("zz", higher, () => peer, 60);
    expect(higher.s).toBe(0);
  });

  it("does NOT let a wedged car creep through a PARKED body", () => {
    // The breaker is for two cars that will both drive away. A parked body will
    // never clear, so pushing into it is strictly worse than waiting — the car
    // stays put however long it has been wedged.
    const r = straightRail();
    const parked: RailBody[] = [{ id: "parked", x: 2.5, y: 0.4, heading: 0, moving: false }];
    settle("me", r, () => parked, 200);
    expect(r.stationaryFor).toBeGreaterThan(8); // it IS wedged, so the gate is live
    expect(r.s).toBe(0);
  });

  it("clamps to a full stop when a body is already inside it (fails to the safe side)", () => {
    // Bodies overlapping is a state the sim can reach from outside RailFlow (a
    // dock, a snap, a reconcile). The budget must then read a NEGATIVE gap and
    // clamp to 0 — an emergency stop — never a negative gap fed to IDM.
    const r = straightRail();
    r.v = 6;
    const inside: RailBody[] = [{ id: "inside", x: 4, y: 0, heading: 0, moving: false }];
    const locks = new RailLocks();
    for (let t = 0; t < 100; t++) stepRail("me", r, 0.05, inside, locks);
    expect(r.v).toBe(0);
  });
});
