"""The model: part definitions, an assembly tree, and the three exports (STEP, GLB, bill of materials).

UNITS AND FRAMES. Parts are modelled in MILLIMETRES, Y UP, in the twin's own frame for each robot
(src/lib/robotics/cadSpec.ts says which). STEP keeps millimetres. The GLB is written in METRES with
no axis change, so a GLB point is a twin point and the depot's code can pose it.

INSTANCES. A part is defined once (one B-rep solid) and placed many times. STEP stores one solid
and N placements; the GLB stores one mesh and N nodes. The bill of materials counts placements.

EXPLODE. Each placement carries an explode vector in its parent node's frame (mm). The viewer moves
a part along it by the explode factor. A node (a module) can carry one too, so a whole actuator moves
out from the arm while its own parts move out from each other.
"""
from __future__ import annotations

import csv
import io
import json
import math
import os
from dataclasses import dataclass, field

import cadquery as cq
from cadquery import Location, Vector
from OCP.BRepGProp import BRepGProp
from OCP.GProp import GProp_GProps

from .materials import material


def srgb_to_linear(hex_color: str) -> tuple[float, float, float]:
    h = hex_color.lstrip('#')
    out = []
    for i in (0, 2, 4):
        c = int(h[i:i + 2], 16) / 255.0
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return out[0], out[1], out[2]


@dataclass
class PartDef:
    """One kind of part: one solid, one material, one bill-of-materials line."""
    id: str
    name: str
    shape: cq.Shape
    mat: str
    category: str                      # fastener, bearing, drive, structure, electrical, fluid, sensor, seal, tool
    standard: str = ''
    size: str = ''
    grade: str = ''
    torque: float | None = None        # tightening torque, N m (fasteners)
    function: str = ''
    spec: dict = field(default_factory=dict)
    make: str = 'make'                 # 'make' (we machine or fabricate it) or 'buy' (catalogue part)
    tol: float | None = None           # tessellation tolerance override, mm
    ang: float | None = None           # tessellation angular tolerance override, rad
    reference: bool = False            # context only (site pad, cabinet envelope): no mass, not in the totals
    mass_override: float | None = None # kg: a bought assembly drawn as its envelope (catalogue mass, see `spec`)
    volume: float = 0.0                # mm3
    mass: float = 0.0                  # kg
    com: tuple[float, float, float] = (0.0, 0.0, 0.0)  # mm, part frame
    depot: object = None               # the depot model's outline: a simpler cq.Shape, or 'box' (its bounding box)

    def finish(self) -> 'PartDef':
        props = GProp_GProps()
        BRepGProp.VolumeProperties_s(self.shape.wrapped, props)
        self.volume = abs(props.Mass())
        c = props.CentreOfMass()
        self.com = (c.X(), c.Y(), c.Z())
        if self.reference:
            self.mass = 0.0
        elif self.mass_override is not None:
            self.mass = self.mass_override
            self.spec = {**self.spec, 'mass basis': 'catalogue class mass (the CAD draws its envelope)'}
        else:
            self.mass = self.volume * 1e-9 * material(self.mat).density
        return self


@dataclass
class Item:
    part: PartDef
    loc: Location
    explode: tuple[float, float, float]
    sub: str
    name: str


class Node:
    """An assembly node: a frame (relative to its parent), parts placed in it, child nodes."""

    def __init__(self, name: str, loc: Location | None = None, sub: str | None = None,
                 joint: dict | None = None, explode: tuple[float, float, float] = (0, 0, 0)):
        self.name = name
        self.loc = loc or Location()
        self.sub = sub
        self.joint = joint
        self.explode = explode
        self.children: list[Node] = []
        self.items: list[Item] = []

    def child(self, name: str, loc: Location | None = None, sub: str | None = None,
              joint: dict | None = None, explode: tuple[float, float, float] = (0, 0, 0)) -> 'Node':
        n = Node(name, loc, sub if sub is not None else self.sub, joint, explode)
        self.children.append(n)
        return n

    def walk(self):
        yield self
        for c in self.children:
            yield from c.walk()


