import { describe, it, expect } from "vitest";
import { KinematicCar, DEFAULT_CAR_PARAMS, wrapAngle } from "./KinematicCar";
import { PathTracker } from "./PathTracker";
import { idmAccel, freeRoadAccel, DEFAULT_IDM } from "./idm";

describe("KinematicCar — no lateral slide, real arcs", () => {
  it("driving straight moves ONLY along the heading (zero lateral motion)", () => {
    // heading north (+y); steer 0; drive forward
    const car = new KinematicCar({ x: 10, y: 10, heading: Math.PI / 2 }, DEFAULT_CAR_PARAMS);
    car.steer = 0;
    for (let i = 0; i < 50; i++) car.step(0.05, 13, 0);
    expect(Math.abs(car.x - 10)).toBeLessThan(1e-6); // x never drifts → NO slide
    expect(car.y).toBeGreaterThan(11);                // advanced north
    expect(Math.abs(wrapAngle(car.heading - Math.PI / 2))).toBeLessThan(1e-6);
  });

  it("a steady steering angle produces a circular arc of radius R = L/tan(δ)", () => {
    const car = new KinematicCar({ x: 0, y: 0, heading: 0 }, DEFAULT_CAR_PARAMS);
    const delta = 0.3; // below maxSteer
    car.steer = delta; // pin steering (bypass the ramp) to measure steady-state
    car.speed = 13;    // start at cruise (no accel ramp) for a clean arc
    const h0 = car.heading;
    let dist = 0;
    for (let i = 0; i < 30; i++) {
      const x0 = car.x, y0 = car.y;
      car.step(0.05, 13, delta);
      dist += Math.hypot(car.x - x0, car.y - y0);
    }
    const dTheta = Math.abs(wrapAngle(car.heading - h0));
    const radius = dist / dTheta;
    const expected = DEFAULT_CAR_PARAMS.wheelbase / Math.tan(delta);
    expect(radius).toBeCloseTo(expected, 0); // arc radius matches the bicycle model
    // and it genuinely curved — both x and y changed (not a straight slide)
    expect(Math.abs(car.x)).toBeGreaterThan(1);
    expect(Math.abs(car.y)).toBeGreaterThan(1);
  });

  it("respects the minimum turn radius (steering is clamped to maxSteer)", () => {
    const car = new KinematicCar({ x: 0, y: 0, heading: 0 }, DEFAULT_CAR_PARAMS);
    const h0 = car.heading;
    let dist = 0;
    // command WAY past lock; the model must clamp to maxSteer → R_min
    for (let i = 0; i < 40; i++) {
      const x0 = car.x, y0 = car.y;
      car.step(0.05, 13, 5);
      dist += Math.hypot(car.x - x0, car.y - y0);
    }
    const radius = dist / Math.abs(wrapAngle(car.heading - h0) + 2 * Math.PI * 0 + 1e-9);
    expect(radius).toBeGreaterThanOrEqual(car.minTurnRadius() - 0.5); // never tighter than R_min
  });

  it("can reverse (negative speed moves opposite the heading)", () => {
    const car = new KinematicCar({ x: 10, y: 10, heading: 0 }, DEFAULT_CAR_PARAMS); // facing east
    for (let i = 0; i < 30; i++) car.step(0.05, -4, 0);
    expect(car.x).toBeLessThan(10); // backed up to the west
  });
});

describe("PathTracker + KinematicCar — follows lanes, turns real corners", () => {
  it("steers back onto a straight path it starts offset from", () => {
    const path = Array.from({ length: 41 }, (_, i) => ({ x: i * 5, y: 0 })); // straight east, 200u
    const tracker = new PathTracker(path);
    const car = new KinematicCar({ x: 0, y: 6, heading: 0 }, DEFAULT_CAR_PARAMS); // 6u left of path
    car.speed = 13; // cruise
    for (let i = 0; i < 260; i++) {
      const { steer } = tracker.steer(car.pose, 4 + 0.25 * car.speed, car.params.wheelbase);
      car.step(0.05, 13, steer);
    }
    expect(Math.abs(car.y)).toBeLessThan(1.0); // converged onto the path (y≈0)
  });

  it("drives an L-shaped route and physically TURNS ~90° at the corner", () => {
    // east to (60,0), then north to (60,60)
    const path = [
      ...Array.from({ length: 13 }, (_, i) => ({ x: i * 5, y: 0 })),
      ...Array.from({ length: 12 }, (_, i) => ({ x: 60, y: (i + 1) * 5 })),
    ];
    const tracker = new PathTracker(path);
    const car = new KinematicCar({ x: 0, y: 0, heading: 0 }, DEFAULT_CAR_PARAMS);
    for (let i = 0; i < 500 && !tracker.atEnd(2); i++) {
      const { steer } = tracker.steer(car.pose, 5 + 0.4 * car.speed, car.params.wheelbase);
      car.step(0.05, 13, steer);
    }
    // reached the far end of the L
    expect(Math.hypot(car.x - 60, car.y - 60)).toBeLessThan(6);
    // and it actually turned from heading east (0) to heading north (≈ +π/2)
    expect(Math.abs(wrapAngle(car.heading - Math.PI / 2))).toBeLessThan(0.5);
  });
});

describe("IDM — collision-free queueing (no stacking)", () => {
  it("free road accelerates toward v0 then stops accelerating", () => {
    expect(freeRoadAccel(0)).toBeGreaterThan(0);
    expect(freeRoadAccel(DEFAULT_IDM.v0)).toBeCloseTo(0, 5);
    expect(idmAccel(2, Infinity, 0)).toBeGreaterThan(0); // no leader → speed up
  });

  it("brakes when closing on a slower/stopped leader", () => {
    // moving 10 u/s, only 6u behind a stopped car → must brake hard
    expect(idmAccel(10, 6, 0)).toBeLessThan(0);
  });

  it("a follower settles to a safe gap behind a stopped leader — never overlaps", () => {
    // leader parked at x=100 (stopped). follower approaches from x=0.
    let x = 0, v = 13;
    const leaderX = 100;
    for (let i = 0; i < 2000; i++) {
      const gap = leaderX - x - 5; // minus a car length
      const a = idmAccel(v, Math.max(gap, 0), 0);
      v = Math.max(0, v + a * 0.05);
      x += v * 0.05;
      expect(leaderX - x).toBeGreaterThan(0); // NEVER drives through the leader
    }
    expect(v).toBeLessThan(0.3);                       // came to rest
    const finalGap = leaderX - x - 5;
    expect(finalGap).toBeGreaterThan(DEFAULT_IDM.s0 - 1.5); // parked ~s0 behind
    expect(finalGap).toBeLessThan(DEFAULT_IDM.s0 + 3);
  });
});
