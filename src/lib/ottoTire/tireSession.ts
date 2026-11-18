/**
 * THE TIRE SESSION — what a service bay's OTTO-TIRE machine is doing this frame, reduced from what the twin says is
 * true. The wash machine's shape (ottoWash/washSession.ts) for the same reasons: pure in (previous session, inputs), no
 * module state, and the machine finishes on the car it started on.
 *
 * THE TWIN OWNS THE SEAT, THE RENDERER OWNS THE CHOREOGRAPHY. OTTO-Q seats a car in a service bay for its tire work
 * (otto-q-core 0842: a worn set replaced, or the quarterly rotation) and times the seat, and the snapshot says when the
 * seat started, when it ends and what work it is for (0762 `bay_seat`, 0843 `work`). This reducer plays the machine's
 * program for the car's own model (tireProgram.ts) inside that window:
 *   · it STARTS when the car stands on the bay's pose, its seat is on, and the seat's work is a tire job; a seat for any
 *     other work (a fault repair, preventive maintenance) leaves the machine at home;
 *   · its PACE is fixed as it starts: the program is played to end WORK_END_MARGIN_S before the seat does, no slower than
 *     RATE_MIN and no faster than RATE_MAX times its nominal speed. A page that opens part way through a seat joins the
 *     program where it would be;
 *   · when the seat ends first, or the car is not the one it started on, it FINISHES from wherever it is: every axis goes
 *     home in FINISH_S along a straight line in the machine's state, and the lift lowers the car as it does.
 *
 * The car on the lift: carRise() is how far the lift has raised the car's body above the floor's rest, read from the
 * rams against the car's own sills (a pad touches its sill when the ram's rise equals the sill's height).
 */
import {
  CYCLE_MODEL, TIRE_VEHICLES, homeState, lerpState, tireAngles, tireCycle,
  type BayState, type TireCycle, type TireJob, type TireVehicle,
} from './tireProgram';

/** The program ends this long before the twin's seat does, sim seconds: the car drives off a lowered lift. */
export const WORK_END_MARGIN_S = 20;
/** The program's pace limits, program seconds per sim second. */
export const RATE_MIN = 0.5;
export const RATE_MAX = 2.5;
/** How long the machine takes to go home from wherever it was when the seat ended early, sim seconds. */
export const FINISH_S = 12;

export type TirePhase = 'home' | 'working' | 'finishing';

export interface TireSession {
  phase: TirePhase;
  /** the car this program is for; held to the end, so the machine finishes on the car it started on */
  vehicleId: string | null;
  job: TireJob | null;
  /** the fleet model whose program plays (null: none named, the Model Y's) */
  model: string | null;
  /** program seconds into the cycle */
  t: number;
  /** program seconds per sim second, fixed when the program starts */
  rate: number;
  /** finishing: the machine's state when the seat ended, and sim seconds since */
  from: BayState | null;
  finishT: number;
  /** the car the last finished program was for */
  completedFor: string | null;
}

export const IDLE_TIRE: TireSession = Object.freeze({
  phase: 'home', vehicleId: null, job: null, model: null, t: 0, rate: 1, from: null, finishT: 0, completedFor: null,
}) as TireSession;

