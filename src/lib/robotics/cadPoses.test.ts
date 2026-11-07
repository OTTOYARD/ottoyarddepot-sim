// cad/spec/poses.json is the twin's poses for the CAD's clash check (cadPoses.ts). Rewrite it with
//   CAD_SPEC_WRITE=1 npx vitest run src/lib/robotics/cadPoses.test.ts
// then rerun the clash check (cad/README.md).
import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cadPoses } from './cadPoses';

const FILE = resolve(__dirname, '../../../cad/spec/poses.json');

describe('cad/spec/poses.json', () => {
  it('is the twin\'s poses, exactly (the clash check tests the twin\'s own moves)', () => {
    const fresh = JSON.parse(JSON.stringify(cadPoses()));
    if (process.env.CAD_SPEC_WRITE === '1') writeFileSync(FILE, JSON.stringify(fresh, null, 1) + '\n');
    const committed = JSON.parse(readFileSync(FILE, 'utf8'));
    expect(committed).toEqual(fresh);
  });

  it('covers every robot with its presets and both ends of every cycle step', () => {
    const p = cadPoses().robots;
    for (const k of ['charge_arm', 'clean_arm', 'wash_gantry'] as const) {
      expect(p[k].some((x) => x.id.startsWith('pose:'))).toBe(true);
      expect(p[k].filter((x) => x.id.startsWith('cycle:')).length % 2).toBe(0);
    }
  });
});
