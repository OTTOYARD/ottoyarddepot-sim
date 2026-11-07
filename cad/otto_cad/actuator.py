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


STD_LEN = (3, 4, 5, 6, 8, 10, 12, 16, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 80, 90, 100)


def _std_len(lo: float, hi: float) -> float:
    """The longest standard screw length in [lo, hi] (or the shortest above lo)."""
    fit = [L for L in STD_LEN if lo <= L <= hi]
    return fit[-1] if fit else next(L for L in STD_LEN if L >= lo)


def _ring(y_top: float, y_bot: float, r_out: float, r_in: float = 0.0) -> cq.Workplane:
    """A solid (or an annulus) on the axis from y_top down to y_bot."""
    w = cq.Workplane('XZ', origin=(0, y_top, 0)).circle(r_out)
    if r_in > 0:
        w = w.circle(r_in)
    return w.extrude(y_top - y_bot)


def stack(s: ActSize) -> dict:
    """Every station of the module along its axis (module frame: y = 0 the output face, the housing toward -Y), from
    each part's own extent. Nothing shares axial space unless it is radially clear of it (the CAD's clash check)."""
    g = std.swg_dims(s.size)
    xd, xD, xB = s.xrb
    sd, sD, sB = std.DGBB[s.shaft]
    st: dict = {'g': g, 'sd': sd, 'sD': sD, 'sB': sB}
    st['y_front'] = -(s.of_t + xB)                       # the housing front face; the bearing outer ring stands on it
    st['fs_top'] = -(s.of_t + 2)                         # the flexspline diaphragm, under the output flange
    st['fs_bot'] = st['fs_top'] - g['fs_len']            # its open end, with the teeth
    st['teeth'] = st['fs_bot'] + 0.4 * g['cs_w']         # the mesh: ring gear and wave generator centred on it
    st['cs_top'] = st['teeth'] + g['cs_w'] / 2
    st['y_g'] = min(st['fs_bot'], st['teeth'] - g['cs_w'] / 2)   # the gear cavity floor; the ring gear sits on it
    st['w1_bot'] = st['y_g'] - (sB + 4)                  # web 1: the front motor-shaft bearing
    st['b1'] = st['y_g'] - 2 - sB / 2
    od_m = s.mot_od - 2                                  # the stator, bonded in its bore
    r_wd, reach = std.winding_reach(od_m)
    st['od_m'], st['r_wd'] = od_m, r_wd
    st['st_top'] = st['w1_bot'] - reach - 0.5
    st['st_bot'] = st['st_top'] - s.mot_l
    st['yc'] = (st['st_top'] + st['st_bot']) / 2
    st['w2_top'] = st['st_bot'] - reach - 0.5            # web 2: the rear bearing; the brake screws to it
    st['w2_bot'] = st['w2_top'] - (sB + 4)
    st['b2'] = st['w2_top'] - 2 - sB / 2
    st['brk_top'] = st['w2_bot']
    st['brk_bot'] = st['brk_top'] - s.brk_l
    st['e1'] = st['brk_bot'] - 9                         # motor encoder: its read head screws up to the brake end plate
    st['e2'] = st['e1'] - 10                             # multi-turn encoder below it, read head on the far side
    st['shaft_bot'] = st['e2'] - 1
    # the rear bay: the brake and the read heads inside it, the drive board on a ledge below them
    enc1 = enc2 = max(round(od_m * 0.62), sd + 14)
    head_r = lambda od: math.hypot(od / 2 - 4 + od * 0.18 + 10, 8)   # noqa: E731  (std._encoder_shape's head)
    st['enc'] = (enc1, enc2)
    st['plate_r'] = max(s.brk_od / 2, head_r(enc1) + 1, head_r(enc2) + 1)   # the brake end plate carries both read heads
    st['r_bay'] = st['plate_r'] + 0.6
    st['r_drv'] = st['r_bay'] + 3.5                      # the board's rim rests on a 3.5 mm ledge
    st['drv_top'] = st['e2'] - 4                         # room for the read-head screw heads
    st['drv_bot'] = st['drv_top'] - 12                   # the board and its parts (they face the cover)
    st['r_bay_b'] = st['r_drv'] + 0.5
    st['r_bell'] = max(st['r_bay_b'] + 9.5, od_m / 2 + 7)
    st['y_back'] = st['drv_bot'] - 2
    st['L'] = -(st['y_back'] - 8)
    st['y_drum'] = st['y_g'] - 4                         # the front drum's end: the shoulder
    return st