export interface TireInput {
  /** sim seconds since the last call */
  dt: number;
  /** the car in this bay, or null */
  vehicleId: string | null;
  /** the twin has this car's seat on in this bay, and the car stands on the bay's pose */
  active: boolean;
  /** the seat's tire job (tireProgram.tireJobFor of the seat's work), or null when it is for other work */
  job: TireJob | null;
  /** the car's fleet model key, or null */
  model: string | null;
  /** sim seconds until the seat ends, or null when the twin published no end */
  endsInS: number | null;
  /** sim seconds since the twin seated the car, or null when it published no start */
  sinceS: number | null;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The fleet vehicle the bay serves for a model key (the Model Y's when the model is unknown). */
export function tireVehicleForModel(model: string | null): TireVehicle {
  return TIRE_VEHICLES.find((v) => v.key === model) ?? TIRE_VEHICLES.find((v) => v.key === CYCLE_MODEL)!;
}

const cycles = new Map<string, TireCycle>();
/** One model's program for one job, built once. */
export function tireCycleFor(model: string | null, job: TireJob): TireCycle {
  const v = tireVehicleForModel(model);
  const key = `${v.key}:${job}`;
  let c = cycles.get(key);
  if (!c) { c = tireCycle(v, job); cycles.set(key, c); }
  return c;
}

/** The step index and fraction at `t` program seconds (clamped to the cycle). */
function locate(c: TireCycle, t: number): { i: number; u: number } {
  let acc = 0;
  for (let i = 0; i < c.steps.length; i++) {
    const s = c.steps[i].seconds;
    if (t < acc + s || i === c.steps.length - 1) return { i, u: s > 0 ? clamp((t - acc) / s, 0, 1) : 1 };
    acc += s;
  }
  return { i: 0, u: 0 };
}

/** The machine's state for a session. */
export function tireStateOf(s: TireSession): BayState {
  if (s.phase === 'working' && s.job) {
    const c = tireCycleFor(s.model, s.job);
    const { i, u } = locate(c, s.t);
    return c.stateAt(i, u);
  }
  if (s.phase === 'finishing' && s.from) return lerpState(s.from, homeState(), clamp(s.finishT / FINISH_S, 0, 1));
  return homeState();
}

/** The machine's joints for a session (tireProgram.tireAngles), what TireBay.tsx draws. */
export function tireSessionAngles(s: TireSession): Record<string, number> {
  return tireAngles(tireStateOf(s));
}

/** The step the program is on, or null at home or finishing: for the car's Q card and the trace. */
export function tireStepOf(s: TireSession): { id: string; label: string } | null {
  if (s.phase !== 'working' || !s.job) return null;
  const c = tireCycleFor(s.model, s.job);
  const st = c.steps[locate(c, s.t).i];
  return { id: st.id, label: st.label };
}

/** How far the lift has raised the car's body above its rest on the floor, metres (0 when it is not on the pads). */
export function carRise(s: TireSession): number {
  if (s.phase === 'home') return 0;
  const v = tireVehicleForModel(s.model);
  const q = tireStateOf(s);
  return Math.max(0, (Math.max(0, q.liftF - v.sillFront) + Math.max(0, q.liftR - v.sillRear)) / 2);
}

/** The car may move only while the machine is at home. */
export const tireLetsCarMove = (s: TireSession): boolean => s.phase === 'home';

/**
 * Advance one session by one step. At most one phase change a call, so no phase is skipped however the inputs move.
 */
export function advanceTireSession(prev: TireSession, input: TireInput): TireSession {
  const dt = Math.max(0, input.dt);
  const sameCar = input.vehicleId !== null && input.vehicleId === prev.vehicleId;

  if (prev.phase === 'home') {
    // the machine has finished on this car: it waits, at home, for the car to leave
    if (input.vehicleId !== null && input.vehicleId === prev.completedFor) return prev;
    // start only for a tire job's seat that is on; once the finished car has gone, forget it
    if (!input.active || !input.job || input.vehicleId === null) {
      return prev.completedFor !== null && input.vehicleId !== prev.completedFor ? { ...prev, completedFor: null } : prev;
    }
    const c = tireCycleFor(input.model, input.job);
    const since = Math.max(0, input.sinceS ?? 0);
    const left = input.endsInS != null ? input.endsInS - WORK_END_MARGIN_S : null;
    // the pace that ends the program WORK_END_MARGIN_S before the seat does, from the seat's own start
    const rate = left != null ? clamp(c.total / Math.max(1, since + left), RATE_MIN, RATE_MAX) : 1;
    const t = Math.min(c.total, since * rate);
    return {
      phase: 'working', vehicleId: input.vehicleId, job: input.job, model: input.model, t, rate,
      from: null, finishT: 0, completedFor: null,
    };
  }

  if (prev.phase === 'working') {
    const c = tireCycleFor(prev.model, prev.job ?? 'replacement');
    if (!input.active || !sameCar) {
      return { ...prev, phase: 'finishing', from: tireStateOf(prev), finishT: 0 };
    }
    const t = prev.t + dt * prev.rate;
    if (t >= c.total) return { ...IDLE_TIRE, completedFor: prev.vehicleId };
    return { ...prev, t };
  }

  // finishing
  const finishT = prev.finishT + dt;
  if (finishT >= FINISH_S) return { ...IDLE_TIRE, completedFor: prev.vehicleId };
  return { ...prev, finishT };
}
