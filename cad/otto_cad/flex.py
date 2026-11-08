"""Flexible lines: the cables, hoses, ducts and energy chains that cross a robot's moving joints.

A RIGID part is one solid in one node's frame and moves with that node. A line that runs from one node to another
cannot be: its shape changes with the pose. So a flex line is defined by what does not change -- where it is held at
each end (an ANCHOR: a point, and the direction the line leaves or enters there, in that node's frame), how long it is,
how tight it may bend -- and its shape is SOLVED at each pose. The CAD (this file) and the viewer
(src/lib/robotics/flexLines.ts) solve it the same way, and cadFlex.test.ts holds the two to the same points.

KINDS
  loop     A cable or hose of fixed length between its 2 anchors. Its centreline is 2 cubic curves that meet at a
           middle point: the first leaves A along A's direction, the second enters B along B's, and both cross the
           middle point along the chord. The middle point stands off the chord's midpoint along the loop's BULGE
           (gravity for a loop that hangs, or away from the joint for one that wraps round it), as far as makes
           the curve the line's length; each handle is a share (0.5 unless the line says) of the distance from its
           end to the middle point, so the loop stays round as it deepens. A real cable takes its minimum-energy shape; this U is a close, cheap
           stand-in that the CAD and the viewer can both solve every frame.
           Two options model the parts real cable systems use: a spring RETRACTOR (retract_k > 0) keeps the loop at
           retract_k x its chord, within [lmin, lmax], so a long span stays nearly taut; and a SWIVEL at an anchor
           (a ball-joint clamp or a turning cable outlet, `swivel` degrees) lets the line's direction there turn
           toward the other anchor by up to that angle. A ball joint between 2 lines (pair_a / pair_b) points along
           the bisector of their 2 chords, so both lines solve the same direction there and the cable runs straight
           through it.
           A span held near its chord by a retractor takes the 'cubic' shape instead: one cubic curve whose 2
           handles grow together (with a gravity sag in proportion) until it is the line's length; its curvature
           has no break, so a gentle span reads gentle.
  stretch  A straight run whose length follows its anchors: a cable or hose paid out by a spring reel, a coiled
           (spiral) cable, or a bellows duct. Its length must stay inside the range the part allows.
  chain    An energy chain (cable carrier) on a linear axis: a run fixed to the floor, a 180 degree bend of fixed
           radius, and a run that moves with the machine. The bend rolls along at half the speed of the machine.

CHECKS AT EACH POSE (check(), and check.py's clash check, which builds each line's solid at each pose):
  a loop is never pulled tight (its anchors stay closer than its length) and is never bent tighter than its
  minimum bend radius; a stretch stays inside its length range; a chain's moving end stays inside the run the
  chain is built for. Every line is measured for clashes against every part, at every pose.

UNITS. Millimetres in node frames, as the rest of the CAD; the GLB carries metres (glb.py converts).
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np

N_SEG = 32             # a loop is solved and drawn as 32 straight pieces (33 points)
BISECT = 48            # bisection steps on the handle length: far below a micrometre
HMAX_GROW = 6          # the handle's search range doubles from the line's length at most this many times
G_WORLD = (0.0, -1.0, 0.0)


@dataclass
class Anchor:
    """Where a line is held: `node` (a core.Node), a point `p` (mm) and a unit direction `d` in that node's frame.
    At the first anchor `d` is the way the line LEAVES; at the second, the way it ARRIVES (it points into the part
    that holds the line's end)."""
    node: object
    p: tuple[float, float, float]
    d: tuple[float, float, float] = (0.0, 0.0, 1.0)


@dataclass
class FlexDef:
    id: str
    name: str
    kind: str                                    # 'loop' | 'stretch' | 'chain'
    a: Anchor
    b: Anchor
    r: float                                     # section radius, mm (round lines); the chain's half height
    sub: str
    function: str
    mat: str = 'cable'
    category: str = 'electrical'
    length: float = 0.0                          # loop: length between the anchors, mm. chain: links x pitch
    min_bend: float = 0.0                        # loop: minimum bend radius at the centreline, mm
    bulge: tuple = (1.0, (0.0, 0.0, 0.0), (0.0, 0.0, 0.0))   # loop: weights of gravity, a direction in A's
                                                 # node frame and one in B's, summed: where the loop's middle goes
    hk: float = 0.5                              # loop: each handle as a share of its end's distance to the middle
    shape: str = 'u'                             # loop: 'u' (2 cubics through a middle point pushed along the bulge) or
                                                 # 'cubic' (1 cubic, its 2 handles grown together: for a held span)
    sag: float = 0.0                             # loop, 'cubic': gravity drop at mid-length, as a share of the handle
    retract_k: float = 0.0                       # loop: >0, a spring retractor holds the length at retract_k x the chord
    swivel_a: float = 0.0                        # loop: degrees the line's direction may turn at A (a ball-joint clamp)
    swivel_b: float = 0.0                        # loop: the same at B (a turning cable outlet)
    pair_a: object = None                        # loop: Anchor, the far end of the line A's ball joint is shared with:
    pair_b: object = None                        # the joint then points along the bisector of the 2 lines' chords
    lmin: float = 0.0                            # stretch: shortest and longest the part allows, mm
    lmax: float = 0.0
    style: str = 'tube'                          # 'tube' | 'bellows' | 'coil' | 'chain'
    w: float = 0.0                               # rectangular section (bellows duct, chain): width x height, mm
    h: float = 0.0
    xd: tuple[float, float, float] = (1.0, 0.0, 0.0)   # rectangular section: the width's direction, in A's node frame
    turns: int = 0                               # coil: number of turns
    coil_r: float = 0.0                          # coil: radius of the coil's centreline about its axis, mm
    pitch: float = 0.0                           # chain: link pitch, mm
    bend_r: float = 0.0                          # chain: bend radius, mm
    links: int = 0                               # chain: number of links
    up: tuple[float, float, float] = (0.0, 1.0, 0.0)   # chain: the bend's side, in A's node frame
    link_part: object = None                     # chain: the link's PartDef
    kg_per_m: float = 0.0
    standard: str = ''
    size: str = ''
    spec: dict = field(default_factory=dict)
    make: str = 'buy'

    def bom_length(self) -> float:
        if self.kind == 'loop':
            return self.lmax if self.retract_k > 0 else self.length
        if self.kind == 'stretch':
            return self.lmax
        return self.links * self.pitch


# ═════════════════════════════════════════════════════════════════════════ frames ═══


def loc_matrix(location) -> np.ndarray:
    """A cadquery Location as a 4x4 matrix (mm)."""
    t = location.wrapped.Transformation()
    M = np.eye(4)
    for r in range(3):
        for c in range(4):
            M[r, c] = t.Value(r + 1, c + 1)
    return M


def _motion(joint: dict, v: float) -> np.ndarray:
    ax = np.array(joint['axis'], dtype=float)
    M = np.eye(4)
    if joint['kind'] == 'prismatic':
        M[:3, 3] = ax * v * 1000.0
        return M
    ax = ax / np.linalg.norm(ax)
    c, s = math.cos(v), math.sin(v)
    x, y, z = ax
    C = 1 - c
    M[:3, :3] = [[c + x * x * C, x * y * C - z * s, x * z * C + y * s],
                 [y * x * C + z * s, c + y * y * C, y * z * C - x * s],
                 [z * x * C - y * s, z * y * C + x * s, c + z * z * C]]
    return M


def node_frames(root, angles: dict[str, float]) -> dict[int, np.ndarray]:
    """World matrix of every node (by id) with the joints at `angles` (radians or metres; missing joints at their
    stowed value), clamped to their limits as check.placements does."""
    out: dict[int, np.ndarray] = {}

    def rec(node, parent: np.ndarray):
        M = parent @ loc_matrix(node.loc)
        if node.joint:
            j = node.joint
            v = angles.get(j['name'], j.get('stowed', 0.0))
            v = min(j['limits'][1], max(j['limits'][0], v))
            M = M @ _motion(j, v)
        out[id(node)] = M
        for c in node.children:
            rec(c, M)
    rec(root, np.eye(4))
    return out


def anchor_world(an: Anchor, frames: dict[int, np.ndarray]) -> tuple[np.ndarray, np.ndarray]:
    M = frames[id(an.node)]
    p = M @ np.array([*an.p, 1.0])
    d = M[:3, :3] @ np.array(an.d, dtype=float)
    return p[:3], d / np.linalg.norm(d)


# ════════════════════════════════════════════════════════════════════════ solving ═══


def bezier(p0, p1, p2, p3, n: int) -> np.ndarray:
    t = np.linspace(0.0, 1.0, n + 1)[:, None]
    u = 1.0 - t
    return u ** 3 * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t ** 3 * p3


def loop_points(pA, tA, pB, tB, b, delta: float, hk: float = 0.5, n: int = N_SEG) -> np.ndarray:
    """The loop's centreline with its middle point `delta` mm off the chord's midpoint along the unit bulge b:
    2 cubics of n/2 pieces each (n + 1 points)."""
    c = pB - pA
    d = float(np.linalg.norm(c))
    ch = c / d if d > 1e-9 else np.array([1.0, 0.0, 0.0])
    tm = ch - b * float(np.dot(ch, b))
    if np.linalg.norm(tm) < 1e-6:
        tm = np.cross(b, [1.0, 0.0, 0.0]) if abs(b[0]) < 0.9 else np.cross(b, [0.0, 0.0, 1.0])
    tm = tm / np.linalg.norm(tm)
    M = 0.5 * (pA + pB) + delta * b
    ha = hk * float(np.linalg.norm(M - pA))
    hb = hk * float(np.linalg.norm(pB - M))
    half = n // 2
    s1 = bezier(pA, pA + ha * tA, M - ha * tm, M, half)
    s2 = bezier(M, M + hb * tm, pB - hb * tB, pB, half)
    return np.vstack([s1, s2[1:]])


def cubic_points(pA, tA, pB, tB, h: float, sag: float, n: int = N_SEG) -> np.ndarray:
    """One cubic from A to B with both handles h long, dropped by sag x h at mid-length (n + 1 points)."""
    t = np.linspace(0.0, 1.0, n + 1)[:, None]
    return bezier(pA, pA + h * tA, pB - h * tB, pB, n) + np.array(G_WORLD) * (sag * h) * (4.0 * t * (1.0 - t))


def solve_cubic(pA, tA, pB, tB, L: float, sag: float) -> dict:
    d = float(np.linalg.norm(pB - pA))
    f = lambda h: polyline_length(cubic_points(pA, tA, pB, tB, h, sag)) - L   # noqa: E731
    if d >= L or f(0.0) >= 0:
        return {'points': cubic_points(pA, tA, pB, tB, 0.0, sag), 'tight': True, 'delta': 0.0, 'chord': d}
    lo, hi = 0.0, 0.5 * L
    k = 0
    while f(hi) < 0 and k < HMAX_GROW:
        lo, hi = hi, hi * 2.0
        k += 1
    for _ in range(BISECT):
        mid = 0.5 * (lo + hi)
        if f(mid) < 0:
            lo = mid
        else:
            hi = mid
    h = 0.5 * (lo + hi)
    return {'points': cubic_points(pA, tA, pB, tB, h, sag), 'tight': False, 'delta': h, 'chord': d}


def polyline_length(P: np.ndarray) -> float:
    return float(np.sum(np.linalg.norm(P[1:] - P[:-1], axis=1)))


def min_radius(P: np.ndarray) -> float:
    """The tightest bend along a polyline: the smallest circle through 3 neighbouring points (mm)."""
    best = math.inf
    for i in range(1, len(P) - 1):
        a = np.linalg.norm(P[i] - P[i - 1])
        b = np.linalg.norm(P[i + 1] - P[i])
        c = np.linalg.norm(P[i + 1] - P[i - 1])
        area2 = np.linalg.norm(np.cross(P[i] - P[i - 1], P[i + 1] - P[i - 1]))
        if area2 < 1e-9:
            continue
        best = min(best, a * b * c / (2.0 * area2))
    return best


def solve_loop(pA, tA, pB, tB, b, L: float, hk: float = 0.5) -> dict:
    """The loop of length L between the anchors (world mm), its middle pushed along the unit bulge b."""
    d = float(np.linalg.norm(pB - pA))
    f = lambda x: polyline_length(loop_points(pA, tA, pB, tB, b, x, hk)) - L   # noqa: E731
    if d >= L or f(0.0) >= 0:
        return {'points': loop_points(pA, tA, pB, tB, b, 0.0, hk), 'tight': True, 'delta': 0.0, 'chord': d}
    lo, hi = 0.0, 0.5 * L
    k = 0
    while f(hi) < 0 and k < HMAX_GROW:
        lo, hi = hi, hi * 2.0
        k += 1
    for _ in range(BISECT):
        mid = 0.5 * (lo + hi)
        if f(mid) < 0:
            lo = mid
        else:
            hi = mid
    x = 0.5 * (lo + hi)
    return {'points': loop_points(pA, tA, pB, tB, b, x, hk), 'tight': False, 'delta': x, 'chord': d}


def turn_toward(d: np.ndarray, target: np.ndarray, max_deg: float) -> np.ndarray:
    """d turned toward target by their angle, but by no more than max_deg (both unit vectors)."""
    c = float(np.clip(np.dot(d, target), -1.0, 1.0))
    ang = math.acos(c)
    lim = math.radians(max_deg)
    if ang <= lim:
        return target.copy()
    ax = np.cross(d, target)
    n = float(np.linalg.norm(ax))
    if n < 1e-12:
        return d.copy()
    ax = ax / n
    th = lim
    return d * math.cos(th) + np.cross(ax, d) * math.sin(th) + ax * float(np.dot(ax, d)) * (1 - math.cos(th))


def _unit(v: np.ndarray) -> np.ndarray:
    n = float(np.linalg.norm(v))
    return v / n if n > 1e-9 else v


def _shared(ch: np.ndarray, pair, p: np.ndarray, frames: dict[int, np.ndarray], before: bool) -> np.ndarray:
    """Where a swivel turns: along the line's own chord, or, at a ball joint shared with another line, along the
    bisector of the 2 chords through it (the other line's chord runs from its far end `pair` to p, or from p to it)."""
    if pair is None:
        return ch
    q, _ = anchor_world(pair, frames)
    other = _unit(p - q) if before else _unit(q - p)
    return _unit(ch + other)


def loop_length(fd: 'FlexDef', chord: float) -> float:
    """A loop's length at a pose: fixed, or held by its retractor at retract_k x the chord within [lmin, lmax]."""
    if fd.retract_k > 0:
        return min(fd.lmax, max(fd.lmin, fd.retract_k * chord))
    return fd.length


def bulge_dir(fd: 'FlexDef', frames: dict[int, np.ndarray]) -> np.ndarray:
    wg, ua, ub = fd.bulge
    v = wg * np.array(G_WORLD)
    v = v + frames[id(fd.a.node)][:3, :3] @ np.array(ua, dtype=float)
    v = v + frames[id(fd.b.node)][:3, :3] @ np.array(ub, dtype=float)
    n = float(np.linalg.norm(v))
    return v / n if n > 1e-9 else np.array(G_WORLD)


def chain_path(fd: FlexDef, pA, dA, upA, pB) -> dict:
    """The chain's links: (centre, tangent, in-plane normal) in world mm, and whether the moving end is in range."""
    s = float(np.dot(pB - pA, dA))
    R = fd.bend_r
    C = fd.links * fd.pitch
    xb = (C - math.pi * R + s) / 2.0
    ok = xb >= -1e-6 and xb >= s - 1e-6
    out = []
    for k in range(fd.links):
        a = (k + 0.5) * fd.pitch
        if a <= xb:
            x, y, tx, ty = a, 0.0, 1.0, 0.0
        elif a <= xb + math.pi * R:
            th = (a - xb) / R
            x, y, tx, ty = xb + R * math.sin(th), R - R * math.cos(th), math.cos(th), math.sin(th)
        else:
            x, y, tx, ty = xb - (a - xb - math.pi * R), 2 * R, -1.0, 0.0
        c = pA + dA * x + upA * y
        t = dA * tx + upA * ty
        nrm = -dA * ty + upA * tx
        out.append((c, t, nrm))
    return {'links': out, 'ok': ok, 'bendAt': xb, 'travel': s}


def solve(fd: FlexDef, frames: dict[int, np.ndarray]) -> dict:
    """The line's shape at a pose (world mm) and its checks."""
    pA, tA = anchor_world(fd.a, frames)
    pB, tB = anchor_world(fd.b, frames)
    if fd.kind == 'loop':
        c = pB - pA
        cn = float(np.linalg.norm(c))
        ch = c / cn if cn > 1e-9 else tA
        if fd.swivel_a > 0:
            tA = turn_toward(tA, _shared(ch, fd.pair_a, pA, frames, before=True), fd.swivel_a)
        if fd.swivel_b > 0:
            tB = turn_toward(tB, _shared(ch, fd.pair_b, pB, frames, before=False), fd.swivel_b)
        L = loop_length(fd, cn)
        if fd.shape == 'cubic':
            r = solve_cubic(pA, tA, pB, tB, L, fd.sag)
        else:
            r = solve_loop(pA, tA, pB, tB, bulge_dir(fd, frames), L, fd.hk)
        r['length'] = L
        r['tA'], r['tB'] = tA, tB
        r['minRadius'] = min_radius(r['points']) if not r['tight'] else 0.0
        r['ok'] = (not r['tight']) and r['minRadius'] >= fd.min_bend
        return r
    if fd.kind == 'stretch':
        L = float(np.linalg.norm(pB - pA))
        return {'points': np.array([pA, pB]), 'length': L, 'ok': fd.lmin - 1e-6 <= L <= fd.lmax + 1e-6}
    MA = frames[id(fd.a.node)]
    up = MA[:3, :3] @ np.array(fd.up, dtype=float)
    up = up / np.linalg.norm(up)
    dA = tA - up * np.dot(tA, up)
    dA = dA / np.linalg.norm(dA)
    r = chain_path(fd, pA, dA, up, pB)
    r['points'] = np.array([c for (c, _, _) in r['links']])
    return r


# ═════════════════════════════════════════════════════════════════════════ solids ═══


def _frame_from(t: np.ndarray, n: np.ndarray, c: np.ndarray) -> np.ndarray:
    """A 4x4 frame with local X along t, local Y along n, local Z = X x Y, origin c."""
    x = t / np.linalg.norm(t)
    y = n - x * np.dot(n, x)
    y = y / np.linalg.norm(y)
    z = np.cross(x, y)
    M = np.eye(4)
    M[:3, 0], M[:3, 1], M[:3, 2], M[:3, 3] = x, y, z, c
    return M


def matrix_location(M: np.ndarray):
    from cadquery import Location
    from OCP.gp import gp_Trsf
    T = gp_Trsf()
    T.SetValues(M[0, 0], M[0, 1], M[0, 2], M[0, 3],
                M[1, 0], M[1, 1], M[1, 2], M[1, 3],
                M[2, 0], M[2, 1], M[2, 2], M[2, 3])
    return Location(T)


def tube_solid(P: np.ndarray, r: float, t0=None, t1=None):
    """A round solid of radius r along a polyline (world mm): a sweep along a spline through the points. With t0 and
    t1 (the line's directions at its ends) the spline leaves and arrives along them, so each end face is square to
    the anchor it starts from and sits flush on what holds it."""
    import cadquery as cq
    from cadquery import Vector
    pts = [Vector(*map(float, p)) for p in P]
    if len(pts) == 2:
        d = pts[1] - pts[0]
        return cq.Solid.makeCylinder(r, d.Length, pts[0], d.normalized())
    if t0 is not None and t1 is not None:
        path = cq.Workplane('XY').spline(pts, tangents=[Vector(*map(float, t0)), Vector(*map(float, t1))], includeCurrent=False)
    else:
        path = cq.Workplane('XY').spline(pts, includeCurrent=False)
    d = path.val().tangentAt(0)              # the end face square to the line where it leaves, not to its first chord
    a = Vector(1, 0, 0) if abs(d.normalized().x) < 0.9 else Vector(0, 1, 0)
    plane = cq.Plane(origin=pts[0], xDir=d.cross(a).normalized(), normal=d.normalized())
    return cq.Workplane(plane).circle(r).sweep(path, transition='round').val()


def box_solid(pA: np.ndarray, pB: np.ndarray, w: float, h: float, xdir: np.ndarray):
    """A straight rectangular solid from pA to pB, w along xdir (made square to the run) and h across both."""
    import cadquery as cq
    d = pB - pA
    L = float(np.linalg.norm(d))
    ax = d / L
    x = xdir - ax * np.dot(xdir, ax)
    x = x / np.linalg.norm(x)
    y = np.cross(ax, x)
    M = np.eye(4)
    M[:3, 0], M[:3, 1], M[:3, 2], M[:3, 3] = x, y, ax, pA
    b = cq.Solid.makeBox(w, h, L, cq.Vector(-w / 2, -h / 2, 0))
    return b.moved(matrix_location(M))


def solids_at(fd: FlexDef, res: dict, frames: dict[int, np.ndarray], segmented: bool = True) -> list[tuple]:
    """What the clash check measures for a line at a pose: [(PartDef-like, Location)]. A loop is a cylinder along each
    of its N_SEG pieces (with `segmented`; else, for the STEP, its smooth swept solid); a reel's cable, its cylinder; a
    coil, the cylinder its turns sweep; a bellows duct, its box; a chain, its links. A loop is cut into pieces because a
    long swept solid's bounding box takes in most of a machine: every part in it was measured against a spline surface,
    and the charge arm's check went from about 33 minutes to hours. Each piece's box is small, its surface a cylinder,
    and its chord stands under 4 mm off the curve (a 100 mm piece on a 357 mm bend)."""
    import cadquery as cq
    from cadquery import Location, Vector
    from .core import PartDef
    P = res['points']
    if fd.kind == 'chain':
        return [(fd.link_part, matrix_location(_frame_from(t, n, c))) for (c, t, n) in res['links']]
    if fd.kind == 'loop' and segmented:
        # the first and last pieces leave and arrive along the anchors' directions, so each end face sits square on
        # what holds it (a duct's collar, a gland) as the smooth solid's does: a piece along the first chord would
        # tilt its face into the collar
        Q = [P[0]]
        if res.get('tA') is not None:
            Q.append(P[0] + np.asarray(res['tA'], dtype=float) * 0.5 * float(np.linalg.norm(P[1] - P[0])))
        Q += list(P[1:-1])
        if res.get('tB') is not None:
            Q.append(P[-1] - np.asarray(res['tB'], dtype=float) * 0.5 * float(np.linalg.norm(P[-1] - P[-2])))
        Q.append(P[-1])
        P = np.array(Q)
        out = []
        t_ = np.asarray(res.get('tA') if res.get('tA') is not None else P[1] - P[0], dtype=float)
        for k in range(len(P) - 1):
            d = P[k + 1] - P[k]
            L = float(np.linalg.norm(d))
            if L < 1e-6:                          # the same number of pieces at every pose: a 0.01 mm sliver here
                d, L = t_ / np.linalg.norm(t_), 0.01
            else:
                d = d / L
            cyl = cq.Solid.makeCylinder(fd.r, L, Vector(*map(float, P[k])), Vector(*map(float, d)))
            out.append((PartDef(fd.id, fd.name, cyl, fd.mat, fd.category, fd.standard, fd.size, '', None, fd.function, {},
                                fd.make), Location()))
        return out
    if fd.kind == 'stretch' and fd.style == 'bellows' and fd.w > 0:
        MA = frames[id(fd.a.node)]
        xdir = MA[:3, :3] @ np.array(fd.xd, dtype=float)
        shape = box_solid(P[0], P[-1], fd.w, fd.h, xdir)
    elif fd.kind == 'stretch' and fd.style == 'coil':
        shape = tube_solid(P, fd.coil_r + fd.r)
    else:
        shape = tube_solid(P, fd.r, res.get('tA'), res.get('tB'))
    pd = PartDef(fd.id, fd.name, shape, fd.mat, fd.category, fd.standard, fd.size, '', None, fd.function, {}, fd.make)
    return [(pd, Location())]


# ═════════════════════════════════════════════════════════════════════════ export ═══


def to_extras(fd: FlexDef, mm: float = 1e-3) -> dict:
    """The line as the GLB carries it (metres): enough for the viewer to solve and draw it at any pose."""
    from .materials import material
    m = material(fd.mat)
    e = {
        'id': fd.id, 'name': fd.name, 'kind': fd.kind, 'style': fd.style, 'sub': fd.sub,
        'a': {'node': fd.a.node.name, 'p': [round(c * mm, 6) for c in fd.a.p], 'd': [round(c, 6) for c in fd.a.d]},
        'b': {'node': fd.b.node.name, 'p': [round(c * mm, 6) for c in fd.b.p], 'd': [round(c, 6) for c in fd.b.d]},
        'r': round(fd.r * mm, 6),
        'material': {'key': m.key, 'color': m.color, 'metal': m.metal, 'rough': m.rough},
    }
    if fd.kind == 'loop':
        wg, ua, ub = fd.bulge
        if fd.retract_k > 0:
            e.update({'retractK': fd.retract_k, 'lmin': round(fd.lmin * mm, 6), 'lmax': round(fd.lmax * mm, 6)})
        if fd.swivel_a > 0 or fd.swivel_b > 0:
            e.update({'swivelA': fd.swivel_a, 'swivelB': fd.swivel_b})
        for key, pr in (('pairA', fd.pair_a), ('pairB', fd.pair_b)):
            if pr is not None:
                e[key] = {'node': pr.node.name, 'p': [round(c * mm, 6) for c in pr.p], 'd': [round(c, 6) for c in pr.d]}
        if fd.shape == 'cubic':
            e.update({'shape': 'cubic', 'sag': fd.sag})
        e.update({'length': round(fd.length * mm, 6), 'minBend': round(fd.min_bend * mm, 6), 'hk': fd.hk,
                  'bulge': {'g': wg, 'a': [round(c, 6) for c in ua], 'b': [round(c, 6) for c in ub]}})
    elif fd.kind == 'stretch':
        e.update({'lmin': round(fd.lmin * mm, 6), 'lmax': round(fd.lmax * mm, 6)})
        if fd.style == 'bellows' and fd.w > 0:
            e.update({'w': round(fd.w * mm, 6), 'h': round(fd.h * mm, 6), 'xd': [round(c, 6) for c in fd.xd]})
        if fd.style == 'coil':
            e.update({'turns': fd.turns, 'coilR': round(fd.coil_r * mm, 6)})
    else:
        e.update({'pitch': round(fd.pitch * mm, 6), 'bendR': round(fd.bend_r * mm, 6), 'links': fd.links,
                  'w': round(fd.w * mm, 6), 'h': round(fd.h * mm, 6), 'up': [round(c, 6) for c in fd.up],
                  'linkPart': fd.link_part.id})
    return e


def check(flexes: list[FlexDef], root, poses: list[dict]) -> dict:
    """Every line at every pose: the worst case of each check, and the poses where a line fails."""
    lines = {}
    for fd in flexes:
        lines[fd.id] = {'kind': fd.kind, 'fails': [], 'minRadius': math.inf, 'minSlack': math.inf,
                        'lengthRange': [math.inf, -math.inf], 'chainTravel': [math.inf, -math.inf]}
    for pose in poses:
        frames = node_frames(root, pose.get('angles', {}))
        for fd in flexes:
            r = solve(fd, frames)
            rec = lines[fd.id]
            if fd.kind == 'loop':
                rec['minSlack'] = min(rec['minSlack'], r['length'] - r['chord'])
                if not r['tight']:
                    rec['minRadius'] = min(rec['minRadius'], r['minRadius'])
            elif fd.kind == 'stretch':
                rec['lengthRange'] = [min(rec['lengthRange'][0], r['length']), max(rec['lengthRange'][1], r['length'])]
            else:
                rec['chainTravel'] = [min(rec['chainTravel'][0], r['travel']), max(rec['chainTravel'][1], r['travel'])]
            if not r['ok']:
                rec['fails'].append(pose.get('id', '?'))
    out = {}
    for fid, rec in lines.items():
        clean = {'kind': rec['kind'], 'fails': rec['fails'][:20], 'failCount': len(rec['fails'])}
        if rec['kind'] == 'loop':
            clean.update({'minRadiusMm': round(rec['minRadius'], 1), 'minSlackMm': round(rec['minSlack'], 1)})
        elif rec['kind'] == 'stretch':
            clean['lengthRangeMm'] = [round(v, 1) for v in rec['lengthRange']]
        else:
            clean['travelRangeMm'] = [round(v, 1) for v in rec['chainTravel']]
        out[fid] = clean
    return out


# ═════════════════════════════════════════════════════════════════ the model's use ═══


def part_for(fd: FlexDef, root) -> object:
    """The line's bill-of-materials part: its solid as it lies at the stowed pose (world mm), its mass by length.
    A chain's part is its link (the bill counts the links)."""
    from .core import PartDef
    if fd.kind == 'chain':
        return fd.link_part
    frames = node_frames(root, {})
    res = solve(fd, frames)
    (pd0, _), = solids_at(fd, res, frames, segmented=False)
    L = fd.bom_length()
    spec = {**fd.spec, 'length': f'{L:.0f} mm'}
    if fd.kind == 'loop':
        spec['min bend radius'] = f'{fd.min_bend:.0f} mm'
    else:
        spec['length range'] = f'{fd.lmin:.0f} to {fd.lmax:.0f} mm'
    return PartDef(fd.id, fd.name, pd0.shape, fd.mat, fd.category, fd.standard, fd.size, '', None, fd.function,
                   spec, fd.make, mass_override=fd.kg_per_m * L / 1000.0)


def items_at(flexes: list[FlexDef], root, angles: dict[str, float], segmented: bool = True) -> list[tuple]:
    """(Item, world Location, rigid body) for every line's solids at a pose, as check.placements lists the parts.
    Each line is its own body, so it is measured against every part at every pose (its own pieces are not measured
    against each other). The STEP asks for the smooth solids (segmented=False)."""
    from .core import Item
    if not flexes:
        return []
    frames = node_frames(root, angles)
    out = []
    for fd in flexes:
        res = solve(fd, frames)
        for k, (pd, L) in enumerate(solids_at(fd, res, frames, segmented)):
            pd.transient = fd.kind != 'chain'          # its solid changes with the pose: no cached bounding box
            out.append((Item(pd, L, (0, 0, 0), fd.sub, f'{fd.id}#{k + 1}'), L, f'flex:{fd.id}'))
    return out


def samples(flexes: list[FlexDef], root, poses: list[dict], mm: float = 1e-3) -> list[dict]:
    """Each line's solved points at a few poses (metres), for the viewer's test to solve the same and compare."""
    out = []
    for pose in poses:
        frames = node_frames(root, pose.get('angles', {}))
        lines = {}
        for fd in flexes:
            P = solve(fd, frames)['points']
            lines[fd.id] = [[round(float(c) * mm, 6) for c in p] for p in P]
        out.append({'id': pose.get('id', ''), 'angles': pose.get('angles', {}), 'lines': lines})
    return out
