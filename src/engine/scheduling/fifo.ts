import type { ScoringFn } from '../types';

export const fifoScore: ScoringFn = (vehicle) => -vehicle.arrivalTime;
