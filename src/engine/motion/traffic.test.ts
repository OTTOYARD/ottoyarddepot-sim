import { describe, it, expect } from "vitest";
import { findLeader, separationSteer, StallLedger, CAR_LENGTH, type MovingCar } from "./traffic";

const car = (id: string, x: number, y: number, heading = 0, speed = 0): MovingCar => ({
  id, pose: { x, y, heading }, speed,
});

describe("findLeader — forward-cone leader detection", () => {
  it("finds a car directly ahead in the same lane and reports the bumper gap", () => {
    const me = car("me", 0, 0, 0); // facing east
    const lead = findLeader(me, [car("a", 20, 0, 0, 3)]);
    expect(lead.gap).toBeCloseTo(20 - CAR_LENGTH, 5);
    expect(lead.leaderSpeed).toBe(3);
  });
  it("ignores cars in an adjacent lane (too far laterally)", () => {
    const me = car("me", 0, 0, 0);
    const lead = findLeader(me, [car("a", 20, 8, 0)]); // 8u to the side
    expect(lead.gap).toBe(Infinity);
  });
  it("ignores cars behind", () => {
    const me = car("me", 0, 0, 0);
    const lead = findLeader(me, [car("a", -20, 0, 0)]);
    expect(lead.gap).toBe(Infinity);
  });
  it("picks the NEAREST of several cars ahead", () => {
    const me = car("me", 0, 0, 0);
    const lead = findLeader(me, [car("far", 30, 0, 0, 1), car("near", 15, 0, 0, 2)]);
    expect(lead.gap).toBeCloseTo(15 - CAR_LENGTH, 5);
    expect(lead.leaderSpeed).toBe(2);
  });
});

describe("separationSteer — thin local avoidance", () => {
  it("is zero when no car is within range", () => {
    expect(separationSteer(car("me", 0, 0, 0), [car("a", 40, 40, 0)])).toBe(0);
  });
  it("produces a nonzero nudge when a car is within touching range", () => {
    const s = separationSteer(car("me", 0, 0, 0), [car("a", 2, 3, 0)]);
    expect(Math.abs(s)).toBeGreaterThan(0);
  });
  it("stays gentle (bounded) so it never overrides lane-following", () => {
    // a car right on top → still a small, bounded steering delta
    const s = separationSteer(car("me", 0, 0, 0), [car("a", 0.5, 0, 0)]);
    expect(Math.abs(s)).toBeLessThanOrEqual(0.31); // |clamp(0.6)*weight(0.5)| = 0.3
  });
});

describe("StallLedger — one car per stall", () => {
  it("prevents double-booking a stall", () => {
    const led = new StallLedger();
    expect(led.claim("c1", "DCFC-01")).toBe(true);
    expect(led.claim("c2", "DCFC-01")).toBe(false); // taken
    expect(led.claim("c1", "DCFC-01")).toBe(true);  // idempotent for owner
  });
  it("claimFirstFree skips held stalls", () => {
    const led = new StallLedger();
    led.claim("c1", "L2-01");
    const got = led.claimFirstFree("c2", ["L2-01", "L2-02", "L2-03"]);
    expect(got).toBe("L2-02");
    expect(led.isHeld("L2-02")).toBe(true);
  });
  it("release frees the stall and moving stalls updates the ledger", () => {
    const led = new StallLedger();
    led.claim("c1", "WASH-01");
    led.release("c1");
    expect(led.isHeld("WASH-01")).toBe(false);
    led.claim("c1", "WASH-01");
    led.claim("c1", "WASH-02"); // moved
    expect(led.isHeld("WASH-01")).toBe(false);
    expect(led.stallOf("c1")).toBe("WASH-02");
  });
});