def module_length(s: ActSize) -> float:
    return stack(s)['L']


def rear_od(s: ActSize) -> float:
    return 2 * stack(s)['r_bell']


def _housing(s: ActSize, st: dict) -> cq.Shape:
    g = st['g']
    xd, xD, xB = s.xrb
    y_front, y_back = st['y_front'], st['y_back']
    ro = st['r_bell']
    y_drum = st['y_g'] - 4                               # the front drum covers the gear and web 1
    front = _ring(y_front, y_drum, s.od / 2)             # then a flat shoulder down to the bell: the actuator can seat on it
    bell = _ring(y_drum, y_back, ro)
    body = front.union(bell)
    # bores, front to back: gear cavity (the ring gear's seat), web 1, winding, stator, winding, web 2, rear bay
    cav = [(y_front + 1, st['y_g'], g['cs_od'] / 2),
           (st['y_g'], st['w1_bot'], st['sD'] / 2),
           (st['w1_bot'], st['st_top'], st['r_wd'] + 1),
           (st['st_top'], st['w2_top'], st['od_m'] / 2),
           (st['w2_top'], st['w2_bot'], st['sD'] / 2),
           (st['w2_bot'], st['drv_top'], st['r_bay']),
           (st['drv_top'], y_back - 1, st['r_bay_b'])]
    for (a, b, r) in cav:
        body = body.cut(_ring(a, b, r))
    # cooling fins round the stator
    for k in range(6):
        y = st['st_top'] - 4 - k * (s.mot_l - 8) / 5
        body = body.cut(_ring(y, y - 2.5, ro + 1, ro - 2.5))
    # tapped holes for the bearing clamp ring's screws on the front face, and the O-ring groove under the outer ring
    n = 12 if s.size >= 32 else 8
    pts = [(p[0], p[2]) for p in std.circle_points(n, (xD + s.od) / 4, 'y', start=180 / n)]
    body = body.faces('>Y').workplane().pushPoints(pts).hole(s.out_bolt * 0.85, 22)
    rc = xD / 2 - 4
    body = body.cut(_ring(y_front + 0.1, y_front - 1.9, rc + 1.6, rc - 1.6))
    # the rear cover's O-ring groove is in the cover; its screws are tapped into the rim
    pts = [(p[0], p[2]) for p in std.circle_points(8, st['r_bay_b'] + 6, 'y', start=22.5)]
    body = body.faces('<Y').workplane().pushPoints(pts).hole(4.2, 12)
    return body.val()


def _output_flange(s: ActSize) -> cq.Shape:
    xd, xD, xB = s.xrb
    g = std.swg_dims(s.size)
    od = xd + (xD - xd) * 0.55
    fl = _ring(0, -s.of_t, od / 2)
    hub = _ring(-s.of_t, -s.of_t - xB, xd / 2, max(xd / 2 - 8, g['fs_od'] / 2 + 0.5))
    fl = fl.union(hub).cut(_ring(1, -s.of_t - 1, g['fs_hub'] * 0.22))       # cable bore, the size of the flexspline's
    pts = [(p[0], p[2]) for p in std.circle_points(s.out_n, od / 2 - s.out_bolt * 1.5, 'y')]
    fl = fl.faces('>Y').workplane().pushPoints(pts).hole(s.out_bolt * 0.85, s.of_t * 0.9)
    pins = [(p[0], p[2]) for p in std.circle_points(2, od / 2 - s.out_bolt * 1.5, 'y', start=360 / s.out_n / 2)]
    fl = fl.faces('>Y').workplane().pushPoints(pins).hole(s.out_bolt, s.of_t * 0.6)
    # counterbores for the flexspline screws: their heads stand below the output face
    n, d, r = std.fs_screws(s.size)
    dk, k, _ = std.ISO4762[d]
    pts = [(p[0], p[2]) for p in std.circle_points(n, r, 'y')]
    fl = fl.faces('>Y').workplane().pushPoints(pts).cboreHole(std.HOLE[d], dk + 1, k + 0.2)
    return fl.val()


