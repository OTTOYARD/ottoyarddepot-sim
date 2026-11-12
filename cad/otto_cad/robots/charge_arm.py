"""OTTO-CHARGE ARM — the robotic DC fast-charge connector arm at each fast-charger stall.

Kinematics are the twin's, exactly (cad/spec/robots.json <- cobotSpec.ts): a 6R arm with a spherical
wrist, J1 base yaw, J2 shoulder pitch, J3 elbow pitch, J4 forearm roll, J5 wrist pitch, J6 tool roll;
shoulder height 436.8 mm, upper arm 1344, forearm 1142.4, wrist 268.8, tool 369.6 (TCP = the
connector's face). J1's axis stands on the mount 550 mm above the deck, 2.823 m from the car's centre.

FRAME: the arm base frame. Origin on J1's axis at the top of the mount collar, +Y up, +Z toward the car,
X along the car. Built at the ZERO pose (every joint 0, the arm straight up), the robot-CAD convention;
the GLB's joint nodes let the viewer pose it (the twin's STOWED pose by default).

LAYOUT OF EACH PITCH JOINT (J2, J3, J5): the parent link ends in a BOSS, a ring that clamps the
actuator's front drum; the actuator's output faces +X; the child link begins with a CHEEK bolted to the
output flange and curves back to the arm's centre plane (x = 0). So the kinematic chain has no lateral
offset, as the twin's IK requires (shoulderOffset 0).
"""
from __future__ import annotations

import math

import cadquery as cq
from OCP.gp import gp_Dir, gp_Lin, gp_Pnt
from OCP.IntCurvesFace import IntCurvesFace_ShapeIntersector
from cadquery import Location, Vector

from .. import std
from ..actuator import SIZES, build_actuator, module_length, out_flange_points, rear_od, front_ring_points
from ..core import Model, Node, PartDef, loc
from ..flex import Anchor, FlexDef

G = 9.81
BAL_A = 320.0     # balancer anchor below the J2 axis, mm
ANC_XZ = 190.0    # the riser's 4 anchors at (+/-190, +/-190): at 175 the nuts' corners stood in the tube's corners
# The twin folds the elbow to 132 deg stowed and 109 deg at the port, and draws both links in one plane: folded that far,
# the forearm stood inside the upper arm. The forearm's first 330 mm runs 190 mm out along the elbow axis, 120 mm wide
# (as deep as before), and swings back to the plane by 640 mm, so the wrist is where the twin puts it; the upper arm's
# last 155 mm before its J3 boss narrows to 110 mm, so the forearm's cheek plate folds past it.
FORE_JOG = (190.0, 120.0, 330.0, 640.0)
UPR_END_W = 110.0
# the charge cable's outlet on the connector (tool frame): where the free span starts, and the direction the span arrives
# along (the outlet points the other way, out along the tool's +X: parallel to J5, so the wrist's pitch does not bend it)
TOOL_OUTLET = (0.0, 177.84, -151.72)
TOOL_OUTLET_IN = (-0.9159, -0.1997, 0.3482)
J6_GLAND_ANG, J6_GLAND_R = 0.0, 0.52   # J6's gland (axial, on its rear cover) clear of the wrist yoke's flank: at 0.44 of the
                                       # cover's radius it met the yoke, pointing any way round
BAL_R = 160.0     # balancer crank pin above the J2 axis, mm
GAS_PROGRESSION = 0.15   # a nitrogen gas spring's force rise over its stroke (ASSUMPTION, typical of the type)


def _xdrum_span(size: int) -> tuple[float, float]:
    """Module-local y span of the actuator's front drum (the part a boss clamps)."""
    s = SIZES[size]
    g = std.swg_dims(size)
    return -s.of_t - s.xrb[2], -s.of_t - g['fs_len'] - 4


def _pitch_layout(size: int) -> dict:
    """Where an X-axis actuator sits so its front drum is centred in a boss at x = 0."""
    y0, y1 = _xdrum_span(size)
    boss_w = y0 - y1                     # front drum length
    out_x = boss_w / 2 - y0              # module origin (output face) in x
    return {'boss_w': boss_w, 'out_x': out_x, 'od': SIZES[size].od, 'L': module_length(SIZES[size])}


# ═════════════════════════════════════════════════════════════════ link bodies ═══


def _ell_wire(cx: float, y: float, a: float, b: float, n: int = 36) -> cq.Wire:
    """A closed section in the plane y = const: an ellipse (a along X, b along Z) as a periodic spline,
    sampled from the same angle every time so a loft through several of them never twists."""
    pts = [Vector(cx + a * math.cos(2 * math.pi * i / n), y, b * math.sin(2 * math.pi * i / n)) for i in range(n)]
    return cq.Wire.assembleEdges([cq.Edge.makeSpline(pts, periodic=True)])


def _link_casting(L: float, r_bot: float, r_top: float, cheek_x: float, cheek_r: float, cheek_t: float,
                  boss_od: float = 0, boss_w: float = 0, boss_bore: float = 0, wall: float = 7.0,
                  socket_r: float = 0, socket_bore: float = 0, socket_len: float = 0, act_r: float = 0,
                  end_w: float = 0.0, jog: tuple | None = None) -> cq.Shape:
    """A cast link from a joint at y = 0 (a CHEEK at +x, bolted to that joint's output flange) to its far
    end at y = L: either a BOSS at x = 0 that clamps the next X-axis actuator's front drum, or a SOCKET
    along +Y that holds the next Y-axis actuator. Hollow, `wall` thick.
    end_w: the last tube section's width in x (default: round), so the next link's cheek folds past it.
    jog = (x, w, y_hold, y_back): the tube starts off the link's plane at x, w wide in x (its depth in z unchanged),
    holds there to y_hold and swings back to the plane by y_back, so this link folds past the one before it."""
    k0 = cheek_r * 0.9
    if act_r:   # the cheek plate climbs beside the joint's actuator (it lies along X under it); a bridge crosses over it,
        # clear of the boss that clamps the actuator; the tube starts above the bridge
        sec = [(act_r + 75, jog[0], jog[1], r_bot * 2.0)] if jog else [(act_r + 75, 0.0, r_bot * 2.0, r_bot * 2.0)]
    else:
        sec = [  # (y, centre x, width x, depth z) -- the knuckle sweeps from the cheek into the tube
            (k0 * 0.55, cheek_x - cheek_t * 0.2, cheek_t * 1.6, cheek_r * 1.5),
            (k0 * 1.05, cheek_x * 0.55, r_bot * 1.25, r_bot * 1.75),
            (k0 * 1.6, 0.0, r_bot * 2.0, r_bot * 2.0),
        ]
    y_tube1 = (L - socket_len - 60) if socket_r else (L - boss_od * 0.62)
    y_tube0 = sec[-1][0]

    def rr_at(y: float) -> float:
        return r_bot + (r_top - r_bot) * (y - y_tube0) / (y_tube1 - y_tube0)
    if jog:                                     # hold off the plane, swing back (a cosine), then the straight taper
        jx, jw, y_hold, y_back = jog
        ys = [y_hold] + [y_hold + (y_back - y_hold) * k / 4 for k in range(1, 5)] + [y_back + (y_tube1 - y_back) * k / 3 for k in (1, 2)]
        for y in ys:
            u = min(1.0, max(0.0, (y - y_hold) / (y_back - y_hold)))
            sec.append((y, jx * 0.5 * (1 + math.cos(math.pi * u)), jw + (2 * rr_at(y) - jw) * u, 2 * rr_at(y)))
    else:
        for i in range(1, 6):                   # straight taper: sections every sixth of the tube
            t = i / 6
            rr = r_bot + (r_top - r_bot) * t
            sec.append((y_tube0 + (y_tube1 - y_tube0) * t, 0.0, rr * 2.0, rr * 2.0))
    if socket_r:
        sec += [(y_tube1, 0.0, r_top * 2.0, r_top * 2.0), (L - socket_len, 0.0, socket_r * 2, socket_r * 2)]
    else:
        sec += [(y_tube1, 0.0, end_w or r_top * 2.0, r_top * 2.0), (L - boss_od * 0.32, 0.0, boss_w, r_top * 1.7)]

    def solid(shrink: float) -> cq.Workplane:
        wires = [_ell_wire(cx, y, max(2.0, w / 2 - shrink), max(2.0, d / 2 - shrink)) for (y, cx, w, d) in sec]
        return cq.Workplane('XY').add(cq.Solid.makeLoft(wires, False))

    body = solid(0.0).cut(solid(wall))
    if act_r:   # the bridge: over the actuator to a tube on the plane, or straight out from the cheek to a jogged tube
        x0b, x1b = (cheek_x - cheek_t, jog[0] + jog[1] / 2) if jog else (-r_bot * 0.9, cheek_x)
        body = body.union(cq.Workplane('XY').box(x1b - x0b, 60, r_bot * 1.6).translate(((x0b + x1b) / 2, act_r + 55, 0)))
    cheek = (cq.Workplane('YZ', origin=(cheek_x - cheek_t, 0, 0)).circle(cheek_r).extrude(cheek_t))
    up = max(cheek_r * 1.4, act_r + 30)                 # the cheek plate reaches above the actuator
    cheek = cheek.union(cq.Workplane('YZ', origin=(cheek_x - cheek_t, 0, 0)).rect(up, cheek_r * 2)
                        .extrude(cheek_t).translate((0, up / 2, 0)))
    body = body.union(cheek)
    if socket_r:
        sock = (cq.Workplane('XZ', origin=(0, L - socket_len, 0)).circle(socket_r).extrude(-socket_len)
                .cut(cq.Workplane('XZ', origin=(0, L - socket_len - 1, 0)).circle(socket_bore / 2).extrude(-socket_len - 2)))
        body = body.union(sock)
    else:
        boss = cq.Workplane('YZ', origin=(-boss_w / 2, L, 0)).circle(boss_od / 2).extrude(boss_w)
        body = body.union(boss)
        body = body.cut(cq.Workplane('YZ', origin=(-boss_w, L, 0)).circle(boss_bore / 2).extrude(boss_w * 2))
    return body.val()


_RAYS: dict[int, tuple] = {}


