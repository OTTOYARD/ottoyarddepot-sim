// ============================================================================
// useBackgroundFacts — the Background tab's live reads, all from otto-q-core and all read-only.
//
// Ten sources, read in parallel, each on its own: one that fails or has not answered leaves its slice null and the tab
// says "—" there, while the others still show. They move by the day, not the second (the calibration registry, the
// catalog, the rules) or by the hour (the ledger, the certification canon), so the tab reads them when it opens and
// every five minutes after, and a module cache lets the tab reopen without waiting. The heaviest read, the intelligence
// ledger view, measured 383 ms on 2026-10-02.
// ============================================================================
import { useEffect, useState } from 'react';
import { ottoQ } from '@/lib/ottoQClient';
import { useTwinStore } from '@/store/twinStore';
import { NASHVILLE_DEPOT } from '@/lib/ottoTwin';
import type {
  CalibrationDatasetRow, CanonRow, CatalogRow, DistributionRow, FeedPlanRow, LedgerRow, PostureRow, RuleRow,
  TariffRow, VehicleClassRow,
} from '@/lib/background';

const REFRESH_MS = 5 * 60_000;

export interface BootManifest {
  sim_run_id?: string;
  scenario?: string | null;
  status?: string | null;
  random_seed?: number | string | null;
  boot_draw?: {
    seed?: number | string;
    vehicles_drawn?: number;
    draw_ms?: number;
    world_day0?: Record<string, number | null>;
    fleet_condition?: Record<string, { min: number; avg: number; max: number }>;
  } | null;
  error?: string;
}

export interface BackgroundFacts {
  datasets: CalibrationDatasetRow[] | null;
  distributions: DistributionRow[] | null;
  feedPlans: FeedPlanRow[] | null;
  catalog: CatalogRow[] | null;
  ledger: LedgerRow[] | null;
  rules: RuleRow[] | null;
  posture: PostureRow[] | null;
  canon: CanonRow[] | null;
  tariffs: TariffRow[] | null;
  classes: VehicleClassRow[] | null;
  /** When the slices above were last read (wall clock). */
  readAt: string | null;
  /** The sources that failed on the last read, by name. */
  failed: string[];
}

const EMPTY: BackgroundFacts = {
  datasets: null, distributions: null, feedPlans: null, catalog: null, ledger: null, rules: null, posture: null,
  canon: null, tariffs: null, classes: null, readAt: null, failed: [],
};

let cache: { at: number; facts: BackgroundFacts } | null = null;

type Read = { key: Exclude<keyof BackgroundFacts, 'readAt' | 'failed'>; source: string; run: () => PromiseLike<{ data: unknown; error: unknown }> };

const READS: Read[] = [
  { key: 'datasets', source: 'ottoq_calibration_datasets', run: () => ottoQ.from('ottoq_calibration_datasets')
      .select('dataset_code,domain,status,source_name,source_org,source_url,description,what_it_calibrates,record_count,date_range_start,date_range_end,ingestion_method,ingestion_notes,ingested_at,license') },
  { key: 'distributions', source: 'ottoq_calibration_distributions', run: () => ottoQ.from('ottoq_calibration_distributions')
      .select('dataset_code,variable_name,segment,sample_count') },
  { key: 'feedPlans', source: 'ottoq_feed_plans', run: () => ottoQ.from('ottoq_feed_plans')
      .select('var_key,version,status,method,provenance,authored_by,created_at').eq('status', 'active') },
  { key: 'catalog', source: 'ottoq_variability_catalog', run: () => ottoQ.from('ottoq_variability_catalog')
      .select('var_key,domain,label,definition,unit,kind,wired,generator,lifespan,scope,display_order') },
  { key: 'ledger', source: 'ottoq_intelligence_ledger', run: () => ottoQ.from('ottoq_intelligence_ledger').select('*') },
  { key: 'rules', source: 'ottoq_rules', run: () => ottoQ.from('ottoq_rules')
      .select('rule_code,category,severity,enforcement,applies_to_actions,title,status') },
  { key: 'posture', source: 'ottoq_shield_probe_posture', run: () => ottoQ.rpc('ottoq_shield_probe_posture') },
  { key: 'canon', source: 'ottoq_determinism_canon', run: () => ottoQ.from('ottoq_determinism_canon')
      .select('depot_id,scenario,seed,ticks,enabled,outcome,equal,status,satisfies_floor,certified_at') },
  { key: 'tariffs', source: 'ottoq_depot_tariffs', run: () => ottoQ.from('ottoq_depot_tariffs')
      .select('depot_id,active,demand_basis,effective_from,provenance').eq('depot_id', NASHVILLE_DEPOT) },
  { key: 'classes', source: 'ottoq_vehicle_classes', run: () => ottoQ.from('ottoq_vehicle_classes')
      .select('vehicle_class_code,oem_name,manufacturer,model,battery_capacity_kwh,max_charge_rate_kw,status') },
];

export async function readBackgroundFacts(prev: BackgroundFacts = EMPTY): Promise<BackgroundFacts> {
  const results = await Promise.allSettled(READS.map((r) => Promise.resolve(r.run())));
  const next: BackgroundFacts = { ...prev, failed: [] };
  results.forEach((res, i) => {
    const r = READS[i];
    if (res.status === 'fulfilled' && !res.value.error && Array.isArray(res.value.data)) {
      (next as unknown as Record<string, unknown>)[r.key] = res.value.data;
    } else {
      next.failed.push(r.source); // a failed read keeps the last good slice, and is named
    }
  });
  next.readAt = new Date().toISOString();
  return next;
}

export function useBackgroundFacts(enabled = true): { facts: BackgroundFacts; loading: boolean } {
  const [facts, setFacts] = useState<BackgroundFacts>(() => cache?.facts ?? EMPTY);
  const [loading, setLoading] = useState(() => enabled && !cache);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const load = async () => {
      const got = await readBackgroundFacts(cache?.facts ?? EMPTY);
      cache = { at: Date.now(), facts: got };
      if (!cancelled) { setFacts(got); setLoading(false); }
    };
    if (!cache || Date.now() - cache.at > REFRESH_MS) void load();
    else setLoading(false);
    const t = setInterval(load, REFRESH_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, [enabled]);

  return { facts, loading };
}

/** The active run's Monte Carlo hand (ottoq_twin_boot_manifest), or null when there is no run or it has none. */
export function useBootManifest(): { manifest: BootManifest | null; runId: string | null } {
  const runId = useTwinStore((s) => s.activeSimRunId);
  const [manifest, setManifest] = useState<BootManifest | null>(null);
  useEffect(() => {
    setManifest(null);
    if (!runId) return;
    let cancelled = false;
    ottoQ.rpc('ottoq_twin_boot_manifest', { p_sim_run_id: runId })
      .then(({ data, error }) => {
        if (cancelled || error || !data || typeof data !== 'object') return;
        const m = data as BootManifest;
        if (!m.error) setManifest(m);
      }, () => { /* the section says the hand could not be read */ });
    return () => { cancelled = true; };
  }, [runId]);
  return { manifest, runId };
}

/** Test seam: forget the cache between tests. */
export function __resetBackgroundCache() { cache = null; }
