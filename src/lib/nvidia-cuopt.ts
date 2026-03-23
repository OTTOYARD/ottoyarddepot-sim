import { supabase } from '@/integrations/supabase/client';

export interface DepotOptRequest {
  vehicles: {
    id: string; type: string; currentSoC: number; targetSoC: number;
    servicesNeeded: string[]; priority: number; arrivalTime: number;
  }[];
  stalls: {
    id: string; type: string; available: boolean; serviceTime: number;
  }[];
  config: {
    algorithm: string; maxQueueWait: number; prioritizeFleet: boolean;
  };
}

export interface OptResult {
  assignments: { vehicleId: string; stallId: string; startTime: number }[];
  metrics: { throughput: number; avgWait: number; utilization: number };
}

export async function optimizeDepotSchedule(
  req: DepotOptRequest
): Promise<OptResult> {
  try {
    const { data, error } = await supabase.functions.invoke('cuopt-optimize', {
      body: req,
    });

    if (error) {
      console.error('cuOpt edge function error:', error);
      return fallback(req);
    }

    if (data?.error) {
      console.error('cuOpt returned error:', data.error);
      return fallback(req);
    }

    return data as OptResult;
  } catch (err) {
    console.error('cuOpt request failed:', err);
    return fallback(req);
  }
}

function fallback(req: DepotOptRequest): OptResult {
  const sorted = [...req.vehicles].sort((a, b) => b.priority - a.priority);
  const avail = req.stalls.filter(s => s.available);
  const assignments = sorted.slice(0, avail.length).map((v, i) => ({
    vehicleId: v.id, stallId: avail[i].id, startTime: v.arrivalTime,
  }));
  return {
    assignments,
    metrics: {
      throughput: assignments.length,
      avgWait: 0,
      utilization: assignments.length / Math.max(req.stalls.length, 1),
    },
  };
}
