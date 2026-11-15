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
# THE STATUS RINGS' SUPPLY (2026-11-15). Each ring is lit by the drive of the joint it sits on, as a robot joint's own
# light is: the J2 drive lights the 2 J2 rings and the J6 drive the wrist ring. The model had said the safety cable fed
# them, and no route reached them (the boots never carried it, and the safety controller has no business lighting a
# status ring). ASSUMPTION: each drive gives a 24 V auxiliary output and a data line for its ring (the drive's maker
# confirms them); the rings take about 8 W.
RING_LEAD_D = 4.5     # the ring lead: 4 x 0.25 mm2, PUR, chain-rated
RING_LEAD_R = 18.0    # its fixed bend, 4 x d
RING_CH_R = 3.25      # the channel cored through the turret's boss for the jumper between the 2 J2 rings
RC2_X = -60.0         # the J2 ring receptacle on J2's rear bell: its x (J1 frame), clear of the drum's step at -35
RC2_PHI = -45.0       # and its angle about the J2 axis from +Y toward +Z: up and to the back, where neither the upper
                      # arm's bridge (at the arm's angle +/- 37 deg, 156 mm out) nor the balancer (+Z side) ever passes
RC2_H = 22.0          # the receptacle and its mated plug stand 22 mm off the bell (a straight M8 pair)
# THE CASTINGS' PORTS (2026-11-15): where the charge arm's DC path passes a casting's wall between a terminal box and
# the copper inside the link. U1 and U2 are in the upper arm's back wall under CHG-PB2 and CHG-PB3, each the size of the
# opening the bar pack goes in by; F1 is in the forearm's back wall under CHG-PB4 and F2 in its +X wall under CHG-PB5,
# each a slot the 2 flexible conductors pass. Each box closes its port. The castings are the wash bay's detail arms' too
# (build_chain), so they carry the same ports there, each closed by a plug moulded to it (wash_gantry).
PORT_U = (80.0, 100.0)        # an upper arm port: across the arm (x) by along it (y)
PORT_U_Y = (300.0, 250.0)     # U1 at y = 300 (under CHG-PB2), U2 at LU - 250 (under CHG-PB3)
FC_D, FC_GAP = 26.0, 6.0      # the forearm's 2 flexible conductors: their diameter and the gap between them
PORT_F1_Y = 250.0             # F1 under CHG-PB4, at FORE_JOG[0]
PORT_F2 = (420.0, -20.0)      # F2 under CHG-PB5: at LF - 420, and z = -20 (the conductors' height in the forearm)
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



# ═══════════════════════════════════════════════════════ supply-line helpers ═══


def _bx(x0: float, x1: float, y0: float, y1: float, z0: float, z1: float) -> cq.Workplane:
    """A box by its 6 limits."""
    return cq.Workplane('XY').box(x1 - x0, y1 - y0, z1 - z0, centered=False).translate((x0, y0, z0))


def _hits(shape, p: tuple, d: tuple) -> list[float]:
    """Every crossing of a solid's faces on the line through p along the unit d, as signed distances from p, sorted."""
    ray = IntCurvesFace_ShapeIntersector()
    ray.Load(shape.wrapped, 1e-6)
    ray.Perform(gp_Lin(gp_Pnt(*p), gp_Dir(*d)), -1.0e4, 1.0e4)
    return sorted(ray.WParameter(i) for i in range(1, ray.NbPnt() + 1))


def _bent_wire(points: list, radii: list) -> tuple[cq.Wire, float]:
    """Straight runs between `points`, corner i bent on its own centreline radius radii[i - 1]: the wire and its length."""
    P = [Vector(*p) for p in points]
    edges, cur, length = [], P[0], 0.0
    for i in range(1, len(P) - 1):
        u1, u2 = (P[i] - P[i - 1]).normalized(), (P[i + 1] - P[i]).normalized()
        ang = math.acos(max(-1.0, min(1.0, u1.dot(u2))))
        R = radii[i - 1]
        t = R * math.tan(ang / 2)
        if t > (P[i] - cur).Length + 1e-6 or t > (P[i + 1] - P[i]).Length + 1e-6:
            raise ValueError(f'a bend of R {R:g} does not fit at corner {i} of {points}')
        p_in, p_out = P[i] - u1 * t, P[i] + u2 * t
        centre = P[i] + (u2 - u1).normalized() * (R / math.cos(ang / 2))
        mid = centre + (P[i] - centre).normalized() * R
        if (p_in - cur).Length > 1e-6:
            edges.append(cq.Edge.makeLine(cur, p_in))
        edges.append(cq.Edge.makeThreePointArc(p_in, mid, p_out))
        length += (p_in - cur).Length + R * ang
        cur = p_out
    edges.append(cq.Edge.makeLine(cur, P[-1]))
    length += (P[-1] - cur).Length
    return cq.Wire.assembleEdges(edges), length


def _bent_bar(points: list, radii: list, w: float, t: float, wdir: tuple = (1.0, 0.0, 0.0)) -> tuple[cq.Shape, float]:
    """A bar of section w (along wdir) by t, along straight runs between `points` that all lie in one plane normal to wdir,
    corner i bent flatwise on its centreline radius radii[i - 1]. Returns the solid and its centreline length."""
    wire, length = _bent_wire(points, radii)
    P0, P1 = Vector(*points[0]), Vector(*points[1])
    prof = cq.Workplane(cq.Plane(origin=P0, xDir=Vector(*wdir), normal=(P1 - P0).normalized())).rect(w, t)
    return prof.sweep(cq.Workplane().add(wire), transition='right').val(), length


def _offset_path(points: list, side: list, d: float) -> list:
    """The polyline beside `points` at d along each segment's own side vector (unit, normal to the segment): its ends
    move straight, each corner to where the 2 neighbouring offset lines meet (nearest points, for lines that miss)."""
    import numpy as np
    P = [np.array(p, dtype=float) for p in points]
    S = [np.array(v, dtype=float) for v in side]
    out = [P[0] + d * S[0]]
    for i in range(1, len(P) - 1):
        a0, u = P[i - 1] + d * S[i - 1], P[i] - P[i - 1]
        b0, v = P[i] + d * S[i], P[i + 1] - P[i]
        w0 = a0 - b0
        A, B, C, D, E = u @ u, u @ v, v @ v, u @ w0, v @ w0
        den = A * C - B * B
        if abs(den) < 1e-9:                 # parallel: the corner just moves
            out.append(P[i] + d * S[i])
            continue
        sa, sb = (B * E - C * D) / den, (A * E - B * D) / den
        out.append(((a0 + sa * u) + (b0 + sb * v)) / 2)
    out.append(P[-1] + d * S[-1])
    return [tuple(float(c) for c in q) for q in out]


def _bent_tube(points: list, radii: list, r: float) -> tuple[cq.Shape, float]:
    """A round line of radius r along straight runs between `points`, corner i bent on its own centreline radius
    radii[i - 1] (std.swept bends every corner on one radius). Returns the solid and its length."""
    P = [Vector(*p) for p in points]
    edges, cur, length = [], P[0], 0.0
    for i in range(1, len(P) - 1):
        u1, u2 = (P[i] - P[i - 1]).normalized(), (P[i + 1] - P[i]).normalized()
        ang = math.acos(max(-1.0, min(1.0, u1.dot(u2))))
        R = radii[i - 1]
        t = R * math.tan(ang / 2)
        if t > (P[i] - cur).Length + 1e-6 or t > (P[i + 1] - P[i]).Length + 1e-6:
            raise ValueError(f'a bend of R {R:g} does not fit at corner {i} of {points}')
        p_in, p_out = P[i] - u1 * t, P[i] + u2 * t
        centre = P[i] + (u2 - u1).normalized() * (R / math.cos(ang / 2))
        mid = centre + (P[i] - centre).normalized() * R
        if (p_in - cur).Length > 1e-6:
            edges.append(cq.Edge.makeLine(cur, p_in))
        edges.append(cq.Edge.makeThreePointArc(p_in, mid, p_out))
        length += (p_in - cur).Length + R * ang
        cur = p_out
    edges.append(cq.Edge.makeLine(cur, P[-1]))
    length += (P[-1] - cur).Length
    d0 = (P[1] - P[0]).normalized()
    xd = d0.cross(Vector(1, 0, 0) if abs(d0.x) < 0.9 else Vector(0, 1, 0)).normalized()
    prof = cq.Workplane(cq.Plane(origin=P[0], xDir=xd, normal=d0)).circle(r)
    return prof.sweep(cq.Wire.assembleEdges(edges), transition='round').val(), length


def _csk(wp: cq.Workplane, pts: list, d: int) -> cq.Workplane:
    """Countersinks for ISO 10642 screws from the top face (y = top) at pts (x, top, z): each head sits flush."""
    dk, k, _ = std.ISO10642[d]
    for (x, top, z) in pts:
        wp = (wp.cut(cq.Workplane('XY').add(cq.Solid.makeCone(d / 2, dk / 2, k, pnt=Vector(x, top - k, z), dir=Vector(0, 1, 0))))
              .cut(cq.Workplane('XY').add(cq.Solid.makeCylinder(d / 2 + 0.5, 60, Vector(x, top - k - 60, z), Vector(0, 1, 0)))))
    return wp


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
    # the jumper between the 2 J2 status rings (below) runs in a channel cored along the boss's top, under the rings: at the
    # rings' radius it leaves 6 mm of wall to the bore and 6 to the outside, and no drum clamp screw stands at the top
    R_RING = boss2_od / 2 * 0.94
    tur = tur.cut(cq.Workplane('YZ', origin=(-L2['boss_w'], H + R_RING, 0)).circle(RING_CH_R).extrude(L2['boss_w'] * 2))
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
        ring = (cq.Workplane('XY').add(cq.Solid.makeTorus(R_RING, 5,
                                                          pnt=Vector(sx * (L2['boss_w'] / 2 + 5), H, 0), dir=Vector(1, 0, 0)))
                .cut(cq.Workplane('XY').box(60, 400, 600).translate((sx * (L2['boss_w'] / 2 + 5), H - 60 - 200, 0))))
        fed = ('J2\'s drive, by the ring lead (CHG-RL2) from its receptacle on J2\'s rear bell' if sx < 0 else
               'J2\'s drive, through the left ring and the jumper (CHG-RJ2) in the channel along the boss\'s top')
        m.place(j1, m.part(PartDef(f'CHG-J2-RING{"R" if sx > 0 else "L"}', 'Status light ring, J2', ring.val(), 'led',
                                   'electrical', 'LED strip in PC diffuser', f'OD {boss2_od * 0.94:.0f}', '', None,
                                   'Shows the arm state: teal ready, amber moving, green charging, red fault.',
                                   {'fed by': fed, 'lead entry': 'a grommet in the diffuser\'s back'}, 'buy')),
                Location(), (sx * 60, 0, 0), 'SAFETY')
    # ...and their supply: J2's drive lights them (RC2_* above). A straight M8 receptacle on the front of J2's rear bell,
    # wired inside the actuator to its drive board; a 4.5 mm lead from its plug, out and over into the left ring's back;
    # and a jumper from the left ring to the right one in the channel cored under them. Nothing else stands there: the
    # upper arm's bridge passes 156 mm out at the arm's own angle, the balancer stays on the +Z side, the J2 boot runs
    # within 30 mm of the arm's plane.
    r_bell2 = a2['rear_od'] / 2
    e2 = (0.0, math.cos(math.radians(RC2_PHI)), math.sin(math.radians(RC2_PHI)))
    def on_j2(x, r):
        return (x, H + r * e2[1], r * e2[2])
    rc2 = (cq.Workplane('XZ').circle(6.5).extrude(-2.0)
           .union(cq.Workplane('XZ', origin=(0, 2.0, 0)).polygon(6, 12.0).extrude(-4.0))
           .union(cq.Workplane('XZ', origin=(0, 6.0, 0)).circle(5.0).extrude(-(RC2_H - 6.0))))
    m.place(j1, m.part(PartDef('CHG-RRC2', 'M8 receptacle, 4-pin, with its plug: the J2 rings\' lead', rc2.val(), 'ss304', 'electrical',
                               'IEC 61076-2-104', 'M8, 4-pin, A-coded', 'IP67 mated', None,
                               'Brings the J2 drive\'s ring output out of the actuator. The ring lead\'s plug screws onto it.',
                               {'inside': 'wired to J2\'s drive board by the actuator\'s maker (ASSUMPTION)', 'rating': '4 A a pin, 30 V'}, 'buy')),
            std.orient(on_j2(RC2_X, r_bell2), tuple(-c for c in e2)), tuple(60 * c for c in e2), 'SAFETY')
    x_back = -(L2['boss_w'] / 2 + 10.0)                  # the left ring's back, at its tube's middle
    rl2 = std.swept('CHG-RL2', 'Ring lead, J2: receptacle to the left ring, 4 x 0.25 mm2', [on_j2(RC2_X, r_bell2 + RC2_H),
                    on_j2(RC2_X, R_RING), on_j2(x_back, R_RING)], RING_LEAD_D / 2, 'cable', 'electrical',
                    fn='Carries 24 V, 0 V and the data line from J2\'s drive to the 2 J2 rings.',
                    spec={'cable': '4 x 0.25 mm2, PUR, OD 4.5 mm', 'ends': 'a molded M8 plug; the ring\'s grommet'},
                    standard='IEC 61076-2-104 (plug)', size=f'D {RING_LEAD_D:g}', bend=RING_LEAD_R)
    m.place(j1, m.part(rl2), Location(), (-40, 40, 0), 'SAFETY')
    rj2 = cq.Workplane('YZ', origin=(-L2['boss_w'] / 2, H + R_RING, 0)).circle(RING_LEAD_D / 2).extrude(L2['boss_w'])
    m.place(j1, m.part(PartDef('CHG-RJ2', 'Ring jumper cable, J2: left ring to right ring, 4 x 0.25 mm2', rj2.val(), 'cable', 'electrical',
                               '', f'D {RING_LEAD_D:g} x {L2["boss_w"]:.0f}', '', None,
                               'Passes the ring supply from the left J2 ring to the right one, in the channel cored along the turret boss\'s top.',
                               {'cable': '4 x 0.25 mm2, PUR, OD 4.5 mm', 'channel': f'D {2 * RING_CH_R:g}, cored in the turret'}, 'buy')),
            Location(), (0, 60, 0), 'SAFETY').yard_hidden = True      # in the boss's channel, under the rings: unseen
    ring_info = {'rl2_mm': rl2.path_mm, 'rj2_mm': L2['boss_w']}
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
    # its 2 ports (PORT_U above): the place where each box closes it is the box's own business (charge_arm.build), so the
    # ported casting is the one placed and the whole one is kept for the boxes to be cut to
    ports = []
    upper_p = upper
    for k, (y_p, z_p) in enumerate(((PORT_U_Y[0], -135.0), (LU - PORT_U_Y[1], -118.0))):
        cut = cq.Workplane('XY').box(PORT_U[0], PORT_U[1], 40.0).edges('|Z').fillet(8.0).translate((0.0, y_p, z_p))
        ports.append({'id': f'U{k + 1}', 'node': j2, 'slug': upper.intersect(cut).val(), 'link': 'upper arm',
                      'where': ('the shoulder end, on the back', 'the elbow end, on the back')[k]})
        upper_p = upper_p.cut(cut)
    m.place(j2, m.part(PartDef('CHG-UPR', 'Upper arm casting', upper_p.val(), 'a356', 'structure', 'casting, machined',
                               f'{LU:.1f} between axes', 'A356-T6', None,
                               'Carries the elbow 1.344 m from the shoulder. Hollow for stiffness per kilogram.',
                               {'wall': '7 mm', 'axis distance': f'{LU:.1f} mm, bored in one set-up',
                                'ports': f'2 on the back, {PORT_U[0]:.0f} x {PORT_U[1]:.0f}: the charge arm\'s terminal boxes close them, '
                                         'the wash arms\' plugs'}, 'make')),
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
    # its 2 slots (PORT_F* above): the 2 conductors side by side across the forearm at F1, along it at F2
    fw, fh = 2 * FC_D + FC_GAP + 8.0, FC_D + 8.0
    fore_p = fore
    for k, cut in enumerate((
            cq.Workplane('XY').box(fw, fh, 40.0).edges('|Z').fillet(fh / 2 - 0.1).translate((FORE_JOG[0], PORT_F1_Y, -100.0)),
            cq.Workplane('XY').box(36.0, fw, fh).edges('|X').fillet(fh / 2 - 0.1).translate((88.0, LF - PORT_F2[0], PORT_F2[1])))):
        ports.append({'id': f'F{k + 1}', 'node': j3, 'slug': fore.intersect(cut).val(), 'link': 'forearm',
                      'where': ('the elbow end, on the back', 'the wrist end, on the side')[k]})
        fore_p = fore_p.cut(cut)
    m.place(j3, m.part(PartDef('CHG-FOR', 'Forearm casting', fore_p.val(), 'a356', 'structure', 'casting, machined',
                               f'{LF:.1f} elbow to wrist centre', 'A356-T6', None,
                               'Carries the wrist 1.142 m from the elbow. Its top socket holds J4.',
                               {'wall': '6 mm', 'ports': f'2 slots {fw:.0f} x {fh:.0f}: the charge arm\'s terminal boxes close them, '
                                                         'the wash arms\' plugs'}, 'make')), Location(), (0, 0, 180), 'FORE')
    fs_ = std.shcs(8, 40, '12.9', 'Holds the forearm cheek to the J3 output flange.')
    for p in out_flange_points(40):
        m.place(j3, fs_, std.orient((L3['out_x'] + 18, p[0], p[2]), (-1, 0, 0)), (140, 0, 0), 'FORE')

    # ═════════════════════════════════════════════════════════════ WRIST ═══
    yc = LF                                   # wrist centre, J3 frame
    j4 = j3.child(jp + 'J4_ForearmRoll', loc(0, y4_out, 0), sub='WRIST',
                  joint={'name': jp + 'J4', 'axis': [0, 1, 0], 'limits': S['limits']['j4'], 'kind': 'revolute',
                         'stowed': S['stowed']['j4']})
    a4 = build_actuator(m, j3, j4, 25, loc(0, y4_out, 0), Location(), 'CHG-J4', 'WRIST', gland_m=16)
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
          .cut(cq.Workplane('XZ', origin=(0, tube_top + 1, 0)).circle(r6).extrude(41))
          # the wrist ring's receptacle passes through the socket's wall on the side away from the cheek arm (below)
          .cut(cq.Workplane('YZ', origin=(-(r6 + 14), tube_top - 15, 0)).circle(4.6).extrude(18)))
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
    a6 = build_actuator(m, j5, j6, 20, loc(0, LW, 0), Location(), 'CHG-J6', 'WRIST', gland_m=16, gland_ang=J6_GLAND_ANG,
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
                               'Shows the arm state at the connector, where the camera and a person look.',
                               {'fed by': 'J6\'s drive: a 4-pin plug in the ring\'s back mates J6\'s ring receptacle (CHG-RRC6) '
                                          'through the wrist tube\'s socket'}, 'buy')),
            Location(), (0, 30, 0), 'SAFETY')
    # ...and its supply: J6's drive lights it. J6's rear bell sits in the wrist tube's socket and the ring wraps the
    # socket's outside, so the receptacle stands on the bell, wired inside to J6's drive board (which lies right behind
    # it), through a hole in the socket's wall, and the ring's own plug mates it: no cable in the open. (J6's rear cover
    # faces the wrist yoke 5 mm away, so a lead from a gland there has nowhere to go.)
    rc6 = cq.Workplane('XZ').circle(4.0).extrude(-10.0)
    m.place(j5, m.part(PartDef('CHG-RRC6', 'M8 receptacle, 4-pin, rear mount: the wrist ring\'s supply', rc6.val(), 'ss304', 'electrical',
                               'IEC 61076-2-104', 'M8, 4-pin, A-coded', 'IP67 mated', None,
                               'Brings the J6 drive\'s ring output out of the actuator, through the wrist tube\'s socket, to the ring\'s plug.',
                               {'inside': 'wired to J6\'s drive board by the actuator\'s maker (ASSUMPTION)', 'rating': '4 A a pin, 30 V'}, 'buy')),
            std.orient((-r6, tube_top - 15, 0.0), (1.0, 0.0, 0.0)), (-60, 0, 0), 'SAFETY').yard_hidden = True   # under the ring: unseen

    return {'j1': j1, 'j2': j2, 'j3': j3, 'j4': j4, 'j5': j5, 'j6': j6, 'tur': tur, 'upper': upper, 'fore': fore,
            'acts': [a1, a2, a3, a4, a5, a6], 'ring': ring_info, 'ports': ports}



