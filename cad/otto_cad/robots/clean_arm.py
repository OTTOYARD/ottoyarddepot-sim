"""OTTO-CLEAN ARM — the overhead robot that vacuums a car's cabin while it charges (docs/OTTO-CLEAN-ARM.md).

Geometry is the twin's (cad/spec/robots.json <- cleanArmSpec.ts): a ceiling SCARA hung from the canopy,
J1 shoulder yaw at 3.42 m, link 1 0.95 m, J2 elbow yaw, link 2 0.80 m riding 0.19 m under link 1, J3 mast
yaw at link 2's tip, a 3-stage telescoping mast (foot 2.28 m retracted, down to 0.68 m), J4 wrist pitch,
a 4-tube wand (0.45 m + up to 0.92 m; the twin draws 3 tubes) and J5 nozzle pitch.

FRAME: the parked car's frame. Origin at the car's centre on grade, +Y up, +X toward the nose, +Z toward the
right flank. Built at the zero pose (links along +X, mast retracted, wand level along +X); the joint nodes
carry the twin's HOME pose (cleanJointsAt('home')) as `stowed`, with the twin's own node conventions
(buildCleanArm.ts): J1/J2/J3 rotate about +Y by -t1, -t2, -(yaw - t1 - t2); the mast stages slide down by
half the extension each; PITCH and NOZZLE rotate about +Z; the wand's 3 sliding tubes slide along +X by ext/3 each
(the twin's 2 slide ext/2 each: retracted, those stood 120 mm behind the pivot, see the WAND section).
"""
from __future__ import annotations

import math

import cadquery as cq
from cadquery import Location, Vector

from .. import std
from ..actuator import SIZES, build_actuator, module_length, out_flange_points, rear_od
from ..core import Model, Node, PartDef, loc


WAND_SLIDES = 3                 # sliding wand tubes (the twin draws 2)
WAND_R = (29.3, 25.65)          # outer radii of wand tubes 2 and 3; tube 1 is the twin's 68 mm, tube 4 its 44 mm


def _stadium(L: float, w: float, h: float, r0: float, r1: float) -> cq.Workplane:
    """A link: from a round end of radius r0 at x = 0 to one of radius r1 at x = L, h tall (Y), centred on y = 0."""
    hull = (cq.Workplane('XZ').polyline([(0, -r0), (L, -r1), (L, r1), (0, r0)]).close().extrude(h / 2, both=True))
    return hull.union(cq.Workplane('XZ').circle(r0).extrude(h / 2, both=True)) \
        .union(cq.Workplane('XZ').center(L, 0).circle(r1).extrude(h / 2, both=True))


def _box_link(L: float, w: float, h: float, wall: float, hub0: float, hub1: float, pockets: tuple = ()) -> cq.Shape:
    """A welded box link between two hubs. Bosses stop 1 mm inside the top and bottom skins and never
    pass the link's own end radius: coplanar or tangent faces make the boolean hang."""
    r0, r1 = w / 2, w / 2 * 0.9
    outer = _stadium(L, w, h, r0, r1)
    inner = _stadium(L, w - 2 * wall, h - 2 * wall, r0 - wall, r1 - wall)
    body = outer.cut(inner)
    for (x, d, r_end) in ((0.0, hub0, r0), (L, hub1, r1)):
        rb = min(d / 2 + 14, r_end - 1.5)
        if rb > d / 2 + 2:
            body = body.union(cq.Workplane('XZ').center(x, 0).circle(rb).extrude(h / 2 - 1, both=True))
    body = body.cut(cq.Workplane('XY').box(L - r0 - r1, wall + 2, w - 2 * wall - 16).translate((L / 2, h / 2 - wall / 2 + 0.5, 0)))
    body = body.cut(cq.Workplane('XZ').circle(hub0 / 2).extrude(h, both=True))
    body = body.cut(cq.Workplane('XZ').center(L, 0).circle(hub1 / 2).extrude(h, both=True))
    for (x, z, d, y_top, y_bot) in pockets:          # counterbores for screw heads, from y_top down to y_bot
        body = body.cut(cq.Workplane('XZ', origin=(x, y_top, z)).circle(d / 2).extrude(y_top - y_bot))
    return body.val()


def _sq_tube(a: float, t: float, L: float) -> cq.Shape:
    """A square tube, a x a, wall t, from y = 0 down to y = -L."""
    return (cq.Workplane('XZ').rect(a, a).extrude(L).edges('|Y').fillet(t * 1.5)
            .cut(cq.Workplane('XZ', origin=(0, 1, 0)).rect(a - 2 * t, a - 2 * t).extrude(L + 2).edges('|Y').fillet(t * 0.8))).val()


def _xp(T: Location, p: tuple[float, float, float]) -> tuple[float, float, float]:
    from OCP.gp import gp_Pnt
    q = gp_Pnt(*p).Transformed(T.wrapped.Transformation())
    return (q.X(), q.Y(), q.Z())


def _xd(T: Location, d: tuple[float, float, float]) -> tuple[float, float, float]:
    from OCP.gp import gp_Vec
    v = gp_Vec(*d).Transformed(T.wrapped.Transformation())
    return (v.X(), v.Y(), v.Z())


