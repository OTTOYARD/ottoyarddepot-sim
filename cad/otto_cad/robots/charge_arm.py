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
from cadquery import Location, Vector

from .. import std
from ..actuator import SIZES, build_actuator, module_length, out_flange_points, rear_od, front_ring_points
from ..core import Model, Node, PartDef, loc

G = 9.81
BAL_A = 320.0     # balancer anchor below the J2 axis, mm
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
                  socket_r: float = 0, socket_bore: float = 0, socket_len: float = 0) -> cq.Shape:
    """A cast link from a joint at y = 0 (a CHEEK at +x, bolted to that joint's output flange) to its far
    end at y = L: either a BOSS at x = 0 that clamps the next X-axis actuator's front drum, or a SOCKET
    along +Y that holds the next Y-axis actuator. Hollow, `wall` thick."""
    k0 = cheek_r * 0.9
    sec = [  # (y, centre x, width x, depth z) -- the knuckle sweeps from the cheek into the tube
        (k0 * 0.55, cheek_x - cheek_t * 0.2, cheek_t * 1.6, cheek_r * 1.5),
        (k0 * 1.05, cheek_x * 0.55, r_bot * 1.25, r_bot * 1.75),
        (k0 * 1.6, 0.0, r_bot * 2.0, r_bot * 2.0),
    ]
    y_tube1 = (L - socket_len - 60) if socket_r else (L - boss_od * 0.62)
    y_tube0 = sec[-1][0]
    for i in range(1, 6):                       # straight taper: sections every sixth of the tube
        t = i / 6
        rr = r_bot + (r_top - r_bot) * t
        sec.append((y_tube0 + (y_tube1 - y_tube0) * t, 0.0, rr * 2.0, rr * 2.0))
    if socket_r:
        sec += [(y_tube1, 0.0, r_top * 2.0, r_top * 2.0), (L - socket_len, 0.0, socket_r * 2, socket_r * 2)]
    else:
        sec += [(y_tube1, 0.0, r_top * 2.0, r_top * 2.0), (L - boss_od * 0.32, 0.0, boss_w * 1.05, r_top * 1.7)]

    def solid(shrink: float) -> cq.Workplane:
        wires = [_ell_wire(cx, y, max(2.0, w / 2 - shrink), max(2.0, d / 2 - shrink)) for (y, cx, w, d) in sec]
        return cq.Workplane('XY').add(cq.Solid.makeLoft(wires, False))

    body = solid(0.0).cut(solid(wall))
    cheek = (cq.Workplane('YZ', origin=(cheek_x - cheek_t, 0, 0)).circle(cheek_r).extrude(cheek_t))
    cheek = cheek.union(cq.Workplane('YZ', origin=(cheek_x - cheek_t, 0, 0)).rect(cheek_r * 1.4, cheek_r * 2)
                        .extrude(cheek_t).translate((0, cheek_r * 0.7, 0)))
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


