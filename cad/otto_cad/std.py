"""Standard and catalogue parts, modelled to their standard's nominal dimensions.

Every dimension table below names its standard; cad/SOURCES.md lists the tables read (with URL and
date) and what each value was checked against. Geometry is nominal (maximum head sizes), threads are
not cut (a cosmetic cylinder at the nominal diameter, as CAD libraries draw them).

FASTENER FRAME: the screw's axis is Y. The underside of the head (the bearing face) is at y = 0, the
head is above it (+Y) and the shank below it (-Y). `orient(p, d)` places a fastener at point p with
its shank pointing along d.

TIGHTENING TORQUE (VDI 2230 Part 1:2015, the standard's own method, not a table): assembly preload at
90 % of the proof stress under combined tension and torsion, friction mu_G = mu_K = 0.12:
    F_M = A_s * 0.9 * R_p0.2 / sqrt(1 + 3 * (1.5 * d2/d0 * (P/(pi*d2) + 1.155*mu_G))**2)
    M_A = F_M * (0.16*P + 0.58*d2*mu_G + mu_K * D_Km/2),   D_Km = (d_w + d_h)/2
It gives M8 12.9 = 43 N m, the value of VDI 2230's own table at mu 0.12 (cad/SOURCES.md).
"""
from __future__ import annotations

import math
from functools import lru_cache

import cadquery as cq
from cadquery import Location, Vector
from OCP.gp import gp_Quaternion, gp_Trsf, gp_Vec

from .core import PartDef

# ═══════════════════════════════════════════════════════════════════ placement ═══


def orient(p: tuple[float, float, float], d: tuple[float, float, float], spin: float = 0.0) -> Location:
    """A location at point p whose local -Y (a fastener's shank) points along d."""
    dx, dy, dz = d
    n = math.sqrt(dx * dx + dy * dy + dz * dz)
    dx, dy, dz = dx / n, dy / n, dz / n
    if abs(dy + 1) < 1e-12:            # already -Y
        q = gp_Quaternion()
    elif abs(dy - 1) < 1e-12:          # +Y: half turn about X
        q = gp_Quaternion(gp_Vec(1, 0, 0), math.pi)
    else:
        q = gp_Quaternion(gp_Vec(0, -1, 0), gp_Vec(dx, dy, dz))
    if spin:
        q = q * gp_Quaternion(gp_Vec(0, 1, 0), math.radians(spin))
    t = gp_Trsf()
    t.SetRotation(q)
    t.SetTranslationPart(gp_Vec(*p))
    return Location(t)


def circle_points(n: int, radius: float, axis: str = 'y', offset: float = 0.0, start: float = 0.0,
                  center: tuple[float, float, float] = (0, 0, 0)) -> list[tuple[float, float, float]]:
    """n points on a circle about an axis through `center`, at `offset` along it."""
    out = []
    cx, cy, cz = center
    for i in range(n):
        a = math.radians(start) + 2 * math.pi * i / n
        u, v = radius * math.cos(a), radius * math.sin(a)
        if axis == 'y':
            out.append((cx + u, cy + offset, cz + v))
        elif axis == 'x':
            out.append((cx + offset, cy + u, cz + v))
        else:
            out.append((cx + u, cy + v, cz + offset))
    return out


AXIS = {'x': (1, 0, 0), 'y': (0, 1, 0), 'z': (0, 0, 1), '-x': (-1, 0, 0), '-y': (0, -1, 0), '-z': (0, 0, -1)}

# ════════════════════════════════════════════════════════════════════ threads ═══
# coarse pitch, ISO 261; clearance hole, medium series, ISO 273
PITCH = {3: 0.5, 4: 0.7, 5: 0.8, 6: 1.0, 8: 1.25, 10: 1.5, 12: 1.75, 16: 2.0, 20: 2.5, 24: 3.0}
HOLE = {3: 3.4, 4: 4.5, 5: 5.5, 6: 6.6, 8: 9.0, 10: 11.0, 12: 13.5, 16: 17.5, 20: 22.0, 24: 26.0}
# proof stress R_p0.2, MPa: ISO 898-1 (8.8 above M16 is 660), ISO 3506-1 for stainless
RP02 = {'8.8': 640, '10.9': 940, '12.9': 1100, 'A2-70': 450, 'A4-70': 450, 'A4-80': 600}

# ISO 4762 socket head cap screw: d -> (dk, k, s)
ISO4762 = {3: (5.5, 3, 2.5), 4: (7, 4, 3), 5: (8.5, 5, 4), 6: (10, 6, 5), 8: (13, 8, 6), 10: (16, 10, 8),
           12: (18, 12, 10), 16: (24, 16, 14), 20: (30, 20, 17)}
# ISO 7380-1 button head: d -> (dk, k, s)
ISO7380 = {3: (5.7, 1.65, 2), 4: (7.6, 2.2, 2.5), 5: (9.5, 2.75, 3), 6: (10.5, 3.3, 4), 8: (14, 4.4, 5),
           10: (17.5, 5.5, 6)}
# ISO 10642 countersunk: d -> (dk, k, s)
ISO10642 = {3: (6.72, 1.86, 2), 4: (8.96, 2.48, 2.5), 5: (11.2, 3.1, 3), 6: (13.44, 3.72, 4),
            8: (17.92, 4.96, 5), 10: (22.4, 6.2, 6)}
# ISO 4017 hex head screw: d -> (s, k)
ISO4017 = {6: (10, 4), 8: (13, 5.3), 10: (16, 6.4), 12: (18, 7.5), 16: (24, 10), 20: (30, 12.5), 24: (36, 15)}
# ISO 4032 hex nut: d -> (s, m);  ISO 7040 prevailing-torque (nylon insert) nut: d -> (s, h)
ISO4032 = {5: (8, 4.7), 6: (10, 5.2), 8: (13, 6.8), 10: (16, 8.4), 12: (18, 10.8), 16: (24, 14.8), 20: (30, 18),
           24: (36, 21.5)}
ISO7040 = {6: (10, 8), 8: (13, 9.5), 10: (16, 12.5), 12: (18, 14), 16: (24, 18), 20: (30, 22)}
# ISO 7089 plain washer, normal series: d -> (d1, d2, h)
ISO7089 = {3: (3.2, 7, 0.5), 4: (4.3, 9, 0.8), 5: (5.3, 10, 1.0), 6: (6.4, 12, 1.6), 8: (8.4, 16, 1.6),
           10: (10.5, 20, 2.0), 12: (13, 24, 2.5), 16: (17, 30, 3.0), 20: (21, 37, 3.0), 24: (25, 44, 4.0)}
# DIN 25201 wedge-lock washer pair (two halves, cam faces inside): d -> (d1, d2, total thickness)
DIN25201 = {6: (6.4, 10.8, 2.5), 8: (8.7, 13.5, 2.5), 10: (10.7, 16.6, 3.4), 12: (13.0, 19.5, 3.4),
            16: (17.0, 25.4, 3.4)}