def _surface_at(shape, x: float | None, y: float | None, z: float | None, side: str) -> float:
    """The extreme of a solid along one axis on a line through it: e.g. _surface_at(s, None, 160, 0, 'xmin') is the
    smallest x of the solid on the line y = 160, z = 0. Brackets meet the castings where they are. A ray against the
    solid's faces (a boolean per probe took seconds)."""
    ent = _RAYS.get(id(shape))
    if ent is None or ent[0] is not shape:
        ray = IntCurvesFace_ShapeIntersector()
        ray.Load(shape.wrapped, 1e-6)
        ent = _RAYS[id(shape)] = (shape, ray)
    ray = ent[1]
    ax = 'xyz'.index(side[0])
    p = [x or 0.0, y or 0.0, z or 0.0]
    p[ax] = -5000.0
    d = [0.0, 0.0, 0.0]
    d[ax] = 1.0
    ray.Perform(gp_Lin(gp_Pnt(*p), gp_Dir(*d)), 0.0, 10000.0)
    if not ray.IsDone() or ray.NbPnt() == 0:
        raise ValueError(f'the line misses the solid at {x}, {y}, {z}')
    vals = [ray.Pnt(i).Coord(ax + 1) for i in range(1, ray.NbPnt() + 1)]
    return min(vals) if side.endswith('min') else max(vals)


# ═════════════════════════════════════════════════════════════════════ build ═══