def loc(x: float = 0, y: float = 0, z: float = 0, rx: float = 0, ry: float = 0, rz: float = 0) -> Location:
    """A location: translate (mm), then rotate about X, Y, Z (degrees, intrinsic X then Y then Z)."""
    t = Location(Vector(x, y, z))
    r = Location()
    if rx:
        r = r * Location(Vector(0, 0, 0), Vector(1, 0, 0), rx)
    if ry:
        r = r * Location(Vector(0, 0, 0), Vector(0, 1, 0), ry)
    if rz:
        r = r * Location(Vector(0, 0, 0), Vector(0, 0, 1), rz)
    return t * r


class Model:
    def __init__(self, key: str, title: str, frame: str):
        self.key = key
        self.title = title
        self.frame = frame
        self.root = Node(key)
        self.parts: dict[str, PartDef] = {}
        self.subsystems: dict[str, dict] = {}
        self._counts: dict[str, int] = {}
        self.notes: dict = {}

    # ── definitions ────────────────────────────────────────────────────────────
    def part(self, pd: PartDef) -> PartDef:
        """Register a part definition. One id is one solid: a second definition under the same id must be the same
        shape (the same object, or the same volume and bounding box), or the build stops. A solid with a side's or a
        station's position built into it, reused under one id, would otherwise draw every copy at the first one."""
        old = self.parts.get(pd.id)
        if old is not None:
            if pd.shape is not old.shape:
                a, b = old.shape.BoundingBox(), pd.shape.BoundingBox()
                va = old.volume
                vb = abs(pd.shape.Volume())
                same = abs(va - vb) <= max(1.0, 1e-6 * va) and all(
                    abs(x - y) < 0.01 for x, y in ((a.xmin, b.xmin), (a.ymin, b.ymin), (a.zmin, b.zmin),
                                                   (a.xmax, b.xmax), (a.ymax, b.ymax), (a.zmax, b.zmax)))
                if not same and os.environ.get('CAD_ID_AUDIT'):
                    print(f'ID AUDIT {pd.id}: box {a.xmin:.0f},{a.ymin:.0f},{a.zmin:.0f} vs {b.xmin:.0f},{b.ymin:.0f},{b.zmin:.0f}')
                elif not same:
                    raise ValueError(f'{pd.id}: defined twice with different solids '
                                     f'(box {a.xmin:.0f},{a.ymin:.0f},{a.zmin:.0f} vs {b.xmin:.0f},{b.ymin:.0f},{b.zmin:.0f}); '
                                     'build the solid at its own origin and place it, or give each version its own id')
            return old
        self.parts[pd.id] = pd.finish()
        return pd

    def subsystem(self, sid: str, name: str, function: str, *, how: list[str] | None = None,
                  specs: dict | None = None, group: str = '') -> str:
        self.subsystems[sid] = {
            'id': sid, 'name': name, 'function': function, 'how': how or [], 'specs': specs or {},
            'group': group, 'order': len(self.subsystems),
        }
        return sid

    def place(self, node: Node, pd: PartDef, at: Location | None = None,
              explode: tuple[float, float, float] = (0, 0, 0), sub: str | None = None) -> Item:
        pd = self.part(pd)
        n = self._counts.get(pd.id, 0) + 1
        self._counts[pd.id] = n
        s = sub or node.sub
        if not s:
            raise ValueError(f'{pd.id} placed with no subsystem')
        it = Item(pd, at or Location(), explode, s, f'{pd.id}#{n}')
        node.items.append(it)
        return it

    # ── mass properties ────────────────────────────────────────────────────────
    def mass_props(self, node: Node) -> tuple[float, Vector]:
        """Mass (kg) and centre of mass (mm) of a node and everything under it, in the node's frame."""
        m_tot = 0.0
        acc = Vector(0, 0, 0)
        for it in node.items:
            c = _xf(it.loc, Vector(*it.part.com))
            m_tot += it.part.mass
            acc = acc + c * it.part.mass
        for ch in node.children:
            m, c = self.mass_props(ch)
            c = _xf(ch.loc, c)
            m_tot += m
            acc = acc + c * m
        return m_tot, (acc * (1.0 / m_tot) if m_tot > 0 else Vector(0, 0, 0))

    # ── exports ────────────────────────────────────────────────────────────────
    def to_step(self, path: str) -> None:
        def build(node: Node) -> cq.Assembly:
            a = cq.Assembly(name=node.name, loc=node.loc)
            for it in node.items:
                r, g, b = srgb_to_linear(material(it.part.mat).color)
                a.add(it.part.shape, name=it.name, loc=it.loc, color=cq.Color(r, g, b, 1.0))
            for ch in node.children:
                a.add(build(ch))
            return a
        build(self.root).export(path, 'STEP')

    def bom(self) -> dict:
        uses: dict[str, dict[str, int]] = {}
        for node in self.root.walk():
            for it in node.items:
                uses.setdefault(it.part.id, {})
                uses[it.part.id][it.sub] = uses[it.part.id].get(it.sub, 0) + 1
        lines = []
        for pid, by_sub in uses.items():
            p = self.parts[pid]
            mat = material(p.mat)
            qty = sum(by_sub.values())
            lines.append({
                'id': p.id, 'name': p.name, 'category': p.category, 'make': p.make,
                'standard': p.standard, 'size': p.size, 'grade': p.grade,
                'material': mat.name, 'materialKey': mat.key,
                'qty': qty, 'massKg': round(p.mass, 4), 'totalMassKg': round(p.mass * qty, 4),
                'torqueNm': None if p.torque is None else round(p.torque, 1),
                'reference': p.reference,
                'function': p.function, 'spec': p.spec,
                'uses': [{'sub': s, 'qty': q} for s, q in by_sub.items()],
            })
        order = {s: v['order'] for s, v in self.subsystems.items()}
        cat_order = ['structure', 'drive', 'bearing', 'sensor', 'electrical', 'fluid', 'tool', 'seal', 'fastener']
        lines.sort(key=lambda l: (min(order.get(u['sub'], 999) for u in l['uses']),
                                  cat_order.index(l['category']) if l['category'] in cat_order else 99, l['id']))
        real = [l for l in lines if not l['reference']]
        subs = []
        for s in sorted(self.subsystems.values(), key=lambda v: v['order']):
            parts = [l for l in real if any(u['sub'] == s['id'] for u in l['uses'])]
            count = sum(u['qty'] for l in parts for u in l['uses'] if u['sub'] == s['id'])
            fast = sum(u['qty'] for l in parts if l['category'] == 'fastener' for u in l['uses'] if u['sub'] == s['id'])
            mass = sum(self.parts[l['id']].mass * u['qty'] for l in parts for u in l['uses'] if u['sub'] == s['id'])
            subs.append({**s, 'partCount': count, 'fastenerCount': fast, 'massKg': round(mass, 3),
                         'uniqueParts': len(parts)})
        return {
            'robot': self.key, 'title': self.title, 'frame': self.frame, 'units': {'cad': 'mm', 'glb': 'm'},
            'totals': {
                'parts': sum(l['qty'] for l in real), 'uniqueParts': len(real),
                'fasteners': sum(l['qty'] for l in real if l['category'] == 'fastener'),
                'massKg': round(sum(l['totalMassKg'] for l in real), 2),
                'boughtLines': sum(1 for l in real if l['make'] == 'buy'),
                'madeLines': sum(1 for l in real if l['make'] == 'make'),
                'referenceLines': len(lines) - len(real),
            },
            'subsystems': subs, 'lines': lines, 'notes': self.notes,
        }

    def bom_csv(self) -> str:
        b = self.bom()
        out = io.StringIO()
        w = csv.writer(out)
        w.writerow(['id', 'name', 'qty', 'category', 'make/buy', 'standard', 'size', 'grade', 'material',
                    'mass each kg', 'mass total kg', 'torque N m', 'subsystems', 'function'])
        names = {s['id']: s['name'] for s in b['subsystems']}
        for l in b['lines']:
            w.writerow([l['id'], l['name'], l['qty'], l['category'], l['make'], l['standard'], l['size'],
                        l['grade'], l['material'], l['massKg'], l['totalMassKg'],
                        '' if l['torqueNm'] is None else l['torqueNm'],
                        '; '.join(f"{names.get(u['sub'], u['sub'])} x{u['qty']}" for u in l['uses']),
                        l['function']])
        return out.getvalue()


def _xf(l: Location, v: Vector) -> Vector:
    from OCP.gp import gp_Pnt
    t = l.wrapped.Transformation()
    q = gp_Pnt(v.x, v.y, v.z).Transformed(t)
    return Vector(q.X(), q.Y(), q.Z())


def write_json(path: str, data) -> None:
    with open(path, 'w') as f:
        json.dump(data, f, indent=1, sort_keys=False)
        f.write('\n')


def deg(rad: float) -> float:
    return rad * 180.0 / math.pi
