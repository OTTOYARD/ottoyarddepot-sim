import { useState } from 'react';
import type { CableLine, CableRun } from '@/lib/robotics/catalog';

/**
 * THE CABLE SCHEDULE (cad/otto_cad/cables.py): every cable, hose and tube of the robot, once, from the device it leaves to
 * the one it reaches, with each piece of its route, what carries it there and how long it is. The parts list counts a
 * line only in the pieces the CAD draws; this list joins them, so a line is never bought short.
 */

const RUN_KIND: Record<CableRun['kind'], string> = {
  drawn: 'Drawn', conduit: 'In its conduit', chain: 'In a cable chain', boot: 'In a boot', reel: 'On a reel', loop: 'A free loop',
  duct: 'In a duct or box', arm: 'In the arm', site: 'Site',
};

const RUN_HOW: Record<CableRun['kind'], string> = {
  drawn: 'its drawn centreline', conduit: 'the conduit\'s centreline', chain: 'its lane in the chain, the same at every pose',
  boot: 'the boot\'s length and the slack its worst bend needs', reel: 'what the reel holds', loop: 'its fixed length',
  duct: 'a planned route in the duct; the tolerance is what its place in the duct can change',
  arm: 'a planned route between 2 points of the model', site: 'what the model shows; the rest is the site\'s',
};

const fmtM = (mm: number): string => `${(mm / 1000).toFixed(2)} m`;

function RunRow({ r, onPick, known }: { r: CableRun; onPick: (id: string) => void; known: (id: string) => boolean }) {
  return (
    <li className="leading-4" data-testid="cable-run" data-kind={r.kind}>
      <span className="font-mono tabular-nums text-ink">{fmtM(r.mm)}</span>
      {r.tol > 0 && <span className="font-mono tabular-nums text-ink-dim"> ±{Math.round(r.tol)} mm</span>}
      <span className="text-ink-dim"> · {RUN_KIND[r.kind]}</span>
      {r.via && (known(r.via)
        ? <> · <button type="button" onClick={() => onPick(r.via)} className="font-mono text-ink underline-offset-2 hover:underline">{r.via}</button></>
        : <span className="font-mono text-ink-dim"> · {r.via}</span>)}
      <span className="block text-ink-dim">{r.where}{r.bend != null ? `. Tightest bend ${Math.round(r.bend)} mm` : ''}{r.range ? `. ${Math.round(r.range[0])} to ${Math.round(r.range[1])} mm out` : ''}.</span>
    </li>
  );
}

export function CableSchedule({ cables, csvUrl, onPick, known }: {
  cables: CableLine[]; csvUrl?: string; onPick: (id: string) => void; known: (id: string) => boolean;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  if (!cables.length) return null;
  const route = cables.reduce((a, c) => a + c.routeMm, 0);
  const order = cables.reduce((a, c) => a + c.orderMm, 0);
  const openItems = cables.filter((c) => c.open.length > 0).length;
  const shown = all ? cables : cables.slice(0, 10);
  return (
    <div className="space-y-1" data-testid="cable-schedule">
      <h4 className="font-display text-[10px] uppercase tracking-[0.08em] text-ink-dim">Cables, hoses and tubes, each from end to end</h4>
      <p className="text-[10.5px] leading-4 text-ink-dim">
        {cables.length} lines: {fmtM(route)} of route, {fmtM(order)} to order. The order length adds each line&apos;s tolerance and the
        length to make it off at each end, rounded up to 0.1 m. The parts list counts only the pieces the CAD draws.
        {openItems > 0 && ` ${openItems} line${openItems === 1 ? ' has' : 's have'} an open item.`}
      </p>
      <ul className="space-y-0.5" data-testid="cable-list">
        {shown.map((c) => (
          <li key={c.id}>
            <button type="button" onClick={() => setOpen(open === c.id ? null : c.id)} aria-expanded={open === c.id} data-testid="cable"
              data-cable={c.id}
              className={`flex w-full items-baseline justify-between gap-2 rounded px-1.5 py-0.5 text-left text-[11px] transition-colors ${open === c.id ? 'bg-brand-red/15' : 'hover:bg-white/[0.05]'}`}>
              <span className="min-w-0 truncate text-ink">{c.open.length > 0 && <span className="text-amber-300" aria-label="open item">● </span>}{c.name}</span>
              <span className="shrink-0 font-mono text-[10px] tabular-nums text-ink-dim">{fmtM(c.routeMm)} · order {fmtM(c.orderMm)}</span>
            </button>
            {open === c.id && (
              <div className="space-y-1 px-1.5 pb-1.5 pt-0.5 text-[10.5px]" data-testid="cable-detail">
                <p className="leading-4 text-ink">From {c.from} to {c.to}.</p>
                <p className="leading-4 text-ink-dim">{c.spec}. Outside diameter {c.od} mm.
                  {c.bendMm.fixed > 0 ? ` It may bend on ${c.bendMm.fixed} mm where it lies still` : ''}
                  {c.bendMm.moving > 0 ? `${c.bendMm.fixed > 0 ? ',' : ' It may bend on'} ${c.bendMm.moving} mm where it moves` : ''}
                  {(c.bendMm.fixed > 0 || c.bendMm.moving > 0) ? '.' : ''}</p>
                <ol className="space-y-1 border-l border-white/[0.08] pl-2">
                  {c.runs.map((r, i) => <RunRow key={i} r={r} onPick={onPick} known={known} />)}
                </ol>
                <p className="leading-4 text-ink-dim">
                  Route {fmtM(c.routeMm)}{c.tolMm > 0 ? ` ±${Math.round(c.tolMm)} mm` : ''}
                  {(c.tails.a > 0 || c.tails.b > 0) ? `, and ${Math.round(c.tails.a + c.tails.b)} mm to make it off: ${c.tails.basis}` : ''}.
                  {' '}Order {fmtM(c.orderMm)}.
                </p>
                {c.notes.map((n, i) => <p key={i} className="leading-4 text-ink-dim">{n}</p>)}
                {c.open.map((n, i) => <p key={i} className="leading-4 text-amber-300" data-testid="cable-open">Open: {n}</p>)}
              </div>
            )}
          </li>
        ))}
      </ul>
      {cables.length > 10 && (
        <button type="button" onClick={() => setAll((v) => !v)} className="px-1.5 text-[10.5px] text-ink-dim hover:text-ink" data-testid="cable-all">
          {all ? 'Show the first 10' : `Show all ${cables.length}`}
        </button>
      )}
      <p className="text-[10px] leading-4 text-ink-dim">How each length is known: {Object.entries(RUN_HOW)
        .filter(([k]) => cables.some((c) => c.runs.some((r) => r.kind === k)))
        .map(([k, v]) => `${RUN_KIND[k as CableRun['kind']].toLowerCase()}, ${v}`).join('; ')}.</p>
      {csvUrl && (
        <a href={csvUrl} download className="inline-block px-1.5 text-[10.5px] text-ink underline-offset-2 hover:underline">Download the cable schedule (CSV)</a>
      )}
    </div>
  );
}