def build_chain(m: Model, base: Node, S: dict, H: float, LU: float, LF: float, LW: float, radii: dict,
                plate_under: float, jp: str = '') -> dict:
    """The arm itself, from the J1 actuator in its mount plate to the J6 output flange: six actuators, the turret, the
    balancer, the upper arm, the forearm and the wrist. `base` carries a mount plate cut as the charge arm's is (its top
    26 mm under J1's output face). The OTTO-CHARGE ARM and the wash bay's two detail arms are this one arm: the same
    castings and the same six actuators, so one set of spares serves both. `jp` prefixes the joint and node names, so a
    machine with two arms keeps them apart."""
    # ════════════════════════════════════════════════════════ J1 + TURRET ═══
    j1 = base.child(jp + 'J1_BaseYaw', loc(0, 0, 0), sub='J1',
                    joint={'name': jp + 'J1', 'axis': [0, 1, 0], 'limits': S['limits']['j1'], 'kind': 'revolute',
                           'stowed': S['stowed']['j1']})
    a1 = build_actuator(m, base, j1, 40, loc(0, 0, 0), loc(0, 26, 0), 'CHG-J1', 'J1')
    j1b = std.shcs(8, 30, '12.9', 'Holds the J1 actuator by its drum shoulder to the mount plate, from below.')
    r_j1b = (rear_od(SIZES[40]) / 2 + 1 + SIZES[40].od / 2) / 2
    for p in std.circle_points(8, r_j1b, 'y', offset=plate_under, start=11.25):
        m.place(base, j1b, std.orient(p, (0, 1, 0)), (0, -60, 0), 'J1')
    # turret casting: skirt (twin base housing r 193 -> 216, y 0..130), column to the J2 boss
    L2 = _pitch_layout(50)
    boss2_od = L2['od'] + 36
    rb = radii['base']
    tur = (cq.Workplane('XY').add(cq.Solid.makeCone(rb * 1.12, rb, 128, pnt=Vector(0, 2, 0), dir=Vector(0, 1, 0)))
           .union(cq.Workplane('XY').add(cq.Solid.makeCone(rb * 0.98, radii['shoulder'] * 0.92, H - 130 - SIZES[50].od / 2 - 5,
                                                           pnt=Vector(0, 130, 0), dir=Vector(0, 1, 0)))))
    tur = tur.union(cq.Workplane('YZ', origin=(-L2['boss_w'] / 2, H, 0)).circle(boss2_od / 2).extrude(L2['boss_w']))
    tur = tur.union(cq.Workplane('XY').box(L2['boss_w'], boss2_od * 0.62, boss2_od * 0.8, centered=(True, False, True))
                    .translate((0, H - boss2_od * 0.62, 0)))
    tur = tur.cut(cq.Workplane('YZ', origin=(-L2['boss_w'], H, 0)).circle(L2['od'] / 2).extrude(L2['boss_w'] * 2))
    tur = tur.cut(cq.Workplane('XZ', origin=(0, -1, 0)).circle(rb * 0.95).extrude(-122))      # skirt cavity
    tur = tur.cut(cq.Workplane('XZ', origin=(0, 118, 0)).circle(rb * 0.78).extrude(-(H - 130 - SIZES[50].od / 2 - 5 - 12)))
    tur = tur.union(cq.Workplane('XZ', origin=(0, 26 + 18, 0)).circle(rb * 0.95 + 0.5).circle(22).extrude(18))   # the web on J1's flange
    tur = tur.cut(cq.Workplane('XZ', origin=(0, 26 + 19, 0)).pushPoints([(p[0], p[2]) for p in out_flange_points(40)])
                  .circle(4.5).extrude(20))
    # the J2 drum clamp screws' counterbores: none at the top, none below the axis where the column's box fills the boss
    # (their heads stood in it); the heads sit 10 mm deep, clear of the upper arm's bridge as it turns over them
    j2_clamps = []
    for p in front_ring_points(50, 10):
        r = math.hypot(p[0], p[2])
        if p[0] / r > 0.7 or p[0] / r < -0.45:
            continue
        u = (0.0, p[0] / r, p[2] / r)
        j2_clamps.append(u)
        c0 = boss2_od / 2 - 10
        tur = tur.cut(cq.Workplane('XY').add(cq.Solid.makeCylinder(8.5, 16, Vector(0, H + u[1] * c0, u[2] * c0), Vector(*u))))
    m.place(j1, m.part(PartDef('CHG-TUR', 'Turret casting', tur.val(), 'a356', 'structure', 'casting, machined',
                               f'OD {rb * 2.24:.0f} x {H + boss2_od / 2:.0f}', 'A356-T6', None,
                               'Turns on J1 and carries the shoulder. Its boss clamps the J2 actuator.',
                               {'wall': '8 mm'}, 'make')), Location(), (0, 80, 0), 'J1')
    t1 = std.shcs(8, 30, '12.9', 'Holds the turret web to the J1 output flange.')
    for p in out_flange_points(40):
        m.place(j1, t1, std.orient((p[0], 26 + 18, p[2]), (0, -1, 0)), (0, 260, 0), 'J1')
    # accent band and status ring on the skirt
    # on the skirt cone (slope 0.12 rb in 128 mm), the 4 mm tube tangent to it
    band_r = rb * (1.12 - 0.12 * 28 / 128) + 4 / math.cos(math.atan(0.12 * rb / 128)) + 0.03
    band = cq.Workplane('XY').add(cq.Solid.makeTorus(band_r, 4, pnt=Vector(0, 30, 0), dir=Vector(0, 1, 0)))
    m.place(j1, m.part(PartDef('CHG-BAND1', 'Turret accent band', band.val(), 'accent', 'structure', 'moulded', '',
                               '', None, 'OTTOYARD red band. It marks the moving part of the machine.', {}, 'make')),
            Location(), (0, 40, 0), 'J1')

    # ═══════════════════════════════════════════════ J2 + balancer + upper arm ═══
    j2 = j1.child(jp + 'J2_Shoulder', loc(0, H, 0), sub='J2',
                  joint={'name': jp + 'J2', 'axis': [1, 0, 0], 'limits': S['limits']['j2'], 'kind': 'revolute',
                         'stowed': S['stowed']['j2']})
    Tm2 = loc(L2['out_x'], 0, 0, rz=-90)      # module +Y -> world +X
    a2 = build_actuator(m, j1, j2, 50, loc(0, H, 0), Tm2, 'CHG-J2', 'J2', gland_m=25)
    clamp_s = std.shcs(10, 40, '12.9', 'Clamps the J2 actuator drum in the turret boss.')
    for u in j2_clamps:       # radial screws through the boss into the drum, from outside, heads in their counterbores
        dirv = (0, -u[1], -u[2])
        pos = (0.0, H + u[1] * (boss2_od / 2 - 10), u[2] * (boss2_od / 2 - 10))
        m.place(j1, clamp_s, std.orient(pos, dirv), tuple(-c * 90 for c in dirv), 'J2')
    # status ring on the J2 boss faces (both sides): the twin draws two
    for sx in (-1, 1):
        ring = (cq.Workplane('XY').add(cq.Solid.makeTorus(boss2_od / 2 * 0.94, 5,
                                                          pnt=Vector(sx * (L2['boss_w'] / 2 + 5), H, 0), dir=Vector(1, 0, 0)))
                .cut(cq.Workplane('XY').box(60, 400, 600).translate((sx * (L2['boss_w'] / 2 + 5), H - 60 - 200, 0))))
        m.place(j1, m.part(PartDef(f'CHG-J2-RING{"R" if sx > 0 else "L"}', 'Status light ring, J2', ring.val(), 'led',
                                   'electrical', 'LED strip in PC diffuser', f'OD {boss2_od * 0.94:.0f}', '', None,
                                   'Shows the arm state: teal ready, amber moving, green charging, red fault.', {}, 'buy')),
                Location(), (sx * 60, 0, 0), 'SAFETY')
    upper = _link_casting(LU, radii['upper'] * 1.18, radii['elbow'] * 0.86,
                          cheek_x=L2['out_x'] + 20, cheek_r=a2['of_od'] / 2 + 14, cheek_t=20,
                          boss_od=_pitch_layout(40)['od'] + 36, boss_w=_pitch_layout(40)['boss_w'],
                          boss_bore=SIZES[40].od, act_r=rear_od(SIZES[50]) / 2 if rear_od(SIZES[50]) > SIZES[50].od else SIZES[50].od / 2,
                          end_w=UPR_END_W)
    # clear of J3's front, beside the boss: its bearing clamp ring (OD 214) and its screws stood in the beam's flanks
    upper = (cq.Workplane('XY').add(upper)
             .cut(cq.Workplane('YZ', origin=(_pitch_layout(40)['boss_w'] / 2, LU, 0)).circle(SIZES[40].od / 2 + 2).extrude(50)))
    # the J3 drum clamp screws' counterbores, 8 mm deep: their heads stood proud of the boss, under the forearm's bridge
    b3_r = (_pitch_layout(40)['od'] + 36) / 2
    for p in front_ring_points(40, 8):
        r = math.hypot(p[0], p[2])
        u = (0.0, p[0] / r, p[2] / r)
        upper = upper.cut(cq.Workplane('XY').add(cq.Solid.makeCylinder(7.0, 16, Vector(0, LU + u[1] * (b3_r - 8), u[2] * (b3_r - 8)),
                                                                       Vector(*u))))
    m.place(j2, m.part(PartDef('CHG-UPR', 'Upper arm casting', upper.val(), 'a356', 'structure', 'casting, machined',
                               f'{LU:.1f} between axes', 'A356-T6', None,
                               'Carries the elbow 1.344 m from the shoulder. Hollow for stiffness per kilogram.',
                               {'wall': '7 mm', 'axis distance': f'{LU:.1f} mm, bored in one set-up'}, 'make')),
            Location(), (0, 0, 220), 'UPPER')
    us = std.shcs(10, 45, '12.9', 'Holds the upper arm cheek to the J2 output flange.')
    for p in out_flange_points(50):
        x = L2['out_x'] + 20
        m.place(j2, us, std.orient((x, p[0], p[2]), (-1, 0, 0)), (160, 0, 0), 'UPPER')
    for k in range(2):
        a = math.radians(360 / 32 + 180 * k)
        r = out_flange_points(50)[0][0]
        m.place(j2, std.dowel(10, 30), loc(L2['out_x'] + 5, r * math.cos(a), r * math.sin(a), rz=90), (140, 0, 0), 'UPPER')

    # gravity balancer, the inverted-pendulum kind: a compression spring cartridge between an anchor BAL_A
    # below the J2 axis (on the turret) and a crank pin BAL_R above it (on the upper arm). Leaning the arm
    # either way shortens it, and its push makes a restoring torque F * a * r * sin(q2) / d: the shape of
    # the gravity torque itself. On the -X side, outside the J2 motor bell and the turret column.
    bal_x = L2['out_x'] - L2['L'] - 80                  # outboard of the J2 actuator's rear cover and its gland
    p_low = (bal_x, H - BAL_A, 0.0)               # J1 frame
    p_up = (bal_x, BAL_R, 0.0)                    # J2 frame (zero pose: straight above the axis)
    Lb = BAL_A + BAL_R
    eye = (cq.Workplane('XY').box(40, 56, 64).edges('|X').fillet(16)
           .cut(cq.Workplane('YZ', origin=(-25, 0, 0)).circle(12.5).extrude(50)))
    cyl = (cq.Workplane('XZ', origin=(0, 36, 0)).circle(45).circle(39).extrude(-(Lb * 0.56))      # clear of the clevis cheeks
           .union(cq.Workplane('XZ', origin=(0, 36, 0)).circle(45).extrude(-8))
           .union(cq.Workplane('XZ', origin=(0, 36 + Lb * 0.56, 0)).circle(45).circle(21).extrude(-8))
           .union(cq.Workplane('XZ', origin=(0, 28, 0)).circle(16).extrude(-8))                      # its neck to the eye
           .union(eye))
    rod = (cq.Workplane('XZ', origin=(0, -36, 0)).circle(20).extrude(Lb * 0.5)
           .union(cq.Workplane('XZ', origin=(0, -28, 0)).circle(12).extrude(8))
           .union(eye))
    bal_body = m.part(PartDef('CHG-BAL-CYL', 'J2 balancer gas spring, 10 kN class', cyl.val(), 'steel_paint', 'drive',
                              'ISO 11901-1 (gas springs)', f'OD 90 x {Lb * 0.56 + 60:.0f}', 'nitrogen, about 150 bar', None,
                              'Its nearly constant push holds the upper arm toward upright. The gear and brake carry the rest.',
                              {'stroke': '175 mm', 'progression': '15 %'}, 'buy'))
    m.place(j1, bal_body, loc(*p_low), (-80, 0, 0), 'J2')
    m.place(j2, m.part(PartDef('CHG-BAL-ROD', 'J2 balancer rod and eye', rod.val(), 'ss304', 'drive', 'made to order',
                               f'OD 40 x {Lb * 0.5:.0f}', '', None, 'Pushes on the upper arm crank pin.', {}, 'make')),
            loc(p_up[0], p_up[1], p_up[2], rx=180), (-80, 0, 0), 'J2')
    pin = PartDef('CHG-BAL-PIN', 'Balancer clevis pin 25 x 90', cq.Workplane('YZ').circle(12.5).extrude(45, both=True).val(),
                  'steel', 'drive', 'ISO 2341', '25 x 90', 'hardened', None,
                  'Hinges the cartridge eye. Two retaining rings hold it.', {}, 'buy')
    m.place(j1, pin, loc(*p_low), (-130, 0, 0), 'J2')
    m.place(j2, pin, loc(*p_up), (-130, 0, 0), 'J2')
    for sx in (-1, 1):
        m.place(j1, std.circlip(25, False), std.orient((p_low[0] + sx * 46, p_low[1], p_low[2]), (sx, 0, 0)), (-150, 0, 0), 'J2')
        m.place(j2, std.circlip(25, False), std.orient((p_up[0] + sx * 46, p_up[1], p_up[2]), (sx, 0, 0)), (-150, 0, 0), 'J2')
    # anchor bracket on the turret, crank bracket on the upper arm: a clevis on a short arm each
    def bracket(reach: float, up: bool) -> cq.Workplane:
        # the clevis: 2 cheeks round the eye, the pin through both; its base (away from the slot) carries the arm,
        # clear of the pin's retaining rings; the arm ends in a flange on the casting
        # Both slots open toward +Y: the cylinder rises from the anchor's eye, and the rod, turned half round, leaves the
        # crank's eye the same way (the crank's slot opened the other way, so its base stood across the rod's neck)
        sgn = 1 if up else -1                            # the arm's side: up for the crank, down for the anchor
        clev = (cq.Workplane('XY').box(84, 70, 64).edges('|X').fillet(10)
                .cut(cq.Workplane('XY').box(44, 80, 70).translate((0, 12, 0))))
        yc = sgn * 26
        arm = cq.Workplane('XY').box(reach, 18, 56).translate((42 + reach / 2, yc, 0))
        fl = cq.Workplane('XY').box(16, 110, 110).translate((42 + reach + 8, yc, 0))
        return clev.union(arm).union(fl).cut(cq.Workplane('YZ', origin=(-50, 0, 0)).circle(12.6).extrude(100))
    y_low = p_low[1]
    grid = [(dy, dz) for dy in range(-55, 56, 5) for dz in (-55, -45, -27, 0, 27, 45, 55)]   # the flange's face, 110 x 110

    def face_x(shape, yc_):
        xs = []
        for (dy, dz) in grid:
            try:
                xs.append(_surface_at(shape, None, yc_ + dy, dz, 'xmin'))
            except Exception:          # noqa: BLE001  the line misses the casting there
                pass
        return min(xs)
    x_tur = face_x(tur.val(), y_low - 26)
    reach_a = x_tur - (bal_x + 42) - 16
    x_upr = face_x(upper.val(), p_up[1] + 26)
    reach_c = x_upr - (bal_x + 42) - 16
    m.place(j1, m.part(PartDef('CHG-BAL-ANC', 'Balancer anchor bracket, turret', bracket(reach_a, False).val(), 'steel_paint',
                               'structure', 'machined weldment', f'84 x 110 x {reach_a + 58:.0f}', 'S355J2', None,
                               'Anchors the balancer below the J2 axis. Its flange bolts to the turret column.', {}, 'make')),
            loc(*p_low), (-100, 0, 0), 'J2')
    m.place(j2, m.part(PartDef('CHG-BAL-CRK', 'Balancer crank bracket, upper arm', bracket(reach_c, True).val(), 'steel_paint',
                               'structure', 'machined weldment', f'84 x 110 x {reach_c + 58:.0f}', 'S355J2', None,
                               'Carries the crank pin above the J2 axis. Its flange bolts to the upper arm.', {}, 'make')),
            loc(*p_up), (-100, 0, 0), 'J2')
    for node, p, up, reach in ((j1, p_low, False, reach_a), (j2, p_up, True, reach_c)):
        yc = 26 if up else -26
        for dz in (-40, 40):
            for dy in (-40, 40):
                m.place(node, std.shcs(10, 35, '12.9', 'Holds the balancer bracket flange to the casting.'),
                        std.orient((p[0] + 42 + reach, p[1] + yc + dy, p[2] + dz), (1, 0, 0)), (-110, 0, 0), 'J2')
    # ════════════════════════════════════════════════════════ J3 + forearm ═══
    L3 = _pitch_layout(40)
    j3 = j2.child(jp + 'J3_Elbow', loc(0, LU, 0), sub='J3',
                  joint={'name': jp + 'J3', 'axis': [1, 0, 0], 'limits': S['limits']['j3'], 'kind': 'revolute',
                         'stowed': S['stowed']['j3']})
    Tm3 = loc(L3['out_x'], 0, 0, rz=-90)
    a3 = build_actuator(m, j2, j3, 40, loc(0, LU, 0), Tm3, 'CHG-J3', 'J3')
    boss3_od = L3['od'] + 36
    clamp3 = std.shcs(8, 35, '12.9', 'Clamps the J3 actuator drum in the upper arm boss.')
    for p in front_ring_points(40, 8):
        r = math.hypot(p[0], p[2])
        dirv = (0, -p[0] / r, -p[2] / r)
        pos = (0.0, LU + p[0] / r * (boss3_od / 2 - 8), p[2] / r * (boss3_od / 2 - 8))     # the head in its counterbore
        m.place(j2, clamp3, std.orient(pos, dirv), tuple(-c * 80 for c in dirv), 'J3')
    # wrist geometry needed by the forearm's top socket
    s4 = SIZES[25]
    L4 = module_length(s4)
    y4_out = LF - 104.0                       # J4 output face, below the wrist centre
    y_sock1 = y4_out - s4.of_t - s4.xrb[2]          # J4's housing front face: the socket's top
    fore = _link_casting(y_sock1, radii['fore'] * 1.16, radii['wristR'] * 1.02,
                         cheek_x=L3['out_x'] + 18, cheek_r=a3['of_od'] / 2 + 12, cheek_t=18, wall=6.0,
                         socket_r=s4.od / 2 + 12, socket_bore=s4.od, socket_len=(s4.od - rear_od(s4)) * 0.4 + 48,
                         act_r=SIZES[40].od / 2, jog=FORE_JOG)
    fore = cq.Workplane('XY').add(fore)
    m.place(j3, m.part(PartDef('CHG-FOR', 'Forearm casting', fore.val(), 'a356', 'structure', 'casting, machined',
                               f'{LF:.1f} elbow to wrist centre', 'A356-T6', None,
                               'Carries the wrist 1.142 m from the elbow. Its top socket holds J4.',
                               {'wall': '6 mm'}, 'make')), Location(), (0, 0, 180), 'FORE')
    fs_ = std.shcs(8, 40, '12.9', 'Holds the forearm cheek to the J3 output flange.')
    for p in out_flange_points(40):
        m.place(j3, fs_, std.orient((L3['out_x'] + 18, p[0], p[2]), (-1, 0, 0)), (140, 0, 0), 'FORE')

    # ═════════════════════════════════════════════════════════════ WRIST ═══
    yc = LF                                   # wrist centre, J3 frame
    j4 = j3.child(jp + 'J4_ForearmRoll', loc(0, y4_out, 0), sub='WRIST',
                  joint={'name': jp + 'J4', 'axis': [0, 1, 0], 'limits': S['limits']['j4'], 'kind': 'revolute',
                         'stowed': S['stowed']['j4']})
    build_actuator(m, j3, j4, 25, loc(0, y4_out, 0), Location(), 'CHG-J4', 'WRIST', gland_m=16)
    s4b = std.shcs(6, 25, '12.9', 'Clamps the J4 actuator in the forearm socket.')
    for p in std.circle_points(8, s4.od / 2 + 6, 'y', offset=y4_out - s4.of_t - s4.xrb[2] + 0.0, start=22.5):
        m.place(j3, s4b, std.orient(p, (0, -1, 0)), (0, 120, 0), 'WRIST')
    # wrist yoke: from J4's output face up around J5 (a fork on the +X side carrying J5's housing boss)
    L5 = _pitch_layout(25)
    boss5_od = L5['od'] + 24
    dy5 = yc - y4_out                          # J5 axis above the J4 output face
    yoke = (cq.Workplane('XZ').circle(SIZES[25].xrb[0] / 2 + 14).extrude(-14)
            .union(cq.Workplane('XY').box(L5['boss_w'] + 10, dy5, boss5_od * 0.8, centered=(True, False, True))
                   .edges('|Y').fillet(14))
            .union(cq.Workplane('YZ', origin=(-(L5['boss_w'] + 10) / 2, dy5, 0)).circle(boss5_od / 2).extrude(L5['boss_w'] + 10))
            .cut(cq.Workplane('YZ', origin=(-L5['boss_w'] * 2, dy5, 0)).circle(L5['od'] / 2).extrude(L5['boss_w'] * 4))
            .cut(cq.Workplane('XZ', origin=(0, 14 + 7, 0)).pushPoints([(p[0], p[2]) for p in out_flange_points(25)])
                 .circle(5.5).extrude(7)))                  # pockets for the J4 flange screws' heads
    m.place(j4, m.part(PartDef('CHG-YK5', 'Wrist yoke', yoke.val(), 'al6061', 'structure', 'machined from billet',
                               f'{L5["boss_w"] + 10:.0f} x {dy5:.0f}', '6061-T6', None,
                               'Turns on J4 and holds the J5 actuator on the wrist centre.', {}, 'make')),
            Location(), (0, 90, 0), 'WRIST')
    ys = std.shcs(6, 25, '12.9', 'Holds the wrist yoke to the J4 output flange.')
    for p in out_flange_points(25):
        m.place(j4, ys, std.orient((p[0], 14, p[2]), (0, -1, 0)), (0, 110, 0), 'WRIST')
    j5 = j4.child(jp + 'J5_WristPitch', loc(0, dy5, 0), sub='WRIST',
                  joint={'name': jp + 'J5', 'axis': [1, 0, 0], 'limits': S['limits']['j5'], 'kind': 'revolute',
                         'stowed': S['stowed']['j5']})
    a5 = build_actuator(m, j4, j5, 25, loc(0, dy5, 0), loc(L5['out_x'], 0, 0, rz=-90), 'CHG-J5', 'WRIST', gland_m=16)
    # J5 output cheek -> wrist tube up to J6 (J6 output face = the tool flange at the wrist centre + LW)
    s6 = SIZES[20]
    L6 = module_length(s6)
    cheek5_x = L5['out_x'] + 14
    tube_top = LW - L6 + s6.of_t + s6.xrb[2] + 4
    r6 = max(s6.od, rear_od(s6)) / 2                    # J6's rear bell sits in the socket
    rc5 = a5['of_od'] / 2 + 10
    wt = (cq.Workplane('YZ', origin=(cheek5_x - 14, 0, 0)).circle(rc5).extrude(14)
          .union(cq.Workplane('XY').box(14, tube_top, 2 * rc5).translate((cheek5_x - 7, tube_top / 2, 0)))
          .union(cq.Workplane('XZ', origin=(0, tube_top, 0)).circle(r6 + 10).extrude(30))
          .union(cq.Workplane('XY').box(cheek5_x, 30, 90).translate((cheek5_x / 2, tube_top - 15, 0)))
          .cut(cq.Workplane('XZ', origin=(0, tube_top + 1, 0)).circle(r6).extrude(41)))
    m.place(j5, m.part(PartDef('CHG-WTB', 'Wrist tube', wt.val(), 'al6061', 'structure', 'machined from billet',
                               f'J5 cheek to J6, {tube_top:.0f}', '6061-T6', None,
                               'Turns on J5 and holds the J6 actuator on the tool axis.', {}, 'make')),
            Location(), (60, 40, 0), 'WRIST')
    for p in out_flange_points(25):
        m.place(j5, std.shcs(6, 25, '12.9', 'Holds the wrist tube cheek to the J5 output flange.'),
                std.orient((cheek5_x, p[0], p[2]), (-1, 0, 0)), (120, 0, 0), 'WRIST')
    j6 = j5.child(jp + 'J6_ToolRoll', loc(0, LW, 0), sub='WRIST',
                  joint={'name': jp + 'J6', 'axis': [0, 1, 0], 'limits': S['limits']['j6'], 'kind': 'revolute',
                         'stowed': S['stowed']['j6']})
    build_actuator(m, j5, j6, 20, loc(0, LW, 0), Location(), 'CHG-J6', 'WRIST', gland_m=16, gland_ang=J6_GLAND_ANG,
                   gland_r=J6_GLAND_R)
    for p in std.circle_points(6, r6 + 5, 'y', offset=tube_top, start=30):
        m.place(j5, std.shcs(5, 20, '12.9', 'Clamps the J6 actuator in the wrist tube.'), std.orient(p, (0, -1, 0)),
                (0, 100, 0), 'WRIST')
    # round the socket ring's outside at mid height (on its top it stood on the J6 clamp screws' heads), open where
    # the cheek arm joins the ring
    wring = (cq.Workplane('XY').add(cq.Solid.makeTorus(r6 + 10 + 4, 4, pnt=Vector(0, tube_top - 15, 0), dir=Vector(0, 1, 0)))
             .cut(cq.Workplane('XY').box(200, 20, 2 * rc5 + 16).translate((130, tube_top - 15, 0))))   # past the side plate
    m.place(j5, m.part(PartDef('CHG-WRING', 'Status light ring, wrist', wring.val(), 'led', 'electrical',
                               'LED strip in PC diffuser', f'OD {2 * (r6 + 18):.0f}', '', None,
                               'Shows the arm state at the connector, where the camera and a person look.', {}, 'buy')),
            Location(), (0, 30, 0), 'SAFETY')

    return {'j1': j1, 'j2': j2, 'j3': j3, 'j4': j4, 'j5': j5, 'j6': j6, 'tur': tur, 'upper': upper, 'fore': fore}



