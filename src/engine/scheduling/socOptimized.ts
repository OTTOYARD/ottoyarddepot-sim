import type { ScoringFn } from '../types';

export const socOptimizedScore: ScoringFn = (vehicle) =>
  (100 - vehicle.currentSoC) + vehicle.priority * 2;
