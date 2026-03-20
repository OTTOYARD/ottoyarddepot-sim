import type { ScoringFn } from '../types';
import { fifoScore } from './fifo';
import { priorityWeightedScore } from './priorityWeighted';
import { socOptimizedScore } from './socOptimized';
import { revenueMaxScore } from './revenueMax';

const SCHEDULERS: Record<string, ScoringFn> = {
  'FIFO': fifoScore,
  'Priority-Weighted': priorityWeightedScore,
  'SoC-Optimized': socOptimizedScore,
  'Revenue-Max': revenueMaxScore,
};

export function getScheduler(algorithm: string): ScoringFn {
  return SCHEDULERS[algorithm] ?? priorityWeightedScore;
}
