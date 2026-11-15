"""THE CABLE SCHEDULE: every cable, hose and tube a robot needs, each listed once, from the device it leaves to the one it
reaches, with each piece of its route, what carries it there and how long it is. cad/build.py writes it into the bill
of materials (`cables`) and as <robot>.cables.csv; the Robotics tab lists it.

Why (2026-11-15, Chase: "I know the exact pieces and length of certain cables and exact routing of electrical wire and
distances of machinery and parts that I will need"): the bill of materials counts a line by the pieces the CAD draws.
A DC core read 'D 15 x 1822' there, its piece in the feed trench, and it runs on through 2 cable chains and 3 ducts to
the riser, about 4 times as far. Bought from the parts list it would have been cut short. Here each line is one row
with its pieces in order, and every part of the bill of materials that is a piece of a line says which line.

Each piece of a route has a kind, which says how its length is known:
  drawn    the line is drawn there as its own solid: its drawn centreline (exact to the model)
  conduit  in a drawn conduit, a drawn tube or a drawn pipe: the conduit's centreline (exact to the model)
  chain    in a cable chain, in its own lane: links x pitch - pi x v (flex.content_length), the same at every pose
  boot     in a moving boot: the boot's length, and the slack its worst bend over the twin's poses asks of a line at
           the boot's wall (the boot's turning angle x the line's greatest offset from the boot's axis)
  reel     on a spring reel: what the reel holds; the length in use moves with the joint (its range is given)
  loop     a free loop of fixed length (exact to the model)
  duct     through a duct, a trunk, a box or a hollow link that the CAD draws without drawing its lines one by one: a
           planned route through it, its corners bent on the line's own radius, +/- `tol`, what the line's place in the
           duct can change (half the duct's inside width at each turn)
  arm      inside the arm, where the CAD draws no duct: a planned route between 2 points the model fixes (a terminal box,
           an actuator's gland), straight or with sharp corners, +/- `tol`
  site     outside the machine (the building's ducts, the canopy's tray, inside a cabinet the CAD draws as an envelope):
           what the model shows of it; the rest is the site's, and the line's tail allowance says how much to add

Lengths are mm. A line's ORDER length rounds up to the next 100 mm: its route, its tolerance and its 2 tail allowances
(the length to make off inside the box or cabinet at each end, given with its basis).
"""
from __future__ import annotations

import csv
import io
import math
from dataclasses import dataclass, field

import numpy as np

KINDS = ('drawn', 'conduit', 'chain', 'boot', 'reel', 'loop', 'duct', 'arm', 'site')
ROUND_MM = 100.0


@dataclass
class Run:
    kind: str
    via: str                   # the bill-of-materials id it is drawn as or runs in ('' for none)
    where: str                 # where, in plain words
    mm: float                  # its length here
    tol: float = 0.0           # +/- mm
    bend: float | None = None  # its tightest centreline bend here, mm (None: no bend, or a box's sharp corners)
    moving: bool = False       # it flexes here in service
    rng: tuple | None = None   # (min, max) in use, mm: a reel's or a stretch line's
    flex: object = None        # a boot's FlexDef: finish() adds the slack its worst bend asks


@dataclass
class Line:
    id: str
    name: str
    kind: str                  # 'dc', 'power', 'control', 'network', 'safety', 'coolant', 'air', 'water', 'chemical', 'hybrid'
    od: float                  # outside diameter, mm (a bar: its thickness; a braid pair in a boot: the boot's)
    spec: str
    a: str                     # where it starts
    b: str                     # where it ends
    sub: str                   # the subsystem it belongs to
    bend_fixed: float = 0.0    # its smallest allowed bend radius where it lies still, and where it moves, mm
    bend_moving: float = 0.0
    runs: list = field(default_factory=list)
    tail_a: float = 0.0
    tail_b: float = 0.0
    tails: str = ''            # what the tails are for
    notes: list = field(default_factory=list)
    open: list = field(default_factory=list)    # what the model does not yet route or decide

    def run(self, kind: str, via: str, where: str, mm: float, tol: float = 0.0, bend: float | None = None,
            moving: bool = False, rng: tuple | None = None, flex: object = None) -> 'Line':
        if kind not in KINDS:
            raise ValueError(f'{self.id}: no route kind {kind}')
        if not (mm >= 0.0) or not math.isfinite(mm):
            raise ValueError(f'{self.id}: {where}: length {mm}')
        self.runs.append(Run(kind, via, where, float(mm), float(tol), None if bend is None else float(bend), moving, rng, flex))
        return self


