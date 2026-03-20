import type { ScoringFn } from '../types';

const TYPE_TIER: Record<string, number> = {
  fleet: 1000,
  elite: 300,
  concierge: 200,
  core: 100,
};

export const revenueMaxScore: ScoringFn = (vehicle) =>
  (TYPE_TIER[vehicle.type] ?? 0) - vehicle.arrivalTime * 0.001;