def vdi2230(d: int, grade: str, dw: float, mu: float = 0.12) -> tuple[float, float]:
    """(preload kN, tightening torque N m) by VDI 2230 Part 1, at 90 % utilisation (see module doc)."""
    P = PITCH[d]
    d2 = d - 0.649519 * P
    d3 = d - 1.226869 * P
    d0 = (d2 + d3) / 2
    As = math.pi / 4 * d0 ** 2
    rp = RP02[grade] if not (grade == '8.8' and d > 16) else 660
    k = 1.5 * d2 / d0 * (P / (math.pi * d2) + 1.155 * mu)
    F = As * 0.9 * rp / math.sqrt(1 + 3 * k * k)
    Dkm = (dw + HOLE[d]) / 2
    M = F * (0.16 * P + 0.58 * d2 * mu + mu * Dkm / 2) / 1000.0
    return F / 1000.0, M


FAST_MAT = {'12.9': 'fast_blk', '10.9': 'fast_zn', '8.8': 'fast_zn', 'A2-70': 'fast_a2', 'A4-70': 'fast_a4',
            'A4-80': 'fast_a4'}


def _hex(s: float, h: float) -> cq.Workplane:
    return cq.Workplane('XZ').polygon(6, s / math.cos(math.pi / 6)).extrude(-h)  # XZ normal is -Y: flip


def _socket(dk_top: float, s: float, depth: float, wp: cq.Workplane) -> cq.Workplane:
    cut = cq.Workplane('XZ', origin=(0, dk_top, 0)).polygon(6, s / math.cos(math.pi / 6)).extrude(depth)
    return wp.cut(cut)


def _shank(d: float, L: float) -> cq.Workplane:
    c = min(0.4 * d * 0.25 + 0.3, L * 0.2)
    return (cq.Workplane('XZ').circle(d / 2).extrude(L)  # XZ normal -Y: extrudes toward -Y
            .faces('<Y').edges().chamfer(c))


@lru_cache(maxsize=None)
def _shcs_shape(d: int, L: float) -> cq.Shape:
    dk, k, s = ISO4762[d]
    head = cq.Workplane('XZ').circle(dk / 2).extrude(-k).faces('>Y').edges().fillet(min(0.1 * d + 0.2, k * 0.15))
    head = _socket(k, s, 0.55 * k, head)
    return head.union(_shank(d, L)).val()


@lru_cache(maxsize=None)
def _bhcs_shape(d: int, L: float) -> cq.Shape:
    dk, k, s = ISO7380[d]
    R = (dk * dk / 4 + k * k) / (2 * k)             # sphere through the head's rim and crown
    dome = cq.Workplane('XY').sphere(R).translate((0, k - R, 0))
    cyl = cq.Workplane('XZ').circle(dk / 2).extrude(-k)
    head = dome.intersect(cyl)
    head = _socket(k, s, 0.6 * k, head)
    return head.union(_shank(d, L)).val()


@lru_cache(maxsize=None)
def _cshcs_shape(d: int, L: float) -> cq.Shape:
    dk, k, s = ISO10642[d]
    # countersunk: the head's top face is y = 0 (flush), the cone runs down to the shank
    cone = cq.Solid.makeCone(d / 2, dk / 2, k, pnt=Vector(0, -k, 0), dir=Vector(0, 1, 0))
    head = cq.Workplane('XY').add(cone)
    head = _socket(0, s, 0.6 * k, head)
    shank = cq.Workplane('XZ', origin=(0, -k, 0)).circle(d / 2).extrude(L - k).faces('<Y').edges().chamfer(0.3 + d * 0.08)
    return head.union(shank).val()


@lru_cache(maxsize=None)
def _hex_bolt_shape(d: int, L: float) -> cq.Shape:
    s, k = ISO4017[d]
    head = _hex(s, k)
    cham = cq.Solid.makeCone(s * 0.62, s * 0.62 + k * 2, k * 2, pnt=Vector(0, k - k * 2, 0), dir=Vector(0, 1, 0))
    head = head.intersect(cq.Workplane('XY').add(cham).union(cq.Workplane('XZ').circle(s * 0.62).extrude(-k)))
    return head.union(_shank(d, L)).val()


@lru_cache(maxsize=None)
def _nut_shape(d: int, nyloc: bool) -> cq.Shape:
    s, m = (ISO7040 if nyloc else ISO4032)[d]
    body = _hex(s, m)
    cham_r = s * 0.5
    cone_a = cq.Solid.makeCone(cham_r + m, cham_r, m, pnt=Vector(0, 0, 0), dir=Vector(0, 1, 0))
    cone_b = cq.Solid.makeCone(cham_r, cham_r + m, m, pnt=Vector(0, 0, 0), dir=Vector(0, 1, 0))
    body = body.intersect(cq.Workplane('XY').add(cone_a)).intersect(cq.Workplane('XY').add(cone_b).translate((0, 0, 0)))
    body = body.cut(cq.Workplane('XZ').circle(d * 0.84 / 2).extrude(-m))
    return body.val()


@lru_cache(maxsize=None)
def _washer_shape(d1: float, d2: float, h: float) -> cq.Shape:
    return cq.Workplane('XZ').circle(d2 / 2).circle(d1 / 2).extrude(-h).val()


@lru_cache(maxsize=None)
def _pin_shape(dia: float, L: float) -> cq.Shape:
    return (cq.Workplane('XZ').circle(dia / 2).extrude(L / 2, both=True)
            .faces('|Y or >Y or <Y').edges('not |Y').chamfer(min(0.3 + dia * 0.06, L * 0.1)).val())


@lru_cache(maxsize=None)
def _setscrew_shape(d: int, L: float) -> cq.Shape:
    s = {3: 1.5, 4: 2, 5: 2.5, 6: 3, 8: 4, 10: 5}[d]
    body = cq.Workplane('XZ').circle(d / 2).extrude(L).faces('<Y').edges().chamfer(0.3)
    cut = cq.Workplane('XZ').polygon(6, s / math.cos(math.pi / 6)).extrude(min(L * 0.6, d))
    return body.cut(cut).val()


def shcs(d: int, L: float, grade: str = '12.9', fn: str = '') -> PartDef:
    dk = ISO4762[d][0]
    F, M = vdi2230(d, grade, dk)
    return PartDef(f'ISO4762-M{d}x{L:g}-{grade}', f'Socket head cap screw M{d} x {L:g}', _shcs_shape(d, L),
                   FAST_MAT[grade], 'fastener', 'ISO 4762', f'M{d} x {L:g}', grade, M, fn,
                   {'preload': f'{F:.1f} kN', 'drive': f'hex socket {ISO4762[d][2]} mm'}, 'buy')


