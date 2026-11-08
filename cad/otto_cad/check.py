"""Interference (clash) and contact checks over a built Model, at the robot's poses.

WHAT IS A CLASH. Two placed solids that share volume. The check places every part where the assembly puts it at a
pose (the joints set from the twin's own pose code, cad/spec/poses.json), finds the pairs whose boxes overlap, and
measures the shared volume with an OpenCascade boolean. Four kinds of overlap are expected and are counted, not
flagged:

  thread   a screw, bolt or pin inside a part where the CAD does not draw the tapped or reamed hole. It counts as
           thread only when the shared volume lies inside the fastener's own hole cylinder (its nominal radius plus
           0.6 mm) and below its head. A head, a washer or a nut inside a part is a clash.
  seal     an O-ring or a lip seal pressed into a groove the CAD does not cut (at most a third of the seal).
  ring     a retaining ring in its groove (at most half the ring).
  mesh     teeth that mesh by design, drawn simplified: a strain-wave gear's ring and flexspline, a belt on its
           pulley, a pinion on its rack (at most a tenth of the smaller part).
  context  any overlap with a reference body (the concrete pad, the charge cabinet's envelope): site context,
           reported, never counted against the robot.

Everything else is a clash, and the build stops on one.

CONTACT. Every part must be held by something: the graph of parts that touch (within 0.3 mm) must be one piece.
A part, or a group of parts, that touches nothing else is FLOATING, which is a modelling error (a cover with its
screws in the air, a bracket that misses its beam), and the build stops on it too.

RIGID BODIES. A pair inside one rigid body (no joint between them) cannot change with the pose, so it is measured
once; only pairs that span a joint are measured again at every pose.
"""
from __future__ import annotations

import math
import multiprocessing as mp
import re
import time

from cadquery import Location, Vector
from OCP.Bnd import Bnd_Box
from OCP.BRepAlgoAPI import BRepAlgoAPI_Common, BRepAlgoAPI_Cut
from OCP.BRepBndLib import BRepBndLib
from OCP.BRepExtrema import BRepExtrema_DistShapeShape
from OCP.BRepGProp import BRepGProp
from OCP.BRepPrimAPI import BRepPrimAPI_MakeCylinder
from OCP.GProp import GProp_GProps
from OCP.gp import gp_Ax2, gp_Dir, gp_Pnt

from .core import Model, PartDef

CLASH_MIN_MM3 = 10.0         # shared volume below this (about 0.1 mm over 1 cm2) is contact within modelling tolerance
CONTACT_MM = 0.3             # parts this close touch
THREAD_CLEAR_MM = 0.6        # a hole cylinder's radius past the nominal diameter
SEAL_SHARE = 1 / 3
RING_SHARE = 0.5
MESH_SHARE = 0.1
MESH_PAIRS = (('SWG', 'SWG'), ('PUL-', 'BELT-'), ('WSH-PIN', 'WSH-SRK'), ('CLN-PIN', 'CLN-RCK'))

_SCREW = re.compile(r'^ISO(4762|7380|10642|4017|4026)-M(\d+)x([\d.]+)')
_DOWEL = re.compile(r'^ISO8734-([\d.]+)x([\d.]+)')


def _vol(shape) -> float:
    p = GProp_GProps()
    BRepGProp.VolumeProperties_s(shape, p)
    return abs(p.Mass())


def _centre(shape) -> tuple[float, float, float]:
    p = GProp_GProps()
    BRepGProp.VolumeProperties_s(shape, p)
    c = p.CentreOfMass()
    return (round(c.X(), 1), round(c.Y(), 1), round(c.Z(), 1))


def motion(joint: dict, v: float) -> Location:
    """A joint's motion in its node's frame: radians about the axis, or METRES along it (the GLB's units)."""
    ax = joint['axis']
    if joint['kind'] == 'prismatic':
        return Location(Vector(ax[0] * v * 1000, ax[1] * v * 1000, ax[2] * v * 1000))
    return Location(Vector(0, 0, 0), Vector(*ax), math.degrees(v))