def build(spec: dict) -> Model:
    S = spec['chargeArm']
    M = 1000.0
    H = S['shoulderHeight'] * M
    LU = S['upperArm'] * M
    LF = S['forearm'] * M
    LW = S['wrist'] * M
    LT = S['tool'] * M
    MOUNT = S['mountHeight'] * M
    deck = -MOUNT
    radii = {k: v * M for k, v in S['radii'].items()}

    m = Model('charge_arm', 'OTTO-CHARGE ARM',
              'Arm base frame: origin on J1 axis at the mount collar top, +Y up, +Z toward the car, X along the car. '
              'Zero pose (all joints 0).')

    # ── subsystems (the tab's breakout) ───────────────────────────────────────────
    m.subsystem('MOUNT', 'Riser and mount', 'A steel riser on the charger pad carries the arm. Its J1 axis is 550 mm above the deck and 2.82 m from the car centreline.',
                how=['4 chemical anchors M16 hold the riser to the concrete pad.',
                     '8 screws M12 hold the mount plate to the riser.',
                     'The cable trunk joins the riser to the charger cabinet. The arm\'s power and network cables run inside it '
                     'into the riser and up through J1\'s hollow shaft.'],
                specs={'J1 height': '550 mm above the deck', 'riser': '345 mm square, S355 galvanised'}, group='Structure')
    m.subsystem('J1', 'J1 base yaw', 'Turns the whole arm about the vertical axis to face the charge port.',
                how=['A size 40 actuator in the riser top turns the turret.', 'Range is +/- 180 degrees. Cables pass through the hollow shaft.'],
                specs={'gear': 'strain-wave, size 40, 100:1'}, group='Joints')
    m.subsystem('J2', 'J2 shoulder pitch', 'Leans the upper arm toward or away from the car. It carries the highest load of any joint.',
                how=['A size 50 actuator in the turret boss drives the upper arm.',
                     'A nitrogen gas spring balancer carries most of the gravity load, so the gear and brake see less.'],
                specs={'gear': 'strain-wave, size 50, 100:1'}, group='Joints')
    m.subsystem('UPPER', 'Upper arm', 'The 1.344 m cast link from the shoulder to the elbow.',
                how=['A hollow aluminium casting, 7 mm wall.', 'Its cheek bolts to the J2 output. Its boss clamps the J3 actuator.'],
                group='Links')
    m.subsystem('J3', 'J3 elbow pitch', 'Folds the forearm to set the reach and the height of the wrist.',
                how=['A size 40 actuator in the upper arm boss drives the forearm.'], specs={'gear': 'strain-wave, size 40, 100:1'},
                group='Joints')
    m.subsystem('FORE', 'Forearm', 'The 1.142 m cast link from the elbow to the wrist centre.',
                how=['A hollow aluminium casting. Its top socket holds the J4 actuator.'], group='Links')
    m.subsystem('WRIST', 'Spherical wrist (J4, J5, J6)', 'Points the connector along the port axis. The 3 wrist axes meet at one point, so position and angle solve apart.',
                how=['J4 rolls the forearm end (size 25).', 'J5 pitches the wrist (size 25).', 'J6 rolls the tool (size 20). Its output is the tool flange (ISO 9409-1).'],
                specs={'gears': 'size 25, 25, 20, 100:1'}, group='Joints')
    m.subsystem('TOOL', 'Connector tool', 'Finds the inlet, plugs in, latches, and lets go. It measures the force on every move.',
                how=['A 6-axis force and torque sensor reads the insertion force.',
                     'A compliance unit lets the connector float up to 6 mm and 3 degrees. A small error cannot jam it.',
                     'Stereo cameras and a time-of-flight sensor find the inlet. A light ring helps at night.',
                     'A solenoid latch locks the connector in the inlet for the charge.'],
                specs={'connector': 'DC combo class (CCS), liquid-cooled', 'TCP': '369.6 mm from the tool flange'}, group='Tool')
    m.subsystem('DRESS', 'Power path in the arm', 'Carries the charge current, the coolant and the tool\'s lines to the connector '
                'inside the arm, and power and network to the joints.',
                how=['The charge current comes up the riser from the cabinet in 2 insulated copper bars.',
                     'In each hollow link 2 copper bars carry it, one a pole. Nothing live is in the open.',
                     'At the base, the shoulder and the elbow a booted link of braided copper joins 2 terminal boxes. It bends as the joint turns.',
                     'From the forearm one last booted link, 1.2 m long, runs to the connector across the wrist.',
                     'The coolant for the connector\'s contacts, the tool\'s cable and its air line run with the bars and through each boot.',
                     'The joints\' 10 mm power and network cable runs inside the arm, through the hollow shafts of J1 to J5.'],
                specs={'current': '500 A DC, 1000 V', 'bars': '2 x 40 x 10 mm copper in each link, insulated',
                       'flex links': '4, braided copper 400 mm2 a pole, in a silicone boot OD 60 mm, 0.9 to 1.2 m',
                       'bend radius': '80 mm moved (the tightest in the twin\'s 20 poses is 100 mm)',
                       'cooling': 'liquid at the connector\'s contacts, 2 tubes 8 mm'}, group='Cables')
    m.subsystem('SAFETY', 'Safety and status', 'Stops the arm when a person comes near and shows its state to the site.',
                how=['A safety laser scanner on the riser watches the stall at knee height.',
                     'An emergency stop on the riser cuts motor power (safe torque off).',
                     'Light rings on J2 and the wrist show the state: teal ready, amber moving, green charging, red fault.'],
                group='Safety')

    root = m.root
    base = root.child('Base', sub='MOUNT')

    # ════════════════════════════════════════════════════════════ MOUNT ═══
    pad_top = deck + S['cabinet']['padHeight'] * M
    riser_w = S['armMount']['riser'] * M
    plate_under = -S['mountPlateUnderside'] * M          # -81
    cab = S['cabinet']
    cab_cz = -cab['backset'] * M
    cab_front = cab_cz + cab['depth'] * M / 2
    pad_back = cab_cz - cab['depth'] * M / 2 - 191.4
    pad_front = riser_w / 2 + S['armMount']['padFront'] * M
    pad = m.part(PartDef('CHG-PAD', 'Charger pad (site concrete)',
                         cq.Workplane('XY').box(cab['width'] * M + 200, pad_top - deck + 150, pad_front - pad_back,
                                                centered=(True, False, False))
                         .translate((0, deck - 150, pad_back)).edges('|X and >Y').chamfer(15).val(),
                         'concrete', 'structure', 'site works', f"{cab['width'] * M + 200:.0f} x {pad_front - pad_back:.0f}",
                         '', None, 'Carries the cabinet and the arm on one plinth. Cast by the site works.', {}, 'make',
                         reference=True))
    m.place(base, pad, Location(), (0, -250, 0))
    # riser weldment
    bp_t, fl_t, tw = 20.0, 20.0, 10.0
    tube_y0, tube_y1 = pad_top + bp_t, plate_under - fl_t
    riser = (cq.Workplane('XY').box(450, bp_t, 450, centered=(True, False, True)).translate((0, pad_top, 0))
             .union(cq.Workplane('XY').box(riser_w, tube_y1 - tube_y0, riser_w, centered=(True, False, True))
                    .translate((0, tube_y0, 0)).edges('|Y').fillet(14))
             .cut(cq.Workplane('XY').box(riser_w - 2 * tw, tube_y1 - tube_y0 + 2, riser_w - 2 * tw, centered=(True, False, True))
                  .translate((0, tube_y0 - 1, 0)).edges('|Y').fillet(6))
             .union(cq.Workplane('XY').box(riser_w, fl_t, riser_w, centered=(True, False, True)).translate((0, tube_y1, 0))))
    for sx, sz in ((1, 0), (-1, 0), (0, 1)):            # three base gussets (the trunk comes in on the -Z face)
        g = (cq.Workplane('XY').polyline([(0, 0), (52, 0), (0, 150)]).close().extrude(5, both=True))
        if sx:
            g = g.rotate((0, 0, 0), (0, 1, 0), 0 if sx > 0 else 180)
        else:
            g = g.rotate((0, 0, 0), (0, 1, 0), -90 if sz > 0 else 90)
        g = g.rotate((0, 0, 0), (1, 0, 0), 0).translate((sx * riser_w / 2, tube_y0, sz * riser_w / 2))
        riser = riser.union(g)
    riser = riser.faces('<Y').workplane(centerOption='CenterOfBoundBox').pushPoints(
        [(x, z) for x in (-ANC_XZ, ANC_XZ) for z in (-ANC_XZ, ANC_XZ)]).hole(18)
    riser = riser.cut(cq.Workplane('XY').box(riser_w - 80, 160, 30, centered=(True, False, True))
                      .translate((0, tube_y0 + 60, -riser_w / 2)))          # cable window to the trunk
    riser = riser.cut(cq.Workplane('XY').circle(118).extrude(fl_t + 2).rotate((0, 0, 0), (1, 0, 0), -90)
                      .translate((0, tube_y1 - 1, 0)))                       # J1 bore in the top flange
    pts = [(p[0], p[2]) for p in std.circle_points(8, 122, 'y', start=22.5)]
    riser = riser.faces('>Y').workplane(centerOption='CenterOfBoundBox').pushPoints(pts).hole(10.2, fl_t)
    m.place(base, m.part(PartDef('CHG-RSR', 'Riser weldment', riser.val(), 'steel_s355', 'structure', 'EN 1090-2 EXC2',
                                 f'{riser_w:.0f} sq x {plate_under - pad_top:.0f}', 'S355J2', None,
                                 'Lifts the arm to its J1 height. Welded, then hot-dip galvanised.',
                                 {'tube': f'{riser_w:.0f} x {riser_w:.0f} x {tw:g}', 'welds': 'fillet a5, all round'}, 'make')),
            Location(), (0, -120, 0))
    anc = PartDef('CHG-ANC-M16', 'Anchor rod M16 x 190, injection mortar', cq.Workplane('XZ').circle(8).extrude(190)
                  .faces('<Y').chamfer(1.5).translate((0, 60, 0)).val(), 'fast_zn', 'fastener', 'ETA option 1 anchor',
                  'M16 x 190', '8.8', 145.0, 'Holds the riser to the pad. The mortar bonds it into a 125 mm hole.',
                  {'embedment': '125 mm', 'tension (design)': 'about 20 kN per rod'}, 'buy')
    for x in (-ANC_XZ, ANC_XZ):
        for z in (-ANC_XZ, ANC_XZ):
            m.place(base, anc, loc(x, pad_top + bp_t, z), (0, 140, 0))
            m.place(base, std.washer(16), std.orient((x, pad_top + bp_t, z), (0, -1, 0)), (0, 160, 0))
            m.place(base, std.nut(16), loc(x, pad_top + bp_t + 3, z), (0, 180, 0))
    # mount plate + collar (the twin's plinth: plate 300 sq x 26 from y -81, collar 135/155 x 55)
    from ..actuator import stack as _stack
    y_sh = 26 + _stack(SIZES[40])['y_drum']               # J1's drum shoulder, base frame
    plate = (cq.Workplane('XY').box(300, 26, 300, centered=(True, False, True)).translate((0, plate_under, 0))
             .edges('|Y').fillet(12).cut(cq.Workplane('XZ', origin=(0, plate_under + 27, 0)).circle(rear_od(SIZES[40]) / 2 + 1).extrude(28))
             .cut(cq.Workplane('XZ', origin=(0, plate_under + 27, 0)).circle(SIZES[40].od / 2).extrude(plate_under + 27 - y_sh)))
    plate = plate.faces('>Y').workplane(centerOption='CenterOfBoundBox').pushPoints(pts).cboreHole(13.5, 20.5, 12.5)
    m.place(base, m.part(PartDef('CHG-MPL', 'Arm mount plate', plate.val(), 'steel_paint', 'structure', 'machined',
                                 '300 x 300 x 26', 'S355J2', None, 'Carries the J1 actuator and spreads its load into the riser.',
                                 {'flatness': '0.05 mm'}, 'make', depot='box')), Location(), (0, 60, 0))
    mp_screw = std.shcs(12, 45, '10.9', 'Holds the mount plate to the riser flange.')
    for p in std.circle_points(8, 122, 'y', offset=plate_under + 26 - 12.5, start=22.5):
        m.place(base, mp_screw, std.orient(p, (0, -1, 0)), (0, 200, 0))
    collar = (cq.Workplane('XY').add(cq.Solid.makeCone(155, 135, 55, pnt=Vector(0, -55, 0), dir=Vector(0, 1, 0)))
              .cut(cq.Workplane('XZ', origin=(0, 1, 0)).circle(108.5).extrude(57)))
    m.place(base, m.part(PartDef('CHG-COL', 'J1 collar', collar.val(), 'a356', 'structure', 'casting',
                                 'OD 310 x 55', '', None, 'Covers the J1 actuator drum and sheds water off the mount.', {}, 'make')),
            Location(), (0, 90, 0))
    # cable trunk to the cabinet
    tr_w = S['armMount']['bridge'] * M
    z0, z1 = cab_front, -riser_w / 2              # from the cabinet's face to the riser's back face
    th = plate_under - pad_top - 40
    trunk = (cq.Workplane('XY').box(tr_w, th, z1 - z0, centered=(True, False, False)).translate((0, pad_top + bp_t, z0))
             .cut(cq.Workplane('XY').box(tr_w - 6, th - 6, z1 - z0 + 2, centered=(True, False, False))
                  .translate((0, pad_top + bp_t + 3, z0 - 1))))
    m.place(base, m.part(PartDef('CHG-TRK', 'Cable trunk', trunk.val(), 'steel_paint', 'structure', 'sheet metal 3 mm',
                                 f'{tr_w:.0f} wide', '', None,
                                 'Joins the riser to the cabinet. The DC cable, the coolant lines and the data cable run inside.',
                                 {}, 'make')), Location(), (0, 0, -80))
    cab_box = (cq.Workplane('XY').box(cab['width'] * M, cab['height'] * M, cab['depth'] * M, centered=(True, False, True))
               .translate((0, pad_top, cab_cz)).edges('|Z').fillet(18))
    cab_box = cab_box.cut(cq.Workplane('XY').box(cab['width'] * M - 80, cab['height'] * M - 160, 4, centered=(True, False, True))
                          .translate((0, pad_top + 80, cab_front)))     # door seam
    m.place(base, m.part(PartDef('CHG-CAB', 'DC power cabinet (envelope)', cab_box.val(), 'steel_paint', 'structure',
                                 'reference envelope', f"{cab['width'] * M:.0f} x {cab['height'] * M:.0f} x {cab['depth'] * M:.0f}",
                                 '', None, 'The charger: rectifiers, contactors, metering. Shown as its envelope only.',
                                 {'output': 'about 350 kW DC (the twin site: 10,500 kW over 30 posts)'}, 'buy',
                                 reference=True)),
            Location(), (0, 0, -260))

    # ═══════════════════════════════════════════════════════ THE ARM (build_chain, above) ═══
    _c = build_chain(m, base, S, H, LU, LF, LW, radii, plate_under)
    j1, j2, j3, j4, j6, tur, upper, fore = (_c[k] for k in ('j1', 'j2', 'j3', 'j4', 'j6', 'tur', 'upper', 'fore'))


    # ═════════════════════════════════════════════════════════════ TOOL ═══
    tool = j6.child('Tool', loc(0, 0, 0), sub='TOOL')
    build_tool(m, tool, LT)

    # ════════════════════════════════════════════════════════ POWER PATH ═══
    # Chase, 2026-11-11: "I dont think there should be an exposed cable that the arm pulls to extend out of a pulley. The
    # wire needs to either be safely mounted inside the arm, or to the outside, OR charging is integrated into the arm".
    # So there is no take-up wheel and no free span. The charge current runs IN the arm:
    #   - in the riser and in each hollow link, 2 insulated copper bars (DC+ and DC-), 40 x 10 mm;
    #   - across each of J1, J2 and J3, a link of braided copper in a sealed boot, between 2 terminal boxes;
    #   - from the forearm to the connector, one last booted link, 1.2 m, across the 3 wrist joints.
    # Why not through the joints: each joint's through-bore is the bore of its gear's cup hub, 24 mm at J2 down to 9 mm
    # at J6 (actuator._output_flange). That passes the joints' 10 mm cable and nothing more. A booted link beside the
    # joint needs no bore, and a braid bends far tighter than the 357 mm the one-piece liquid-cooled cable needed (design
    # finding 11: that cable had no way across J1, J2 or J3).
    # Bar size: 400 mm2 a pole. A copper bar carries about 1.4 to 1.8 A/mm2 continuous as a rule of thumb, so 560 to 720 A
    # for 500 A of charge (https://payapress.com/busbar-sizing/, read 2026-11-11; a rule of thumb, not a rating: check
    # the bar against the Copper Development Association's ampacity tables before it is bought). The connector's contacts
    # are still liquid-cooled: 2 coolant tubes of 8 mm, the tool's cable and its 6 mm air line run with the bars and
    # through every boot.
    # Each link's length and ends were searched over the twin's 20 poses (flex.solve): the tightest bend is given beside
    # each one, against the boot's 80 mm.
    R_BOOT, MB_BOOT = 30.0, 80.0
    BOOT_SPEC = {'conductors': '2 x 400 mm2 braided copper, tinned, insulated for 1000 V DC', 'boot': 'silicone bellows, OD 60 mm, IP67',
                 'also inside': '2 coolant tubes 8 mm, tool cable (EtherCAT + 24 V), air 6 mm', 'bend radius': '80 mm moved'}

    def tbox(node, casting, centre, size, pid, name, fn, kg, explode):
        """A terminal box that sits on a casting: a block cut to the casting's own surface, so it touches and never overlaps."""
        b = cq.Workplane('XY').box(*size).translate(centre).edges().fillet(8)
        if casting is not None:
            b = b.cut(cq.Workplane('XY').add(casting.val()))
        sol = max(b.val().Solids(), key=lambda q: q.Volume()) if len(b.val().Solids()) > 1 else b.val()
        m.place(node, m.part(PartDef(pid, name, sol, 'al6061_blk', 'electrical', 'made to order', ' x '.join(f'{v:.0f}' for v in size),
                                     'IP67', None, fn,
                                     {'terminals': '2 x 500 A DC, bolted M12, touch-safe covers', 'bars in the link': '2 x 40 x 10 mm copper, insulated',
                                      'rating basis': 'about 1.4 to 1.8 A/mm2, rule of thumb'}, 'buy', mass_override=kg)),
                Location(), explode, 'DRESS')

    # the riser's back holds the cable trunk up to its top plate, so the riser's box and the J1 link are on its side
    tbox(base, None, (-riser_w / 2 - 25.0, -150.0, -100.0), (50.0, 110.0, 130.0), 'CHG-PB0', 'DC terminal box, riser',
         'Takes the 2 copper bars up the riser from the cabinet trunk and hands the current to the J1 flex link.', 3.0, (-160, 0, 0))
    tbox(j1, tur, (0.0, 265.0, -180.0), (130.0, 240.0, 80.0), 'CHG-PB1', 'DC junction box, turret',
         'Joins the J1 flex link to the J2 flex link on the turret\'s back.', 6.0, (0, 0, -180))
    tbox(j2, upper, (0.0, 300.0, -140.0), (110.0, 130.0, 80.0), 'CHG-PB2', 'DC terminal box, upper arm, shoulder end',
         'Takes the J2 flex link into the 2 copper bars that run inside the upper arm.', 5.0, (0, 0, -180))
    tbox(j2, upper, (0.0, LU - 250.0, -125.0), (104.0, 130.0, 80.0), 'CHG-PB3', 'DC terminal box, upper arm, elbow end',
         'Brings the upper arm\'s bars out to the J3 flex link.', 5.0, (0, 0, -180))
    tbox(j3, fore, (FORE_JOG[0], 250.0, -90.0), (104.0, 130.0, 80.0), 'CHG-PB4', 'DC terminal box, forearm, elbow end',
         'Takes the J3 flex link into the 2 copper bars that run inside the forearm.', 4.5, (0, 0, -180))
    tbox(j3, fore, (85.0, LF - 420.0, 0.0), (80.0, 130.0, 104.0), 'CHG-PB5', 'DC terminal box, forearm, wrist end',
         'Brings the forearm\'s bars out to the wrist flex link.', 4.5, (180, 0, 0))
    # no box on the wrist yoke: J4's bearing, J5's cheek and their screws fill both of its sides (the clash check found a
    # box there in all of them), so one link crosses J4, J5 and J6 from the forearm's box to the connector

    def boot(pid, name, a, b, L, bulge, fn, radius_note, hk=0.5):
        m.flex(FlexDef(pid, name, 'loop', a, b, R_BOOT, 'DRESS', fn, mat='cable', category='electrical', length=L,
                       min_bend=MB_BOOT, bulge=bulge, hk=hk, kg_per_m=9.5, size=f'OD 60 x {L:.0f}', standard='IEC 61238-1 (lugs)',
                       spec={**BOOT_SPEC, 'length': f'{L:.0f} mm', 'tightest bend over the twin\'s poses': radius_note}))

    # every link leaves and arrives square to its box's face, so its end sits flush on the box and never inside it
    NX, PX, NZ, PZ = (-1, 0, 0), (1, 0, 0), (0, 0, -1), (0, 0, 1)
    boot('CHG-FL1', 'J1 flex link, 500 A braided copper in a boot', Anchor(base, (-riser_w / 2 - 50.0, -150.0, -100.0), NX),
         Anchor(j1, (-65.0, 200.0, -190.0), PX), 900.0, (0.0, NX, NX),
         'Carries the charge current across J1, from the riser to the turret, as the base turns.',
         '115 mm with the base turned 50 degrees either way', hk=0.4)
    boot('CHG-FL2', 'J2 flex link, 500 A braided copper in a boot', Anchor(j1, (0.0, 340.0, -220.0), NZ),
         Anchor(j2, (0.0, 300.0, -180.0), PZ), 1000.0, (0.0, NZ, NZ),
         'Carries the charge current across J2, behind the shoulder.', '124 mm', hk=0.4)
    boot('CHG-FL3', 'J3 flex link, 500 A braided copper in a boot', Anchor(j2, (0.0, LU - 250.0, -165.0), NZ),
         Anchor(j3, (FORE_JOG[0], 250.0, -130.0), PZ), 1200.0, (0.0, (0, 0.5, -1), (0, -0.5, -1)),
         'Carries the charge current over the outside of the elbow.', '100 mm')
    boot('CHG-FL4', 'Wrist flex link to the connector, 500 A braided copper in a boot',
         Anchor(j3, (125.0, LF - 420.0, -30.0), PX), Anchor(tool, TOOL_OUTLET, TOOL_OUTLET_IN), 1200.0, (0.0, PX, PX),
         'Carries the charge current, the coolant and the tool\'s signals and air from the forearm to the connector, '
         'across J4, J5 and J6.', '150 mm', hk=0.4)

    # ═════════════════════════════════════════════════════════════ SAFETY ═══
    sc = (cq.Workplane('XY').box(110, 150, 104, centered=(True, False, True)).edges('|Y').fillet(10)
          .faces('<Y').shell(-3)
          .union(cq.Workplane('XZ', origin=(0, 150, 0)).circle(48).circle(45).extrude(-60))
          .union(cq.Workplane('XZ', origin=(0, 150, 0)).circle(50).circle(46).extrude(-4)))
    m.place(base, m.part(PartDef('CHG-SCN', 'Safety laser scanner, 275 degrees', sc.val(), 'a356', 'sensor',
                                 'IEC 61496-3, type 3', 'protective field up to 5.5 m', 'PL d / SIL 2', None,
                                 'Watches the stall at knee height. A person in the field stops the arm.', {}, 'buy')),
            loc(0, pad_top + 220, riser_w / 2, rx=90), (0, 0, 140), 'SAFETY')
    for x in (-38, 38):
        m.place(base, std.shcs(6, 16, 'A2-70', 'Holds the scanner bracket.'), std.orient((x, pad_top + 230, riser_w / 2 + 4), (0, 0, -1)),
                (0, 0, 160), 'SAFETY')
    es = (cq.Workplane('XY').box(72, 72, 60, centered=(True, True, False)).edges('|Z').fillet(6)
          .union(cq.Workplane('XY', origin=(0, 0, 60)).circle(20).extrude(12))
          .union(cq.Workplane('XY', origin=(0, 0, 72)).circle(28).extrude(14).faces('>Z').edges().fillet(6)))
    m.place(base, m.part(PartDef('CHG-EST', 'Emergency stop, 40 mm mushroom', es.val(), 'led_red', 'electrical',
                                 'IEC 60947-5-5', 'twist to release', '', None,
                                 'Cuts motor power to every joint (safe torque off). The brakes hold the arm.', {}, 'buy')),
            loc(riser_w / 2, pad_top + 300, 0, ry=90), (120, 0, 0), 'SAFETY')
    m.notes['torque_budget'] = torque_budget(m, j1, j2, j3, j4, H, LU, LF, S)
    return m