def _boot_fitting(P: tuple, o: tuple, holder=None, boss: float = 0.0, socket_r: float = 36.0, socket_l: float = 18.0,
                  base_r: float = 40.0, base_t: float = 3.0) -> cq.Shape:
    """Where a booted flex link ends, the fitting it plugs into, in its node's frame: P is the boot's end (the line's
    anchor), o the way out of the holder (unit). A collar (bore 61, so the 60 mm boot slides in) rises socket_l from P
    along o on a seal flange base_t thick; with boss > 0, a solid port boss of radius base_r reaches back from P into the
    holder that far, and the holder's own solid is cut from it, so the fitting stands on the holder's surface however it
    curves. The piece that holds the collar is kept, never the largest piece (a boss through a hollow casting leaves one
    inside it)."""
    Pv, ov = Vector(*P), Vector(*o).normalized()
    sock = cq.Solid.makeCylinder(socket_r, socket_l, Pv, ov).cut(cq.Solid.makeCylinder(R_BOOT_BORE, socket_l + 1, Pv - ov * 0.5, ov))
    base = cq.Solid.makeCylinder(base_r, base_t, Pv, ov).cut(cq.Solid.makeCylinder(R_BOOT_BORE, base_t + 1, Pv - ov * 0.5, ov))
    sh = sock.fuse(base)
    if boss > 0:
        bs = cq.Solid.makeCylinder(base_r, boss, Pv - ov * boss, ov).cut(
            cq.Solid.makeCylinder(R_BOOT_BORE - 10.0, boss + 1, Pv - ov * (boss + 0.5), ov))
        sh = sh.fuse(bs)
    if holder is not None:
        sh = sh.cut(holder)
    sols = sh.Solids()
    if len(sols) > 1:
        probe = Pv + ov * (socket_l / 2) + _perp_v(ov) * ((socket_r + R_BOOT_BORE) / 2)
        sh = min(sols, key=lambda q: cq.Vertex.makeVertex(probe.x, probe.y, probe.z).distance(q))
    return sh.clean()


def _perp_v(d: Vector) -> Vector:
    a = Vector(1, 0, 0) if abs(d.x) < 0.9 else Vector(0, 1, 0)
    return d.cross(a).normalized()