def _clamp_ring(s: ActSize) -> cq.Shape:
    """Clamps the cross-roller bearing's outer ring to the housing: a flange over the ring and a skirt round it."""
    xd, xD, xB = s.xrb
    top = _ring(-s.of_t + 4, -s.of_t, s.od / 2, xD / 2 - 6)
    skirt = _ring(-s.of_t, -s.of_t - xB, s.od / 2, xD / 2)
    n = 12 if s.size >= 32 else 8
    pts = [(p[0], p[2]) for p in std.circle_points(n, (xD + s.od) / 4, 'y', start=180 / n)]
    return top.union(skirt).faces('>Y').workplane().pushPoints(pts).hole(std.HOLE[s.out_bolt]).val()


def _shaft(s: ActSize, st: dict) -> cq.Shape:
    g = st['g']
    d = st['sd']
    y0 = st['teeth'] + g['wg_w'] / 2
    sh = _ring(y0, st['shaft_bot'], d / 2, d / 2 - 3.5)
    collar = _ring(st['teeth'] - g['wg_w'] / 2, st['teeth'] - g['wg_w'] / 2 - 3, d / 2 + 3, d / 2 - 3.5)
    return sh.union(collar).val()


def _cover(s: ActSize, st: dict, gland_m: int, gland_ang: float = 0.0, gland_r: float = 0.44) -> cq.Shape:
    """The rear cover, outside the housing (y from y_back down 8): an O-ring groove in its face, 8 screw holes, the gland."""
    ro = st['r_bell']
    yb = st['y_back']
    c = _ring(yb, yb - 8, ro)
    c = c.cut(cq.Workplane('XY').box(ro * 0.64, 1.2, ro * 0.36).translate((-ro * 0.2, yb - 8 + 0.6, 0)))   # label recess
    r_or = st['r_bay_b'] + 2.2
    c = c.cut(_ring(yb + 0.1, yb - 1.6, r_or + 1.3, r_or - 1.3))
    pts = [(p[0], p[2]) for p in std.circle_points(8, st['r_bay_b'] + 6, 'y', start=22.5)]
    c = c.faces('<Y').workplane().pushPoints(pts).hole(5.5)
    ga = math.radians(gland_ang)
    c = c.cut(cq.Workplane('XZ', origin=(ro * gland_r * math.cos(ga), yb + 1, ro * gland_r * math.sin(ga))).circle(gland_m / 2).extrude(10))
    return c.val()


def _stator_ring(s: ActSize, st: dict) -> cq.Shape:
    r_out = st['od_m'] / 2
    r_in = max(r_out - 7, st['r_wd'] + 0.5)
    return _ring(st['st_bot'], st['st_bot'] - 5, r_out, r_in).val()


def _fs_clamp(s: ActSize) -> cq.Shape:
    g = std.swg_dims(s.size)
    n, d, r = std.fs_screws(s.size)
    ring = cq.Workplane('XZ').circle(g['fs_hub'] * 0.45).circle(g['fs_hub'] * 0.22).extrude(-6)
    pts = [(p[0], p[2]) for p in std.circle_points(n, r, 'y')]
    return ring.faces('>Y').workplane().pushPoints(pts).hole(d * 0.84, 6).val()