def bent_length(points, radii=0.0) -> tuple[float, float]:
    """A route of straight runs between `points` (mm), each corner bent on its centreline radius (one for all, or one a
    corner; 0, a sharp corner: an upper bound for any route through the points). Returns its length and its tightest
    bend (inf when it has none). Raises when a bend does not fit between its neighbours."""
    P = [np.asarray(p, dtype=float) for p in points]
    n = len(P)
    if n < 2:
        raise ValueError('a route needs 2 points')
    R = [float(r) for r in radii] if isinstance(radii, (list, tuple)) else [float(radii)] * max(0, n - 2)
    if len(R) != max(0, n - 2):
        raise ValueError(f'{n - 2} corners, {len(R)} radii')
    seg = [float(np.linalg.norm(P[k + 1] - P[k])) for k in range(n - 1)]
    t, arc, rmin = [0.0] * n, 0.0, math.inf
    for i in range(1, n - 1):
        u1, u2 = (P[i] - P[i - 1]) / seg[i - 1], (P[i + 1] - P[i]) / seg[i]
        ang = math.acos(max(-1.0, min(1.0, float(np.dot(u1, u2)))))
        if ang < 1e-9 or R[i - 1] <= 0.0:
            continue
        t[i] = R[i - 1] * math.tan(ang / 2.0)
        arc += R[i - 1] * ang
        rmin = min(rmin, R[i - 1])
    for k in range(n - 1):
        if t[k] + t[k + 1] > seg[k] + 1e-6:
            raise ValueError(f'the bends at {P[k].round(1).tolist()} and {P[k + 1].round(1).tolist()} need '
                             f'{t[k] + t[k + 1]:.1f} mm of a {seg[k]:.1f} mm run')
    return sum(seg) - 2.0 * sum(t) + arc, rmin


def chain_mm(fd, line_id: str) -> tuple[float, float]:
    """A line's length through a chain and the radius it bends on there (flex.content_length)."""
    from .flex import content_length
    for c in fd.contents:
        if c['id'] == line_id:
            return content_length(fd, c), fd.bend_r - c['v']
    raise ValueError(f'{fd.id} carries no line {line_id}')


def polyline_turning(P: np.ndarray) -> float:
    """The total angle a polyline turns through, rad."""
    tot = 0.0
    for i in range(1, len(P) - 1):
        a, b = P[i] - P[i - 1], P[i + 1] - P[i]
        na, nb = float(np.linalg.norm(a)), float(np.linalg.norm(b))
        if na < 1e-9 or nb < 1e-9:
            continue
        tot += math.acos(max(-1.0, min(1.0, float(np.dot(a, b)) / (na * nb))))
    return tot