def placements(model: Model, angles: dict[str, float]) -> list[tuple]:
    """(item, world location, rigid body) for every placed part, the joints at `angles` (missing joints stowed), and
    every flexible line's solids solved at those angles (flex.items_at: each line is its own body)."""
    from .flex import items_at
    out = []

    def rec(node, parent: Location, body: str):
        L = parent * node.loc
        if node.joint:
            j = node.joint
            v = angles.get(j['name'], j.get('stowed', 0.0))
            v = min(j['limits'][1], max(j['limits'][0], v))
            L = L * motion(j, v)
            body = j['name']
        for it in node.items:
            out.append((it, L * it.loc, body))
        for c in node.children:
            rec(c, L, body)
    rec(model.root, Location(), 'base')
    return out + items_at(getattr(model, 'flexes', []), model.root, angles)


_LOCAL_BOX: dict[str, tuple] = {}


def _local_box(pd: PartDef) -> tuple:
    transient = getattr(pd, 'transient', False)      # a flexible line's solid at one pose: not cached by its id
    b = None if transient else _LOCAL_BOX.get(pd.id)
    if b is None:
        box = Bnd_Box()
        BRepBndLib.AddOptimal_s(pd.shape.wrapped, box, False, False)
        b = box.Get()
        if not transient:
            _LOCAL_BOX[pd.id] = b
    return b


def world_box(pd: PartDef, L: Location, pad: float = 0.0) -> tuple[float, ...]:
    x0, y0, z0, x1, y1, z1 = _local_box(pd)
    T = L.wrapped.Transformation()
    xs, ys, zs = [], [], []
    for x in (x0, x1):
        for y in (y0, y1):
            for z in (z0, z1):
                p = gp_Pnt(x, y, z).Transformed(T)
                xs.append(p.X()); ys.append(p.Y()); zs.append(p.Z())
    return (min(xs) - pad, min(ys) - pad, min(zs) - pad, max(xs) + pad, max(ys) + pad, max(zs) + pad)


def _overlap(a: tuple, b: tuple) -> bool:
    return a[0] <= b[3] and b[0] <= a[3] and a[1] <= b[4] and b[1] <= a[4] and a[2] <= b[5] and b[2] <= a[5]


def candidate_pairs(boxes: list[tuple]) -> list[tuple[int, int]]:
    """Sweep and prune on x."""
    order = sorted(range(len(boxes)), key=lambda i: boxes[i][0])
    out = []
    active: list[int] = []
    for i in order:
        bi = boxes[i]
        active = [j for j in active if boxes[j][3] >= bi[0]]
        for j in active:
            if _overlap(bi, boxes[j]):
                out.append((min(i, j), max(i, j)))
        active.append(i)
    return out


_HOLE: dict[str, object] = {}


def hole_cylinder(pd: PartDef):
    """The volume a fastener may share with a part it is screwed into: its hole, below its head (local frame;
    a fastener's shank runs along its local -Y from the head's bearing face at y = 0)."""
    if pd.id in _HOLE:
        return _HOLE[pd.id]
    cyl = None
    m = _SCREW.match(pd.id)
    if m:
        d, L = float(m.group(2)), float(m.group(3))
        r = d / 2 + THREAD_CLEAR_MM
        # the set screw (ISO 4026) has no head: its whole length may be in the hole
        top = L + 1 if m.group(1) == '4026' else 0.05
        cyl = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(0, top, 0), gp_Dir(0, -1, 0)), r, top + L + 2).Shape()
    m = _DOWEL.match(pd.id)
    if m:
        dia, L = float(m.group(1)), float(m.group(2))
        cyl = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(0, L / 2 + 1, 0), gp_Dir(0, -1, 0)), dia / 2 + 0.3, L + 2).Shape()
    m = re.search(r'ANC-M(\d+)', pd.id)
    if m and cyl is None:            # an anchor rod (no head): its whole length may be in its hole, the slab or a nut
        bb = pd.shape.BoundingBox()
        cyl = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(0, bb.ymax + 1, 0), gp_Dir(0, -1, 0)), float(m.group(1)) / 2 + THREAD_CLEAR_MM,
                                       bb.ymax - bb.ymin + 2).Shape()
    if pd.id.startswith('NOZ-'):     # a spray nozzle's G 1/4 thread in its pipe wall
        cyl = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(0, 8, 0), gp_Dir(0, -1, 0)), 6.6, 8.05).Shape()
    _HOLE[pd.id] = cyl
    return cyl


