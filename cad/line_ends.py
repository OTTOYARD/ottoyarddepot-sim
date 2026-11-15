#!/usr/bin/env python3
"""EVERY LINE'S BOTH ENDS ARE HELD: the line-ends check over each robot's rigid lines.

    cad/.venv/bin/python cad/line_ends.py                # all robots: writes public/cad/<robot>.ends.json
    cad/.venv/bin/python cad/line_ends.py clean_arm      # one

Why (2026-11-15, Chase: "There cannot be gaps between cables randomly plugging into charging system or just floating
off of robotic arms with gaps"): the clash check's contact test proves each part touches SOMETHING, so a cable, hose or
conduit held at one end passes with its other end standing in the air. The clean arm's hybrid cable did: it began 6 mm
under the mast collar's foot, 28 mm from any part. The flexible lines' ends are held to what holds them by
cadDetail.test.ts at every twin pose; this checks the rigid ones, at the stowed pose (a rigid line moves with its node):

  - a line drawn along a path (std.swept: its ends are recorded on the part), and
  - a straight cable, hose, tube, conduit, duct or pipe drawn as a cylinder (its 2 flat end faces),
  - a line drawn with its own bends (its ends recorded on the part, as std.swept records them),

not context (a reference part), not a fitting. An end is HELD when a point of its end disc (its centre, and 8 points
at its rim) comes within 1 mm of another part or line. An end that lies inside another part's bore by design (a cable
drawn from a duct's mouth) is declared on its part (`PartDef.end_in`), and is held when its centre lies inside that
part's box. A line that feeds a cable chain runs on in it as the chain's content, so its end there is held where it
enters the chain's links. The report names every end that is not; src/lib/robotics/cadEnds.test.ts holds every report to none, for
the GLB it was measured on. Every CAD change ends with cad/build.py, cad/clash.py --baseline and this.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import re
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import numpy as np  # noqa: E402
from OCP.BRepAdaptor import BRepAdaptor_Surface  # noqa: E402
from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeVertex  # noqa: E402
from OCP.BRepExtrema import BRepExtrema_DistShapeShape  # noqa: E402
from OCP.BRepGProp import BRepGProp  # noqa: E402
from OCP.GeomAbs import GeomAbs_Cylinder, GeomAbs_Plane  # noqa: E402
from OCP.GProp import GProp_GProps  # noqa: E402
from OCP.gp import gp_Pnt  # noqa: E402

from otto_cad.core import write_json  # noqa: E402
from otto_cad.flex import items_at, loc_matrix, matrix_location, node_frames  # noqa: E402

OUT = os.path.join(HERE, '..', 'public', 'cad')
ROBOTS = ['charge_arm', 'clean_arm', 'wash_gantry']
HELD_MM = 1.0
LINE = re.compile(r'cable|hose|tube|line|conduit|duct|pipe|drop', re.I)


def straight_ends(pd) -> list | None:
    """A straight line drawn as a cylinder or a tube: its faces are cylinders and 2 opposite planes. Returns its 2 ends
    as (centre, outward normal, radius) in the part's frame, or None when the part is not one."""
    if pd.reference or pd.category not in ('electrical', 'fluid') or not LINE.search(pd.name) or 'fitting' in pd.name.lower():
        return None
    planes, cyl = [], 0
    for f in pd.shape.Faces():
        t = BRepAdaptor_Surface(f.wrapped).GetType()
        if t == GeomAbs_Cylinder:
            cyl += 1
        elif t == GeomAbs_Plane:
            pr = GProp_GProps()
            BRepGProp.SurfaceProperties_s(f.wrapped, pr)
            c = pr.CentreOfMass()
            cc = np.array([c.X(), c.Y(), c.Z()])
            r = max((float(np.linalg.norm(np.array(v.toTuple()) - cc)) for v in f.Vertices()), default=0.0)
            planes.append((cc, np.array(f.normalAt().toTuple()), r))
        else:
            return None
    return planes if cyl and len(planes) == 2 else None


def path_ends(pd) -> list | None:
    """A line drawn along a path (std.swept): its 2 ends as (centre, outward direction, radius), part frame."""
    e = getattr(pd, 'path_ends', None)
    if e is None or pd.reference:
        return None
    p0, p1, q0, q1, r = (np.array(x, dtype=float) if i < 4 else x for i, x in enumerate(e))
    d0, d1 = p0 - p1, q0 - q1
    return [(p0, d0 / np.linalg.norm(d0), r), (q0, d1 / np.linalg.norm(d1), r)]


