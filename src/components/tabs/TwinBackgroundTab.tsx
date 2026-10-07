// ============================================================================
// TwinBackgroundTab — what this screen shows, what OTTO-Q is, and why it is built the way it is.
//
// Chase, 2026-10-02: "some kind of tab that gives background for what exactly the twin is showing and the simulation
// shows. So if someone looks out and goes, this looks awesome but what the heck is happening they can click the
// background tab ... what data sources are being pulled for what variables ... Monte Carlo style simulations ... how
// OTTO-Q communicates to the twin and vice versa ... what does it solve for customers ... distribution ... the agentic
// solution ... the purpose of a custom safety harness ... why our ecosystem is ultimately agnostic."
//
// And, correcting it the same evening: "I don't want you to directly reference each of those perspective viewers. It
// just needs to be framed so that essentially a customer or someone interested in partnership or investment would read
// and understand why it's valuable and why no one is doing this or our edge ... rooted in technicality and not just
// guess work." So no heading or sentence addresses a reader by type (a test holds that), and the value and edge
// sections argue from the engine's own mechanisms and from outside facts checked at their source, each linked and
// dated. They claim no measured advantage the Value tab has not measured.
//
// RULES THIS FILE KEEPS. Every number on it is read live from the engine when the tab opens (useBackgroundFacts) and
// is shown with the table or function it came from; a source that has not answered reads "—". Its prose describes
// mechanisms that can be pointed at by name, and it says "being built" where a thing is not live. Shaping lives in
// src/lib/background.ts (tested); this file only draws.
// ============================================================================
import { useMemo, useRef, type ReactNode } from 'react';
import {
  ArrowRight, BookOpen, Boxes, BrainCircuit, CircuitBoard, Database, Dices, ExternalLink, Globe2, Layers,
  ShieldCheck, Sparkles, Target, Truck,
} from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useTwinStore } from '@/store/twinStore';
import { useSimulationStore, type CockpitTab } from '@/store/simulationStore';
import { useBackgroundFacts, useBootManifest } from '@/hooks/useBackgroundFacts';
import { useValueSummary } from '@/hooks/useValueSummary';
import { LayerInfoButton } from '@/components/tabs/ottoq/LayerInfo';
import { LAYER_INFO } from '@/lib/layerInfo';
import { PLATES } from '@/components/tabs/ottoq/stack/stackModel';
import {
  CONTEXT_WORDS, PROVENANCE_LABEL, canonSummary, dataSources, dayCT, feedRecipes, fleetModels, fmtInt, measuredLines,
  providerFacts, shieldSummary, variableGroups, type ProvenanceKind,
} from '@/lib/background';

// ── small pieces ─────────────────────────────────────────────────────────────
const SECTIONS = [
  { id: 'bg-overview', label: 'Overview' },
  { id: 'bg-boundary', label: 'OTTO-Q and the twin' },
  { id: 'bg-data', label: 'Data' },
  { id: 'bg-montecarlo', label: 'Monte Carlo' },
  { id: 'bg-agentic', label: 'Agentic' },
  { id: 'bg-safety', label: 'Safety' },
  { id: 'bg-value', label: 'What it solves' },
  { id: 'bg-edge', label: 'Technical edge' },
  { id: 'bg-distribution', label: 'Distribution' },
  { id: 'bg-agnostic', label: 'Agnostic' },
  { id: 'bg-facts', label: 'Live facts' },
] as const;

function Section({ id, icon: Icon, title, kicker, children }: {
  id: string; icon: typeof BookOpen; title: string; kicker?: string; children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-12 border-t border-white/[0.06] pt-4">
      <div className="flex items-center gap-2">
        <Icon aria-hidden size={14} className="shrink-0 text-brand-hot" />
        <h2 id={`${id}-h`} className="font-display text-[13px] font-semibold uppercase tracking-[0.07em] text-ink">{title}</h2>
      </div>
      {kicker && <p className="mt-1 text-[12px] leading-[17px] text-ink">{kicker}</p>}
      <div className="mt-2 space-y-2.5 text-[11.5px] leading-[17px] text-ink-dim">{children}</div>
    </section>
  );
}

const P = ({ children }: { children: ReactNode }) => <p>{children}</p>;
const B = ({ children }: { children: ReactNode }) => <strong className="font-semibold text-ink">{children}</strong>;
const Code = ({ children }: { children: ReactNode }) => (
  <code className="break-words rounded bg-white/[0.05] px-1 py-px font-mono text-[10.5px] text-ink">{children}</code>
);

function Bullets({ items }: { items: ReactNode[] }) {
  return (
    <ul className="space-y-1.5">
      {items.map((t, i) => (
        <li key={i} className="flex gap-2">
          <span aria-hidden className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-ink-faint" />
          <span className="min-w-0">{t}</span>
        </li>
      ))}
    </ul>
  );
}

function Source({ children }: { children: ReactNode }) {
  return <div className="mt-1 font-mono text-[9.5px] leading-[13px] text-ink-faint">Source: {children}</div>;
}

type Status = 'enforced' | 'advisory' | 'policy' | 'building';
const STATUS_CLASS: Record<Status, string> = {
  enforced: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300',
  advisory: 'border-amber-400/30 bg-amber-400/10 text-amber-300',
  policy: 'border-sky-400/30 bg-sky-400/10 text-sky-300',
  building: 'border-violet-400/30 bg-violet-400/10 text-violet-300',
};
const STATUS_WORD: Record<Status, string> = {
  enforced: 'Built · enforced',
  advisory: 'Built · records, does not refuse',
  policy: 'Built · standing policy',
  building: 'Not yet live',
};
const Chip = ({ status }: { status: Status }) => (
  <span className={`inline-flex shrink-0 items-center rounded-full border px-1.5 py-px text-[9px] font-semibold uppercase tracking-[0.06em] ${STATUS_CLASS[status]}`}>
    {STATUS_WORD[status]}
  </span>
);

