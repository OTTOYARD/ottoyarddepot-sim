"""A compact glTF 2.0 binary writer for a Model.

Why not OpenCascade's own writer: it writes one mesh per INSTANCE and one primitive per FACE, so 300
identical screws become 300 meshes of ~20 primitives each. This writer tessellates each part once,
merges its faces into one primitive, and points every placement at that one mesh.

Output: METRES, Y up, no axis change (the CAD is authored in the twin's frames). Normals come from
the surface (BRepLib_ToolTriangulatedShape), per face, so curved faces shade smooth and edges stay
sharp. Positions are float32; normals are int8 (KHR_mesh_quantization), indices uint16 or uint32.

Every node carries `extras`:
  part instance  {"part": id, "sub": subsystem, "explode": [x, y, z] metres in the parent's frame}
  module node    {"sub": subsystem, "explode": [...]}  (+ "joint": {...} for an axis the viewer may drive)
  root           {"robot": key, "title": ..., "frame": ...}
"""
from __future__ import annotations

import json
import math
import struct

import cadquery as cq
import numpy as np
from OCP.BRep import BRep_Tool
from OCP.BRepLib import BRepLib_ToolTriangulatedShape
from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.BRepBuilderAPI import BRepBuilderAPI_Copy
from OCP.TopAbs import TopAbs_FACE, TopAbs_REVERSED
from OCP.TopExp import TopExp_Explorer
from OCP.TopLoc import TopLoc_Location
from OCP.TopoDS import TopoDS

from .core import Model, Node, srgb_to_linear
from .materials import material

MM = 0.001


def _tolerance(pd) -> tuple[float, float]:
    bb = pd.shape.BoundingBox()
    diag = math.sqrt(bb.xlen ** 2 + bb.ylen ** 2 + bb.zlen ** 2)
    lin = pd.tol if pd.tol is not None else min(1.6, max(0.04, diag * 0.0016))
    ang = pd.ang if pd.ang is not None else (0.34 if diag > 60 else 0.5)
    return lin, ang


# ── the depot model: what the yard draws, many at once, from tens of metres ─────────────────────────────
# Every outside part, coarsely meshed; no fastener, bearing or seal, nothing sealed inside a joint actuator
# (its gear set, motor, brake, encoders, drive board, shaft), no reference context, nothing under 12 mm.
DEPOT_DROP_CATEGORIES = {'fastener', 'bearing', 'seal'}
# a cable gland is where a line enters its part: it stays in every model a line is drawn in (it was dropped here until
# 2026-11-15, and the wrist boot ended 69 mm from the connector in the yard)
DEPOT_DROP_PREFIX = ('SWG', 'MOT-', 'BRK-', 'ENC', 'DRV-', 'XRB', 'BRG-')
DEPOT_DROP_SUFFIX = ('-SHF', '-FSC', '-STR')
DEPOT_MIN_MM = 30.0
# site works the yard draws with the robot, because nothing else in the yard draws them: the charge arm's bed stands on
# 12 grout blocks, and without them its plates float 77 mm over the deck (seen 2026-11-15)
DEPOT_SITE_KEEP = {'CHG-BGB'}


def depot_keep(pd, holders: frozenset = frozenset(), hidden: bool = False) -> bool:
    """The far model: no fastener, bearing or seal, nothing sealed in an actuator, nothing under 30 mm, nothing the yard
    cannot see (`hidden`: under its deck or inside the site it draws itself), except a part that holds a line's end
    (`holders`: the fitting a cable plugs into stays, however small)."""
    if pd.reference and pd.id not in DEPOT_SITE_KEEP:
        return False
    if hidden:
        return False
    if pd.id in holders:
        return True
    if pd.category in DEPOT_DROP_CATEGORIES:
        return False
    if pd.id.startswith(DEPOT_DROP_PREFIX) or pd.id.endswith(DEPOT_DROP_SUFFIX):
        return False
    bb = pd.shape.BoundingBox()
    return math.sqrt(bb.xlen ** 2 + bb.ylen ** 2 + bb.zlen ** 2) >= DEPOT_MIN_MM