def _moved(shape, L: Location):
    return shape.Moved(L.wrapped)


def classify(pa: PartDef, La: Location, pb: PartDef, Lb: Location) -> tuple[str, float, tuple] | None:
    """None if the two solids share no volume; else (kind, shared mm3, centre of the shared volume)."""
    A = _moved(pa.shape.wrapped, La)
    B = _moved(pb.shape.wrapped, Lb)
    op = BRepAlgoAPI_Common(A, B)
    if not op.IsDone():
        return ('error', 0.0, (0, 0, 0))
    common = op.Shape()
    v = _vol(common)
    if v < CLASH_MIN_MM3:
        return None
    at = _centre(common)
    if pa.reference or pb.reference:
        return ('context', v, at)
    for p, L in ((pa, La), (pb, Lb)):
        cyl = hole_cylinder(p)
        if cyl is not None:
            cut = BRepAlgoAPI_Cut(common, _moved(cyl, L))
            rest = _vol(cut.Shape()) if cut.IsDone() else v
            if rest < CLASH_MIN_MM3:
                return ('thread', v, at)
    for x, y in MESH_PAIRS:
        if ((pa.id.startswith(x) and pb.id.startswith(y)) or (pa.id.startswith(y) and pb.id.startswith(x))) \
                and v <= min(pa.volume, pb.volume) * MESH_SHARE:
            return ('mesh', v, at)
    for p in (pa, pb):
        if p.category == 'seal' and v <= p.volume * SEAL_SHARE:
            return ('seal', v, at)
        if p.standard in ('DIN 471', 'DIN 472') and v <= p.volume * RING_SHARE:
            return ('ring', v, at)
    return ('clash', v, at)


def touching(pa: PartDef, La: Location, pb: PartDef, Lb: Location) -> bool:
    d = BRepExtrema_DistShapeShape(_moved(pa.shape.wrapped, La), _moved(pb.shape.wrapped, Lb))
    return d.IsDone() and d.Value() <= CONTACT_MM


# ── the parallel pair loop (fork: the workers inherit the model) ─────────────
_G: dict = {}


def _work(chunk):
    out = []
    pl = _G['pl']
    for (i, j) in chunk:
        ia, La, _ = pl[i]
        ib, Lb, _ = pl[j]
        r = classify(ia.part, La, ib.part, Lb)
        if r is not None:
            out.append((i, j, r))
    return out


def _work_touch(chunk):
    out = []
    pl = _G['pl']
    for (i, j) in chunk:
        ia, La, _ = pl[i]
        ib, Lb, _ = pl[j]
        if touching(ia.part, La, ib.part, Lb):
            out.append((i, j))
    return out