function Layer({ n, title, status, children }: { n: number; title: string; status: Status; children: ReactNode }) {
  return (
    <div className="rounded border border-white/[0.08] bg-canvas-panel/60 p-2.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span data-ordinal className="font-mono text-[10px] text-ink-faint">{n}</span>
        <span className="text-[12px] font-medium text-ink">{title}</span>
        <Chip status={status} />
      </div>
      <div className="mt-1.5 space-y-1.5 text-[11px] leading-[16px] text-ink-dim">{children}</div>
    </div>
  );
}

/** One part of the technical edge: why it is hard, what OTTO-Q does about it, and where an outside fact was checked. */
function Edge({ title, hard, ours, list, after, source }: {
  title: string; hard: ReactNode; ours: ReactNode; list?: ReactNode[]; after?: ReactNode; source?: ReactNode;
}) {
  return (
    <div className="rounded border border-white/[0.08] bg-canvas-panel/60 p-2.5">
      <div className="text-[12px] font-medium text-ink">{title}</div>
      <div className="mt-1.5 space-y-1.5 text-[11px] leading-[16px] text-ink-dim">
        <p><span className="text-ink-faint">The hard part. </span>{hard}</p>
        <p><span className="text-ink-faint">What OTTO-Q does. </span>{ours}</p>
        {list && <Bullets items={list} />}
        {after && <p>{after}</p>}
      </div>
      {source && <Source>{source}</Source>}
    </div>
  );
}

function Fact({ value, label, sub, source }: { value: string; label: string; sub?: string | null; source: string }) {
  return (
    <div className="rounded border border-white/[0.08] bg-canvas-panel/60 p-2.5">
      <div className="font-mono text-[15px] leading-5 text-ink">{value}</div>
      <div className="mt-0.5 text-[11px] leading-4 text-ink">{label}</div>
      {sub && <div className="mt-0.5 text-[10.5px] leading-[15px] text-ink-dim">{sub}</div>}
      <div className="mt-1 font-mono text-[9px] leading-3 text-ink-faint">{source}</div>
    </div>
  );
}

const KIND_CLASS: Record<ProvenanceKind, string> = {
  raw_records: 'border-emerald-400/30 text-emerald-300',
  computed: 'border-emerald-400/30 text-emerald-300',
  live_api: 'border-sky-400/30 text-sky-300',
  published_statistics: 'border-amber-400/30 text-amber-300',
};

function ExtLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-brand-hot hover:underline">
      {children}<ExternalLink aria-hidden size={9} />
    </a>
  );
}