# ── the detail model: what the yard draws near the camera, as the Robotics tab draws it ───────────────────────────────────
# Every part you can see on the assembled robot, to the last screw, washer and nut, meshed fine enough for a 4K close-up:
# all but the placements sealed inside a joint actuator (core.Item.sealed: no line of sight reaches them, which
# src/lib/robotics/cadDetail.test.ts proves at every twin pose), the reference context, and what lies wholly under the
# yard's deck (the yard's ground is opaque). Curved faces within 0.26 rad (about 24 facets a circle) on parts over 60 mm,
# and a linear deflection of 0.25 % of the part's size between 0.06 and 0.6 mm.
def near_keep(it, hidden: bool) -> bool:
    pd = it.part
    if pd.reference and pd.id not in DEPOT_SITE_KEEP:
        return False
    if getattr(it, 'sealed', False):
        return False
    return not hidden


def yard_hidden(it, Lw, deck: float | None) -> bool:
    """A placement the yard cannot see: wholly under its deck at rest (a trench, a channel and what lies in them; a part on
    a joint that ever rises above the deck is above it at rest too, in these robots), or marked as inside the site the yard
    draws itself (core.Item.yard_hidden: the supply lines rising into the charger cabinet, under the yard's pad)."""
    if getattr(it, 'yard_hidden', False):
        return True
    return deck is not None and _item_box(it.part, Lw * it.loc)[4] < deck - 1.0


def _near_tolerance(pd) -> tuple[float, float]:
    """A part over 60 mm: 0.26 rad (about 24 facets a circle) and 0.25 % of its size, 0.6 mm at most. A small part (a
    screw, a washer, a nut): 0.55 rad (about 12 facets) and 0.12 mm or more, round at the yard's closest camera (a 10 mm
    head is about 13 pixels across from 2.4 m on a 4K screen)."""
    bb = pd.shape.BoundingBox()
    diag = math.sqrt(bb.xlen ** 2 + bb.ylen ** 2 + bb.zlen ** 2)
    if diag > 60:
        return min(0.6, max(0.06, diag * 0.0025)), 0.26
    return max(0.12, diag * 0.004), 0.55


def _depot_tolerance(pd) -> tuple[float, float]:
    bb = pd.shape.BoundingBox()
    diag = math.sqrt(bb.xlen ** 2 + bb.ylen ** 2 + bb.zlen ** 2)
    return min(10.0, max(0.8, diag * 0.009)), 0.75


