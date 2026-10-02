import { describe, it, expect } from 'vitest';
import { carName } from './carName';

/** The twin depot's cars with no av_api_vehicle_id, read from otto-q-core on 2026-10-02 (id, platform). */
const UNNAMED: [string, string][] = [
  ...[1, 2, 3, 4, 5, 6].map((n): [string, string] => [`a1111111-0001-0001-0001-00000000000${n}`, 'waymo']),
  ...[1, 2, 3, 4, 5, 6].map((n): [string, string] => [`b2222222-0002-0002-0002-00000000000${n}`, 'tesla']),
  ...[1, 2, 3, 4].map((n): [string, string] => [`c3333333-0003-0003-0003-00000000000${n}`, 'zoox']),
];

describe("the follow chip's name for a car", () => {
  it("is the renderer's label when the car has one", () => {
    expect(carName('00cc3d0a-2518-446b-b9b7-e025e293e37b', { label: 'twin-sim-021 · Waymo', oem: 'waymo' })).toBe('twin-sim-021 · Waymo');
  });

  it('is the operator and the end of the id when it has none, never the bare id', () => {
    expect(carName('a1111111-0001-0001-0001-000000000002', { oem: 'waymo' })).toBe('Waymo · …0002');
    expect(carName('a1111111-0001-0001-0001-000000000002', { label: '', oem: 'waymo' })).toBe('Waymo · …0002');
    expect(carName('5604331f-284d-4768-a521-b60693aebe25', null)).toBe('Car · …be25');
    expect(carName('5604331f-284d-4768-a521-b60693aebe25', { oem: 'may_mobility' })).toBe('May Mobility · …be25');
  });

  it("tells every unnamed car at the twin depot apart", () => {
    const names = UNNAMED.map(([id, oem]) => carName(id, { oem }));
    expect(new Set(names).size).toBe(UNNAMED.length);
    for (const n of names) expect(n).not.toMatch(/[0-9a-f]{8}-/);
  });
});