def build_actuator(m: Model, fixed: Node, moving: Node, size: int, T_joint: Location, T_mod: Location,
                   prefix: str, sub: str, *, gland_m: int = 20, explode_out: float = 1.0, gland_ang: float = 0.0,
                   gland_r: float = 0.44) -> dict:
    """Place one actuator. Moving parts go in `moving` (a node at T_joint in `fixed`), placed by T_mod;
    fixed parts go in `fixed`, placed by T_joint * T_mod. Returns the key dimensions."""
    s = SIZES[size]
    st = stack(s)
    g = st['g']
    L = st['L']
    xd, xD, xB = s.xrb
    sd, sD, sB = st['sd'], st['sD'], st['sB']
    Tf = T_joint * T_mod
    jl = prefix.split('-')[-1]          # 'CHG-J2' -> 'J2': the id keeps the robot, the name says the joint
    E = explode_out

    def put(node, T, pd, at, ex):
        m.place(node, pd, T * at, _rot(T, tuple(c * E for c in ex)), sub)

    fix = lambda pd, at=Location(), ex=(0, 0, 0): put(fixed, Tf, pd, at, ex)   # noqa: E731
    mov = lambda pd, at=Location(), ex=(0, 0, 0): put(moving, T_mod, pd, at, ex)  # noqa: E731

    # ── housing (fixed) ─────────────────────────────────────────────────────────
    hsg = m.part(PartDef(f'{prefix}-HSG', f'{jl} actuator housing', _housing(s, st), 'a356_dark',
                         'structure', 'machined casting', f'OD {s.od:g} x {-st["y_back"] + st["y_front"]:.0f}', '', None,
                         'Holds the gear ring, the motor and both shaft bearings in line. Fins carry the motor heat out.',
                         {'IP rating': 'IP65', 'machining': 'bores to H7, faces flat to 0.02'}, 'make'))
    fix(hsg)
    # ── cross-roller bearing (outer ring fixed) and the ring that clamps it ────
    fix(std.cross_roller(xd, xD, xB), loc(0, -s.of_t - xB / 2, 0), (0, 70, 0))
    cr = m.part(PartDef(f'{prefix}-XCR', f'{jl} bearing clamp ring', _clamp_ring(s), 'al6061', 'structure', 'machined',
                        f'OD {s.od:g}', '6061-T6', None, 'Clamps the bearing outer ring to the housing. The output seal sits in its bore.',
                        {}, 'make'))
    fix(cr, Location(), (0, 90, 0))
    n_xrb = 12 if size >= 32 else 8
    sc = std.bhcs(s.out_bolt, _std_len(4 + xB + 1.2 * s.out_bolt - 4, 4 + xB + 1.5 * s.out_bolt), '10.9',
                  'Clamps the bearing outer ring to the housing through the clamp ring.')
    for p in std.circle_points(n_xrb, (xD + s.od) / 4, 'y', offset=-s.of_t + 4, start=180 / n_xrb):
        fix(sc, std.orient(p, (0, -1, 0)), (0, 110, 0))
    seal_d = round(xd + (xD - xd) * 0.55, 1)            # the lip runs on the flange's rim
    fix(std.lip_seal(seal_d, xD - 12, 6, 'Seals the turning output flange against the clamp ring (IP65).'),
        loc(0, -s.of_t, 0), (0, 50, 0))
    cs_or = 2.5 if size >= 32 else 2.0
    fix(std.oring(round(xD - 8 - cs_or), cs_or, 'Seals the bearing outer ring to the housing face.'),
        loc(0, st['y_front'] - 1.9 + cs_or / 2, 0), (0, 40, 0))
    # ── circular spline (fixed) + screws ─────────────────────────────────────────
    cs, fs, wg = std.strain_wave(size, bore=sd)
    fix(cs, loc(0, st['teeth'], 0), (0, -40, 0))
    csb = std.shcs(g['cs_bolt'], _std_len(g['cs_w'] + 1.2 * g['cs_bolt'], g['cs_w'] + sB + 3), '12.9',
                   'Fixes the ring gear in the housing.')
    for p in std.circle_points(g['cs_n'], g['cs_bc'] / 2, 'y', offset=st['cs_top'], start=180 / g['cs_n']):
        fix(csb, std.orient(p, (0, -1, 0)), (0, -20, 0))
    # ── output side (moving): flange, flexspline, its clamp ring and screws ─────
    of = m.part(PartDef(f'{prefix}-OUT', f'{jl} output flange', _output_flange(s), 'al6061', 'structure',
                        'machined', f'OD {xd + (xD - xd) * 0.55:.0f} x {s.of_t:g}', '', None,
                        'Carries the next link. It turns on the bearing inner ring.', {}, 'make'))
    mov(of, Location(), (0, 160, 0))
    mov(fs, loc(0, st['fs_top'], 0, rx=180), (0, 120, 0))
    clamp = m.part(PartDef(f'{prefix}-FSC', f'{jl} flexspline clamp ring', _fs_clamp(s), 'steel', 'drive',
                           'machined', f'size {size}', '', None,
                           'Spreads the screw load over the thin flexspline diaphragm.', {}, 'make'))
    y_hub = st['fs_top'] - g['fs_wall'] * 4
    mov(clamp, loc(0, y_hub - 6, 0), (0, 60, 0))
    n_fs, d_fs, r_fs = std.fs_screws(size)
    k_fs = std.ISO4762[d_fs][1]
    grip = s.of_t - k_fs - 0.2 + 2 + g['fs_wall'] * 4
    fsb = std.shcs(d_fs, _std_len(grip + 0.8 * d_fs, grip + 6), '12.9',
                   'Fastens the flexspline and its clamp ring to the output flange.')
    for p in std.circle_points(n_fs, r_fs, 'y', offset=-k_fs - 0.2):
        mov(fsb, std.orient(p, (0, -1, 0)), (0, 200, 0))
    # ── wave generator, motor shaft and its bearings (they turn 100x, not the joint: fixed frame here) ──
    fix(wg, loc(0, st['teeth'], 0), (0, -70, 0))
    shaft = m.part(PartDef(f'{prefix}-SHF', f'{jl} hollow motor shaft', _shaft(s, st), 'steel', 'drive', 'machined',
                           f'{sd} x {st["teeth"] - st["shaft_bot"]:.0f}', '', None,
                           'Carries the wave generator, the rotor, the brake disc and the encoder discs. Cables pass through its bore.',
                           {}, 'make'))
    fix(shaft, Location(), (0, -110, 0))
    brg = std.ball_bearing(s.shaft, 'Supports the motor shaft.')
    fix(brg, loc(0, st['b1'], 0), (0, -95, 0))
    fix(brg, loc(0, st['b2'], 0), (0, -150, 0))
    ring = std.circlip(sd, False)
    s_ring = 1.2 if sd < 30 else 1.75 if sd < 60 else 2.5 if sd < 120 else 3.0
    fix(ring, loc(0, st['b2'] - sB / 2 - s_ring, 0), (0, -160, 0))
    # ── motor ────────────────────────────────────────────────────────────────────
    st_pd, wd, ro_pd = std.frameless_motor(st['od_m'], s.mot_l, s.mot_kw, s.mot_t, bore=sd)
    fix(st_pd, loc(0, st['yc'], 0), (0, -130, 0))
    fix(wd, loc(0, st['yc'], 0), (0, -130, 0))
    fix(ro_pd, loc(0, st['yc'], 0), (0, -185, 0))
    sr = m.part(PartDef(f'{prefix}-STR', f'{jl} stator retaining ring', _stator_ring(s, st), 'al6061', 'structure',
                        'machined', f'OD {st["od_m"]:g}', '', None,
                        'Pressed into the bore behind the stator. It holds the stator against its shoulder.', {}, 'make'))
    fix(sr, Location(), (0, -200, 0))
    # ── brake: 3 screws up through its end plate and body into web 2 ────────────
    bk = std.brake(s.brk_od, s.brk_l, s.brk_t, bore=sd, plate_r=st['plate_r'])
    fix(bk, loc(0, st['brk_top'], 0), (0, -240, 0))
    d_bk = 4 if size <= 25 else 5
    bkb = std.shcs(d_bk, _std_len(s.brk_l + 1.2 * d_bk, s.brk_l + sB + 3), '8.8', 'Fastens the brake to the rear bearing web.')
    for p in std.circle_points(3, s.brk_od / 2 * 0.9, 'y', offset=st['brk_bot'], start=30):
        fix(bkb, std.orient(p, (0, 1, 0)), (0, -255, 0))
    # ── encoders: discs on the shaft, read heads screwed up to the brake end plate ──
    enc1, enc2 = st['enc']
    fix(std.encoder(enc1, 'motor', bore=sd), loc(0, st['e1'], 0), (0, -280, 0))
    fix(std.encoder(enc2, 'multiturn', bore=sd), loc(0, st['e2'], 0, ry=180), (0, -300, 0))
    plate_t = s.brk_l * 0.18
    for (od, y0, side, lo) in ((enc1, st['e1'], 1, 9 + 1.5), (enc2, st['e2'], -1, 19 + 1.5)):
        eb = std.shcs(3, _std_len(lo, lo + plate_t - 0.5), '8.8', 'Fastens the encoder read head to the brake end plate.')
        xh = side * (od / 2 - 4 + od * 0.18 + 10 - 7)
        for dz in (-4.5, 4.5):
            fix(eb, std.orient((xh, y0, dz), (0, 1, 0)), (0, -290 - 10 * (side < 0), 0))
    # ── drive board on its ledge, then the rear cover ───────────────────────────
    drv = std.servo_drive(round(2 * st['r_drv']), s.amps)
    fix(drv, loc(0, st['drv_top'], 0, rx=180), (0, -330, 0))
    pb = std.shcs(3, 6, '8.8', 'Fastens the drive board to its ledge in the housing.')
    for p in std.circle_points(4, st['r_bay_b'] - 2.95, 'y', offset=st['drv_top'] - 1.6, start=45):
        fix(pb, std.orient(p, (0, 1, 0)), (0, -335, 0))
    cov = m.part(PartDef(f'{prefix}-COV', f'{jl} rear cover', _cover(s, st, gland_m, gland_ang, gland_r), 'al6061_blk', 'structure', 'machined',
                         f'OD {2 * st["r_bell"]:.0f} x 8', '', None, 'Closes the rear of the actuator. The O-ring seals it.', {}, 'make'))
    fix(cov, Location(), (0, -380, 0))
    r_or = st['r_bay_b'] + 2.2
    fix(std.oring(round(2 * r_or - 2.0), 2.0, 'Seals the rear cover to the housing.'), loc(0, st['y_back'] - 0.6, 0), (0, -360, 0))
    cb = std.bhcs(5, _std_len(8 + 6, 8 + 11), 'A2-70', 'Fastens the rear cover.')
    for p in std.circle_points(8, st['r_bay_b'] + 6, 'y', offset=st['y_back'] - 8, start=22.5):
        fix(cb, std.orient(p, (0, 1, 0)), (0, -400, 0))
    gl = std.gland(gland_m, 'Seals the motor power, the safety signal and the EtherCAT cable into the actuator.')
    ga = math.radians(gland_ang)
    fix(gl, std.orient((st['r_bell'] * gland_r * math.cos(ga), st['y_back'] - 8, st['r_bell'] * gland_r * math.sin(ga)), (0, 1, 0)),
        (0, -420, 0))
    return {'L': L, 'od': s.od, 'rear_od': 2 * st['r_bell'], 'y_front': st['y_front'], 'y_back': -L,
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