def build_ft_sensor(m: Model, tool: Node, sub: str | None = None) -> float:
    """The 6-axis force and torque sensor on the J6 tool flange, with its 4 screws and its dowel (tool frame: origin at
    the flange face, +Y out). Returns its outer face's y. The charge arm's connector tool and the wash bay's detail
    arms' polishing head both start with it."""
    # ISO 9409-1-50-4-M6 on a size 20 output (pitch circle 50, 4 x M6, spigot 31.5): the adapter starts here
    y = 0.0
    ft = (cq.Workplane('XZ', origin=(0, y, 0)).circle(52).extrude(-40).faces('>Y').edges().chamfer(1.5)
          .cut(cq.Workplane('XZ', origin=(0, y + 41, 0)).circle(20).extrude(42))
          .cut(cq.Workplane('XZ', origin=(0, y + 41, 0)).pushPoints([(p[0], p[2]) for p in std.circle_points(4, 25, 'y', start=45)])
               .circle(5.5).extrude(29))                    # counterbores for the flange screws
          .union(cq.Workplane('XY').box(22, 24, 14).translate((44, y + 20, 0))))
    m.place(tool, m.part(PartDef('CHG-FTS', '6-axis force and torque sensor', ft.val(), 'al6061', 'sensor',
                                 'ISO 9409-1-50-4-M6 both faces', 'OD 104 x 40', '', None,
                                 'Reads the 3 forces and 3 torques at the tool. The arm stops the insertion past its force limit.',
                                 {'range': 'Fz 1,000 N, Fxy 500 N, Txyz 40 N m', 'rate': '1 kHz'}, 'buy')),
            Location(), (0, 60, 0), sub)
    for p in std.circle_points(4, 25, 'y', offset=y + 12, start=45):
        m.place(tool, std.shcs(6, 20, '12.9', 'Holds the sensor to the J6 tool flange (ISO 9409-1).'), std.orient(p, (0, -1, 0)), (0, 80, 0), sub)
    m.place(tool, std.dowel(6, 12), loc(0, 40, 25), (0, 70, 0), sub)
    return 40.0