// ── the tab ──────────────────────────────────────────────────────────────────
export function TwinBackgroundTab() {
  const runId = useTwinStore((s) => s.activeSimRunId);
  const run = useTwinStore((s) => s.snapshot?.run ?? null);
  const setActiveTab = useSimulationStore((s) => s.setActiveTab);
  const { facts, loading } = useBackgroundFacts();
  const { manifest } = useBootManifest();
  const value = useValueSummary(true);
  const top = useRef<HTMLDivElement>(null);

  const sources = useMemo(() => dataSources(facts.datasets ?? [], facts.distributions ?? []), [facts.datasets, facts.distributions]);
  const recipes = useMemo(() => feedRecipes(facts.feedPlans ?? []), [facts.feedPlans]);
  const groups = useMemo(() => variableGroups(facts.catalog ?? []), [facts.catalog]);
  const providers = useMemo(() => providerFacts(facts.ledger ?? []), [facts.ledger]);
  const shield = useMemo(() => (facts.rules ? shieldSummary(facts.rules, facts.posture) : null), [facts.rules, facts.posture]);
  const canon = useMemo(() => (facts.canon ? canonSummary(facts.canon) : null), [facts.canon]);
  const models = useMemo(() => fleetModels(facts.classes ?? []), [facts.classes]);
  const tariff = facts.tariffs?.find((t) => t.active !== false && t.provenance?.source_url) ?? null;

  const open = (tab: CockpitTab) => setActiveTab(tab);
  const jump = (id: string) => {
    try { document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch { /* a nicety */ }
  };
  const live = !!run && run.sim_run_id === runId && ['running', 'active', 'paused'].includes(String(run.status));
  const nVars = facts.catalog ? facts.catalog.length : null;
  const kinds = sources.reduce<Record<ProvenanceKind, number>>((m, s) => ({ ...m, [s.kind]: (m[s.kind] ?? 0) + 1 }), {} as Record<ProvenanceKind, number>);
  const nem = providers.find((p) => p.provider === 'nvidia_nemotron') ?? null;
  const cps = providers.find((p) => p.provider === 'cpsat_service') ?? null;
  const cuo = providers.find((p) => p.provider === 'nvidia_cuopt') ?? null;
  const cond = manifest?.boot_draw?.fleet_condition ?? null;
  const soh = cond?.veh_battery_soh_pct ?? null;
  const measured = useMemo(() => measuredLines(value.summary), [value.summary]);

  return (
    <ScrollArea className="flex-1">
      <div ref={top} className="space-y-4 p-3 pb-10 font-ui">
        {/* ── header ─────────────────────────────────────────────── */}
        <header>
          <div className="flex items-center gap-2">
            <BookOpen aria-hidden size={16} className="text-brand-hot" />
            <h1 className="font-display text-[18px] font-bold uppercase leading-none tracking-[0.05em] text-ink">Background</h1>
          </div>
          <p className="mt-1.5 text-[12px] leading-[17px] text-ink-dim">
            What you see, what OTTO-Q is, and why it is built this way. Each number on this page comes live from the
            engine and names its source.
          </p>
          <p className="mt-1.5 rounded border border-white/[0.08] bg-canvas-panel/60 px-2 py-1.5 text-[11px] leading-4 text-ink">
            {live
              ? <>Run <span className="font-mono">{runId!.slice(0, 8)}</span> · {String(run!.status)}{run!.sim_clock ? ` · sim clock ${dayCT(run!.sim_clock)}` : ''}. Each car you see moves on a decision from OTTO-Q.</>
              : runId
                ? <>Run <span className="font-mono">{runId.slice(0, 8)}</span> is not active. Start a run on the Control tab to see OTTO-Q work.</>
                : <>No run is active, so the depot is empty. Start a run on the Control tab. Then the cars arrive.</>}
          </p>
        </header>
        <nav aria-label="Background sections" className="sticky top-0 z-10 -mx-3 flex flex-wrap gap-1 bg-canvas-base/95 px-3 py-1.5 backdrop-blur">
          {SECTIONS.map((s) => (
            <button key={s.id} type="button" onClick={() => jump(s.id)}
              className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-ink-dim hover:border-brand-hot/50 hover:text-ink">
              {s.label}
            </button>
          ))}
        </nav>

        {/* ── 1. overview ────────────────────────────────────────── */}
        <Section id="bg-overview" icon={Truck} title="What you see"
          kicker="A simulated depot in real time, where OTTO-Q decides every move. OTTO-Q is the return-to-base orchestration engine for autonomous fleets.">
          <P>
            The depot is <B>OTTO-TWIN</B>, a digital twin of the OTTOYARD Nashville Flagship. Autonomous robotaxis come
            back to it for charge, cleaning and service, then go back to work.
          </P>
          <P>
            A ride-hail or delivery system owns the mission of each car. OTTO-Q owns the car from its recall until it is
            ready to work again. For each car, it answers four questions:
          </P>
          <Bullets items={[
            'When must the car stop work?',
            'Where must it go?',
            'What does it need?',
            'When must it be ready?',
          ]} />
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.07em] text-ink-faint">On this screen</div>
            <div className="mt-1">
              <Bullets items={[
                <><B>The 3D depot</B> shows each car at its position in the twin. Tap a car to follow it.</>,
                <><B>OTTO-Q</B> shows the layers of the engine, and each decision as it moves down through them. The
                  <span className="mx-1 inline-flex translate-y-[2px]"><LayerInfoButton plates={['agent']} label="the Agent layer" onOpenTab={(t) => open(t)} side="bottom" /></span>
                  beside a layer explains it.</>,
                <><B>Agent</B> shows each agent pass in plain words: what the agent read and chose, and the result.</>,
                <><B>KPIs</B> shows what the run measured. <B>Value</B> shows what OTTO-Q is worth against a plain depot.</>,
                <><B>Runs</B> lists each run by its ID, so you can trace any number to its run and replay it.</>,
              ]} />
            </div>
          </div>
        </Section>

        {/* ── 2. the boundary ────────────────────────────────────── */}
        <Section id="bg-boundary" icon={Layers} title="OTTO-Q and the twin"
          kicker="OTTO-Q decides. The twin owns the world. This screen only shows it. OTTO-Q and the twin connect through the same tables that a real depot uses.">
          <div className="grid gap-2 sm:grid-cols-3">
            {[
              { t: 'OTTO-Q · the product', d: 'It decides. It reads the depot from the tables that a real depot\'s telemetry fills. It writes only commands and bookings. It cannot tell if the depot is simulated.' },
              { t: 'OTTO-TWIN · the simulation', d: 'It owns the world. It controls the sim clock, the cars, the charges and the services. It draws faults, weather and arrivals at random. It follows each OTTO-Q command or refuses it.' },
              { t: 'This screen · the renderer', d: 'It shows the world. It reads the twin\'s snapshots and animates the motion between them. It never decides.' },
            ].map((c) => (
              <div key={c.t} className="rounded border border-white/[0.08] bg-canvas-panel/60 p-2.5">
                <div className="text-[11.5px] font-medium text-ink">{c.t}</div>
                <p className="mt-1 text-[11px] leading-4 text-ink-dim">{c.d}</p>
              </div>
            ))}
          </div>
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.07em] text-ink-faint">One tick, end to end</div>
            <ol className="mt-1 space-y-1.5">
              {[
                'The twin moves its clock forward. Cars drive, batteries drain and charge, services finish, and faults and arrivals occur.',
                'The new state goes into the depot tables, where a real depot\'s telemetry goes. A data_source column marks it as simulated.',
                'OTTO-Q reads that state. The agent sets the goal and the solvers make offers. The decide path chooses, and the safety shield checks each choice.',
                'OTTO-Q writes commands, for example to start a service or dispatch a car. In the same transaction, it books each stall.',
                'The twin follows each command or refuses it with a reason. A signed, append-only event log records each change.',
                'This screen reads the new snapshot and animates the change.',
              ].map((t, i) => (
                <li key={i} className="flex gap-2">
                  <span data-ordinal className="mt-px inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-white/15 font-mono text-[9px] text-ink">{i + 1}</span>
                  <span>{t}</span>
                </li>
              ))}
            </ol>
          </div>
          <P>
            <B>The swap test.</B> Connect OTTO-Q to a real depot, and OTTO-Q does not change. Its code contains no
            simulation data:
          </P>
          <Bullets items={[
            'Worlds come in as declared data.',
            'Nothing from a solved world goes back into the solver.',
            <>A test in CI enforces this boundary. See <Code>SEPARATION.md</Code>.</>,
          ]} />
          <P>So a result here is evidence about a real depot, not only about this one.</P>
        </Section>

        {/* ── 3. data ────────────────────────────────────────────── */}
        <Section id="bg-data" icon={Database} title="Public data"
          kicker="A simulated day is useful only if it looks like a real one. So the twin draws its random values from distributions fitted to public data. Each source shows its link, its period and how we got it.">
          {facts.datasets == null ? (
            <p className="text-ink-faint">{loading ? 'The tab reads the calibration registry…' : 'The calibration registry did not answer. —'}</p>
          ) : (
            <ul className="space-y-2">
              {sources.map((s) => (
                <li key={s.code} className="rounded border border-white/[0.08] bg-canvas-panel/60 p-2.5">
                  <div className="text-[9.5px] font-semibold uppercase tracking-[0.07em] text-ink-faint">{s.domainTitle}</div>
                  <div className="mt-0.5 text-[11.5px] font-medium leading-4 text-ink">
                    {s.url ? <ExtLink href={s.url}>{s.name}</ExtLink> : s.name}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10.5px] text-ink-dim">
                    {s.org && <span>{s.org}</span>}
                    {s.period && <span>· {s.period}</span>}
                    {s.records != null && s.kind !== 'published_statistics' && <span>· {fmtInt(s.records)} records</span>}
                    <span className={`rounded-full border px-1.5 py-px text-[9px] ${KIND_CLASS[s.kind]}`}>{PROVENANCE_LABEL[s.kind]}</span>
                  </div>
                  {s.fitted.length > 0 && (
                    <p className="mt-1 text-[10.5px] leading-[15px] text-ink-dim"><span className="text-ink-faint">Fitted: </span>{s.fitted.join(', ')}</p>
                  )}
                  {s.description && <p className="mt-0.5 text-[10.5px] leading-[15px] text-ink-faint">{s.description}</p>}
                </li>
              ))}
            </ul>
          )}
          <Source>public.ottoq_calibration_datasets, public.ottoq_calibration_distributions{facts.readAt ? ` · read ${dayCT(facts.readAt)}` : ''}</Source>

          {recipes.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.07em] text-ink-faint">Recipes for specific variables</div>
              <p className="mt-1">Some variables have a written recipe, a feed plan, that states how the twin draws them and from what.</p>
              <ul className="mt-1.5 space-y-1.5">
                {recipes.map((r) => (
                  <li key={r.varKey} className="rounded border border-white/[0.06] p-2">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-[11px] font-medium text-ink">{r.title}</span>
                      <span className="text-[10px] text-ink-faint">{[r.method, r.sourceType, r.retrieved ? `retrieved ${r.retrieved}` : null].filter(Boolean).join(' · ')}</span>
                      {r.wholeAssumption && <span className="rounded-full border border-amber-400/30 px-1.5 py-px text-[9px] text-amber-300">a declared assumption until real fleet data exists</span>}
                    </div>
                    {r.corpus && <p className="mt-0.5 text-[10.5px] leading-[15px] text-ink-dim">{r.corpus}</p>}
                    {r.assumptions.length > 0 && (
                      <details className="mt-0.5 text-[10px] text-ink-faint">
                        <summary className="cursor-pointer select-none hover:text-ink-dim">
                          {r.assumptions.length} declared {r.assumptions.length === 1 ? 'assumption' : 'assumptions'}, each with its reason
                        </summary>
                        <ul className="mt-1 space-y-1">
                          {r.assumptions.map((a) => (
                            <li key={a.name} className="leading-[14px]"><span className="text-ink-dim">{a.name}</span>{a.why ? `: ${a.why}` : ''}</li>
                          ))}
                        </ul>
                      </details>
                    )}
                    {r.sources.length > 0 && (
                      <div className="mt-0.5 flex flex-wrap gap-x-2 text-[10px]">
                        {r.sources.slice(0, 4).map((u) => <ExtLink key={u} href={u}>{new URL(u).hostname.replace(/^www\./, '')}</ExtLink>)}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
              <Source>public.ottoq_feed_plans (status active)</Source>
            </div>
          )}

          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.07em] text-ink-faint">The price of power</div>
            {tariff?.provenance?.source_url ? (
              <p className="mt-1">
                Energy prices come from the published commercial tariff that Nashville Electric Service would use to bill
                this site: <ExtLink href={tariff.provenance.source_url}>NES GSA tariff</ExtLink>
                {tariff.provenance.retrieved ? `, retrieved ${tariff.provenance.retrieved}` : ''}. The busiest half hour of
                the month sets the demand charge. So OTTO-Q plans each charge against the site peak.
              </p>
            ) : <p className="mt-1 text-ink-faint">The depot tariff did not answer. —</p>}
            <Source>public.ottoq_depot_tariffs (the twin depot)</Source>
          </div>

          {models.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.07em] text-ink-faint">The vehicles</div>
              <p className="mt-1">Each car is one of the production AV models in the class table, charged on that model's own battery size and charge curve:</p>
              <ul className="mt-1 space-y-0.5 font-mono text-[10.5px] text-ink">
                {models.map((m) => (
                  <li key={m.name}>{m.name}{m.batteryKwh != null ? ` · ${m.batteryKwh} kWh` : ''}{m.peakKw != null ? ` · up to ${m.peakKw} kW` : ''}</li>
                ))}
              </ul>
              <Source>public.ottoq_vehicle_classes</Source>
            </div>
          )}
        </Section>

        {/* ── 4. Monte Carlo ─────────────────────────────────────── */}
        <Section id="bg-montecarlo" icon={Dices} title="Monte Carlo worlds, made reproducible"
          kicker={nVars != null
            ? `Each run draws one whole world: ${fmtInt(nVars)} variables, each drawn on its own clock from the distributions above.`
            : 'Each run draws one whole world. Each variable is drawn on its own clock from the distributions above.'}>
          <P>
            A seed sets each random outcome of a run: car condition, weather, return times, charger faults and service
            times.
          </P>
          <P>
            Each draw depends only on the run seed, the item it is for and the sim time
            (<Code>twin.ottoq_sim_seeded_random</Code>). The results:
          </P>
          <Bullets items={[
            <><B>Different seeds, independent worlds.</B> Many seeds sample the range of days a depot will see, not one
              lucky afternoon.</>,
            <><B>The same seed, the same world, byte for byte.</B> OTTO-Q and a plain first-come-first-served depot run
              the same day, so a difference comes from the policy, not luck (common random numbers).</>,
            <><B>Knobs that stress a world.</B> On the Control tab, knobs make a day hotter, busier or more prone to
              faults.</>,
          ]} />
          {manifest?.boot_draw ? (
            <div className="rounded border border-white/[0.08] bg-canvas-panel/60 p-2.5">
              <div className="text-[10px] font-semibold uppercase tracking-[0.07em] text-ink-faint">This run's draw</div>
              <p className="mt-1 text-[11px] leading-4 text-ink">
                Seed <span className="font-mono">{String(manifest.boot_draw.seed ?? manifest.random_seed ?? '—')}</span>
                {manifest.boot_draw.vehicles_drawn != null ? ` · ${fmtInt(manifest.boot_draw.vehicles_drawn)} cars, each with its own condition` : ''}
                {soh ? ` · battery health ${soh.min.toFixed(1)}% to ${soh.max.toFixed(1)}% (mean ${soh.avg.toFixed(1)}%)` : ''}.
              </p>
              <Source>public.ottoq_twin_boot_manifest(run {runId?.slice(0, 8)})</Source>
            </div>
          ) : null}
          {groups.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.07em] text-ink-faint">The variables and when each is drawn</div>
              <div className="mt-1 space-y-1">
                {groups.map((g) => (
                  <details key={g.domain} className="rounded border border-white/[0.06] px-2 py-1.5">
                    <summary className="cursor-pointer select-none text-[11px] text-ink">
                      {g.title} <span className="font-mono text-[10px] text-ink-faint">{g.vars.length}</span>
                    </summary>
                    <ul className="mt-1.5 space-y-1">
                      {g.vars.map((v) => (
                        <li key={v.key} className="text-[10.5px] leading-[15px]">
                          <span className="text-ink">{v.label}</span>
                          <span className="text-ink-faint"> · drawn {v.when}{v.wired ? '' : ' · not yet used by the world'}</span>
                          {v.definition && <div className="text-ink-dim">{v.definition}</div>}
                        </li>
                      ))}
                    </ul>
                  </details>
                ))}
              </div>
              <Source>public.ottoq_variability_catalog</Source>
            </div>
          )}
        </Section>

        {/* ── 5. agentic ─────────────────────────────────────────── */}
        <Section id="bg-agentic" icon={BrainCircuit} title="The agentic system"
          kicker="Models and solvers propose at each level. One accountable, reproducible path decides. So an AI agent and a GPU solver can work on real cars without blind trust.">
          <ol className="space-y-1.5">
            {PLATES.map((p, i) => (
              <li key={p.id} className="flex items-start gap-2 rounded border border-white/[0.06] p-2">
                <span data-ordinal className="mt-px font-mono text-[10px] text-ink-faint">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11.5px] font-medium uppercase tracking-[0.05em] text-ink">{p.label}</span>
                    <span className="text-[10px] text-ink-faint">{p.tagline}</span>
                    <LayerInfoButton plates={[p.id]} label={`the ${p.label} layer`} onOpenTab={(t) => open(t)} side="bottom" />
                  </div>
                  <p className="mt-0.5 text-[11px] leading-4 text-ink-dim">{LAYER_INFO[p.id].overview}</p>
                </div>
              </li>
            ))}
          </ol>
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.07em] text-ink-faint">Every model and solver call, on the record</div>
            {facts.ledger == null ? (
              <p className="mt-1 text-ink-faint">{loading ? 'The tab reads the intelligence ledger…' : 'The intelligence ledger did not answer. —'}</p>
            ) : (
              <ul className="mt-1 space-y-1.5">
                {providers.map((p) => (
                  <li key={p.provider} className="rounded border border-white/[0.06] p-2">
                    <div className="text-[11px] font-medium text-ink">{p.name}</div>
                    <div className="mt-0.5 font-mono text-[10.5px] leading-[15px] text-ink-dim">{p.line}</div>
                    <div className="mt-0.5 text-[10px] text-ink-faint">
                      {p.first ? `first ${dayCT(p.first)}` : ''}{p.last ? ` · most recent ${dayCT(p.last)}` : ''}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <Source>public.ottoq_intelligence_ledger, an append-only evidence ledger that survives run purges{facts.readAt ? ` · read ${dayCT(facts.readAt)}` : ''}</Source>
          </div>
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.07em] text-ink-faint">How it learns from its own record</div>
            <div className="mt-1">
              <Bullets items={[
                <><B>Its own data set.</B> Each decision, offer, refusal and result is evidence under a run ID. We make
                  this data ourselves, and run purges do not delete it.</>,
                <><B>The challenger, live.</B> Each minute, it asks if the depot could have done better, and grades the
                  answer later against what happened. It never changes the engine. Its live board is on the <button type="button" className="text-brand-hot hover:underline" onClick={() => open('agent')}>Agent tab</button>.</>,
                <><B>The research wing, overnight in the twin.</B> We test a setting change in pairs: the same day and
                  seed, with the current value and with the new one. A change that wins is a recommendation, and a person
                  ships it.</>,
                <><B>Worlds that stay current.</B> Each week, we fit the live public sources (grid demand, weather) again.</>,
                <><B>What it does not do, on purpose.</B> It does not train on its own simulated results, which would teach
                  it its own mistakes. In production, it will learn overnight from real data, and never run an experiment
                  on a real car.</>,
              ]} />
            </div>
          </div>
        </Section>

        {/* ── 6. safety ──────────────────────────────────────────── */}
        <Section id="bg-safety" icon={ShieldCheck} title="The safety harness"
          kicker="Software that moves cars must be unable to do some things, not only unlikely to. Each layer holds even if the layer above it is wrong.">
          <P>
            Standard AI guardrails control what a model says. At a depot, the risk is what the depot does, so the harness
            sits inside the database transaction that makes each decision. It holds for every caller, including agents
            that nobody has written yet.
          </P>
          <div className="space-y-2">
            <Layer n={1} title="Physical limits in the database" status="enforced">
              <p>Under all rules, the database refuses some writes in every case:</p>
              <Bullets items={[
                <>A calendar constraint makes a double booking impossible (<Code>ottoq_stall_bookings</Code> EXCLUDE).</>,
                'A unique index allows only one car per stall.',
                <>The signed event log rejects each edit and deletion (<Code>ottoq_events</Code>).</>,
              ]} />
            </Layer>
            <Layer n={2} title="The rule shield" status="enforced">
              {shield ? (
                <>
                  <p>
                    <B>{fmtInt(shield.codes)} rules</B>, versioned and kept as data. A fleet contract can set their
                    parameters. The engine checks them at its decision points and logs each result.
                  </p>
                  <ul className="space-y-0.5">
                    {shield.categories.map((c) => (
                      <li key={c.category} className="flex gap-2"><span className="w-6 shrink-0 text-right font-mono text-ink">{c.codes}</span><span>{c.title}</span></li>
                    ))}
                  </ul>
                  {facts.posture && (
                    <>
                      <p>
                        <B>Points that refuse ({fmtInt(shield.enforced.length)}):</B> when{' '}
                        {shield.enforced.map((c) => CONTEXT_WORDS[c] ?? c.replace(/_/g, ' ')).join(', when ')}.
                      </p>
                      <p>
                        <B>Points that only record ({fmtInt(shield.advisory.length)}):</B> when{' '}
                        {shield.advisory.map((c) => CONTEXT_WORDS[c] ?? c.replace(/_/g, ' ')).join(', when ')}.
                      </p>
                      <p>A point starts to refuse only after its inputs are proven correct, one point at a time.</p>
                    </>
                  )}
                  <Source>public.ottoq_rules, public.ottoq_shield_probe_posture() (derived from the engine's own code on every read)</Source>
                </>
              ) : <p className="text-ink-faint">{loading ? 'Reading the rule catalog…' : 'The rule catalog did not answer. —'}</p>}
            </Layer>
            <Layer n={3} title="Vehicle first" status="enforced">
              <p>
                By contract, a car's charge target and its services belong to its owner. Each car charges to 100% unless
                its owner sets a lower limit. No car leaves with a service still needed: one departure test runs at each
                exit (<Code>ottoq_departure_clear</Code>). OTTO-Q never gives up a car's needs for
                throughput. A charge ends early only for a charger fault (the car goes back in the queue) or a
                car emergency.
              </p>
            </Layer>
            <Layer n={4} title="The agent harness" status="enforced">
              <p>An agent can act in two ways, each with its own controls:</p>
              <Bullets items={[
                <><B>Settings.</B> An agent can change only catalogued settings. Each change stays inside declared limits,
                  and the shield checks it.</>,
                <><B>Physical acts.</B> Offers come in through one door, and the decide path decides on each one. Database
                  privileges let an agent token propose, but not write a booking.</>,
              ]} />
            </Layer>
            <Layer n={5} title="The solver harness" status="enforced">
              <p>
                A solver that cannot promise the same answer twice only proposes, behind the decide path. The run's
                certification hash includes its proposals. CP-SAT runs pinned: one version, a deterministic time budget
                and a fixed worker count.
              </p>
            </Layer>
            <Layer n={6} title="Continuous certification" status="enforced">
              <p>
                OTTO-Q compares pairs of runs on the same seed, byte for byte, on fourteen independent checks: decisions,
                bookings, energy, proposals, rules, events and more. It runs on a schedule and after each engine change
                that can affect the result.
              </p>
              {canon && (
                <p className="text-ink">
                  Now: {fmtInt(canon.passing)} of {fmtInt(canon.columns)} certification columns passing
                  {canon.current === canon.columns ? ' and current' : `, ${fmtInt(canon.current)} current`}
                  {canon.lastCertified ? `, last certified ${dayCT(canon.lastCertified)}` : ''}.
                </p>
              )}
              <Source>public.ottoq_determinism_canon</Source>
            </Layer>
            <Layer n={7} title="No experiments in production" status="policy">
              <p>
                OTTO-Q never tests itself on real cars. Hypotheses and paired tests belong to the research wing, in the
                twin. Automatic promotion of settings is off. A test that wins is a recommendation, and a person ships it.
              </p>
            </Layer>
            <Layer n={8} title="What we build next" status="building">
              <Bullets items={[
                <><B>A door for outside agents.</B> The agent of a fleet owner gets a scoped token to read the depot and
                  ask for changes. Nothing happens until a person approves, and then the request goes through the
                  engine's normal checks. Written and tested, not yet live.</>,
                <><B>Rules that judge results, not only starts.</B> Today, state-machine and presence checks only record
                  their results. Each decision point starts to refuse after its inputs are proven, one point at a time.</>,
                <><B>A separate research database</B> before real telemetry starts, so overnight tests never compete with
                  a live depot for the scheduler.</>,
              ]} />
            </Layer>
          </div>
        </Section>

        {/* ── 7. value ───────────────────────────────────────────── */}
        <Section id="bg-value" icon={Sparkles} title="What it solves"
          kicker="An autonomous car earns money only while it works. Each trip to the depot is time off the road. As fleets grow, the depot is where they slow down.">
          <P>In scheduling terms, a depot is a flow shop with limited resources:</P>
          <Bullets items={[
            'Each car needs a set of operations in a fixed order.',
            'Each stall or bay does only some operations, for one car at a time.',
            'All charges share one site power limit.',
            'Each car must be ready at a set time.',
          ]} />
          <P>
            Arrivals, charge times and faults change, so OTTO-Q makes a new schedule at each tick. What OTTO-Q does:
          </P>
          <Bullets items={[
            <><B>The whole visit, as one schedule.</B> OTTO-Q plans charge, cleaning, inspection, software and staging
              together. Work that can occur during a charge starts on the charger.</>,
            <><B>Each car leaves complete.</B> A car charges to 100% unless its owner sets a lower limit, and leaves with
              no needed service open. If a car is not ready, OTTO-Q sends it to its next charger or bay, or to temporary
              parking until one is free.</>,
            <><B>Power that is planned.</B> OTTO-Q plans each charge against the site power limit and the demand charge,
              with the site battery and solar power. Paired test days measure the savings.</>,
            <><B>One site, many fleets, each on its own terms.</B> Each contract is versioned data that the rules read.
              Today, the contracts on file have the same terms. The mechanism exists, and the differences come with
              real contracts.</>,
            <><B>A record for each service.</B> Each completed operation ends in a signed service record for its fleet
              and asset class. Pricing of those records against the tariff is in development.</>,
          ]} />
          <div className="rounded border border-white/[0.08] bg-canvas-panel/60 p-2.5">
            <div className="text-[10px] font-semibold uppercase tracking-[0.07em] text-ink-faint">Measured at this depot so far</div>
            {measured && measured.lines.length > 0 ? (
              <>
                <ul className="mt-1 space-y-1 text-[11px] leading-4 text-ink">
                  {measured.lines.map((l) => <li key={l}>{l}</li>)}
                </ul>
                <Source>
                  public.ottoq_value_summary{measured.sweep ? ` · sweep ${measured.sweep}` : ''}
                  {measured.seeds != null ? ` · ${fmtInt(measured.seeds)} paired test ${measured.seeds === 1 ? 'day' : 'days'}` : ''}
                  {' '}· OTTO-Q against a plain depot on the same seeded days, at the depot as built
                </Source>
              </>
            ) : (
              <p className="mt-1 text-[11px] leading-4 text-ink-dim">
                The Value tab shows what the twin measured: OTTO-Q against a plain depot on the same seeded days. It
                claims only what a test day showed. It also shows where OTTO-Q did worse.
              </p>
            )}
            <button type="button" onClick={() => open('value')} className="mt-1.5 inline-flex items-center gap-1 text-[10.5px] text-brand-hot hover:underline">
              Open the Value tab <ArrowRight aria-hidden size={10} />
            </button>
          </div>
        </Section>

        {/* ── 8. the technical edge ──────────────────────────────── */}
        <Section id="bg-edge" icon={Target} title="The technical edge"
          kicker="Each reason below makes a depot of autonomous cars hard to run. OTTO-Q is built around each one, and you can check each in the engine or at the linked source.">
          <div className="space-y-2">
            <Edge title="The same answer, twice"
              hard={<>A schedule that moves real cars must be explainable, and another person must be able to repeat it.
                This is not automatic. NVIDIA cuOpt documents no seed and no determinism setting for its routing solver.
                Of its mixed-integer solver, it says the deterministic mode "does not yet guarantee fully deterministic
                results in all scenarios".</>}
              ours={<>Its decide path is deterministic: the same seed, scenario and engine give the same decisions, byte
                for byte (the certification above). Each figure it reports has a run ID that replays it.</>}
              source={<>
                <ExtLink href="https://docs.nvidia.com/cuopt/user-guide/latest/routing-features.html">cuOpt routing features</ExtLink>
                {' · '}<ExtLink href="https://docs.nvidia.com/cuopt/user-guide/latest/mip-settings.html">cuOpt MIP settings</ExtLink>
                {' · '}NVIDIA cuOpt 26.08 documentation, checked Oct 2, 2026
              </>} />
            <Edge title="AI that proposes, and never decides"
              hard={<>Language models and GPU solvers are fast and capable. They can also be wrong, late or different on a
                second try. A car cannot wait for a retry.</>}
              ours={<>Models and solvers only propose. One deterministic path decides.</>}
              list={[
                'The agent sets the goal for the next decisions.',
                'Solvers offer stall assignments.',
                'The decide path checks each offer against the rules, then decides.',
              ]}
              after={<>No agent can book a stall or move a car. A ledger records each call and its result.</>} />
            <Edge title="The right solver for the shape of the problem"
              hard={<>Inside a depot, the constraints are scheduling constraints. Charges at the same time share one power
                limit, and a stall or bay holds one car at a time. cuOpt has no primitive for either. It solves routing,
                linear and quadratic programs, with mixed-integer programs in beta. It has no scheduling family.</>}
              ours={<>OTTO-Q's deterministic decide path schedules the site, with offers from Google OR-Tools CP-SAT, a
                constraint-programming solver. CP-SAT runs pinned, so its results repeat too. cuOpt stays a
                proposer.</>}
              source={<>
                <ExtLink href="https://www.nvidia.com/en-us/ai-data-science/products/cuopt/">NVIDIA cuOpt</ExtLink>
                {' · '}<ExtLink href="https://docs.nvidia.com/cuopt/user-guide/latest/routing-features.html">cuOpt routing features</ExtLink>
                {' · '}checked Oct 2, 2026
              </>} />
            <Edge title="Limits that hold in the transaction"
              hard={<>The risk at a depot is physical: a car sent out half charged, a stall booked twice, a charge on a
                faulted charger. A limit that holds only for correct callers does not hold.</>}
              ours={<>Its limits sit where decisions are written, so they hold for every caller, including agents that
                nobody has written yet (the safety harness above).</>} />
            <Edge title="A record of service, not only of energy"
              hard={<>The EV industry made a standard for energy, but not for service. In OCPI, its roaming standard, the
                only billing object is the charge detail record, "the description of a concluded charging session". A
                cleaning, an inspection or a repair has no record of its own.</>}
              ours={<>Each operation it completes, energy or not, ends in a signed service record in the shape of
                OCPI's. Pricing of those records against the tariff is in development. Then a depot and its fleets can
                settle a cleaning the way they settle a charge today.</>}
              source={<>
                <ExtLink href="https://github.com/ocpi/ocpi/blob/v2.3.0/mod_cdrs.asciidoc">OCPI CDR module</ExtLink>
                {' · '}<ExtLink href="https://evroaming.org/ocpi-downloads/">OCPI releases</ExtLink>
                {' · '}OCPI 2.2.1 and 2.3.0, the released versions, checked Oct 2, 2026
              </>} />
            <Edge title="Proof before a depot is built"
              hard={<>You cannot try a site design or a scheduling policy on a real fleet without risk to the day of that
                fleet. One good afternoon proves nothing.</>}
              ours={<>The twin draws whole days from public data, with each assumption declared. OTTO-Q and a plain depot
                run the same seeded day, with the engine that would run the site. If OTTO-Q did not beat the plain depot
                on a measured day, the Value tab says so.</>} />
          </div>
          <P>
            <B>What it does not claim.</B> Intelligence is not a substitute for capacity. If a depot has too few chargers,
            the answer is more chargers or fewer faults, never shorter charges. The twin shows how many chargers a site
            needs.
          </P>
        </Section>

        {/* ── 9. distribution ────────────────────────────────────── */}
        <Section id="bg-distribution" icon={Globe2} title="Distribution and commercialization of AV fleets"
          kicker="In each new city, an autonomous fleet needs land, power, chargers, cleaning, service bays and staging. The cars earn money only when that infrastructure turns them around fast.">
          <Bullets items={[
            <><B>A depot becomes a shared service node.</B> Fleets with different owners can use one site. Each gets
              service under its own contract, from orchestration that belongs to none of them.</>,
            <><B>Size a depot before you build it.</B> The twin measures the chargers, power and cars a site needs, on
              simulated days drawn from real data.</>,
            <><B>A settlement rail for services.</B> Service records use the shape of the EV roaming standard (OCPI) for
              each operation, not only energy. When pricing is complete, a depot can bill its fleets for services.</>,
            <><B>Software on hardware that others own.</B> OTTO-Q orchestrates cars, chargers and sites. It never drives a
              car and never runs its mission.</>,
          ]} />
        </Section>

        {/* ── 10. agnostic ───────────────────────────────────────── */}
        <Section id="bg-agnostic" icon={Boxes} title="Why it is agnostic"
          kicker="Each autonomous machine ends its work cycle with the same four questions. OTTO-Q owns those four questions and nothing else.">
          <Bullets items={[
            <><B>A kernel that never names a sector.</B> A sector comes in as a pack of declarative data: its asset types,
              operations, constraints and tariffs. Adapters translate its protocols.</>,
            <><B>Tested, not only stated.</B> Four packs (robotaxi, yard logistics, mining and vertiport) load against one
              closed specification and schedule with no change to the kernel. Robotaxi and yard logistics ran in full.
              Mining and vertiport passed on paper. We found one real solver extension and wrote it down: vertiport pad
              separation, two named points that cannot be active at the same time
              (<Code>CONFORMANCE_FINDINGS.md</Code>, Aug 22, 2026).</>,
            <><B>Standard protocols.</B> OCPP 2.0.1 for chargers, service records in the shape of OCPI, and a draft VDA
              5050 adapter for warehouse robots.</>,
            <><B>Any autonomy stack.</B> It works with any driving stack through one interface, the recall decision: when
              to come in, where, for what and by when.</>,
            <><B>The same shape fits other fleets:</B> delivery robots, yard tractors, haul trucks, drones, eVTOLs, and
              unmanned vessels that return to a sustainment node.</>,
          ]} />
        </Section>

        {/* ── 11. live facts ─────────────────────────────────────── */}
        <Section id="bg-facts" icon={CircuitBoard} title="Live facts, read from the engine"
          kicker="The tab reads each card from the engine when it opens, and each card names its source. A card that shows — is a source that did not answer. It is never a zero.">
          <div className="grid gap-2 sm:grid-cols-2">
            <Fact
              value={canon ? `${fmtInt(canon.passing)} / ${fmtInt(canon.columns)}` : '—'}
              label="certification columns that replay byte for byte"
              sub={canon?.lastCertified ? `fourteen checks per pair · last certified ${dayCT(canon.lastCertified)}` : null}
              source="ottoq_determinism_canon" />
            <Fact
              value={shield ? fmtInt(shield.codes) : '—'}
              label="safety rules, versioned as data"
              sub={shield && facts.posture ? `${fmtInt(shield.enforced.length)} decision points refuse · ${fmtInt(shield.advisory.length)} record` : null}
              source="ottoq_rules · ottoq_shield_probe_posture()" />
            <Fact value={fmtInt(nem?.count)} label="agent decisions, each on the record"
              sub={nem ? `${nem.rest}${nem.last ? ` · most recent ${dayCT(nem.last)}` : ''}` : null} source="ottoq_intelligence_ledger · nvidia_nemotron" />
            <Fact value={fmtInt(cps?.count)} label="CP-SAT solver calls"
              sub={cps ? `${cps.rest}${cps.last ? ` · most recent ${dayCT(cps.last)}` : ''}` : null} source="ottoq_intelligence_ledger · cpsat_service" />
            <Fact value={fmtInt(cuo?.count)} label="NVIDIA cuOpt calls answered"
              sub={cuo ? `${cuo.rest}${cuo.last ? ` · most recent ${dayCT(cuo.last)}` : ''}` : null} source="ottoq_intelligence_ledger · nvidia_cuopt" />
            <Fact
              value={facts.datasets ? fmtInt(sources.length) : '—'}
              label="public datasets calibrate the twin"
              sub={facts.datasets ? (Object.entries(kinds) as [ProvenanceKind, number][]).map(([k, v]) => `${v} ${PROVENANCE_LABEL[k]}`).join(' · ') : null}
              source="ottoq_calibration_datasets" />
            <Fact
              value={nVars != null ? fmtInt(nVars) : '—'}
              label="variables drawn into each simulated world"
              sub={groups.length ? `${groups.length} domains · ${fmtInt(groups.reduce((s, g) => s + g.wired, 0))} wired` : null}
              source="ottoq_variability_catalog" />
          </div>
          {facts.failed.length > 0 && (
            <p className="text-[10.5px] text-amber-300">Did not answer on the last read: {facts.failed.join(', ')}.</p>
          )}
          <p className="text-[10px] text-ink-faint">
            {facts.readAt ? `Last read ${dayCT(facts.readAt)}. ` : ''}The tab reads the engine again every five minutes while it is open.
          </p>
          <button type="button" onClick={() => top.current?.scrollIntoView({ behavior: 'smooth' })}
            className="text-[10.5px] text-ink-faint hover:text-ink-dim">Back to the top</button>
        </Section>
      </div>
    </ScrollArea>
  );
}

export default TwinBackgroundTab;