def finish(model, poses: list[dict]) -> list[dict]:
    """Complete every line (the boots' slack over `poses`), check it, and cross-reference the bill of materials. Sets
    model.cable_rows (the schedule, JSON-ready) and model.cable_refs ({bill-of-materials id: [line ids]}). Raises on a
    route piece with an unknown part, or a bend tighter than its line allows."""
    from .flex import node_frames, solve
    lines: list[Line] = getattr(model, 'cables', [])
    ids = set(model.parts) | {f.id for f in model.flexes} | {f.link_part.id for f in model.flexes if f.kind == 'chain'}
    frames = [node_frames(model.root, p.get('angles', {})) for p in poses] or [node_frames(model.root, {})]
    turning: dict[str, float] = {}
    tightest: dict[str, float] = {}
    seen: set[str] = set()
    rows, refs = [], {}
    for ln in lines:
        if ln.id in seen:
            raise ValueError(f'cable schedule: {ln.id} twice')
        seen.add(ln.id)
        if not ln.runs:
            raise ValueError(f'cable schedule: {ln.id} has no route')
        worst_fixed = worst_moving = math.inf
        for r in ln.runs:
            if r.via and r.via not in ids:
                raise ValueError(f'cable schedule: {ln.id} runs in {r.via}, which the model does not have')
            if r.kind == 'boot':
                fd = r.flex
                if fd.id not in turning:
                    sols = [solve(fd, fr) for fr in frames]
                    turning[fd.id] = max(polyline_turning(x['points']) for x in sols)
                    tightest[fd.id] = min((x['minRadius'] for x in sols if not x.get('tight')), default=0.0)
                r.bend = min(r.bend if r.bend is not None else math.inf, tightest[fd.id])
                e = max(0.0, fd.r - ln.od / 2.0)
                slack = e * turning[fd.id]
                r.mm = fd.length + slack
                r.where += (f'; {fd.length:.0f} mm and {slack:.0f} mm of slack (at its worst pose the boot turns '
                            f'{math.degrees(turning[fd.id]):.0f} degrees, and the line lies up to {e:.0f} mm off its axis)')
            if r.flex is not None and r.kind in ('loop', 'reel'):
                sols = [solve(r.flex, fr) for fr in frames]
                if r.kind == 'loop':
                    r.bend = min((x['minRadius'] for x in sols if not x.get('tight')), default=0.0)
                else:
                    ls = [float(x['length']) for x in sols]
                    r.rng = (min(ls), max(ls))
                    r.where += f'; {min(ls):.0f} to {max(ls):.0f} mm of it out over the twin\'s poses'
            if r.bend is not None:
                if r.moving:
                    worst_moving = min(worst_moving, r.bend)
                else:
                    worst_fixed = min(worst_fixed, r.bend)
        if worst_fixed < ln.bend_fixed - 1e-6:
            raise ValueError(f'cable schedule: {ln.id} bends on {worst_fixed:.0f} mm where it lies still; it may bend on {ln.bend_fixed:.0f}')
        if worst_moving < ln.bend_moving - 1e-6:
            raise ValueError(f'cable schedule: {ln.id} bends on {worst_moving:.0f} mm where it moves; it may bend on {ln.bend_moving:.0f}')
        route = sum(r.mm for r in ln.runs)
        tol = sum(r.tol for r in ln.runs)
        order = math.ceil((route + tol + ln.tail_a + ln.tail_b) / ROUND_MM - 1e-9) * ROUND_MM
        pieces = sorted({r.via for r in ln.runs if r.via and r.kind in ('drawn', 'conduit', 'chain', 'boot', 'reel', 'loop')})
        for pid in {r.via for r in ln.runs if r.via}:
            refs.setdefault(pid, []).append(ln.id)
        rows.append({
            'id': ln.id, 'name': ln.name, 'kind': ln.kind, 'od': ln.od, 'spec': ln.spec, 'from': ln.a, 'to': ln.b,
            'sub': ln.sub,
            'runs': [{'kind': r.kind, 'via': r.via, 'where': r.where, 'mm': round(r.mm, 1), 'tol': round(r.tol, 1),
                      'bend': None if r.bend is None else round(r.bend, 1), 'moving': r.moving,
                      'range': None if r.rng is None else [round(r.rng[0], 1), round(r.rng[1], 1)]} for r in ln.runs],
            'routeMm': round(route, 1), 'tolMm': round(tol, 1),
            'tails': {'a': ln.tail_a, 'b': ln.tail_b, 'basis': ln.tails}, 'orderMm': order,
            'bendMm': {'fixed': ln.bend_fixed, 'moving': ln.bend_moving,
                       'tightestFixed': None if worst_fixed == math.inf else round(worst_fixed, 1),
                       'tightestMoving': None if worst_moving == math.inf else round(worst_moving, 1)},
            'pieces': pieces, 'notes': ln.notes, 'open': ln.open,
        })
    model.cable_rows = rows
    model.cable_refs = refs
    return rows


def _run_text(x: dict) -> str:
    tol = f" +/-{x['tol']:.0f}" if x['tol'] else ''
    return f"{x['kind']} {x['via'] or '-'} {x['mm']:.0f}{tol}: {x['where']}"


def to_csv(rows: list[dict]) -> str:
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(['id', 'name', 'kind', 'outside diameter mm', 'from', 'to', 'route mm', 'tolerance +/- mm', 'tail at start mm',
                'tail at end mm', 'order length mm', 'tightest bend still mm', 'allowed still mm', 'tightest bend moving mm',
                'allowed moving mm', 'pieces', 'route', 'tails', 'notes', 'open'])
    for r in rows:
        w.writerow([r['id'], r['name'], r['kind'], r['od'], r['from'], r['to'], r['routeMm'], r['tolMm'], r['tails']['a'],
                    r['tails']['b'], r['orderMm'], r['bendMm']['tightestFixed'] or '', r['bendMm']['fixed'],
                    r['bendMm']['tightestMoving'] or '', r['bendMm']['moving'], ' '.join(r['pieces']),
                    ' | '.join(_run_text(x) for x in r['runs']),
                    r['tails']['basis'], ' '.join(r['notes']), ' '.join(r['open'])])
    return out.getvalue()