def build_tool(m: Model, tool: Node, LT: float) -> None:
    """The connector tool on the J6 flange (tool frame: origin at the flange face, +Y out along the tool axis)."""
    build_ft_sensor(m, tool)
    y = 40.0
    cu = (cq.Workplane('XZ', origin=(0, y, 0)).circle(56).extrude(-12)
          .union(cq.Workplane('XZ', origin=(0, y + 48, 0)).circle(56).extrude(-12)))
    springs = []
    for i in range(3):
        a = 2 * math.pi * i / 3 + math.pi / 6
        springs.append(cq.Solid.makeCylinder(9, 36, Vector(42 * math.cos(a), y + 12, 42 * math.sin(a)), Vector(0, 1, 0)))
    cu_pd = m.part(PartDef('CHG-CMP', 'Compliance unit (passive float, lockable)', cq.Compound.makeCompound(cu.vals() + springs),
                           'al6061_blk', 'tool', 'made to order', 'OD 112 x 60', '', None,
                           'Lets the connector float 6 mm and 3 degrees on 3 springs. A pneumatic pin locks it rigid for moves.',
                           {'float': '+/- 6 mm, +/- 3 deg', 'lock': 'pneumatic, 6 bar'}, 'make'))
    m.place(tool, cu_pd, Location(), (0, 120, 0))
    for p in std.circle_points(6, 46, 'y', offset=y + 12, start=0):
        m.place(tool, std.shcs(5, 14, '12.9', 'Holds the compliance unit plates.'), std.orient(p, (0, -1, 0)), (0, 140, 0))
    y = 100.0
    # connector body: a moulded housing on a machined holder, nose toward +Y, face at the TCP
    face_y = LT
    holder = (cq.Workplane('XZ', origin=(0, y, 0)).circle(58).extrude(-14)
              .union(cq.Workplane('XY').box(90, 60, 30, centered=(True, False, True)).translate((0, y + 14, 50 + 15))))
    m.place(tool, m.part(PartDef('CHG-CHL', 'Connector holder', holder.val(), 'al6061', 'tool', 'machined', 'OD 116',
                                 '6061-T6', None, 'Holds the connector body and the camera pod on the tool axis.', {}, 'make')),
            Location(), (0, 160, 0))
    body_len = face_y - (y + 14) - 46
    body = (cq.Workplane('XZ', origin=(0, y + 14, 0)).circle(50).workplane(offset=-body_len * 0.6).circle(46).loft()
            .union(cq.Workplane('XZ', origin=(0, y + 14 + body_len * 0.6, 0)).circle(46).extrude(-body_len * 0.4))
            .union(cq.Workplane('XY').box(60, 70, 8).translate((0, 175, -46))))       # the pad the cable outlet housing bolts to
    m.place(tool, m.part(PartDef('CHG-CON', 'DC combo connector body, robotic', body.val(), 'pa66', 'tool',
                                 'IEC 62196-3 / SAE J1772 combo interface', 'body OD 100', '', None,
                                 'Carries the DC and signal contacts to the inlet. The coolant flows to the contacts inside.',
                                 {'current': '500 A, liquid-cooled', 'voltage': '1000 V DC'}, 'buy')),
            Location(), (0, 200, 0))
    nose_y0 = y + 14 + body_len
    nose = (cq.Workplane('XZ', origin=(0, nose_y0, 0)).circle(40).workplane(offset=-(face_y - nose_y0)).circle(36).loft()
            .faces('>Y').workplane().pushPoints([(0, 12)]).hole(43.8, 6))
    pts_dc = [(-14, -14), (14, -14)]
    pts_sig = [(0, 22), (-12, 8), (12, 8)]
    nose = nose.faces('>Y').workplane().pushPoints(pts_dc).hole(15, 30)        # the sockets press into these
    nose = nose.faces('>Y').workplane().pushPoints(pts_sig).hole(5.6, 30)
    r_or = 36 + 4 * (4 / (face_y - nose_y0))            # the nose's radius at the O-ring, 4 mm from the face
    nose = nose.cut(cq.Workplane('XZ', origin=(0, face_y - 2.5, 0)).circle(r_or + 1).circle(r_or - 2.6).extrude(3))
    m.place(tool, m.part(PartDef('CHG-NOS', 'Connector nose and face', nose.val(), 'pa66', 'tool', 'moulded',
                                 f'OD 80 x {face_y - nose_y0:.0f}', '', None,
                                 'Enters the inlet. Its shape guides the last few millimetres.', {}, 'make')),
            Location(), (0, 240, 0))
    dc = (cq.Workplane('XZ').circle(7.5).circle(4.2).extrude(-26))
    dc_pd = m.part(PartDef('CHG-DCC', 'DC contact socket, 8 mm', dc.val(), 'silver', 'tool', 'IEC 62196-3', '8 mm pin',
                           'silver plated', None, 'Carries the DC current. Spring bands give low resistance.', {}, 'buy'))
    for (u, v) in pts_dc:                                # a '>Y' face workplane maps (u, v) to world (x, z) = (-u, v)
        m.place(tool, dc_pd, loc(-u, face_y - 26, v), (0, 260, 0))
    sig = cq.Workplane('XZ').circle(2.8).circle(1.6).extrude(-18)
    sig_pd = m.part(PartDef('CHG-SGC', 'Signal contact socket, 3 mm (PE, CP, PP)', sig.val(), 'silver', 'tool',
                            'IEC 62196-3', '3 mm pin', 'silver plated', None,
                            'Protective earth, control pilot and proximity: the car and charger talk on CP.', {}, 'buy'))
    for (u, v) in pts_sig:
        m.place(tool, sig_pd, loc(-u, face_y - 24, v), (0, 260, 0))
    latch = (cq.Workplane('XY').box(16, 70, 14).translate((0, face_y - 30, 46 + 7))
             .union(cq.Workplane('XY').box(16, 14, 22).translate((0, face_y + 7, 41))))
    m.place(tool, m.part(PartDef('CHG-LAT', 'Connector latch hook', latch.val(), 'ss304', 'tool', 'machined', '16 x 70',
                                 '', None, 'Hooks the inlet catch. The car cannot pull the connector out under load.', {}, 'make')),
            Location(), (0, 230, 50))
    sol = cq.Workplane('XY').box(36, 46, 30).edges('|Y').fillet(4).translate((0, face_y - 90, 46 + 15))
    m.place(tool, m.part(PartDef('CHG-SOL', 'Latch solenoid, 24 V', sol.val(), 'steel_paint', 'tool', 'catalogue part',
                                 '36 x 46 x 30', '', None, 'Moves the latch hook. A spring locks it when power is off.',
                                 {'force': '35 N at 5 mm stroke'}, 'buy')), Location(), (0, 200, 90))
    # vision pod: a sealed enclosure looking along +Y, with its parts inside (an x-ray or a cut shows them)
    pc = (0, y + 50, 50 + 30 + 20)               # pod centre: on the holder's bracket
    pod = (cq.Workplane('XY').box(110, 34, 40).edges('|Y').fillet(5).faces('>Y').shell(-2.5).translate(pc))
    m.place(tool, m.part(PartDef('CHG-VIS', 'Vision pod housing, IP67', pod.val(), 'a356_dark', 'sensor', 'die casting, machined',
                                 '110 x 40 x 34', 'IP67', None,
                                 'Holds the 2 cameras, the depth sensor and the light, sealed behind one window.',
                                 {'stereo base': '60 mm', 'depth': 'time-of-flight, 0.1-2 m', 'light': '850 nm'}, 'make')),
            Location(), (0, 160, 140))
    win = cq.Workplane('XY').box(104, 3, 34).translate((pc[0], pc[1] + 17 + 1.5 + 1.5, pc[2]))     # on its gasket
    m.place(tool, m.part(PartDef('CHG-VWN', 'Vision pod window, coated glass', win.val(), 'lens', 'sensor', 'catalogue part', '104 x 34 x 3',
                                 'anti-reflective, hydrophobic', None, 'Seals the front. Its coating sheds rain and road film.', {}, 'buy')),
            Location(), (0, 230, 140))
    gk = (cq.Workplane('XY').box(108, 1.5, 38).cut(cq.Workplane('XY').box(98, 3, 28))).translate((pc[0], pc[1] + 17 + 0.75, pc[2]))
    m.place(tool, m.part(PartDef('CHG-VGK', 'Vision pod window gasket', gk.val(), 'nbr', 'seal', 'cut gasket', '108 x 38 x 1.5', 'EPDM', None,
                                 'Seals the window to the housing (IP67). The window is bonded to it.', {}, 'buy')), Location(), (0, 210, 140))
    cam = (cq.Workplane('XY').box(30, 4, 26).translate((0, -6, 0))
           .union(cq.Workplane('XZ', origin=(0, 10, 0)).circle(7).extrude(14)))
    cam_pd = m.part(PartDef('CHG-CAM', 'Camera module, global shutter, 2 MP', cam.val(), 'pcb', 'sensor', 'catalogue part',
                            '30 x 26, M12 lens', '', None, 'One eye of the stereo pair. 2 views give the inlet depth and angle.',
                            {'shutter': 'global', 'lens': 'M12, 6 mm'}, 'buy'))
    for x in (-30, 30):
        m.place(tool, cam_pd, loc(pc[0] + x, pc[1] - 17 + 2.5 + 8, pc[2]), (x * 2, 190, 160))
    tof = (cq.Workplane('XY').box(20, 4, 16).translate((0, -6, 0))
           .union(cq.Workplane('XZ', origin=(-4, 4, 0)).circle(2.5).extrude(6))
           .union(cq.Workplane('XZ', origin=(4, 4, 0)).circle(2.5).extrude(6)))
    m.place(tool, m.part(PartDef('CHG-TOF', 'Time-of-flight depth module', tof.val(), 'pcb', 'sensor', 'catalogue part', '20 x 16',
                                 '', None, 'Measures the distance to the inlet face. It checks the stereo depth.', {'range': '0.1-2 m'}, 'buy')),
            loc(pc[0], pc[1] - 17 + 2.5 + 8, pc[2] + 8), (0, 200, 190))
    ir = cq.Workplane('XY').box(90, 1.6, 8).translate((0, 0, 0))
    for k in range(8):
        ir = ir.union(cq.Workplane('XZ', origin=(-38 + k * 76 / 7, 0.8, 0)).circle(2.5).extrude(-3))
    m.place(tool, m.part(PartDef('CHG-IRB', 'IR illuminator board, 8 LEDs, 850 nm', ir.val(), 'pcb', 'sensor', 'made to order', '90 x 8',
                                 '', None, 'Lights the inlet for the cameras at night and in direct sun.', {}, 'buy')),
            loc(pc[0], pc[1] + 10, pc[2] - 20 + 2.5 + 4), (0, 210, 120))
    for xx in (-45, 45):                                 # from inside the pod, through its floor into the bracket
        m.place(tool, std.shcs(4, 12, 'A2-70', 'Holds the vision pod to the holder.'),
                std.orient((xx, pc[1] - 10, pc[2] - 20 + 2.5), (0, 0, -1)), (0, 140, 140))
    # the connector's face seal and its nose bumper
    m.place(tool, std.oring(round(2 * (r_or - 1.1) - 3), 3, 'Seals the connector nose in the inlet against rain.'),
            loc(0, face_y - 4, 0), (0, 300, 0))
    r_b = 40 - 4 * (28 / (face_y - nose_y0))             # the nose's radius at the bumper's foot
    bump = cq.Workplane('XZ', origin=(0, face_y - 18, 0)).circle(43).circle(r_b).extrude(-12)
    m.place(tool, m.part(PartDef('CHG-BMP', 'Connector nose bumper, TPE', bump.val(), 'rubber', 'tool', 'moulded', 'OD 86 x 12', '', None,
                                 'Takes a light knock on the inlet rim without damage. The force sensor stops the arm.', {}, 'buy')),
            Location(), (0, 280, 0))
    # the cable outlet: a housing on the body's pad, its elbow down and round to a swivel gland that points out along +X
    o = tuple(-c for c in TOOL_OUTLET_IN)
    L_g = std.gland_length(50) + 12.0                    # the dome and 12 mm for the swivel to turn the cable in
    F = tuple(TOOL_OUTLET[k] - L_g * o[k] for k in range(3))             # the gland's seat
    s_c = (F[0] + 92) / o[0]                                             # the elbow's corner, under the block
    C = tuple(F[k] - s_c * o[k] for k in range(3))
    elbow = std._bent_tube_shape(((-92.0, 172.0, -60.0), C, F), 32.0, 0.0, 45.0)
    coh = (cq.Workplane('XY').box(142, 65, 30).translate((-41, 172.5, -65)).union(cq.Workplane('XY').add(elbow))
           .cut(cq.Workplane('XY').add(cq.Solid.makeCylinder(25.5, 24.0, Vector(*F), Vector(*(-c for c in o))))))   # the M50 thread
    m.place(tool, m.part(PartDef('CHG-COH', 'Cable outlet housing, glass-filled PA66', coh.val(), 'pa66', 'tool', 'moulded',
                                 '142 x 65, elbow D 64', 'PA66-GF30', None,
                                 'Leads the charge cable out of the connector body to the side, so the span leaves along J5\'s axis.',
                                 {}, 'make')), Location(), (-60, 200, -60))
    for (xs, ys) in ((-20, 150), (20, 150), (-20, 195), (20, 195)):
        m.place(tool, std.shcs(6, 40, 'A2-70', 'Holds the cable outlet housing to the connector body.'),
                std.orient((xs, ys, -80), (0, 0, 1)), (-60, 200, -90))
    swg = PartDef('GLAND-M50S', 'Swivel cable gland M50 x 1.5, ball joint 35 degrees, IP67', std._gland_shape(50), 'pa66',
                  'electrical', 'IEC 62444', 'M50 x 1.5, cable 30 to 38', 'IP67', None,
                  'Seals the cable into the outlet and lets it leave at up to 35 degrees off the axis without a kink.', {}, 'buy')
    m.place(tool, swg, std.orient(F, TOOL_OUTLET_IN), (-80, 200, -80))