def build(spec: dict) -> Model:
    A = spec['cleanArm']
    car = spec['car']
    M = 1000.0
    mx = A['mountX'] * M
    y1 = A['link1Y'] * M
    drop = A['link2Drop'] * M
    L1, L2 = A['link1']['len'] * M, A['link2']['len'] * M
    s0, s1, s2 = (v * M for v in A['mast']['sections'])
    oA, oB = A['mast']['outerAbove'] * M, A['mast']['outerBelow'] * M
    stage, overlap = A['mast']['stage'] * M, A['mast']['overlap'] * M
    pbf = A['pivotBelowFoot'] * M
    wb, wext = A['wand']['base'] * M, A['wand']['maxExt'] * M
    wr, wr2, wr3 = A['wand']['r'] * M, A['wand']['rMid'] * M, A['wand']['rInner'] * M
    N = {k: v * M for k, v in A['nozzle'].items()}
    cn = A['canopy']
    home = A['home']

    m = Model('clean_arm', 'OTTO-CLEAN ARM',
              'Parked car frame: origin at the car centre on grade, +Y up, +X toward the nose, +Z toward the right '
              'flank. Zero pose: links along +X, mast retracted, wand level.')
    m.subsystem('MOUNT', 'Canopy mount', 'A header beam under 2 canopy purlins and a drop column carry the arm over the stall. Nothing stands where a car drives.',
                how=['4 angle clips bolt the header to the purlins.', 'The drop column bolts to the header and carries the J1 base.',
                     'The vacuum riser runs down the column to the arm.'],
                specs={'J1 height': f'{y1 / 1000:.2f} m above grade', 'column': 'SHS 200 x 200 x 8'}, group='Structure')
    m.subsystem('J1', 'J1 shoulder yaw', 'Swings link 1 about the column. With J2 it puts the mast anywhere over the car.',
                how=['A size 32 actuator in the base casting drives link 1 from above.', 'Its motor bell sits inside the drop column.'],
                specs={'gear': 'strain-wave, size 32, 100:1'}, group='Joints')
    m.subsystem('LINK1', 'Link 1', f'The {L1 / 1000:.2f} m box link from J1 to J2.',
                how=['Welded aluminium box with a bolted top cover.', 'An energy chain on top carries the hose and cables to J2.'], group='Links')
    m.subsystem('J2', 'J2 elbow yaw', 'Folds link 2 under link 1, so the arm can tuck in over the roof.',
                how=['A size 25 actuator in the link 1 tip drives link 2 below it.'], specs={'gear': 'strain-wave, size 25, 100:1'},
                group='Joints')
    m.subsystem('LINK2', 'Link 2', f'The {L2 / 1000:.2f} m box link from J2 to the mast.', how=['It rides 190 mm under link 1.'], group='Links')
    m.subsystem('J3', 'J3 mast yaw', 'Turns the mast, so the wand points along or across the car.',
                how=['A cross-roller bearing carries the mast collar in the carriage at the tip of link 2.',
                     'A servo gearmotor on the lid turns a 120-tooth ring on the collar through a toothed belt, 5:1.',
                     'J3 turns 462 degrees in one cleaning cycle, so the vacuum and the signals cross it in a rotary union '
                     'with a slip ring on the mast axis: no hose or cable winds up.'],
                specs={'drive': 'servo + 20:1 planetary + 5:1 belt', 'range': '-186 to +292 degrees'}, group='Joints')
    m.subsystem('MAST', 'Telescoping mast', 'Lowers the wrist from 2.18 m to 0.58 m above grade, beside the car, never over it.',
                how=['A rack and pinion drives the middle stage.', 'A belt over a pulley on the middle stage moves the inner stage twice as far.',
                     'Acetal wear pads guide each stage. A brake holds it when power is off.'],
                specs={'stroke': f'{2 * (stage - overlap) / 1000:.2f} m', 'stages': '160, 125, 95 mm square'}, group='Motion')
    m.subsystem('WRIST', 'J4 wrist pitch', 'Tilts the wand from level to hanging down, and into the door opening.',
                how=['A size 20 actuator beside the hub turns it.',
                     'The vacuum crosses the joint through the hub\'s hollow stub and a swivel on the fork, on the joint\'s axis.'],
                specs={'gear': 'strain-wave, size 20, 100:1', 'range': '-90 to +45 degrees'}, group='Joints')
    m.subsystem('WAND', 'Telescoping vacuum wand', 'Reaches into the cabin through the open door. The wand is the vacuum duct.',
                how=['3 tubes slide inside the base tube and each other on lip seals. The air flows inside them.',
                     'An electric linear drive moves tube 2; cables over pulleys move tubes 3 and 4 with it, a third of the reach each.',
                     'Retracted, all the tubes lie inside the base tube, in front of the hub.'],
                specs={'reach': f'{wb / 1000:.2f} m + {wext / 1000:.2f} m', 'tubes': '68, 58.6, 51.3, 44 mm'}, group='Motion')
    m.subsystem('NOZZLE', 'Nozzle head (J5)', 'Cleans the floor, the benches and the seat backs: vacuum, an air knife and a brush lip.',
                how=['A gearmotor with a worm stage pitches the head.', 'The air knife blows dust out of seams into the vacuum flow.',
                     'A light ring shows that it works, and lights the cabin for the camera.'],
                specs={'mouth': f'{N["w"]:.0f} x {N["h"]:.0f} mm', 'air knife': '6 bar'}, group='Tool')
    m.subsystem('VAC', 'Vacuum and air supply', 'Brings vacuum and compressed air from the canopy plant to the nozzle.',
                how=['A central vacuum producer on each canopy (about 3 kW per working arm, 30 kPa class) serves its arms.',
                     'A riser pipe and the link hoses bring the flow to the J3 swivel; the mast stages are the duct down to the '
                     'wrist; a hose to the swivel on the wrist fork, the hub and the wand carry it to the nozzle. '
                     'A 6 mm line carries the air.'],
                specs={'hose': 'PU, 50 mm, steel helix', 'airflow': 'about 400 m3/h per producer (class)'}, group='Supply')
    m.subsystem('STATUS', 'Status lights', 'Show the arm state to the site and to the camera.',
                how=['A ring on the J1 base, a strip on the mast and a ring at the nozzle.'], group='Safety')

    root = m.root
    base = root.child('Base', sub='MOUNT')

    # ══════════════════════════════════════════════════════════════ MOUNT ═══
    hb = cn['headerBottomAboveDeck'] * M
    hd, hw = cn['headerDepth'] * M, cn['headerWidth'] * M
    e_ang = 30.0                                   # the header runs east-west; the car's axis is 60 deg off north
    s_in, s_out = 2.6 * spec['yardstick_m_per_plan_unit'] * M, 1.2 * spec['yardstick_m_per_plan_unit'] * M
    hdr_len = s_in + s_out
    header = (cq.Workplane('XY').box(hdr_len, hd, hw).translate(((s_in - s_out) / 2, hb + hd / 2, 0))
              .cut(cq.Workplane('XY').box(hdr_len + 2, hd - 16, hw - 16).translate(((s_in - s_out) / 2, hb + hd / 2, 0))))
    Th = Location(Vector(mx, 0, 0)) * Location(Vector(0, 0, 0), Vector(0, 1, 0), -e_ang)
    m.place(base, m.part(PartDef('CLN-HDR', 'Header beam, RHS 200 x 180 x 8', header.val(), 'steel_s355', 'structure',
                                 'EN 10219', f'{hdr_len:.0f} long', 'S355J2H', None,
                                 'Spans the 2 canopy purlins over the arm. It carries the column.', {}, 'make')), Th, (0, 260, 0))
    for sp in (s_in - 0.2 * 478.5, -s_out + 0.2 * 478.5):
        pur = cq.Workplane('XY').box(75, 200, 1600)
        m.place(base, m.part(PartDef('CLN-PUR', 'Canopy purlin (part of the canopy)', pur.val(), 'steel_s355', 'structure',
                                     'canopy steel', 'C 200 x 75', '', None, 'Carries the solar roof. Shown for context.', {}, 'buy',
                                     reference=True)), Th * loc(sp, hb + hd + 100, 0), (0, 420, 0))
        for side in (-1, 1):
            clip = (cq.Workplane('XY').box(100, 100, 10).translate((0, 50, 5))
                    .union(cq.Workplane('XY').box(100, 10, 100).translate((0, 95, 50))))   # top leg flush with the header top
            Tc = Th * loc(sp + side * 70, hb + hd - 100, hw / 2 if side > 0 else -hw / 2 - 10 + 10, ry=0 if side > 0 else 180)
            m.place(base, m.part(PartDef('CLN-CLP', 'Angle clip 100 x 100 x 10', clip.val(), 'steel_s355', 'structure',
                                         'EN 10056-1', 'L 100 x 100 x 10, 100 long', 'S355JR', None,
                                         'Joins the header to the purlin. 2 bolts into each.', {}, 'make')), Tc, (0, 300, 0))
            for dy in (30, 70):
                pt = (sp + side * 70, hb + hd - 100 + dy, (hw / 2 + 10) * (1 if side > 0 else -1))
                std.bolt_stack(m, base, 'MOUNT', _xp(Th, pt), _xd(Th, (0, 0, -side)), 12, 40, 10 + 8,
                               fn='Bolts the clip to the header web.', explode=(0, 320, 0))
    col_top, col_bot = hb, A['canopy']['columnBottomAboveDeck'] * M
    col = cq.Workplane('XY').add(_sq_tube(200, 8, col_top - col_bot - 40)).translate((0, col_top - 20, 0))
    col = col.union(cq.Workplane('XY').box(300, 20, 300).translate((0, col_top - 10, 0)))
    col = col.union(cq.Workplane('XY').box(300, 20, 300).translate((0, col_bot + 10, 0))
                    .cut(cq.Workplane('XZ', origin=(0, col_bot + 21, 0)).circle(SIZES[32].od / 2).extrude(22)))   # J1 rises through it
    _ca, _sa = math.cos(math.radians(30.0)), math.sin(math.radians(30.0))
    _pts = [(u * _ca - v * _sa, u * _sa + v * _ca) for u in (-115, 115) for v in (-70, 70)]
    col = col.faces('>Y').workplane(centerOption='CenterOfBoundBox').pushPoints([(-x, z) for (x, z) in _pts]).hole(17.5)
    col = col.faces('<Y').workplane(centerOption='CenterOfBoundBox').pushPoints(
        [(p[0], p[2]) for p in std.circle_points(8, 125, 'y', start=22.5)]).hole(13.5)
    m.place(base, m.part(PartDef('CLN-COL', 'Drop column weldment', col.val(), 'steel_s355', 'structure', 'EN 1090-2 EXC2',
                                 f'SHS 200 x 200 x 8, {col_top - col_bot:.0f}', 'S355J2H', None,
                                 'Hangs from the header and carries the J1 base. Hot-dip galvanised.', {}, 'make')),
            loc(mx, 0, 0), (0, 200, 0))
    ca, sa = math.cos(math.radians(e_ang)), math.sin(math.radians(e_ang))
    for u in (-115, 115):                                # along the header
        for v in (-70, 70):                              # across it, inside its 200 mm width, the nuts clear of the tube
            x, z = u * ca - v * sa, u * sa + v * ca
            m.place(base, std.hex_bolt(16, 70, '8.8', 'Bolts the column top plate to the header.'),
                    std.orient((mx + x, col_top + hd + 3, z), (0, -1, 0)), (0, 380, 0))
            m.place(base, std.washer(16), std.orient((mx + x, col_top + hd, z), (0, -1, 0)), (0, 370, 0))
            m.place(base, std.nut(16, nyloc=True), std.orient((mx + x, col_top - 20, z), (0, 1, 0)), (0, 240, 0))
    # vacuum riser pipe down the column's -X face, with saddle clips
    riser = cq.Workplane('XZ', origin=(0, col_top, 0)).circle(25).circle(22).extrude(col_top - (col_bot + 60))
    m.place(base, m.part(PartDef('CLN-VRS', 'Vacuum riser pipe, 50 mm', riser.val(), 'ss304', 'fluid', 'EN 10217-7',
                                 f'50 x 3, {col_top - col_bot - 60:.0f}', '', None,
                                 'Carries the vacuum from the header duct down to the arm.', {}, 'make')),
            loc(mx - 175, 0, 0), (-160, 0, 0), 'VAC')
    for y in (col_bot + 300, (col_bot + col_top) / 2, col_top - 200):
        m.place(base, m.part(PartDef('CLN-PCL', 'Pipe clip, 50 mm', cq.Workplane('XZ').circle(29).circle(25).extrude(15, both=True)
                                     .union(cq.Workplane('XY').box(46, 30, 10).translate((29 + 23 - 2, 0, 0))).val(), 'ss304', 'fluid',
                                     'catalogue part', 'for OD 50', '', None, 'Holds the riser pipe to the column.', {}, 'buy')),
                loc(mx - 175, y, 0), (-180, 0, 0), 'VAC')

    # ═══════════════════════════════════════════════════════ J1 + link 1 ═══
    j1 = base.child('CA_J1', loc(mx, y1, 0), sub='J1',
                    joint={'name': 'CA_J1', 'axis': [0, 1, 0], 'limits': [-3.05, 3.05], 'kind': 'revolute',
                           'stowed': -home['t1']})
    h1, h2 = A['link1']['h'] * M, A['link2']['h'] * M
    s32 = SIZES[32]
    Tm1 = loc(0, h1 / 2, 0, rx=180)                 # module +Y -> world -Y (output down onto link 1)
    a1 = build_actuator(m, base, j1, 32, loc(mx, y1, 0), Tm1, 'CLN-J1', 'J1', gland_m=20)
    # base casting: the twin's J1 drum (r 170) from link 1's top face up to the column's foot
    bc_y0, bc_y1 = y1 + h1 / 2 + 3, col_bot
    bcast = (cq.Workplane('XZ', origin=(0, bc_y1, 0)).circle(A['j1']['r'] * M).extrude(bc_y1 - bc_y0)
             .union(cq.Workplane('XZ', origin=(0, bc_y1, 0)).circle(A['j1']['r'] * M * 1.18).extrude(22))
             .cut(cq.Workplane('XZ', origin=(0, bc_y1 + 1, 0)).circle(s32.od / 2).extrude(bc_y1 - bc_y0 + 2)))
    bcast = bcast.faces('>Y').workplane(centerOption='CenterOfBoundBox').pushPoints(
        [(p[0], p[2]) for p in std.circle_points(8, 125, 'y', start=22.5)]).hole(10.2, 20)
    m.place(base, m.part(PartDef('CLN-BAS', 'J1 base casting', bcast.val(), 'a356_dark', 'structure', 'casting, machined',
                                 f'OD {A["j1"]["r"] * M * 2:.0f}', 'A356-T6', None,
                                 'Holds the J1 actuator under the column. Its flange bolts to the column foot.', {}, 'make')),
            loc(mx, 0, 0), (0, 120, 0), 'J1')
    for p in std.circle_points(8, 125, 'y', offset=col_bot + 20, start=22.5):
        m.place(base, std.shcs(12, 40, '10.9', 'Holds the base casting to the column foot.'), std.orient((mx + p[0], p[1], p[2]), (0, -1, 0)),
                (0, 260, 0), 'J1')
    ring = cq.Workplane('XY').add(cq.Solid.makeTorus(A['j1']['r'] * M + 7, 7, pnt=Vector(0, bc_y0 + 20, 0), dir=Vector(0, 1, 0)))
    m.place(base, m.part(PartDef('CLN-RNG1', 'Status light ring, J1 base', ring.val(), 'led', 'electrical', 'LED strip in PC diffuser',
                                 f'OD {A["j1"]["r"] * M * 2:.0f}', '', None, 'Shows the arm state: teal ready, amber moving, green cleaning, red fault.',
                                 {}, 'buy')), loc(mx, 0, 0), (0, 60, 0), 'STATUS')
    band = cq.Workplane('XY').add(cq.Solid.makeTorus(A['j1']['r'] * M + 5, 5, pnt=Vector(0, bc_y1 - 30, 0), dir=Vector(0, 1, 0)))
    m.place(base, m.part(PartDef('CLN-BND', 'Accent band, J1 base', band.val(), 'accent', 'structure', 'moulded', '', '', None,
                                 'OTTOYARD red band at the root of the moving machine.', {}, 'make')), loc(mx, 0, 0), (0, 70, 0), 'J1')
    hub0 = out_flange_points(32)[0][0] * 2 + 30
    s25 = SIZES[25]
    pk1 = tuple((p[0], p[2], std.ISO4762[8][0] + 1, -h1 / 2 - 1, h1 / 2 - 14) for p in out_flange_points(32))
    link1 = _box_link(L1, A['link1']['w'] * M, h1, 6, hub0 * 0.55, s25.od, pk1)
    m.place(j1, m.part(PartDef('CLN-L1', 'Link 1 weldment', link1, 'al6061', 'structure', 'EN 1090-3, machined after welding',
                               f'{L1:.0f} between axes, 170 x 150', '6061-T6', None,
                               'Carries J2 at 0.95 m from J1. A box section: stiff in bending and twist.', {'wall': '6 mm'}, 'make')),
            Location(), (0, 0, 0), 'LINK1')
    for p in out_flange_points(32):
        m.place(j1, std.shcs(8, 30, '12.9', 'Holds link 1 to the J1 output flange.'), std.orient((p[0], h1 / 2 - 14, p[2]), (0, 1, 0)),
                (0, -150, 0), 'LINK1')
    c1a, c1b = A['j1']['r'] * M + 5, L1 - A['j2']['r'] * M - 5
    cover1 = cq.Workplane('XY').box(c1b - c1a, 3, A['link1']['w'] * M - 20).translate(((c1a + c1b) / 2, h1 / 2 + 1.5, 0))
    m.place(j1, m.part(PartDef('CLN-L1C', 'Link 1 top cover', cover1.val(), 'al6061_blk', 'structure', 'sheet 3 mm',
                               f'{c1b - c1a:.0f} x 150', '', None, 'Closes the link. Off for service.', {}, 'make')), Location(), (0, 90, 0), 'LINK1')
    for i in range(6):
        for zz in (-62, 62):
            m.place(j1, std.bhcs(5, 10, 'A2-70', 'Holds the link cover.'),
                    std.orient((c1a + 10 + i * (c1b - c1a - 20) / 5, h1 / 2 + 3, zz), (0, -1, 0)), (0, 110, 0), 'LINK1')
    chain = std.chain_link(60, 30, 32)
    x0c, x1c = A['j1']['r'] * M + 15, L1 - A['j2']['r'] * M - 15          # between the J1 base and the J2 drum
    n1 = int((x1c - x0c) // 32)
    for i in range(n1):
        m.place(j1, chain, loc(x0c + i * 32 + 16, h1 / 2 + 3 + 15, 0), (0, 180, 0), 'LINK1')

    # ═══════════════════════════════════════════════════════ J2 + link 2 ═══
    j2 = j1.child('CA_J2', loc(L1, 0, 0), sub='J2',
                  joint={'name': 'CA_J2', 'axis': [0, 1, 0], 'limits': A['limits']['j2'], 'kind': 'revolute', 'stowed': -home['t2']})
    Tm2 = loc(0, -drop + h2 / 2, 0, rx=180)
    build_actuator(m, j1, j2, 25, loc(L1, 0, 0), Tm2, 'CLN-J2', 'J2', gland_m=16)
    # the twin's J2 drum (r 130, h 360): an upper cover on link 1 and a lower one on link 2
    jr = A['j2']['r'] * M
    up_cov = (cq.Workplane('XZ', origin=(0, -h1 / 2, 0)).circle(jr).circle(jr - 4).extrude(-h1 / 2 - (-drop + h2 / 2 + 24)))
    m.place(j1, m.part(PartDef('CLN-J2C', 'J2 drum cover, upper', up_cov.val(), 'a356_dark', 'structure', 'casting',
                               f'OD {2 * jr:.0f}', '', None, 'Closes the J2 actuator between the links.', {}, 'make')),
            loc(L1, 0, 0), (0, -60, 0), 'J2')
    pk2 = tuple((p[0], p[2], std.ISO4762[6][0] + 1, h2 / 2 + 1, -h2 / 2 + 14) for p in out_flange_points(25))
    link2 = _box_link(L2, A['link2']['w'] * M, h2, 5, out_flange_points(25)[0][0] * 1.1, 270, pk2)
    m.place(j2, m.part(PartDef('CLN-L2', 'Link 2 weldment', link2, 'al6061', 'structure', 'EN 1090-3, machined after welding',
                               f'{L2:.0f} between axes, 140 x 130', '6061-T6', None,
                               'Carries the mast 0.80 m from J2.', {'wall': '5 mm'}, 'make')),
            loc(0, -drop, 0), (0, -80, 0), 'LINK2')
    for p in out_flange_points(25):
        m.place(j2, std.shcs(6, 25, '12.9', 'Holds link 2 to the J2 output flange.'), std.orient((p[0], -drop - h2 / 2 + 14, p[2]), (0, -1, 0)),
                (0, -200, 0), 'LINK2')
    x0c, x1c = jr + 15, L2 - 160                      # between the J2 drum and the J3 carriage
    n2 = int((x1c - x0c) // 32)
    for i in range(n2):
        m.place(j2, chain, loc(x0c + i * 32 + 16, -drop + h2 / 2 + 3 + 15, 0), (0, 160, 0), 'LINK2')

    lo_cov = cq.Workplane('XZ', origin=(0, -drop + h2 / 2, 0)).circle(jr).circle(jr - 4).extrude(-22)
    m.place(j2, m.part(PartDef('CLN-J2L', 'J2 drum cover, lower', lo_cov.val(), 'a356_dark', 'structure', 'casting',
                               f'OD {2 * jr:.0f}', '', None, 'Turns with link 2 under the upper cover. A labyrinth between them sheds water.',
                               {}, 'make')), Location(), (0, -90, 0), 'J2')
    c2a, c2b = jr + 5, L2 - 145
    cover2 = cq.Workplane('XY').box(c2b - c2a, 3, A['link2']['w'] * M - 20).translate(((c2a + c2b) / 2, -drop + h2 / 2 + 1.5, 0))
    m.place(j2, m.part(PartDef('CLN-L2C', 'Link 2 top cover', cover2.val(), 'al6061_blk', 'structure', 'sheet 3 mm', f'{c2b - c2a:.0f} x 120',
                               '', None, 'Closes link 2. Off for service.', {}, 'make')), Location(), (0, 70, 0), 'LINK2')
    for i in range(5):
        for zz in (-52, 52):
            m.place(j2, std.bhcs(5, 10, 'A2-70', 'Holds the link cover.'), std.orient((c2a + 10 + i * (c2b - c2a - 20) / 4, -drop + h2 / 2 + 3, zz), (0, -1, 0)),
                    (0, 90, 0), 'LINK2')

    # ═══════════════════════════════════════════════════════ J3 + carriage ═══
    yl2 = -drop
    y_bt = yl2 + oA                                      # the mast's top (the twin's outerAbove)
    y_fl = y_bt + 12                                     # the collar flange's top face
    y_rg = y_fl + 33                                     # the driven ring's flange top (its hub rises 4 more, inside the bearing)
    y_xb = y_rg + 24                                     # the bearing's top face: the lid's underside
    c_lo = yl2 + h2 / 2                                  # the carriage stands on link 2's top face, over its cut-away end
    cx0, cx1, cz = L2 - 140, L2 + 140, 140
    crg = (cq.Workplane('XY').box(cx1 - cx0, y_xb - c_lo, 2 * cz).translate(((cx0 + cx1) / 2, (c_lo + y_xb) / 2, 0))
           .cut(cq.Workplane('XY').box(cx1 - cx0 - 16, y_xb - c_lo, 2 * cz - 16).translate(((cx0 + cx1) / 2, (c_lo + y_xb) / 2 + 8, 0)))
           .cut(cq.Workplane('XZ', origin=(L2, c_lo + 9, 0)).circle(126).extrude(10)))     # the mast and its collar turn in it
    m.place(j2, m.part(PartDef('CLN-CRG', 'Mast carriage housing', crg.val(), 'a356_dark', 'structure', 'casting, machined',
                               f'{cx1 - cx0:.0f} x {2 * cz:.0f} x {y_xb - c_lo:.0f}', 'A356-T6', None,
                               'Carries the J3 bearing, its drive and the swivel at the tip of link 2. The mast hangs through its floor.',
                               {}, 'make')), Location(), (0, 90, 0), 'J3')
    # J3's range: the twin's cycle turns the mast from -177 to +285 degrees relative to link 2 (cleanJointsAt, measured
    # over CLEAN_CHAIN by cad.test.ts), 462 degrees in one cycle. A hose loop cannot cross that, so the vacuum crosses J3
    # in a swivel and the signals in a slip ring on the mast axis; the limits hold the twin's whole cycle.
    j3 = j2.child('CA_J3', loc(L2, yl2, 0), sub='J3',
                  joint={'name': 'CA_J3', 'axis': [0, 1, 0], 'limits': [-3.25, 5.10], 'kind': 'revolute',
                         'stowed': -(home['yaw'] - home['t1'] - home['t2'])})
    m.place(j2, std.cross_roller(170, 250, 24, 'Carries the mast and lets it turn. It takes the mast moment in one bearing.'),
            loc(L2, y_xb - 12, 0), (0, 160, 0), 'J3')
    collar = (cq.Workplane('XZ', origin=(0, oA, 0)).rect(s0 + 16, s0 + 16).extrude(30).edges('|Y').fillet(8)
              .cut(cq.Workplane('XZ', origin=(0, oA + 1, 0)).rect(s0, s0).extrude(32).edges('|Y').fillet(6))
              .union(cq.Workplane('XZ', origin=(0, oA + 12, 0)).circle(100).circle(25).extrude(12)))
    m.place(j3, m.part(PartDef('CLN-MCL', 'Mast top collar', collar.val(), 'al6061', 'structure', 'machined', 'OD 200, socket 176 sq',
                               '6061-T6', None, 'Grips the mast top in its socket and carries the driven ring and the bearing inner ring.',
                               {}, 'make')), Location(), (0, 220, 0), 'J3')
    d120, d24 = 120 * 5 / math.pi, 24 * 5 / math.pi
    y_pc = oA + 12 + 18.5                                # the pulleys' centre (hub 6 past each flange)
    m.place(j3, std.pulley(120, 5, 25, 50), loc(0, y_pc, 0), (0, 260, 0), 'J3')
    xd_ = zd_ = 147 / math.sqrt(2)                       # the drive pulley, 147 mm off the axis: its hub clear of the bearing ring
    m.place(j2, std.pulley(24, 5, 25, 14), loc(L2 + xd_, yl2 + y_pc, zd_), (0, 260, 120), 'J3')
    m.place(j2, std.belt(5, 25, math.hypot(xd_, zd_), d120, d24, 'Turns the mast from the servo gearmotor, 5:1.'),
            loc(L2, yl2 + y_pc, 0, ry=-math.degrees(math.atan2(zd_, xd_))), (0, 280, 60), 'J3')
    gm = (cq.Workplane('XZ', origin=(0, 0, 0)).circle(40).extrude(-90)
          .union(cq.Workplane('XZ', origin=(0, 90, 0)).rect(80, 80).extrude(-140).edges('|Y').fillet(6))
          .union(cq.Workplane('XZ').circle(7).extrude(y_xb + 8 - (yl2 + oA + 12))))      # its output shaft, down through the pulley
    gm_pd = m.part(PartDef('CLN-SGM', 'Servo gearmotor, 400 W, 20:1 planetary', gm.val(), 'a356_dark', 'drive', 'catalogue part',
                           '80 flange', '', None, 'Drives J3 through the belt. Its brake holds the mast angle when power is off.',
                           {'power': '400 W', 'gearhead': '20:1 planetary', 'brake': '24 V, spring-applied'}, 'buy',
                           mass_override=4.2))
    m.place(j2, gm_pd, loc(L2 + xd_, y_xb + 8, zd_), (0, 320, 140), 'J3')
    lid = (cq.Workplane('XY').box(cx1 - cx0, 8, 2 * cz).translate(((cx0 + cx1) / 2, y_xb + 4, 0))
           .cut(cq.Workplane('XZ', origin=(L2, y_xb + 9, 0)).circle(108).extrude(10))
           .cut(cq.Workplane('XZ', origin=(L2 + xd_, y_xb + 9, zd_)).circle(7.5).extrude(10)))
    m.place(j2, m.part(PartDef('CLN-CLD', 'Mast carriage lid', lid.val(), 'al6061_blk', 'structure', 'machined plate 8 mm',
                               f'{cx1 - cx0:.0f} x {2 * cz:.0f}', '', None, 'Closes the carriage and clamps the bearing outer ring.', {}, 'make')),
            Location(), (0, 160, 0), 'J3')
    for xx in (cx0 + 4, (cx0 + cx1) / 2, cx1 - 4):
        for zz in (-cz + 4, cz - 4):
            m.place(j2, std.bhcs(5, 12, 'A2-70', 'Holds the carriage lid.'), std.orient((xx, y_xb + 8, zz), (0, -1, 0)), (0, 180, 0), 'J3')
    for k, p in enumerate(std.circle_points(12, 117, 'y', offset=y_xb + 8, start=15)):
        if k == 1:
            continue                                     # under the servo gearmotor
        m.place(j2, std.shcs(6, 25, '12.9', 'Clamps the slewing bearing outer ring under the lid.'),
                std.orient((L2 + p[0], p[1], p[2]), (0, -1, 0)), (0, 200, 0), 'J3')
    # the vacuum swivel with the slip ring: its rotor stem goes down the axis into the collar; its body stands on the lid
    swv = (cq.Workplane('XZ', origin=(0, y_xb + 8 + 120, 0)).circle(60).extrude(120)
           .union(cq.Workplane('YZ', origin=(-60, y_xb + 8 + 60, 0)).circle(27).extrude(-70))
           .union(cq.Workplane('XZ', origin=(0, y_xb + 8, 0)).circle(25).extrude(y_xb + 8 - (yl2 + oA + 12))))
    m.place(j2, m.part(PartDef('CLN-SWV', 'Rotary union with slip ring, DN 50 vacuum + 12 circuits', swv.val(), 'steel_paint', 'fluid',
                               'catalogue part', 'DN 50, 12 x 2 A', 'IP65', None,
                               'Passes the vacuum and the signals across J3, which turns 462 degrees in a cycle. Its rotor turns '
                               'with the mast; the mast is the vacuum duct down to the wrist.',
                               {'vacuum': 'DN 50, -30 kPa', 'circuits': '12 x 2 A, EtherCAT pair'}, 'buy', mass_override=6.5)),
            loc(L2, 0, 0), (0, 400, 0), 'J3')

    # ═══════════════════════════════════════════════════════════════ MAST ═══
    outer = cq.Workplane('XY').add(_sq_tube(s0, 4, oA + oB)).translate((0, oA, 0))
    outer = outer.cut(cq.Workplane('XY').box(12, oA + oB + 2, 24).translate((s0 / 2 - 2, oA - (oA + oB) / 2, 0)))   # the rack's slot
    m.place(j3, m.part(PartDef('CLN-MS1', 'Mast stage 1 (outer), 160 x 160 x 4', outer.val(), 'al_extr', 'structure',
                               'EN 755-9 extrusion', f'{oA + oB:.0f} long', '6063-T6', None,
                               'Turns with J3 and guides the middle stage.', {}, 'make')),
            Location(), (0, 0, 0), 'MAST')
    strip = cq.Workplane('XY').box(6, oB * 0.7, 30).translate((s0 / 2 + 3, -oB * 0.45, 0))
    m.place(j3, m.part(PartDef('CLN-MSL', 'Status light strip, mast', strip.val(), 'led', 'electrical', 'LED strip in PC diffuser',
                               f'{oB * 0.7:.0f} long', '', None, 'Faces where the wand points. It shows the arm state.', {}, 'buy')),
            Location(), (60, 0, 0), 'STATUS')
    mast2 = j3.child('CA_Mast2', Location(), sub='MAST',
                     joint={'name': 'CA_Mast2', 'axis': [0, -1, 0], 'limits': [0, (stage - overlap) / 1000], 'kind': 'prismatic', 'stowed': 0})
    mid = cq.Workplane('XY').add(_sq_tube(s1, 3.5, stage)).translate((0, -oB + stage, 0))
    m.place(mast2, m.part(PartDef('CLN-MS2', 'Mast stage 2 (middle), 125 x 125 x 3.5', mid.val(), 'al_extr', 'structure',
                                  'EN 755-9 extrusion', f'{stage:.0f} long', '6063-T6', None, 'Carries the rack and the doubling pulley.',
                                  {}, 'make')), Location(), (0, 0, 0), 'MAST')
    rack = cq.Workplane('XY').box(20, stage - 60, 20).translate((s1 / 2 + 10, -oB + stage / 2, 0))
    rack = rack.cut(cq.Workplane('XY').box(8, stage - 60, 22).translate((s1 / 2 + 20, -oB + stage / 2, 0)))
    m.place(mast2, m.part(PartDef('CLN-RCK', 'Gear rack module 2, 20 x 20', rack.val(), 'steel', 'drive', 'DIN 867 tooth form',
                                  f'{stage - 60:.0f} long', 'C45, induction hardened', None,
                                  'The pinion drives the middle stage along it.', {'module': '2', 'quality': 'DIN 7'}, 'buy')),
            Location(), (80, 0, 0), 'MAST')
    for i in range(10):
        m.place(mast2, std.shcs(5, 16, '12.9', 'Holds the rack to the middle stage, from inside it.'),
                std.orient((s1 / 2 - 3.5, -oB + 50 + i * (stage - 160) / 9, 0), (1, 0, 0)), (110, 0, 0), 'MAST')
    x_pin = s1 / 2 + 20 + 14                             # on the rack's teeth, outside the outer stage
    pin = cq.Workplane('XY').circle(14).extrude(15, both=True)
    m.place(j3, m.part(PartDef('CLN-PIN', 'Pinion module 2, 14 teeth', pin.val(), 'steel', 'drive', 'DIN 867 tooth form', '14 T, m 2',
                               '18CrNiMo7-6, case hardened', None, 'Drives the rack.', {}, 'buy')),
            loc(x_pin, -oB + 70, 0), (150, 0, 0), 'MAST')
    m.place(j3, gm_pd, loc(x_pin, -oB + 70, s0 / 2, rx=90), (220, 0, 0), 'MAST')
    # wear pads fill each gap between stages: on the outer stage's foot inside it, and on the middle stage's top inside it
    for node, a_out, t_out, a_in, y_pad, pid in ((j3, s0, 4, s1, -oB + 20, 'CLN-PAD1'), (mast2, s1, 3.5, s2, -oB + stage - 30, 'CLN-PAD2')):
        gap = (a_out - 2 * t_out - a_in) / 2
        pad = cq.Workplane('XY').box(gap, 30, 50).translate((a_in / 2 + gap / 2, 0, 0))
        pd_ = m.part(PartDef(pid, f'Wear pad, acetal, {gap:.1f} x 30 x 50', pad.val(), 'pom', 'drive', 'machined', f'{gap:.1f} x 30 x 50',
                             'POM-C', None, 'Guides one stage inside the next with low friction and no play.', {}, 'make'))
        for k in range(4):
            if node is j3 and k == 0:
                continue                                 # the rack's slot is on the outer stage's +X face
            m.place(node, pd_, loc(0, y_pad, 0, ry=90 * k), (0, -60 if node is j3 else 40, 0), 'MAST')
    mast3 = mast2.child('CA_Mast3', Location(), sub='MAST',
                        joint={'name': 'CA_Mast3', 'axis': [0, -1, 0], 'limits': [0, (stage - overlap) / 1000], 'kind': 'prismatic', 'stowed': 0})
    inner = cq.Workplane('XY').add(_sq_tube(s2, 3, stage)).translate((0, -oB + stage, 0))
    m.place(mast3, m.part(PartDef('CLN-MS3', 'Mast stage 3 (inner), 95 x 95 x 3', inner.val(), 'al_extr', 'structure',
                                  'EN 755-9 extrusion', f'{stage:.0f} long', '6063-T6', None, 'Carries the wrist at its foot.', {}, 'make')),
            Location(), (0, 0, 0), 'MAST')
    # the doubling: a sheave on top of the middle stage's wall each side; a flat belt runs up the outer gap from stage 1's
    # foot, over the sheave, and down the inner gap to stage 3's foot, so stage 3 moves twice as far as stage 2
    g_out = (s0 - 8 - s1) / 2
    g_in = (s1 - 7 - s2) / 2
    z_out, z_in = s1 / 2 + g_out / 2, s2 / 2 + g_in / 2
    d_sh = z_out - z_in - 2                              # the belt (2 thick) runs on each side of it
    top2 = -oB + stage
    sheave = cq.Workplane('YZ').circle(d_sh / 2).extrude(13, both=True)
    sh_pd = m.part(PartDef('CLN-DSH', f'Doubling sheave, {d_sh:.0f} mm, acetal', sheave.val(), 'pom', 'drive', 'machined',
                           f'D {d_sh:.0f} x 26', 'POM-C', None, 'Turns the doubling belt over the middle stage\'s top.', {}, 'make'))
    for sz in (-1, 1):
        m.place(mast2, sh_pd, loc(45, top2 + d_sh / 2, sz * (z_out + z_in) / 2), (0, 60, sz * 40), 'MAST')
        for (zc, y0, y1, nm) in ((z_out, -oB + 30, top2 + d_sh / 2, 'outer'), (z_in, -oB + 30, top2 + d_sh / 2, 'inner')):
            strap = cq.Workplane('XY').box(25, y1 - y0, 2).translate((0, (y0 + y1) / 2, 0))
            m.place(mast2, m.part(PartDef(f'CLN-DBL{nm[0].upper()}', f'Doubling belt, {nm} run, 25 x 2', strap.val(), 'rubber', 'drive',
                                          'flat belt', '25 wide', 'steel cords', None,
                                          'Anchored to stage 1 and stage 3 over the sheave on stage 2: stage 3 moves twice as far.',
                                          {}, 'buy')), loc(45, 0, sz * zc), (0, 0, sz * 60), 'MAST')

    # ═══════════════════════════════════════════════════════════════ WRIST ═══
    yp = -oB - pbf                                 # the pitch pivot (MAST3 frame)
    s20 = SIZES[20]
    hub_w, hub_od = 110.0, 2 * A['wrist']['r'] * M
    plate_z = hub_w / 2 + 14
    fork = (cq.Workplane('XY').box(s2 + 20, 30, s2 + 20).translate((0, -oB - 15, 0))
            .union(cq.Workplane('XY').box(130, pbf + 70, 14).translate((0, yp + 15, plate_z + 7)))
            .union(cq.Workplane('XY').box(130, pbf + 70, 14).translate((0, yp + 15, -plate_z - 7)))
            .union(cq.Workplane('XY').box(130, 24, 2 * plate_z + 28).translate((0, -oB - 30 + 12, 0)))
            .union(cq.Workplane('YZ', origin=(-(s2 + 20) / 2 + 1, -oB - 23, 0)).circle(22).extrude(-(95 - (s2 + 20) / 2 + 1)))
            .cut(cq.Workplane('XY').circle(s20.od / 2).extrude(40).translate((0, yp, -plate_z - 20)))
            .cut(cq.Workplane('XY').circle(36).extrude(40).translate((0, yp, plate_z - 10))))     # the stub bearing's seat (61910)
    m.place(mast3, m.part(PartDef('CLN-FRK', 'Wrist fork', fork.val(), 'al6061', 'structure', 'machined from billet',
                                  f'{2 * plate_z + 28:.0f} wide', '6061-T6', None,
                                  'Hangs from the inner stage foot. It holds the J4 actuator on one side and a support bearing on the other.',
                                  {}, 'make')), Location(), (0, -40, 0), 'WRIST')
    for p in ((-46, -25), (46, -25), (-46, 25), (46, 25)):          # up into the inner stage's walls, clear of the hub
        m.place(mast3, std.shcs(6, 45, '12.9', 'Holds the wrist fork to the inner stage foot.'),
                std.orient((p[0], -oB - 30, p[1]), (0, 1, 0)), (0, -80, 0), 'WRIST')
    pitch = mast3.child('CA_Pitch', loc(0, yp, 0), sub='WRIST',
                        joint={'name': 'CA_Pitch', 'axis': [0, 0, 1], 'limits': A['limits']['pitch'], 'kind': 'revolute',
                               'stowed': home['pitch']})
    # J4: module +Y -> world +Z, so its output faces the hub; an adapter flange (12 mm) between them
    t_ad = 12.0
    Tm4 = loc(0, 0, -hub_w / 2 - t_ad, rx=90)
    build_actuator(m, mast3, pitch, 20, loc(0, yp, 0), Tm4, 'CLN-J4', 'WRIST', gland_m=16)
    r_fl = out_flange_points(20)[0][0]
    # the vacuum: from the wand into the hub's bore, round a right angle and out along the J4 axis through the hollow
    # stub on the free side, into a swivel on the fork (a hose loop to the wand was swept through by the wand itself)
    stub_ext = 30.0                                      # the stub's length past the fork plate, into the swivel
    hubp = (cq.Workplane('XY').circle(hub_od / 2).extrude(hub_w).translate((0, 0, -hub_w / 2))
            .cut(cq.Workplane('YZ', origin=(-22, 0, 0)).circle(wr2 + 1.5).extrude(hub_od))          # the wand bore, blind
            .cut(cq.Workplane('YZ', origin=(hub_od / 2 - 4, 0, 0)).circle(wr).extrude(10))       # tube 1's socket
            .cut(cq.Workplane('XY', origin=(0, 0, -hub_w / 2 - 1)).circle(r_fl + 7).circle(r_fl - 7).extrude(8))   # adapter screw heads
            .union(cq.Workplane('XY').circle(25).circle(20).extrude(plate_z + 14 - hub_w / 2 + stub_ext).translate((0, 0, hub_w / 2)))
            .cut(cq.Workplane('XY').circle(20).extrude(hub_w / 2 + 1)))                           # the passage to the stub
    m.place(pitch, m.part(PartDef('CLN-HUB', 'Wrist hub', hubp.val(), 'al6061', 'structure', 'machined', f'OD {hub_od:.0f} x {hub_w:.0f}',
                                  '7075-T6', None, 'Turns on J4 and carries the wand. The air leaves through its hollow stub.', {}, 'make')),
            Location(), (0, 0, 40), 'WRIST')
    m.place(mast3, std.ball_bearing('61910', 'Supports the hub\'s hollow stub on the free side of the fork.'),
            loc(0, yp, plate_z + 7, rx=90), (0, 0, 90), 'WRIST')
    s_cl = 1.75
    m.place(pitch, std.circlip(50, False), std.orient((0, 0, plate_z + 13 + s_cl), (0, 0, 1)), (0, 0, 110), 'WRIST')
    # the wrist swivel: a flanged housing on the fork plate's outer face round the stub, a radial port toward -X
    z_f = plate_z + 14                                   # the fork plate's outer face
    zu = z_f + 24                                        # the port's axis
    swv = (cq.Workplane('XY').circle(52).extrude(8).translate((0, yp, z_f))
           .union(cq.Workplane('XY').circle(40).extrude(40).translate((0, yp, z_f)))
           .union(cq.Workplane('YZ', origin=(-62, yp, zu)).circle(18.6).extrude(30))      # the port spigot: the hose's bore
           .cut(cq.Workplane('XY').circle(25).extrude(stub_ext + 2).translate((0, yp, z_f - 1)))
           .cut(cq.Workplane('YZ', origin=(-63, yp, zu)).circle(14).extrude(50))
           .cut(cq.Workplane('XY').pushPoints([(46 * math.cos(math.radians(a)), yp + 46 * math.sin(math.radians(a)))
                                               for a in (45, 135, 225, 315)]).circle(2.75).extrude(9).translate((0, 0, z_f - 0.5))))
    m.place(mast3, m.part(PartDef('CLN-WSW', 'Wrist vacuum swivel, 50 mm', swv.val(), 'al6061', 'fluid', 'machined', 'OD 104 x 40',
                                  'lip-sealed', None, 'Lets the hub\'s stub turn while the vacuum flows through it to the hose.',
                                  {}, 'make')), Location(), (0, 0, 140), 'VAC')
    for a in (45, 135, 225, 315):
        m.place(mast3, std.shcs(5, 16, 'A2-70', 'Holds the wrist swivel to the fork plate.'),
                std.orient((46 * math.cos(math.radians(a)), yp + 46 * math.sin(math.radians(a)), z_f + 8), (0, 0, -1)),
                (0, 0, 170), 'VAC')
    adp = (cq.Workplane('XY', origin=(0, 0, -hub_w / 2 - t_ad)).circle(60).circle(10).extrude(t_ad))
    m.place(pitch, m.part(PartDef('CLN-HAF', 'J4 hub adapter flange', adp.val(), 'al6061', 'structure', 'machined', f'OD 120 x {t_ad:g}',
                                  '7075-T6', None, 'Joins the hub to the J4 output flange: its screws are reachable from outside.',
                                  {}, 'make')), Location(), (0, 0, -60), 'WRIST')
    for p in out_flange_points(20):          # adapter to the output flange, heads in the hub's face groove
        m.place(pitch, std.shcs(6, 20, '12.9', 'Holds the adapter flange to the J4 output flange.'),
                std.orient((p[0], -p[2], -hub_w / 2), (0, 0, -1)), (0, 0, -90), 'WRIST')
    for p in std.circle_points(6, 50, 'y', start=30):  # adapter to the hub, from outside
        m.place(pitch, std.bhcs(6, 25, '10.9', 'Holds the hub to its adapter flange.'),
                std.orient((p[0], -p[2], -hub_w / 2 - t_ad), (0, 0, 1)), (0, 0, -110), 'WRIST')

    # ═══════════════════════════════════════════════════════════════ WAND ═══
    # 3 sliding tubes, a third of the reach each: retracted, all of them lie inside the base tube, in front of the hub.
    # (The twin draws 2 sliding tubes of half the reach. Each is then 520 mm long, longer than the 400 mm base tube, so
    # retracted they stood 120 mm behind the pivot: when the twin hangs the wand straight down, they met the wrist fork
    # and the mast's foot, 100 mm above the pivot.) The innermost tube is the twin's 44 mm tube; the 2 between step down
    # with 1.5 mm walls and a 2.2 mm lip seal in each gap.
    k_cl = 50.0                                          # tubes 1 to 3 stop this short of tube 4's tip, clear of the knuckle
    base_tube = (cq.Workplane('YZ', origin=(hub_od / 2 - 4, 0, 0)).circle(wr).circle(wr - 2.5).extrude(wb - k_cl - hub_od / 2 + 4))
    m.place(pitch, m.part(PartDef('CLN-WT1', 'Wand tube 1 (base), 68 x 2.5', base_tube.val(), 'carbon', 'structure',
                                  'filament-wound tube', f'{wb - hub_od / 2:.0f} long', '', None,
                                  'Carries the vacuum flow and guides tube 2. Bonded into the hub.', {}, 'make')),
            Location(), (120, 0, 0), 'WAND')
    trav = wext / WAND_SLIDES                            # each sliding tube's travel
    stage_len = trav + 60                                # 60 mm stays inside the tube outside it at full reach
    lin = (cq.Workplane('YZ', origin=(hub_od / 2 + 10, 0, 0)).circle(16).extrude(wb - k_cl - hub_od / 2 - 40))
    m.place(pitch, m.part(PartDef('CLN-WLA', f'Wand linear drive, ball screw, stroke {trav:.0f}', lin.translate((0, wr + 16, 0)).val(),
                                  'al6061_blk', 'drive', 'catalogue part', f'D 32, stroke {trav:.0f}', 'IP65', None,
                                  'Pushes tube 2 out and pulls it back. Cables take tubes 3 and 4 with it.',
                                  {'force': '200 N', 'speed': '250 mm/s'}, 'buy')),
            Location(), (120, 70, 0), 'WAND')
    r_in_prev = wr - 2.5                                 # the bore each next tube and its seal fit in
    parent, tip = pitch, pitch
    for k, (r_o, wall) in enumerate(((WAND_R[0], 1.5), (WAND_R[1], 1.5), (wr3, 2.0)), start=2):
        node = parent.child(f'CA_Wand{k}', Location(), sub='WAND',
                            joint={'name': f'CA_Wand{k}', 'axis': [1, 0, 0], 'limits': [0, trav / 1000], 'kind': 'prismatic',
                                   'stowed': home['ext'] / WAND_SLIDES})
        last = k == WAND_SLIDES + 1
        x1 = wb if last else wb - k_cl                   # the innermost tube runs on to the knuckle
        L_t = stage_len + (k_cl if last else 0.0)
        tube = cq.Workplane('YZ', origin=(x1 - L_t, 0, 0)).circle(r_o).circle(r_o - wall).extrude(L_t)
        m.place(node, m.part(PartDef(f'CLN-WT{k}', f'Wand tube {k}, {2 * r_o:g} x {wall:g}', tube.val(), 'carbon', 'structure',
                                     'filament-wound tube', f'{L_t:.0f} long', '', None,
                                     ('Slides in tube 3 and carries the nozzle.' if last else
                                      f'Slides in tube {k - 1} on a lip seal and carries a pulley for the next tube\'s cable.'),
                                     {}, 'make')), Location(), (140 + 60 * k, 0, 0), 'WAND')
        m.place(parent, std.lip_seal(2 * r_o, 2 * r_in_prev, 6, f'Seals tube {k} in tube {k - 1}, so the vacuum does not leak there.'),
                loc(wb - k_cl - 6, 0, 0, rz=-90), (120 + 60 * k, 0, 0), 'WAND')
        r_in_prev = r_o - wall
        parent = tip = node

    # ═══════════════════════════════════════════════════════════════ NOZZLE ═══
    noz = tip.child('CA_Nozzle', loc(wb, 0, 0), sub='NOZZLE',
                      joint={'name': 'CA_Nozzle', 'axis': [0, 0, 1], 'limits': A['limits']['nozzle'], 'kind': 'revolute',
                             'stowed': home['nozzle']})
    knuckle = (cq.Workplane('XY').circle(36).extrude(60).translate((0, 0, -30))
               .union(cq.Workplane('YZ', origin=(-30, 0, 0)).circle(wr3 + 4).extrude(30))
               .cut(cq.Workplane('YZ', origin=(-37, 0, 0)).circle(wr3).extrude(37)))           # tube 4's socket
    m.place(tip, m.part(PartDef('CLN-KNK', 'Nozzle knuckle housing', knuckle.val(), 'a356_dark', 'structure', 'casting, machined',
                                  'OD 72 x 60', 'A356-T6', None, 'Carries the nozzle pivot and its worm drive on the wand tip.', {}, 'make')),
            loc(wb, 0, 0), (300, 0, 0), 'NOZZLE')
    nm = cq.Workplane('XY').circle(18).extrude(56).translate((0, 0, 30))
    m.place(tip, m.part(PartDef('CLN-NGM', 'Nozzle gearmotor, 36 mm, with worm stage', nm.val(), 'steel_paint', 'drive', 'catalogue part',
                                  'D 36 x 56', '', None, 'Pitches the head. The worm locks it, so it holds its angle with power off.',
                                  {'ratio': '50:1 worm', 'torque': '6 N m'}, 'buy')), loc(wb, 0, 0), (300, 0, 80), 'NOZZLE')
    hx0, hx1 = 46.0, N['len'] - 12                       # the head starts clear of the knuckle and its light ring
    head = (cq.Workplane('XY').polyline([(hx0, -N['h'] * 0.32), (hx1, -N['h'] / 2), (hx1, N['h'] / 2),
                                         (hx0, N['h'] * 0.32)]).close().extrude(N['w'] / 2, both=True))
    head = head.cut(cq.Workplane('XY').polyline([(hx0 - 4, -N['h'] * 0.24), (hx1 + 2, -N['h'] / 2 + 3), (hx1 + 2, N['h'] / 2 - 3),
                                                 (hx0 - 4, N['h'] * 0.24)]).close().extrude(N['w'] / 2 - 3, both=True))
    head = head.union(cq.Workplane('XY').box(hx0 - 36, 30, 40).translate(((36 + hx0) / 2, 0, 0)))  # its neck on the knuckle pin
    m.place(noz, m.part(PartDef('CLN-NHD', 'Nozzle head, vacuum duct', head.val(), 'pa66', 'tool', 'moulded', f'{N["len"]:.0f} x {N["w"]:.0f} x {N["h"]:.0f}',
                                '', None, 'Spreads the vacuum across a 150 mm mouth.', {}, 'make')), Location(), (60, 0, 0), 'NOZZLE')
    lip = cq.Workplane('XY').box(12, N['h'] * 1.08, N['w'] * 1.02).translate((N['len'] - 6, 0, 0))
    m.place(noz, m.part(PartDef('CLN-LIP', 'Brush lip, nylon 0.2 mm', lip.val(), 'rubber', 'tool', 'strip brush', f'{N["w"]:.0f} long',
                                '', None, 'Lifts dust and crumbs from the fabric into the flow.', {}, 'buy')), Location(), (100, 0, 0), 'NOZZLE')
    xk = N['len'] - 26
    yk = N['h'] * 0.32 + (N['h'] / 2 - N['h'] * 0.32) * (xk + 7 - hx0) / (hx1 - hx0)  # the head's top at the knife's far end
    knife = cq.Workplane('XY').box(14, 8, N['w'] * 0.9).translate((xk, yk + 4, 0))
    m.place(noz, m.part(PartDef('CLN-AKN', 'Air knife, slot 0.05 mm', knife.val(), 'al6061', 'tool', 'catalogue part', f'{N["w"] * 0.9:.0f} long',
                                '', None, 'Blows a thin sheet of air into seams. The dust goes into the vacuum flow.',
                                {'air': '6 bar, about 150 l/min'}, 'buy')), Location(), (90, 60, 0), 'NOZZLE')
    nring = cq.Workplane('XY').add(cq.Solid.makeTorus(wr3 + 4, 4, pnt=Vector(-43, 0, 0), dir=Vector(1, 0, 0)))
    m.place(tip, m.part(PartDef('CLN-NRG', 'Light ring, wand tip', nring.val(), 'led', 'electrical', 'LED ring in PC diffuser', 'OD 60',
                                  '', None, 'Lights the cabin for the camera and shows that the nozzle works.', {}, 'buy')),
            loc(wb, 0, 0), (40, 0, 0), 'STATUS')
    for zz in (-50, 0, 50):
        m.place(noz, std.shcs(3, 10, 'A2-70', 'Holds the air knife to the head.'), std.orient((xk, yk + 8, zz), (0, -1, 0)),
                (90, 80, 0), 'NOZZLE')

    # ═════════════════════════════════════════════════════════════ VAC hose ═══
    # The mast is the vacuum duct: the swivel feeds its top, a port at the inner stage's foot feeds the wrist loop.
    hose_r = 27.0
    r2_ = hose_r * 0.8
    hose2 = std.swept('CLN-HOS2', 'Vacuum hose, PU 50 mm: mast to wrist swivel',
                      [(-95, -oB - 23, 0), (-112, -oB - 23, 0), (-145, -oB - 40, 25), (-140, yp + 20, zu - 10), (-100, yp, zu),
                       (-50, yp, zu)],                   # it ends 12 mm over the swivel's port spigot
                      r2_, 'hose', 'fluid', r2_ - 3, 'Joins the mast duct to the wrist swivel, beside the fork, clear of the wand.',
                      {}, 'EN ISO 3994', 'ID 40')
    m.place(mast3, hose2, Location(), (-120, -60, 0), 'VAC')
    return m
