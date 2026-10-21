// ============================================================================
// THE WASH GATE AT ANY FRAME RATE.
//
// The machine plays inside the twin's seat, on the sim clock. A slow frame (a phone, a
// headless browser drawing a frame a second, a background tab coming back, 8x playback)
// hands the gate several sim seconds at once. The gate plays them in small steps, so the
// machine finishes the program the twin timed, whatever the frame rate.
// ============================================================================
import { describe, it, expect } from "vitest";
import { WashGate, WASH_SUBSTEP_S, WASH_HOLD_CAP_S } from "./washGate";
import { advanceWashSession, IDLE_WASH, type WashSession } from "@/lib/ottoWash/washSession";
import { WASH_EXTERIOR, washChain } from "@/lib/ottoWash/washSpec";

const BAY = "WASH-01";
const CAR = "car-1";

interface Trace { t: number; phase: string; finishing: boolean; mayMove: boolean }

/**
 * One seat of `seatS` sim seconds, the car on the bay's pose from `onPoseS` to the seat's end, played at `frameS`
 * sim seconds a frame. Returns what the gate held at each frame.
 */
function play(interior: boolean, seatS: number, frameS: number, onPoseS = 20, gate = new WashGate()): Trace[] {
  const trace: Trace[] = [];
  for (let t = 0; t <= seatS + 60; t += frameS) {
    const active = t >= onPoseS && t < seatS;
    gate.step(t === 0 ? 0 : frameS, [{
      bayId: BAY, vehicleId: CAR, active, interior,
      endsInS: t < seatS ? seatS - t : null, sinceS: t < seatS ? t : null,
    }]);
    const s = gate.session(BAY) ?? IDLE_WASH;
    trace.push({ t, phase: s.phase, finishing: s.finishing, mayMove: gate.mayMove(BAY) });
  }
  return trace;
}

const phasesOf = (trace: Trace[]) => {
  const out: string[] = [];
  for (const s of trace) if (out[out.length - 1] !== s.phase) out.push(s.phase);
  return out;
};
/** The first frame after the last air-dry pass: the program's end, or Infinity when it never got there. */
const passesEndAt = (trace: Trace[]) => {
  const last = trace.map((s) => s.phase).lastIndexOf("dry_2");
  return last < 0 || last + 1 >= trace.length ? Infinity : trace[last + 1].t;
};
/** The first frame the machine was home again after leaving it. */
const homeAt = (trace: Trace[]) => {
  const left = trace.findIndex((s) => s.phase !== "home");
  const back = trace.findIndex((s, i) => i > left && s.phase === "home");
  return left < 0 || back < 0 ? Infinity : trace[back].t;
};