def _ik_q2(along: float, height: float, S: dict) -> float:
    """J2 for a port at (along, height above grade) on the near flank, entering square to it (the twin's IK)."""
    tl = S['wrist'] + S['tool']
    x, y, z = along, height - S['mountHeight'], S['flankStandoff'] - tl
    fwd, up = math.hypot(x, z), y - S['shoulderHeight']
    r = math.hypot(fwd, up)
    L2, L3 = S['upperArm'], S['forearm']
    q3 = math.acos(max(-1, min(1, (r * r - L2 * L2 - L3 * L3) / (2 * L2 * L3))))
    return math.atan2(fwd, up) - math.atan2(L3 * math.sin(q3), L2 + L3 * math.cos(q3))


def torque_budget(m: Model, j1: Node, j2: Node, j3: Node, j4: Node, H: float, LU: float, LF: float,
                  S: dict | None = None) -> dict:
    """Gravity torque at J2 and J3 with the arm stretched horizontal (the worst pose), from the CAD masses,
    and what the J2 balancer leaves for the gear over the joint's travel."""
    from ..std import SWG_RATING
    m_j3, c_j3 = m.mass_props(j3)
    m_j2, c_j2 = m.mass_props(j2)
    cable = 4.0                                # kg of the wrist flex link and its coolant at the tool (ASSUMPTION)
    t3 = (m_j3 * c_j3.y / 1000.0 + cable * (LF + 600) / 1000.0) * G
    t2 = (m_j2 * c_j2.y / 1000.0 + cable * (LU + LF + 600) / 1000.0) * G
    # balancer: a nitrogen gas spring, F(d) = F0 + k (d0 - d) with the force rising GAS_PROGRESSION over its
    # stroke (a gas spring's own progression). F0 is chosen by a search that minimises the worst torque left
    # for the gear over the balancer's travel (0..110 deg; the joint is symmetric). A search over the rate as
    # well picks k = 0, a constant force: that is what says the balancer should be gas, not a coil spring.
    a, r = BAL_A / 1000.0, BAL_R / 1000.0
    d0 = a + r
    d = lambda q: math.sqrt(a * a + r * r + 2 * a * r * math.cos(q))  # noqa: E731
    qs = [math.radians(x) for x in range(0, 111, 2)]

    def residual(F0: float, k: float) -> float:
        return max(abs(t2 * math.sin(q) - (F0 + k * (d0 - d(q))) * a * r * math.sin(q) / d(q)) for q in qs)

    stroke = d0 - d(math.radians(110))
    best = (1e18, 0.0, 0.0)
    for F0 in range(500, 14001, 50):
        k = GAS_PROGRESSION * F0 / stroke
        w = residual(F0, k)
        if w < best[0]:
            best = (w, float(F0), float(k))
    worst, F0, k = best
    q90 = math.pi / 2
    F90 = F0 + k * (d0 - d(q90))
    curve = []
    for deg_ in range(0, 111, 10):
        q = math.radians(deg_)
        tb = (F0 + k * (d0 - d(q))) * a * r * math.sin(q) / d(q)
        tg = t2 * math.sin(q)
        curve.append({'deg': deg_, 'gravityNm': round(tg), 'balancerNm': round(tb), 'gearNm': round(tg - tb)})
    service = []
    if S:
        for al in (-1.0, 0.0, 1.0):
            for h in (0.48, 0.96, 1.44):
                service.append(math.degrees(_ik_q2(al, h, S)))
    return {
        'method': 'Gravity torque with the arm stretched horizontal, masses from the CAD solids, plus 4 kg for '
                  'the wrist flex link at the tool (ASSUMPTION). Dynamics are not included.',
        'J3': {'distalMassKg': round(m_j3 + cable, 1), 'torqueNm': round(t3), 'gear': 'size 40',
               'repeatedPeakNm': SWG_RATING[40][0], 'margin': round(SWG_RATING[40][0] / t3, 2)},
        'J2': {'distalMassKg': round(m_j2 + cable, 1), 'torqueNm': round(t2), 'gear': 'size 50',
               'repeatedPeakNm': SWG_RATING[50][0], 'gearWorstNm': round(worst),
               'margin': round(SWG_RATING[50][0] / worst, 2),
               'balancer': {'type': 'nitrogen gas spring', 'anchorBelowAxisMm': BAL_A, 'crankAboveAxisMm': BAL_R,
                            'forceExtendedN': round(F0), 'progression': GAS_PROGRESSION,
                            'forceAt90N': round(F90), 'strokeMm': round(stroke * 1000), 'travelDeg': 110},
               'curve': curve},
        'serviceWindowJ2Deg': {'min': round(min(service), 1), 'max': round(max(service), 1)} if service else None,
    }
