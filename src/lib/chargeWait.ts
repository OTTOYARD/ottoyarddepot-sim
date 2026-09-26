// ============================================================================
// The wait for a charger, beside KPI 5 (engine 0501, `ottoq_kpi_charge_wait`, G233).
// Pure: no React, so the KPI tab and its tests share one wording.
// ============================================================================
import type { TwinChargeWait } from "@/lib/ottoTwin";

const fmt = (v: number | null | undefined, digits = 0): string =>
  typeof v === "number" && Number.isFinite(v)
    ? v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })
    : "\u2014";

/**
 * The wait for a charger in one line (engine 0501, G233). KPI 5 counts from recall to the FIRST operation, which on a
 * busy day is a cabin or digital task that starts at once: 0.7 min on run 394e1e83 while about 40 cars waited for a
 * charger. This counts from arrival to the first charging session. While cars are still waiting, the headline p95 is
 * a floor and the line says so, naming how many wait and the longest wait so far.
 */
export function chargeWaitDetail(cw: TwinChargeWait): string {
  if (!cw.visits_owing_a_charge) return "no visit has arrived owing a charge yet";
  const charged = cw.charged ? `p50 ${fmt(cw.p50_wait_min, 1)} min over ${fmt(cw.charged)} charged` : "none charged yet";
  if (!cw.waiting_at_horizon) return `${charged} of ${fmt(cw.visits_owing_a_charge)} owing a charge`;
  return `at least: ${fmt(cw.waiting_at_horizon)} still waiting, the longest ${fmt(cw.waiting_max_so_far_min, 0)} min so far · ${charged}`;
}
