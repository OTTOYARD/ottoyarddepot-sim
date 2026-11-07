// The CAD reads its interface dimensions from cad/spec/robots.json. This test holds that snapshot
// equal to the twin's own robot specs, so a change to an arm, the wash gantry or the car cannot
// leave the engineering CAD describing a different machine. Rewrite it with
//   CAD_SPEC_WRITE=1 npx vitest run src/lib/robotics/cadSpec.test.ts
// and rebuild the CAD (cad/README.md).
import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cadSpec } from './cadSpec';

const FILE = resolve(__dirname, '../../../cad/spec/robots.json');

describe('cad/spec/robots.json', () => {
  it('is the twin specs, exactly (one home for every robot number)', () => {
    const fresh = JSON.parse(JSON.stringify(cadSpec()));
    if (process.env.CAD_SPEC_WRITE === '1') writeFileSync(FILE, JSON.stringify(fresh, null, 2) + '\n');
    const committed = JSON.parse(readFileSync(FILE, 'utf8'));
    expect(committed).toEqual(fresh);
  });

  it('keeps the charge arm reach that the clearance tests measured', () => {
    const s = cadSpec().chargeArm;
    // 1.68 x (0.80 + 0.68 + 0.16 + 0.22) m, cobotSpec's sizing
    expect(s.upperArm + s.forearm + s.wrist + s.tool).toBeCloseTo(1.68 * 1.86, 3);
    expect(s.mountHeight).toBe(0.55);
  });
});