def bhcs(d: int, L: float, grade: str = '10.9', fn: str = '') -> PartDef:
    dk = ISO7380[d][0]
    F, M = vdi2230(d, grade, dk)
    M *= 0.8  # ISO 7380 heads: the standard limits them to about 80 % of a cap screw's torque
    return PartDef(f'ISO7380-M{d}x{L:g}-{grade}', f'Button head screw M{d} x {L:g}', _bhcs_shape(d, L),
                   FAST_MAT[grade], 'fastener', 'ISO 7380-1', f'M{d} x {L:g}', grade, M, fn,
                   {'drive': f'hex socket {ISO7380[d][2]} mm'}, 'buy')


def cshcs(d: int, L: float, grade: str = '10.9', fn: str = '') -> PartDef:
    dk = ISO10642[d][0]
    F, M = vdi2230(d, grade, dk)
    return PartDef(f'ISO10642-M{d}x{L:g}-{grade}', f'Countersunk screw M{d} x {L:g}', _cshcs_shape(d, L),
                   FAST_MAT[grade], 'fastener', 'ISO 10642', f'M{d} x {L:g}', grade, M * 0.8, fn,
                   {'drive': f'hex socket {ISO10642[d][2]} mm'}, 'buy')


def hex_bolt(d: int, L: float, grade: str = '8.8', fn: str = '') -> PartDef:
    s = ISO4017[d][0]
    F, M = vdi2230(d, grade, s * 0.95)
    return PartDef(f'ISO4017-M{d}x{L:g}-{grade}', f'Hex head screw M{d} x {L:g}', _hex_bolt_shape(d, L),
                   FAST_MAT[grade], 'fastener', 'ISO 4017', f'M{d} x {L:g}', grade, M, fn,
                   {'preload': f'{F:.1f} kN', 'drive': f'hex {s} mm'}, 'buy')


def nut(d: int, grade: str = '8', nyloc: bool = False, fn: str = '') -> PartDef:
    std = 'ISO 7040' if nyloc else 'ISO 4032'
    mat = 'fast_a4' if grade.startswith('A') else 'fast_zn'
    nm = 'Prevailing-torque hex nut (nylon insert)' if nyloc else 'Hex nut'
    fn = fn or ('Holds the bolt\'s clamp force on the far side of the joint. The nylon ring grips the thread, so '
                'vibration cannot turn the nut loose.' if nyloc else
                'Holds the bolt\'s clamp force on the far side of the joint.')
    return PartDef(f'{std.replace(" ", "")}-M{d}-{grade}', f'{nm} M{d}', _nut_shape(d, nyloc), mat,
                   'fastener', std, f'M{d}', grade, None, fn, {}, 'buy')


def washer(d: int, mat: str = 'fast_zn', fn: str = '') -> PartDef:
    d1, d2, h = ISO7089[d]
    return PartDef(f'ISO7089-{d}-{mat}', f'Plain washer {d}', _washer_shape(d1, d2, h), mat, 'fastener',
                   'ISO 7089', f'{d1:g} x {d2:g} x {h:g}', '200 HV' if mat != 'fast_a4' else 'A4', None,
                   fn or 'Puts the clamp force of the head or the nut on a larger area, so the part surface does not '
                         'crush and the preload stays constant.', {}, 'buy')


def wedge_lock(d: int, fn: str = '') -> PartDef:
    d1, d2, h = DIN25201[d]
    return PartDef(f'DIN25201-{d}', f'Wedge-lock washer pair {d}', _washer_shape(d1, d2, h), 'fast_zn', 'fastener',
                   'DIN 25201', f'{d1:g} x {d2:g} x {h:g}', 'steel, hardened', None,
                   fn or 'Keeps the screw tight under vibration. Cam faces lock the pair.', {}, 'buy')


def dowel(dia: float, L: float, fn: str = '') -> PartDef:
    return PartDef(f'ISO8734-{dia:g}x{L:g}', f'Dowel pin {dia:g} x {L:g}', _pin_shape(dia, L), 'bearing',
                   'fastener', 'ISO 8734', f'{dia:g} m6 x {L:g}', 'hardened 58 HRC', None,
                   fn or 'Locates the two parts. The screws only clamp them.', {}, 'buy')


def set_screw(d: int, L: float, fn: str = '') -> PartDef:
    return PartDef(f'ISO4026-M{d}x{L:g}', f'Set screw M{d} x {L:g}, flat point', _setscrew_shape(d, L), 'fast_blk',
                   'fastener', 'ISO 4026', f'M{d} x {L:g}', '45H', None, fn, {}, 'buy')


# ═══════════════════════════════════════════════════════════════════ seals, rings ═══


@lru_cache(maxsize=None)
def _oring_shape(id_: float, cs: float) -> cq.Shape:
    return cq.Solid.makeTorus(id_ / 2 + cs / 2, cs / 2, pnt=Vector(0, 0, 0), dir=Vector(0, 1, 0))


def oring(id_: float, cs: float, fn: str = '') -> PartDef:
    return PartDef(f'ORING-{id_:g}x{cs:g}', f'O-ring {id_:g} x {cs:g}', _oring_shape(id_, cs), 'nbr', 'seal',
                   'ISO 3601-1', f'{id_:g} x {cs:g}', 'NBR 70', None, fn or 'Seals the joint face against water and dust.',
                   {}, 'buy')


@lru_cache(maxsize=None)
def _lip_seal_shape(d: float, D: float, b: float) -> cq.Shape:
    ring = cq.Workplane('XZ').circle(D / 2).circle(D / 2 - (D - d) * 0.35).extrude(-b)
    lip = cq.Workplane('XZ', origin=(0, b * 0.15, 0)).circle(d / 2 + (D - d) * 0.32).circle(d / 2).extrude(-b * 0.55)
    # the web joins the case to the lip across the top (its two radii were once equal, which drew a solid disc)
    web = cq.Workplane('XZ', origin=(0, b * 0.75, 0)).circle(D / 2 - (D - d) * 0.1).circle(d / 2 + (D - d) * 0.1).extrude(-b * 0.25)
    return ring.union(lip).union(web).val()


def lip_seal(d: float, D: float, b: float, fn: str = '') -> PartDef:
    return PartDef(f'SEAL-{d:g}x{D:g}x{b:g}', f'Radial shaft seal {d:g} x {D:g} x {b:g}', _lip_seal_shape(d, D, b),
                   'nbr', 'seal', 'ISO 6194-1', f'{d:g} x {D:g} x {b:g}', 'FKM, with dust lip', None,
                   fn or 'Seals the output against water and dust (IP65).', {}, 'buy')


