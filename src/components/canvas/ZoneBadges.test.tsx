import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { ZoneBadges } from './ZoneBadges';
import { useDepotStore } from '@/store/depotStore';
import { useVehicleStore } from '@/store/vehicleStore';
import { setChargerBuild, type ChargerBuild } from '@/lib/chargerBuild';
import { generateStallsV2 } from '@/lib/sitePlan';

// The 2D plan's zone badges: a charger kind's count sits over the canopies that kind has in the build being drawn,
// and a build with none of a kind draws no badge for it (the 30-post build has no L2).
afterEach(() => {
  cleanup();
  setChargerBuild('as_built');
  useDepotStore.setState({ stalls: generateStallsV2() });
});

const badges = (build: ChargerBuild) => {
  setChargerBuild(build);
  useDepotStore.setState({ stalls: generateStallsV2() });
  useVehicleStore.setState({ vehicles: [] });
  const { container } = render(<svg><ZoneBadges /></svg>);
  return [...container.querySelectorAll('text')].map((t) => ({ x: Number(t.getAttribute('x')), label: t.textContent }));
};

describe('2D: the zone badges follow the charger build', () => {
  it('as built: 10 fast chargers over canopy A, 30 L2 over canopies B and C', () => {
    const b = badges('as_built');
    expect(b.find((x) => x.label === '0/10')?.x).toBe(103);
    expect(b.find((x) => x.label === '0/30')?.x).toBe((150 + 197) / 2);
  });

  it('20 posts: 20 fast chargers over canopies A and B, 15 L2 over canopy C', () => {
    const b = badges('dcfc20');
    expect(b.find((x) => x.label === '0/20')?.x).toBe((103 + 150) / 2);
    expect(b.find((x) => x.label === '0/15')?.x).toBe(197);
  });

  it('30 posts: 30 fast chargers over all three canopies, and no L2 badge at all', () => {
    const b = badges('dcfc30');
    expect(b.find((x) => x.label === '0/30')?.x).toBe(150);
    expect(b.filter((x) => /^\d+\/\d+$/.test(x.label ?? '')).length).toBe(3); // fast, wash, staging
    expect(b.some((x) => x.label === '0/0')).toBe(false);
  });
});