describe("the wash gate keeps the machine on the twin's clock at any frame rate", () => {
  // 60 fps at 3x is 0.05 sim-s a frame; one frame a second at 3x is 3 s, at 8x 8 s
  const RATES = [0.05, 1, 3, 8];

  for (const interior of [false, true]) {
    const seat = interior ? 990 : 300; // the twin's nominal robotic detail (16.5 min) and wash (5.0 min)
    for (const frame of RATES) {
      it(`plays every pass of a ${interior ? "detail" : "wash"} seat at ${frame} sim-s a frame, and is home before the seat ends`, () => {
        const trace = play(interior, seat, frame);
        const seen = phasesOf(trace);
        // the passes and the vacuum outlast any frame here; a 2.5 s settle can start and end between two samples
        for (const p of [...(interior ? ["vacuum"] : []), ...WASH_EXTERIOR]) expect(seen, `${p} at ${frame}`).toContain(p);
        expect(trace.some((s) => s.finishing), "cut off by the seat's end").toBe(false);
        expect(homeAt(trace)).toBeLessThanOrEqual(seat);
      });
    }
  }

  it("ends its last pass within a frame of where it ends at 60 fps", () => {
    for (const interior of [false, true]) {
      const seat = interior ? 990 : 300;
      const smooth = passesEndAt(play(interior, seat, 0.05));
      expect(smooth).toBeLessThan(seat);
      for (const frame of [1, 3, 8]) {
        const slow = passesEndAt(play(interior, seat, frame));
        expect(Math.abs(slow - smooth), `${interior ? "detail" : "wash"} at ${frame}`).toBeLessThanOrEqual(frame + WASH_SUBSTEP_S * washChain(interior).length);
      }
    }
  });

  it("REPRODUCES what it fixes: one reducer call a frame at 3 sim-s, the detail program is cut off in its vacuum", () => {
    // the gate as it was: one call of the reducer per frame, which takes at most 2 s and drops the rest
    let s: WashSession = IDLE_WASH;
    const seat = 830; // run 96371023's car db9d7b6e: seated 14:53:31, timed to 15:07:21 sim
    const seen = new Set<string>();
    let cutIn: string | null = null;
    for (let t = 0; t <= seat + 30; t += 3) {
      const active = t >= 20 && t < seat;
      const prev = s.phase;
      s = advanceWashSession(s, { dt: t === 0 ? 0 : 3, vehicleId: CAR, active, interior: true,
        endsInS: t < seat ? seat - t : null, sinceS: t < seat ? t : null });
      seen.add(s.phase);
      if (s.finishing && cutIn === null) cutIn = prev;
    }
    expect(cutIn).not.toBeNull();
    expect(WASH_EXTERIOR.some((p) => !seen.has(p))).toBe(true);
    // and through the gate, the same seat at the same frame rate runs every pass
    const trace = play(true, seat, 3);
    expect(trace.some((x) => x.finishing)).toBe(false);
    for (const p of WASH_EXTERIOR) expect(phasesOf(trace)).toContain(p);
  });

  it("holds the car while the machine is out and lets it go once it is home, at one frame a second", () => {
    const trace = play(false, 300, 3);
    const home = homeAt(trace);
    for (const s of trace) {
      if (s.phase !== "home" && s.phase !== "done") expect(s.mayMove, `t ${s.t} ${s.phase}`).toBe(false);
    }
    expect(trace.find((s) => s.t >= home)?.mayMove).toBe(true);
  });

  it("still finishes a seat the twin ends early, from wherever the machine is, inside the hold cap", () => {
    // the twin ends a detail seat 400 s in (mid-vacuum), at a frame a second
    const gate = new WashGate();
    let releasedAt = Infinity;
    for (let t = 0; t <= 520; t += 3) {
      const active = t >= 20 && t < 400;
      gate.step(t === 0 ? 0 : 3, [{ bayId: BAY, vehicleId: CAR, active, interior: true,
        endsInS: t < 400 ? 990 - t : null, sinceS: t < 400 ? t : null }]);
      if (t >= 400 && releasedAt === Infinity && gate.mayMove(BAY)) releasedAt = t;
    }
    expect(releasedAt - 400).toBeLessThanOrEqual(WASH_HOLD_CAP_S);
    expect(gate.session(BAY)?.phase ?? "home").toBe("home");
  });

  it("joins a seat already in progress where the twin has it, at one frame a second", () => {
    // a viewer opens the page 300 s into a detail seat: the first frame finds the car well into it
    const gate = new WashGate();
    gate.step(0, [{ bayId: BAY, vehicleId: CAR, active: true, interior: true, endsInS: 690, sinceS: 300 }]);
    expect(gate.session(BAY)?.phase).toBe("vacuum");
    let t = 300;
    const trace: Trace[] = [];
    while (t < 1050) {
      t += 3;
      gate.step(3, [{ bayId: BAY, vehicleId: CAR, active: t < 990, interior: true,
        endsInS: t < 990 ? 990 - t : null, sinceS: t < 990 ? t : null }]);
      const s = gate.session(BAY) ?? IDLE_WASH;
      trace.push({ t, phase: s.phase, finishing: s.finishing, mayMove: gate.mayMove(BAY) });
    }
    expect(trace.some((s) => s.finishing)).toBe(false);
    for (const p of WASH_EXTERIOR) expect(phasesOf(trace)).toContain(p);
  });
});
