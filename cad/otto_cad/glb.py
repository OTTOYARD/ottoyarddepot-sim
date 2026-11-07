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

import numpy as np
from OCP.BRep import BRep_Tool
from OCP.BRepLib import BRepLib_ToolTriangulatedShape
from OCP.BRepMesh import BRepMesh_IncrementalMesh
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


def tessellate(pd) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    lin, ang = _tolerance(pd)
    shape = pd.shape.wrapped
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


def write_glb(model: Model, path: str, extras: dict | None = None) -> dict:
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
        P, N, T = tessellate(pd)
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

    def emit(node: Node) -> int:
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
            ti, ri = _quat(it.loc)
            ni: dict = {'name': it.name, 'mesh': mesh_for(it.part)}
            if any(abs(c) > 1e-12 for c in ti):
                ni['translation'] = ti
            if abs(ri[3] - 1) > 1e-12:
                ni['rotation'] = ri
            e = {'part': it.part.id, 'sub': it.sub}
            if any(it.explode):
                e['explode'] = [round(c * MM, 6) for c in it.explode]
            ni['extras'] = e
            nodes.append(ni)
            kids.append(len(nodes) - 1)
        for ch in node.children:
            kids.append(emit(ch))
        if kids:
            nodes[me]['children'] = kids
        return me

    root = emit(model.root)
    nodes[root].setdefault('extras', {}).update(
        {'robot': model.key, 'title': model.title, 'frame': model.frame, **(extras or {})})
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