@lru_cache(maxsize=None)
def _circlip_shape(D: float, s: float, bore: bool) -> cq.Shape:
    rw = D * 0.07 + 1.0
    r_out, r_in = (D / 2 + rw * 0.25, D / 2 - rw * 0.75) if bore else (D / 2 + rw * 0.75, D / 2 - rw * 0.25)
    ring = cq.Workplane('XZ').circle(r_out).circle(r_in).extrude(-s)
    gap = cq.Workplane('XY').box(D * 0.18, s * 4, D, centered=(True, True, False)).translate((0, 0, 0))
    ring = ring.cut(gap)
    for sx in (-1, 1):
        lug = (cq.Workplane('XZ').center(sx * D * 0.15, (r_in if bore else r_out) * 0.92).circle(rw * 0.7)
               .circle(rw * 0.25).extrude(-s))
        ring = ring.union(lug)
    return ring.val()


def circlip(D: float, bore: bool, fn: str = '') -> PartDef:
    std = 'DIN 472' if bore else 'DIN 471'
    s = 1.2 if D < 30 else 1.75 if D < 60 else 2.5 if D < 120 else 3.0
    nm = 'Retaining ring, bore' if bore else 'Retaining ring, shaft'
    return PartDef(f'{std.replace(" ", "")}-{D:g}', f'{nm} {D:g}', _circlip_shape(D, s, bore), 'steel', 'fastener',
                   std, f'{D:g} x {s:g}', 'spring steel', None, fn or 'Holds the bearing in its seat.', {}, 'buy')


# ════════════════════════════════════════════════════════════════════ bearings ═══
# deep groove ball bearings, ISO 15 boundary dimensions: code -> (d, D, B)
DGBB = {'6004': (20, 42, 12), '6005': (25, 47, 12), '6006': (30, 55, 13), '6008': (40, 68, 15),
        '6010': (50, 80, 16), '6012': (60, 95, 18), '6205': (25, 52, 15), '6206': (30, 62, 16),
        '6208': (40, 80, 18), '6210': (50, 90, 20), '6305': (25, 62, 17), '6806': (30, 42, 7),
        '6808': (40, 52, 7), '6810': (50, 65, 7), '6812': (60, 78, 10), '6814': (70, 90, 10),
        '6816': (80, 100, 10), '6818': (90, 115, 13), '6820': (100, 125, 13), '6822': (110, 140, 16),
        '61907': (35, 55, 10), '61910': (50, 72, 12), '6905': (25, 42, 9), '6704': (20, 27, 4)}


@lru_cache(maxsize=None)
def _ball_bearing_shape(d: float, D: float, B: float) -> cq.Shape:
    pd = (d + D) / 2
    ball = (D - d) * 0.3
    t_ring = (D - d) / 2 * 0.28
    outer = cq.Workplane('XZ').circle(D / 2).circle(D / 2 - t_ring).extrude(B / 2, both=True)
    inner = cq.Workplane('XZ').circle(d / 2 + t_ring).circle(d / 2).extrude(B / 2, both=True)
    shields = cq.Workplane('XZ').circle(D / 2 - t_ring).circle(d / 2 + t_ring).extrude(B * 0.04, both=True) \
        .translate((0, B * 0.44, 0)).union(
        cq.Workplane('XZ').circle(D / 2 - t_ring).circle(d / 2 + t_ring).extrude(B * 0.04, both=True).translate((0, -B * 0.44, 0)))
    n = max(6, int(math.pi * pd / (ball * 1.45)))
    solids = [outer.val(), inner.val()] + shields.vals()
    for i in range(n):
        a = 2 * math.pi * i / n
        solids.append(cq.Solid.makeSphere(ball / 2, Vector(pd / 2 * math.cos(a), 0, pd / 2 * math.sin(a))))
    return cq.Compound.makeCompound(solids)


def ball_bearing(code: str, fn: str = '') -> PartDef:
    d, D, B = DGBB[code]
    return PartDef(f'BRG-{code}-2RS', f'Deep groove ball bearing {code}-2RS', _ball_bearing_shape(d, D, B), 'bearing',
                   'bearing', 'ISO 15', f'{d} x {D} x {B}', 'C3, sealed 2RS', None, fn, {'bore': f'{d} mm'}, 'buy',
                   ang=0.75)


@lru_cache(maxsize=None)
def _crossroller_shape(d: float, D: float, B: float) -> cq.Shape:
    pd = (d + D) / 2
    roller = min(B * 0.62, (D - d) * 0.32)
    gap = roller * 0.75
    outer = cq.Workplane('XZ').circle(D / 2).circle(pd / 2 + gap * 0.62).extrude(B / 2, both=True)
    inner = cq.Workplane('XZ').circle(pd / 2 - gap * 0.62).circle(d / 2).extrude(B / 2, both=True)
    # the outer ring is split in two and clamped: show the split line as a shallow groove
    outer = outer.cut(cq.Workplane('XZ').circle(D / 2 + 1).circle(D / 2 - 0.6).extrude(0.4, both=True))
    n = max(12, int(math.pi * pd / (roller * 1.25)))
    solids = [outer.val(), inner.val()]
    for i in range(n):
        a = 360.0 * i / n
        tilt = 45 if i % 2 == 0 else -45
        r = (cq.Workplane('XY').cylinder(roller, roller / 2)
             .rotate((0, 0, 0), (1, 0, 0), tilt)
             .translate((pd / 2, 0, 0))
             .rotate((0, 0, 0), (0, 1, 0), a))
        solids.append(r.val())
    return cq.Compound.makeCompound(solids)


def cross_roller(d: float, D: float, B: float, fn: str = '') -> PartDef:
    return PartDef(f'XRB-{d:g}x{D:g}x{B:g}', f'Cross-roller bearing {d:g} x {D:g} x {B:g}',
                   _crossroller_shape(d, D, B), 'bearing', 'bearing', 'ISO 492 class P5', f'{d:g} x {D:g} x {B:g}',
                   'preloaded, split outer ring', None,
                   fn or 'Carries the joint output. It takes the radial, axial and tilt loads in one bearing.',
                   {'rollers': 'crossed at 90 degrees'}, 'buy', ang=0.6)


# ══════════════════════════════════════════════════════════ strain-wave gear set ═══
# TOOTH FORM, SIMPLIFIED: the gears are drawn with TEETH_DRAWN teeth, a band that reads as a gear in
# section and keeps the STEP small. The catalogue part has 2 x ratio teeth on the flexspline and 2 more
# on the circular spline (200 and 202 at 100:1); the bill of materials states the real counts.
TEETH_DRAWN = 64
# rating at ratio 100, N m: size -> (repeated peak, momentary peak). Catalogue component sets, read
# 2026-11-07 (cad/SOURCES.md). The envelope below is scaled from the size code (pitch diameter
# ~ size x 2.54 mm): ASSUMPTION, close to catalogue drawings, to be checked against the vendor's.
SWG_RATING = {14: (36, 70), 17: (70, 143), 20: (107, 191), 25: (204, 369), 32: (433, 841),
              40: (738, 1400), 50: (1274, 2678)}


