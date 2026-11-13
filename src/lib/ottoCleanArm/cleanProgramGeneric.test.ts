/**
 * THE GENERIC CAR'S PROGRAM IS THE CYCLE THE ARM ALWAYS PLAYED.
 *
 * cleanArmPose took its strokes, its aperture plane, its entry height and its ready points from module constants
 * until 2026-11-13; they are now a CleanProgram, and the generic car's is GENERIC_PROGRAM. This pins that program to
 * the joints the old code gave, to the last bit: __fixtures__/genericCleanJoints.json was written by the code as it
 * stood at ed3cb95, before the change (every phase, both stall sides; the clean phases at 61 points, the moves at 13).
 */
import { describe, it, expect } from 'vitest';
import PINNED from './__fixtures__/genericCleanJoints.json';
import {
  CLEAN_CHAIN, CLEAN_PHASE_S, CLEAN_MOTION_S, cleanChainFor, phaseMove, phaseVisit, wandMayBeInside, isCleanWork,
  type CleanPhase,
} from './cleanArmSpec';
import { cleanJointsAt, sidesFor, GENERIC_PROGRAM, STROKES, SCOOP_Y, phaseSide, makeCleanProgram } from './cleanArmPose';
import { cleanProgramFor } from './cleanPrograms';

const pinned = PINNED as unknown as Record<string, number[][]>;

describe('the generic clean program', () => {
  it('gives exactly the joints the single-program code gave, every phase, both stall sides', () => {
    let n = 0;
    for (const toward of [1, -1] as const) {
      for (const phase of ['home', ...CLEAN_CHAIN] as CleanPhase[]) {
        const rows = pinned[`${toward}:${phase}`];
        expect(rows, `${toward}:${phase}`).toBeDefined();
        rows.forEach((row, i) => {
          const t = i / (rows.length - 1);
          for (const q of [cleanJointsAt(phase, t, sidesFor(toward)), cleanJointsAt(phase, t, sidesFor(toward), { program: GENERIC_PROGRAM })]) {
            expect([q.t1, q.t2, q.foot, q.yaw, q.pitch, q.ext, q.nozzle], `${toward}:${phase}@${t}`).toEqual(row);
            n++;
          }
        });
      }
    }
    // two sides x (home + seventeen moves at 13 points + two cleans at 61) x two ways of asking
    expect(n).toBe(2 * (18 * 13 + 2 * 61) * 2);
  });

  it('is two visits, one a flank, the far flank first, on the chain and the timing the cycle always had', () => {
    expect(GENERIC_PROGRAM.visits.map((v) => v.flank)).toEqual(['far', 'port']);
    expect(GENERIC_PROGRAM.visits.every((v) => v.strokes === STROKES && v.scoopY === SCOOP_Y && v.turnYaw === undefined)).toBe(true);
    expect([...GENERIC_PROGRAM.chain]).toEqual([...CLEAN_CHAIN]);
    expect(CLEAN_CHAIN).toEqual([
      'doors_open', 'swing_a', 'lower_a', 'descend_a', 'enter_a', 'clean_a', 'exit_a', 'ascend_a', 'raise_a',
      'swing_b', 'lower_b', 'descend_b', 'enter_b', 'clean_b', 'exit_b', 'ascend_b', 'raise_b', 'return', 'doors_close',
    ]);
    expect(GENERIC_PROGRAM.seconds).toEqual(CLEAN_PHASE_S);
    expect(CLEAN_MOTION_S).toBe(52);
    expect(cleanProgramFor(null)).toBe(GENERIC_PROGRAM);
  });

  it('names every phase of a longer chain by its move and its visit', () => {
    const chain = cleanChainFor(4);
    expect(chain.length).toBe(1 + 4 * 8 + 2);
    expect(chain.filter(isCleanWork)).toEqual(['clean_a', 'clean_b', 'clean_c', 'clean_d']);
    expect(chain.filter(wandMayBeInside).length).toBe(12);
    expect(phaseMove('ascend_d')).toBe('ascend');
    expect(phaseVisit('ascend_d')).toBe(3);
    expect(phaseMove('doors_open')).toBeNull();
    expect(phaseVisit('return')).toBe(-1);
    // a program with two openings a flank: far front, far rear, port front, port rear
    const v = GENERIC_PROGRAM.visits[0];
    const four = makeCleanProgram('four', GENERIC_PROGRAM.pivotZ, [
      { ...v, flank: 'far' }, { ...v, flank: 'far', readyX: -0.6 }, { ...v, flank: 'port' }, { ...v, flank: 'port', readyX: -0.6 },
    ]);
    const sides = sidesFor(-1);
    expect(['clean_a', 'clean_b', 'clean_c', 'clean_d'].map((p) => phaseSide(p as CleanPhase, sides, four))).toEqual([1, 1, -1, -1]);
    // the first swing 4 s, a swing along the flank 3 s, a swing across the roof 5 s
    expect([four.seconds.swing_a, four.seconds.swing_b, four.seconds.swing_c, four.seconds.swing_d]).toEqual([4, 3, 5, 3]);
  });
});