def tessellate(pd, coarse: bool = False, near: bool = False) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    lin, ang = _depot_tolerance(pd) if coarse else _near_tolerance(pd) if near else _tolerance(pd)
    shape = pd.shape.wrapped
    if coarse and pd.depot is not None:        # the part's outline for the depot model: no holes, fins or bores
        bb = pd.shape.BoundingBox()
        if pd.depot == 'box':
            shape = cq.Solid.makeBox(bb.xlen, bb.ylen, bb.zlen, cq.Vector(bb.xmin, bb.ymin, bb.zmin)).wrapped
        elif pd.depot == 'cyl_y':                # a cylinder on the part's Y axis, its bounding box's size
            r = max(bb.xlen, bb.zlen) / 2
            shape = cq.Solid.makeCylinder(r, bb.ylen, cq.Vector((bb.xmin + bb.xmax) / 2, bb.ymin, (bb.zmin + bb.zmax) / 2),
                                          cq.Vector(0, 1, 0)).wrapped
        else:
            shape = (pd.depot.val() if hasattr(pd.depot, 'val') else pd.depot).wrapped
    if coarse or near:
        # a copy without its mesh: the mesher keeps a finer mesh it already has, and the shapes of standard parts
        # are cached and shared by every robot built in this process (re-meshing them in place changed the next
        # robot's full model)
        shape = BRepBuilderAPI_Copy(shape, True, False).Shape()
    BRepMesh_IncrementalMesh(shape, lin, False, ang, True)
    pos, nrm, idx = [], [], []
    base = 0
    exp = TopExp_Explorer(shape, TopAbs_FACE)
    while exp.More():
        face = TopoDS.Face_s(exp.Current())
        exp.Next()
        L = TopLoc_Location()
        tri = BRep_Tool.Triangulation_s(face, L)
        if tri is None or tri.NbTriangles() == 0:
            continue
        if not tri.HasNormals():
            BRepLib_ToolTriangulatedShape.ComputeNormals_s(face, tri)
        trsf = L.Transformation()
        rev = face.Orientation() == TopAbs_REVERSED
        n = tri.NbNodes()
        P = np.empty((n, 3), dtype=np.float64)
        N = np.empty((n, 3), dtype=np.float64)
        for i in range(1, n + 1):
            p = tri.Node(i).Transformed(trsf)
            P[i - 1] = (p.X(), p.Y(), p.Z())
            d = tri.Normal(i).Transformed(trsf)
            N[i - 1] = (d.X(), d.Y(), d.Z())
        if rev:
            N = -N
        T = np.empty((tri.NbTriangles(), 3), dtype=np.int64)
        for t in range(1, tri.NbTriangles() + 1):
            a, b, c = tri.Triangle(t).Get()
            T[t - 1] = (a - 1, c - 1, b - 1) if rev else (a - 1, b - 1, c - 1)
        pos.append(P)
        nrm.append(N)
        idx.append(T + base)
        base += n
    if not pos:
        raise ValueError(f'{pd.id}: nothing to tessellate')
    return np.concatenate(pos), np.concatenate(nrm), np.concatenate(idx)


def _quat(location) -> tuple[list[float], list[float]]:
    t = location.wrapped.Transformation()
    q = t.GetRotation()
    v = t.TranslationPart()
    return [v.X() * MM, v.Y() * MM, v.Z() * MM], [q.X(), q.Y(), q.Z(), q.W()]


class _Buf:
    def __init__(self):
        self.data = bytearray()
        self.views: list[dict] = []

    def add(self, b: bytes, target: int | None = None) -> int:
        while len(self.data) % 4:
            self.data.append(0)
        off = len(self.data)
        self.data.extend(b)
        v = {'buffer': 0, 'byteOffset': off, 'byteLength': len(b)}
        if target:
            v['target'] = target
        self.views.append(v)
        return len(self.views) - 1


def _item_box(pd, L) -> tuple[float, ...]:
    """A placed part's axis-aligned box in its node's frame or the world (mm): its own box's 8 corners moved by L."""
    from OCP.gp import gp_Pnt
    bb = pd.shape.BoundingBox()
    T = L.wrapped.Transformation()
    xs, ys, zs = [], [], []
    for x in (bb.xmin, bb.xmax):
        for y in (bb.ymin, bb.ymax):
            for z in (bb.zmin, bb.zmax):
                q = gp_Pnt(x, y, z).Transformed(T)
                xs.append(q.X()); ys.append(q.Y()); zs.append(q.Z())
    return min(xs), min(ys), min(zs), max(xs), max(ys), max(zs)


def line_holders(model: Model, reach: float = 3.0) -> frozenset:
    """The parts that hold the lines' ends: every part placed on an anchor's node whose box comes within the line's radius
    and `reach` mm of the anchor (a gland, a fitting, a collar, a box face, a duct's mouth)."""
    out = set()
    for fd in getattr(model, 'flexes', []):
        for an in (fd.a, fd.b):
            p = an.p
            for it in an.node.items:
                x0, y0, z0, x1, y1, z1 = _item_box(it.part, it.loc)
                dx = max(x0 - p[0], 0.0, p[0] - x1)
                dy = max(y0 - p[1], 0.0, p[1] - y1)
                dz = max(z0 - p[2], 0.0, p[2] - z1)
                if math.sqrt(dx * dx + dy * dy + dz * dz) <= fd.r + reach:
                    out.add(it.part.id)
    return frozenset(out)


