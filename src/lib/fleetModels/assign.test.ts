import { describe, expect, it } from 'vitest';
import { FLEET_MODEL_KEYS, fleetModelKeyFor, isFleetModelKey } from './assign';
import { FLEET_SPECS } from './index';
import type { TwinVehicle } from '@/lib/ottoTwin';
import fixture from '@/engine/__fixtures__/twinRun.fresh0922.json';

describe('fleetModelKeyFor', () => {
  it('knows the six models the builder has, and no other', () => {
    expect([...FLEET_MODEL_KEYS].sort()).toEqual(FLEET_SPECS.map((s) => s.key).sort());
    expect(isFleetModelKey('waymo_ojai')).toBe(true);
    expect(isFleetModelKey('robotaxi')).toBe(false);
    expect(isFleetModelKey(undefined)).toBe(false);
  });

  it("takes the engine's port profile first, when it is a model key", () => {
    for (const key of FLEET_MODEL_KEYS) expect(fleetModelKeyFor({ make: 'Tesla', model: 'Model Y', port: { profile: key } })).toBe(key);
    // a profile that is not a model key says nothing: the name decides
    expect(fleetModelKeyFor({ make: 'Zoox', port: { profile: 'ccs1_left_rear' } })).toBe('zoox_robotaxi');
    expect(fleetModelKeyFor({ make: 'Zoox', port: { profile: null } })).toBe('zoox_robotaxi');
    expect(fleetModelKeyFor({ make: 'Zoox', port: null })).toBe('zoox_robotaxi');
  });

  it('reads the make and model, in any case', () => {
    const cases: [string, string | undefined, string | null][] = [
      ['Tesla', 'Cybercab', 'tesla_cybercab'],
      ['TESLA', 'CYBERCAB', 'tesla_cybercab'],
      ['Tesla', 'Model Y', 'tesla_model_y'],
      ['Tesla', undefined, 'tesla_model_y'],
      ['Zeekr', undefined, 'waymo_ojai'],
      ['Waymo', 'Ojai', 'waymo_ojai'],
      ['Jaguar', undefined, 'waymo_ipace'],
      ['Jaguar', 'I-PACE', 'waymo_ipace'],
      ['Waymo', 'ipace', 'waymo_ipace'],
      ['Waymo', undefined, 'waymo_ipace'],
      ['Zoox', undefined, 'zoox_robotaxi'],
      ['zoox', 'robotaxi', 'zoox_robotaxi'],
      ['Lucid', 'Gravity', 'lucid_gravity_nuro'],
      ['Nuro', 'Gravity', 'lucid_gravity_nuro'],
      ['Lucid', undefined, 'lucid_gravity_nuro'],
    ];
    for (const [make, model, key] of cases) expect(fleetModelKeyFor({ make, model }), `${make} ${model}`).toBe(key);
  });

  it('applies the rules in order', () => {
    // a Cybercab is a Tesla: the first rule has it before the second
    expect(fleetModelKeyFor({ make: 'Tesla', model: 'Cybercab' })).toBe('tesla_cybercab');
    // an Ojai is a Waymo: the third rule has it before the fourth
    expect(fleetModelKeyFor({ make: 'Waymo', model: 'Zeekr Ojai' })).toBe('waymo_ojai');
  });

  it('gives null for a car it cannot name, so the yard draws its generic car', () => {
    expect(fleetModelKeyFor({ make: 'Cruise', model: 'Origin' })).toBeNull();
    expect(fleetModelKeyFor({ make: '', model: '' })).toBeNull();
    expect(fleetModelKeyFor({})).toBeNull();
    expect(fleetModelKeyFor({ make: null, model: null })).toBeNull();
    expect(fleetModelKeyFor(null)).toBeNull();
    expect(fleetModelKeyFor(undefined)).toBeNull();
  });

  it('takes the wire row as it is, with and without the two new fields', () => {
    const row: TwinVehicle = { id: 'a', av_id: 'AV-1', make: 'Zeekr', platform: 'waymo', state: 'parked', soc: 50, stall_id: null };
    expect(fleetModelKeyFor(row)).toBe('waymo_ojai');
    expect(fleetModelKeyFor({ ...row, model: 'Cybercab', make: 'Tesla' })).toBe('tesla_cybercab');
    expect(fleetModelKeyFor({ ...row, port: { profile: 'lucid_gravity_nuro' } })).toBe('lucid_gravity_nuro');
  });

  it('names every car of the recorded run (116 of 116)', () => {
    const roster = (fixture as unknown as { roster: { id: string; make: string }[] }).roster;
    const count: Record<string, number> = {};
    for (const r of roster) { const k = fleetModelKeyFor(r) ?? 'generic'; count[k] = (count[k] ?? 0) + 1; }
    expect(roster.length).toBe(116);
    expect(count).toEqual({ waymo_ipace: 44, tesla_model_y: 36, zoox_robotaxi: 34, waymo_ojai: 2 });
  });
});