def _run(fn, pairs, procs):
    if not pairs:
        return []
    n = max(1, min(procs, len(pairs) // 20 or 1))
    size = max(1, len(pairs) // (n * 8))
    chunks = [pairs[k:k + size] for k in range(0, len(pairs), size)]
    if n == 1:
        return [r for c in chunks for r in fn(c)]
    with mp.get_context('fork').Pool(n) as pool:
        return [r for part in pool.map(fn, chunks) for r in part]


def _desc(it) -> dict:
    return {'item': it.name, 'part': it.part.id, 'name': it.part.name, 'sub': it.sub}


def check(model: Model, poses: list[dict], procs: int = 4, only_subs: set | None = None, contact: bool = True) -> dict:
    """Clash check at every pose (the first is the stowed pose, which also carries the contact check).
    only_subs (a development aid): measure only pairs with a part in these subsystems, and skip the contact graph."""
    t0 = time.time()
    stow = placements(model, {})
    if only_subs:
        contact = False
    bodies = [b for (_, _, b) in stow]
    pairs_checked = 0
    found: dict[tuple[str, str], dict] = {}
    counts = {'thread': 0, 'seal': 0, 'ring': 0, 'mesh': 0, 'context': 0, 'clash': 0, 'error': 0}
    all_poses = [{'id': 'stowed', 'angles': {}}] + [p for p in poses if p.get('angles')]
    for pi, pose in enumerate(all_poses):
        pl = placements(model, pose['angles'])
        boxes = [world_box(it.part, L) for (it, L, _) in pl]
        pairs = candidate_pairs(boxes)
        if only_subs:
            pairs = [(i, j) for (i, j) in pairs if pl[i][0].sub in only_subs or pl[j][0].sub in only_subs]
        if pi > 0:
            pairs = [(i, j) for (i, j) in pairs if bodies[i] != bodies[j]]   # inside a body: measured at stowed
        else:   # a chain's links hinge into each other by design: never measured against their own chain
            pairs = [(i, j) for (i, j) in pairs if not (bodies[i] == bodies[j] and bodies[i].startswith('flex:'))]
        pairs_checked += len(pairs)
        _G['pl'] = pl
        for (i, j, (kind, v, at)) in _run(_work, pairs, procs):
            a, b = pl[i][0], pl[j][0]
            key = (a.name, b.name)
            if key not in found:
                found[key] = {'kind': kind, 'a': _desc(a), 'b': _desc(b), 'volumeMm3': round(v, 1), 'at': at, 'poses': []}
                counts[kind] += 1
            rec = found[key]
            rec['poses'].append(pose['id'])
            if v > rec['volumeMm3']:
                rec['volumeMm3'], rec['at'] = round(v, 1), at
    if not contact:
        clashes = [r for r in found.values() if r['kind'] in ('clash', 'error')]
        clashes.sort(key=lambda r: -r['volumeMm3'])
        return {'robot': model.key, 'poses': [p['id'] for p in all_poses], 'pairsChecked': pairs_checked, 'contactPairs': 0,
                'counts': counts, 'clashes': clashes, 'floating': [], 'context': [], 'seconds': round(time.time() - t0, 1)}
    # contact graph at the stowed pose
    _G['pl'] = stow
    boxes = [world_box(it.part, L, CONTACT_MM) for (it, L, _) in stow]
    near = candidate_pairs(boxes)
    overlapping: set[tuple[int, int]] = set()
    names = {it.name: k for k, (it, _, _) in enumerate(stow)}
    for rec in found.values():
        if 'stowed' in rec['poses']:
            overlapping.add(tuple(sorted((names[rec['a']['item']], names[rec['b']['item']]))))
    rest = [p for p in near if p not in overlapping]
    touch = set(_run(_work_touch, rest, procs)) | overlapping
    parent = list(range(len(stow)))

    def root(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    for (i, j) in touch:
        ri, rj = root(i), root(j)
        if ri != rj:
            parent[ri] = rj
    groups: dict[int, list[int]] = {}
    for k in range(len(stow)):
        groups.setdefault(root(k), []).append(k)
    ranked = sorted(groups.values(), key=len, reverse=True)
    floating = [[_desc(stow[k][0]) for k in g] for g in ranked[1:]]
    clashes = [r for r in found.values() if r['kind'] in ('clash', 'error')]
    clashes.sort(key=lambda r: -r['volumeMm3'])
    return {
        'robot': model.key,
        'poses': [p['id'] for p in all_poses],
        'pairsChecked': pairs_checked,
        'contactPairs': len(touch),
        'counts': counts,
        'clashes': clashes,
        'floating': floating,
        'context': [r for r in found.values() if r['kind'] == 'context'],
        'seconds': round(time.time() - t0, 1),
    }