def _zigzag(r_in: float, r_out: float, n: int) -> list[tuple[float, float]]:
    pts = []
    for i in range(n * 2):
        a = math.pi * i / n
        r = r_out if i % 2 == 0 else r_in
        pts.append((r * math.cos(a), r * math.sin(a)))
    return pts


@lru_cache(maxsize=None)
def swg_dims(size: int) -> dict:
    D = size * 2.54
    return {'pitch': D, 'cs_od': D * 1.68, 'cs_id': D * 1.0, 'cs_w': D * 0.24,
            'fs_od': D * 0.985, 'fs_len': D * 0.62, 'fs_wall': max(0.6, D * 0.012), 'fs_hub': D * 0.42,
            'wg_major': D * 0.96, 'wg_minor': D * 0.93, 'wg_w': D * 0.2,
            'cs_bc': D * 1.42, 'cs_bolt': 4 if size <= 17 else 5 if size <= 20 else 6 if size <= 25 else 8 if size <= 40 else 10,
            'cs_n': 8 if size <= 20 else 12 if size <= 40 else 16}


def fs_screws(size: int) -> tuple[int, int, float]:
    """The flexspline hub screws: (count, size, bolt-circle radius). As many as fit their circle with a head's width
    and 1 mm between heads, at most 8."""
    g = swg_dims(size)
    r = g['fs_hub'] * 0.36
    d = 6 if size >= 45 else 5 if size >= 40 else 4 if size >= 30 else 3
    n = min(8, int(2 * math.pi * r / (ISO4762[d][0] + 1)))
    n -= n % 2
    return n, d, r


@lru_cache(maxsize=None)
def _cs_shape(size: int) -> cq.Shape:
    g = swg_dims(size)
    zz = _zigzag(g['cs_id'] / 2, g['cs_id'] / 2 + max(0.6, g['pitch'] * 0.012), TEETH_DRAWN + 2)
    ring = cq.Workplane('XZ').circle(g['cs_od'] / 2).polyline(zz).close().extrude(g['cs_w'] / 2, both=True)
    pts = [(p[0], p[2]) for p in circle_points(g['cs_n'], g['cs_bc'] / 2, 'y', 0, 180 / g['cs_n'])]
    ring = ring.faces('>Y').workplane().pushPoints(pts).hole(HOLE[g['cs_bolt']])
    return ring.val()


@lru_cache(maxsize=None)
def _fs_shape(size: int) -> cq.Shape:
    g = swg_dims(size)
    L, w = g['fs_len'], g['fs_wall']
    # closed end (diaphragm and hub) at y = 0, open end with the teeth at y = L
    cup = (cq.Workplane('XZ').circle(g['fs_od'] / 2).extrude(-L)
           .faces('>Y').shell(-w))
    teeth = (cq.Workplane('XZ', origin=(0, L - g['cs_w'] * 0.8, 0))
             .polyline(_zigzag(g['fs_od'] / 2 - 0.2, g['fs_od'] / 2 + max(0.5, g['pitch'] * 0.01), TEETH_DRAWN)).close()
             .circle(g['fs_od'] / 2 - w).extrude(-g['cs_w'] * 0.8))
    hub = cq.Workplane('XZ').circle(g['fs_hub'] / 2).circle(g['fs_hub'] * 0.22).extrude(-w * 4)
    out = cup.union(teeth).union(hub)
    n, d, r = fs_screws(size)
    pts = [(p[0], p[2]) for p in circle_points(n, r, 'y')]
    out = out.faces('<Y').workplane().pushPoints(pts).hole(HOLE[d])
    return out.val()


@lru_cache(maxsize=None)
def _wg_shape(size: int, bore: float) -> cq.Shape:
    """The wave generator of a hollow-shaft unit: the cam's plug is bored to the motor shaft it sits on."""
    g = swg_dims(size)
    cam = cq.Workplane('XZ').ellipse(g['wg_major'] / 2 - g['pitch'] * 0.06, g['wg_minor'] / 2 - g['pitch'] * 0.06) \
        .extrude(g['wg_w'] / 2, both=True)
    race = (cq.Workplane('XZ').ellipse(g['wg_major'] / 2, g['wg_minor'] / 2)
            .ellipse(g['wg_major'] / 2 - g['pitch'] * 0.035, g['wg_minor'] / 2 - g['pitch'] * 0.035)
            .extrude(g['wg_w'] / 2 * 0.9, both=True))
    hole = cq.Workplane('XZ').circle(bore / 2).extrude(g['wg_w'], both=True)
    return cam.union(race).cut(hole).val()


def strain_wave(size: int, ratio: int = 100, bore: float = 0.0) -> tuple[PartDef, PartDef, PartDef]:
    rp, mp = SWG_RATING[size]
    sp = {'ratio': f'{ratio}:1', 'repeated peak torque': f'{rp} N m', 'momentary peak torque': f'{mp} N m',
          'teeth': f'flexspline {2 * ratio}, circular spline {2 * ratio + 2} (drawn simplified)',
          'backlash': 'zero (about 1 arc-min lost motion)'}
    cs = PartDef(f'SWG{size}-CS', f'Strain-wave gear size {size}: circular spline', _cs_shape(size), 'steel', 'drive',
                 'catalogue component set', f'size {size}, ratio {ratio}:1', '', None,
                 'Rigid ring gear with internal teeth. It is bolted to the housing and does not turn.', sp, 'buy')
    fs = PartDef(f'SWG{size}-FS', f'Strain-wave gear size {size}: flexspline', _fs_shape(size), 'steel', 'drive',
                 'catalogue component set', f'size {size}, ratio {ratio}:1', '', None,
                 'Thin steel cup with 2 fewer teeth than the ring. It flexes into an ellipse and turns the output.',
                 sp, 'buy')
    wg = PartDef(f'SWG{size}-WG', f'Strain-wave gear size {size}: wave generator', _wg_shape(size, bore or swg_dims(size)['pitch'] * 0.34),
                 'bearing', 'drive',
                 'catalogue component set', f'size {size}, ratio {ratio}:1', '', None,
                 'Elliptical cam on a thin ball bearing. The motor turns it. Each turn moves the output 2 teeth.',
                 sp, 'buy')
    return cs, fs, wg


# ══════════════════════════════════════════════════════════ frameless motor kit ═══


@lru_cache(maxsize=None)
def _stator_shape(od: float, id_: float, L: float) -> cq.Shape:
    slots = 36 if od > 120 else 24
    zz = _zigzag(id_ / 2, id_ / 2 + (od - id_) * 0.28, slots)
    return cq.Workplane('XZ').circle(od / 2).polyline(zz).close().extrude(L / 2, both=True).val()


