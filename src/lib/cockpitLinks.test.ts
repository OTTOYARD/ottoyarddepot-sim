import { describe, expect, it } from 'vitest';
import { cockpitBaseUrl, cockpitUrl, fleetOwnersFromCards, isLiveRunStatus, runFromSearch } from './cockpitLinks';

const RUN = '4b09c1de-0000-4000-8000-000000000001';
const WAYMO = '22222222-2222-2222-2222-222222222222';

describe('cockpit links', () => {
  it('defaults to the live hosts and honours the env override', () => {
    expect(cockpitBaseUrl('orchestrav', {})).toBe('https://ottoyard-orchestra-av.lovable.app');
    expect(cockpitBaseUrl('pulse', {})).toBe('https://ottoyard-otto-pulse.lovable.app');
    expect(cockpitBaseUrl('pulse', { VITE_PULSE_URL: 'http://localhost:5174' })).toBe('http://localhost:5174');
    expect(cockpitBaseUrl('orchestrav', { VITE_ORCHESTRAV_URL: '  ' })).toBe('https://ottoyard-orchestra-av.lovable.app');
  });

  it('pins OrchestrAV to the run and the owner', () => {
    const u = new URL(cockpitUrl('orchestrav', { runId: RUN, owner: WAYMO, env: {} }));
    expect(u.origin).toBe('https://ottoyard-orchestra-av.lovable.app');
    expect(Object.fromEntries(u.searchParams)).toEqual({ source: 'twin', run: RUN, owner: WAYMO });
  });

  it('never sends an owner to PULSE, which shows every owner', () => {
    const u = new URL(cockpitUrl('pulse', { runId: RUN, owner: WAYMO, embed: true, env: {} }));
    expect(Object.fromEntries(u.searchParams)).toEqual({ source: 'twin', run: RUN, embed: '1' });
  });

  it('reads only a well-formed run from the back link', () => {
    expect(runFromSearch(`?source=twin&run=${RUN.toUpperCase()}`)).toBe(RUN);
    expect(runFromSearch('?run=latest')).toBeNull();
    expect(runFromSearch('')).toBeNull();
  });

  it('treats only running, active and paused as live', () => {
    expect(['running', 'ACTIVE', 'paused'].every(isLiveRunStatus)).toBe(true);
    expect(['completed', 'stopped', '', null, undefined].some(isLiveRunStatus)).toBe(false);
  });
});

describe('fleet owners from depot cards', () => {
  it('counts vehicles per operator, largest first, and skips cards with no operator', () => {
    const cards = {
      vehicles: [
        { operator: { id: 'b', name: 'Tesla Robotaxi TN' } },
        { operator: { id: 'a', name: 'Waymo Nashville' } },
        { operator: { id: 'a', name: 'Waymo Nashville' } },
        { operator: null },
        {},
      ],
    };
    expect(fleetOwnersFromCards(cards)).toEqual([
      { id: 'a', name: 'Waymo Nashville', vehicles: 2 },
      { id: 'b', name: 'Tesla Robotaxi TN', vehicles: 1 },
    ]);
  });

  it('returns nothing, never a guess, for a malformed payload', () => {
    expect(fleetOwnersFromCards(null)).toEqual([]);
    expect(fleetOwnersFromCards({ vehicles: 'x' })).toEqual([]);
  });
});