def run(key: str, spec: dict) -> dict:
    t0 = time.time()
    mod = __import__(f'otto_cad.robots.{key}', fromlist=['build'])
    model = mod.build(spec)
    W0 = node_frames(model.root, {})
    placed = []                                            # (item name, part, world 4x4)
    for node in model.root.walk():
        for it in node.items:
            placed.append((it.name, it.part, W0[id(node)] @ loc_matrix(it.loc)))
    n_items = len(placed)
    for (it, L, _) in items_at(model.flexes, model.root, {}, segmented=True):
        placed.append((it.name, it.part, loc_matrix(L)))

    def wbox(pd, M):
        bb = pd.shape.BoundingBox()
        c = np.array([[x, y, z, 1.0] for x in (bb.xmin, bb.xmax) for y in (bb.ymin, bb.ymax) for z in (bb.zmin, bb.zmax)]) @ M.T
        return c[:, :3].min(0), c[:, :3].max(0)
    boxes = [wbox(pd, M) for (_, pd, M) in placed]
    moved: dict[int, object] = {}

    def solid(i):
        if i not in moved:
            moved[i] = placed[i][1].shape.moved(matrix_location(placed[i][2])).wrapped
        return moved[i]

    def dist(p, i) -> float:
        d = BRepExtrema_DistShapeShape(BRepBuilderAPI_MakeVertex(gp_Pnt(*map(float, p))).Vertex(), solid(i))
        return d.Value() if d.IsDone() else math.inf
    # a line that feeds a chain runs on in it as the chain's content (flex.FlexDef.contents, drawn by the viewer from the
    # chain's end): that end is held where it enters the chain's links
    feeds: dict[str, list] = {}
    for fd in model.flexes:
        if fd.kind == 'chain':
            for c in fd.contents:
                if c.get('part') and fd not in feeds.setdefault(c['part'], []):
                    feeds[c['part']].append(fd)
    chains = {fd.id: fd for fds in feeds.values() for fd in fds}
    # each chain's links where they stand (a chain's links share one part, so they are told apart by their item's name)
    link_boxes = {fid: [boxes[j] for j in range(n_items, len(placed)) if placed[j][0].startswith(f'{fid}#')] for fid in chains}
    lines, open_ends = 0, []
    for idx in range(n_items):
        name, pd, M = placed[idx]
        E = path_ends(pd) or straight_ends(pd)
        if E is None:
            continue
        lines += 1
        for k, (c, nrm, r) in enumerate(E):
            which = 'start' if k == 0 else 'end'
            cw = (M @ np.array([*c, 1.0]))[:3]
            inside = (pd.end_in or {}).get(which)
            if inside:
                ok = any(placed[j][1].id == inside and np.all(cw >= boxes[j][0] - 0.5) and np.all(cw <= boxes[j][1] + 0.5)
                         for j in range(len(placed)))
                if not ok:
                    open_ends.append({'item': name, 'part': pd.id, 'name': pd.name, 'end': which, 'gapMm': None,
                                      'at': [round(float(x), 1) for x in cw], 'note': f'declared inside {inside}, but it is not'})
                continue
            if any(np.all(cw >= lo - 3) and np.all(cw <= hi + 3) for fd in feeds.get(pd.id, []) for (lo, hi) in link_boxes[fd.id]):
                continue                                   # it runs on in the chain
            a = np.array([1.0, 0, 0]) if abs(nrm[0]) < 0.9 else np.array([0, 1.0, 0])
            u = np.cross(nrm, a)
            u /= np.linalg.norm(u)
            v = np.cross(nrm, u)
            ring = [c] + [c + 0.98 * r * (math.cos(t) * u + math.sin(t) * v) for t in np.linspace(0, 2 * math.pi, 8, endpoint=False)]
            ringW = [(M @ np.array([*p, 1.0]))[:3] for p in ring]
            best, who = math.inf, ''
            for j, (lo, hi) in enumerate(boxes):
                if j == idx or not any(np.all(p >= lo - 3) and np.all(p <= hi + 3) for p in ringW):
                    continue
                dd = min(dist(p, j) for p in ringW)
                if dd < best:
                    best, who = dd, placed[j][0]
            if best > HELD_MM:
                open_ends.append({'item': name, 'part': pd.id, 'name': pd.name, 'end': which,
                                  'gapMm': None if best == math.inf else round(best, 2), 'nearest': who,
                                  'at': [round(float(x), 1) for x in cw]})
    glb = os.path.join(OUT, f'{key}.glb')
    digest = hashlib.sha256(open(glb, 'rb').read()).hexdigest()[:16] if os.path.exists(glb) else None
    return {'robot': key, 'glbSha256': digest, 'heldWithinMm': HELD_MM, 'lines': lines, 'openEnds': open_ends,
            'seconds': round(time.time() - t0, 1)}


def main(argv: list[str]) -> None:
    keys = [a for a in argv if not a.startswith('--')] or ROBOTS
    spec = json.load(open(os.path.join(HERE, 'spec', 'robots.json')))
    bad = 0
    for key in keys:
        rep = run(key, spec)
        write_json(os.path.join(OUT, f'{key}.ends.json'), rep)
        print(f"{key}: {rep['lines']} rigid lines, {len(rep['openEnds'])} open ends; {rep['seconds']} s")
        for e in rep['openEnds']:
            print(f"   OPEN {e['item']} {e['end']}: {e.get('gapMm')} mm from {e.get('nearest', '')} {e.get('note', '')}")
        bad += len(rep['openEnds'])
    if bad:
        raise SystemExit(f'{bad} line ends are not held')


if __name__ == '__main__':
    main(sys.argv[1:])
