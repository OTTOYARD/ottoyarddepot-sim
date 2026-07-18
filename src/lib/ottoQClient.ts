// ============================================================================
// ottoQClient — supabase-js client pointed at the OTTO-Q / OTTO-TWIN backend
// (project gxdrcyphqjzjsuhxuqtg), NOT the cockpit's own project in .env
// (src/integrations/supabase/client.ts → hfjaofyfxsyniohdfacg).
//
// Used for the Black Box flight-recorder lifecycle: the ottoq_start_demo_run /
// ottoq_sim_stop_and_reset RPCs and the ottoq_sim_runs discovery read. Reads
// are open on the private link; no session is persisted.
// ============================================================================
import { createClient } from "@supabase/supabase-js";
import { OTTOQ_SUPABASE_URL, OTTOQ_ANON_KEY } from "@/lib/ottoTwin";

export const ottoQ = createClient(OTTOQ_SUPABASE_URL, OTTOQ_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