# ═════════════════════════════════════════════════════════════════════ build ═══


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
                     'The cable trunk joins the riser to the charger cabinet. The power and data cables run inside it.'],
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
                     'A compliance unit lets the connector float up to 6 mm and 3 degrees, so a small error cannot jam it.',
                     'Stereo cameras and a time-of-flight sensor find the inlet. A light ring helps at night.',
                     'A solenoid latch locks the connector in the inlet for the charge.'],
                specs={'connector': 'DC combo class (CCS), liquid-cooled', 'TCP': '369.6 mm from the tool flange'}, group='Tool')
    m.subsystem('DRESS', 'Cable dress pack', 'Carries the charge cable and the signal lines along the arm without strain.',
                how=['Clamps on each link hold the liquid-cooled cable.', 'A loop at each joint lets it turn.'],
                group='Cables')
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
    for sx, sz in ((1, 0), (-1, 0), (0, 1), (0, -1)):   # four base gussets
        g = (cq.Workplane('XY').polyline([(0, 0), (52, 0), (0, 150)]).close().extrude(5, both=True))
        if sx:
            g = g.rotate((0, 0, 0), (0, 1, 0), 0 if sx > 0 else 180)
        else:
            g = g.rotate((0, 0, 0), (0, 1, 0), -90 if sz > 0 else 90)
        g = g.rotate((0, 0, 0), (1, 0, 0), 0).translate((sx * riser_w / 2, tube_y0, sz * riser_w / 2))
        riser = riser.union(g)
    riser = riser.faces('<Y').workplane(centerOption='CenterOfBoundBox').pushPoints(
        [(x, z) for x in (-175, 175) for z in (-175, 175)]).hole(18)
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
    for x in (-175, 175):
        for z in (-175, 175):
            m.place(base, anc, loc(x, pad_top + bp_t, z), (0, 140, 0))
            m.place(base, std.washer(16), std.orient((x, pad_top + bp_t, z), (0, -1, 0)), (0, 160, 0))
            m.place(base, std.nut(16), loc(x, pad_top + bp_t + 3, z), (0, 180, 0))
    # mount plate + collar (the twin's plinth: plate 300 sq x 26 from y -81, collar 135/155 x 55)
    plate = (cq.Workplane('XY').box(300, 26, 300, centered=(True, False, True)).translate((0, plate_under, 0))
             .edges('|Y').fillet(12).cut(cq.Workplane('XZ', origin=(0, plate_under + 27, 0)).circle(86).extrude(28)))
    plate = plate.faces('>Y').workplane(centerOption='CenterOfBoundBox').pushPoints(pts).cboreHole(13.5, 20.5, 12.5)
    m.place(base, m.part(PartDef('CHG-MPL', 'Arm mount plate', plate.val(), 'steel_paint', 'structure', 'machined',
                                 '300 x 300 x 26', 'S355J2', None, 'Carries the J1 actuator and spreads its load into the riser.',
                                 {'flatness': '0.05 mm'}, 'make')), Location(), (0, 60, 0))
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
    th = plate_under - pad_top - 30
    trunk = (cq.Workplane('XY').box(tr_w, th, z1 - z0, centered=(True, False, False)).translate((0, pad_top + 10, z0))
             .cut(cq.Workplane('XY').box(tr_w - 6, th - 6, z1 - z0 + 2, centered=(True, False, False))
                  .translate((0, pad_top + 13, z0 - 1))))
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

    # ════════════════════════════════════════════════════════ J1 + TURRET ═══
    j1 = base.child('J1_BaseYaw', loc(0, 0, 0), sub='J1',
                    joint={'name': 'J1', 'axis': [0, 1, 0], 'limits': S['limits']['j1'], 'kind': 'revolute',
                           'stowed': S['stowed']['j1']})
    a1 = build_actuator(m, base, j1, 40, loc(0, 0, 0), loc(0, 26, 0), 'CHG-J1', 'J1')
    j1b = std.shcs(8, 30, '12.9', 'Holds the J1 actuator drum to the mount plate.')
    for p in std.circle_points(8, 96, 'y', offset=plate_under, start=11.25):
        m.place(base, j1b, std.orient(p, (0, 1, 0)), (0, -60, 0), 'J1')
    # turret casting: skirt (twin base housing r 193 -> 216, y 0..130), column to the J2 boss
    L2 = _pitch_layout(50)
    boss2_od = L2['od'] + 36
    rb = radii['base']
    tur = (cq.Workplane('XY').add(cq.Solid.makeCone(rb * 1.12, rb, 128, pnt=Vector(0, 2, 0), dir=Vector(0, 1, 0)))
           .union(cq.Workplane('XY').add(cq.Solid.makeCone(rb * 0.98, radii['shoulder'] * 0.92, H - 130 - boss2_od * 0.38,
                                                           pnt=Vector(0, 130, 0), dir=Vector(0, 1, 0)))))
    tur = tur.union(cq.Workplane('YZ', origin=(-L2['boss_w'] / 2, H, 0)).circle(boss2_od / 2).extrude(L2['boss_w']))
    tur = tur.union(cq.Workplane('XY').box(L2['boss_w'], boss2_od * 0.62, boss2_od * 0.8, centered=(True, False, True))
                    .translate((0, H - boss2_od * 0.62, 0)))
    tur = tur.cut(cq.Workplane('YZ', origin=(-L2['boss_w'], H, 0)).circle(L2['od'] / 2 + 0.5).extrude(L2['boss_w'] * 2))
    tur = tur.cut(cq.Workplane('XZ', origin=(0, -1, 0)).circle(rb * 0.95).extrude(-122))      # skirt cavity
    tur = tur.cut(cq.Workplane('XZ', origin=(0, 118, 0)).circle(rb * 0.78).extrude(-(H - 130 - boss2_od * 0.5)))
    tur = tur.faces('<Y').workplane(centerOption='CenterOfBoundBox').pushPoints(
        [(p[0], p[2]) for p in out_flange_points(40)]).hole(9, 18)
    m.place(j1, m.part(PartDef('CHG-TUR', 'Turret casting', tur.val(), 'a356', 'structure', 'casting, machined',
                               f'OD {rb * 2.24:.0f} x {H + boss2_od / 2:.0f}', 'A356-T6', None,
                               'Turns on J1 and carries the shoulder. Its boss clamps the J2 actuator.',
                               {'wall': '8 mm'}, 'make')), Location(), (0, 80, 0), 'J1')
    t1 = std.shcs(8, 35, '12.9', 'Holds the turret to the J1 output flange.')
    for p in out_flange_points(40):
        m.place(j1, t1, std.orient((p[0], 2 + 18 + 26 - 26 + 18, p[2]), (0, -1, 0)), (0, 260, 0), 'J1')
    for p in std.circle_points(2, out_flange_points(40)[0][0], 'y', offset=26, start=360 / 32):
        m.place(j1, std.dowel(8, 24), loc(p[0], 26, p[2]), (0, 240, 0), 'J1')
    # accent band and status ring on the skirt
    band = cq.Workplane('XY').add(cq.Solid.makeTorus(rb * 1.08, 4, pnt=Vector(0, 30, 0), dir=Vector(0, 1, 0)))
    m.place(j1, m.part(PartDef('CHG-BAND1', 'Turret accent band', band.val(), 'accent', 'structure', 'moulded', '',
                               '', None, 'OTTOYARD red band. It marks the moving part of the machine.', {}, 'make')),
            Location(), (0, 40, 0), 'J1')

    # ═══════════════════════════════════════════════ J2 + balancer + upper arm ═══
    j2 = j1.child('J2_Shoulder', loc(0, H, 0), sub='J2',
                  joint={'name': 'J2', 'axis': [1, 0, 0], 'limits': S['limits']['j2'], 'kind': 'revolute',
                         'stowed': S['stowed']['j2']})
    Tm2 = loc(L2['out_x'], 0, 0, rz=-90)      # module +Y -> world +X
    a2 = build_actuator(m, j1, j2, 50, loc(0, H, 0), Tm2, 'CHG-J2', 'J2', gland_m=25)
    clamp_s = std.shcs(10, 40, '12.9', 'Clamps the J2 actuator drum in the turret boss.')
    for p in front_ring_points(50, 10):
        pp = (L2['out_x'] - (-p[1]), H + p[0], p[2])
        # radial screws through the boss into the drum, from outside
        r = math.hypot(p[0], p[2])
        dirv = (0, -p[0] / r, -p[2] / r)
        pos = (0.0, H + p[0] / r * (boss2_od / 2), p[2] / r * (boss2_od / 2))
        m.place(j1, clamp_s, std.orient(pos, dirv), tuple(-c * 90 for c in dirv), 'J2')
    # status ring on the J2 boss faces (both sides): the twin draws two
    for sx in (-1, 1):
        ring = cq.Workplane('XY').add(cq.Solid.makeTorus(boss2_od / 2 * 0.94, 5,
                                                         pnt=Vector(sx * (L2['boss_w'] / 2 + 1), H, 0), dir=Vector(1, 0, 0)))
        m.place(j1, m.part(PartDef(f'CHG-J2-RING{"R" if sx > 0 else "L"}', 'Status light ring, J2', ring.val(), 'led',
                                   'electrical', 'LED strip in PC diffuser', f'OD {boss2_od * 0.94:.0f}', '', None,
                                   'Shows the arm state: teal ready, amber moving, green charging, red fault.', {}, 'buy')),
                Location(), (sx * 60, 0, 0), 'SAFETY')
    # gravity balancer, the inverted-pendulum kind: a compression spring cartridge between an anchor BAL_A
    # below the J2 axis (on the turret) and a crank pin BAL_R above it (on the upper arm). Leaning the arm
    # either way shortens it, and its push makes a restoring torque F * a * r * sin(q2) / d: the shape of
    # the gravity torque itself. On the -X side, outside the J2 motor bell and the turret column.
    bal_x = -235.0
    p_low = (bal_x, H - BAL_A, 0.0)               # J1 frame
    p_up = (bal_x, BAL_R, 0.0)                    # J2 frame (zero pose: straight above the axis)
    Lb = BAL_A + BAL_R
    eye = (cq.Workplane('XY').box(40, 56, 64).edges('|X').fillet(16)
           .cut(cq.Workplane('YZ', origin=(-25, 0, 0)).circle(12.5).extrude(50)))
    cyl = (cq.Workplane('XZ', origin=(0, 30, 0)).circle(45).circle(39).extrude(-(Lb * 0.56))
           .union(cq.Workplane('XZ', origin=(0, 30, 0)).circle(45).extrude(-8))
           .union(cq.Workplane('XZ', origin=(0, 30 + Lb * 0.56, 0)).circle(45).circle(21).extrude(-8))
           .union(eye))
    rod = (cq.Workplane('XZ', origin=(0, -30, 0)).circle(20).extrude(Lb * 0.5)
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
        clev = (cq.Workplane('XY').box(84, 70, 64).edges('|X').fillet(10)
                .cut(cq.Workplane('XY').box(44, 80, 70).translate((0, -24 if up else 24, 0)))
                .cut(cq.Workplane('YZ', origin=(-50, 0, 0)).circle(12.6).extrude(100)))
        arm = cq.Workplane('XY').box(reach, 50, 56).translate((reach / 2 + 30, 0, 0)).edges('|Y').fillet(8)
        return clev.union(arm)
    m.place(j1, m.part(PartDef('CHG-BAL-ANC', 'Balancer anchor bracket, turret', bracket(150, False).val(), 'steel_paint',
                               'structure', 'machined weldment', '84 x 70 x 230', 'S355J2', None,
                               'Anchors the balancer below the J2 axis.', {}, 'make')),
            loc(*p_low), (-100, 0, 0), 'J2')
    m.place(j2, m.part(PartDef('CHG-BAL-CRK', 'Balancer crank bracket, upper arm', bracket(130, True).val(), 'steel_paint',
                               'structure', 'machined weldment', '84 x 70 x 210', 'S355J2', None,
                               'Carries the crank pin above the J2 axis.', {}, 'make')),
            loc(*p_up), (-100, 0, 0), 'J2')
    for node, p, up in ((j1, p_low, False), (j2, p_up, True)):
        for dz in (-16, 16):
            for dy in (-14, 14):
                m.place(node, std.shcs(10, 35, '12.9', 'Holds the balancer bracket arm.'),
                        std.orient((p[0] + 165, p[1] + dy, p[2] + dz), (1, 0, 0)), (-110, 0, 0), 'J2')
    upper = _link_casting(LU, radii['upper'] * 1.18, radii['elbow'] * 0.86,
                          cheek_x=L2['out_x'] + 20, cheek_r=a2['of_od'] / 2 + 14, cheek_t=20,
                          boss_od=_pitch_layout(40)['od'] + 36, boss_w=_pitch_layout(40)['boss_w'],
                          boss_bore=SIZES[40].od + 1)
    upper = cq.Workplane('XY').add(upper)
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

    # ════════════════════════════════════════════════════════ J3 + forearm ═══
    L3 = _pitch_layout(40)
    j3 = j2.child('J3_Elbow', loc(0, LU, 0), sub='J3',
                  joint={'name': 'J3', 'axis': [1, 0, 0], 'limits': S['limits']['j3'], 'kind': 'revolute',
                         'stowed': S['stowed']['j3']})
    Tm3 = loc(L3['out_x'], 0, 0, rz=-90)
    a3 = build_actuator(m, j2, j3, 40, loc(0, LU, 0), Tm3, 'CHG-J3', 'J3')
    boss3_od = L3['od'] + 36
    clamp3 = std.shcs(8, 35, '12.9', 'Clamps the J3 actuator drum in the upper arm boss.')
    for p in front_ring_points(40, 8):
        r = math.hypot(p[0], p[2])
        dirv = (0, -p[0] / r, -p[2] / r)
        pos = (0.0, LU + p[0] / r * (boss3_od / 2), p[2] / r * (boss3_od / 2))
        m.place(j2, clamp3, std.orient(pos, dirv), tuple(-c * 80 for c in dirv), 'J3')
    # wrist geometry needed by the forearm's top socket
    s4 = SIZES[25]
    L4 = module_length(s4)
    y4_out = LF - 104.0                       # J4 output face, below the wrist centre
    y_sock1 = y4_out - s4.of_t - s4.xrb[2]          # J4's housing front face: the socket's top
    fore = _link_casting(y_sock1, radii['fore'] * 1.16, radii['wristR'] * 1.02,
                         cheek_x=L3['out_x'] + 18, cheek_r=a3['of_od'] / 2 + 12, cheek_t=18, wall=6.0,
                         socket_r=s4.od / 2 + 12, socket_bore=s4.od + 1, socket_len=(s4.od - rear_od(s4)) * 0.4 + 48)
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
    j4 = j3.child('J4_ForearmRoll', loc(0, y4_out, 0), sub='WRIST',
                  joint={'name': 'J4', 'axis': [0, 1, 0], 'limits': S['limits']['j4'], 'kind': 'revolute',
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
            .cut(cq.Workplane('YZ', origin=(-L5['boss_w'] * 2, dy5, 0)).circle(L5['od'] / 2 + 0.5).extrude(L5['boss_w'] * 4)))
    m.place(j4, m.part(PartDef('CHG-YK5', 'Wrist yoke', yoke.val(), 'al6061', 'structure', 'machined from billet',
                               f'{L5["boss_w"] + 10:.0f} x {dy5:.0f}', '6061-T6', None,
                               'Turns on J4 and holds the J5 actuator on the wrist centre.', {}, 'make')),
            Location(), (0, 90, 0), 'WRIST')
    ys = std.shcs(6, 25, '12.9', 'Holds the wrist yoke to the J4 output flange.')
    for p in out_flange_points(25):
        m.place(j4, ys, std.orient((p[0], 14, p[2]), (0, -1, 0)), (0, 110, 0), 'WRIST')
    j5 = j4.child('J5_WristPitch', loc(0, dy5, 0), sub='WRIST',
                  joint={'name': 'J5', 'axis': [1, 0, 0], 'limits': S['limits']['j5'], 'kind': 'revolute',
                         'stowed': S['stowed']['j5']})
    a5 = build_actuator(m, j4, j5, 25, loc(0, dy5, 0), loc(L5['out_x'], 0, 0, rz=-90), 'CHG-J5', 'WRIST', gland_m=16)
    # J5 output cheek -> wrist tube up to J6 (J6 output face = the tool flange at the wrist centre + LW)
    s6 = SIZES[20]
    L6 = module_length(s6)
    cheek5_x = L5['out_x'] + 14
    tube_top = LW - L6 + s6.of_t + s6.xrb[2] + 4
    wt = (cq.Workplane('YZ', origin=(cheek5_x - 14, 0, 0)).circle(a5['of_od'] / 2 + 10).extrude(14)
          .union(cq.Workplane('XZ', origin=(0, 40, 0)).sketch().rect(cheek5_x * 2 - 6, radii['wristR'] * 1.5).vertices().fillet(20)
                 .finalize().extrude(-(tube_top - 40)).translate((cheek5_x * 0.5 - 6, 0, 0)))
          .union(cq.Workplane('XZ', origin=(0, tube_top - 30, 0)).circle(s6.od / 2 + 10).extrude(-30))
          .cut(cq.Workplane('XZ', origin=(0, tube_top - 31, 0)).circle(s6.od / 2 + 0.5).extrude(-40)))
    m.place(j5, m.part(PartDef('CHG-WTB', 'Wrist tube', wt.val(), 'al6061', 'structure', 'machined from billet',
                               f'J5 cheek to J6, {tube_top:.0f}', '6061-T6', None,
                               'Turns on J5 and holds the J6 actuator on the tool axis.', {}, 'make')),
            Location(), (60, 40, 0), 'WRIST')
    for p in out_flange_points(25):
        m.place(j5, std.shcs(6, 25, '12.9', 'Holds the wrist tube cheek to the J5 output flange.'),
                std.orient((cheek5_x, p[0], p[2]), (-1, 0, 0)), (120, 0, 0), 'WRIST')
    j6 = j5.child('J6_ToolRoll', loc(0, LW, 0), sub='WRIST',
                  joint={'name': 'J6', 'axis': [0, 1, 0], 'limits': S['limits']['j6'], 'kind': 'revolute',
                         'stowed': S['stowed']['j6']})
    build_actuator(m, j5, j6, 20, loc(0, LW, 0), Location(), 'CHG-J6', 'WRIST', gland_m=16)
    for p in std.circle_points(6, s6.od / 2 + 5, 'y', offset=tube_top, start=30):
        m.place(j5, std.shcs(5, 20, '12.9', 'Clamps the J6 actuator in the wrist tube.'), std.orient(p, (0, -1, 0)),
                (0, 100, 0), 'WRIST')
    wring = cq.Workplane('XY').add(cq.Solid.makeTorus(radii['wristR'] * 0.97, 4, pnt=Vector(0, tube_top - 34, 0), dir=Vector(0, 1, 0)))
    m.place(j5, m.part(PartDef('CHG-WRING', 'Status light ring, wrist', wring.val(), 'led', 'electrical',
                               'LED strip in PC diffuser', f'OD {radii["wristR"] * 1.94:.0f}', '', None,
                               'Shows the arm state at the connector, where the camera and a person look.', {}, 'buy')),
            Location(), (0, 30, 0), 'SAFETY')

    # ═════════════════════════════════════════════════════════════ TOOL ═══
    tool = j6.child('Tool', loc(0, 0, 0), sub='TOOL')
    build_tool(m, tool, LT)

    # ═════════════════════════════════════════════════════════ DRESS PACK ═══
    cab_r = 16.0
    cab_part = lambda pid, pts, nm: m.part(std.swept(pid, nm, pts, cab_r, 'cable', 'electrical', 0.0,  # noqa: E731
        'Liquid-cooled DC charge cable, 2 x 50 mm2 copper with coolant lines, plus the CP/PP signal pair.',
        {'rating': '500 A DC, 1000 V', 'bend radius': 'min 250 mm'}, 'IEC 62893-4-2', 'OD 32'))
    zc = -radii['upper'] * 1.18 - 30
    m.place(j2, cab_part('CHG-CBL-U', [(0, 140, zc - 40), (0, 500, zc - 18), (0, 900, zc - 10), (0, LU - 150, -radii['elbow'] * 0.86 - 40)],
                         'Charge cable, upper arm run'), Location(), (0, 0, -160), 'DRESS')
    zf = -radii['fore'] * 1.16 - 30
    m.place(j3, cab_part('CHG-CBL-F', [(0, 150, zf - 30), (0, 500, zf - 8), (0, LF - 360, -radii['wristR'] - 40), (0, LF - 200, -radii['wristR'] - 60)],
                         'Charge cable, forearm run'), Location(), (0, 0, -140), 'DRESS')
    m.place(j1, cab_part('CHG-CBL-T', [(0, 40, -rb - 35), (0, H * 0.5, -rb - 25), (0, H - 60, zc - 60), (0, H + 140, zc - 40)],
                         'Charge cable, turret run'), Location(), (0, 0, -160), 'DRESS')
    clamp_shape = (cq.Workplane('XY').box(60, 18, 50).edges('|Y').fillet(6)
                   .cut(cq.Workplane('XZ').circle(cab_r + 0.5).extrude(20, both=True).translate((0, 0, 8))))
    clamp_pd = PartDef('CHG-CLP', 'Cable saddle clamp, 32 mm', clamp_shape.val(), 'pa66', 'electrical', 'catalogue part',
                       'for OD 32 cable', '', None, 'Holds the charge cable to the link. Its rubber liner stops wear.', {}, 'buy')
    for node, ys_, z in ((j2, (360, 760, 1160), zc + 4), (j3, (380, 780), zf + 4)):
        for y in ys_:
            m.place(node, clamp_pd, loc(0, y, z + 22), (0, 0, -120), 'DRESS')
            for sx in (-1, 1):
                m.place(node, std.shcs(6, 20, 'A2-70', 'Holds the cable clamp to its link.'),
                        std.orient((sx * 22, y, z + 47), (0, 0, 1)), (0, 0, -160), 'DRESS')

    # ═════════════════════════════════════════════════════════════ SAFETY ═══
    sc = (cq.Workplane('XY').box(110, 150, 104, centered=(True, False, True)).edges('|Y').fillet(10)
          .faces('<Y').shell(-3)
          .union(cq.Workplane('XZ', origin=(0, 150, 0)).circle(48).circle(45).extrude(-60))
          .union(cq.Workplane('XZ', origin=(0, 150, 0)).circle(50).circle(46).extrude(-4)))
    m.place(base, m.part(PartDef('CHG-SCN', 'Safety laser scanner, 275 degrees', sc.val(), 'a356', 'sensor',
                                 'IEC 61496-3, type 3', 'protective field up to 5.5 m', 'PL d / SIL 2', None,
                                 'Watches the stall at knee height. A person in the field stops the arm.', {}, 'buy')),
            loc(0, pad_top + 220, riser_w / 2 + 52, rx=-90), (0, 0, 140), 'SAFETY')
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


def build_tool(m: Model, tool: Node, LT: float) -> None:
    """The connector tool on the J6 flange (tool frame: origin at the flange face, +Y out along the tool axis)."""
    # ISO 9409-1-50-4-M6 on a size 20 output (pitch circle 50, 4 x M6, spigot 31.5): the adapter starts here
    y = 0.0
    ft = (cq.Workplane('XZ', origin=(0, y, 0)).circle(52).extrude(-40).faces('>Y').edges().chamfer(1.5)
          .cut(cq.Workplane('XZ', origin=(0, y + 41, 0)).circle(20).extrude(42))
          .union(cq.Workplane('XY').box(22, 24, 14).translate((44, y + 20, 0))))
    m.place(tool, m.part(PartDef('CHG-FTS', '6-axis force and torque sensor', ft.val(), 'al6061', 'sensor',
                                 'ISO 9409-1-50-4-M6 both faces', 'OD 104 x 40', '', None,
                                 'Reads the 3 forces and 3 torques at the tool. The arm stops the insertion past its force limit.',
                                 {'range': 'Fz 1,000 N, Fxy 500 N, Txyz 40 N m', 'rate': '1 kHz'}, 'buy')),
            Location(), (0, 60, 0))
    for p in std.circle_points(4, 25, 'y', offset=y + 40, start=45):
        m.place(tool, std.shcs(6, 16, '12.9', 'Holds the sensor to the J6 tool flange (ISO 9409-1).'), std.orient(p, (0, -1, 0)), (0, 80, 0))
    m.place(tool, std.dowel(6, 12), loc(0, 40, 25), (0, 70, 0))
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
              .union(cq.Workplane('XY').box(90, 60, 30, centered=(True, False, True)).translate((0, y + 14, 46))))
    m.place(tool, m.part(PartDef('CHG-CHL', 'Connector holder', holder.val(), 'al6061', 'tool', 'machined', 'OD 116',
                                 '6061-T6', None, 'Holds the connector body and the camera pod on the tool axis.', {}, 'make')),
            Location(), (0, 160, 0))
    body_len = face_y - (y + 14) - 46
    body = (cq.Workplane('XZ', origin=(0, y + 14, 0)).circle(50).workplane(offset=-body_len * 0.6).circle(46).loft()
            .union(cq.Workplane('XZ', origin=(0, y + 14 + body_len * 0.6, 0)).circle(46).extrude(-body_len * 0.4))
            .union(cq.Workplane('XY').box(30, body_len * 0.5, 22).translate((0, y + 14 + body_len * 0.45, -52))))
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
    nose = nose.faces('>Y').workplane().pushPoints(pts_dc).hole(16, 30)
    m.place(tool, m.part(PartDef('CHG-NOS', 'Connector nose and face', nose.val(), 'pa66', 'tool', 'moulded',
                                 f'OD 80 x {face_y - nose_y0:.0f}', '', None,
                                 'Enters the inlet. Its shape guides the last few millimetres.', {}, 'make')),
            Location(), (0, 240, 0))
    dc = (cq.Workplane('XZ').circle(7.5).circle(4.2).extrude(-26))
    dc_pd = m.part(PartDef('CHG-DCC', 'DC contact socket, 8 mm', dc.val(), 'silver', 'tool', 'IEC 62196-3', '8 mm pin',
                           'silver plated', None, 'Carries the DC current. Spring bands give low resistance.', {}, 'buy'))
    for (x, z) in pts_dc:
        m.place(tool, dc_pd, loc(x, face_y - 26, -z), (0, 260, 0))
    sig = cq.Workplane('XZ').circle(2.8).circle(1.6).extrude(-18)
    sig_pd = m.part(PartDef('CHG-SGC', 'Signal contact socket, 3 mm (PE, CP, PP)', sig.val(), 'silver', 'tool',
                            'IEC 62196-3', '3 mm pin', 'silver plated', None,
                            'Protective earth, control pilot and proximity: the car and charger talk on CP.', {}, 'buy'))
    for (x, z) in pts_sig:
        m.place(tool, sig_pd, loc(x, face_y - 24, -(z + 12) + 12 - 12 if False else -z), (0, 260, 0))
    latch = (cq.Workplane('XY').box(16, 70, 14).translate((0, face_y - 30, 46))
             .union(cq.Workplane('XY').box(16, 14, 22).translate((0, face_y + 2, 41))))
    m.place(tool, m.part(PartDef('CHG-LAT', 'Connector latch hook', latch.val(), 'ss304', 'tool', 'machined', '16 x 70',
                                 '', None, 'Hooks the inlet catch. The car cannot pull the connector out under load.', {}, 'make')),
            Location(), (0, 230, 50))
    sol = cq.Workplane('XY').box(36, 46, 30).edges('|Y').fillet(4).translate((0, face_y - 90, 52))
    m.place(tool, m.part(PartDef('CHG-SOL', 'Latch solenoid, 24 V', sol.val(), 'steel_paint', 'tool', 'catalogue part',
                                 '36 x 46 x 30', '', None, 'Moves the latch hook. A spring locks it when power is off.',
                                 {'force': '35 N at 5 mm stroke'}, 'buy')), Location(), (0, 200, 90))
    # vision pod: stereo pair + time-of-flight + IR light ring, looking along +Y
    pod = (cq.Workplane('XY').box(110, 34, 40).edges().fillet(5).translate((0, y + 50, 46 + 30)))
    m.place(tool, m.part(PartDef('CHG-VIS', 'Vision pod: stereo cameras and time-of-flight', pod.val(), 'a356_dark', 'sensor',
                                 'made to order', '110 x 40 x 34', 'IP67', None,
                                 'Finds the inlet and its angle from 0.6 m out. The arm corrects the last 10 mm with it.',
                                 {'stereo base': '60 mm', 'depth': 'time-of-flight, 0.1-2 m', 'light': '850 nm ring'}, 'buy')),
            Location(), (0, 160, 140))
    lens = cq.Workplane('XZ').circle(9).extrude(-4)
    lens_pd = m.part(PartDef('CHG-LNS', 'Camera window', lens.val(), 'lens', 'sensor', 'catalogue part', 'D 18', '', None,
                             'Sealed glass in front of each camera.', {}, 'buy'))
    for x in (-30, 30, 0):
        m.place(tool, lens_pd, loc(x, y + 67, 76), (0, 180, 140))
    for p in ((-45, 76), (45, 76)):
        m.place(tool, std.shcs(4, 12, 'A2-70', 'Holds the vision pod to the holder.'), std.orient((p[0], y + 33, p[1]), (0, 1, 0)), (0, 140, 140))
    m.place(tool, std.gland(20, 'Seals the charge cable into the connector body.'), std.orient((0, y + 14 + body_len * 0.45, -63), (0, 0, 1)),
            (0, 200, -60))


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
    cable = 4.0                                # kg of free cable hanging at the tool (ASSUMPTION)
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
        'method': 'Gravity torque with the arm stretched horizontal, masses from the CAD solids, plus 4 kg of '
                  'hanging cable at the tool (ASSUMPTION). Dynamics and the cable pull are not included.',
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
