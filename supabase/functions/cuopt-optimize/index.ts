import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const CUOPT_ENDPOINT = "https://optimize.api.nvidia.com/v1/nvidia/cuopt";

const svcMap: Record<string, string> = {
  dcfc_charge: "dcfc",
  l2_charge: "l2",
  exterior_wash: "wash",
  interior_detail: "wash",
  maintenance: "wash",
  staging: "staging",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { vehicles, stalls, config } = body;

    const apiKey = Deno.env.get("NVIDIA_API_KEY");
    if (!apiKey) {
      console.warn("No NVIDIA_API_KEY, returning fallback");
      return new Response(JSON.stringify(fallback(vehicles, stalls)), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const avail = stalls.filter((s: any) => s.available);
    const n = vehicles.length + avail.length;
    const costMatrix = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => (i === j ? 0 : 1))
    );

    const payload = {
      action: "cuOpt_OptimizedRouting",
      data: {
        task_data: {
          task_locations: vehicles.map((_: any, i: number) => i),
          demand: vehicles.map(() => [1]),
          task_time_windows: vehicles.map((v: any) => [
            v.arrivalTime,
            v.arrivalTime + (config.maxQueueWait || 10) * 60,
          ]),
          service_times: vehicles.map((v: any) =>
            (v.servicesNeeded || []).reduce((tot: number, svc: string) => {
              const s = stalls.find(
                (st: any) => st.type === (svcMap[svc] || "staging")
              );
              return tot + (s?.serviceTime || 30) * 60;
            }, 0)
          ),
          priorities: vehicles.map((v: any) => v.priority || 1),
        },
        fleet_data: {
          vehicle_locations: avail.map((_: any, i: number) => [i, i]),
          capacities: avail.map(() => [1]),
          vehicle_time_windows: avail.map(() => [0, 86400]),
        },
        cost_matrix_data: { cost_matrix: costMatrix },
        solver_config: { time_limit: 5, number_of_climbers: 128 },
      },
    };

    const res = await fetch(CUOPT_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("cuOpt API error:", res.status, errText);
      return new Response(JSON.stringify(fallback(vehicles, stalls)), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = await res.json();
    const parsed = parseCuOpt(result, vehicles, avail, stalls);

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("cuopt-optimize error:", e);
    return new Response(
      JSON.stringify({
        error: e instanceof Error ? e.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

function parseCuOpt(
  result: any,
  vehicles: any[],
  avail: any[],
  allStalls: any[]
) {
  const assignments: { vehicleId: string; stallId: string; startTime: number }[] = [];

  if (result?.response?.solver_response?.vehicle_data) {
    const routes = result.response.solver_response.vehicle_data;
    Object.entries(routes).forEach(([vIdx, route]: [string, any]) => {
      if (route.task_id?.length > 0) {
        route.task_id.forEach((tid: number, i: number) => {
          const v = vehicles[tid];
          const s = avail[parseInt(vIdx)];
          if (v && s) {
            assignments.push({
              vehicleId: v.id,
              stallId: s.id,
              startTime: route.arrival_stamp?.[i] || 0,
            });
          }
        });
      }
    });
  }

  return {
    assignments,
    metrics: {
      throughput: assignments.length,
      avgWait: result?.response?.solver_response?.solution_cost || 0,
      utilization: assignments.length / Math.max(allStalls.length, 1),
    },
  };
}

function fallback(vehicles: any[], stalls: any[]) {
  const sorted = [...vehicles].sort(
    (a, b) => (b.priority || 1) - (a.priority || 1)
  );
  const avail = stalls.filter((s: any) => s.available);
  const assignments = sorted.slice(0, avail.length).map((v, i) => ({
    vehicleId: v.id,
    stallId: avail[i].id,
    startTime: v.arrivalTime || 0,
  }));
  return {
    assignments,
    metrics: {
      throughput: assignments.length,
      avgWait: 0,
      utilization: assignments.length / Math.max(stalls.length, 1),
    },
  };
}
