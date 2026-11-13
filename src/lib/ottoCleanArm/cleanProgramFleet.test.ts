/**
 * EVERY FLEET VEHICLE'S CLEAN PROGRAM IS THE ONE ITS CABIN GIVES, AND THE STORED FILE IS CURRENT.
 *
 * cleanProgramFleet.ts makes a program from a cabin profile by rule. The yard reads the stored results
 * (programs/fleetPrograms.json). This makes every program again and fails when the file differs:
 *   CLEAN_PROGRAM_WRITE=1 npx vitest run src/lib/ottoCleanArm/cleanProgramFleet.test.ts
 * writes it. What each program cleans and leaves is pinned here in words, so a change to a vehicle's spec, to the
 * arm or to the rules that moves it is seen.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FLEET_SPECS } from '@/lib/fleetModels/fleet';
import { cabinProfile } from '@/lib/fleetModels/cabin';
import { fleetCleanProgram, type FleetProgramResult } from './cleanProgramFleet';
import { cleanProgramFor, FLEET_PROGRAM_KEYS, type StoredCleanProgram } from './cleanPrograms';
import { GENERIC_PROGRAM } from './cleanArmPose';

const FILE = resolve(__dirname, 'programs/fleetPrograms.json');
const WRITE = process.env.CLEAN_PROGRAM_WRITE === '1';

const round = (v: number) => Math.round(v * 1e6) / 1e6 + 0;
/** A program as the file holds it: six decimals (a micrometre, a millionth of a degree). */
function stored(p: StoredCleanProgram): StoredCleanProgram {
  return {
    pivotZ: round(p.pivotZ),
    visits: p.visits.map((v) => ({
      flank: v.flank, opening: v.opening, aperture: v.aperture, planeZ: round(v.planeZ), readyX: round(v.readyX), scoopY: round(v.scoopY),
      ...(v.turnYaw === undefined ? {} : { turnYaw: round(v.turnYaw) }),
      strokes: v.strokes.map((k) => ({
        cx: round(k.cx), cy: round(k.cy), yaw: round(k.yaw), pitch: round(k.pitch), ext: round(k.ext), nozzle: round(k.nozzle), what: k.what, w: k.w,
      })),
    })),
    notReached: [...p.notReached],
  };
}

describe('the fleet\'s clean programs', () => {
  const made = new Map<string, FleetProgramResult>();
  const out: Record<string, StoredCleanProgram> = {};
  // One test a vehicle: each takes about 9 s of unbroken work, and one test for all six kept its worker silent for
  // 53 s, long enough for the runner to report a timeout on a busy machine (CI, 2026-11-13).
  it.each(FLEET_SPECS.map((spec) => ({ key: spec.key, spec })))('makes $key\'s program', { timeout: 300_000 }, async ({ spec }) => {
    await new Promise((r) => setTimeout(r, 0));
    const t0 = performance.now();
    const r = fleetCleanProgram(cabinProfile(spec));
    made.set(spec.key, r);
    out[spec.key] = stored(r.stored);
    const v = r.stored.visits;
    console.log(`PROGRAM ${spec.key}: ${v.length} visits, ${(performance.now() - t0).toFixed(0)} ms`);
    for (const o of r.openings) console.log(`  ${o.opening}: ${o.used ? 'used' : `NOT USED: ${o.why}`}; cleans ${o.cleaned.join(', ') || 'nothing'}`);
    for (const n of r.stored.notReached) console.log(`  not reached: ${n}`);
    expect(v.length).toBeGreaterThan(0);
  });

  it('the stored file holds exactly those programs', () => {
    expect(Object.keys(out).sort()).toEqual(FLEET_SPECS.map((s) => s.key).sort());
    // in the specs' own order, as the file is written
    const ordered: Record<string, StoredCleanProgram> = {};
    for (const spec of FLEET_SPECS) ordered[spec.key] = out[spec.key];
    const text = `${JSON.stringify(ordered, null, 1)}\n`;
    if (WRITE) writeFileSync(FILE, text);
    expect(existsSync(FILE)).toBe(true);
    expect(JSON.parse(readFileSync(FILE, 'utf8')), 'programs/fleetPrograms.json is stale: run with CLEAN_PROGRAM_WRITE=1').toEqual(ordered);
  });

  it('the yard reads those programs by model key, and the generic one for anything else', () => {
    expect([...FLEET_PROGRAM_KEYS].sort()).toEqual(FLEET_SPECS.map((s) => s.key).sort());
    for (const spec of FLEET_SPECS) {
      const p = cleanProgramFor(spec.key);
      expect(p.key).toBe(spec.key);
      expect(p.pivotZ).toBeCloseTo(spec.dims.width / 2 + 0.2, 6);
    }
    expect(cleanProgramFor(null)).toBe(GENERIC_PROGRAM);
    expect(cleanProgramFor(undefined)).toBe(GENERIC_PROGRAM);
    expect(cleanProgramFor('some_other_car')).toBe(GENERIC_PROGRAM);
  });
});
