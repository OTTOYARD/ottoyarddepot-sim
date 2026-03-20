create table public.simulation_runs (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default now(),
  name text,
  duration_seconds integer,
  config jsonb,
  kpi_results jsonb,
  ai_summary text,
  vehicles_processed integer,
  avg_turnaround_minutes numeric,
  peak_queue_depth integer,
  peak_power_draw_kw numeric,
  alert_count_critical integer default 0,
  alert_count_warning integer default 0,
  alert_count_info integer default 0
);

alter table public.simulation_runs enable row level security;

create policy "Allow all access" on public.simulation_runs
  for all using (true) with check (true);