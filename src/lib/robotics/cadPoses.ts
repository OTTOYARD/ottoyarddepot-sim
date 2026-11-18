// ============================================================================
// cadPoses.ts — the poses the CAD's clash check (cad/clash.py) places each robot in.
//
// They come from the twin's own pose code, through the same mappings the Robotics tab plays: every pose preset, and the
// middle and the end of every step of each robot's cycle (catalog.cycleScript). cad/spec/poses.json is this, written
// by cadPoses.test.ts (CAD_SPEC_WRITE=1), so the clash check tests the moves the twin makes, not moves the CAD invents.
// The tire bay has a second program, the quarterly rotation (otto-q-core 0842): the middle and end of each of its steps
// the replacement cycle does not already make are tested too (`rotation:`), on the same model.
// ============================================================================
import { cycleScript, posePresets, type RobotKey } from './catalog';
import { CYCLE_MODEL, TIRE_VEHICLES, tireAngles, tireCycle } from '@/lib/ottoTire/tireProgram';

export interface CadPose { id: string; angles: Record<string, number> }

const round = (v: number) => Math.round(v * 1e6) / 1e6;
const clean = (a: Record<string, number>) => Object.fromEntries(Object.entries(a).map(([k, v]) => [k, round(v)]));

export function cadPoses(): { version: 1; robots: Record<RobotKey, CadPose[]> } {
  const robots = {} as Record<RobotKey, CadPose[]>;
  for (const k of ['charge_arm', 'clean_arm', 'wash_gantry', 'tire_bay'] as RobotKey[]) {
    const out: CadPose[] = posePresets(k).map((p) => ({ id: `pose:${p.id}`, angles: clean(p.angles) }));
    const s = cycleScript(k);
    let t0 = 0;
    for (const step of s.steps) {
      for (const [tag, f] of [['mid', 0.5], ['end', 0.999]] as const) {
        const at = s.at(t0 + step.seconds * f);
        out.push({ id: `cycle:${step.id}:${tag}`, angles: clean(at.angles) });
      }
      t0 += step.seconds;
    }
    if (k === 'tire_bay') {
      const v = TIRE_VEHICLES.find((x) => x.key === CYCLE_MODEL)!;
      const made = new Set(tireCycle(v, 'replacement').steps.map((st) => st.id));
      const rot = tireCycle(v, 'rotation');
      rot.steps.forEach((st, i) => {
        if (made.has(st.id)) return;
        for (const [tag, u] of [['mid', 0.5], ['end', 0.999]] as const) {
          out.push({ id: `rotation:${st.id}:${tag}`, angles: clean(tireAngles(rot.stateAt(i, u))) });
        }
      });
    }
    robots[k] = out;
  }
  return { version: 1, robots };
}