def write_glb(model: Model, path: str, extras: dict | None = None, depot: bool = False, lod: str | None = None) -> dict:
    """The full model (the Robotics tab's), or one of the yard's: lod='depot' (depot=True), the far model, depot_keep's
    parts coarsely meshed; lod='near', the detail model the yard draws near the camera, near_keep's parts finely meshed.
    All three have the same nodes and joints, carry the lines (the root's extras.flex), and carry each energy chain's
    link as a mesh of its own (a node `flexlink:<line id>` under the root, extras.flexLink), which the viewer instances
    along the chain in place of a box."""
    lod = lod or ('depot' if depot else 'full')
    depot = lod == 'depot'
    near = lod == 'near'
    holders = line_holders(model) if depot else frozenset()
    deck = getattr(model, 'yard_deck_y', None)
    buf = _Buf()
    accessors: list[dict] = []
    meshes: list[dict] = []
    mats: list[dict] = []
    mat_index: dict[str, int] = {}
    mesh_index: dict[str, int] = {}
    stats = {'vertices': 0, 'triangles': 0, 'meshes': 0, 'nodes': 0}

    def mat_for(key: str) -> int:
        if key in mat_index:
            return mat_index[key]
        m = material(key)
        r, g, b = srgb_to_linear(m.color)
        md = {'name': m.key, 'pbrMetallicRoughness': {
            'baseColorFactor': [r, g, b, m.opacity], 'metallicFactor': m.metal, 'roughnessFactor': m.rough}}
        if m.emissive:
            md['emissiveFactor'] = list(srgb_to_linear(m.emissive))
        if m.opacity < 1:
            md['alphaMode'] = 'BLEND'
        mats.append(md)
        mat_index[key] = len(mats) - 1
        return mat_index[key]

    def mesh_for(pd) -> int:
        if pd.id in mesh_index:
            return mesh_index[pd.id]
        P, N, T = tessellate(pd, coarse=depot, near=near)
        P = (P * MM).astype(np.float32)
        nl = np.linalg.norm(N, axis=1, keepdims=True)
        nl[nl == 0] = 1
        Nq = np.clip(np.round(N / nl * 127), -127, 127).astype(np.int8)
        Nq4 = np.zeros((len(Nq), 4), dtype=np.int8)
        Nq4[:, :3] = Nq
        pa = len(accessors)
        accessors.append({'bufferView': buf.add(P.tobytes(), 34962), 'componentType': 5126, 'count': len(P),
                          'type': 'VEC3', 'min': P.min(axis=0).tolist(), 'max': P.max(axis=0).tolist()})
        na = len(accessors)
        bv = buf.add(Nq4.tobytes(), 34962)
        buf.views[bv]['byteStride'] = 4
        accessors.append({'bufferView': bv, 'componentType': 5120, 'normalized': True, 'count': len(P),
                          'type': 'VEC3'})
        ia = len(accessors)
        if len(P) < 65536:
            I = T.astype(np.uint16).ravel()
            accessors.append({'bufferView': buf.add(I.tobytes(), 34963), 'componentType': 5123,
                              'count': int(I.size), 'type': 'SCALAR'})
        else:
            I = T.astype(np.uint32).ravel()
            accessors.append({'bufferView': buf.add(I.tobytes(), 34963), 'componentType': 5125,
                              'count': int(I.size), 'type': 'SCALAR'})
        meshes.append({'name': pd.id, 'primitives': [
            {'attributes': {'POSITION': pa, 'NORMAL': na}, 'indices': ia, 'material': mat_for(pd.mat)}]})
        mesh_index[pd.id] = len(meshes) - 1
        stats['vertices'] += len(P)
        stats['triangles'] += len(T)
        stats['meshes'] += 1
        return mesh_index[pd.id]

    nodes: list[dict] = []
    from cadquery import Location as _Loc

    def keep(it, Lw) -> bool:
        if depot:
            return depot_keep(it.part, holders, yard_hidden(it, Lw, deck))
        if near:
            return near_keep(it, yard_hidden(it, Lw, deck))
        return True

    def emit(node: Node, parent_w=None) -> int:
        Lw = (parent_w or _Loc()) * node.loc          # the node's place at rest (every joint at zero), as the GLB stores it
        t, r = _quat(node.loc)
        nd: dict = {'name': node.name}
        if any(abs(c) > 1e-12 for c in t):
            nd['translation'] = t
        if abs(r[3] - 1) > 1e-12:
            nd['rotation'] = r
        ex: dict = {}
        if node.sub:
            ex['sub'] = node.sub
        if any(node.explode):
            ex['explode'] = [c * MM for c in node.explode]
        if node.joint:
            ex['joint'] = node.joint
        if ex:
            nd['extras'] = ex
        nodes.append(nd)
        me = len(nodes) - 1
        kids = []
        for it in node.items:
            if not keep(it, Lw):
                continue
            ti, ri = _quat(it.loc)
            ni: dict = {'name': it.name, 'mesh': mesh_for(it.part)}
            if any(abs(c) > 1e-12 for c in ti):
                ni['translation'] = ti
            if abs(ri[3] - 1) > 1e-12:
                ni['rotation'] = ri
            e = {'part': it.part.id, 'sub': it.sub}
            if any(it.explode):
                e['explode'] = [round(c * MM, 6) for c in it.explode]
            # what the yard's detail model leaves out, and why: sealed in an actuator, or out of the yard's sight
            # (src/lib/robotics/cadDetail.test.ts proves the first unseen at the twin's poses and checks both against near)
            if getattr(it, 'sealed', False):
                e['sealed'] = True
            if not depot and not near and yard_hidden(it, Lw, deck):
                e['yardHidden'] = True
            ni['extras'] = e
            nodes.append(ni)
            kids.append(len(nodes) - 1)
        for ch in node.children:
            kids.append(emit(ch, Lw))
        if kids:
            nodes[me]['children'] = kids
        return me

    root = emit(model.root)
    # each energy chain's link, as a mesh the viewer instances along the chain (not a placed part: no `part` key)
    link_nodes = []
    for fd in getattr(model, 'flexes', []):
        if fd.kind == 'chain' and fd.link_part is not None:
            nodes.append({'name': f'flexlink:{fd.id}', 'mesh': mesh_for(fd.link_part), 'extras': {'flexLink': fd.id}})
            link_nodes.append(len(nodes) - 1)
    if link_nodes:
        nodes[root].setdefault('children', []).extend(link_nodes)
    nodes[root].setdefault('extras', {}).update(
        {'robot': model.key, 'title': model.title, 'frame': model.frame, **(extras or {})})
    if getattr(model, 'flexes', None):
        from .flex import to_extras
        nodes[root]['extras']['flex'] = [to_extras(fd) for fd in model.flexes]
    stats['nodes'] = len(nodes)

    while len(buf.data) % 4:
        buf.data.append(0)
    gltf = {
        'asset': {'version': '2.0', 'generator': 'OTTOYARD otto_cad (CadQuery / OpenCascade)'},
        'extensionsUsed': ['KHR_mesh_quantization'],
        'extensionsRequired': ['KHR_mesh_quantization'],
        'scene': 0, 'scenes': [{'name': model.key, 'nodes': [root]}],
        'nodes': nodes, 'meshes': meshes, 'materials': mats, 'accessors': accessors,
        'bufferViews': buf.views, 'buffers': [{'byteLength': len(buf.data)}],
    }
    js = json.dumps(gltf, separators=(',', ':')).encode()
    while len(js) % 4:
        js += b' '
    total = 12 + 8 + len(js) + 8 + len(buf.data)
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total))
        f.write(struct.pack('<II', len(js), 0x4E4F534A))
        f.write(js)
        f.write(struct.pack('<II', len(buf.data), 0x004E4942))
        f.write(bytes(buf.data))
    stats['bytes'] = total
    return stats