@lru_cache(maxsize=None)
def _winding_shape(od: float, id_: float, L: float) -> cq.Shape:
    rm = (od / 2 * 0.86 + id_ / 2 * 1.06) / 2
    rt = (od - id_) * 0.16
    ends = None
    for s in (-1, 1):
        t = cq.Workplane('XY').add(cq.Solid.makeTorus(rm, rt, pnt=Vector(0, s * (L / 2 + rt), 0), dir=Vector(0, 1, 0)))
        ends = t if ends is None else ends.union(t)
    return ends.val()


@lru_cache(maxsize=None)
def _rotor_shape(od: float, id_: float, L: float) -> cq.Shape:
    hub = cq.Workplane('XZ').circle(od / 2 - (od * 0.035)).circle(id_ / 2).extrude(L / 2, both=True)
    poles = 30 if od > 100 else 20
    solids = [hub.val()]
    for i in range(poles):
        a = 360.0 * i / poles
        m = (cq.Workplane('XY').box(od * 0.035, L * 0.96, math.pi * od / poles * 0.8)
             .translate((od / 2 - od * 0.0175 + 0.05, 0, 0)).rotate((0, 0, 0), (0, 1, 0), a))
        solids.append(m.val())
    return cq.Compound.makeCompound(solids)


def winding_reach(od: float) -> tuple[float, float]:
    """(outer radius, axial reach past each stator face) of the winding end turns of a stator of diameter od."""
    id_ = od * 0.64
    rm = (od / 2 * 0.86 + id_ / 2 * 1.06) / 2
    rt = (od - id_) * 0.16
    return rm + rt, 2 * rt


def frameless_motor(od: float, L: float, kw: float, torque: float, bore: float = 0.0) -> tuple[PartDef, PartDef, PartDef]:
    id_s = od * 0.64
    sp = {'continuous torque': f'{torque:g} N m', 'power': f'{kw:g} kW', 'bus voltage': '48 V DC',
          'type': 'brushless, frameless, 3-phase'}
    tag = f'{od:g}x{L:g}'
    st = PartDef(f'MOT-{tag}-ST', f'Frameless torque motor {tag}: stator core', _stator_shape(od, id_s, L), 'lam',
                 'drive', 'catalogue motor kit', tag, '', None,
                 'Laminated core with the 3-phase coils. It is bonded into the housing and makes the rotating field.',
                 sp, 'buy')
    wd = PartDef(f'MOT-{tag}-WD', f'Frameless torque motor {tag}: winding end turns', _winding_shape(od, id_s, L),
                 'copper', 'drive', 'catalogue motor kit', tag, '', None,
                 'Copper coil ends of the stator winding, with a thermistor for over-temperature stop.', sp, 'buy',
                 ang=0.6)
    ro = PartDef(f'MOT-{tag}-RO', f'Frameless torque motor {tag}: rotor', _rotor_shape(id_s - 1.2, bore or od * 0.36, L * 0.98),
                 'magnet', 'drive', 'catalogue motor kit', tag, '', None,
                 'Steel hub with the permanent magnets. It turns the hollow motor shaft.', sp, 'buy')
    return st, wd, ro


@lru_cache(maxsize=None)
def _brake_shape(od: float, bore: float, L: float, plate_r: float) -> cq.Shape:
    """From y = 0 down to -L: the magnet body (coil and springs), the armature plate, the friction disc keyed on the shaft
    (bore = the shaft), and the end plate the encoder heads screw to. The 3 body screws pass outside the armature."""
    r = od / 2
    body = cq.Workplane('XZ').circle(r).circle(bore / 2 + 1).extrude(L * 0.55)
    arm = cq.Workplane('XZ', origin=(0, -L * 0.56, 0)).circle(r * 0.8).circle(bore / 2 + 1).extrude(L * 0.1)
    disc = cq.Workplane('XZ', origin=(0, -L * 0.68, 0)).circle(r * 0.8).circle(bore / 2).extrude(L * 0.12)
    plate = cq.Workplane('XZ', origin=(0, -L * 0.82, 0)).circle(max(r, plate_r)).circle(bore / 2 + 1).extrude(L * 0.18)
    return body.union(arm).union(disc).union(plate).val()


def brake(od: float, L: float, torque: float, bore: float = 0.0, plate_r: float = 0.0) -> PartDef:
    return PartDef(f'BRK-{od:g}x{L:g}', f'Spring-applied holding brake {od:g}', _brake_shape(od, bore or od * 0.42, L, plate_r), 'steel',
                   'drive', 'catalogue part', f'{od:g} x {L:g}', '', None,
                   'Springs hold the joint when power is off. The coil releases it. A power cut cannot drop the arm.',
                   {'holding torque': f'{torque:g} N m (motor side)', 'release': '24 V DC'}, 'buy')


@lru_cache(maxsize=None)
def _encoder_shape(od: float, id_: float) -> cq.Shape:
    disc = cq.Workplane('XZ').circle(od / 2).circle(id_ / 2).extrude(-1.2)
    hub = cq.Workplane('XZ').circle(id_ / 2 + 5).circle(id_ / 2).extrude(-4)
    w = od * 0.18 + 10
    head = cq.Workplane('XY').box(w, 9, 16).translate((od / 2 - 4 + w / 2, 4.5, 0))     # over the disc's outer 4 mm
    return disc.union(hub).union(head).val()


def encoder(od: float, kind: str, bore: float = 0.0) -> PartDef:
    """A ring encoder on the motor shaft: the disc on the shaft, the read head at its rim (y from 0 up to 9)."""
    nm = {'motor': 'Motor encoder, 23-bit absolute (rotor position)',
          'multiturn': 'Multi-turn encoder, 16-bit turn count, battery-free'}[kind]
    fn = {'motor': 'Reads the motor shaft angle for the drive. The drive uses it to commutate and run the speed loop.',
          'multiturn': 'Counts the motor turns, with no battery. With the motor encoder it gives the joint angle after the gear '
                       'at power-up, so the arm needs no homing move.'}[kind]
    return PartDef(f'ENC-{kind}-{od:g}', nm, _encoder_shape(od, bore or od * 0.5), 'pcb', 'sensor', 'catalogue part',
                   f'ring {od:g} mm', '', None, fn, {'interface': 'BiSS-C, RS-485'}, 'buy')


@lru_cache(maxsize=None)
def _pcb_shape(od: float, t: float) -> cq.Shape:
    b = cq.Workplane('XZ').circle(od / 2).circle(od * 0.2).extrude(-t)
    comps = cq.Workplane('XY')
    for i, (x, z, w, h) in enumerate([(od * 0.22, 0, od * 0.16, 6), (-od * 0.22, od * 0.08, od * 0.12, 8),
                                      (0, -od * 0.3, od * 0.2, 5), (0, od * 0.3, od * 0.1, 10)]):
        comps = comps.union(cq.Workplane('XY').box(w, h, w * 0.7).translate((x, t + h / 2, z)))
    return b.union(comps).val()


