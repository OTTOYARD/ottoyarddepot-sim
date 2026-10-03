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
  building: 'Being built',
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
function Edge({ title, hard, ours, source }: { title: string; hard: ReactNode; ours: ReactNode; source?: ReactNode }) {
  return (
    <div className="rounded border border-white/[0.08] bg-canvas-panel/60 p-2.5">
      <div className="text-[12px] font-medium text-ink">{title}</div>
      <div className="mt-1.5 space-y-1.5 text-[11px] leading-[16px] text-ink-dim">
        <p><span className="text-ink-faint">The hard part. </span>{hard}</p>
        <p><span className="text-ink-faint">What OTTO-Q does. </span>{ours}</p>
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
            What this screen shows, what OTTO-Q is, and why it is built the way it is. Every number on this page is read
            live from the engine and names where it came from.
          </p>
          <p className="mt-1.5 rounded border border-white/[0.08] bg-canvas-panel/60 px-2 py-1.5 text-[11px] leading-4 text-ink">
            {live
              ? <>Watching run <span className="font-mono">{runId!.slice(0, 8)}</span> · {String(run!.status)}{run!.sim_clock ? ` · sim clock ${dayCT(run!.sim_clock)}` : ''}. Every car you see is moving because OTTO-Q decided it should.</>
              : runId
                ? <>Run <span className="font-mono">{runId.slice(0, 8)}</span> is not running. Start one on the Control tab to watch OTTO-Q work.</>
                : <>No run is live, so the depot is empty. Start one on the Control tab and the cars arrive.</>}
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
        <Section id="bg-overview" icon={Truck} title="What you are looking at"
          kicker="A simulated depot, run in real time, where every car is moved by OTTO-Q: the return-to-base orchestration engine for autonomous fleets.">
          <P>
            The depot is <B>OTTO-TWIN</B>, a digital twin of the OTTOYARD Nashville Flagship. Its fleet of autonomous
            robotaxis comes back from work to charge, get cleaned and serviced, and go back out. The twin plays the world;
            <B> OTTO-Q</B>, the product, makes every decision about what each car does while it is home.
          </P>
          <P>
            OTTO-Q is the pit lane, not the race. A ride-hail or delivery system owns each car's mission. OTTO-Q owns the
            car from the moment it is called back until it is ready to work again, and answers four questions for it:
            when to stop working, where to go, what it needs, and when it must be ready.
          </P>
          <Bullets items={[
            <><B>The 3D depot</B> shows every car exactly where the twin says it is. Tap a car to follow it.</>,
            <><B>OTTO-Q</B> shows the engine's layers, with each decision falling through them as it is made. The
              <span className="mx-1 inline-flex translate-y-[2px]"><LayerInfoButton plates={['agent']} label="the Agent layer" onOpenTab={(t) => open(t)} side="bottom" /></span>
              beside a layer explains it.</>,
            <><B>Agent</B> is the AI agent in plain English: what it read, what it chose, and what happened to it.</>,
            <><B>KPIs</B> and <B>Value</B> are what the run measured, and what OTTO-Q is worth against a plain depot.</>,
            <><B>Runs</B> lists every run by its ID, so any number can be traced back and replayed.</>,
          ]} />
        </Section>

        {/* ── 2. the boundary ────────────────────────────────────── */}
        <Section id="bg-boundary" icon={Layers} title="OTTO-Q and the twin: two systems, one boundary"
          kicker="The product decides. The simulation owns the world. This screen only draws. They meet through the same tables a real depot would use.">
          <div className="grid gap-2 sm:grid-cols-3">
            {[
              { t: 'OTTO-Q · the product', d: 'Decides. Reads the depot through the tables a real depot\'s telemetry fills, and writes only commands and calendar bookings. It cannot tell whether the depot is simulated.' },
              { t: 'OTTO-TWIN · the simulation', d: 'Owns the world. Advances a virtual clock, drives the cars, runs charging and services, draws faults, weather and arrivals, and carries out OTTO-Q\'s commands or refuses them.' },
              { t: 'This screen · the renderer', d: 'Draws. Reads the twin\'s snapshots and animates the motion between them. It never decides anything.' },
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
                'The twin advances its clock: cars drive, batteries drain and charge, services finish, and faults and arrivals are drawn.',
                'The new state lands in the depot\'s tables, exactly where a real depot\'s telemetry would land. A data_source column marks it as simulated.',
                'OTTO-Q reads that state. The agent sets the objective, the planners make offers, the deterministic decide path chooses, and the safety shield checks each choice.',
                'OTTO-Q writes commands (take this stall, start this service, release this car) and books each stall on the calendar in the same transaction.',
                'The twin carries out each command or refuses it with a reason, and every change is written to a signed, append-only event log.',
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
            <B>The swap test.</B> Point OTTO-Q at a real depot and nothing in it changes. Simulation data is never wired
            into its code: worlds arrive as declared data, nothing from a solved world flows back into the solver, and a
            test in CI enforces that boundary (<Code>SEPARATION.md</Code>). That is what makes a result here evidence about
            a real depot rather than about this one.
          </P>
        </Section>

        {/* ── 3. data ────────────────────────────────────────────── */}
        <Section id="bg-data" icon={Database} title="Where the world comes from: public data"
          kicker="A simulated day is only useful if it looks like a real one. The twin's randomness is drawn from distributions fitted to public data, and every source below is named with its link, its period and how it reached us.">
          {facts.datasets == null ? (
            <p className="text-ink-faint">{loading ? 'Reading the calibration registry…' : 'The calibration registry did not answer. —'}</p>
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
              <p className="mt-1">Some variables have a written recipe, a feed plan, that says exactly how they are drawn and from what.</p>
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
                Energy is priced on Nashville Electric Service's published commercial schedule, the one this site would be
                billed on: <ExtLink href={tariff.provenance.source_url}>NES GSA tariff</ExtLink>
                {tariff.provenance.retrieved ? `, retrieved ${tariff.provenance.retrieved}` : ''}. Its demand charge is set
                by the highest half hour of the month, which is why OTTO-Q plans charging against the site's peak.
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
            ? `Each run is one draw of a whole world: ${fmtInt(nVars)} variables, each drawn on its own clock from the distributions above.`
            : 'Each run is one draw of a whole world, every variable drawn on its own clock from the distributions above.'}>
          <P>
            A seed picks every random outcome of a run: each car's battery health and energy burn, the weather, when cars
            come back and how charged they are, which charger faults and for how long, how long each service takes.
          </P>
          <P>
            Every draw is a pure function of three things: the run's seed, the thing being drawn for (a car, a charger, a
            session) and the sim time (<Code>twin.ottoq_sim_seeded_random</Code>). Nothing depends on the order the engine
            happens to compute things in. That gives two properties at once:
          </P>
          <Bullets items={[
            <><B>Different seeds, independent worlds.</B> Running many seeds samples the range of days a depot will see:
              a Monte Carlo study of the site, not one lucky afternoon.</>,
            <><B>The same seed, the same world, byte for byte.</B> OTTO-Q and a plain first-come-first-served depot can
              run on the identical day, so a difference between them is the policy and not the luck of the draw (common
              random numbers).</>,
            <><B>Knobs to stress a world on purpose.</B> Shift, spread, floor, ceiling and rate knobs make a day hotter,
              busier or more fault-prone, on the Control tab.</>,
          ]} />
          {manifest?.boot_draw ? (
            <div className="rounded border border-white/[0.08] bg-canvas-panel/60 p-2.5">
              <div className="text-[10px] font-semibold uppercase tracking-[0.07em] text-ink-faint">This run's hand</div>
              <p className="mt-1 text-[11px] leading-4 text-ink">
                Seed <span className="font-mono">{String(manifest.boot_draw.seed ?? manifest.random_seed ?? '—')}</span>
                {manifest.boot_draw.vehicles_drawn != null ? ` · ${fmtInt(manifest.boot_draw.vehicles_drawn)} vehicles dealt their own condition` : ''}
                {soh ? ` · battery health ${soh.min.toFixed(1)}% to ${soh.max.toFixed(1)}% (mean ${soh.avg.toFixed(1)}%)` : ''}.
              </p>
              <Source>public.ottoq_twin_boot_manifest(run {runId?.slice(0, 8)})</Source>
            </div>
          ) : null}
          {groups.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.07em] text-ink-faint">The variables, and when each is drawn</div>
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
                          <span className="text-ink-faint"> · drawn {v.when}{v.wired ? '' : ' · not yet wired into the world'}</span>
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
          kicker="Intelligence proposes at every level, and one accountable, reproducible path disposes. That is what lets an AI agent and a GPU solver work on a depot of real vehicles without being trusted blindly.">
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
                  <p className="mt-0.5 text-[11px] leading-4 text-ink-dim">{LAYER_INFO[p.id].what}</p>
                </div>
              </li>
            ))}
          </ol>
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.07em] text-ink-faint">Every model and solver call, on the record</div>
            {facts.ledger == null ? (
              <p className="mt-1 text-ink-faint">{loading ? 'Reading the intelligence ledger…' : 'The intelligence ledger did not answer. —'}</p>
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
            <div className="text-[10px] font-semibold uppercase tracking-[0.07em] text-ink-faint">Learning from itself, inside our own ecosystem</div>
            <div className="mt-1">
              <Bullets items={[
                <><B>A corpus it writes itself.</B> Every decision, offer, refusal and outcome is recorded as structured
                  evidence under a run ID: who proposed what, what the shield said, what the decide path did, and what
                  happened next. It is generated inside our own ecosystem, not scraped or labelled by anyone else, and the
                  evidence tables survive run purges by design.</>,
                <><B>The challenger, live.</B> Every minute it questions OTTO-Q's own recent decisions (was there a better
                  stall, did a car wait when it need not have) and grades each question in hindsight against what actually
                  happened. It is read-only: it never changes the engine. Its live board is on the <button type="button" className="text-brand-hot hover:underline" onClick={() => open('agent')}>Agent tab</button>.</>,
                <><B>The research wing, overnight in the twin.</B> A proposed change to a setting is tested in pairs: the same
                  simulated day, the same seed, run once with the current value and once with the proposed one. A change
                  that wins becomes a recommendation, and a person reviews it and ships it as a certified change.</>,
                <><B>Worlds that keep up.</B> The live public sources (grid demand, weather) are refit weekly, so the days
                  the twin draws track the present.</>,
                <><B>What it deliberately does not do.</B> It does not retrain on its own simulated outcomes: the twin
                  replays OTTO-Q's own decisions, so that would tune it toward its own mistakes. And in production it will
                  decide in real time and learn overnight from the day's real data (how long charges take, when cars come
                  back, which chargers fault), and never run an experiment on a real vehicle.</>,
              ]} />
            </div>
          </div>
        </Section>

        {/* ── 6. safety ──────────────────────────────────────────── */}
        <Section id="bg-safety" icon={ShieldCheck} title="The safety harness"
          kicker="Software that moves vehicles has to be unable to do some things, not merely unlikely to. OTTO-Q's harness is layered so that each layer holds even if the one above it is wrong, and it is custom because the risk is physical.">
          <P>
            Off-the-shelf AI guardrails govern what a model says. OTTO-Q's risk is what a depot does: a car released half
            charged, a stall booked twice, a charge started on a faulted charger. So the harness is built where physical
            decisions are made, inside the database transaction that makes them, and it holds for every caller, including
            agents nobody has written yet.
          </P>
          <div className="space-y-2">
            <Layer n={1} title="Physical limits in the database" status="enforced">
              <p>
                Below every rule sit limits the database refuses outright: a calendar constraint that makes a double
                booking impossible (<Code>ottoq_stall_bookings</Code> EXCLUDE), one vehicle per stall by unique index, and a
                signed event log that rejects every edit and deletion (<Code>ottoq_events</Code>).
              </p>
            </Layer>
            <Layer n={2} title="The rule shield" status="enforced">
              {shield ? (
                <>
                  <p>
                    <B>{fmtInt(shield.codes)} rules</B>, versioned and kept as data, each with parameters a fleet's
                    contract can set. They are checked at the decision points the engine probes, and every verdict is
                    logged.
                  </p>
                  <ul className="space-y-0.5">
                    {shield.categories.map((c) => (
                      <li key={c.category} className="flex gap-2"><span className="w-6 shrink-0 text-right font-mono text-ink">{c.codes}</span><span>{c.title}</span></li>
                    ))}
                  </ul>
                  {facts.posture && (
                    <p>
                      Where a failing rule refuses the action ({fmtInt(shield.enforced.length)} points): when{' '}
                      {shield.enforced.map((c) => CONTEXT_WORDS[c] ?? c.replace(/_/g, ' ')).join('; when ')}. Where it
                      records for review without refusing ({fmtInt(shield.advisory.length)}): when{' '}
                      {shield.advisory.map((c) => CONTEXT_WORDS[c] ?? c.replace(/_/g, ' ')).join('; when ')}. A point is
                      promoted to refusing only after its inputs are proven clean, one at a time.
                    </p>
                  )}
                  <Source>public.ottoq_rules, public.ottoq_shield_probe_posture() (derived from the engine's own code on every read)</Source>
                </>
              ) : <p className="text-ink-faint">{loading ? 'Reading the rule catalog…' : 'The rule catalog did not answer. —'}</p>}
            </Layer>
            <Layer n={3} title="Vehicle first" status="enforced">
              <p>
                A car's charge target and its services belong to its owner, by contract. Every car charges to 100% unless
                its owner sets a lower limit, and no car leaves with a service still needed: one departure test runs at
                every exit (<Code>ottoq_departure_clear</Code>). Cars may queue; a car's needs are never traded away for
                throughput. A charge ends short only for a charger fault (the car is re-queued) or a vehicle emergency.
              </p>
            </Layer>
            <Layer n={4} title="The agent harness" status="enforced">
              <p>
                Two seats, governed differently because they do different kinds of damage. <B>Settings:</B> an agent may
                only change catalogued settings, clamped to declared limits and judged by the shield. <B>Physical acts:</B>
                {' '}offers enter through one door and the decide path disposes of every one; by database privilege an
                agent's token can propose and cannot write a booking.
              </p>
            </Layer>
            <Layer n={5} title="The solver harness" status="enforced">
              <p>
                A solver that cannot promise the same answer twice only ever proposes, behind the deterministic core, with
                its proposals hashed into the run's certification. CP-SAT runs pinned: one version, a deterministic time
                budget, a fixed worker count.
              </p>
            </Layer>
            <Layer n={6} title="Continuous certification" status="enforced">
              <p>
                Pairs of runs on the same seed are compared byte for byte across fourteen independent checks (decisions,
                bookings, energy, proposals, rules, events and more), on a schedule and after every engine change that
                should invalidate them.
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
                OTTO-Q never tests itself on real vehicles. Hypotheses and paired tests belong to the research wing, in
                the twin. Automatic promotion of settings is off: a winning test is a recommendation a person ships.
              </p>
            </Layer>
            <Layer n={8} title="What is being built next" status="building">
              <Bullets items={[
                <><B>A door for outside agents.</B> A fleet owner's agent or a personal assistant gets a scoped token to
                  read the depot and ask for changes. Nothing happens until a person approves, and an approved request goes
                  through the engine's own doors. Written and tested, not yet live.</>,
                <><B>Rules that judge outcomes, not only starts.</B> State-machine and presence checks record their
                  verdicts today and are promoted to refusing one decision point at a time as their inputs are proven.</>,
                <><B>A separate research database</B> before real telemetry flows, so overnight tests never compete with a
                  live depot for the scheduler.</>,
              ]} />
            </Layer>
          </div>
        </Section>

        {/* ── 7. value ───────────────────────────────────────────── */}
        <Section id="bg-value" icon={Sparkles} title="What it solves"
          kicker="An autonomous vehicle earns only while it is working. Every trip home for a charge, a cleaning or a service is time off the road, and the depot is where fleets stall as they grow.">
          <P>
            In scheduling terms a depot is a resource-constrained flow shop. Each car needs an ordered set of operations.
            Each stall or bay can perform some operations and not others, one car at a time. Every charge draws on one
            shared site power limit, and every car has a time it must be ready by. Arrivals, charge times and faults are
            uncertain, so the schedule is re-solved continuously and the site is never without one.
          </P>
          <Bullets items={[
            <><B>The whole visit, scheduled as one.</B> Charging, cleaning, inspection, software and staging are planned
              together rather than charging alone. Work that can be done while a car charges (a sensor clean, an
              interior tidy and inspection, remote diagnostics, a software update) starts on the charger instead of
              waiting until after it, and each move between stalls is planned as a step of its own.</>,
            <><B>Every car leaves complete.</B> A car charges to 100% unless its owner sets a lower limit, and it does not
              leave with a needed service open. When a car is not ready, OTTO-Q re-plans it to its next charger or bay, or
              to temporary parking until one frees, instead of releasing it short. Pressure on the site is answered with
              better ordering and more capacity, never with a shorter charge.</>,
            <><B>Power planned, not just drawn.</B> Charging is planned against the site's power limit and the utility's
              demand charge, with the site battery and solar. What that saves is measured on paired test days, not
              assumed.</>,
            <><B>One site, many fleets, each on its own terms.</B> Fleets with different owners can share a depot. Each
              contract is versioned data, not code, that the rules and the charge target read when they decide. The
              contracts on file today carry identical terms: the mechanism is built, and the differences arrive with
              real contracts.</>,
            <><B>A record for every service.</B> Every decision is logged under its run ID, with the engine that proposed
              it and what was enacted, and every completed operation ends in a signed service record attributed to its fleet and asset class, with the
              energy metered on charges. Pricing those records against the tariff is being built.</>,
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
                The Value tab shows what the twin has measured, OTTO-Q against a plain depot on the same seeded days. It
                claims nothing a test day has not shown, and says so where OTTO-Q did worse.
              </p>
            )}
            <button type="button" onClick={() => open('value')} className="mt-1.5 inline-flex items-center gap-1 text-[10.5px] text-brand-hot hover:underline">
              Open the Value tab <ArrowRight aria-hidden size={10} />
            </button>
          </div>
        </Section>

        {/* ── 8. the technical edge ──────────────────────────────── */}
        <Section id="bg-edge" icon={Target} title="The technical edge"
          kicker="Orchestrating a depot of autonomous vehicles is hard for specific, technical reasons. Each one below is something OTTO-Q was built around, and each can be checked: in the engine, or at the outside source linked beneath it.">
          <div className="space-y-2">
            <Edge title="The same answer, twice"
              hard={<>A schedule that moves real vehicles has to be explainable afterwards, and a claim about a depot has
                to be repeatable by someone else. That is not a given: NVIDIA's GPU optimizer, cuOpt, documents no seed and
                no determinism setting for its routing solver, and says of its mixed-integer solver's deterministic mode
                that it "does not yet guarantee fully deterministic results in all scenarios".</>}
              ours={<>Its decide path is deterministic. The same seed, scenario and engine produce the same decisions,
                byte for byte; pairs of runs are compared across fourteen independent checks on a schedule (the
                certification in the safety harness above); and every figure it reports carries a run ID that replays
                it.</>}
              source={<>
                <ExtLink href="https://docs.nvidia.com/cuopt/user-guide/latest/routing-features.html">cuOpt routing features</ExtLink>
                {' · '}<ExtLink href="https://docs.nvidia.com/cuopt/user-guide/latest/mip-settings.html">cuOpt MIP settings</ExtLink>
                {' · '}NVIDIA cuOpt 26.08 documentation, checked Oct 2, 2026
              </>} />
            <Edge title="AI that proposes, and never disposes"
              hard={<>Language models and GPU solvers are fast and capable. They can also be wrong, late, or different on a
                second try, and a vehicle cannot wait for a retry.</>}
              ours={<>Every model and solver only proposes. The AI agent chooses what the next decisions should optimize,
                solvers offer assignments, and one deterministic path decides, behind the rule shield. The agent chooses
                among options the engine already allows; it cannot book a stall or move a car itself, and an outside
                agent's token can propose but, by database privilege, cannot write a booking. Every call is written to an
                append-only ledger with its outcome, so what the AI contributed is counted, not claimed.</>} />
            <Edge title="The right solver for the shape of the problem"
              hard={<>Inside a depot the constraints are scheduling constraints: overlapping charges draw on one shared
                power limit, and a stall or bay holds one car at a time. cuOpt has no primitive for either. It is a
                routing, linear-programming and quadratic-programming solver, with mixed-integer programming in beta, and
                it has no scheduling family.</>}
              ours={<>The site is scheduled by OTTO-Q's own deterministic decide path, with offers from a
                constraint-programming solver, Google OR-Tools CP-SAT, run pinned to one version, a deterministic time
                budget and a fixed worker count: the settings that make it repeatable too. cuOpt stays a proposer, and
                the same path decides on its offers.</>}
              source={<>
                <ExtLink href="https://www.nvidia.com/en-us/ai-data-science/products/cuopt/">NVIDIA cuOpt</ExtLink>
                {' · '}<ExtLink href="https://docs.nvidia.com/cuopt/user-guide/latest/routing-features.html">cuOpt routing features</ExtLink>
                {' · '}checked Oct 2, 2026
              </>} />
            <Edge title="Limits that hold in the transaction"
              hard={<>A depot's risk is physical: a car released half charged, a stall booked twice, a charge started on a
                faulted charger. A limit that holds only for well-behaved callers does not hold.</>}
              ours={<>Its limits sit where decisions are written. A calendar constraint makes a double booking impossible,
                one car per stall is a unique index, the signed event log rejects every edit, one departure test runs at
                every exit, and the rule shield refuses at the decision points it enforces. They hold for every caller,
                including agents nobody has written yet (the safety harness above).</>} />
            <Edge title="A record of service, not only of energy"
              hard={<>The EV industry standardized energy, not service. In OCPI, its roaming standard, the only
                billing-relevant object is the charge detail record, "the description of a concluded charging session". A
                cleaning, an inspection or a repair has no record of its own.</>}
              ours={<>Every operation it completes, energy or not, ends in a signed service record shaped like OCPI's,
                attributed to its fleet and asset class, with the energy metered on charges. Pricing those records against
                the tariff is being built; once it is, a cleaning or an inspection can be settled between a depot and the
                fleets it serves the way a charge is today.</>}
              source={<>
                <ExtLink href="https://github.com/ocpi/ocpi/blob/v2.3.0/mod_cdrs.asciidoc">OCPI CDR module</ExtLink>
                {' · '}<ExtLink href="https://evroaming.org/ocpi-downloads/">OCPI releases</ExtLink>
                {' · '}OCPI 2.2.1 and 2.3.0, the released versions, checked Oct 2, 2026
              </>} />
            <Edge title="Proof before a depot is built"
              hard={<>A site design or a scheduling policy cannot be tried on a real fleet without risking that fleet's
                day, and one good afternoon proves nothing.</>}
              ours={<>The twin draws whole days from distributions fitted to public data, with every assumption
                declared (the data section above). OTTO-Q and a plain
                first-come-first-served depot run the identical seeded day, so a difference between them is the policy and
                not luck, and the engine under test is the engine that would run the site. Where OTTO-Q has not beaten the
                plain depot on a measured day, the Value tab says so.</>} />
          </div>
          <P>
            <B>What it does not claim.</B> Intelligence is not a substitute for capacity. When a depot is short of
            chargers, the answer is more chargers or fewer faults, never shorter charges, and the twin is how to find how
            many.
          </P>
        </Section>

        {/* ── 9. distribution ────────────────────────────────────── */}
        <Section id="bg-distribution" icon={Globe2} title="Distribution and commercialization of AV fleets"
          kicker="Each new city an autonomous fleet enters needs land, power, chargers, cleaning, service bays and staging, and the vehicles only earn while that infrastructure turns them around fast.">
          <Bullets items={[
            <><B>A depot becomes a shared service node.</B> Fleets with different owners can return to one site, each
              served under its own contract, by orchestration that belongs to none of them.</>,
            <><B>Size a depot before it is built.</B> The twin measures how many chargers, what power and how many cars a
              site can stage and turn around, on simulated days drawn from real data, under the same engine that would
              run it.</>,
            <><B>A settlement rail for services.</B> Service records follow the shape of the EV industry's roaming standard
              (OCPI) for any operation, not only energy, so that servicing can be billed between a depot and the fleets
              it serves once pricing lands.</>,
            <><B>Software over hardware others own.</B> OTTO-Q orchestrates vehicles, chargers and sites; it never drives a
              car and never runs its mission.</>,
          ]} />
        </Section>

        {/* ── 10. agnostic ───────────────────────────────────────── */}
        <Section id="bg-agnostic" icon={Boxes} title="Why it is agnostic"
          kicker="Every autonomous machine ends its work cycle with the same four questions. OTTO-Q owns those four questions and nothing else.">
          <Bullets items={[
            <><B>A kernel that never mentions a sector.</B> A sector arrives as a pack of declarative data (its asset
              types, operations, constraints and tariffs) plus adapters that translate its protocols.</>,
            <><B>Tested, not asserted.</B> Four packs (robotaxi, yard logistics, mining and vertiport) load against one
              closed specification and schedule with no change to the kernel: robotaxi and yard logistics fully
              exercised, mining and vertiport on paper. The one genuine solver extension found is written down:
              vertiport pad separation, two named points that may not be active at once
              (<Code>CONFORMANCE_FINDINGS.md</Code>, Aug 22, 2026).</>,
            <><B>Standard protocols.</B> OCPP 2.0.1 for chargers, OCPI-shaped service records, and a VDA 5050 adapter
              draft for warehouse robots.</>,
            <><B>Agnostic to whose autonomy.</B> It works with any driving stack through one interface, the recall
              decision: when to come in, where, for what, and by when.</>,
            <><B>The same shape fits other fleets:</B> delivery robots, yard tractors, haul trucks, drones and eVTOLs, and
              unmanned vessels returning to a sustainment node.</>,
          ]} />
        </Section>

        {/* ── 11. live facts ─────────────────────────────────────── */}
        <Section id="bg-facts" icon={CircuitBoard} title="Live facts, read from the engine"
          kicker="Each card is read from the engine when this tab opens, and names its source. A card that shows — is a source that did not answer, never a zero.">
          <div className="grid gap-2 sm:grid-cols-2">
            <Fact
              value={canon ? `${fmtInt(canon.passing)} / ${fmtInt(canon.columns)}` : '—'}
              label="certification columns replaying byte for byte"
              sub={canon?.lastCertified ? `fourteen checks per pair · last certified ${dayCT(canon.lastCertified)}` : null}
              source="ottoq_determinism_canon" />
            <Fact
              value={shield ? fmtInt(shield.codes) : '—'}
              label="safety rules, versioned as data"
              sub={shield && facts.posture ? `${fmtInt(shield.enforced.length)} decision points refuse · ${fmtInt(shield.advisory.length)} record` : null}
              source="ottoq_rules · ottoq_shield_probe_posture()" />
            <Fact value={fmtInt(nem?.count)} label="agent decisions, every one on the record"
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
              label="variables drawn into every simulated world"
              sub={groups.length ? `${groups.length} domains · ${fmtInt(groups.reduce((s, g) => s + g.wired, 0))} wired` : null}
              source="ottoq_variability_catalog" />
          </div>
          {facts.failed.length > 0 && (
            <p className="text-[10.5px] text-amber-300">Did not answer on the last read: {facts.failed.join(', ')}.</p>
          )}
          <p className="text-[10px] text-ink-faint">
            {facts.readAt ? `Last read ${dayCT(facts.readAt)}. ` : ''}Re-read every five minutes while this tab is open.
          </p>
          <button type="button" onClick={() => top.current?.scrollIntoView({ behavior: 'smooth' })}
            className="text-[10.5px] text-ink-faint hover:text-ink-dim">Back to the top</button>
        </Section>
      </div>
    </ScrollArea>
  );
}

export default TwinBackgroundTab;
