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
import { measureChargeBeside } from './chargeArmBeside';
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
    beside: { ...p.beside },
  };
}

describe('the fleet\'s clean programs', () => {
  const made = new Map<string, FleetProgramResult>();
  it('makes one for every fleet vehicle, and the stored file holds exactly those', { timeout: 600_000 }, () => {
    const out: Record<string, StoredCleanProgram> = {};
    for (const spec of FLEET_SPECS) {
      const t0 = performance.now();
      const beside = measureChargeBeside(spec, cabinProfile(spec));
      const r = fleetCleanProgram(cabinProfile(spec), beside.facts);
      made.set(spec.key, r);
      out[spec.key] = stored(r.stored);
      const v = r.stored.visits;
      console.log(`PROGRAM ${spec.key}: ${v.length} visits (${v.filter((q) => q.flank === 'far').map((q) => `${q.opening} ${q.strokes.length} keys`).join(', ') || 'none'}), ${(performance.now() - t0).toFixed(0)} ms`);
      for (const o of r.openings) {
        console.log(`  ${o.opening}: ${o.used ? 'used' : `NOT USED: ${o.why}`}; wrist run ${o.corridor ? `${o.corridor[0].toFixed(2)}..${o.corridor[1].toFixed(2)} m` : 'none'}; cleans ${o.cleaned.join(', ') || 'nothing'}${o.left.length ? `; leaves ${o.left.join(', ')}` : ''}`);
      }
      for (const n of r.stored.notReached) console.log(`  not reached: ${n}`);
      const m = (v: number | null) => (v === null ? 'no mate' : v >= 0.58 ? 'over 0.58' : v.toFixed(3));
      console.log(`  BESIDE ${spec.key}: port doors open with the charge arm stowed ${beside.facts.stowed}${beside.facts.parkX === undefined ? '' : ` (parked at ${beside.facts.parkX} m)`}, latched ${beside.facts.latched}; `
        + `measured stowed at the middle ${m(beside.stowedM)} m, latched ${m(beside.latchedM)} m${beside.parkedM === null ? '' : `, parked ${m(beside.parkedM)} m, run to the park position ${m(beside.parkRunBodyM)} m from the body`}`);
    }
    const text = `${JSON.stringify(out, null, 1)}\n`;
    if (WRITE) writeFileSync(FILE, text);
    expect(existsSync(FILE)).toBe(true);
    expect(JSON.parse(readFileSync(FILE, 'utf8')), 'programs/fleetPrograms.json is stale: run with CLEAN_PROGRAM_WRITE=1').toEqual(out);
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
