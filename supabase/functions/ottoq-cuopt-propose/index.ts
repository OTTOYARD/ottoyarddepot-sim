// ============================================================================
// ottoq-cuopt-propose — NVIDIA cuOpt → OTTO-Q external-proposal seam adapter.
// Reads a run's stall-assignment candidates (arrived_at_gate, low SoC) + free
// charging stalls, computes an assignment with NVIDIA cuOpt (GPU) when NVIDIA_API_KEY
// is set, else a deterministic SoC-priority heuristic fallback, and writes each as a
// stall_assignment proposal via ottoq_submit_external_proposal. OTTO-Q's decide_tick
// then reads these as L2 proposals and the L1 shield gates them (Simplex).
// Input: { sim_run_id }.  Output: { proposed, candidates, stalls, source }.
// ============================================================================
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const CUOPT_ENDPOINT = "https://optimize.api.nvidia.com/v1/nvidia/cuopt";

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const { sim_run_id } = await req.json();
    if (!sim_run_id) return json({ error: "sim_run_id required" }, 400);

    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: run } = await sb.from("ottoq_sim_runs")
      .select("sim_run_id, depot_id, status").eq("sim_run_id", sim_run_id).single();
    if (!run) return json({ error: "run not found" }, 404);
    const depot = run.depot_id;

    // candidates: AVs at the gate needing a charge stall, neediest first
    const { data: vehicles } = await sb.from("vehicles")
      .select("id, current_soc")
      .eq("home_depot_id", depot).eq("category", "autonomous")
      .eq("current_state", "arrived_at_gate").lt("current_soc", 85)
      .order("current_soc", { ascending: true }).limit(40);
    // free charging stalls (dcfc preferred for the neediest)
    const { data: stalls } = await sb.from("stalls")
      .select("id, stall_type, status")
      .eq("depot_id", depot).in("stall_type", ["dcfc", "l2"]).limit(80);

    const cands = vehicles ?? [];
    const freeStalls = (stalls ?? []).filter((s: any) => s.status !== "occupied");
    if (cands.length === 0 || freeStalls.length === 0)
      return json({ proposed: 0, candidates: cands.length, stalls: freeStalls.length, source: "none" });

    const apiKey = Deno.env.get("NVIDIA_API_KEY");
    let assignments: { vehicleId: string; stallId: string; stallType: string }[] = [];
    let source = "cuopt_fallback";
    if (apiKey) {
      try { assignments = await cuoptAssign(apiKey, cands, freeStalls); source = "cuopt"; }
      catch (e) { console.error("cuOpt call failed; heuristic fallback:", e); assignments = heuristic(cands, freeStalls); source = "cuopt_fallback"; }
    } else {
      assignments = heuristic(cands, freeStalls);
    }

    let proposed = 0;
    for (const a of assignments) {
      const kw = a.stallType === "dcfc" ? 150 : 19;
      const proposal = { abstain: false, stall_id: a.stallId, stall_type: a.stallType, requested_kw: kw, source };
      const { error } = await sb.rpc("ottoq_submit_external_proposal", {
        p_sim_run_id: sim_run_id, p_depot_id: depot, p_action_context: "stall_assignment",
        p_entity_type: "vehicle", p_entity_id: a.vehicleId, p_proposal: proposal,
        p_source: source, p_ttl_seconds: 90,
      });
      if (!error) proposed++; else console.error("submit proposal error:", error.message);
    }
    return json({ proposed, candidates: cands.length, stalls: freeStalls.length, source });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "unknown" }, 500);
  }
});

// Deterministic SoC-priority assignment: neediest vehicles → DCFC first, then L2.
function heuristic(vehicles: any[], stalls: any[]) {
  const ordered = [...stalls.filter((s) => s.stall_type === "dcfc"), ...stalls.filter((s) => s.stall_type === "l2")];
  const out: any[] = [];
  for (let i = 0; i < Math.min(vehicles.length, ordered.length); i++)
    out.push({ vehicleId: vehicles[i].id, stallId: ordered[i].id, stallType: ordered[i].stall_type });
  return out;
}

// NVIDIA cuOpt assignment (routing/LAP form, mirrors the proven cuopt-optimize payload).
// On any non-OK response or empty solution, throws so the caller falls back.
async function cuoptAssign(apiKey: string, vehicles: any[], stalls: any[]) {
  const n = vehicles.length, m = stalls.length, dim = n + m;
  // Cost favors assigning the neediest (lowest-SoC) vehicles to DCFC stalls.
  const cost = Array.from({ length: dim }, (_, i) =>
    Array.from({ length: dim }, (_, j) => {
      if (i === j) return 0;
      if (i < n && j >= n) { const v = vehicles[i], s = stalls[j - n];
        return Math.round((s.stall_type === "dcfc" ? 0 : 40) + (100 - (v.current_soc ?? 100))); }
      return 1;
    })
  );
  const payload = {
    action: "cuOpt_OptimizedRouting",
    data: {
      task_data: { task_locations: vehicles.map((_, i) => i), demand: vehicles.map(() => [1]),
        task_time_windows: vehicles.map(() => [0, 86400]), service_times: vehicles.map(() => 1) },
      fleet_data: { vehicle_locations: stalls.map((_, i) => [n + i, n + i]), capacities: stalls.map(() => [1]),
        vehicle_time_windows: stalls.map(() => [0, 86400]) },
      cost_matrix_data: { cost_matrix: cost },
      solver_config: { time_limit: 5 },
    },
  };
  const res = await fetch(CUOPT_ENDPOINT, { method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` }, body: JSON.stringify(payload) });
  if (!res.ok) throw new Error("cuOpt " + res.status + " " + (await res.text()).slice(0, 160));
  const result = await res.json();
  const out: any[] = [];
  const vd = result?.response?.solver_response?.vehicle_data;
  if (vd) for (const [sIdx, route] of Object.entries<any>(vd)) {
    if (route.task_id?.length) for (const tid of route.task_id) {
      const v = vehicles[tid], s = stalls[parseInt(sIdx)];
      if (v && s) out.push({ vehicleId: v.id, stallId: s.id, stallType: s.stall_type });
    }
  }
  if (out.length === 0) throw new Error("cuOpt returned no assignments");
  return out;
}
