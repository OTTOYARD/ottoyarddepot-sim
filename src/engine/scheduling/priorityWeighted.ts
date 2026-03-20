import type { ScoringFn } from '../types';

export const priorityWeightedScore: ScoringFn = (vehicle, simTime) => {
  const waitTime = simTime - vehicle.arrivalTime;
  let score = vehicle.priority * 3 + waitTime / 60;
  if (vehicle.type === 'fleet') score += 5;
  if (vehicle.type === 'elite') score += 3;
  else if (vehicle.type === 'concierge') score += 1;
  return score;
};
