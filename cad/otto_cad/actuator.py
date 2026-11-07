"""The robot joint actuator: one parametric module, built the way a cobot or light industrial joint is.

From the output face back (module frame: axis +Y = the output side, origin on the axis at the output
flange's outer face; the housing extends toward -Y):

    output flange   bolts to the next link; carries the cross-roller bearing's inner ring and the
                    flexspline's diaphragm
    cross-roller    one preloaded bearing takes every output load (radial, axial, tilt)
    flexspline      thin cup, closed end at the output, teeth at the open end
    circular spline rigid ring gear, bolted inside the housing; it does not turn
    wave generator  elliptical cam on the hollow motor shaft, inside the flexspline's teeth
    motor           frameless: stator bonded in the housing, rotor on the hollow shaft
    brake           spring-applied, power-off: the joint holds when power is lost
    encoders        motor side (commutation) and output side (true joint angle), absolute
    drive board     servo drive with safe torque off, then the rear cover and the cable gland

The parts that turn with the joint go into the MOVING node, the rest into the FIXED node, so the
viewer can pose the joint and the STEP keeps the same split. Explode vectors are in the module frame
and are rotated into each node's frame here.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import cadquery as cq
from cadquery import Location, Vector

from . import std
from .core import Model, Node, PartDef, loc


@dataclass(frozen=True)
class ActSize:
    size: int        # strain-wave gear size
    od: float        # housing outer diameter, mm
    mot_od: float    # stator OD
    mot_l: float     # stator stack length
    brk_od: float
    brk_l: float
    xrb: tuple[float, float, float]   # cross-roller d, D, B
    shaft: str       # motor shaft bearing code (thin section)
    of_t: float      # output flange thickness
    out_bolt: int    # output flange screw size (to the next link)
    out_n: int
    mot_t: float     # motor continuous torque, N m
    mot_kw: float
    brk_t: float     # brake holding torque (motor side), N m
    amps: float


SIZES: dict[int, ActSize] = {
    50: ActSize(50, 262, 182, 62, 150, 40, (150, 214, 28), '6816', 16, 10, 16, 6.5, 1.5, 9.0, 32),
    40: ActSize(40, 214, 150, 52, 124, 34, (120, 174, 24), '6814', 14, 8, 16, 4.0, 1.0, 5.5, 22),
    32: ActSize(32, 178, 124, 44, 104, 30, (96, 144, 20), '6812', 12, 8, 12, 2.4, 0.7, 3.5, 15),
    25: ActSize(25, 140, 98, 36, 82, 26, (70, 112, 16), '6810', 10, 6, 12, 1.3, 0.4, 2.0, 9),
    20: ActSize(20, 116, 80, 30, 66, 22, (56, 92, 14), '6808', 9, 6, 8, 0.8, 0.25, 1.2, 6),
    17: ActSize(17, 100, 68, 26, 56, 20, (48, 78, 12), '6806', 8, 5, 8, 0.5, 0.15, 0.8, 4),
}


def _rot(T: Location, v: tuple[float, float, float]) -> tuple[float, float, float]:
    from OCP.gp import gp_Vec
    w = gp_Vec(*v).Transformed(T.wrapped.Transformation())
    return (w.X(), w.Y(), w.Z())


def module_length(s: ActSize) -> float:
    g = std.swg_dims(s.size)
    return s.of_t + g['fs_len'] + 6 + s.mot_l + 6 + s.brk_l + 12 + 10 + 8


def rear_od(s: ActSize) -> float:
    return max(s.mot_od + 18, s.brk_od + 22)


def _housing(s: ActSize, pid: str, L: float) -> cq.Shape:
    g = std.swg_dims(s.size)
    xd, xD, xB = s.xrb
    y_front = -s.of_t - xB          # the housing's front face: the bearing's outer ring sits on it
    y_back = -L + 8
    y_cs = -s.of_t - g['fs_len']
    ro = rear_od(s)
    # front drum (bearing and gear ring) at the full OD, a cone, then the motor bell at the rear OD
    front = cq.Workplane('XZ', origin=(0, y_front, 0)).circle(s.od / 2).extrude(y_front - y_cs + 4)
    cone = (cq.Workplane('XZ', origin=(0, y_cs - 4, 0)).circle(s.od / 2)
            .workplane(offset=(s.od - ro) * 0.35).circle(ro / 2).loft())
    bell = cq.Workplane('XZ', origin=(0, y_cs - 4 - (s.od - ro) * 0.35, 0)).circle(ro / 2) \
        .extrude(y_cs - 4 - (s.od - ro) * 0.35 - y_back)
    body = front.union(cone).union(bell)
    # bore: bearing seat, gear cavity, motor seat, rear bay
    bore = cq.Workplane('XZ', origin=(0, y_front + 1, 0)).circle(g['cs_od'] / 2 + 1).extrude(g['fs_len'] - g['cs_w'] + 1)
    body = body.cut(bore)
    y_cs = -s.of_t - g['fs_len']
    gear = cq.Workplane('XZ', origin=(0, y_cs + g['cs_w'], 0)).circle(g['cs_id'] / 2 + 2).extrude(g['cs_w'])
    body = body.cut(gear)
    motor = cq.Workplane('XZ', origin=(0, y_cs, 0)).circle(s.mot_od / 2).extrude(y_cs - y_back - 1)
    body = body.cut(motor)
    # the front drum is hollow round the gear cavity: a ring of pockets keeps the wall at ~7 mm
    body = body.cut(cq.Workplane('XZ', origin=(0, y_front - 10, 0)).circle(s.od / 2 - 7).circle(g['cs_od'] / 2 + 7)
                    .extrude(y_front - 10 - (y_cs + 6)))
    # cooling fins round the motor bell
    for k in range(6):
        y = y_cs - 14 - (s.od - ro) * 0.35 - k * (s.mot_l / 6)
        body = body.cut(cq.Workplane('XZ', origin=(0, y, 0)).circle(ro / 2 + 1).circle(ro / 2 - 2.5).extrude(2.5))
    # tapped holes for the cross-roller's outer-ring screws on the front face
    n = 12 if s.size >= 32 else 8
    pts = [(p[0], p[2]) for p in std.circle_points(n, (xD + s.od) / 4, 'y', start=180 / n)]
    body = body.faces('>Y').workplane().pushPoints(pts).hole(s.out_bolt * 0.85, 22)
    return body.val()


def _output_flange(s: ActSize) -> cq.Shape:
    xd, xD, xB = s.xrb
    od = xd + (xD - xd) * 0.55
    fl = cq.Workplane('XZ', origin=(0, 0, 0)).circle(od / 2).extrude(s.of_t)   # y from 0 down to -of_t
    hub = cq.Workplane('XZ', origin=(0, -s.of_t, 0)).circle(xd / 2).circle(xd / 2 - 8).extrude(xB)
    fl = fl.union(hub).cut(cq.Workplane('XZ').circle(od * 0.18).extrude(s.of_t + xB))  # cable bore
    pts = [(p[0], p[2]) for p in std.circle_points(s.out_n, od / 2 - s.out_bolt * 1.5, 'y')]
    fl = fl.faces('>Y').workplane().pushPoints(pts).hole(s.out_bolt * 0.85, s.of_t * 0.9)
    pins = [(p[0], p[2]) for p in std.circle_points(2, od / 2 - s.out_bolt * 1.5, 'y', start=360 / s.out_n / 2)]
    fl = fl.faces('>Y').workplane().pushPoints(pins).hole(s.out_bolt, s.of_t * 0.6)
    return fl.faces('>Y').edges().chamfer(1.0).val()


def _shaft(s: ActSize, L: float) -> cq.Shape:
    d, D, B = std.DGBB[s.shaft]
    g = std.swg_dims(s.size)
    y0 = -s.of_t - g['fs_len'] + g['wg_w'] / 2
    y1 = -L + 22
    sh = cq.Workplane('XZ', origin=(0, y0, 0)).circle(d / 2).circle(d / 2 - 3.5).extrude(y0 - y1)
    collar = cq.Workplane('XZ', origin=(0, y0 - g['wg_w'] - 2, 0)).circle(d / 2 + 3).circle(d / 2 - 3.5).extrude(3)
    return sh.union(collar).val()


def _cover(s: ActSize) -> cq.Shape:
    ro = rear_od(s)
    c = cq.Workplane('XZ').circle(ro / 2).extrude(8).faces('<Y').edges().chamfer(1.5)
    c = c.faces('<Y').workplane().rect(ro * 0.32, ro * 0.18).cutBlind(-1.2)  # label recess
    pts = [(p[0], p[2]) for p in std.circle_points(8, ro / 2 - 9, 'y', start=22.5)]
    return c.faces('>Y').workplane().pushPoints(pts).hole(5.5).val()


def _stator_ring(s: ActSize) -> cq.Shape:
    return (cq.Workplane('XZ').circle(s.mot_od / 2).circle(s.mot_od / 2 - 7).extrude(5)
            .faces('>Y').workplane().pushPoints([(p[0], p[2]) for p in std.circle_points(6, s.mot_od / 2 - 3.5, 'y')])
            .hole(5.5).val())


def _fs_clamp(s: ActSize) -> cq.Shape:
    g = std.swg_dims(s.size)
    return cq.Workplane('XZ').circle(g['fs_hub'] * 0.45).circle(g['fs_hub'] * 0.24).extrude(-6).val()


def build_actuator(m: Model, fixed: Node, moving: Node, size: int, T_joint: Location, T_mod: Location,
                   prefix: str, sub: str, *, gland_m: int = 20, explode_out: float = 1.0) -> dict:
    """Place one actuator. Moving parts go in `moving` (a node at T_joint in `fixed`), placed by T_mod;
    fixed parts go in `fixed`, placed by T_joint * T_mod. Returns the key dimensions."""
    s = SIZES[size]
    g = std.swg_dims(size)
    L = module_length(s)
    xd, xD, xB = s.xrb
    Tf = T_joint * T_mod
    E = explode_out

    def put(node, T, pd, at, ex):
        m.place(node, pd, T * at, _rot(T, tuple(c * E for c in ex)), sub)

    fix = lambda pd, at=Location(), ex=(0, 0, 0): put(fixed, Tf, pd, at, ex)   # noqa: E731
    mov = lambda pd, at=Location(), ex=(0, 0, 0): put(moving, T_mod, pd, at, ex)  # noqa: E731

    # ── housing (fixed) ─────────────────────────────────────────────────────────
    hsg = m.part(PartDef(f'{prefix}-HSG', f'{prefix} actuator housing', _housing(s, prefix, L), 'a356_dark',
                         'structure', 'machined casting', f'OD {s.od:g} x {L - s.of_t - xB - 8:.0f}', '', None,
                         'Holds the motor, the gear ring and the bearing in line. Fins carry the motor heat out.',
                         {'IP rating': 'IP65', 'machining': 'bores to H7, faces flat to 0.02'}, 'make'))
    fix(hsg)
    # ── cross-roller bearing (fixed outer ring) + its screws ───────────────────
    xrb = std.cross_roller(xd, xD, xB)
    fix(xrb, loc(0, -s.of_t - xB / 2, 0), (0, 70, 0))
    n_xrb = 12 if size >= 32 else 8
    sc = std.shcs(s.out_bolt, round(xB + 18), '12.9', 'Clamps the bearing outer ring to the housing.')
    for p in std.circle_points(n_xrb, (xD + s.od) / 4, 'y', offset=-s.of_t, start=180 / n_xrb):
        fix(sc, std.orient(p, (0, -1, 0)), (0, 110, 0))
    # ── circular spline (fixed) + screws ─────────────────────────────────────────
    cs, fs, wg = std.strain_wave(size)
    y_cs = -s.of_t - g['fs_len'] + g['cs_w'] / 2
    fix(cs, loc(0, y_cs, 0), (0, -40, 0))
    csb = std.shcs(g['cs_bolt'], round(g['cs_w'] + 12), '12.9', 'Fixes the ring gear in the housing.')
    for p in std.circle_points(g['cs_n'], g['cs_bc'] / 2, 'y', offset=y_cs + g['cs_w'] / 2, start=180 / g['cs_n']):
        fix(csb, std.orient(p, (0, -1, 0)), (0, -20, 0))
    # ── output side (moving): flange, flexspline, clamp ring, screws, dowels, seal ──
    of = m.part(PartDef(f'{prefix}-OUT', f'{prefix} output flange', _output_flange(s), 'al6061', 'structure',
                        'machined', f'OD {xd + (xD - xd) * 0.55:.0f} x {s.of_t:g}', '', None,
                        'Carries the next link. It turns on the bearing inner ring.', {}, 'make'))
    mov(of, Location(), (0, 160, 0))
    mov(fs, loc(0, -s.of_t - 2, 0, rx=180), (0, 120, 0))
    clamp = m.part(PartDef(f'{prefix}-FSC', f'{prefix} flexspline clamp ring', _fs_clamp(s), 'steel', 'drive',
                           'machined', f'size {size}', '', None,
                           'Spreads the screw load over the thin flexspline diaphragm.', {}, 'make'))
    mov(clamp, loc(0, -s.of_t - 2 - std.swg_dims(size)['fs_wall'] * 4 - 6, 0), (0, 60, 0))
    fsb_d = g['cs_bolt'] - (1 if g['cs_bolt'] <= 6 else 2) if g['cs_bolt'] > 4 else 3
    fsb_d = {4: 4, 5: 5, 6: 6, 7: 6, 8: 8}.get(fsb_d, 6)
    fsb = std.shcs(fsb_d, round(s.of_t + 14), '12.9', 'Fastens the flexspline and its clamp ring to the output flange.')
    for p in std.circle_points(8 if size <= 20 else 12, g['fs_hub'] * 0.36, 'y', offset=0):
        mov(fsb, std.orient(p, (0, -1, 0)), (0, 200, 0))
    seal = std.lip_seal(xd - 16, xd + 4, 8 if size >= 32 else 6)
    fix(seal, loc(0, -s.of_t - xB + 0.5, 0, rx=180), (0, 50, 0))
    orf = std.oring(round(s.od - 20), 2.5 if size >= 32 else 2.0)
    fix(orf, loc(0, -s.of_t - xB - 1.2, 0), (0, 40, 0))
    # ── wave generator, motor shaft and its bearings (fixed frame: they turn 100x, not the joint) ──
    y_wg = -s.of_t - g['fs_len'] + g['cs_w'] * 0.45
    fix(wg, loc(0, y_wg, 0), (0, -70, 0))
    shaft = m.part(PartDef(f'{prefix}-SHF', f'{prefix} hollow motor shaft', _shaft(s, L), 'steel', 'drive', 'machined',
                           f'{std.DGBB[s.shaft][0]} x {L * 0.7:.0f}', '', None,
                           'Carries the rotor and the wave generator. Cables pass through its bore.', {}, 'make'))
    fix(shaft, Location(), (0, -110, 0))
    brg = std.ball_bearing(s.shaft, 'Supports the motor shaft.')
    sd, sD, sB = std.DGBB[s.shaft]
    y_m = -s.of_t - g['fs_len'] - 6
    fix(brg, loc(0, y_m + sB / 2, 0), (0, -95, 0))
    fix(brg, loc(0, y_m - s.mot_l - 6 - sB / 2, 0), (0, -150, 0))
    ring = std.circlip(sd, False)
    fix(ring, loc(0, y_m - s.mot_l - 6 - sB - 1.5, 0), (0, -160, 0))
    # ── motor ────────────────────────────────────────────────────────────────────
    st, wd, ro = std.frameless_motor(s.mot_od - 2, s.mot_l, s.mot_kw, s.mot_t)
    yc = y_m - s.mot_l / 2
    fix(st, loc(0, yc, 0), (0, -130, 0))
    fix(wd, loc(0, yc, 0), (0, -130, 0))
    fix(ro, loc(0, yc, 0), (0, -185, 0))
    sr = m.part(PartDef(f'{prefix}-STR', f'{prefix} stator retaining ring', _stator_ring(s), 'al6061', 'structure',
                        'machined', f'OD {s.mot_od:g}', '', None, 'Holds the stator against its shoulder.', {}, 'make'))
    y_sr = y_m - s.mot_l - 1
    fix(sr, loc(0, y_sr, 0), (0, -200, 0))
    srb = std.shcs(5, 12, '12.9', 'Fastens the stator retaining ring.')
    for p in std.circle_points(6, s.mot_od / 2 - 3.5, 'y', offset=y_sr):
        fix(srb, std.orient(p, (0, 1, 0)), (0, -215, 0))
    # ── brake ────────────────────────────────────────────────────────────────────
    bk = std.brake(s.brk_od, s.brk_l, s.brk_t)
    y_b = y_m - s.mot_l - 6
    fix(bk, loc(0, y_b - s.brk_l * 0.62, 0), (0, -240, 0))
    bkb = std.shcs(4 if size <= 25 else 5, round(s.brk_l * 0.62 + 8), '8.8', 'Fastens the brake body.')
    for p in std.circle_points(3, s.brk_od * 0.42, 'y', offset=y_b - s.brk_l * 0.62, start=30):
        fix(bkb, std.orient(p, (0, 1, 0)), (0, -255, 0))
    # ── encoders, drive board, cover ────────────────────────────────────────────
    y_e = y_b - s.brk_l - 2
    ro = rear_od(s)
    fix(std.encoder(round(ro * 0.55), 'motor'), loc(0, y_e, 0), (0, -280, 0))
    fix(std.encoder(round(ro * 0.7), 'output'), loc(0, y_e - 6, 0), (0, -300, 0))
    eb = std.shcs(3, 8, '8.8', 'Fastens the encoder read head.')
    for i, r in enumerate((ro * 0.275, ro * 0.35)):
        for dx in (-5, 5):
            fix(eb, std.orient((r, y_e - 6 * i + 6, dx), (0, -1, 0)), (0, -290 - 10 * i, 0))
    drv = std.servo_drive(round(ro - 14), s.amps)
    y_d = y_e - 14
    fix(drv, loc(0, y_d, 0), (0, -330, 0))
    pb = std.shcs(3, 6, '8.8', 'Fastens the drive board to its standoffs.')
    for p in std.circle_points(4, (ro - 14) * 0.36, 'y', offset=y_d + 1.6, start=45):
        fix(pb, std.orient(p, (0, -1, 0)), (0, -335, 0))
    cov = m.part(PartDef(f'{prefix}-COV', f'{prefix} rear cover', _cover(s), 'al6061_blk', 'structure', 'machined',
                         f'OD {s.od:g} x 8', '', None, 'Closes the rear of the actuator. The O-ring seals it.', {}, 'make'))
    y_c = -L + 8
    fix(cov, loc(0, y_c, 0, rx=180), (0, -380, 0))
    fix(std.oring(round(ro - 24), 2.0), loc(0, y_c + 0.5, 0), (0, -360, 0))
    cb = std.bhcs(5, 14, 'A2-70', 'Fastens the rear cover.')
    for p in std.circle_points(8, ro / 2 - 9, 'y', offset=y_c - 8, start=22.5):
        fix(cb, std.orient(p, (0, 1, 0)), (0, -400, 0))
    gl = std.gland(gland_m, 'Seals the motor power, the safety signal and the EtherCAT cable into the actuator.')
    fix(gl, std.orient((ro * 0.22, y_c - 8, 0), (0, 1, 0)), (0, -420, 0))
    return {'L': L, 'od': s.od, 'rear_od': ro, 'y_front': -s.of_t - xB, 'y_back': -L,
            'of_od': xd + (xD - xd) * 0.55, 'size': s}


def out_flange_points(size: int) -> list[tuple[float, float, float]]:
    """The output flange's screw points (module frame, on its outer face)."""
    s = SIZES[size]
    xd, xD, _ = s.xrb
    od = xd + (xD - xd) * 0.55
    return std.circle_points(s.out_n, od / 2 - s.out_bolt * 1.5, 'y')


def front_ring_points(size: int, n: int = 8) -> list[tuple[float, float, float]]:
    """Screw points on the housing's front drum, for a saddle that clamps the housing (module frame)."""
    s = SIZES[size]
    return std.circle_points(n, s.od / 2 - 12, 'y', offset=-s.of_t - s.xrb[2] - 6, start=180 / n)