R_BOOT_BORE = 30.5      # a boot fitting's bore: the 60 mm boot slides in with 0.5 mm all round


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
    m.yard_deck_y = deck                              # the yard's asphalt: the trench, the channel and what lies in them are under it

    # ── subsystems (the tab's breakout) ───────────────────────────────────────────
    m.subsystem('MOUNT', 'Riser and mount', 'A short steel riser on the cross-slide carries the arm. Its J1 axis is 550 mm above the deck.',
                how=['4 screws M16 hold the riser to the cross-slide saddle.',
                     '8 screws M12 hold the mount plate to the riser.',
                     'The supply lines enter the riser from the saddle duct, through the cable window in its back.',
                     'The joint supply cable goes up through J1\'s hollow shaft. The DC cores go through the wall to the terminal box.'],
                specs={'J1 height': '550 mm above the deck', 'riser': '345 mm square, S355 galvanised'}, group='Structure')
    m.subsystem('BASE', 'Rail, carriage and cross-slide', 'Moves the arm\'s base to where the car\'s charge inlet is: along the car on a floor rail, and toward the car on a cross-slide.',
                how=['2 steel beams on the slab carry 2 profile rails and a rack, along the car.',
                     'A carriage rides the rails on 4 blocks. A servo gearmotor under it turns a pinion on the rack.',
                     'On the carriage 2 rails and a ball screw carry the saddle toward the car and back.',
                     'For an inlet on the car\'s side the base stops beside it, at the same distance from every car.',
                     'For an inlet in the rear bumper the base goes past the tail and in behind the car\'s corner.',
                     'Cover plates close the cable channel between the beams, flush with the deck. 2 brush strips close the slot between them.',
                     'The bed is set toward the tail end of the stall. A stall that faces the other way has the same bed, set the other way.'],
                specs={'along the car': f"{S['baseStage']['railNose']:.1f} m toward the nose, {S['baseStage']['railTail']:.1f} m toward the tail",
                       'toward the car': f"{S['baseStage']['crossIn']:.2f} m in, {S['baseStage']['crossOut']:.2f} m out",
                       'rails': 'size 25 along the car, size 20 across', 'drive': 'rack and pinion module 3 along, ball screw 20 x 5 across'},
                group='Motion')
    m.subsystem('SUPPLY', 'Supply from the cabinet', 'Brings every line from the DC cabinet to the riser: the charge current, the coolant, '
                'the air, power and the network. It follows the base along the rail and across.',
                how=['Every supply line comes from the cabinet: 8 DC cores, 2 coolant tubes, 1 air tube and 5 cables.',
                     'They leave the cabinet through its floor and drop through the pad into a lined trench in the slab.',
                     'The trench runs under a flush cover plate to the cable channel between the bed\'s beams.',
                     'In the channel each line turns onto its own lane and enters the cable chain at its fixed end.',
                     'The chain\'s bend rolls along the channel as the carriage moves. Cover plates close the channel, flush with the deck.',
                     'A driver on the carriage runs in the slot between the cover plates. 2 brush strips close the slot.',
                     'The lines rise inside the driver and bend into a second chain, on a tray at the carriage plate\'s edge.',
                     'That chain follows the saddle. A duct on the saddle takes the lines to the riser.',
                     'The 2 servo cables leave the driver in conduits, one to the rail gearmotor and one to the cross-slide motor.'],
                specs={'above the deck': 'the driver, the cross chain and the ducts, all on the carriage'},   # the sizes are added where they are worked out
                group='Cables')
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
    m.subsystem('TOOL', 'Connector head', 'Carries 2 connectors, CCS1 and NACS. It finds the inlet, brings forward the connector the car takes, plugs in, latches, and lets go.',
                how=['A 6-axis force and torque sensor reads the insertion force.',
                     'A compliance unit lets the head float up to 6 mm and 3 degrees. A small error cannot jam it.',
                     'Stereo cameras and a time-of-flight sensor find the inlet. A light ring helps at night.',
                     'Each connector rides a plunge cylinder. The one the car takes comes forward 90 mm. The other stays back, clear of the car.',
                     'A solenoid latch locks the connector in the inlet for the charge.'],
                specs={'connectors': 'CCS1 (SAE J1772 combo) and NACS (SAE J3400), liquid-cooled', 'TCP': '369.6 mm from the tool flange',
                       'spacing': '100 mm each side of the tool axis', 'stroke': '90 mm'}, group='Tool')
    m.subsystem('DRESS', 'Power path in the arm', 'Carries the charge current, the coolant and the tool\'s lines to the connector '
                'inside the arm, and power and network to the joints.',
                how=['The charge current reaches the riser in 8 cable cores, 4 a pole, from the cabinet by the 2 cable chains.',
                     'A terminal box on the riser joins the 4 cores of each pole to one flex link.',
                     'In the upper arm 2 copper bars carry it, one a pole. In the forearm 2 flexible copper cables carry it. Nothing live is in the open.',
                     'At the base, the shoulder and the elbow a booted link of braided copper joins 2 terminal boxes. It bends as the joint turns.',
                     'From the forearm one last booted link, 1.25 m long, runs to the connector across the wrist.',
                     'The coolant for the connector\'s contacts, the tool\'s cable and its air line run with the bars and through each boot.',
                     'Each of them is one tube or one cable from the cabinet to the head, with no joint on the way.',
                     'The coolant comes from a cooling unit in the cabinet and goes back to it. The air comes through the cabinet from the site.',
                     'The joints\' 10 mm power and network cable runs inside the arm, through the hollow shafts of J1 to J5.'],
                specs={'current': '500 A DC, 1000 V', 'in the links': '2 bars 40 x 10 mm copper in the upper arm, 2 flexible conductors 400 mm2 '
                       'in the forearm, insulated',
                       'flex links': '4, braided copper 400 mm2 a pole, in a silicone boot OD 60 mm, 0.9 to 1.25 m',
                       'bend radius': '80 mm moved (the tightest over the twin\'s poses and each fleet car\'s mate pose is 84 mm, the J3 link)',
                       'cooling': 'liquid at the connector\'s contacts, 2 tubes 8 x 6 unbroken from a cooling unit in the cabinet, 2 L/min against about 2 bar',
                       'not drawn': 'the lines inside the ducts, the chains and the riser, one by one'}, group='Cables')
    m.subsystem('SAFETY', 'Safety and status', 'Stops the arm when a person comes near and shows its state to the site.',
                how=['A safety laser scanner on the riser watches the stall at knee height.',
                     'An emergency stop on the riser cuts motor power (safe torque off).',
                     'Light rings on J2 and the wrist show the state: teal ready, amber moving, green charging, red fault.',
                     'J2\'s drive lights the 2 rings on J2. J6\'s drive lights the ring on the wrist.'],
                group='Safety')

    root = m.root
    site = root.child('Site', sub='MOUNT')

    # ═════════════════════════════════════════════════════════ SITE: pad and cabinet ═══
    pad_top = deck + S['cabinet']['padHeight'] * M
    riser_w = S['armMount']['riser'] * M
    plate_under = -S['mountPlateUnderside'] * M          # -81
    cab = S['cabinet']
    cab_cz = -cab['backset'] * M
    cab_front = cab_cz + cab['depth'] * M / 2
    pad_back = cab_cz - cab['depth'] * M / 2 - 191.4
    pad_front = cab_front + 60.0                         # the pad carries the cabinet only: the arm rides the bed in front of it
    # the pad itself is made below, once the supply lines' way through it is laid out

    # ══════════════════════════════════════════ BASE: rail bed, carriage, cross-slide ═══
    BS = S['baseStage']
    TAIL, NOSE = BS['railTail'] * M, BS['railNose'] * M
    X_TRAV = TAIL + NOSE                                  # the carriage's travel along the car
    BED_X = BS['modelToward'] * (TAIL - NOSE) / 2         # the bed's middle from the stall's middle (this model's stall)
    Z_IN, Z_OUT = BS['crossIn'] * M, BS['crossOut'] * M
    ZR, ZF = -190.0, 430.0                                # the 2 bed beams: behind and in front of the J1 line
    ZC = 120.0                                            # the cable channel, between them
    BM_W, BM_H, BM_T = 120.0, 80.0, 6.0
    rw25, rh25, bw25, bh25, bl25 = std.RAIL[25][:5]
    rw20, rh20, bw20, bh20, bl20 = std.RAIL[20][:5]
    CPX, CPT = 660.0, 20.0                                # carriage plate: along the car, thickness
    CP_Z0, CP_Z1 = -Z_OUT - 250.0, Z_IN + 250.0           # and across: the saddle's travel plus its own half
    RAIL_PC = 2340.0                                      # one rail piece (39 holes at 60)
    n_pc = math.ceil((X_TRAV + CPX + 80) / RAIL_PC)
    tr_l = n_pc * RAIL_PC
    bm_l = tr_l + 160.0
    y_bb = pad_top + 12.0                                 # the beams' underside: on plates, on grout blocks at pad height
    y_bt = y_bb + BM_H                                    # the beams' top: the rails' seat
    y_cp = y_bt + bh25                                    # the carriage plate's underside
    y_xr = y_cp + CPT                                     # its top: the cross rails' seat
    y_sd = y_xr + bh20                                    # the saddle's underside
    SD_W, SD_T = 460.0, 20.0
    rb = y_sd + SD_T                                      # the riser stands on the saddle
    XR_X, XB_Z = 170.0, 150.0                             # cross rails each side of the screw, and the blocks along them
    XB_X = 230.0                                          # the carriage's blocks along the bed rails

    bed = root.child('Bed', Location(), sub='BASE',
                     joint={'name': 'CR_BED', 'axis': [1, 0, 0], 'limits': [-(TAIL - NOSE) / 2000, (TAIL - NOSE) / 2000],
                            'kind': 'prismatic', 'stowed': BED_X / 1000})
    beam = (cq.Workplane('XY').box(bm_l, BM_H, BM_W).cut(cq.Workplane('XY').box(bm_l + 2, BM_H - 2 * BM_T, BM_W - 2 * BM_T)))
    beam_pd = m.part(PartDef('CHG-BBM', 'Bed beam, RHS 120 x 80 x 6', beam.val(), 'steel_s355', 'structure', 'EN 10219',
                             f'{bm_l:.0f} long', 'S355J2, hot-dip galvanised', None,
                             'Carries one rail of the bed, flat and straight. The rear beam carries the rack too.',
                             {'flatness': '0.3 mm per metre, shimmed on its plates'}, 'make'))
    bpl = (cq.Workplane('XY').box(300, 12, 160)
           .cut(cq.Workplane('XZ', origin=(0, 7, 0)).pushPoints([(-110, -58), (110, -58)]).circle(9).extrude(14)))
    bpl_pd = m.part(PartDef('CHG-BPL', 'Bed plate 300 x 160 x 12', bpl.val(), 'steel_s355', 'structure', 'cut plate',
                            '300 x 160 x 12', 'S355J2', None, 'Holds a bed beam to the slab. The beam is welded to it.', {}, 'make'))
    grout = cq.Workplane('XY').box(340, pad_top - deck, 200)
    grout_pd = m.part(PartDef('CHG-BGB', 'Grout block under a bed plate (site works)', grout.val(), 'concrete', 'structure',
                              'site works', f'340 x 200 x {pad_top - deck:.0f}', '', None,
                              'Lifts a bed plate to the pad\'s height and levels it.', {}, 'make', reference=True))
    anc = PartDef('CHG-ANC-M16', 'Anchor rod M16 x 190, injection mortar', cq.Workplane('XZ').circle(8).extrude(190)
                  .faces('<Y').chamfer(1.5).translate((0, 60, 0)).val(), 'fast_zn', 'fastener', 'ETA option 1 anchor',
                  'M16 x 190', '8.8', 145.0, 'Holds a bed plate to the slab. The mortar bonds it into a 125 mm hole.',
                  {'embedment': '125 mm', 'tension (design)': 'about 20 kN per rod'}, 'buy')
    rack = cq.Workplane('XY').box(tr_l, 20, 20)
    rack_pd = m.part(PartDef('CHG-BRK', 'Gear rack module 3, 20 x 20', rack.val(), 'steel', 'drive', 'DIN 867 tooth form',
                             f'{tr_l:.0f} long, in pieces', 'hardened', None, 'The carriage pinion runs along it.', {}, 'buy'))
    stop = (cq.Workplane('XY').box(30, 70, 30, centered=(True, False, True))
            .union(cq.Workplane('YZ').circle(12).extrude(18).translate((15, bh25 + CPT / 2, 0))))
    stop_pd = m.part(PartDef('CHG-BST', 'Bed end stop with buffer', stop.val(), 'steel_s355', 'structure', 'welded to the beam, PU buffer',
                             '30 x 70 x 30', '', None, 'Stops the carriage if it runs past its travel.', {}, 'make'))
    n_pl = int(bm_l // 1000) + 2
    for zb, out in ((ZR, -1), (ZF, 1)):                   # `out`: the side of the beam away from the other beam
        m.place(bed, beam_pd, loc(0, y_bb + BM_H / 2, zb), (0, 0, out * 160), 'BASE')
        for i in range(n_pl):
            xp = -bm_l / 2 + 150 + i * (bm_l - 300) / (n_pl - 1)
            m.place(bed, bpl_pd, loc(xp, pad_top + 6, zb + out * 20, ry=0 if out < 0 else 180), (0, -60, out * 160), 'BASE')
            m.place(bed, grout_pd, loc(xp, deck + (pad_top - deck) / 2, zb + out * 20), (0, -160, out * 160), 'BASE')
            for dx in (-110, 110):
                za = zb + out * 78
                m.place(bed, anc, loc(xp + dx, pad_top + 12, za), (0, 140, out * 160), 'BASE')
                m.place(bed, std.washer(16), std.orient((xp + dx, pad_top + 12, za), (0, -1, 0)), (0, 160, out * 160), 'BASE')
                m.place(bed, std.nut(16), loc(xp + dx, pad_top + 12 + 3, za), (0, 180, out * 160), 'BASE')
        for k in range(n_pc):
            xc = -tr_l / 2 + RAIL_PC / 2 + k * RAIL_PC
            m.place(bed, std.rail(25, RAIL_PC), loc(xc, y_bt, zb, ry=90), (0, 80, out * 160), 'BASE')
            for i in range(0, 39, 2):                    # each screw's head on its counterbore's floor, 0.45 of the rail down
                m.place(bed, std.shcs(6, 20, '12.9', 'Holds a bed rail to its beam.'),
                        std.orient((xc - RAIL_PC / 2 + 30 + 60 * i, y_bt + rh25 * 0.55, zb), (0, -1, 0)), (0, 130, out * 160), 'BASE')
    m.place(bed, rack_pd, loc(0, y_bt + 10, ZR + 40), (0, 60, -160), 'BASE')
    for sx_ in (-1, 1):                                   # on the rear beam, outboard of its rail; the buffer faces the carriage
        m.place(bed, stop_pd, loc(sx_ * (X_TRAV / 2 + CPX / 2 + 33), y_bt, ZR - 43, ry=0 if sx_ < 0 else 180), (sx_ * 120, 160, -160), 'BASE')
    # ═══════════════════════════════════════ THE SUPPLY: cabinet -> feed trench -> chain -> carriage ═══
    # Chase, 2026-11-14: "how does that arm get electricity to it while it's sliding on the rail? ... it doesn't look like
    # it's plugged into the arm itself or even the rail." Until then the moving side was drawn (2 chains) and the fixed
    # side was a sentence. This block draws every line from the cabinet's floor to the carriage, and sizes the chains
    # from what is in them.
    #
    # WHAT RUNS TO THE ARM. Everything comes from the cabinet (charge_cabinet.py): the post of a split charger, which
    # takes its DC from a power unit elsewhere on the site, and houses the DC's fuses, contactors and output blocks, the
    # connector's cooling unit, the arm's controller with the rail's and the cross-slide's 2 servo drives, and the
    # service-air block (the air itself is the site's). The joints carry their own drives (actuator.py, DRV-), so the arm
    # takes one supply cable.
    #
    # THE DC CABLE, AND WHY IT IS 4 SMALL CORES A POLE. A cable in a chain may bend no tighter than 7.5 x its diameter,
    # 4 x where it is fixed (igus chainflex CF310.UL data sheet, 03/2023: "e-chain linear minimum 7.5 x d, flexible
    # 6 x d, fixed 4 x d", 600/1000 V; read 2026-11-14 at
    # https://mm.digikey.com/Volume0/opasdata/d220001/medias/docus/2425/CF310.UL%20Datasheet.pdf). The family's largest
    # single core is 185 mm2 (27.5 mm, so R 206); there is no 400 mm2 core for a chain, and "2 cables of 400 mm2" in an
    # R 125 chain (what this file said before) cannot be bought. The same sheet: 1 x 50 mm2 is 15.0 mm across, 587 kg/km,
    # 228 A at 30 C. 7.5 x 15 = 112.5 mm, inside R 125. So each pole is 4 cores of 50 mm2 in parallel, 125 A a core at
    # 500 A: 55 % of the sheet's figure.
    # ASSUMPTION (not sourced, from memory of IEC 60364-5-52 table B.52.17 and B.52.14): 4 loaded circuits in one layer
    # derate to about 0.75, and 45 C air to about 0.87 for 90 C insulation, together 0.65, above the 0.55 needed. The
    # cable maker must confirm it for this chain before the cable is bought. The bars in the arm stay 400 mm2 a pole:
    # they are shut in the links, with no air moving over them.
    # ASSUMPTION: the diameters of the hoses and of the small cables below are typical of their kind, not from a data
    # sheet. Their bend rule is the same 7.5 x d in a chain; the widest, 12.5 mm, needs 94 mm.
    DC_D, DC_N = 15.0, 4                                  # one core's diameter, cores a pole
    DC_KG_M, DC_A = 0.587, 228.0                          # the sheet's weight and current for 1 x 50 mm2
    K_CHAIN, K_FIXED, FILL = 7.5, 4.0, 1.1                # bend rules; a line's lane is 1.1 x its diameter (ASSUMPTION, usual chain filling practice)
    # the lines on the chain's shelf, above the DC cores: (id, name, diameter, material, category, on to the saddle?, what it does)
    # The coolant and the air run in ONE tube each from the cabinet to the head (2026-11-15: until then the chains carried
    # a 12 x 8 hose and an 8 x 6 tube and the boots an 8 mm and a 6 mm tube, joined by a reducing coupling the model did not
    # have). The boots' size is the one that fits: in the 60 mm boot beside the 2 braids there is room for 2 tubes of 8,
    # the tool cable and a tube of 6. One 8 x 6 tube loses about 0.6 bar each way over 15 m at the connector's 2 L/min of
    # 50 % glycol (laminar, Re about 2,000: the cable schedule's coolant lines give the arithmetic and its sources), so
    # the cooling unit's pump must deliver 2 L/min against about 2 bar, not the 1 bar a cable-mounted unit gives.
    UPPER = [('CS', 'Coolant supply tube 8 x 6', 8.0, 'pu', 'fluid', True, 'Takes cooled liquid from the cabinet\'s cooling unit to the connector\'s contacts, in one tube all the way.'),
             ('CR', 'Coolant return tube 8 x 6', 8.0, 'pu', 'fluid', True, 'Brings the warm liquid back to the cooling unit in the cabinet, in one tube all the way.'),
             ('AR', 'Air tube 6 x 4', 6.0, 'pu', 'fluid', True, 'Takes air at 6 bar to the head: the compliance lock and the 2 plunge cylinders.'),
             ('JS', 'Joint supply cable (motor power, 24 V, EtherCAT)', 10.0, 'cable', 'electrical', True,
              'Feeds the 6 joints. It goes up the riser and through the hollow shafts of J1 to J5.'),
             ('TL', 'Tool cable (EtherCAT, 24 V)', 8.0, 'cable', 'electrical', True, 'Serves the force sensor, the cameras, the light ring and the latches. It runs in the boots with the DC links.'),
             ('SF', 'Safety cable (scanner, emergency stop)', 9.0, 'cable', 'electrical', True, 'Joins the scanner and the emergency stop to the safety controller in the cabinet.'),
             ('MX', 'Rail servo cable (motor, brake, encoder)', 12.5, 'cable', 'electrical', False, 'Joins the rail gearmotor to its drive in the cabinet.'),
             ('MZ', 'Cross-slide servo cable (motor, brake, encoder)', 11.0, 'cable', 'electrical', False, 'Joins the cross-slide motor to its drive in the cabinet.')]
    # The chain: the narrowest heavy chain (std.CHAIN_CLASSES, from the maker's sheet) whose inside holds the DC cores
    # side by side under a shelf and the small lines side by side on it, on a radius the DC core may bend on. It is drawn
    # to its outside: 137 x 42 inside is 163 x 64 outside. (This file first drew a link 160 x 56 outside and called it
    # 135 x 40 inside, with walls taken from no sheet.)
    R_CH = 125.0
    D_MAX = max(DC_D, max(u[2] for u in UPPER))
    if R_CH < K_CHAIN * D_MAX:
        raise ValueError('the chain bends tighter than its lines may')
    CN = std.chain_size('heavy', max(2 * DC_N * DC_D, sum(u[2] for u in UPPER)) * FILL,
                        FILL * DC_D + 3 + FILL * max(u[2] for u in UPPER), R_CH)
    CN_IW, CN_IH, CN_W, CN_H, CN_P = CN['bi'], CN['hi'], CN['ba'], CN['ha'], CN['pitch']
    CHAIN_SPEC = {'inside': f'{CN_IW:.0f} x {CN_IH:.0f} mm, one shelf', 'bend radius': f'{R_CH:.0f} mm',
                  'tightest line allows': f'{K_CHAIN * DC_D:.1f} mm (7.5 x {DC_D:g} mm, the DC core)'}
    # the covered channel in the slab, between the beams. From the deck down: the cover, 15 mm of air, the chain's upper
    # run, its bend, its lower run 10 mm over the floor, the liner
    SLOT, SW_T = 60.0, 50.0                               # the cover's slot, and the driver that runs in it
    COV_T, TOP_C, BOT_C, LIN_T, SEAT = 10.0, 15.0, 10.0, 5.0, 60.0
    CH_WI = CN_W + 40.0
    CH_W = CH_WI + 2 * LIN_T
    CH_D = COV_T + TOP_C + CN_H + 2 * R_CH + BOT_C + LIN_T
    y_fl = deck - CH_D + LIN_T                            # the channel's floor
    y_cb = y_fl + BOT_C + CN_H / 2                        # the chain's lower run
    y_ct = y_cb + 2 * R_CH                                # and its upper run
    y_l0 = y_fl + BOT_C + (CN_H - CN_IH) / 2 + DC_D / 2   # the DC cores' centre, as they lie in the chain
    y_sf = y_l0 + DC_D / 2 + 4.5                          # the shelf's top: the small lines lie on it
    # the link carries that shelf: a separator plate across its inside, lying on the DC cores, the small lines on it.
    # In the link's own frame (flex: x along the chain, y across its height, the lower run's up), from y_cb.
    SHELF = (y_l0 + DC_D / 2 - y_cb, y_sf - y_cb)
    ch_link = std.chain_link(CN_W, CN_H, CN_P, inside=(CN_IW, CN_IH), spec={**CHAIN_SPEC, 'shelf': f'{SHELF[1] - SHELF[0]:g} mm, on the DC cores'},
                             shelf=SHELF)
    # The chain's fixed end is under the bed's middle (X_F), and its lower run leaves it toward the car's TAIL, so the
    # lines reach it from the nose side, where the cabinet stands. The moving end hangs under the carriage's middle.
    X_F = 0.0
    n_ch = math.ceil((X_TRAV / 2 + math.pi * R_CH + 220) / CN_P)
    xb_max = (n_ch * CN_P - math.pi * R_CH + X_TRAV / 2) / 2          # the bend's farthest place from the fixed end
    SW_X0 = CPX / 2                                       # the driver rises past the carriage plate's nose-side edge
    SW_X1 = SW_X0 + CN_IW + 10.0
    ch_x0 = X_F - (xb_max + R_CH + CN_H / 2 + 50.0)
    ch_x1 = X_TRAV / 2 + SW_X1 + 30.0
    if ch_x1 > bm_l / 2 + 1e-6:
        raise ValueError('the channel runs past the bed')
    ch_l, ch_xc = ch_x1 - ch_x0, (ch_x0 + ch_x1) / 2
    # each line's lane: its offset from the chain's middle line (toward the car), its height, its diameter
    LANES = []
    for k in range(2 * DC_N):
        pole, i = ('P', k + 1) if k < DC_N else ('N', k - DC_N + 1)
        LANES.append({'id': f'CHG-LD{pole}{i}', 'name': f'DC{"+" if pole == "P" else "-"} cable, core {i} of {DC_N}, 1 x 50 mm2', 'd': DC_D,
                      'u': (k - DC_N + 0.5) * FILL * DC_D, 'y': y_l0, 'mat': 'cable', 'cat': 'electrical', 'saddle': True,
                      'fn': f'Carries a quarter of the charge current of the {"positive" if pole == "P" else "negative"} pole from the cabinet to the chain.',
                      'std': 'chain-rated single core, shielded, 600/1000 V', 'kg_m': DC_KG_M,
                      'spec': {'conductor': '50 mm2 copper, fine stranded', 'load': f'{500 / DC_N:.0f} A at 500 A ({500 / DC_N / DC_A * 100:.0f} % of {DC_A:.0f} A, the sheet\'s figure at 30 C)'}})
    u_ = -sum(u[2] for u in UPPER) * FILL / 2
    for (uid, uname, ud, umat, ucat, usad, ufn) in UPPER:
        LANES.append({'id': f'CHG-L{uid}', 'name': uname, 'd': ud, 'u': u_ + ud * FILL / 2, 'y': y_sf + ud / 2, 'mat': umat, 'cat': ucat,
                      'saddle': usad, 'fn': ufn, 'std': 'chain-rated' if ucat == 'electrical' else 'polyurethane tube', 'kg_m': None,
                      'spec': {'diameter': 'typical of its kind (assumed)'}})
        u_ += ud * FILL
    # THE FEED TRENCH. The lines leave the cabinet through its floor, drop through the pad, and lie in a lined trench
    # under flush covers to the channel's wall. There each turns a quarter circle about one centre onto its own lane and
    # runs to the chain's fixed end, so no line crosses another. The centre stands E_T behind the wall, so the innermost
    # DC core turns on 67 mm, over the 60 mm it may (4 x d, fixed).
    E_T, FT_M, R_V0 = 25.0, 20.0, 100.0
    for ln in LANES:
        ln['r'] = CH_WI / 2 + E_T + ln['u']               # its turn's radius
        ln['rv'] = R_V0 - (ln['y'] - y_l0)                # and its drop's, about one centre too
        if min(ln['r'], ln['rv']) < K_FIXED * ln['d']:
            raise ValueError(f"{ln['id']} turns tighter than {K_FIXED} x its diameter")
    z_c = ZC - CH_WI / 2 - E_T                            # the turns' centre
    ft_a = min(ln['r'] - ln['d'] / 2 for ln in LANES) - FT_M
    ft_b = max(ln['r'] + ln['d'] / 2 for ln in LANES) + FT_M
    xps = [-bm_l / 2 + 150 + i * (bm_l - 300) / (n_pl - 1) for i in range(n_pl)]     # the bed plates, as placed above
    blk = min(x for x in xps if x - 170 > X_F)            # the first grout block on the nose side of the fixed end
    X_C = math.ceil((blk + 170 + 40 + LIN_T + 30 - ft_a) / 10) * 10    # the trench clears that block by 40 mm
    ft_x0, ft_x1 = X_C + ft_a, X_C + ft_b                 # the trench inside, along the car
    if ft_x1 + LIN_T + 30 + 40 > min(x for x in xps if x > blk) - 170:
        raise ValueError('the feed trench does not fit between 2 grout blocks')
    if abs(ft_x0 + BED_X) > cab['width'] * M / 2 - 30 or abs(ft_x1 + BED_X) > cab['width'] * M / 2 - 30:
        raise ValueError('the feed trench does not come up inside the cabinet')
    Z_V0 = cab_cz                                         # the DC cores drop on the cabinet's middle line
    ft_z0 = Z_V0 - 45.0                                   # the trench's back wall, inside
    sh_z1 = Z_V0 + 60.0                                   # the shaft through the pad, toward the car
    z_wo = ZC - CH_W / 2                                  # the channel's rear wall, outside
    y_wt = deck - COV_T - LIN_T                           # the liners' walls end here; a seat flange lies on them, the covers on it
    # THE CABINET (charge_cabinet.py, 2026-11-15): drawn with its inside, its wiring and its site feeds, where it was an
    # envelope. Each supply line's path inside it is drawn as part of the line below (to its output block, its socket on
    # the cooling unit or the air block, or for a small cable to the gland plate), and the pad takes its 2 site shafts.
    from .charge_cabinet import build_cabinet
    cabg = build_cabinet(m, site, cab, pad_top, deck,
                         {ln['id']: (X_C + ln['r'] + BED_X, Z_V0 + (ln['y'] - y_l0), ln['d']) for ln in LANES})

    chan = (_bx(ch_x0, ch_x1, deck - CH_D, y_wt, ZC - CH_W / 2, ZC + CH_W / 2)
            .cut(_bx(ch_x0 + LIN_T, ch_x1 - LIN_T, y_fl, y_wt + 1, ZC - CH_WI / 2, ZC + CH_WI / 2))
            .union(_bx(ch_x0, ch_x1, y_wt, y_wt + LIN_T, ZC + CH_WI / 2, ZC + CH_W / 2 + SEAT))
            .union(_bx(ch_x0, ch_x1, y_wt, y_wt + LIN_T, ZC - CH_W / 2 - SEAT, ZC - CH_WI / 2))
            .cut(_bx(ft_x0, ft_x1, y_fl, y_wt, z_wo - 1, z_wo + LIN_T + 1)))          # the feed trench's way in
    m.place(bed, m.part(PartDef('CHG-BCH', 'Cable channel liner in the slab (site works)', chan.val(), 'steel', 'structure',
                                'site works, galvanised sheet 5 mm', f'{ch_l:.0f} x {CH_W:.0f} x {CH_D:.0f} deep', '', None,
                                'A covered trench under the carriage. The cable chain runs in it, below the deck, clear of doors and feet.',
                                {'seat': f'a {SEAT + LIN_T:.0f} mm flange each side carries the cover plates',
                                 'opening': f'{ft_x1 - ft_x0:.0f} mm in the rear wall, for the feed trench'}, 'make', reference=True)),
            Location(), (0, -300, 0), 'BASE')
    feed = (_bx(ft_x0 - LIN_T, ft_x1 + LIN_T, y_fl - LIN_T, y_fl, ft_z0 - LIN_T, z_wo)
            .union(_bx(ft_x0 - LIN_T, ft_x0, y_fl, y_wt, ft_z0 - LIN_T, z_wo))
            .union(_bx(ft_x1, ft_x1 + LIN_T, y_fl, y_wt, ft_z0 - LIN_T, z_wo))
            .union(_bx(ft_x0, ft_x1, y_fl, y_wt, ft_z0 - LIN_T, ft_z0))
            .union(_bx(ft_x0 - LIN_T - 30, ft_x0, y_wt, y_wt + LIN_T, pad_front, z_wo - SEAT))
            .union(_bx(ft_x1, ft_x1 + LIN_T + 30, y_wt, y_wt + LIN_T, pad_front, z_wo - SEAT)))
    m.place(bed, m.part(PartDef('CHG-BFL', 'Feed trench liner, cabinet to channel (site works)', feed.val(), 'steel', 'structure',
                                'site works, galvanised sheet 5 mm', f'{ft_x1 - ft_x0:.0f} x {z_wo - ft_z0:.0f} x {CH_D:.0f} deep', '', None,
                                'A trench from under the cabinet to the cable channel. The supply lines lie in it, under a flush cover.',
                                {'under the pad': 'it runs on as a tunnel, and a shaft rises through the pad into the cabinet'}, 'make', reference=True)),
            Location(), (0, -300, -120), 'BASE')

    # the slab the bed stands on (site works): the grout blocks sit on it, the 2 trenches are cast into it (it is deeper
    # round them), and the cabinet's pad is cast 150 mm into it. It holds the bed, the trenches and the pad to one another.
    SL_T, DS = 200.0, 120.0
    sl_x = bm_l / 2 + 250.0
    sl_z0, sl_z1 = pad_back - 150.0, ZF + 330.0
    pad_w = cab['width'] * M + 200
    slab = (cq.Workplane('XY').box(2 * sl_x, SL_T, sl_z1 - sl_z0, centered=(True, False, False)).translate((0, deck - SL_T, sl_z0))
            .union(_bx(ch_x0 - DS, ch_x1 + DS, deck - CH_D - DS, deck - SL_T, ZC - CH_W / 2 - DS, ZC + CH_W / 2 + DS))
            .union(_bx(ft_x0 - LIN_T - DS, ft_x1 + LIN_T + DS, deck - CH_D - DS, deck - SL_T, ft_z0 - LIN_T - DS, ZC))
            .cut(_bx(ch_x0, ch_x1, deck - CH_D, deck, ZC - CH_W / 2, ZC + CH_W / 2))
            .cut(_bx(ch_x0, ch_x1, y_wt, deck, ZC - CH_W / 2 - SEAT, ZC + CH_W / 2 + SEAT))
            .cut(_bx(ft_x0 - LIN_T, ft_x1 + LIN_T, deck - CH_D, deck, ft_z0 - LIN_T, z_wo))
            .cut(_bx(ft_x0 - LIN_T - 30, ft_x1 + LIN_T + 30, y_wt, deck, pad_front, z_wo))
            .cut(cq.Workplane('XY').box(pad_w, 150, pad_front - pad_back, centered=(True, False, False))
                 .translate((-BED_X, deck - 150, pad_back))))
    m.place(bed, m.part(PartDef('CHG-SLB', 'Floor slab under the bed (site works)', slab.val(), 'concrete', 'structure',
                                'site works', f'{2 * sl_x:.0f} x {sl_z1 - sl_z0:.0f} x {SL_T:.0f}', '', None,
                                'The depot floor here. It carries the bed\'s grout blocks, the cable channel, the feed trench and the cabinet\'s pad.',
                                {'flatness': '5 mm under a 3 m straightedge', 'round the trenches': f'{CH_D + DS:.0f} mm deep'}, 'make', reference=True)),
            Location(), (0, -420, 0), 'BASE')
    # the cabinet's pad (site works), in the stall's own frame: the feed trench runs under its front as a tunnel, and a
    # shaft rises from it through the pad into the cabinet's floor
    pad_s = (cq.Workplane('XY').box(pad_w, pad_top - deck + 150, pad_front - pad_back, centered=(True, False, False))
             .translate((0, deck - 150, pad_back)).edges('|X and >Y').chamfer(15)
             .cut(_bx(ft_x0 - LIN_T + BED_X, ft_x1 + LIN_T + BED_X, deck - 151, deck, ft_z0 - LIN_T, pad_front + 1))
             .cut(_bx(ft_x0 + BED_X, ft_x1 + BED_X, deck - 1, pad_top + 1, ft_z0, sh_z1)))
    for (sx0, sx1, sz0, sz1) in cabg['shafts']:          # the site's feeds come up through these, into the cabinet
        pad_s = pad_s.cut(_bx(sx0, sx1, deck - 151, pad_top + 1, sz0, sz1))
    m.place(site, m.part(PartDef('CHG-PAD', 'Charger pad (site concrete)', pad_s.val(), 'concrete', 'structure', 'site works',
                                 f"{pad_w:.0f} x {pad_front - pad_back:.0f}", '', None,
                                 'Carries the cabinet. Cast by the site works, with a shaft under the cabinet for the supply lines and 2 '
                                 'for the site\'s feeds.',
                                 {'shaft': f'{ft_x1 - ft_x0:.0f} x {sh_z1 - ft_z0:.0f} mm, under the cabinet\'s floor',
                                  'site shafts': 'behind it for the DC feed and the air; at the left for the auxiliary supply, the network and the earth'},
                                 'make', reference=True)),
            Location(), (0, -250, 0))

    # the covers, flush with the deck. The channel's: 2 rows of plates, each bolted to its seat and reaching 70 mm over
    # the trench, with the slot for the driver between them and a brush strip on each edge of the slot. The bed's beams
    # stand each side of it 89 mm above the deck, so no car reaches it; it is made for feet.
    cov_w = CH_W / 2 + SEAT - SLOT / 2
    n_cv = math.ceil(ch_l / 1250.0)
    cv_l = ch_l / n_cv
    cv_pts = [(dx, 0.0, SLOT / 2 + cov_w - SEAT / 2) for dx in (-cv_l / 3, 0.0, cv_l / 3)]
    cov = _csk(_bx(-cv_l / 2, cv_l / 2, -COV_T, 0.0, SLOT / 2, SLOT / 2 + cov_w), cv_pts, 8)
    cov_pd = m.part(PartDef('CHG-BCC', 'Channel cover plate, slot side, galvanised checker plate', cov.val(), 'steel_s355', 'structure',
                            f'checker plate {COV_T:.0f} mm', f'{cv_l:.0f} x {cov_w:.0f} x {COV_T:.0f}', 'S235, galvanised, R11 slip', None,
                            'Covers half the cable channel, flush with the deck. The driver runs in the slot between the 2 rows.',
                            {'overhang': f'{cov_w - SEAT - LIN_T:.0f} mm past the wall', 'load': 'foot traffic (the bed\'s beams keep cars off it)',
                             'slot': f'{SLOT:.0f} mm, closed by 2 brush strips'}, 'make'))
    cov_s = std.cshcs(8, 20, 'A4-80', 'Holds a cover plate down on its seat flange.')
    for i in range(n_cv):
        xc = ch_x0 + cv_l * (i + 0.5)
        for ry in (0, 180):
            T = loc(xc, deck, ZC, ry=ry)
            m.place(bed, cov_pd, T, (0, 140, 90 if ry == 0 else -90), 'BASE')
            for p in cv_pts:
                m.place(bed, cov_s, T * std.orient(p, (0, -1, 0)), (0, 200, 90 if ry == 0 else -90), 'BASE')
    brush = _bx(-ch_l / 2, ch_l / 2, -COV_T - 2, 0.0, -1.5, 1.5)
    brush_pd = m.part(PartDef('CHG-BCB', 'Slot brush strip, nylon on aluminium back', brush.val(), 'pa66', 'seal', 'catalogue part',
                              f'{COV_T + 2:.0f} x {ch_l:.0f}', '', None, 'Closes the cover\'s slot round the driver against grit and rain.', {}, 'buy'))
    for sz_ in (-1, 1):
        m.place(bed, brush_pd, loc(ch_xc, deck, ZC + sz_ * (SLOT / 2 - 1.5)), (0, 170, sz_ * 30), 'BASE')
    fc_x0, fc_x1 = ft_x0 - LIN_T - 30, ft_x1 + LIN_T + 30
    fc_pts = [(x, deck, z) for x in (fc_x0 + 15, fc_x1 - 15) for z in (pad_front + 40, z_wo - SEAT - 40)]
    fcov = _csk(_bx(fc_x0, fc_x1, deck - COV_T, deck, pad_front, z_wo - SEAT), fc_pts, 8)
    m.place(bed, m.part(PartDef('CHG-BFC', 'Feed trench cover plate, galvanised checker plate', fcov.val(), 'steel_s355', 'structure',
                                f'checker plate {COV_T:.0f} mm', f'{fc_x1 - fc_x0:.0f} x {z_wo - SEAT - pad_front:.0f} x {COV_T:.0f}',
                                'S235, galvanised, R11 slip', None,
                                'Covers the feed trench from the cabinet\'s pad to the channel\'s cover, flush with the deck. The rear beam passes over it.',
                                {'span': f'{ft_x1 - ft_x0 + 2 * LIN_T:.0f} mm', 'load': 'foot traffic'}, 'make')),
            Location(), (0, 140, -160), 'BASE')
    for p in fc_pts:
        m.place(bed, cov_s, std.orient(p, (0, -1, 0)), (0, 200, -160), 'BASE')

    # the lines themselves, from their ends in the cabinet to the chain's fixed end: the path in the cabinet, down through
    # the gland plate and the shaft, a bend onto the trench floor, along it, the quarter turn through the channel's wall,
    # and along the channel to the chain
    for ln in LANES:
        zv = Z_V0 + (ln['y'] - y_l0)
        top_pts, top_r = cabg['top'][ln['id']]          # in the site's frame, from its end to where it turns down
        pts = ([(x - BED_X, y, z) for (x, y, z) in top_pts]
               + [(X_C + ln['r'], ln['y'], zv), (X_C + ln['r'], ln['y'], z_c + ln['r']), (X_F, ln['y'], z_c + ln['r'])])
        shp, L_ln = _bent_tube(pts, list(top_r) + [ln['rv'], ln['r']], ln['d'] / 2)
        ln['len'] = L_ln
        in_cab = f", R {min(top_r):.0f} in the cabinet" if top_r else ''
        it_ = m.place(bed, m.part(PartDef(ln['id'], ln['name'], shp, ln['mat'], ln['cat'], ln['std'], f"D {ln['d']:g} x {L_ln:.0f}", '', None, ln['fn'],
                                          {**ln['spec'], 'drawn': 'from its end in the cabinet to the chain\'s fixed end; it runs on in the chain',
                                           'bends here': f"R {ln['rv']:.0f} and R {ln['r']:.0f} mm{in_cab} (it may bend on {K_FIXED * ln['d']:.0f} mm fixed, {K_CHAIN * ln['d']:.0f} mm in a chain)"},
                                          'buy', mass_override=None if ln['kg_m'] is None else ln['kg_m'] * L_ln / 1000.0)),
                      Location(), (0, -200, -60), 'SUPPLY')
        it_.yard_hidden = True        # under the deck and in the cabinet: the yard draws its pad and its own cabinet over it
        it_.part.path_ends = (pts[0], pts[1], pts[-1], pts[-2], ln['d'] / 2)      # line_ends.py: its other end runs on in the chain
    # clamp bars hold the lines on their lanes: one under the DC cores, one between them and the small lines, one on top
    CL_L, CL_W, CL_X = ft_x1 - ft_x0, 30.0, (ft_x1 - ft_x0) / 2 - 8.0
    y_top = y_sf + max(u[2] for u in UPPER)

    def _bar(y0: float, y1: float, holes: bool) -> cq.Workplane:
        b = _bx(-CL_L / 2, CL_L / 2, y0 - y_fl, y1 - y_fl, -CL_W / 2, CL_W / 2)
        if holes:
            for sx_ in (-1, 1):
                b = b.cut(cq.Workplane('XY').add(cq.Solid.makeCylinder(3.3, 100, Vector(sx_ * CL_X, 0, 0), Vector(0, 1, 0))))
        return b
    cl_pds = [m.part(PartDef(pid, name, _bar(y0, y1, holes).val(), 'pa66', 'electrical', 'machined', f'{CL_L:.0f} x {CL_W:.0f} x {y1 - y0:g}',
                             '', None, fn, {}, 'make'))
              for (pid, name, y0, y1, holes, fn) in (
                  ('CHG-BK1', 'Line clamp, base bar', y_fl, y_l0 - DC_D / 2, False, 'Lifts the 8 DC cores off the trench floor, at the height they have in the chain.'),
                  ('CHG-BK2', 'Line clamp, shelf bar', y_l0 + DC_D / 2, y_sf, True, 'Lies on the DC cores and carries the hoses and the small cables.'),
                  ('CHG-BK3', 'Line clamp, top bar', y_top, y_top + 8.0, True, 'Clamps the stack. 2 screws go through it into the base bar.'))]
    cl_s = std.shcs(6, 55, 'A4-80', 'Clamps the 3 bars of a line clamp together, into the base bar.')
    for T in (loc(X_C + CH_WI / 2 + E_T, y_fl, Z_V0 + R_V0 + 60.0), loc(X_C + CH_WI / 2 + E_T, y_fl, z_wo - 150.0),
              loc(X_C - 120.0, y_fl, ZC, ry=90), loc(X_F + 40.0, y_fl, ZC, ry=90)):
        for pd_ in cl_pds:
            m.place(bed, pd_, T, (0, -120, 0), 'SUPPLY')
        for sx_ in (-1, 1):
            m.place(bed, cl_s, T * std.orient((sx_ * CL_X, y_top + 8.0 - y_fl, 0), (0, -1, 0)), (0, -60, 0), 'SUPPLY')
    # the chain's fixed end: a bracket on the channel floor carries and holds the first link
    fbr = (_bx(X_F - CN_P, X_F, y_fl, y_fl + BOT_C, ZC - CN_W / 2 - 6.5, ZC + CN_W / 2 + 6.5)
           .union(_bx(X_F - CN_P, X_F, y_fl + BOT_C, y_fl + BOT_C + CN_H * 0.7, ZC + CN_W / 2 + 0.5, ZC + CN_W / 2 + 6.5))
           .union(_bx(X_F - CN_P, X_F, y_fl + BOT_C, y_fl + BOT_C + CN_H * 0.7, ZC - CN_W / 2 - 6.5, ZC - CN_W / 2 - 0.5)))
    m.place(bed, m.part(PartDef('CHG-BCF', 'Cable chain fixed-end bracket, stainless', fbr.val(), 'ss316', 'structure', 'bent plate',
                                f'{CN_P:.0f} x {CN_W + 13:.0f} x {BOT_C + CN_H * 0.7:.0f}', '316L', None,
                                'Holds the chain\'s first link to the channel floor. The lines enter the chain here.', {}, 'make')),
            Location(), (0, -160, 0), 'SUPPLY')

    carx = root.child('Carriage', Location(), sub='BASE',
                      joint={'name': 'CR_X', 'axis': [1, 0, 0], 'limits': [-TAIL / 1000, TAIL / 1000], 'kind': 'prismatic', 'stowed': 0})
    blk25 = [(sx_ * XB_X + ex, zb + ez) for sx_ in (-1, 1) for zb in (ZR, ZF)
             for ex in (-bl25 * 0.26, bl25 * 0.26) for ez in (-bw25 * 0.36, bw25 * 0.36)]
    xr_n = int((CP_Z1 - CP_Z0 - 20) // 60)                # cross rail holes at 60
    xr_l = xr_n * 60.0
    xr_zc = (CP_Z0 + CP_Z1) / 2
    xr_pts = [(sx_ * XR_X, xr_zc - xr_l / 2 + 30 + 60 * i) for sx_ in (-1, 1) for i in range(0, xr_n, 2)]
    PIN_Z = ZR + 80.0                                     # the pinion's axis: on the flank of the rack
    GB_PTS = [(ex, PIN_Z + ez) for ex in (-55, 55) for ez in (0, 55)]
    cpl = (cq.Workplane('XY').box(CPX, CPT, CP_Z1 - CP_Z0).translate((0, 0, xr_zc))
           .cut(cq.Workplane('XZ', origin=(0, CPT, 0)).pushPoints(blk25).circle(3.3).extrude(2 * CPT))        # M6 through
           .cut(cq.Workplane('XZ', origin=(0, CPT, 0)).pushPoints(blk25).circle(5.5).extrude(7 + CPT / 2))    # heads sunk 7 mm
           .cut(cq.Workplane('XZ', origin=(0, CPT, 0)).pushPoints(GB_PTS).circle(4.5).extrude(2 * CPT))
           .cut(cq.Workplane('XZ', origin=(0, CPT, 0)).pushPoints(GB_PTS).circle(7.0).extrude(9 + CPT / 2)))
    cpl_pd = m.part(PartDef('CHG-BCP', f'Carriage plate, {CPX:.0f} x {CP_Z1 - CP_Z0:.0f} x {CPT:.0f}', cpl.val(), 'steel_s355', 'structure',
                            'machined plate', f'{CPX:.0f} x {CP_Z1 - CP_Z0:.0f} x {CPT:.0f}', 'S355J2', None,
                            'Rides the 4 bed blocks. It carries the cross rails, the ball screw and the rail drive.', {}, 'make'))
    m.place(carx, cpl_pd, loc(0, y_cp + CPT / 2, 0), (0, 60, 0), 'BASE')
    for sx_ in (-1, 1):
        for zb in (ZR, ZF):
            m.place(carx, std.rail_block(25), loc(sx_ * XB_X, y_bt, zb, ry=90), (0, 30, 0), 'BASE')
    for (ex, ez) in blk25:
        m.place(carx, std.shcs(6, 20, '12.9', 'Holds the carriage plate to a bed block.'),
                std.orient((ex, y_cp + CPT - 7, ez), (0, -1, 0)), (0, 110, 0), 'BASE')
    # the rail drive, under the plate: the pinion on the rack's flank, a right-angle gearbox under it, the motor along the car
    gfl = (cq.Workplane('XY').box(140, 28, 98, centered=(True, False, False)).translate((0, -28, ZR + 52))
           .cut(cq.Workplane('XZ', origin=(0, 1, PIN_Z)).circle(32).extrude(30)))
    gbx = (cq.Workplane('XY').box(100, 80, 88, centered=(True, False, False)).translate((0, -108, ZR + 62))
           .union(cq.Workplane('YZ').circle(40).extrude(170).translate((50, -68, ZR + 106))))
    m.place(carx, m.part(PartDef('CHG-BGF', 'Rail drive mounting flange', gfl.val(), 'al6061', 'structure', 'machined', '140 x 98 x 28',
                                 '6061-T6', None, 'Holds the rail gearbox under the carriage plate, round the pinion.', {}, 'make')),
            loc(0, y_cp, 0), (0, -60, -120), 'BASE')
    m.place(carx, m.part(PartDef('CHG-BGX', 'Rail servo gearmotor 1.5 kW, right angle, brake, absolute encoder', gbx.val(), 'steel_paint',
                                 'drive', 'catalogue part', '1.5 kW', 'IP66', None,
                                 'Drives the carriage along the bed. Its brake holds the carriage when power is off.',
                                 {'speed': '1.0 m/s (class)'}, 'buy', mass_override=19.0)),
            loc(0, y_cp, 0), (0, -140, -120), 'BASE')
    pin = cq.Workplane('XZ', origin=(0, 0, PIN_Z)).circle(30).extrude(24)
    m.place(carx, m.part(PartDef('CHG-BPN', 'Pinion module 3, 20 teeth', pin.val(), 'steel', 'drive', 'DIN 867 tooth form', '20 T, m 3',
                                 'hardened', None, 'Drives the carriage along its rack.', {}, 'buy')),
            loc(0, y_cp, 0), (0, -100, -120), 'BASE')
    for (ex, ez) in GB_PTS:
        m.place(carx, std.shcs(8, 35, '12.9', 'Holds the rail drive\'s flange up to the carriage plate.'),
                std.orient((ex, y_cp + CPT - 9, ez), (0, -1, 0)), (0, 150, -120), 'BASE')
    # the cross rails and the ball screw, on the plate
    for sx_ in (-1, 1):
        m.place(carx, std.rail(20, xr_l), loc(sx_ * XR_X, y_xr, xr_zc), (sx_ * 60, 100, 0), 'BASE')
    for (ex, ez) in xr_pts:
        m.place(carx, std.shcs(5, 16, '12.9', 'Holds a cross rail to the carriage plate.'),
                std.orient((ex, y_xr + rh20 * 0.55, ez), (0, -1, 0)), (0, 150, 0), 'BASE')
    y_sc = y_xr + 15.0                                    # the screw's axis
    bsz = (cq.Workplane('XY').circle(10).extrude(CP_Z1 - CP_Z0 - 20).translate((0, 15, CP_Z0 + 10))
           .union(cq.Workplane('XY').box(60, 28, 20, centered=(True, False, False)).translate((0, 0, CP_Z0)))
           .union(cq.Workplane('XY').box(60, 28, 20, centered=(True, False, False)).translate((0, 0, CP_Z1 - 20))))
    m.place(carx, m.part(PartDef('CHG-BSZ', 'Cross-slide ball screw 20 x 5 with 2 bearing supports', bsz.val(), 'steel', 'drive',
                                 'catalogue part', f'20 x 5, {CP_Z1 - CP_Z0:.0f} long', 'C7 rolled', None,
                                 'Moves the saddle toward the car and back.', {}, 'buy', mass_override=6.5)),
            loc(0, y_xr, 0), (0, 120, 0), 'BASE')
    bmz = cq.Workplane('XY').box(60, 60, 110, centered=(True, True, False)).translate((0, 15, CP_Z0 - 110))
    m.place(carx, m.part(PartDef('CHG-BMZ', 'Cross-slide servo motor 0.75 kW, brake, absolute encoder', bmz.val(), 'steel_paint', 'drive',
                                 'catalogue part', '0.75 kW', 'IP65', None,
                                 'Turns the ball screw. Its brake holds the saddle when power is off.', {}, 'buy', mass_override=3.4)),
            loc(0, y_xr, 0), (0, 120, -140), 'BASE')
    m.subsystems['SUPPLY']['specs'].update({
        'DC cable': f'{DC_N} cores of 50 mm2 a pole, {DC_D:g} mm each, {500 / DC_N:.0f} A a core at 500 A',
        'cable chains': f'2, of one link, {CN_IW:.0f} x {CN_IH:.0f} mm inside, bend radius {R_CH:.0f} mm',
        'bend rule': f'{K_CHAIN:g} x the diameter in a chain ({K_CHAIN * DC_D:g} mm for the DC core), {K_FIXED:g} x where fixed ({K_FIXED * DC_D:g} mm)',
        'channel': f'{CH_W:.0f} mm wide, {CH_D:.0f} mm deep, {ch_l / 1000:.2f} m long, cover plates {COV_T:.0f} mm, slot {SLOT:.0f} mm',
        'feed trench': f'{ft_x1 - ft_x0 + 2 * LIN_T:.0f} mm wide, from the cabinet to the channel, {z_wo - ft_z0:.0f} mm'})
    # THE DRIVER: the chain's moving end, under the carriage. A closed stainless head hangs in the channel on the nose
    # side of the chain's last link; in it the lines turn from lying side by side to standing one over the other
    # (HB deep: the 8 cores stacked, 2 abreast). A flat neck, SW_T thick, takes them up through the cover's slot past
    # the carriage plate's edge. The head pushes and pulls the chain; nothing else crosses the cover.
    HB = math.ceil((CN_IW + 12) / 10) * 10
    hb_top = y_ct + CN_H / 2
    y_e0 = y_cp - 30.0                                    # the neck's top, under the tray
    drv = (_bx(0.0, SW_X1, hb_top - HB, hb_top, ZC - CN_W / 2, ZC + CN_W / 2)
           .union(_bx(SW_X0, SW_X1, hb_top, y_e0, ZC - SW_T / 2, ZC + SW_T / 2))
           .cut(_bx(-1.0, SW_X1 - 3, hb_top - HB + 3, hb_top - 3, ZC - CN_W / 2 + 3, ZC + CN_W / 2 - 3))
           .cut(_bx(SW_X0 + 3, SW_X1 - 3, hb_top - 4, y_e0 + 1, ZC - SW_T / 2 + 3, ZC + SW_T / 2 - 3)))
    m.place(carx, m.part(PartDef('CHG-BCA', 'Cable chain driver, stainless', drv.val(), 'ss316', 'structure', 'welded sheet 3 mm',
                                 f'head {SW_X1:.0f} x {CN_W:.0f} x {HB:.0f}, neck {SW_X1 - SW_X0:.0f} x {SW_T:.0f}', '316L', None,
                                 'Joins the chain\'s moving end to the carriage. The lines rise inside it, through the cover\'s slot.',
                                 {'in the slot': f'{SW_T:.0f} mm in a {SLOT:.0f} mm slot, a brush strip each side',
                                  'inside': f'the lines turn on {K_FIXED * DC_D:.0f} mm or more (4 x d, fixed); not drawn one by one'}, 'make')),
            Location(), (0, -80, 80), 'SUPPLY')
    # what each chain carries, lane by lane, in its link's frame. At the fixed end the link's x runs along -X (the lower
    # run leaves toward the tail), its y up, so its z (x cross y) runs along -Z: a line u toward the car lies at w = -u.
    # A line is the same cable from the cabinet's floor to the riser; its id is its trench part's.
    def _contents(lanes):
        return [{'id': ln['id'], 'part': ln['id'], 'name': ln['name'], 'd': ln['d'], 'v': ln['y'] - y_cb, 'w': -ln['u'],
                 'mat': ln['mat'], 'category': ln['cat']} for ln in lanes]
    m.flex(FlexDef('CHG-BCN', f'Cable chain, inside {CN_IW:.0f} x {CN_IH:.0f}, R {R_CH:.0f}', 'chain',
                   Anchor(bed, (X_F, y_cb, ZC), (-1, 0, 0)), Anchor(carx, (0.0, y_ct, ZC), (-1, 0, 0)),
                   CN_H / 2, 'SUPPLY', 'Carries the charge current, the coolant, the air, power and network to the moving carriage. Its bend rolls along in the channel.',
                   mat='pa66', category='electrical', pitch=CN_P, bend_r=R_CH, links=n_ch, up=(0, 1, 0), w=CN_W, h=CN_H,
                   link_part=ch_link, kg_per_m=3.2, contents=_contents(LANES), wi=CN_IW, hi=CN_IH, lead_a=0.0, lead_b=40.0,
                   spec={**CHAIN_SPEC, 'carries': f'{2 * DC_N} DC cores 1 x 50 mm2 ({DC_N} a pole), 2 coolant tubes, air, the joint supply, tool and safety cables, 2 servo cables',
                         'ends': 'its lines run on from the trench at the fixed end, and 40 mm into the driver\'s head at the moving end'}))

    base = carx.child('Saddle', Location(), sub='MOUNT',
                      joint={'name': 'CR_Z', 'axis': [0, 0, 1], 'limits': [-Z_OUT / 1000, Z_IN / 1000], 'kind': 'prismatic', 'stowed': 0})
    blk20 = [(sx_ * XR_X + ex, sz_ * XB_Z + ez) for sx_ in (-1, 1) for sz_ in (-1, 1)
             for ex in (-bw20 * 0.36, bw20 * 0.36) for ez in (-bl20 * 0.26, bl20 * 0.26)]
    sad = (cq.Workplane('XY').box(SD_W, SD_T, SD_W)
           .cut(cq.Workplane('XZ', origin=(0, SD_T, 0)).pushPoints(blk20).circle(2.8).extrude(2 * SD_T))
           .cut(cq.Workplane('XZ', origin=(0, SD_T, 0)).pushPoints(blk20).circle(4.8).extrude(6 + SD_T / 2)))
    m.place(base, m.part(PartDef('CHG-BSD', f'Cross-slide saddle, {SD_W:.0f} x {SD_W:.0f} x {SD_T:.0f}', sad.val(), 'steel_s355', 'structure',
                                 'machined plate', f'{SD_W:.0f} x {SD_W:.0f} x {SD_T:.0f}', 'S355J2', None,
                                 'Rides the 4 cross blocks and carries the riser.', {}, 'make')),
            loc(0, y_sd + SD_T / 2, 0), (0, 40, 0), 'BASE')
    for sx_ in (-1, 1):
        for sz_ in (-1, 1):
            m.place(base, std.rail_block(20), loc(sx_ * XR_X, y_xr, sz_ * XB_Z), (0, 20, 0), 'BASE')
    for (ex, ez) in blk20:
        m.place(base, std.shcs(5, 20, '12.9', 'Holds the saddle to a cross block.'),
                std.orient((ex, y_sd + SD_T - 6, ez), (0, -1, 0)), (0, 90, 0), 'BASE')
    nutb = (cq.Workplane('XY').box(50, 28, 60, centered=(True, False, True)).translate((0, -28, 0))
            .cut(cq.Workplane('XY').circle(10.5).extrude(64).translate((0, y_sc - y_sd, -32))))
    m.place(base, m.part(PartDef('CHG-BSN', 'Ball nut housing', nutb.val(), 'al6061', 'drive', 'machined', '50 x 28 x 60', '6061-T6',
                                 None, 'Joins the ball nut to the saddle.', {}, 'make')),
            loc(0, y_sd, 0), (0, 10, 0), 'BASE')

    # THE CARRIAGE'S RUNS. From the driver's neck the lines for the arm bend into a second chain, of the same links,
    # that lies on a tray along the carriage plate's nose-side edge and follows the saddle toward the car. The 2 servo
    # cables leave the neck in their own conduits, each to its motor. (Before 2026-11-14 a chain 40 x 25 on R 38 stood
    # here, said to carry the charge current: no 500 A conductor bends on 38 mm.)
    XC2 = (SW_X0 + SW_X1) / 2                             # the cross chain's middle line
    Z_F = ZC + 165.0                                      # its fixed end: the lines come up at ZC and bend into it
    y_tt = y_xr + 10.0                                    # the tray's top
    TR_C = 6.0                                            # the lower run's air over the tray: a link tips about 4 mm as it enters the bend
    y_zb = y_tt + TR_C + CN_H / 2                         # the cross chain's lower run
    y_zt = y_zb + 2 * R_CH                                # and its upper run, which the saddle carries
    z_mid = (Z_IN - Z_OUT) / 2
    Z_A = Z_F - z_mid                                     # where the saddle holds the chain's moving end (saddle frame)
    n_zc = math.ceil(((Z_IN + Z_OUT) / 2 + math.pi * R_CH + 80) / CN_P)
    zb_max = (n_zc * CN_P - math.pi * R_CH + (Z_IN + Z_OUT) / 2) / 2
    TZ1 = Z_F + zb_max + R_CH + CN_H / 2 + 20.0
    if TZ1 > CP_Z1 or Z_F - (ZC + SW_T / 2) < K_FIXED * DC_D + CN_IH:
        raise ValueError('the cross chain does not fit on the carriage')
    TX0, TX1 = SD_W / 2 + 20.0, XC2 + CN_W / 2 + 7.5
    ty_pts = [(TX0 + 40.0, y_tt, z) for z in (Z_F + 40.0, (Z_F + TZ1) / 2, TZ1 - 40.0)]
    tray = _csk(_bx(TX0, TX1, y_xr, y_tt, Z_F, TZ1)
                .union(_bx(XC2 - CN_W / 2 - 4.5, XC2 - CN_W / 2 - 1.5, y_tt, y_tt + 40.0, Z_F, TZ1))
                .union(_bx(XC2 + CN_W / 2 + 1.5, XC2 + CN_W / 2 + 4.5, y_tt, y_tt + 40.0, Z_F, TZ1))
                .union(_bx(XC2 - CN_W / 2, XC2 + CN_W / 2, y_tt, y_tt + TR_C, Z_F, Z_F + CN_P)), ty_pts, 8)   # the first link's seat
    m.place(carx, m.part(PartDef('CHG-BZT', 'Cross chain tray, stainless', tray.val(), 'ss316', 'structure', 'welded plate 10 mm and sheet 3 mm',
                                 f'{TX1 - TX0:.0f} x {TZ1 - Z_F:.0f}', '316L', None,
                                 'Carries the cross chain beside the saddle. It is screwed to the carriage plate and reaches past its edge.',
                                 {'on the plate': f'{CPX / 2 - TX0:.0f} mm', 'past its edge': f'{TX1 - CPX / 2:.0f} mm'}, 'make')),
            Location(), (140, 60, 0), 'SUPPLY')
    for p in ty_pts:
        m.place(carx, std.cshcs(8, 20, 'A4-80', 'Holds the cross chain\'s tray down on the carriage plate.'), std.orient(p, (0, -1, 0)), (140, 120, 0), 'SUPPLY')
    eb_y = y_cp + CPT / 2
    eb_pts = [(SW_X0, eb_y, ZC + SW_T / 2 + 20.0), (SW_X0, eb_y, Z_F - 30.0)]
    elb = (_bx(SW_X0, SW_X1, y_e0, y_zb + CN_H / 2, ZC - SW_T / 2, Z_F)
           .cut(_bx(SW_X0 + 3, SW_X1 - 3, y_e0 - 1, y_zb + CN_H / 2 - 3, ZC - SW_T / 2 + 3, Z_F + 1)))
    for p in eb_pts:
        elb = elb.cut(cq.Workplane('XY').add(cq.Solid.makeCylinder(4.5, 6, Vector(p[0] - 1, p[1], p[2]), Vector(1, 0, 0))))
    m.place(carx, m.part(PartDef('CHG-BZE', 'Carriage elbow duct, stainless', elb.val(), 'ss316', 'structure', 'welded sheet 3 mm',
                                 f'{SW_X1 - SW_X0:.0f} x {Z_F - ZC + SW_T / 2:.0f} x {y_zb + CN_H / 2 - y_e0:.0f}', '316L', None,
                                 'Stands on the driver\'s neck against the carriage plate\'s edge. In it the lines bend from upright into the cross chain.',
                                 {'inside': f'bend radius {Z_F - ZC - SW_T / 2 - CN_IH:.0f} mm or more; the lines are not drawn one by one'}, 'make')),
            Location(), (160, 0, 0), 'SUPPLY')
    for p in eb_pts:
        m.place(carx, std.shcs(8, 20, 'A4-80', 'Holds the elbow duct to the carriage plate\'s edge, from inside the duct.'),
                std.orient((p[0] + 3, p[1], p[2]), (-1, 0, 0)), (220, 0, 0), 'SUPPLY')
    y_gm, z_gm = y_cp - 68.0, ZR + 106.0                  # the rail gearmotor's axis (above): its motor ends at x = 220
    R_SV = math.ceil(K_FIXED * 12.5 / 10) * 10            # the servo cables' bend, fixed
    mxc = std.swept('CHG-BMXC', 'Rail servo cable in conduit, 20 mm',
                    [(SW_X0, y_gm, ZC), (SW_X0 - R_SV - 5, y_gm, ZC), (SW_X0 - R_SV - 5, y_gm, z_gm), (220.0, y_gm, z_gm)],
                    10, 'cable', 'electrical', 0, 'Runs from the driver\'s neck, under the carriage plate, to the rail gearmotor.',
                    {'bend': f'R {R_SV:.0f} (4 x d)', 'carries': 'motor, brake and encoder, one cable'}, 'EN 61386', 'D 20', 'buy', bend=float(R_SV))
    m.place(carx, mxc, Location(), (0, -120, 0), 'SUPPLY')
    y_q, z_q = y_xr + 30.0, CP_Z0 - 55.0                  # beside the plate's edge, above the bed's end stops; into the motor's side
    mzc = std.swept('CHG-BMZC', 'Cross-slide servo cable in conduit, 20 mm',
                    [(SW_X0 + 15, y_q, ZC - SW_T / 2), (SW_X0 + 15, y_q, z_q), (30.0, y_q, z_q)],
                    10, 'cable', 'electrical', 0, 'Runs from the elbow duct along the carriage plate\'s edge to the cross-slide motor.',
                    {'bend': f'R {R_SV:.0f} (4 x d)', 'carries': 'motor, brake and encoder, one cable'}, 'EN 61386', 'D 20', 'buy', bend=float(R_SV))
    m.place(carx, mzc, Location(), (120, 60, -60), 'SUPPLY')
    m.flex(FlexDef('CHG-BZN', f'Cross cable chain, inside {CN_IW:.0f} x {CN_IH:.0f}, R {R_CH:.0f}', 'chain',
                   Anchor(carx, (XC2, y_zb, Z_F), (0, 0, 1)), Anchor(base, (XC2, y_zt, Z_A), (0, 0, 1)),
                   CN_H / 2, 'SUPPLY', 'Carries the lines from the carriage to the saddle as it moves toward the car.',
                   mat='pa66', category='electrical', pitch=CN_P, bend_r=R_CH, links=n_zc, up=(0, 1, 0), w=CN_W, h=CN_H,
                   link_part=ch_link, kg_per_m=3.2, contents=_contents([ln for ln in LANES if ln['saddle']]), wi=CN_IW, hi=CN_IH,
                   lead_a=40.0, lead_b=40.0,
                   spec={**CHAIN_SPEC, 'carries': f'{2 * DC_N} DC cores 1 x 50 mm2, 2 coolant tubes, air, the joint supply, tool and safety cables',
                         'ends': 'its lines come 40 mm out of the elbow duct into its first link, and go 40 mm into the saddle duct from its last'}))

    # ════════════════════════════════════════════════════════════ MOUNT ═══
    # riser weldment, on the saddle
    bp_t, fl_t, tw = 20.0, 20.0, 10.0
    tube_y0, tube_y1 = rb + bp_t, plate_under - fl_t
    riser = (cq.Workplane('XY').box(450, bp_t, 450, centered=(True, False, True)).translate((0, rb, 0))
             .union(cq.Workplane('XY').box(riser_w, tube_y1 - tube_y0, riser_w, centered=(True, False, True))
                    .translate((0, tube_y0, 0)).edges('|Y').fillet(14))
             .cut(cq.Workplane('XY').box(riser_w - 2 * tw, tube_y1 - tube_y0 + 2, riser_w - 2 * tw, centered=(True, False, True))
                  .translate((0, tube_y0 - 1, 0)).edges('|Y').fillet(6))
             .union(cq.Workplane('XY').box(riser_w, fl_t, riser_w, centered=(True, False, True)).translate((0, tube_y1, 0))))
    g_h = min(150.0, (tube_y1 - tube_y0) / 3)
    for sx, sz in ((1, 0), (-1, 0), (0, 1)):            # three base gussets (the cables come in on the -Z face)
        g = (cq.Workplane('XY').polyline([(0, 0), (52, 0), (0, g_h)]).close().extrude(5, both=True))
        if sx:
            g = g.rotate((0, 0, 0), (0, 1, 0), 0 if sx > 0 else 180)
        else:
            g = g.rotate((0, 0, 0), (0, 1, 0), -90 if sz > 0 else 90)
        g = g.rotate((0, 0, 0), (1, 0, 0), 0).translate((sx * riser_w / 2, tube_y0, sz * riser_w / 2))
        riser = riser.union(g)
    riser = riser.faces('<Y').workplane(centerOption='CenterOfBoundBox').pushPoints(
        [(x, z) for x in (-ANC_XZ, ANC_XZ) for z in (-ANC_XZ, ANC_XZ)]).hole(18)
    riser = riser.cut(cq.Workplane('XY').box(riser_w - 80, min(160.0, tube_y1 - tube_y0 - 60), 30, centered=(True, False, True))
                      .translate((0, tube_y0 + 20, -riser_w / 2)))          # cable window, toward the carriage's cable run
    riser = riser.cut(_bx(-riser_w / 2 - 1, -riser_w / 2 + tw + 1, -170.0, -130.0, -130.0, -70.0))   # the DC cores' port, behind CHG-PB0
    riser = riser.cut(cq.Workplane('XY').circle(118).extrude(fl_t + 2).rotate((0, 0, 0), (1, 0, 0), -90)
                      .translate((0, tube_y1 - 1, 0)))                       # J1 bore in the top flange
    riser = riser.cut(cq.Workplane('XY').circle(90).extrude(bp_t + 2).rotate((0, 0, 0), (1, 0, 0), -90)
                      .translate((0, rb - 1, 0)))                            # the J1 actuator's cable glands hang into this
    pts = [(p[0], p[2]) for p in std.circle_points(8, 122, 'y', start=22.5)]
    riser = riser.faces('>Y').workplane(centerOption='CenterOfBoundBox').pushPoints(pts).hole(10.2, fl_t)
    m.place(base, m.part(PartDef('CHG-RSR', 'Riser weldment', riser.val(), 'steel_s355', 'structure', 'EN 1090-2 EXC2',
                                 f'{riser_w:.0f} sq x {plate_under - rb:.0f}', 'S355J2', None,
                                 'Lifts the arm from the saddle to its J1 height. Welded, then hot-dip galvanised.',
                                 {'tube': f'{riser_w:.0f} x {riser_w:.0f} x {tw:g}', 'welds': 'fillet a5, all round'}, 'make')),
            Location(), (0, -120, 0))
    for x in (-ANC_XZ, ANC_XZ):
        for z in (-ANC_XZ, ANC_XZ):
            m.place(base, std.washer(16), std.orient((x, rb + bp_t, z), (0, -1, 0)), (0, 160, 0))
            m.place(base, std.hex_bolt(16, 35, '8.8', 'Holds the riser\'s foot to the saddle, into a tapped hole.'),
                    std.orient((x, rb + bp_t + 3, z), (0, -1, 0)), (0, 180, 0))
    # THE SADDLE'S RUN: from the cross chain's moving end to the riser's cable window. A closed duct on the saddle:
    # a tall box takes the chain's last link, and in it the lines drop to the window's height and turn toward the riser;
    # a flat run passes behind the riser, under the J1 flex link (lowest at y = -180 over the twin's poses), and a spigot
    # enters the window. Inside the riser the DC cores go to the terminal box CHG-PB0 through a port in the wall behind
    # it; the joint supply cable goes up into J1; the coolant, the air, the tool cable and the safety cable go on
    # through that box into the first boot (CHG-FL1). 78 mm stands free between the J1 motor's bell and the wall.
    win_y0 = tube_y0 + 20.0
    win_y1 = win_y0 + min(160.0, tube_y1 - tube_y0 - 60)
    DU_H = CN_IH + 6.0
    if win_y0 + DU_H > win_y1 or win_y0 + DU_H > -185.0:
        raise ValueError('the saddle duct does not fit the riser\'s window under the J1 flex link')
    da_x0, da_x1 = XC2 - CN_W / 2 - 0.5, XC2 + CN_W / 2 + 0.5
    db_z1 = -riser_w / 2 - 20.0                           # the flat run's face toward the riser
    db_z0 = db_z1 - (CN_IW + 8.0)
    if Z_A - (db_z1 + K_FIXED * DC_D) < 2 * K_FIXED * DC_D:
        raise ValueError('the lines cannot drop and turn in the saddle duct')
    sp_x0 = -50.0
    sp_x1 = sp_x0 + CN_IW + 10.0
    sdu = (_bx(da_x0, da_x1, win_y0, y_zt + CN_H / 2, db_z0, Z_A)
           .union(_bx(sp_x0, da_x0, win_y0, win_y0 + DU_H, db_z0, db_z1))
           .union(_bx(sp_x0, sp_x1, win_y0, win_y0 + DU_H, db_z1, -riser_w / 2 + tw))
           .cut(_bx(da_x0 + 3, da_x1 - 3, win_y0 + 3, y_zt + CN_H / 2 - 3, db_z0 + 3, Z_A + 1))
           .cut(_bx(sp_x0 + 3, da_x0 + 4, win_y0 + 3, win_y0 + DU_H - 3, db_z0 + 3, db_z1 - 3))
           .cut(_bx(sp_x0 + 3, sp_x1 - 3, win_y0 + 3, win_y0 + DU_H - 3, db_z1 - 4, -riser_w / 2 + tw + 1)))
    m.place(base, m.part(PartDef('CHG-BZD', 'Saddle duct, chain to riser, stainless', sdu.val(), 'ss316', 'structure', 'welded sheet 3 mm',
                                 f'{da_x1 - sp_x0:.0f} x {Z_A - db_z0:.0f} x {y_zt + CN_H / 2 - win_y0:.0f}', '316L', None,
                                 'Takes the lines from the cross chain\'s moving end down and round to the riser\'s cable window.',
                                 {'inside': f'the lines turn on {K_FIXED * DC_D:.0f} mm or more (4 x d, fixed); not drawn one by one',
                                  'into the riser': 'a spigot in the cable window, on its sill'}, 'make')),
            Location(), (160, 40, -120), 'SUPPLY')
    zbr = _bx(SD_W / 2, XC2 - CN_W / 2 - 12.5, y_sd, win_y0, db_z1 - 68.0, db_z1 - 8.0)
    m.place(base, m.part(PartDef('CHG-BZB', 'Saddle duct bracket, stainless', zbr.val(), 'ss316', 'structure', 'machined',
                                 f'{XC2 - CN_W / 2 - 12.5 - SD_W / 2:.0f} x {win_y0 - y_sd:.0f} x 60', '316L', None,
                                 'Carries the saddle duct, and with it the cross chain\'s moving end, on the saddle\'s edge.', {}, 'make')),
            Location(), (80, -40, -120), 'SUPPLY')

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

    # ═══════════════════════════════════════════════════════ THE ARM (build_chain, above) ═══
    _c = build_chain(m, base, S, H, LU, LF, LW, radii, plate_under)
    j1, j2, j3, j4, j6, tur, upper, fore = (_c[k] for k in ('j1', 'j2', 'j3', 'j4', 'j6', 'tur', 'upper', 'fore'))


    # ═════════════════════════════════════════════════════════════ TOOL ═══
    tool = j6.child('Tool', loc(0, 0, 0), sub='TOOL')
    SPEC_HEAD.clear()
    SPEC_HEAD.update(S['head'])
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
    # are still liquid-cooled: 2 coolant tubes 8 x 6, the tool's cable and its 6 x 4 air tube run with the bars and
    # through every boot, each one tube from the cabinet to the head.
    # Each link's length and ends were searched over the twin's 20 poses (flex.solve): the tightest bend is given beside
    # each one, against the boot's 80 mm.
    R_BOOT, MB_BOOT = 30.0, 80.0
    BOOT_SPEC = {'conductors': '2 x 400 mm2 braided copper, tinned, insulated for 1000 V DC', 'boot': 'silicone bellows, OD 60 mm, IP67',
                 'also inside': '2 coolant tubes 8 x 6, tool cable (EtherCAT + 24 V), air tube 6 x 4, each unbroken from the cabinet to the head',
                 'bend radius': '80 mm moved'}

    def tbox(node, casting, centre, size, pid, name, fn, kg, explode, keep=None, inside='2 x 40 x 10 mm copper bars, insulated'):
        """A terminal box that sits on a casting: a block cut to the casting's own surface, so it touches and never overlaps.
        Where the block passes the casting's wall, the piece outside it is kept (`keep`: a point in it), never the largest
        piece: until 2026-11-15 CHG-PB4 kept the piece inside the hollow forearm, a box no hand could reach."""
        b = cq.Workplane('XY').box(*size).translate(centre).edges().fillet(8)
        if casting is not None:
            b = b.cut(cq.Workplane('XY').add(casting.val()))
        sols = b.val().Solids()
        if len(sols) > 1 and keep is not None:
            kp = cq.Vertex.makeVertex(*keep)
            sol = min(sols, key=lambda q: kp.distance(q))
        else:
            sol = max(sols, key=lambda q: q.Volume()) if len(sols) > 1 else b.val()
        m.place(node, m.part(PartDef(pid, name, sol, 'al6061_blk', 'electrical', 'made to order', ' x '.join(f'{v:.0f}' for v in size),
                                     'IP67', None, fn,
                                     {'terminals': '2 x 500 A DC, bolted M12, touch-safe covers', 'in the link': inside,
                                      'rating basis': 'about 1.4 to 1.8 A/mm2, rule of thumb'}, 'buy', mass_override=kg)),
                Location(), explode, 'DRESS')
        return sol

    # the riser's back takes the lines from the saddle duct (its cable window), so the riser's box and the J1 link are on its side
    tbox(base, None, (-riser_w / 2 - 25.0, -150.0, -100.0), (50.0, 110.0, 130.0), 'CHG-PB0', 'DC terminal box, riser',
         'Takes the 8 DC cores from the saddle duct, through a port in the riser\'s wall, and hands the current to the J1 flex link.', 3.0, (-160, 0, 0))
    tbox(j1, tur, (0.0, 265.0, -190.0), (130.0, 240.0, 100.0), 'CHG-PB1', 'DC junction box, turret',
         'Joins the J1 flex link, on its -X side, to the J2 flex link, on its +X side, on the turret\'s back.', 6.0, (0, 0, -180))
    pb2 = tbox(j2, upper, (0.0, 300.0, -155.0), (110.0, 130.0, 110.0), 'CHG-PB2', 'DC terminal box, upper arm, shoulder end',
               'Takes the J2 flex link into the 2 copper bars that run inside the upper arm. It closes the arm\'s port under it.', 5.0, (0, 0, -180))
    pb3 = tbox(j2, upper, (0.0, LU - 250.0, -125.0), (104.0, 130.0, 80.0), 'CHG-PB3', 'DC terminal box, upper arm, elbow end',
               'Brings the upper arm\'s bars out to the J3 flex link. It closes the arm\'s port under it.', 5.0, (0, 0, -180))
    fc_in = '2 flexible copper conductors 400 mm2, insulated'
    pb4 = tbox(j3, fore, (FORE_JOG[0], 250.0, -90.0), (104.0, 130.0, 80.0), 'CHG-PB4', 'DC terminal box, forearm, elbow end',
               'Takes the J3 flex link into the 2 flexible copper conductors that run inside the forearm. It saddles the forearm\'s back '
               'and closes the slot under it.', 4.5, (0, 0, -180), keep=(FORE_JOG[0], 250.0, -125.0), inside=fc_in)
    pb5 = tbox(j3, fore, (85.0, LF - 420.0, 0.0), (80.0, 130.0, 104.0), 'CHG-PB5', 'DC terminal box, forearm, wrist end',
               'Brings the forearm\'s conductors out to the wrist flex link. It closes the slot under it.', 4.5, (180, 0, 0), inside=fc_in)
    # no box on the wrist yoke: J4's bearing, J5's cheek and their screws fill both of its sides (the clash check found a
    # box there in all of them), so one link crosses J4, J5 and J6 from the forearm's box to the connector

    # Each end of each boot sits BOOT_LEAD deep in its fitting's collar (below): the boot is straight there and bends
    # only past the collar's mouth. (Solved bending from its very end, a boot cut its collar's wall at the car's ports:
    # the clash check found it, 2026-11-15.)
    BOOT_LEAD = 18.0

    def boot(pid, name, a, b, L, bulge, fn, tightest, hk=0.5):
        fd = m.flex(FlexDef(pid, name, 'loop', a, b, R_BOOT, 'DRESS', fn, mat='cable', category='electrical', length=L,
                            min_bend=MB_BOOT, bulge=bulge, hk=hk, kg_per_m=9.5, size=f'OD 60 x {L:.0f}', standard='IEC 61238-1 (lugs)',
                            lead_a=BOOT_LEAD, lead_b=BOOT_LEAD,
                            spec={**BOOT_SPEC, 'length': f'{L:.0f} mm', 'in its fittings': f'{BOOT_LEAD:g} mm straight at each end',
                                  'tightest bend over the twin\'s poses': f'{tightest:.0f} mm'}))
        fd.tightest = tightest          # mm: the cable schedule's bend for what the boot carries (cables.finish also measures it)

    # every link leaves and arrives square to its box's face, so its end sits flush on the box and never inside it
    NX, PX, NZ, PZ = (-1, 0, 0), (1, 0, 0), (0, 0, -1), (0, 0, 1)
    # The tightest bends below are measured, with the boots' leads, over the twin's duty cycle at every inlet and every
    # corner of the window, and at each fleet car's own mate pose (cadFlex.test.ts holds them all to the boot's 80 mm).
    # 2026-11-15: at the Tesla Cybercab's mate pose the J2 link bent to 65 mm (53 mm once its ends sat straight in their
    # collars). The duty-cycle sweep never visited that pose, so no test saw it. The wrist link, 1,250 mm with half its
    # bulge from its own weight, keeps 88 mm.
    # THE J2 LINK, A SIDE LOOP (2026-11-15). It ran from the turret box's back to the upper arm box's back, 1,200 mm bulged
    # backward, and at stow, unstow, approach and retract it hung up to 180 mm into the cabinet behind the arm: the
    # cabinet's envelope was a reference body, so the clash check filed that as context. Drawing the real cabinet showed
    # it. Now both ends are on the 2 boxes' +X faces, square to J2's axis, so J2 rolls the loop and never turns its ends.
    # 900 mm bulged along +X bends no tighter than 223 mm over the CAD's poses (each fleet car's mate among them), and
    # keeps 182 mm off the cabinet. (Ends on the boxes' tops and backs, searched the same way, bent to 80 mm or less.)
    boot('CHG-FL1', 'J1 flex link, 500 A braided copper in a boot', Anchor(base, (-riser_w / 2 - 50.0, -150.0, -100.0), NX),
         Anchor(j1, (-65.0, 200.0, -190.0), PX), 900.0, (0.0, NX, NX),
         'Carries the charge current across J1, from the riser to the turret, as the base turns.',
         102.0, hk=0.4)
    boot('CHG-FL2', 'J2 flex link, 500 A braided copper in a boot', Anchor(j1, (65.0, 265.0, -190.0), PX),
         Anchor(j2, (55.0, 300.0, -165.0), NX), 900.0, (0.0, PX, (0.0, 0.0, 0.0)),
         'Carries the charge current across J2, in a loop beside the shoulder.', 222.0, hk=0.4)
    boot('CHG-FL3', 'J3 flex link, 500 A braided copper in a boot', Anchor(j2, (0.0, LU - 250.0, -165.0), NZ),
         Anchor(j3, (FORE_JOG[0], 250.0, -130.0), PZ), 1200.0, (0.0, (0, 0.5, -1), (0, -0.5, -1)),
         'Carries the charge current over the outside of the elbow.', 84.0)
    boot('CHG-FL4', 'Wrist flex link to the connector, 500 A braided copper in a boot',
         Anchor(j3, (125.0, LF - 420.0, -30.0), PX), Anchor(tool, TOOL_OUTLET, TOOL_OUTLET_IN), 1250.0, (0.5, PX, PX),
         'Carries the charge current, the coolant and the tool\'s signals and air from the forearm to the connector, '
         'across J4, J5 and J6.', 88.0, hk=0.4)

    # every boot ends in a fitting it plugs into (2026-11-15, Chase: "There cannot be gaps between cables randomly plugging
    # into charging system"). Until then each boot's end sat bare on its box's face, the forearm's sat 20 mm off the
    # casting (CHG-PB4 was then inside the hollow forearm), and the connector's sat 12 mm past an M50 gland too small for it.
    # A boot slides 18 mm into the fitting's collar; a seal flange stands on the face; where the face is a casting, a
    # boss reaches it, cut to the casting's own surface.
    bft = cq.Workplane('XY').add(_boot_fitting((0.0, 0.0, 0.0), (0.0, 1.0, 0.0)))
    BFT_SPEC = {'bore': f'{2 * R_BOOT_BORE:g} mm: the 60 mm boot slides 18 mm in', 'seal': 'IP67, a clamp ring on the boot',
                'through it': 'the 2 braids, the coolant tubes, the tool cable and the air line'}
    bft_pd = m.part(PartDef('CHG-BFT', 'Boot fitting for the 60 mm boot, on a terminal box face', bft.val(), 'al6061_blk', 'electrical',
                            'made to order', 'bore 61, collar OD 72 x 18, flange OD 80', '6061-T6, black anodised', None,
                            'Holds a boot\'s end on its terminal box. The boot slides into its collar, and the braid goes through to the terminals.',
                            BFT_SPEC, 'make'))
    # (the forearm's elbow box, CHG-PB4, now stands outside the casting, so its fitting is this one too: until 2026-11-15
    # the box was the piece inside the hollow forearm and its fitting reached 45 mm down to the casting on a boss)
    for (node, P, o) in ((base, (-riser_w / 2 - 50.0, -150.0, -100.0), NX), (j1, (65.0, 265.0, -190.0), PX),
                         (j2, (55.0, 300.0, -165.0), PX), (j2, (0.0, LU - 250.0, -165.0), NZ), (j3, (FORE_JOG[0], 250.0, -130.0), NZ)):
        m.place(node, bft_pd, std.orient(P, tuple(-c for c in o)), tuple(80 * c for c in o), 'DRESS')
    # the 2 that meet a casting: cut to it, each its own part
    for (pid, node, P, o, cast, boss, where) in (
            ('CHG-BF1B', j1, (-65.0, 200.0, -190.0), NX, tur, 0.0, 'the turret\'s box, its foot cut to the turret'),
            ('CHG-BF4A', j3, (125.0, LF - 420.0, -30.0), PX, fore, 0.0, 'the forearm\'s wrist-end box, its foot cut to the casting')):
        sh = _boot_fitting(P, o, cast.val(), boss=boss)
        m.place(node, m.part(PartDef(pid, f'Boot fitting for the 60 mm boot, on {where}', sh, 'al6061_blk', 'electrical', 'made to order',
                                     'bore 61, collar OD 72 x 18', '6061-T6, black anodised', None,
                                     'Holds a boot\'s end where it meets a casting. The boot slides into its collar.', BFT_SPEC, 'make')),
                Location(), tuple(80 * c for c in o), 'DRESS')

    # ═════════════════════════════════════════════════ THE COPPER IN THE LINKS ═══
    # 2026-11-15: the 4 bars were named by the terminal boxes and the cable schedule, and drawn nowhere. They are drawn
    # now, each where it runs, between the boxes, through the casting ports the boxes close (build_chain, PORT_*).
    # THE UPPER ARM: 2 bars, 40 x 10 copper in a 1.5 mm sleeve, stacked flat against the arm's back wall, the DC+ bar
    # next to the wall. Each bends flatwise at each end (2.5 x its thickness on the inner bar, concentric on the outer)
    # and passes the port to its box. 3 insulators, bonded to the wall, carry the pack; a strap screwed to each holds it.
    # THE FOREARM: it swings past the elbow (FORE_JOG), so the link takes 2 flexible conductors of 400 mm2 (braided
    # copper, insulated, OD 26, the boots' braid with a jacket), side by side, bent no tighter than 80 mm: from the elbow
    # box's slot they rise into the casting, follow its swing and turn out through the side slot to the wrist-end box.
    BAR_W, BAR_T, BAR_INS = 40.0, 10.0, 1.5
    bw, bt = BAR_W + 2 * BAR_INS, BAR_T + 2 * BAR_INS
    R_BAR, SO_GAP = 25.0, 20.0
    up_s = upper.val()

    def back_wall(y):                                    # the upper arm's back wall at x = 0: (outer z, inner z)
        h = _hits(up_s, (0.0, y, 0.0), (0.0, 0.0, 1.0))
        return h[0], h[1]
    y_a1, y_a2 = PORT_U_Y[0] + bt / 2, LU - PORT_U_Y[1] - bt / 2
    zr1, zr2 = back_wall(y_a1)[1] + SO_GAP + bt / 2, back_wall(y_a2)[1] + SO_GAP + bt / 2
    pa = [(0.0, y_a1, back_wall(y_a1)[0] - 4.0), (0.0, y_a1, zr1), (0.0, y_a2, zr2), (0.0, y_a2, back_wall(y_a2)[0] - 4.0)]
    run_u = Vector(0.0, y_a2 - y_a1, zr2 - zr1).normalized()
    sides = [(0.0, -1.0, 0.0), (0.0, -run_u.z, run_u.y), (0.0, 1.0, 0.0)]      # each segment's side toward the outer bar
    pb_ = _offset_path(pa, sides, bt)
    bars = {}
    for (pid, pole, pts, R, mat) in (('CHG-BBUP', '+', pa, R_BAR, 'cu_bar_red'), ('CHG-BBUN', '-', pb_, R_BAR + bt, 'cu_bar_blk')):
        sh, L_ = _bent_bar(pts, [R, R], bw, bt)
        sh = sh.cut(pb2).cut(pb3)
        sh = max(sh.Solids(), key=lambda q: q.Volume())
        L_ = L_ - 8.0                                    # its 2 ends, 4 mm into each box, cut off
        kg = (BAR_W * BAR_T * 8960 + (bw * bt - BAR_W * BAR_T) * 1300) * L_ * 1e-9
        bars[pid] = (sh, L_)
        m.place(j2, m.part(PartDef(pid, f'Copper bar DC{pole}, 40 x 10 mm, insulated, inside the upper arm', sh, mat, 'electrical',
                                   'EN 13601 (copper bar)', f'40 x 10 x {L_:.0f}', 'Cu-ETP, tinned', None,
                                   f'Carries the {"positive" if pole == "+" else "negative"} pole\'s 500 A along the upper arm, '
                                   'from its shoulder box to its elbow box.',
                                   {'section': '40 x 10 mm copper (400 mm2), tinned', 'sleeve': '1.5 mm heat-shrink, for 1000 V DC '
                                    '(ASSUMPTION: the sleeve\'s maker confirms its rating)', 'bends': f'flatwise, {R:.0f} mm at its centreline',
                                    'rating basis': 'about 1.4 to 1.8 A/mm2, rule of thumb'}, 'make', mass_override=kg)),
                Location(), (0, 0, -60), 'DRESS').yard_hidden = True    # inside the casting: the yard cannot see it (the tab can)
    bar_a, bar_b = bars['CHG-BBUP'][0], bars['CHG-BBUN'][0]

    def z_a(y):                                          # the DC+ bar's centre on its run
        return zr1 + (zr2 - zr1) * (y - y_a1) / (y_a2 - y_a1)
    so_pd, sc_pd = None, None
    for k, y_s in enumerate((y_a1 + 130.0, (y_a1 + y_a2) / 2, y_a2 - 130.0)):
        top = z_a(y_s) - bt / 2 + 3.0
        so = (cq.Workplane('XY').box(60.0, 30.0, top - (back_wall(y_s)[1] - 2.5), centered=(True, True, False))
              .translate((0.0, y_s, back_wall(y_s)[1] - 2.5)))
        so = so.cut(cq.Workplane('XY').add(up_s)).cut(cq.Workplane('XY').add(bar_a))
        so_s = max(so.val().Solids(), key=lambda q: q.Volume())
        m.place(j2, m.part(PartDef(f'CHG-BSO{k + 1}', 'Bar insulator, upper arm, bonded to its back wall', so_s, 'pa66', 'electrical',
                                   'made to order', f'60 x 30 x {top - back_wall(y_s)[1]:.0f}', 'PA66-GF30, structural epoxy bond', None,
                                   'Carries the 2 bars clear of the casting and takes the strap\'s 2 screws.',
                                   {'creepage': f'{SO_GAP:.0f} mm from the bars to the casting'}, 'make')),
                Location(), (0, 0, -40), 'DRESS').yard_hidden = True
        b_top = z_a(y_s) + bt / 2 + bt
        legs = [cq.Workplane('XY').box(30.0 - bw / 2, 20.0, b_top - top + 1.0, centered=(True, True, False))
                .translate((sx * (bw / 2 + (30.0 - bw / 2) / 2), y_s, top)) for sx in (-1, 1)]
        strap = (cq.Workplane('XY').box(60.0, 20.0, 6.0, centered=(True, True, False)).translate((0.0, y_s, b_top - 0.5))
                 .union(legs[0]).union(legs[1]).cut(cq.Workplane('XY').add(bar_a)).cut(cq.Workplane('XY').add(bar_b)))
        m.place(j2, m.part(PartDef(f'CHG-BST{k + 1}', 'Bar strap, upper arm', strap.val(), 'pa66', 'electrical', 'made to order',
                                   '60 x 20', 'PA66-GF30', None, 'Holds the 2 bars down on their insulator.', {}, 'make')),
                Location(), (0, 0, -20), 'DRESS').yard_hidden = True
        for sx in (-1, 1):
            m.place(j2, std.shcs(6, 45, 'A2-70', 'Holds a bar strap to its insulator.'),
                    std.orient((sx * (bw / 2 + (30.0 - bw / 2) / 2), y_s, b_top + 5.5), (0.0, 0.0, -1.0)), (0, 0, -10), 'DRESS').yard_hidden = True
    # the forearm's 2 conductors: their middle line, and each one beside it (P on the right of the way they run)
    fo_s = fore.val()
    zf = PORT_F2[1]
    yf2 = LF - PORT_F2[0]
    xf = FORE_JOG[0]
    z_f1 = _hits(fo_s, (xf, PORT_F1_Y, 0.0), (0.0, 0.0, 1.0))[0]      # the forearm's back, outside, under CHG-PB4
    c_ = [(xf, PORT_F1_Y, z_f1 - 4.0), (xf, PORT_F1_Y, zf), (xf, 400.0, zf), (-12.0, 560.0, zf), (-12.0, yf2, zf), (100.0, yf2, zf)]
    dg = Vector(c_[3][0] - c_[2][0], c_[3][1] - c_[2][1], 0.0).normalized()
    f_side = [(1.0, 0.0, 0.0), (1.0, 0.0, 0.0), (dg.y, -dg.x, 0.0), (1.0, 0.0, 0.0), (0.0, -1.0, 0.0)]
    half = (FC_D + FC_GAP) / 2
    fcs = {}
    for (pid, pole, sgn, radii, mat) in (('CHG-FCFP', '+', 1.0, [80.0, 128.0, 96.0, 80.0], 'cable_red'),
                                         ('CHG-FCFN', '-', -1.0, [80.0, 96.0, 128.0, 112.0], 'cable')):
        pts = _offset_path(c_, f_side, sgn * half)
        sh, L_ = _bent_tube(pts, radii, FC_D / 2)
        sh = cq.Workplane('XY').add(sh).cut(cq.Workplane('XY').add(pb4)).cut(cq.Workplane('XY').add(pb5)).val()
        sh = max(sh.Solids(), key=lambda q: q.Volume())
        # its ends where the 2 boxes cut it: the path's own end points, pulled back to the boxes' faces
        e0 = _hits(pb4, pts[0], (0.0, 0.0, 1.0))
        e1 = _hits(pb5, pts[-1], (-1.0, 0.0, 0.0))
        a_ = (pts[0][0], pts[0][1], pts[0][2] + max(e0))
        b_ = (pts[-1][0] - max(e1), pts[-1][1], pts[-1][2])
        L_ = L_ - max(e0) - max(e1)
        kg = (400.0 * 8960 + (math.pi * FC_D ** 2 / 4 - 400.0) * 1250) * L_ * 1e-9
        pd = PartDef(pid, f'Forearm DC{pole} cable, 400 mm2 flexible copper, insulated', sh, mat, 'electrical',
                     'IEC 60228 class 6 (flexible copper)', f'D {FC_D:g} x {L_:.0f}', 'tinned copper braid, silicone jacket', None,
                     f'Carries the {"positive" if pole == "+" else "negative"} pole\'s 500 A along the forearm, from its elbow box to its '
                     'wrist-end box, round the forearm\'s swing.',
                     {'conductor': '400 mm2 braided copper, tinned', 'jacket': 'silicone, for 1000 V DC (ASSUMPTION: the maker confirms it)',
                      'bends': 'no tighter than 80 mm at its centreline', 'rating basis': 'about 1.4 to 1.8 A/mm2, rule of thumb'}, 'buy',
                     mass_override=kg)
        pd.path_mm = L_
        pd.path_ends = (a_, pts[1], b_, pts[-2], FC_D / 2)
        fcs[pid] = (sh, L_, pts)
        m.place(j3, m.part(pd), Location(), (0, 0, -60), 'DRESS').yard_hidden = True
    # 2 cleats hold them on the swing's straight, each on a foot bonded to the back wall
    for k, (t_, seg) in enumerate(((0.3, 2), (0.7, 2))):
        p0, p1 = Vector(*c_[seg]), Vector(*c_[seg + 1])
        cpt = p0 + (p1 - p0) * t_
        u = (p1 - p0).normalized()
        v = Vector(u.y, -u.x, 0.0)
        z_w = _hits(fo_s, (cpt.x, cpt.y, 0.0), (0.0, 0.0, 1.0))[1]            # the back wall inside, under the cleat
        blk = cq.Workplane('XY').box(2 * (half + FC_D / 2 + 6.0), 24.0, FC_D + 12.0).translate((0.0, 0.0, 0.0))
        foot = (cq.Workplane('XY').box(40.0, 24.0, (zf - FC_D / 2 - 6.0) - (z_w - 3.0), centered=(True, True, False))
                .translate((0.0, 0.0, (z_w - 3.0) - zf)))
        clt = blk.union(foot)
        ang = math.degrees(math.atan2(v.y, v.x))
        clt = clt.rotate((0, 0, 0), (0, 0, 1), ang).translate((cpt.x, cpt.y, zf))
        clt = clt.cut(cq.Workplane('XY').add(fo_s))
        for (sh, _, _) in fcs.values():
            clt = clt.cut(cq.Workplane('XY').add(sh))
        clt_s = max(clt.val().Solids(), key=lambda q: q.Volume())
        m.place(j3, m.part(PartDef(f'CHG-FCC{k + 1}', 'Cable cleat, 2-way, for the forearm\'s 2 conductors', clt_s, 'pa66', 'electrical',
                                   'IEC 61914 (cable cleats)', f'2 x D {FC_D:g}', 'PA66-GF30, its foot bonded to the casting', None,
                                   'Holds the 2 conductors apart and to the casting, and takes a short circuit\'s pull between them.',
                                   {}, 'make')),
                Location(), (0, 0, -40), 'DRESS').yard_hidden = True
    # the TOOL's lines (its cable, the coolant and the air) run through the links beside the copper, tied to it
    arm_lines = {
        'upper': [(55.0, 300.0, -165.0), (0.0, 300.0, -155.0), (0.0, y_a1, zr1 + bt + 12.0), (0.0, y_a2, zr2 + bt + 12.0),
                  (0.0, LU - 250.0, -125.0), (0.0, LU - 250.0, -165.0)],
        'fore': [(xf, PORT_F1_Y, -130.0), (xf, PORT_F1_Y, -118.0)] + [tuple(q) for q in c_[1:5]] + [(100.0, yf2, zf), (125.0, yf2, -30.0)]}
    copper = {'bars': {k: v[1] for k, v in bars.items()}, 'fcs': {k: v[1] for k, v in fcs.items()},
              'bar_ends': (pa[0], pa[-1]), 'fc_ends': {k: (v[2][0], v[2][-1]) for k, v in fcs.items()}}

    # ═════════════════════════════════════════════════════════════ SAFETY ═══
    y_scn = rb + bp_t + g_h + 54      # above the riser's foot and its gussets
    y_est = rb + bp_t + g_h + 40
    sc = (cq.Workplane('XY').box(110, 150, 104, centered=(True, False, True)).edges('|Y').fillet(10)
          .faces('<Y').shell(-3)
          .union(cq.Workplane('XZ', origin=(0, 150, 0)).circle(48).circle(45).extrude(-60))
          .union(cq.Workplane('XZ', origin=(0, 150, 0)).circle(50).circle(46).extrude(-4)))
    m.place(base, m.part(PartDef('CHG-SCN', 'Safety laser scanner, 275 degrees', sc.val(), 'a356', 'sensor',
                                 'IEC 61496-3, type 3', 'protective field up to 5.5 m', 'PL d / SIL 2', None,
                                 'Watches the stall at knee height. A person in the field stops the arm.', {}, 'buy')),
            loc(0, y_scn, riser_w / 2, rx=90), (0, 0, 140), 'SAFETY')
    for x in (-38, 38):
        m.place(base, std.shcs(6, 16, 'A2-70', 'Holds the scanner bracket.'), std.orient((x, y_scn + 10, riser_w / 2 + 4), (0, 0, -1)),
                (0, 0, 160), 'SAFETY')
    # the emergency stop as it is bought: a yellow housing with its collar, and the red mushroom on it (until 2026-11-15 it was
    # one red solid, which read as a red cube from the yard)
    es_h = (cq.Workplane('XY').box(72, 72, 60, centered=(True, True, False)).edges('|Z').fillet(6)
            .union(cq.Workplane('XY', origin=(0, 0, 60)).circle(20).extrude(12)))
    es_m = cq.Workplane('XY', origin=(0, 0, 72)).circle(28).extrude(14).faces('>Z').edges().fillet(6)
    m.place(base, m.part(PartDef('CHG-EST', 'Emergency stop housing, IP69K', es_h.val(), 'pa66_yellow', 'electrical',
                                 'IEC 60947-5-5', '72 x 72 x 72', '', None,
                                 'Holds the emergency stop switch and its 2 contacts on the riser, where a person by the car can reach it.', {}, 'buy')),
            loc(115.0, y_est, riser_w / 2), (0, 0, 120), 'SAFETY')
    m.place(base, m.part(PartDef('CHG-ESM', 'Emergency stop mushroom, 56 mm, red, twist to release', es_m.val(), 'pa66_red', 'electrical',
                                 'IEC 60947-5-5', 'D 56, twist to release', '', None,
                                 'Cuts motor power to every joint (safe torque off). The brakes hold the arm.', {}, 'buy')),
            loc(115.0, y_est, riser_w / 2), (0, 0, 140), 'SAFETY')   # on the car-side face beside the scanner: the cross chain runs along the nose-side face
    m.notes['torque_budget'] = torque_budget(m, j1, j2, j3, j4, H, LU, LF, S)

    # ════════════════════════════════════════════════════════════ CABLE SCHEDULE ═══
    # Every line once, from the device it leaves to the one it reaches, each piece of its route with its length
    # (cables.py; the bill of materials draws a line only in pieces). Where the CAD draws a duct or a box but not the lines
    # in it one by one (the chain driver, the elbow duct, the saddle duct, the riser, the terminal boxes, the hollow links),
    # each line's route is planned here through the duct's middle at the line's own lane, its corners bent on the line's
    # fixed radius where they fit (else sharp: an upper bound), +/- half the duct's inside width at each turn.
    _cable_schedule(m, dict(
        LANES=LANES, y_cb=y_cb, y_ct=y_ct, y_zb=y_zb, y_zt=y_zt, ZC=ZC, XC2=XC2, Z_F=Z_F, Z_A=Z_A, SW_X0=SW_X0, SW_X1=SW_X1,
        SW_T=SW_T, K_FIXED=K_FIXED, K_CHAIN=K_CHAIN, R_CH=R_CH, db_z0=db_z0, db_z1=db_z1, win_y0=win_y0, DU_H=DU_H,
        sp_x0=sp_x0, sp_x1=sp_x1, da_x0=da_x0, da_x1=da_x1, riser_w=riser_w, tw=tw, y_gm=y_gm, z_gm=z_gm, R_SV=R_SV,
        y_q=y_q, z_q=z_q, acts=_c['acts'], ring=_c['ring'], base=base, j1=j1, j2=j2, j3=j3, tool=tool, LU=LU, LF=LF, R_BOOT=R_BOOT,
        MB_BOOT=MB_BOOT, arm_lines=arm_lines, copper=copper, cabg=cabg))
    return m


# a DC core's conductor goes on into its output block's clamp past where the drawn core ends (ASSUMPTION: the block maker's
# strip length). Until 2026-11-15 the cabinet was an envelope and every line had a 1,500 mm tail in it, marked ASSUMPTION.
CAB_STRIP = 30.0
BOX_TAIL = 100.0        # to dress a line in a terminal box and make it off (ASSUMPTION)


def _cable_schedule(m: Model, g: dict) -> None:
    """The charge arm's cable schedule (cables.py): the 16 supply lines from the cabinet, the charge current's path up
    the arm (the 8 DC cores, the 4 braided links and the 2 pairs of copper bars), the lines the boots carry to the head,
    and the joint cables from J1 to J6."""
    import numpy as np
    from ..cables import bent_length, chain_mm
    from ..flex import loc_matrix, node_frames
    fx = {f.id: f for f in m.flexes}
    BCN, BZN = fx['CHG-BCN'], fx['CHG-BZN']
    W0 = node_frames(m.root, {})

    def wpt(node, p):
        return (W0[id(node)] @ np.array([*p, 1.0]))[:3]

    def route(points, R):
        try:
            L, r = bent_length(points, R)
            return L, (None if r == math.inf else r)
        except ValueError:
            return bent_length(points, 0.0)[0], None

    LANES, ZC, XC2, KF, KC = g['LANES'], g['ZC'], g['XC2'], g['K_FIXED'], g['K_CHAIN']
    # the ducts' inside widths at their turns: the tolerance a line's place in them gives its length
    tol_drv = (g['SW_X1'] - g['SW_X0'] - 6.0) / 2 + (g['SW_T'] - 6.0) / 2          # up the neck, then into the cross chain
    tol_sdu = (g['da_x1'] - g['da_x0'] - 6.0) / 2 + (g['DU_H'] - 6.0) / 2 + (g['db_z1'] - g['db_z0'] - 6.0) / 2
    rw2 = g['riser_w'] / 2 - g['tw']                       # the riser's inside half width
    sp_xc = (g['sp_x0'] + g['sp_x1']) / 2
    zc_flat = (g['db_z0'] + g['db_z1']) / 2
    PB0 = (-g['riser_w'] / 2 - 25.0, -150.0, -100.0)       # the riser's terminal box, its centre (base frame)
    FL1_A = (-g['riser_w'] / 2 - 50.0, -150.0, -100.0)     # where the J1 link leaves it
    a1 = g['acts'][0]
    gl_J1 = (loc_matrix(a1['gland'].loc) @ np.array([0, 0, 0, 1.0]))[:3]       # J1's cable gland, base frame

    def supply(ln):
        """A supply line from the cabinet to the riser: its trench, the bed's chain, the driver and elbow (to the cross
        chain, or for a servo cable to its conduit), the cross chain, the saddle duct and the riser's window."""
        d, u, v = ln['d'], ln['u'], ln['y'] - g['y_cb']
        dc = ln['id'].startswith('CHG-LD')
        R = KF * d
        cabp = g['cabg']['planned'].get(ln['id'])        # a small cable: its run in the cabinet's wiring ducts is planned
        top_r = g['cabg']['top'][ln['id']][1]
        if dc:
            tail_a, basis = CAB_STRIP, f'{CAB_STRIP:.0f} mm of conductor on into its output block\'s clamp (ASSUMPTION: the block maker\'s strip length)'
        elif cabp is None:
            tail_a, basis = 0.0, 'it is drawn 12 mm into its socket in the cabinet'
        else:
            tail_a, basis = BOX_TAIL, f'{BOX_TAIL:.0f} mm to make it off at its device in the cabinet (ASSUMPTION)'
        L = m.cable(ln['id'], ln['name'], 'dc' if dc else ('coolant' if ln['id'] in ('CHG-LCS', 'CHG-LCR') else
                    'air' if ln['id'] == 'CHG-LAR' else 'safety' if ln['id'] == 'CHG-LSF' else 'control'),
                    d, ln['std'], '', '', 'SUPPLY', bend_fixed=R, bend_moving=KC * d, tail_a=tail_a, tails=basis)
        if cabp is not None:
            mm_c = bent_length(cabp[0], 0.0)[0]
            L.run('duct', 'CHG-CWR', f'inside the cabinet, planned: from its device, {cabp[1]}, through the wiring ducts (the top one '
                  'and the right one) and down to the gland plate', mm_c, tol=100.0)
        where = ('from its output block in the cabinet straight down through the gland plate' if dc else
                 'from the cabinet\'s gland plate' if cabp is not None else
                 'from its socket in the cabinet, round the DC column and down through the gland plate')
        L.run('drawn', ln['id'], f'{where}, down the shaft through the pad, along the feed trench and into the cable channel, to '
              'the bed chain\'s fixed end', ln['len'], bend=min([ln['rv'], ln['r'], *top_r]))
        mm, rb = chain_mm(BCN, ln['id'])
        L.run('chain', 'CHG-BCN', 'in the bed\'s cable chain, in its own lane', mm, bend=rb, moving=True)
        P0 = (0.0, g['y_ct'] - v, ZC + u)                  # the chain's last link, in the carriage's frame
        if ln['saddle']:
            z_n = ZC + 11.0 if dc else ZC - 11.0           # 2 layers up the neck: the DC cores on the car's side
            pts = [P0, (XC2 + u, P0[1], z_n), (XC2 + u, g['y_zb'] + v, z_n), (XC2 + u, g['y_zb'] + v, g['Z_F'])]
            mm, rb = route(pts, R)
            L.run('duct', 'CHG-BCA', 'through the chain driver\'s head, up its neck and round the elbow duct (CHG-BZE) into '
                  'the cross chain', mm, tol=tol_drv, bend=rb)
            mm, rb = chain_mm(BZN, ln['id'])
            L.run('chain', 'CHG-BZN', 'in the cross chain, in its own lane', mm, bend=rb, moving=True)
            y_f = g['win_y0'] + 3 + d / 2 if dc else g['win_y0'] + g['DU_H'] - 3 - d / 2
            P4 = (sp_xc + u, y_f, -rw2)
            pts = [(XC2 + u, g['y_zt'] - v, g['Z_A']), (XC2 + u, g['y_zt'] - v, zc_flat + u), (XC2 + u, y_f, zc_flat + u),
                   (sp_xc + u, y_f, zc_flat + u), P4]
            mm, rb = route(pts, R)
            L.run('duct', 'CHG-BZD', 'down the saddle duct, along its flat run behind the riser and through the spigot into '
                  'the riser\'s cable window', mm, tol=tol_sdu, bend=rb)
            return L, P4
        # a servo cable leaves the driver's neck in its conduit
        if ln['id'] == 'CHG-LMX':
            R_ = g['R_SV']
            pts = [P0, (g['SW_X0'] + R_, P0[1], ZC), (g['SW_X0'] + R_, g['y_gm'], ZC), (g['SW_X0'], g['y_gm'], ZC)]
            cpts = [(g['SW_X0'], g['y_gm'], ZC), (g['SW_X0'] - R_ - 5, g['y_gm'], ZC), (g['SW_X0'] - R_ - 5, g['y_gm'], g['z_gm']),
                    (220.0, g['y_gm'], g['z_gm'])]
            cid, motor = 'CHG-BMXC', 'the rail gearmotor (CHG-BGX)'
        else:
            R_ = g['R_SV']
            z_v = ZC - g['SW_T'] / 2 + R_
            pts = [P0, (g['SW_X0'] + 15, P0[1], z_v), (g['SW_X0'] + 15, g['y_q'], z_v), (g['SW_X0'] + 15, g['y_q'], ZC - g['SW_T'] / 2)]
            cpts = [(g['SW_X0'] + 15, g['y_q'], ZC - g['SW_T'] / 2), (g['SW_X0'] + 15, g['y_q'], g['z_q']), (30.0, g['y_q'], g['z_q'])]
            cid, motor = 'CHG-BMZC', 'the cross-slide motor (CHG-BMZ)'
        mm, rb = route(pts, R)
        L.run('duct', 'CHG-BCA', 'through the chain driver\'s head and up its neck to its conduit\'s entry', mm, tol=tol_drv, bend=rb)
        mm, rb = bent_length(cpts, g['R_SV'])
        L.run('conduit', cid, f'in its 20 mm conduit to {motor}', mm, bend=rb)
        L.a, L.b = 'its servo drive in the cabinet (CHG-CSD)', f'{motor}: its connector'
        L.tail_b = 0.0
        return L, None

    def riser_to(P4, d, target, R):
        """From the riser's window to a point inside the riser (base frame): planned, sharp where a bend does not fit."""
        pts = [P4, (P4[0], P4[1], target[2]), target] if abs(target[2] - P4[2]) > 1 else [P4, target]
        return route(pts, R)

    port = (-rw2, PB0[1], PB0[2])                          # the port in the riser's wall behind the terminal box
    lines = {}
    for ln in LANES:
        L, P4 = supply(ln)
        lines[ln['id']] = (L, P4)
        d, R = ln['d'], KF * ln['d']
        if ln['id'].startswith('CHG-LD'):
            mm, rb = riser_to(P4, d, port, R)
            L.run('duct', 'CHG-RSR', 'across the riser to the port in its wall behind the terminal box', mm, tol=rw2, bend=rb)
            L.run('duct', 'CHG-PB0', 'into the terminal box, to its DC terminal', abs(PB0[0] - port[0]), tol=0.0)
            pole = 'DC+' if ln['id'].startswith('CHG-LDP') else 'DC-'
            L.a, L.b = f'the {pole} output block in the cabinet (CHG-COB)', f'the {pole} terminal in the riser\'s terminal box (CHG-PB0)'
            L.tail_b = BOX_TAIL
            L.tails += f'; {BOX_TAIL:.0f} mm to dress it in the terminal box and make it off on its M12 lug (ASSUMPTION)'
            L.notes.append(f'One of {sum(1 for x in LANES if x["id"].startswith("CHG-LD")) // 2} cores a pole: 4 in parallel carry the 500 A.')
        elif ln['id'] == 'CHG-LJS':
            # up to J1's gland: it comes from below, so it drops in the riser and rises into the gland
            low = (gl_J1[0], g['win_y0'] - 10.0, gl_J1[2])
            mm, rb = route([P4, (P4[0], P4[1], low[2]), low, (gl_J1[0], gl_J1[1], gl_J1[2])], R)
            L.run('duct', 'CHG-RSR', 'in the riser, down under J1 and up into its rear cover\'s gland', mm, tol=rw2, bend=rb)
            L.a, L.b = ('the arm controller in the cabinet (CHG-CAC): motor power from the 48 V supply, 24 V, safe torque off, EtherCAT',
                        'J1\'s actuator, its gland (its drive board inside)')
            L.tail_b = BOX_TAIL
            L.tails += f'; {BOX_TAIL:.0f} mm inside the actuator to its drive board\'s connector (ASSUMPTION)'
        elif ln['id'] == 'CHG-LSF':
            mm, rb = route([P4, (P4[0], P4[1], rw2 - 40.0), (115.0, P4[1], rw2 - 40.0)], R)
            L.run('duct', 'CHG-RSR', 'across the riser to its car-side face, behind the emergency stop and the scanner', mm, tol=rw2, bend=rb)
            L.a, L.b = 'the safety controller in the cabinet (CHG-CSF)', 'the emergency stop (CHG-EST) and the safety scanner (CHG-SCN), on the riser'
            L.tail_b = BOX_TAIL
            L.tails += f'; {BOX_TAIL:.0f} mm to make off at the 2 devices (ASSUMPTION)'
            L.notes.append('It serves the 2 safety devices only. The status light rings are lit by the joints\' drives (CHG-RL2 '
                           'and the wrist ring\'s receptacle): until 2026-11-15 the model said this cable served them, and no route reached them.')
        elif ln['id'] in ('CHG-LCS', 'CHG-LCR', 'CHG-LAR', 'CHG-LTL'):
            mm, rb = riser_to(P4, d, port, R)
            L.run('duct', 'CHG-RSR', 'across the riser to the port in its wall behind the terminal box', mm, tol=rw2, bend=rb)
            L.run('duct', 'CHG-PB0', 'through the terminal box to the J1 link\'s fitting', abs(FL1_A[0] - port[0]))
    # what the boots carry up the arm: the tool cable, the 2 coolant tubes and the air tube, each one line from the cabinet
    j1, j2, j3, tool = g['j1'], g['j2'], g['j3'], g['tool']
    LU, LF = g['LU'], g['LF']
    # the route through the arm, boot by boot (each piece in its own node's frame; the boxes' corners sharp)
    PB1_IN, PB1_OUT = (-65.0, 200.0, -190.0), (65.0, 265.0, -190.0)
    arm_runs = [
        ('boot', 'CHG-FL1', 'in the J1 link\'s boot, from the riser to the turret', fx['CHG-FL1']),
        ('duct', 'CHG-PB1', 'through the turret\'s junction box', [PB1_IN, (0.0, 200.0, -190.0), (0.0, 265.0, -190.0), PB1_OUT], 40.0),
        ('boot', 'CHG-FL2', 'in the J2 link\'s boot, behind the shoulder', fx['CHG-FL2']),
        ('arm', 'CHG-UPR', 'through the upper arm\'s 2 terminal boxes (CHG-PB2, CHG-PB3) and their ports, and inside the arm between '
         'them, tied along the top of the copper bars', g['arm_lines']['upper'], 40.0),
        ('boot', 'CHG-FL3', 'in the J3 link\'s boot, over the elbow', fx['CHG-FL3']),
        ('arm', 'CHG-FOR', 'through the forearm\'s 2 terminal boxes (CHG-PB4, CHG-PB5) and their slots, and inside the arm between '
         'them, tied along the 2 flexible conductors', g['arm_lines']['fore'], 40.0),
        ('boot', 'CHG-FL4', 'in the wrist link\'s boot, across J4, J5 and J6 to the head', fx['CHG-FL4']),
    ]
    # inside the head: from the boot's outlet through the outlet housing's elbow to its inner end on the holder's spine
    o = tuple(-c for c in TOOL_OUTLET_IN)
    L_g = std.gland_length(50) + 12.0
    F = tuple(TOOL_OUTLET[k] - L_g * o[k] for k in range(3))
    s_c = (F[0] + 92) / o[0]
    C = tuple(F[k] - s_c * o[k] for k in range(3))
    head_mm = bent_length([TOOL_OUTLET, F, C, (-92.0, 172.0, -60.0)], 0.0)[0]
    heads = [ch for ch in tool.children if ch.name.startswith('Head_')]
    far = max(float(np.linalg.norm(np.array(loc_matrix(h.loc)[:3, 3]) + np.array([0.0, 54.0, 0.0]) - np.array([-92.0, 172.0, -60.0])))
              for h in heads)

    def up_the_arm(L, od):
        for r in arm_runs:
            if r[0] == 'boot':
                L.run('boot', r[1], r[2], r[3].length, bend=r[3].tightest, moving=True, flex=r[3])
            else:
                mm = bent_length(r[3], 0.0)[0]
                L.run(r[0], r[1], r[2], mm, tol=r[4])
        L.run('duct', 'CHG-COH', 'into the head through the boot\'s outlet adapter (CHG-BTO) and the outlet housing\'s elbow', head_mm, tol=32.0)

    head_tail = (f'; {far:.0f} mm inside the head from the outlet housing to the farther connector, measured straight '
                 '(its route among the head\'s parts is not drawn)')
    for (lid, frm, to) in (
            ('CHG-LTL', 'the arm controller in the cabinet (CHG-CAC)', 'the head: the force sensor, the cameras, the light ring and the latches'),
            ('CHG-LCS', 'the cooling unit\'s supply socket in the cabinet (CHG-CCU, CHG-CCS)', 'the 2 connectors\' contacts, through a manifold in the head'),
            ('CHG-LCR', 'the cooling unit\'s return socket in the cabinet (CHG-CCU, CHG-CCS; the liquid flows this way, from the head)',
             'the 2 connectors\' contacts, through a manifold in the head'),
            ('CHG-LAR', 'the service air block\'s outlet in the cabinet (CHG-CAV, 6 bar)', 'the head\'s valves: the compliance lock and the 2 plunge cylinders')):
        L = lines[lid][0]
        up_the_arm(L, L.od)
        L.a, L.b = frm, to
        L.tail_b = round(far)
        L.tails += head_tail
        if lid != 'CHG-LTL':
            L.notes.append('One tube from the cabinet to the head, through both chains and all 4 boots, with no coupling on the way '
                           '(2026-11-15: the schedule had joined a 12 x 8 hose in the chains to an 8 mm tube in the boots with a '
                           'reducing coupling in CHG-PB0 that the model did not have).')
    # COOLANT: the 8 x 6 tube's pressure loss, laminar (Hagen-Poiseuille, dp = 128 mu L Q / (pi D^4)), at the flow a
    # liquid-cooled connector takes. Phoenix Contact's liquid-cooled CCS cables state 2 L/min of 50/50 water-glycol at 1 to
    # 2 bar (https://www.phoenixcontact.com/en-fr/products/dc-charging-cable-ev-t2hpcc-dc400a-80m50ecbk11r-1333722, read
    # 2026-11-15); 50 % ethylene glycol is about 3.7 mPa s and 1065 kg/m3 at 20 C (a computed value,
    # https://processconvert.pages.dev/substances/ethylene-glycol, read 2026-11-15; MEGlobal's glycol guide, its figure 7,
    # is the reference to confirm it). ASSUMPTION: the connector's own channels lose about as much as the 2 tubes together.
    Q, MU, RHO, D_IN = 2.0 / 60000.0, 3.7e-3, 1065.0, 0.006
    re_ = RHO * (Q / (math.pi * D_IN ** 2 / 4)) * D_IN / MU
    for lid in ('CHG-LCS', 'CHG-LCR'):
        L = lines[lid][0]
        run_m = (sum(r.mm for r in L.runs) + L.tail_a + L.tail_b) / 1000.0
        dp = 128 * MU * run_m * Q / (math.pi * D_IN ** 4) / 1e5
        L.notes.append(f'Its loss at 2 L/min: about {dp:.1f} bar over its {run_m:.1f} m (laminar, Re {re_:.0f}); supply and return '
                       f'together about {2 * dp:.1f} bar before the connector\'s own channels, so the cooling unit\'s pump must give '
                       '2 L/min against about 2 bar (ASSUMPTION: the connector\'s loss; the flow and the coolant are those of '
                       'Phoenix Contact\'s liquid-cooled CCS cables, 2 L/min of 50 % glycol, read 2026-11-15).')
    # THE CHARGE CURRENT up the arm: 4 braided links in boots and 2 pairs of copper bars, box to box
    boxes = {'CHG-PB0': (g['base'], PB0), 'CHG-PB1': (j1, (0.0, 265.0, -190.0)), 'CHG-PB2': (j2, (0.0, 300.0, -155.0)),
             'CHG-PB3': (j2, (0.0, LU - 250.0, -125.0)), 'CHG-PB4': (j3, (FORE_JOG[0], 250.0, -120.0)), 'CHG-PB5': (j3, (100.0, LF - 420.0, 0.0))}
    for (fid, b0, b1) in (('CHG-FL1', 'CHG-PB0', 'CHG-PB1'), ('CHG-FL2', 'CHG-PB1', 'CHG-PB2'), ('CHG-FL3', 'CHG-PB3', 'CHG-PB4'),
                          ('CHG-FL4', 'CHG-PB5', None)):
        fd = fx[fid]
        for pole in ('+', '-'):
            L = m.cable(f'{fid}{"P" if pole == "+" else "N"}', f'{fd.name.split(",")[0]}: DC{pole} braid, 400 mm2', 'dc', 26.0,
                        '400 mm2 braided copper, tinned, insulated for 1000 V DC; IEC 61238-1 lugs',
                        f'the DC{pole} terminal in {b0}', f'the DC{pole} terminal in {b1}' if b1 else f'the DC{pole} contacts of both connectors, in the head',
                        'DRESS', bend_moving=g['MB_BOOT'],
                        tails='the braid\'s length in each box: from the boot\'s fitting to the terminal at the box\'s centre (ASSUMPTION: the terminals stand at the centre)')
            n0, c0 = boxes[b0]
            L.run('duct', b0, f'in {b0}, from its DC terminal to the boot\'s fitting',
                  float(np.linalg.norm(np.array(c0) - np.array(fd.a.p))) if fd.a.node is n0 else 0.0)
            L.run('boot', fid, f'in the boot: the link\'s own length', fd.length, bend=fd.tightest, moving=True, flex=fd)
            if b1:
                n1, c1 = boxes[b1]
                L.run('duct', b1, f'in {b1}, from the boot\'s fitting to its DC terminal', float(np.linalg.norm(np.array(c1) - np.array(fd.b.p))))
            else:
                L.run('duct', 'CHG-COH', 'into the head through the outlet adapter and the outlet housing\'s elbow', head_mm, tol=32.0)
                L.tail_b = round(far)
                L.tails += (f'; {far:.0f} mm on inside the head to the farther connector, measured straight: there it parts into '
                            '2 short braids, one to each connector')
            L.notes.append('2 braids a link, DC+ and DC-, in one boot (the boot\'s spec).')
    # the copper in the links, as drawn (build: THE COPPER IN THE LINKS), box to box through the casting's ports
    cu = g['copper']
    for (pid, pole, b0, b1, od, R, spec) in (
            ('CHG-BBUP', '+', 'CHG-PB2', 'CHG-PB3', 10.0, 25.0, '40 x 10 mm copper bar (400 mm2), tinned, in a 1.5 mm heat-shrink sleeve'),
            ('CHG-BBUN', '-', 'CHG-PB2', 'CHG-PB3', 10.0, 38.0, '40 x 10 mm copper bar (400 mm2), tinned, in a 1.5 mm heat-shrink sleeve'),
            ('CHG-FCFP', '+', 'CHG-PB4', 'CHG-PB5', 26.0, 80.0, '400 mm2 flexible copper (braided, tinned), silicone jacket, OD 26'),
            ('CHG-FCFN', '-', 'CHG-PB4', 'CHG-PB5', 26.0, 80.0, '400 mm2 flexible copper (braided, tinned), silicone jacket, OD 26')):
        (n0, c0), (n1, c1) = boxes[b0], boxes[b1]
        bar = pid.startswith('CHG-BB')
        e0, e1 = cu['bar_ends'] if bar else cu['fc_ends'][pid]
        mm = cu['bars'][pid] if bar else cu['fcs'][pid]
        L = m.cable(pid, m.parts[pid].name, 'dc', od, spec + '; rated by rule of thumb, check against the Copper Development '
                    'Association\'s tables before purchase (the boxes\' spec)', f'the DC{pole} terminal in {b0}',
                    f'the DC{pole} terminal in {b1}', 'DRESS', bend_fixed=R,
                    tails='none: its lugs bolt to the 2 boxes\' terminals, and its piece in each box runs to the terminal at the box\'s '
                          'centre, measured straight (ASSUMPTION: the terminals stand at the centre)')
        L.run('duct', b0, f'in {b0}, from its DC terminal to the casting\'s port under the box',
              float(np.linalg.norm(np.array(c0) - np.array(e0))))
        L.run('drawn', pid, ('through the port into the upper arm, along its back wall on 3 insulators (CHG-BSO1-3) under their straps, '
                             'and out through the elbow end\'s port' if bar else
                             'through the slot into the forearm, round its swing in 2 cleats (CHG-FCC1-2), and out through the side slot'),
              mm, bend=R)
        L.run('duct', b1, f'in {b1}, from the casting\'s port to its DC terminal', float(np.linalg.norm(np.array(c1) - np.array(e1))))
        L.notes.append('Drawn and in the bill of materials since 2026-11-15 (until then the terminal boxes alone described it).')
    joint_cables(m, g['acts'], 'CHG-JC', KF)
    ring_leads(m, g['ring'], 'CHG-')
    # ── what the cabinet takes from the site (charge_cabinet.py): each drawn from the pad's underside, where the site's duct
    # brings it, up to what it serves. The site's run to it is not in the model: the DC feed's and the auxiliary supply's
    # wait on where the power unit stands, which the site plan does not show yet.
    P = m.parts
    unit = 'Its run from the power unit is the site\'s: the power unit has no place on the site plan yet, so its length is not known.'
    site_end = 'its end at the site is the site\'s (not counted)'
    feeds = []
    for k, pole in ((1, '+'), (2, '+'), (1, '-'), (2, '-')):
        feeds.append((f'CHG-SD{"P" if pole == "+" else "N"}{k}', 'dc', 26.0,
                      '1 x 185 mm2 copper, class 5, 1 kV (ASSUMPTION: 2 cores a pole carry 500 A; the site\'s cable calculation sets them)',
                      f'the power unit\'s DC{pole} output (site: the power unit is not drawn)', f'its lug on the DC{pole} input bar (CHG-CLG, CHG-CBI)',
                      'up through the pad\'s site shaft and the right gland plate to its lug\'s barrel', 0.0, 'its lug\'s barrel is crimped on its end', unit))
    feeds += [
        ('CHG-SAR', 'air', 12.0, '12 x 9 polyurethane', 'the canopy\'s air main (site)', 'the service air block\'s inlet (CHG-CAV, CHG-CAS12)',
         'up through the pad\'s site shaft and the right gland plate, 12 mm into the inlet', 0.0, 'it is drawn 12 mm into the inlet',
         'Its run from the canopy\'s air main is the site\'s: add it from the site\'s layout.'),
        ('CHG-SAX', 'power', 15.0, '5 x 6 mm2 (ASSUMPTION)', 'the power unit\'s auxiliary output (ASSUMPTION: a split charger\'s post takes it '
         'there; else the canopy\'s board)', 'the auxiliary isolator (CHG-CQS)', 'up through the pad\'s left site shaft and the left gland plate '
         'into the isolator from below', BOX_TAIL, f'{BOX_TAIL:.0f} mm to make it off on the isolator\'s terminals (ASSUMPTION)', unit),
        ('CHG-SNW', 'network', 8.0, 'industrial Cat 6A', 'the depot\'s network switch (site)', 'the network switch (CHG-CNS)',
         'up through the pad\'s left site shaft and the left gland plate into the left wiring duct', BOX_TAIL,
         f'{BOX_TAIL:.0f} mm to make it off at the switch (ASSUMPTION)', 'Its run from the depot\'s network switch is the site\'s: add it from the site\'s layout.'),
        ('CHG-SPE', 'power', 12.0, '50 mm2 copper, green-yellow (ASSUMPTION)', 'the site\'s earth (the power unit\'s earth bar and the depot\'s earth grid)',
         'the cabinet\'s earth bar (CHG-CPE)', 'up through the pad\'s left site shaft and the left gland plate to the earth bar\'s clamp', 50.0,
         '50 mm into the earth bar\'s clamp (ASSUMPTION)', 'Its run from the site\'s earth is the site\'s: add it from the site\'s layout.')]
    for (lid, kind, od, spec, frm, to, where, tail_b, basis, open_) in feeds:
        L = m.cable(lid, P[lid].name, kind, od, spec, frm, to, 'CABINET', bend_fixed=4 * od, tail_b=tail_b, tails=f'{site_end}; {basis}')
        L.run('site', '', 'from the site\'s end in its ducts to under the cabinet\'s pad: the site\'s length, not in the model', 0.0)
        L.run('drawn', lid, where, P[lid].path_mm)
        if lid == 'CHG-SNW':
            L.run('duct', 'CHG-CWL', 'inside the cabinet, planned: up the left wiring duct and along the third row\'s duct to the switch',
                  bent_length(g['cabg']['planned']['CHG-SNW'][0], 0.0)[0], tol=60.0)
        L.open.append(open_)


RING_TAIL = 40.0        # into a ring's diffuser through its grommet, to the strip's pads (ASSUMPTION)


def ring_leads(m: Model, ring: dict, prefix: str, suffix: str = '', what: str = '') -> None:
    """THE STATUS RINGS' LEADS of one arm (build_chain): the J2 rings' lead from J2's receptacle into the left ring, and
    the jumper from the left ring to the right one in the turret's cored channel. (The wrist ring has no cable: its plug
    mates J6's receptacle through the wrist tube's socket.)"""
    tails = f'{RING_TAIL:.0f} mm into the ring through its grommet to the strip\'s pads (ASSUMPTION)'
    L = m.cable(f'{prefix}RL2{suffix}', f'Ring lead, J2{what}: 4 x 0.25 mm2', 'control', RING_LEAD_D,
                '4 x 0.25 mm2, PUR, OD 4.5 mm, a molded M8 plug at one end',
                'J2\'s drive board, through its ring receptacle (CHG-RRC2) on the front of J2\'s rear bell',
                'the left J2 status ring (CHG-J2-RINGL)', 'SAFETY', bend_fixed=RING_LEAD_R, tail_b=RING_TAIL,
                tails=f'its plug screws onto the receptacle; {tails}')
    L.run('drawn', 'CHG-RL2', 'from the receptacle\'s plug out from the bell and over into the left ring\'s back', ring['rl2_mm'], bend=RING_LEAD_R)
    L.notes.append('Inside J2 the receptacle is wired to the drive board (ASSUMPTION: the drive gives a 24 V auxiliary output and '
                   'a data line for its ring; the drive\'s maker confirms them). About 8 W for the 2 rings.')
    L = m.cable(f'{prefix}RJ2{suffix}', f'Ring jumper, J2{what}: left ring to right ring, 4 x 0.25 mm2', 'control',
                RING_LEAD_D, '4 x 0.25 mm2, PUR, OD 4.5 mm', 'the left J2 status ring (CHG-J2-RINGL)',
                'the right J2 status ring (CHG-J2-RINGR)', 'SAFETY', tail_a=RING_TAIL, tail_b=RING_TAIL, tails=f'{tails}, at each end')
    L.run('drawn', 'CHG-RJ2', 'through the channel cored along the turret boss\'s top (CHG-TUR), under the 2 rings', ring['rj2_mm'])


def link_casting(m: Model, node: Node) -> str:
    """The largest structural part placed in a node: the link casting a joint cable runs inside."""
    best = max((it for it in node.items if it.part.category == 'structure'), key=lambda it: it.part.volume, default=None)
    return best.part.id if best is not None else ''


def joint_cables(m: Model, acts: list, prefix: str, KF: float, sub: str | None = None, what: str = '') -> None:
    """THE JOINT CABLES of one arm: from each actuator's drive a cable goes out through the joint's hollow shaft and on
    through the link to the next actuator's gland (motor power, 24 V, safe torque off and EtherCAT, as the gland's own text
    says). Each is planned from the 2 points the model fixes: straight, and up to a quarter more for its dressing."""
    import numpy as np
    from ..flex import loc_matrix, node_frames
    W0 = node_frames(m.root, {})

    def wpt(node, p):
        return (W0[id(node)] @ np.array([*p, 1.0]))[:3]
    for k in range(len(acts) - 1):
        a, b = acts[k], acts[k + 1]
        out_c = wpt(a['fixed'], loc_matrix(a['Tf'])[:3, 3])                       # its output face's centre: where it leaves the shaft
        gl = wpt(b['fixed'], (loc_matrix(b['gland'].loc) @ np.array([0, 0, 0, 1.0]))[:3])
        straight = float(np.linalg.norm(gl - out_c))
        L = m.cable(f'{prefix}{k + 1}', f'Joint cable{what}, {a["joint"]} to {b["joint"]}', 'power', 10.0, 'the joint supply cable\'s type, 10 mm',
                    f'{a["joint"]}\'s drive board', f'{b["joint"]}\'s actuator, its gland ({b["joint"]}\'s drive board inside)', sub or a['sub'],
                    bend_fixed=KF * 10.0, tail_a=BOX_TAIL, tail_b=BOX_TAIL,
                    tails=f'{BOX_TAIL:.0f} mm in each actuator to its drive board\'s connector (ASSUMPTION)')
        L.run('arm', f'{a["prefix"]}-HSG', f'through {a["joint"]}\'s hollow shaft, from its drive board at the back to its output face', a['L'])
        L.run('arm', link_casting(m, a['moving']), f'inside the link from {a["joint"]}\'s output to {b["joint"]}\'s gland: straight '
              f'{straight:.0f} mm, and up to a quarter more for its dressing in the casting', straight * 1.125, tol=straight * 0.125)


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


SPEC_HEAD: dict = {}


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
    # THE HEAD: two connectors side by side on one holder, CCS1 and NACS (SAE J3400). Each rides its own plunge cylinder
    # and rests 90 mm back; the one the car takes comes forward to the TCP plane, so the other stands clear of the car's
    # body beside the inlet. (A turret that turns one connector to the front was drawn first: wherever its axis went, the
    # idle connector swept the wrist, the camera pod or the cable outlet, or pointed at the car.)
    face_y = LT
    HDS = SPEC_HEAD
    SP, STROKE, HZ = abs(HDS['offsetX']['CCS1']) * 1000, HDS['stroke'] * 1000, HDS['offsetZ'] * 1000
    holder = (cq.Workplane('XZ', origin=(0, y, 0)).circle(58).extrude(-14)
              .union(cq.Workplane('XY').box(2 * SP + 116, 14, 116, centered=(True, False, True)).translate((0, y, HZ)).edges('|Y').fillet(20))
              .union(cq.Workplane('XY').box(90, 60, 30, centered=(True, False, True)).translate((0, y + 14, 50 + 15)))
              .union(cq.Workplane('XY').box(56, 96, 10, centered=(True, False, False)).translate((0, y + 14, -50))))
    m.place(tool, m.part(PartDef('CHG-CHL', 'Head holder', holder.val(), 'al6061', 'tool', 'machined', f'{2 * SP + 116:.0f} x 116',
                                 '6061-T6', None, 'Holds the 2 connectors\' plunge cylinders, the camera pod and the cable outlet on the tool flange.',
                                 {}, 'make')),
            Location(), (0, 160, 0))
    rest_face = face_y - STROKE
    body_len = rest_face - (y + 14) - 46
    cyl = cq.Workplane('XZ', origin=(0, y + 14, 0)).circle(10).extrude(-(body_len - 6))
    cyl_pd = m.part(PartDef('CHG-HPC', 'Connector plunge cylinder, 90 mm stroke, with lock', cyl.val(), 'ss304', 'tool', 'catalogue part',
                            f'D 20 x {body_len - 6:.0f}', '', None,
                            'Brings its connector forward 90 mm to the inlet and locks there. It draws back when the other connector works.',
                            {'stroke': '90 mm', 'drive': 'pneumatic, 6 bar, rod lock'}, 'buy', mass_override=0.6))
    dc = (cq.Workplane('XZ').circle(7.5).circle(4.2).extrude(-26))
    dc_pd = m.part(PartDef('CHG-DCC', 'DC contact socket, 8 mm', dc.val(), 'silver', 'tool', 'IEC 62196-3', '8 mm pin',
                           'silver plated', None, 'Carries the DC current. Spring bands give low resistance.', {}, 'buy'))
    sig = cq.Workplane('XZ').circle(2.8).circle(1.6).extrude(-18)
    sig_pd = m.part(PartDef('CHG-SGC', 'Signal contact socket, 3 mm', sig.val(), 'silver', 'tool',
                            'IEC 62196-3 / SAE J3400', '3 mm pin', 'silver plated', None,
                            'Earth, control pilot and proximity: the car and charger talk on the pilot.', {}, 'buy'))
    latch = (cq.Workplane('XY').box(16, 70, 14).translate((0, rest_face - 30, 46 + 7))
             .union(cq.Workplane('XY').box(16, 14, 22).translate((0, rest_face + 7, 41))))
    latch_pd = m.part(PartDef('CHG-LAT', 'Connector latch hook', latch.val(), 'ss304', 'tool', 'machined', '16 x 70',
                              '', None, 'Hooks the inlet catch. The car cannot pull the connector out under load.', {}, 'make'))
    # on the latch's tail, 1 mm clear of the connector body (radius 50 at its widest)
    sol = cq.Workplane('XY').box(36, 48, 30).edges('|Y').fillet(4).translate((0, rest_face - 89, 51 + 15))
    sol_pd = m.part(PartDef('CHG-SOL', 'Latch solenoid, 24 V', sol.val(), 'steel_paint', 'tool', 'catalogue part',
                            '36 x 46 x 30', '', None, 'Moves the latch hook. A spring locks it when power is off.',
                            {'force': '35 N at 5 mm stroke'}, 'buy'))
    HEADS = (('CCS', HDS['offsetX']['CCS1'] * 1000, 'CCS1 (SAE J1772 combo)', 40.0, 36.0, [(-14, -16), (14, -16)], [(0, 24), (-12, 14), (12, 14), (-8, 3), (8, 3)]),
             ('NACS', HDS['offsetX']['NACS'] * 1000, 'NACS (SAE J3400)', 34.0, 30.0, [(-12, -6), (12, -6)], [(0, 17), (-9, 10), (9, 10)]))
    for (hn, hx, hstd, r0, r1, pts_dc, pts_sig) in HEADS:
        m.place(tool, cyl_pd, loc(hx, 0, HZ), (0, 150, 0))
        hd = tool.child(f'Head_{hn}', loc(hx, 0, HZ), sub='TOOL',
                        joint={'name': f'HD_{hn}', 'axis': [0, 1, 0], 'limits': [0, STROKE / 1000], 'kind': 'prismatic', 'stowed': 0})
        body = (cq.Workplane('XZ', origin=(0, y + 14, 0)).circle(50).workplane(offset=-body_len * 0.6).circle(46).loft()
                .union(cq.Workplane('XZ', origin=(0, y + 14 + body_len * 0.6, 0)).circle(46).extrude(-body_len * 0.4))
                .cut(cq.Workplane('XZ', origin=(0, y + 13, 0)).circle(10.4).extrude(-(body_len - 4))))      # the cylinder's bore
        m.place(hd, m.part(PartDef(f'CHG-CON-{hn}', f'DC connector body, robotic, {hstd}', body.val(), 'pa66', 'tool',
                                   hstd, 'body OD 100', '', None,
                                   'Carries the DC and signal contacts to the inlet. The coolant flows to the contacts inside.',
                                   {'current': '500 A, liquid-cooled', 'voltage': '1000 V DC'}, 'buy')),
                Location(), (0, 200, 0))
        nose_y0 = y + 14 + body_len
        nose = (cq.Workplane('XZ', origin=(0, nose_y0, 0)).circle(r0).workplane(offset=-(rest_face - nose_y0)).circle(r1).loft())
        nose = nose.faces('>Y').workplane().pushPoints(pts_dc).hole(15, 30)        # the sockets press into these
        nose = nose.faces('>Y').workplane().pushPoints(pts_sig).hole(5.6, 30)
        r_or = r1 + (r0 - r1) * (4 / (rest_face - nose_y0))  # the nose's radius at the O-ring, 4 mm from the face
        nose = nose.cut(cq.Workplane('XZ', origin=(0, rest_face - 2.5, 0)).circle(r_or + 1).circle(r_or - 2.6).extrude(3))
        m.place(hd, m.part(PartDef(f'CHG-NOS-{hn}', f'Connector nose and face, {hstd}', nose.val(), 'pa66', 'tool', 'moulded',
                                   f'OD {2 * r0:.0f} x {rest_face - nose_y0:.0f}', '', None,
                                   'Enters the inlet. Its shape guides the last few millimetres.', {}, 'make')),
                Location(), (0, 240, 0))
        for (u, v) in pts_dc:                            # a '>Y' face workplane maps (u, v) to world (x, z) = (-u, v)
            m.place(hd, dc_pd, loc(-u, rest_face - 26, v), (0, 260, 0))
        for (u, v) in pts_sig:
            m.place(hd, sig_pd, loc(-u, rest_face - 24, v), (0, 260, 0))
        m.place(hd, latch_pd, Location(), (0, 230, 50))
        m.place(hd, sol_pd, Location(), (0, 200, 90))
        m.place(hd, std.oring(round(2 * (r_or - 1.1) - 3), 3, 'Seals the connector nose in the inlet against rain.'),
                loc(0, rest_face - 4, 0), (0, 300, 0))
        r_b = r0 - (r0 - r1) * (28 / (rest_face - nose_y0))  # the nose's radius at the bumper's foot
        bump = cq.Workplane('XZ', origin=(0, rest_face - 18, 0)).circle(r_b + 3).circle(r_b).extrude(-12)
        m.place(hd, m.part(PartDef(f'CHG-BMP-{hn}', 'Connector nose bumper, TPE', bump.val(), 'rubber', 'tool', 'moulded',
                                   f'OD {2 * (r_b + 3):.0f} x 12', '', None,
                                   'Takes a light knock on the inlet rim without damage. The force sensor stops the arm.', {}, 'buy')),
                Location(), (0, 280, 0))
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
    # the cable outlet: a housing on the holder's spine, its elbow down and round to a swivel gland that points out along +X
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
                                 'Leads the charge cable out of the head to the side, so the span leaves along J5\'s axis. Inside the head 2 short braids a pole reach each connector.',
                                 {}, 'make')), Location(), (-60, 200, -60))
    for (xs, ys) in ((-20, 150), (20, 150), (-20, 195), (20, 195)):
        m.place(tool, std.shcs(6, 40, 'A2-70', 'Holds the cable outlet housing to the holder\'s spine.'),
                std.orient((xs, ys, -80), (0, 0, 1)), (-60, 200, -90))
    # the boot's end: an adapter screwed into the outlet's M50 port, a hex to turn it by, a neck out to the boot's end, and
    # the collar the 60 mm boot slides into (it was an M50 gland for a 30 to 38 mm cable, 12 mm short of the boot's end)
    thr = cq.Workplane('XZ').circle(25.0).extrude(22.5)                 # local -Y: into the port (orient puts -Y along d)
    hx = std._hex(64.0, 20.5)
    neck = cq.Workplane('XZ', origin=(0, 20.5, 0)).circle(31.0).extrude(-(L_g - 20.5))
    col = cq.Workplane('XZ', origin=(0, L_g, 0)).circle(36.0).circle(R_BOOT_BORE).extrude(-18.0)
    bto = thr.union(hx).union(neck).union(col).cut(cq.Workplane('XZ', origin=(0, L_g + 1, 0)).circle(20.0).extrude(L_g + 24))
    m.place(tool, m.part(PartDef('CHG-BTO', 'Boot outlet adapter M50 x 1.5 for the 60 mm boot', bto.val(), 'al6061_blk', 'electrical',
                                 'made to order', f'M50 x 1.5, hex 64, collar OD 72, {L_g + 18:.1f} long', '6061-T6, black anodised', None,
                                 'Holds the wrist boot\'s end on the connector head\'s outlet. The boot slides into its collar.',
                                 {'bore': f'{2 * R_BOOT_BORE:g} mm collar, 40 mm through', 'seal': 'IP67, an O-ring on the thread'}, 'make')),
            std.orient(F, TOOL_OUTLET_IN), (-80, 200, -80))


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
