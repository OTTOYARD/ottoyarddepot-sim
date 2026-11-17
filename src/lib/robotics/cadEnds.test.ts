// ============================================================================
// cadEnds.test.ts — every rigid line's both ends are held (cad/line_ends.py, public/cad/<robot>.ends.json).
//
// Chase, 2026-11-15: "There cannot be gaps between cables randomly plugging into charging system or just floating off of
// robotic arms with gaps." The clash check's contact test proves each part touches SOMETHING, so a cable held at one end
// passes with its other end in the air: the clean arm's hybrid cable began 28 mm from any part until line_ends.py found it.
// The flexible lines' ends are held by cadDetail.test.ts at every twin pose; this holds the rigid lines' reports: every
// robot's report was measured on the GLB the manifest names, and names no open end.
// ============================================================================
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { PUBLIC_CAD } from '@/test/cadDisk';
import { ROBOT_KEYS, type Manifest } from './catalog';

interface EndsReport { robot: string; glbSha256: string | null; heldWithinMm: number; lines: number; openEnds: { item: string; end: string; gapMm: number | null }[] }

const manifest = JSON.parse(readFileSync(`${PUBLIC_CAD}/manifest.json`, 'utf8')) as Manifest;
/** the rigid lines each robot has at least (its drawn cables, hoses, tubes and conduits), so a report that checks none fails */
const MIN_LINES: Record<string, number> = { charge_arm: 18, clean_arm: 14, wash_gantry: 40, tire_bay: 18 };

describe.each(ROBOT_KEYS)('%s: every rigid line\'s ends are held', (k) => {
  it('has a line-ends report for the GLB it ships, and the report names no open end', () => {
    const file = `${PUBLIC_CAD}/${k}.ends.json`;
    expect(existsSync(file), 'run cad/line_ends.py after cad/build.py').toBe(true);
    const r = JSON.parse(readFileSync(file, 'utf8')) as EndsReport;
    expect(r.glbSha256, 'the report was measured on this GLB (re-run cad/line_ends.py)').toBe(manifest.robots.find((m) => m.key === k)!.glbSha256);
    expect(r.heldWithinMm).toBeLessThanOrEqual(1);
    expect(r.lines).toBeGreaterThanOrEqual(MIN_LINES[k]);
    expect(r.openEnds.map((e) => `${e.item} ${e.end}: ${e.gapMm ?? '?'} mm`)).toEqual([]);
  });
});
