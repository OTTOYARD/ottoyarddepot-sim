// machineFacts.test.ts — public/cad/robot-facts.json is what machineFacts.ts builds from the committed parts lists and
// the twin's phase tables, exactly. OTTO-PULSE and OrchestrAV carry a copy of that file (src/lib/twin/robotFacts.json
// in each), so a change here must be copied there. Write the file again with
//   ROBOT_FACTS_WRITE=1 npx vitest run src/lib/robotics/machineFacts.test.ts
import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { PUBLIC_CAD } from '@/test/cadDisk';
import { ARM_TIMING_DEFAULTS } from '@/lib/ottoChargeArm/armStateMachine';
import { ROBOT_KEYS, cycleSteps, type Bom, type RobotKey } from './catalog';
import { buildRobotFacts, robotFactsText } from './machineFacts';

const FILE = `${PUBLIC_CAD}/robot-facts.json`;
const boms = Object.fromEntries(ROBOT_KEYS.map((k) => [k, JSON.parse(readFileSync(`${PUBLIC_CAD}/${k}.bom.json`, 'utf8')) as Bom])) as Record<RobotKey, Bom>;

/** Every sentence a machine's facts put on screen. */
const sentencesOf = (m: ReturnType<typeof buildRobotFacts>['machines'][number]): string[] =>
  [m.where, ...m.summary, ...m.owner, ...m.safety, ...m.facts.map((f) => f.value)].flatMap((t) => t.split(/(?<=[.!?])\s+/)).filter(Boolean);

describe('public/cad/robot-facts.json', () => {
  const fresh = buildRobotFacts(boms);

  it('is what the parts lists and the phase tables give, exactly (the cockpits carry this file)', () => {
    if (process.env.ROBOT_FACTS_WRITE === '1') writeFileSync(FILE, robotFactsText(fresh));
    expect(readFileSync(FILE, 'utf8')).toBe(robotFactsText(fresh));
  });

  it('covers the three machines, each with its steps as the Robotics tab plays them', () => {
    expect(fresh.machines.map((m) => m.key)).toEqual([...ROBOT_KEYS]);
    for (const m of fresh.machines) {
      expect(m.steps).toEqual(cycleSteps(m.key));
      expect(m.summary.length).toBeGreaterThanOrEqual(2);
      expect(m.owner.length).toBeGreaterThanOrEqual(2);
      expect(m.facts.length).toBeGreaterThanOrEqual(6);
      expect(m.safety.length).toBeGreaterThanOrEqual(3);
      expect(m.services.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('gives the charge arm the twin\'s own connect and release times', () => {
    const t = ARM_TIMING_DEFAULTS;
    expect(fresh.chargeArm.connectSeconds).toBeCloseTo(t.unstow + t.approach + t.align + t.insert + t.latch, 9);
    expect(fresh.chargeArm.releaseSeconds).toBeCloseTo(t.unlatch + t.extract + t.retract, 9);
    const steps = fresh.machines[0].steps;
    const before = steps.slice(0, steps.findIndex((s) => s.id === 'charging')).reduce((a, s) => a + (s.seconds ?? 0), 0);
    expect(before).toBeCloseTo(fresh.chargeArm.connectSeconds, 9);
  });

  it('is written in short plain sentences: 20 words at most, no semicolons, no CAD joint names', () => {
    const long: string[] = [];
    for (const m of fresh.machines) {
      for (const s of sentencesOf(m)) {
        // a list after a colon reads as its own clause
        for (const clause of s.split(/:\s+/)) {
          if (clause.trim().split(/\s+/).length > 20) long.push(`${m.key}: ${clause}`);
        }
        expect(s, m.key).not.toMatch(/;/);
      }
      for (const s of [...m.owner, ...m.safety]) expect(s, m.key).not.toMatch(/\bJ[1-6]\b/);
    }
    expect(long).toEqual([]);
  });

  it('speaks to an owner about the owner\'s car, with no part numbers', () => {
    for (const m of fresh.machines) {
      expect(m.owner.some((s) => /your car/i.test(s)), m.key).toBe(true);
      for (const s of m.owner) expect(s).not.toMatch(/[A-Z]{3}-[A-Z0-9]{2,}/);
    }
  });
});