def servo_drive(od: float, amps: float) -> PartDef:
    return PartDef(f'DRV-{od:g}', f'Integrated servo drive board {od:g}', _pcb_shape(od, 1.6), 'pcb', 'electrical',
                   'made to order', f'ring {od:g} mm', '', None,
                   'Runs the motor: field-oriented current control, safe torque off (STO) and an EtherCAT link.',
                   {'continuous current': f'{amps:g} A', 'bus': 'EtherCAT', 'safety': 'STO, SIL 2 / PL d'}, 'buy')


# ═════════════════════════════════════════════════════════════ linear motion ═══
# profile rail guide: size -> (rail w, rail h, block w, block h(total), block L, hole pitch, screw)
RAIL = {15: (15, 13, 34, 24, 61, 60, 4), 20: (20, 16.5, 44, 30, 77, 60, 5), 25: (23, 20, 48, 36, 84, 60, 6),
        30: (28, 23, 60, 42, 98, 80, 8)}


@lru_cache(maxsize=None)
def _rail_shape(size: int, L: float) -> cq.Shape:
    w, h, bw, bh, bl, pitch, sc = RAIL[size]
    r = cq.Workplane('XY').box(w, h, L, centered=(True, False, True))
    for s in (-1, 1):
        r = r.cut(cq.Workplane('XY').box(2.2, 2.0, L + 2, centered=(True, True, True)).translate((s * w / 2, h * 0.62, 0)))
    n = int(L // pitch)
    pts = [(0, -L / 2 + (L - (n - 1) * pitch) / 2 + i * pitch) for i in range(n)]
    r = r.faces('>Y').workplane().pushPoints(pts).cboreHole(HOLE[sc] - 0.5, HOLE[sc] * 1.75, h * 0.45)
    return r.val()


@lru_cache(maxsize=None)
def _block_shape(size: int) -> cq.Shape:
    w, h, bw, bh, bl, pitch, sc = RAIL[size]
    gap = 3.0
    b = cq.Workplane('XY').box(bw, bh - gap, bl * 0.78, centered=(True, False, True)).translate((0, gap, 0))
    b = b.cut(cq.Workplane('XY').box(w + 1.0, h + 1 - gap, bl, centered=(True, False, True)).translate((0, gap, 0)))
    ends = cq.Workplane('XY').box(bw * 0.94, bh - gap - 2, bl * 0.11, centered=(True, False, True)).translate((0, gap + 1, bl * 0.445)) \
        .union(cq.Workplane('XY').box(bw * 0.94, bh - gap - 2, bl * 0.11, centered=(True, False, True)).translate((0, gap + 1, -bl * 0.445)))
    ends = ends.cut(cq.Workplane('XY').box(w + 1.4, h + 1.4 - gap, bl * 1.2, centered=(True, False, True)).translate((0, gap, 0)))
    pts = [(sx * bw * 0.36, sz * bl * 0.26) for sx in (-1, 1) for sz in (-1, 1)]
    b = b.union(ends).faces('>Y').workplane().pushPoints(pts).hole(sc * 0.84, bh * 0.6)
    return b.val()


def rail(size: int, L: float) -> PartDef:
    return PartDef(f'RAIL{size}-{L:g}', f'Profile rail size {size} x {L:g}', _rail_shape(size, L), 'bearing', 'drive',
                   'catalogue part (ISO 12090-1 dims)', f'size {size}, L {L:g}', 'precision grade', None,
                   'Hardened guide rail. It carries the block in a straight line with no play.', {}, 'buy')


def rail_block(size: int) -> PartDef:
    return PartDef(f'BLK{size}', f'Profile rail block size {size}', _block_shape(size), 'steel', 'drive',
                   'catalogue part (ISO 12090-1 dims)', f'size {size}', 'preload Z1, wipers', None,
                   'Recirculating ball carriage. It runs on the rail and carries the moving stage.', {}, 'buy')


# ════════════════════════════════════════════════════════════ belts, pulleys ═══


@lru_cache(maxsize=None)
def _pulley_shape(z: int, pitch: float, w: float, bore: float) -> cq.Shape:
    pd = z * pitch / math.pi
    od = pd - 1.37 if pitch == 8 else pd - 1.14
    body = (cq.Workplane('XZ').polyline(_zigzag(od / 2 - pitch * 0.38, od / 2, z)).close()
            .extrude(w / 2, both=True))
    fl = cq.Workplane('XZ').circle(od / 2 + pitch * 0.6).extrude(1.0, both=True)
    body = body.union(fl.translate((0, w / 2 + 1, 0))).union(fl.translate((0, -w / 2 - 1, 0)))
    hub = cq.Workplane('XZ').circle(bore * 1.0 + 6).extrude(w / 2 + 6, both=True)
    return body.union(hub).cut(cq.Workplane('XZ').circle(bore / 2).extrude(w, both=True)).val()


def pulley(z: int, pitch: float, w: float, bore: float) -> PartDef:
    prof = f'HTD {pitch:g}M'
    return PartDef(f'PUL-{prof.replace(" ", "")}-{z}T-{w:g}', f'Timing pulley {prof} {z}T, {w:g} mm belt',
                   _pulley_shape(z, pitch, w, bore), 'al6061', 'drive', 'ISO 13050', f'{z} teeth, {prof}',
                   '', None, 'Drives the toothed belt with no slip.', {'pitch diameter': f'{z * pitch / math.pi:.1f} mm'}, 'buy')


@lru_cache(maxsize=None)
def _belt_shape(c: float, d1: float, d2: float, w: float, t: float) -> cq.Shape:
    """A closed belt over two pulleys of pitch diameters d1, d2, centres c apart along +X."""
    r1, r2 = d1 / 2, d2 / 2
    outer = (cq.Workplane('XZ').circle(r1 + t / 2).extrude(w / 2, both=True)
             .union(cq.Workplane('XZ').center(c, 0).circle(r2 + t / 2).extrude(w / 2, both=True))
             .union(cq.Workplane('XY').box(c, w, 2 * max(r1, r2) + t, centered=(False, True, True))))
    hull = cq.Workplane('XZ').polyline([(0, r1 + t / 2), (c, r2 + t / 2), (c, -r2 - t / 2), (0, -r1 - t / 2)]).close() \
        .extrude(w / 2, both=True)
    outer = (cq.Workplane('XZ').circle(r1 + t / 2).extrude(w / 2, both=True)
             .union(cq.Workplane('XZ').center(c, 0).circle(r2 + t / 2).extrude(w / 2, both=True)).union(hull))
    inner = (cq.Workplane('XZ').circle(r1 - t / 2).extrude(w, both=True)
             .union(cq.Workplane('XZ').center(c, 0).circle(r2 - t / 2).extrude(w, both=True))
             .union(cq.Workplane('XZ').polyline([(0, r1 - t / 2), (c, r2 - t / 2), (c, -r2 + t / 2), (0, -r1 + t / 2)]).close()
                    .extrude(w, both=True)))
    return outer.cut(inner).val()


def belt(pitch: float, w: float, c: float, d1: float, d2: float, fn: str = '') -> PartDef:
    length = 2 * c + math.pi * (d1 + d2) / 2
    prof = f'HTD {pitch:g}M'
    return PartDef(f'BELT-{prof.replace(" ", "")}-{w:g}-{length:.0f}', f'Timing belt {prof}, {w:g} mm, {length:.0f} mm',
                   _belt_shape(c, d1, d2, w, pitch * 0.65), 'rubber', 'drive', 'ISO 13050',
                   f'{prof}, {w:g} wide, {length:.0f} long', 'glass-fibre cords', None, fn, {}, 'buy')


# ═════════════════════════════════════════════════════════════ electrical, fluid ═══


@lru_cache(maxsize=None)
def _gland_shape(m: int) -> cq.Shape:
    s = {16: 20, 20: 24, 25: 30, 32: 39, 40: 50}[m]
    body = _hex(s, s * 0.32)
    dome = cq.Workplane('XZ', origin=(0, s * 0.32, 0)).circle(s * 0.46).workplane(offset=-s * 0.5).circle(s * 0.3).loft()
    thread = cq.Workplane('XZ').circle(m / 2).extrude(m * 0.45)
    return body.union(dome).union(thread).cut(cq.Workplane('XZ', origin=(0, s, 0)).circle(m * 0.28).extrude(s * 2)).val()


def gland(m: int, fn: str = '') -> PartDef:
    return PartDef(f'GLAND-M{m}', f'Cable gland M{m} x 1.5, IP68', _gland_shape(m), 'pa66', 'electrical',
                   'IEC 62444', f'M{m} x 1.5', 'IP68', None, fn or 'Seals the cable entry and holds the cable.', {}, 'buy')


@lru_cache(maxsize=None)
def _chain_link_shape(w: float, h: float, pitch: float) -> cq.Shape:
    side = cq.Workplane('XY').box(pitch, h, 3.0).edges('|Z').fillet(h * 0.3)      # links meet end to end at the pitch
    link = side.translate((0, 0, w / 2 - 1.5)).union(side.translate((0, 0, -w / 2 + 1.5)))
    bars = cq.Workplane('XY').box(pitch * 0.35, 3.0, w).translate((0, h / 2 - 1.5, 0)).union(
        cq.Workplane('XY').box(pitch * 0.35, 3.0, w).translate((0, -h / 2 + 1.5, 0)))
    return link.union(bars).val()


def chain_link(w: float, h: float, pitch: float) -> PartDef:
    return PartDef(f'ECHAIN-{w:g}x{h:g}', f'Cable carrier link {w:g} x {h:g}', _chain_link_shape(w, h, pitch), 'pa66',
                   'electrical', 'catalogue part', f'inner {w:g} x {h:g}, pitch {pitch:g}', '', None,
                   'Guides the cables and hoses through the moving joint. It keeps the bend radius safe.', {}, 'buy')


@lru_cache(maxsize=None)
def _tube_path_shape(points: tuple, r: float, ri: float) -> cq.Shape:
    pts = [Vector(*p) for p in points]
    path = cq.Workplane('XY').spline(pts, includeCurrent=False) if len(pts) > 2 else cq.Workplane('XY').polyline(pts)
    d = pts[1] - pts[0]
    plane = cq.Plane(origin=pts[0], xDir=_perp(d), normal=d)
    prof = cq.Workplane(plane).circle(r)
    if ri > 0:
        prof = prof.circle(ri)
    return prof.sweep(path, transition='round').val()


def _perp(d: Vector) -> Vector:
    a = Vector(1, 0, 0) if abs(d.normalized().x) < 0.9 else Vector(0, 1, 0)
    return d.cross(a).normalized()


def swept(pid: str, name: str, points: list[tuple[float, float, float]], r: float, mat: str, category: str,
          ri: float = 0.0, fn: str = '', spec: dict | None = None, standard: str = '', size: str = '',
          make: str = 'buy') -> PartDef:
    return PartDef(pid, name, _tube_path_shape(tuple(points), r, ri), mat, category, standard, size, '', None, fn,
                   spec or {}, make)


@lru_cache(maxsize=None)
def _nozzle_shape(kind: str) -> cq.Shape:
    # local -Y is the spray: the G 1/4 thread (y 0..+6) goes into the pipe wall, the hex body and tip stand outside it
    if kind == 'fan':
        thread = cq.Workplane('XZ').circle(5).extrude(-6)
        body = _hex(14, 9).translate((0, -9, 0))
        tip = cq.Workplane('XZ', origin=(0, -9, 0)).rect(9, 5).extrude(4)
        return thread.union(body).union(tip).val()
    thread = cq.Workplane('XZ').circle(6).extrude(-6)
    return thread.union(_hex(17, 10).translate((0, -10, 0))).val()


def nozzle(kind: str = 'fan', fn: str = '') -> PartDef:
    nm = {'fan': 'Flat-fan spray nozzle 1/4 in, 15 deg', 'jet': 'Solid-jet nozzle 1/4 in'}[kind]
    return PartDef(f'NOZ-{kind}', nm, _nozzle_shape(kind), 'ss316', 'fluid', 'ISO 228-1 thread', 'G 1/4',
                   '', None, fn, {'pressure': 'up to 70 bar'}, 'buy')


# ═════════════════════════════════════════════════════════════════ bolted joints ═══


def bolt_stack(model, node, sub: str, p: tuple[float, float, float], d: tuple[float, float, float], size: int, length: float,
               grip: float, grade: str = '8.8', nut_kind: str = 'nyloc', fn: str = '',
               explode: tuple[float, float, float] = (0, 0, 0), stainless: bool = False) -> None:
    """A through-bolted joint, as it is assembled: hex bolt, a washer under its head, the clamped parts (`grip` mm
    thick, starting at p and running along d), a washer, and a nut. p is the surface the head's washer bears on."""
    n = math.sqrt(sum(c * c for c in d))
    u = (d[0] / n, d[1] / n, d[2] / n)
    h = ISO7089[size][2]
    at = lambda k: (p[0] + u[0] * k, p[1] + u[1] * k, p[2] + u[2] * k)     # noqa: E731
    back = (-u[0], -u[1], -u[2])
    g = 'A4-70' if stainless else grade
    wmat = 'fast_a4' if stainless else 'fast_zn'
    model.place(node, hex_bolt(size, length, g, fn), orient(at(-h), u), explode, sub)
    model.place(node, washer(size, wmat), orient(p, u), explode, sub)
    if nut_kind:
        model.place(node, washer(size, wmat), orient(at(grip), back), explode, sub)
        model.place(node, nut(size, 'A4' if stainless else '8', nyloc=(nut_kind == 'nyloc')), orient(at(grip + h), back), explode, sub)
