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
from ..flex import Anchor, FlexDef


WAND_SLIDES = 3                 # sliding wand tubes (the twin draws 2)
WAND_R = (29.3, 25.65)          # outer radii of wand tubes 2 and 3; tube 1 is the twin's 68 mm, tube 4 its 44 mm

# ── the supply at the column head ─────────────────────────────────────────────────────────────────────────────
# What the canopy brings and where it joins the arm. The canopy plant's own lines (the vacuum main, the air main, the
# cable tray) are site works: drawn as reference parts, for context, as the purlins are.
VAC_MAIN_OD = 110.0             # ASSUMPTION: the canopy vacuum main, DN 100. The plant (one producer for a canopy's arms)
                                # is not sized in this CAD; a main is one or two sizes over its DN 50 branches.
VAC_BEND_R = 75.0               # the riser's bends: 1.5 x its 50 mm diameter on the centreline, a long-radius pipe elbow
                                # (ASSUMPTION: the usual long-radius rule, 1.5 x D; not read from a standard here)
AIR_OD = 6.0                    # the arm's air line (VAC subsystem: "a 6 mm line")
AIR_BEND_R = 30.0               # 5 x 6 mm: this file's own rule for PU tube (the nozzle loop)
ENC_H, ENC_W, ENC_D = 600.0, 400.0, 200.0   # ASSUMPTION: the supply enclosure, a catalogue wall enclosure size. Its
                                # contents (controller, power supplies, J1 drive, safety relay) are not laid out here.
ENC_Y0 = 4250.0                 # its underside above grade: 350 mm over the J1 gearmotor's top, so the motor cable
                                # drops straight, and far above every car, door and moving link (all under 3.65 m)
# Conduit: one cable in each, so the fill limit is 53 % of the bore (NEC chapter 9, table 1: 53 % one conductor, 31 %
# two, 40 % over two; read 2026-11-14, https://www.ecmweb.com/national-electrical-code/code-basics/article/20892946/fill-er-up).
# ASSUMPTION (from memory of NEC chapter 9, table 4, rigid conduit; not re-read): trade size 1/2 has a 15.3 mm bore and
# a 21.3 mm OD; 3/4 has a 20.4 mm bore and a 26.7 mm OD.
CONDUIT = {'1/2': (21.3, 15.3), '3/4': (26.7, 20.4)}      # trade size: (OD, bore), mm
SUPPLY_CABLE_OD = 10.5          # ASSUMPTION: a 4 x 2.5 mm2 supply cable (the arm's motors total about 2.4 kW)
NET_CABLE_OD = 8.0              # ASSUMPTION: an industrial Cat 6A cable


def _conduit_for(cable_od: float) -> str:
    """The smallest trade size whose bore one cable fills to 53 % or less."""
    for size, (_, bore) in CONDUIT.items():
        if cable_od ** 2 <= 0.53 * bore ** 2:
            return size
    raise ValueError(f'no conduit for a {cable_od} mm cable')


def _stadium(L: float, w: float, h: float, r0: float, r1: float) -> cq.Workplane:
    """A link: from a round end of radius r0 at x = 0 to one of radius r1 at x = L, h tall (Y), centred on y = 0."""
    hull = (cq.Workplane('XZ').polyline([(0, -r0), (L, -r1), (L, r1), (0, r0)]).close().extrude(h / 2, both=True))
    return hull.union(cq.Workplane('XZ').circle(r0).extrude(h / 2, both=True)) \
        .union(cq.Workplane('XZ').center(L, 0).circle(r1).extrude(h / 2, both=True))


def _box_link(L: float, w: float, h: float, wall: float, hub0: float, hub1: float, pockets: tuple = (),
              bosses: tuple = (True, True), holes: tuple = ()) -> cq.Shape:
    """A welded box link between two hubs. Bosses stop 1 mm inside the top and bottom skins and never
    pass the link's own end radius: coplanar or tangent faces make the boolean hang."""
    r0, r1 = w / 2, w / 2 * 0.9
    outer = _stadium(L, w, h, r0, r1)
    inner = _stadium(L, w - 2 * wall, h - 2 * wall, r0 - wall, r1 - wall)
    body = outer.cut(inner)
    for (x, d, r_end), boss in zip(((0.0, hub0, r0), (L, hub1, r1)), bosses):
        rb = min(d / 2 + 14, r_end - 1.5)
        if boss and rb > d / 2 + 2:
            body = body.union(cq.Workplane('XZ').center(x, 0).circle(rb).extrude(h / 2 - 1, both=True))
    body = body.cut(cq.Workplane('XY').box(L - r0 - r1, wall + 2, w - 2 * wall - 16).translate((L / 2, h / 2 - wall / 2 + 0.5, 0)))
    body = body.cut(cq.Workplane('XZ').circle(hub0 / 2).extrude(h, both=True))
    body = body.cut(cq.Workplane('XZ').center(L, 0).circle(hub1 / 2).extrude(h, both=True))
    for (x, z, d, y_top, y_bot) in pockets:          # counterbores for screw heads, from y_top down to y_bot
        body = body.cut(cq.Workplane('XZ', origin=(x, y_top, z)).circle(d / 2).extrude(y_top - y_bot))
    for (x, z, d) in holes:                          # through holes (a pinion shaft, a duct)
        body = body.cut(cq.Workplane('XZ', origin=(x, h, z)).circle(d / 2).extrude(2 * h))
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
    m.yard_deck_y = 0.0                               # grade under the car: nothing of the arm is under it
    m.subsystem('MOUNT', 'Canopy mount', 'A header beam under 2 canopy purlins and a drop column carry the arm over the stall. Nothing stands where a car drives.',
                how=['4 angle clips bolt the header to the purlins.', 'The drop column bolts to the header and carries the J1 base.',
                     'The vacuum riser, the air line and the arm\'s cable run inside the column to the J1 union.',
                     'The supply enclosure and the air service unit hang on the column, 4.25 m up and higher.'],
                specs={'J1 height': f'{y1 / 1000:.2f} m above grade', 'column': 'SHS 200 x 200 x 8'}, group='Structure')
    m.subsystem('J1', 'J1 shoulder yaw', 'Swings link 1 about the column. With J2 it puts the mast anywhere over the car.',
                how=['A cross-roller bearing in the base casting carries link 1. A servo gearmotor beside the column turns it by a '
                     'pinion on a ring gear.',
                     'J1 turns 178 degrees round the column in a cleaning cycle.',
                     'A rotary union with a slip ring on its axis passes the vacuum, air and signals. No hose winds round the column.'],
                specs={'drive': 'servo + 25:1 planetary + 130:14 gear', 'range': '-175 to +175 degrees'}, group='Joints')
    m.subsystem('LINK1', 'Link 1', f'The {L1 / 1000:.2f} m box link from J1 to J2.',
                how=['Welded aluminium box with a bolted top cover.', 'The vacuum duct, the air line and the cables run inside it.'], group='Links')
    m.subsystem('J2', 'J2 elbow yaw', 'Folds link 2 under link 1, so the arm can tuck in over the roof.',
                how=['A cross-roller bearing under link 1 carries link 2. A right-angle gearmotor inside link 1 turns it by a pinion '
                     'on a ring gear.',
                     'A rotary union with a slip ring in link 1\'s tip passes the vacuum, air and signals to link 2.'],
                specs={'drive': 'servo + 30:1 right-angle + 94:14 gear'}, group='Joints')
    m.subsystem('LINK2', 'Link 2', f'The {L2 / 1000:.2f} m box link from J2 to the mast.',
                how=['It rides 190 mm under link 1.', 'The vacuum duct runs inside it and up to the J3 union.'], group='Links')
    m.subsystem('J3', 'J3 mast yaw', 'Turns the mast, so the wand points along or across the car.',
                how=['A cross-roller bearing carries the mast collar in the carriage at the tip of link 2.',
                     'A servo gearmotor on the lid turns a 120-tooth ring on the collar through a toothed belt, 5:1.',
                     'J3 turns 462 degrees in one cleaning cycle.',
                     'The vacuum and the signals cross it in a rotary union with a slip ring on the mast axis. No hose or cable winds up.'],
                specs={'drive': 'servo + 20:1 planetary + 5:1 belt', 'range': '-186 to +292 degrees'}, group='Joints')
    m.subsystem('MAST', 'Telescoping mast', 'Lowers the wrist from 2.18 m to 0.58 m above grade, beside the car, never over it.',
                how=['A rack and pinion drives the middle stage.', 'A belt over a pulley on the middle stage moves the inner stage twice as far.',
                     'Acetal wear pads guide each stage. A brake holds it when power is off.'],
                specs={'stroke': f'{2 * (stage - overlap) / 1000:.2f} m', 'stages': '160, 125, 95 mm square'}, group='Motion')
    m.subsystem('WRIST', 'J4 wrist pitch', 'Tilts the wand from level to hanging down, and into the door opening.',
                how=['A size 17 strain-wave gear unit in the fork turns the hub. Its servo motor stands behind the hub and drives '
                     'it by a toothed belt (2:1).',
                     'The vacuum crosses the joint on its axis, through the hub\'s hollow stub and a swivel on the other cheek.',
                     'A duct takes it up through the fork into the mast.',
                     'The power and network cross in a flat-cable clock spring between the hub and the cheek.',
                     'The air crosses in a second passage of the swivel.',
                     'Nothing on the wrist stands more than 95 mm along the axis from the pivot.',
                     'The twin keeps the pivot 0.20 m off the car, and the wrist keeps 0.10 m.'],
                specs={'gear': 'strain-wave unit, size 17, 100:1, belt 2:1', 'motor': '200 W servo, brake, encoder (class)',
                       'range': '-90 to +45 degrees'}, group='Joints')
    m.subsystem('WAND', 'Telescoping vacuum wand', 'Reaches into the cabin through the open door. The wand is the vacuum duct.',
                how=['3 tubes slide inside the base tube and each other on lip seals. The air flows inside them.',
                     'An electric linear drive moves tube 2. Cables over pulleys move tubes 3 and 4 with it, a third of the reach each.',
                     'Retracted, all the tubes lie inside the base tube, in front of the hub.'],
                specs={'reach': f'{wb / 1000:.2f} m + {wext / 1000:.2f} m', 'tubes': '68, 58.6, 51.3, 44 mm'}, group='Motion')
    m.subsystem('NOZZLE', 'Nozzle head (J5)', 'Cleans the floor, the benches and the seat backs with vacuum, an air knife and a brush lip.',
                how=['A gearmotor with a worm stage pitches the head.', 'The air knife blows dust out of seams into the vacuum flow.',
                     'A light ring shows that it works, and lights the cabin for the camera.'],
                specs={'mouth': f'{N["w"]:.0f} x {N["h"]:.0f} mm', 'air knife': '6 bar'}, group='Tool')
    m.subsystem('VISION', 'Cabin vision pod', 'Looks into the cabin along the wand. It checks that no one is inside before the wand '
                'goes in, finds the seats, the floor and items left behind, and takes a picture of each surface before and after.',
                how=['A sealed pod rides under the wand\'s base tube, by the wrist. It turns with the wand and looks where the wand points.',
                     'It holds 2 cameras 55 mm apart, a time-of-flight depth module and a 60 GHz radar.',
                     'The light ring on the wand\'s tip lights the cabin for the cameras. The depth module has its own IR light.',
                     'The radar sees breathing through a blanket or a seat. The cameras alone cannot.',
                     'The wand goes in only when the radar and the cameras both find the cabin empty.',
                     'A vision board in the pod runs the models. Only verdicts and still pictures leave the pod, on the arm\'s '
                     'EtherCAT line.',
                     'The radar looks out through a black polycarbonate window 3.0 mm thick: 2 half wavelengths at 60 GHz, so '
                     'the window passes the radar.',
                     'The pod is the first node on the wand. The clock spring\'s lead goes in, and the wand drive\'s cable comes out.',
                     'It stays outside the car. It keeps more than the wand\'s 0.03 m off the car and the open doors.'],
                specs={'cameras': '2 x 2.3 MP global shutter, 1/2.6 in, 3.0 um pixels, M12 2.8 mm lens: about 92 x 66 degrees',
                       'depth': 'time-of-flight, 0.1 to 2 m (class)', 'radar': '60 GHz, presence and breathing (class)',
                       'processor': 'AI vision processor, 7 TOPS class, about 2 W (class)',
                       'link': 'EtherCAT, 100 Mbit/s: a verdict at once, the pictures after the clean (ASSUMPTION)',
                       'rating': 'IP67 (class)'}, group='Tool')
    vac_mains = [v['routeM'] for v in (spec.get('site') or {}).get('vacuumMains', [])]
    m.subsystem('VAC', 'Vacuum and air supply', 'Brings vacuum from the canopy plant and compressed air from the depot\'s compressor to the nozzle.',
                how=['A central vacuum producer on each canopy (about 3 kW per working arm, 30 kPa class) serves its arms.',
                     'The producer stands at grade under the canopy\'s south end, with its separator, filter and dirt bin.',
                     'One compressor in the service building feeds the air of all 3 canopies. The air knives are the depot\'s only tool that uses air.',
                     'A vacuum main and an air main run under the canopy roof, over the header. They belong to the canopy plant.',
                     'The vacuum main comes up the canopy\'s last spine column from the producer.',
                     'A branch drops from the vacuum main through a gate valve, in through the column wall, and down to the J1 union.',
                     'A drop from the air main feeds a service unit on the column: a lockable shut-off valve and a filter regulator.',
                     'A 6 mm line runs from the unit in through the column wall and down to the J1 union.',
                     'A rotary union at each yaw joint and a duct in each link take the vacuum to the mast.',
                     'The mast stages are the duct down to the wrist. The fork, the swivel, the hub and the wand take it to the nozzle.',
                     'The air goes through the same unions.',
                     'A spring reel on the mast pays the cable and the air line down to the wrist.',
                     'At the wrist, the cable crosses in a clock spring and the air in the swivel.',
                     'A reel in the wand feeds both along it. A loop takes the air across the nozzle joint.'],
                specs={'duct': 'DN 50 throughout', 'airflow': 'about 400 m3/h per producer (class)',
                       'vacuum main': (f'{VAC_MAIN_OD:.0f} mm, {max(vac_mains):.0f} m from the producer to the 10 arms of a canopy (measured on '
                                       'the site plan; ASSUMPTION: the canopy plant is not sized here)' if vac_mains else
                                       f'{VAC_MAIN_OD:.0f} mm (ASSUMPTION: the canopy plant is not sized here)'),
                       'isolation': 'gate valve DN 50 on the vacuum branch, lockable valve on the air drop'}, group='Supply')
    m.subsystem('POWER', 'Power, control and network', 'Brings electric power and the site network to the arm, and holds its controller.',
                how=['A supply enclosure on the drop column holds the controller, the power supplies, the J1 drive and the safety relay.',
                     'A lockable isolator on its door cuts the supply for work on the arm.',
                     'The supply cable and the network cable come down from the canopy cable tray, each in its own conduit.',
                     'They come along the tray from the canopy\'s board, up its last spine column.',
                     'A motor cable runs from the enclosure down to the J1 gearmotor.',
                     'A second cable goes in through the column wall and down to the J1 union. Its slip ring feeds the rest of the arm.',
                     'The disconnect that a person reaches from the ground is the arm\'s breaker in the canopy\'s board.',
                     'The board stands at grade under the canopy\'s south end. It is site work: the yard draws it, and this model does not.'],
                specs={'enclosure': f'{ENC_H:.0f} x {ENC_W:.0f} x {ENC_D:.0f} mm, stainless, IP66 (class)',
                       'height': f'{ENC_Y0 / 1000:.2f} m above grade, on the column',
                       'conduit fill': 'one cable in each conduit, under 53 % (NEC chapter 9, table 1)'}, group='Supply')
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
    AIR_X, AIR_Z = 40.0, -30.0                     # the air line inside the column, from the column's axis: on the J1 union's
    CAB_X, CAB_Z = 30.0, 40.0                      # top face (r 50 of its 60), 22 mm off the riser; and the arm's cable, the same
    col = cq.Workplane('XY').add(_sq_tube(200, 8, col_top - col_bot - 40)).translate((0, col_top - 20, 0))
    col = col.union(cq.Workplane('XY').box(300, 20, 300).translate((0, col_top - 10, 0)))
    col = col.union(cq.Workplane('XY').box(300, 20, 300).translate((0, col_bot + 10, 0))
                    .cut(cq.Workplane('XZ', origin=(0, col_bot + 21, 0)).circle(SIZES[32].od / 2).extrude(22))    # the J1 union's rotor
                    .cut(cq.Workplane('XZ', origin=(144.0, col_bot + 21, 0)).circle(9).extrude(22)))           # the J1 pinion shaft
    # the column's wall is opened 3 times for the supply (THE SUPPLY AT THE COLUMN HEAD, below): the vacuum riser and the
    # air line come in through its -Z face, the arm's cable through its +X face, behind the enclosure
    y_vo = col_top - 250.0                         # the riser's way in: its bend ends 155 mm under the top plate
    y_ao = ENC_Y0 + 230.0                          # the air line's
    y_co = ENC_Y0 + ENC_H / 2                      # the cable's, behind the enclosure's middle
    col = (col.cut(cq.Workplane('XY', origin=(0, y_vo, -110)).circle(28).extrude(20))
           .cut(cq.Workplane('XY', origin=(AIR_X, y_ao, -110)).circle(AIR_OD / 2 + 2).extrude(20))
           .cut(cq.Workplane('YZ', origin=(90, y_co, CAB_Z)).circle(8).extrude(20)))
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
    # ═══════════════════════════════════════════════════════ J1 + link 1 ═══
    # J1 swings the arm 178 degrees round the column in a cleaning cycle and J2 folds link 2 54 degrees under link 1. A hose
    # cannot follow either: from the column it would have to pass through the column at mid-swing, and at J2's fold its 2
    # ports stand closer than its bend allows. So J1 and J2 are built as J3 is (design finding 10): the vacuum, the air and
    # the signals cross each on its axis in a rotary union with a slip ring, and the joint is driven off its axis, by a
    # pinion on a ring gear. The vacuum duct and the cables run inside link 1 and link 2.
    j1 = base.child('CA_J1', loc(mx, y1, 0), sub='J1',
                    joint={'name': 'CA_J1', 'axis': [0, 1, 0], 'limits': [-3.05, 3.05], 'kind': 'revolute',
                           'stowed': -home['t1']})
    h1, h2 = A['link1']['h'] * M, A['link2']['h'] * M
    jr1 = A['j1']['r'] * M                               # the twin's J1 drum
    bc_y0, bc_y1 = y1 + h1 / 2 + 3, col_bot              # the base casting: from link 1's top up to the column's foot
    tp = 26.0                                            # its top plate, which carries the bearing
    RG1, PN1 = 130.0, 14.0                               # the J1 ring gear's and pinion's pitch radii
    XP1 = RG1 + PN1                                      # the pinion's axis, off J1 along +X, clear of the column's face
    bcast = (cq.Workplane('XZ', origin=(0, bc_y1, 0)).circle(jr1).extrude(bc_y1 - bc_y0)
             .union(cq.Workplane('XZ', origin=(0, bc_y1, 0)).circle(jr1 * 1.18).extrude(22))
             .cut(cq.Workplane('XZ', origin=(0, bc_y1 - tp, 0)).circle(jr1 - 8).extrude(bc_y1 - tp - bc_y0 + 1))
             .cut(cq.Workplane('XZ', origin=(0, bc_y1 + 1, 0)).circle(80.5).extrude(tp + 2))
             .cut(cq.Workplane('XZ', origin=(XP1, bc_y1 + 1, 0)).circle(9).extrude(tp + 2)))
    bcast = bcast.faces('>Y').workplane(centerOption='CenterOfBoundBox').pushPoints(
        [(p[0], p[2]) for p in std.circle_points(8, 125, 'y', start=22.5)]).hole(10.2, 20)
    m.place(base, m.part(PartDef('CLN-BAS', 'J1 base casting', bcast.val(), 'a356_dark', 'structure', 'casting, machined',
                                 f'OD {jr1 * 2:.0f}', 'A356-T6', None,
                                 'Holds the J1 bearing under the column and shrouds the ring gear. Its flange bolts to the column foot.',
                                 {}, 'make')),
            loc(mx, 0, 0), (0, 120, 0), 'J1')
    for p in std.circle_points(8, 125, 'y', offset=col_bot + 20, start=22.5):
        m.place(base, std.shcs(12, 40, '10.9', 'Holds the base casting to the column foot.'), std.orient((mx + p[0], p[1], p[2]), (0, -1, 0)),
                (0, 260, 0), 'J1')
    ring = cq.Workplane('XY').add(cq.Solid.makeTorus(jr1 + 7, 7, pnt=Vector(0, bc_y0 + 20, 0), dir=Vector(0, 1, 0)))
    m.place(base, m.part(PartDef('CLN-RNG1', 'Status light ring, J1 base', ring.val(), 'led', 'electrical', 'LED strip in PC diffuser',
                                 f'OD {jr1 * 2:.0f}', '', None, 'Shows the arm state: teal ready, amber moving, green cleaning, red fault.',
                                 {}, 'buy')), loc(mx, 0, 0), (0, 60, 0), 'STATUS')
    band = cq.Workplane('XY').add(cq.Solid.makeTorus(jr1 + 5, 5, pnt=Vector(0, bc_y1 - 30, 0), dir=Vector(0, 1, 0)))
    m.place(base, m.part(PartDef('CLN-BND', 'Accent band, J1 base', band.val(), 'accent', 'structure', 'moulded', '', '', None,
                                 'OTTOYARD red band at the root of the moving machine.', {}, 'make')), loc(mx, 0, 0), (0, 70, 0), 'J1')
    m.place(base, std.cross_roller(100, 160, 16, 'Carries link 1 under the base casting. It takes the arm\'s weight and moment.'),
            loc(mx, bc_y1 - tp / 2, 0), (0, 140, 0), 'J1')
    # the hub on link 1: its flange on the top skin, its tube up through the bearing; the ring gear on it, inside the casting
    y_hf = h1 / 2                                        # link 1's top face (j1 frame)
    y_ht = bc_y1 - 5 - y1                                # the tube's top, inside the bearing (j1 frame)
    hub = (cq.Workplane('XZ', origin=(0, y_hf + 8, 0)).circle(80).circle(31).extrude(8)
           .union(cq.Workplane('XZ', origin=(0, y_ht, 0)).circle(50).circle(31).extrude(y_ht - y_hf - 8)))
    m.place(j1, m.part(PartDef('CLN-J1H', 'J1 hub', hub.val(), 'steel', 'structure', 'machined', 'OD 160 flange, 100 tube', 'C45', None,
                               'Joins link 1 to the bearing inner ring and carries the ring gear. The union\'s rotor passes inside it.',
                               {}, 'make')), Location(), (0, 160, 0), 'J1')
    for p in std.circle_points(6, 65, 'y', offset=y_hf + 8):
        m.place(j1, std.shcs(8, 20, '12.9', 'Holds the J1 hub to link 1.'), std.orient(p, (0, -1, 0)), (0, 180, 0), 'J1')
    rg_y0 = y_hf + 17                                    # 1 mm over the hub screws' heads
    rgear = cq.Workplane('XZ', origin=(0, rg_y0 + 20, 0)).circle(RG1).circle(50).extrude(20)
    m.place(j1, m.part(PartDef('CLN-RCK1', 'J1 ring gear, module 2, 130 teeth (drawn at its pitch circle)', rgear.val(), 'steel', 'drive',
                               'ISO 1328 class 7', 'pitch D 260', 'C45, induction hardened', None,
                               'Turns link 1. The pinion on the gearmotor drives it.', {'ratio': '130:14 over the gearmotor'}, 'buy')),
            Location(), (0, 200, 0), 'J1')
    pin1 = (cq.Workplane('XZ', origin=(0, 20, 0)).circle(PN1).extrude(20)
            .union(cq.Workplane('XZ', origin=(0, col_bot + 20 - (y1 + rg_y0), 0)).circle(8).extrude(col_bot + 20 - (y1 + rg_y0) - 20)))
    m.place(base, m.part(PartDef('CLN-PIN1', 'J1 pinion and shaft, module 2, 14 teeth', pin1.val(), 'steel', 'drive', 'ISO 1328 class 7',
                                 'pitch D 28', 'C45, induction hardened', None, 'Drives the J1 ring gear from the gearmotor above.', {}, 'make')),
            loc(mx + XP1, y1 + rg_y0, 0), (220, 0, 0), 'J1')
    gm1 = (cq.Workplane('XZ', origin=(0, 10, 0)).circle(40).extrude(10)
           .union(cq.Workplane('XY').box(80, 100, 76).translate((0, 60, 0)))
           .union(cq.Workplane('XZ', origin=(0, 230, 0)).circle(35).extrude(120)))
    m.place(base, m.part(PartDef('CLN-SGM1', 'J1 servo gearmotor, 750 W, 25:1 planetary, brake', gm1.val(), 'a356_dark', 'drive',
                                 'catalogue part', '80 flange', '', None,
                                 'Turns J1 through the pinion. Its brake holds the arm\'s heading with power off.',
                                 {'power': '750 W', 'gearhead': '25:1 planetary', 'overall': 'about 230:1 to J1'}, 'buy', mass_override=6.5)),
            loc(mx + XP1, col_bot + 20, 0), (260, 160, 0), 'J1')
    # the J1 union: its body in the column's foot, the riser into its top, its rotor down the hub into link 1. Its foot is
    # Y_R1 above link 1's middle: 31 mm inside the link, room for its outlet collar (THE LINES BESIDE THE DUCTS, below)
    u_y0 = col_bot + 30
    Y_R1 = 38.0
    swv1 = (cq.Workplane('XZ', origin=(0, u_y0 + 120, 0)).circle(60).extrude(120)
            .union(cq.Workplane('XZ', origin=(0, u_y0 + 140, 0)).circle(27).extrude(20))
            .union(cq.Workplane('XZ', origin=(0, u_y0, 0)).circle(25).extrude(u_y0 - (y1 + Y_R1))))
    m.place(base, m.part(PartDef('CLN-SWV1', 'Rotary union with slip ring, J1: DN 50 vacuum, air, 24 circuits', swv1.val(), 'steel_paint',
                                 'fluid', 'catalogue part', 'DN 50, G 1/4 air, 24 x 2 A', 'IP65', None,
                                 'Passes the vacuum, the air and the signals across J1. Its body stands in the column; its rotor turns '
                                 'with link 1.', {'vacuum': 'DN 50, -30 kPa', 'air': '6 bar', 'circuits': '24 x 2 A, EtherCAT pair'}, 'buy',
                                 mass_override=7.5)),
            loc(mx, 0, 0), (0, 420, 0), 'VAC')
    # ══════════════════════════════════════════ THE SUPPLY AT THE COLUMN HEAD ═══
    # Every line the arm needs comes from the canopy, and each one is drawn from the canopy's own line to the arm:
    #   vacuum   canopy vacuum main -> branch stub -> gate valve -> riser, in through the column's -Z face and down to the J1 union;
    #   air      canopy air main -> drop -> service unit on the column (lockable shut-off, filter regulator) -> a 6 mm line,
    #            in through the column's -Z face and down to the J1 union;
    #   power    canopy cable tray -> conduit -> supply enclosure on the column's +X face (isolator on its door)
    #            -> a motor cable down to the J1 gearmotor, and a cable in through the column's +X face down to the J1
    #            union's slip ring, which feeds everything that turns;
    #   network  canopy cable tray -> its own conduit -> the same enclosure (the controller); onward in the slip-ring cable.
    # The mains and the tray run along the purlins, over the header and between the 2 purlins. Each drop stands on the
    # header's -v side, clear of its 182 mm width. Nothing here is lower than the enclosure's underside (ENC_Y0), and the
    # arm's highest moving part is the J1 hub, inside the base casting under the column's foot.
    def _uv(dx: float, dz: float) -> tuple[float, float]:
        """A point's place in the header's frame (u along the header, v along the purlins), from its offset off the column's axis."""
        return dx * _ca + dz * _sa, -dx * _sa + dz * _ca

    FL_R = 82.5                                    # a DN 50 flange's radius (EN 1092-1, PN 10/16: OD 165 mm)
    VR_Z = -(150.0 + FL_R + 27.5)                  # the riser outside the column: its valve's flanges 27.5 mm off the top plate's edge
    y_main = hb + hd + 55.0 + VAC_MAIN_OD / 2      # the mains' level: 55 mm over the header's top, over the column bolts' heads
    y_sp = y_main - VAC_MAIN_OD / 2 - 60.0         # each main's branch spigot ends here, 60 mm under the vacuum main
    y_v0 = y_vo + VAC_BEND_R + 40.0                # the valve's lower flange face: 40 mm of straight pipe over the bend
    VALVE_H = 84.0                                 # 2 flanges of 18 mm and a 48 mm wafer body (ASSUMPTION: a knife gate valve's class size)
    riser = std.swept('CLN-VRS', 'Vacuum riser pipe, 50 x 3, with 2 bends',
                      [(0, u_y0 + 140, 0), (0, y_vo, 0), (0, y_vo, VR_Z), (0, y_v0, VR_Z)], 25, 'ss304', 'fluid', 22,
                      'Brings the vacuum from the gate valve in through the column\'s wall and down the column to the J1 union.',
                      {'bends': f'centreline R {VAC_BEND_R:.0f} (1.5 x D)', 'through the column': 'a 56 mm hole in its -Z face, with a grommet'},
                      'EN 10217-7', f'50 x 3, {y_vo - u_y0 - 140 + -VR_Z + y_v0 - y_vo:.0f} developed', 'make', bend=VAC_BEND_R)
    m.place(base, riser, loc(mx, 0, 0), (-160, 0, 0), 'VAC')
    gate = (cq.Workplane('XZ', origin=(0, 18, 0)).circle(FL_R).extrude(18)
            .union(cq.Workplane('XZ', origin=(0, VALVE_H - 18, 0)).circle(45).extrude(VALVE_H - 36))
            .union(cq.Workplane('XZ', origin=(0, VALVE_H, 0)).circle(FL_R).extrude(18))
            .union(cq.Workplane('XY').box(70, VALVE_H - 40, 190).translate((0, VALVE_H / 2, -FL_R - 55)))      # the bonnet, away from the column
            .union(cq.Workplane('XY', origin=(0, VALVE_H / 2, -FL_R - 150)).circle(70).extrude(-10)))         # the handwheel
    m.place(base, m.part(PartDef('CLN-VGV', 'Vacuum gate valve DN 50, flanged, handwheel', gate.val(), 'steel_paint', 'fluid',
                                 'catalogue part', 'DN 50, PN 10 flanges', '', None,
                                 'Shuts this arm off from the canopy\'s vacuum main, so the arm can be opened while the other arms work.',
                                 {'flanges': 'EN 1092-1, OD 165'}, 'buy', mass_override=9.0)),
            loc(mx, y_v0, VR_Z), (-160, 0, -160), 'VAC')
    stub = cq.Workplane('XZ', origin=(0, y_sp, 0)).circle(25).circle(22).extrude(y_sp - (y_v0 + VALVE_H))
    m.place(base, m.part(PartDef('CLN-VBR', 'Vacuum branch stub, 50 x 3', stub.val(), 'ss304', 'fluid', 'EN 10217-7',
                                 f'50 x 3, {y_sp - y_v0 - VALVE_H:.0f}', '', None,
                                 'Joins the gate valve to the canopy vacuum main\'s branch.', {}, 'make')),
            loc(mx, 0, VR_Z), (-160, 120, -160), 'VAC')
    MAIN_HALF = 700.0                              # each canopy line is shown for 1.4 m, inside the purlins' 1.6 m
    u_v, v_v = _uv(0, VR_Z)
    vmain = (cq.Workplane('XY', origin=(u_v, y_main, -MAIN_HALF)).circle(VAC_MAIN_OD / 2).circle(VAC_MAIN_OD / 2 - 3).extrude(2 * MAIN_HALF)
             .union(cq.Workplane('XZ', origin=(u_v, y_main - VAC_MAIN_OD / 2 + 3, v_v)).circle(25).circle(22).extrude(63)))
    m.place(base, m.part(PartDef('CLN-VMN', 'Canopy vacuum main with a branch (part of the canopy plant)', vmain.val(), 'ss304', 'fluid',
                                 'canopy plant', f'D {VAC_MAIN_OD:.0f}, branch D 50', '', None,
                                 'Brings the vacuum to the arms on its canopy from the canopy\'s producer, at grade under its south end. '
                                 'Shown for context.', {}, 'buy',
                                 reference=True)), Th, (0, 420, 0), 'VAC')
    # air: the drop from the main, the service unit on a channel bracket on the column's -Z face, the line into the column
    AU_Z = -165.0                                  # the unit's ports: its drop passes 9 mm outside the column's top plate
    y_u0 = y_ao + 2 * AIR_BEND_R                   # the unit's underside: the line's bend ends in its port
    AU_H = 140.0
    DROP_R = 6.0                                   # the drop from the main: a 12 mm tube, 2 sizes over the arm's 6 mm line
    u_a, v_a = _uv(AIR_X, AU_Z)
    amain = (cq.Workplane('XY', origin=(u_a, y_main, -MAIN_HALF)).circle(11).circle(9).extrude(2 * MAIN_HALF)
             .union(cq.Workplane('XZ', origin=(u_a, y_main - 9, v_a)).circle(DROP_R).extrude(y_main - 9 - y_sp)))
    m.place(base, m.part(PartDef('CLN-AMN', 'Canopy compressed-air main with a drop (part of the canopy plant)', amain.val(), 'al_extr',
                                 'fluid', 'canopy plant', 'D 22, drop D 12', '', None,
                                 'Brings compressed air to the arms on its canopy from the depot\'s one compressor, in the service building. '
                                 'Shown for context.', {}, 'buy',
                                 reference=True)), Th, (0, 420, 0), 'VAC')
    adrop = cq.Workplane('XZ', origin=(0, y_sp, 0)).circle(DROP_R).circle(DROP_R - 1.5).extrude(y_sp - (y_u0 + AU_H))
    m.place(base, m.part(PartDef('CLN-ADR', 'Air drop tube, 12 x 1.5, stainless', adrop.val(), 'ss304', 'fluid', 'EN 10216-5',
                                 f'12 x 1.5, {y_sp - y_u0 - AU_H:.0f}', '', None,
                                 'Brings the air from the canopy main\'s drop down to the service unit.', {}, 'make')),
            loc(mx + AIR_X, 0, AU_Z), (0, 120, -200), 'VAC')
    afr = cq.Workplane('XY').box(90, AU_H, 70).edges('|Y').fillet(8).translate((0, AU_H / 2, 0))
    m.place(base, m.part(PartDef('CLN-AFR', 'Air service unit: lockable shut-off valve and filter regulator, G 1/4', afr.val(), 'a356_dark',
                                 'fluid', 'catalogue part', '90 x 140 x 70', '', None,
                                 'Shuts the arm\'s air off and locks it off for service. It filters the air and sets it to 6 bar.',
                                 {'set pressure': '6 bar'}, 'buy', mass_override=0.9)),
            loc(mx + AIR_X, y_u0, AU_Z), (0, 0, -200), 'VAC')
    ab_d = -AU_Z - 35.0 - 100.0                    # the bracket's depth: from the column's face to the unit's back
    abr = (cq.Workplane('XY').box(110, AU_H, ab_d).cut(cq.Workplane('XY').box(102, AU_H + 2, ab_d - 8))
           .translate((0, AU_H / 2, -ab_d / 2)))
    m.place(base, m.part(PartDef('CLN-AFB', 'Air service unit bracket, stainless channel', abr.val(), 'ss304', 'structure', 'folded sheet 4 mm',
                                 f'110 x {AU_H:.0f} x {ab_d:.0f}', '', None, 'Holds the air service unit off the column\'s face.', {}, 'make')),
            loc(mx + AIR_X, y_u0, -100), (0, 0, -120), 'VAC')
    for yy in (y_u0 + 30, y_u0 + AU_H - 30):
        m.place(base, std.bhcs(6, 12, 'A2-70', 'Holds the air unit\'s bracket to the column, into a rivet nut.'),
                std.orient((mx + AIR_X, yy, -104), (0, 0, 1)), (0, 0, -150), 'VAC')
    aline = std.swept('CLN-AIL', 'Air line 6 x 1, service unit to the J1 union',
                      [(AIR_X, y_u0, AU_Z), (AIR_X, y_ao, AU_Z), (AIR_X, y_ao, AIR_Z), (AIR_X, u_y0 + 120, AIR_Z)], AIR_OD / 2, 'hose',
                      'fluid', AIR_OD / 2 - 1, 'Brings the air from the service unit in through the column\'s wall and down to the J1 union.',
                      {'bends': f'R {AIR_BEND_R:.0f} (5 x D)', 'through the column': 'a 10 mm hole in its -Z face, with a grommet'},
                      'ISO 14743', 'PU 6 x 4', 'buy', bend=AIR_BEND_R)
    m.place(base, aline, loc(mx, 0, 0), (0, 0, -160), 'VAC')
    # power and network: the enclosure on 2 rails welded across the column's +X face, over the J1 gearmotor
    ENC_Z0 = -100.0                                # its -Z side, flush with the column's: its top entries clear the header
    ex0 = 100.0 + 10.0                             # its back, on the rails
    zc_e = ENC_Z0 + ENC_W / 2
    lug_y = (40.0, ENC_H - 40.0)
    lug_z = (ENC_Z0 - 17.0, ENC_Z0 + ENC_W + 17.0)
    ent = ((210.0, -70.0, 'power'), (270.0, -70.0, 'network'))    # the conduit entries on its top: 62 mm and more off the header
    enc = (cq.Workplane('XY').box(ENC_D, ENC_H, ENC_W).edges('|Y').fillet(10).translate((ex0 + ENC_D / 2, ENC_H / 2, zc_e))
           .union(cq.Workplane('XZ', origin=(XP1, 0, 0)).circle(12).extrude(20)))                               # the motor cable's gland
    for (ex, ez, _) in ent:
        enc = enc.union(cq.Workplane('XZ', origin=(ex, ENC_H + 15, ez)).circle(19).extrude(15))                # a conduit hub
    for ly in lug_y:
        for lz in lug_z:
            enc = enc.union(cq.Workplane('XY').box(5, 40, 36).translate((ex0 + 2.5, ly, lz + (1 if lz < zc_e else -1)))
                            .cut(cq.Workplane('YZ', origin=(ex0 - 1, ly, lz)).circle(4.5).extrude(8)))
    m.place(base, m.part(PartDef('CLN-ENC', 'Supply enclosure, stainless, IP66: controller, power supplies, J1 drive', enc.val(), 'ss304',
                                 'electrical', 'EN 62208', f'{ENC_H:.0f} x {ENC_W:.0f} x {ENC_D:.0f}', 'IP66', None,
                                 'Holds the arm\'s controller, its power supplies, the J1 drive and the safety relay. It takes the supply '
                                 'and the site network from the canopy, and feeds the J1 gearmotor and the J1 union\'s slip ring.',
                                 {}, 'buy', mass_override=32.0)),
            loc(mx, ENC_Y0, 0), (320, 0, 0), 'POWER')
    erl = cq.Workplane('XY').box(10, 50, lug_z[1] - lug_z[0] + 60).translate((105, 0, zc_e))
    erl_pd = m.part(PartDef('CLN-ENR', 'Enclosure rail, flat 50 x 10, welded to the column', erl.val(), 'steel_s355', 'structure', 'flat bar',
                            f'50 x 10 x {lug_z[1] - lug_z[0] + 60:.0f}', 'S355J2', None,
                            'Carries the supply enclosure across the column\'s face. Welded on before galvanising.', {}, 'make'))
    for ly in lug_y:
        m.place(base, erl_pd, loc(mx, ENC_Y0 + ly, 0), (160, 0, 0), 'POWER')
        for lz in lug_z:
            m.place(base, std.hex_bolt(8, 16, 'A4-70', 'Holds an enclosure lug to its rail, into a tapped hole.'),
                    std.orient((mx + ex0 + 5, ENC_Y0 + ly, lz), (-1, 0, 0)), (360, 0, 0), 'POWER')
    iso = (cq.Workplane('YZ').circle(36).extrude(8).union(cq.Workplane('XY').box(26, 16, 64).translate((8 + 13, 0, 0))))
    m.place(base, m.part(PartDef('CLN-ISO', 'Supply isolator handle, lockable, door-coupled', iso.val(), 'accent', 'electrical',
                                 'IEC 60947-3', 'D 72', 'IP66', None,
                                 'Switches the arm\'s supply off at the enclosure and takes a padlock, for work on the arm.',
                                 {'ASSUMPTION': 'the disconnect a person reaches from the ground is the arm\'s breaker in the canopy\'s board, at '
                                                'grade under the canopy\'s south end (site works: src/lib/siteCanopy.ts)'},
                                 'buy')),
            loc(mx + ex0 + ENC_D, ENC_Y0 + ENC_H - 150, zc_e + 100), (420, 0, 0), 'POWER')
    y_tray = y_main - VAC_MAIN_OD / 2 - 5.0        # the tray's underside: 50 mm over the header's top
    us = [_uv(ex, ez)[0] for (ex, ez, _) in ent]
    u_t = sum(us) / len(us)
    tray = (cq.Workplane('XY').box(150, 60, 2 * MAIN_HALF).cut(cq.Workplane('XY').box(146, 60, 2 * MAIN_HALF + 2).translate((0, 2, 0)))
            .translate((u_t, y_tray + 30, 0)))
    m.place(base, m.part(PartDef('CLN-CTY', 'Canopy cable tray 150 x 60 (part of the canopy)', tray.val(), 'steel_s355', 'electrical',
                                 'canopy steel', '150 x 60', '', None,
                                 'Carries the arms\' supply and network cables along the canopy from its board, at grade under its south end. '
                                 'Shown for context.', {},
                                 'buy', reference=True)), Th, (0, 420, 0), 'POWER')
    for (ex, ez, what), cod in zip(ent, (SUPPLY_CABLE_OD, NET_CABLE_OD)):
        size = _conduit_for(cod)
        c_od, c_id = CONDUIT[size]
        y_c0 = ENC_Y0 + ENC_H + 15
        cd = cq.Workplane('XZ', origin=(0, y_tray, 0)).circle(c_od / 2).circle(c_id / 2).extrude(y_tray - y_c0)
        m.place(base, m.part(PartDef(f'CLN-ECD{what[0].upper()}', f'Conduit, trade size {size}, {what} drop', cd.val(), 'steel_s355',
                                     'electrical', 'rigid conduit', f'{size} x {y_tray - y_c0:.0f}', '', None,
                                     f'Brings the {what} cable from the canopy cable tray down to the supply enclosure.',
                                     {'cable': f'{cod:g} mm', 'fill': f'{100 * cod ** 2 / c_id ** 2:.0f} % of the bore (limit 53 %)'},
                                     'make')), loc(mx + ex, 0, ez), (320, 120, 0), 'POWER')
    y_gm = col_bot + 20 + 230                      # the J1 gearmotor's top
    mcab = cq.Workplane('XZ', origin=(0, ENC_Y0 - 20, 0)).circle(6).extrude(ENC_Y0 - 20 - y_gm)
    m.place(base, m.part(PartDef('CLN-EMC', 'J1 motor cable, power and feedback, 12 mm', mcab.val(), 'cable', 'electrical', 'EN 50525',
                                 f'OD 12 x {ENC_Y0 - 20 - y_gm:.0f}', '', None,
                                 'Joins the J1 gearmotor to its drive in the supply enclosure. It does not move.', {}, 'buy')),
            loc(mx + XP1, 0, 0), (320, -60, 0), 'POWER')
    CAB_BEND = 40.0                                # 4 x the cable's 10 mm, fixed installation (ASSUMPTION: a class figure for a PUR hybrid cable)
    scab = std.swept('CLN-ESC', 'Arm cable, enclosure to the J1 union: power and network, 10 mm',
                     [(ex0, y_co, CAB_Z), (CAB_X, y_co, CAB_Z), (CAB_X, u_y0 + 120, CAB_Z)], 5.0, 'cable', 'electrical', 0.0,
                     'Brings power and the network from the supply enclosure in through the column\'s wall and down to the J1 '
                     'union\'s slip ring. It does not move.',
                     {'bend': f'R {CAB_BEND:.0f} (4 x D)', 'through the column': 'a 16 mm hole in its +X face, with a gland'},
                     'EN 50525', 'OD 10', 'buy', bend=CAB_BEND)
    m.place(base, scab, loc(mx, 0, 0), (200, 0, 0), 'POWER')
    s25 = SIZES[25]
    RG2, PN2 = 94.0, 14.0                                # the J2 ring gear's and pinion's pitch radii
    a_p2 = math.radians(22.0)                            # the J2 pinion, 22 degrees round from link 1's axis, toward -Z
    XP2, ZP2 = L1 - (RG2 + PN2) * math.cos(a_p2), -(RG2 + PN2) * math.sin(a_p2)
    link1 = _box_link(L1, A['link1']['w'] * M, h1, 6, 64, 56, bosses=(False, False), holes=((XP2, ZP2, 18),))
    m.place(j1, m.part(PartDef('CLN-L1', 'Link 1 weldment', link1, 'al6061', 'structure', 'EN 1090-3, machined after welding',
                               f'{L1:.0f} between axes, 170 x 150', '6061-T6', None,
                               'Carries J2 at 0.95 m from J1. A box section: stiff in bending and twist. The duct and cables run inside.',
                               {'wall': '6 mm'}, 'make')),
            Location(), (0, 0, 0), 'LINK1')
    c1a = 80 + 5
    c1b = L1 - 0.9 * A['link1']['w'] * M / 2 + 4      # 4 mm past the top skin's opening (it stopped 58 mm short, over the J2 motor)
    # THE COVERS' SCREWS GRIP THE RIM (2026-11-15). Each cover was 20 mm narrower than its link and held by screws over the
    # opening in the link's top skin (link 1's opening reaches z +/-71, its screws stood at +/-62), so they gripped only the
    # cover. Now each cover is 4 mm narrower than its link and its screws stand on the rim, the top skin's flange between the
    # opening and the side wall, where the skin takes the thread (6 mm in link 1, 5 mm in link 2).
    cw1 = A['link1']['w'] * M - 4
    cover1 = cq.Workplane('XY').box(c1b - c1a, 3, cw1).translate(((c1a + c1b) / 2, h1 / 2 + 1.5, 0))
    m.place(j1, m.part(PartDef('CLN-L1C', 'Link 1 top cover', cover1.val(), 'al6061_blk', 'structure', 'sheet 3 mm',
                               f'{c1b - c1a:.0f} x {cw1:.0f}', '', None, 'Closes the link. Off for service. Its screws grip the rim of the link\'s top.',
                               {}, 'make')), Location(), (0, 90, 0), 'LINK1')
    for i in range(6):
        for zz in (-77, 77):
            m.place(j1, std.bhcs(5, 10, 'A2-70', 'Holds the link cover.'),
                    std.orient((c1a + 10 + i * (c1b - c1a - 20) / 5, h1 / 2 + 3, zz), (0, -1, 0)), (0, 110, 0), 'LINK1')
    # the duct in link 1: from the J1 rotor's outlet (y 38) down a 90 degree mandrel bend to y -36, across to z = +40 (the J2
    # gearmotor lies at z = -40), along the link and up to the J2 union's side port. Every bend R 74 on the centreline (1.4 D).
    # It runs 6 mm over the link's bottom skin.
    d_r = 74.0
    d1 = std.swept('CLN-L1D', 'Vacuum duct in link 1, 54 x 2',
                   [(0, Y_R1, 0), (0, Y_R1 - d_r, 0), (150, Y_R1 - d_r, 0), (230, Y_R1 - d_r, 40), (L1 - 200, Y_R1 - d_r, 40),
                    (L1 - 150, 0, 40), (L1 - 75, 0, 40)], 27, 'al6061', 'fluid', 25, 'Carries the vacuum along link 1 from J1 to J2.',
                   {'bends': 'mandrel, centreline R 74'}, 'EN 754-2', 'D 54 x 2', 'make', bend=d_r)
    m.place(j1, d1, Location(), (0, 60, 0), 'VAC')
    # ══════════════════════════════════════════ THE LINES BESIDE THE DUCTS ═══
    # (2026-11-15: the schedule listed the arm cable and the air tube in each link as "not drawn", straight from union to
    # union and a quarter more.) Each union brings its turning side out at its rotor's foot through an outlet collar: a
    # connector for the arm cable and a push-in port for the air tube. Each line runs along its link to the next union's
    # body, whose fixed side takes it the same 2 ways. In link 1 they lie under the top cover, over the duct and the J2
    # gearmotor. In link 2 they leave the link through 2 glands in its cover, either side of the duct, and rise beside it
    # to 2 bosses on the J3 union. ASSUMPTION: the union maker brings the turning side out at the rotor's foot (the collar
    # is drawn here; its leads and its air passage are the union's).
    SOC_H, SOC_X = 24.0, 50.0                            # the collar's height, and its outlet face off the axis
    soc = (cq.Workplane('XZ', origin=(0, SOC_H / 2, 0)).circle(34.0).extrude(SOC_H)
           .union(cq.Workplane('XY').box(SOC_X - 20.0, SOC_H, 44.0).translate(((SOC_X + 20.0) / 2, 0, 0)))
           .cut(cq.Workplane('XZ', origin=(0, SOC_H / 2 + 1, 0)).circle(25.05).extrude(SOC_H + 2)))
    soc_pd = m.part(PartDef('CLN-SOC', 'Union outlet collar, turning side', soc.val(), 'steel_paint', 'electrical', 'catalogue part',
                            'bore 50, 24 high', 'IP65', None,
                            'Clamps a union\'s rotor at its foot and brings out its turning side: a connector for the arm cable and a '
                            'port for the air tube.',
                            {'ASSUMPTION': 'the union maker brings its slip ring\'s leads and its air passage out at the rotor\'s foot'}, 'buy'))
    scn = cq.Workplane('YZ').circle(9.5).extrude(8.0).union(cq.Workplane('YZ', origin=(8.0, 0, 0)).circle(8.5).extrude(22.0))
    scn_pd = m.part(PartDef('CLN-SCN', 'Circular connector M16, receptacle and plug, IP67', scn.val(), 'pa66', 'electrical',
                            'catalogue part', 'M16, 30 long mated', 'IP67', None,
                            'Joins the arm cable to a union\'s slip ring. The receptacle is the union\'s; the plug is on the cable.',
                            {'mated': 'receptacle 8 mm, plug and its cable clamp 22 mm'}, 'buy'))
    spf = (cq.Workplane('YZ').polygon(6, 13.0 / math.cos(math.pi / 6)).extrude(6.0)
           .union(cq.Workplane('YZ', origin=(6.0, 0, 0)).circle(5.5).extrude(10.0))
           .cut(cq.Workplane('YZ', origin=(4.0, 0, 0)).circle(3.05).extrude(13.0)))
    spf_pd = m.part(PartDef('CLN-SPF', 'Push-in fitting 6 mm, G 1/8, straight', spf.val(), 'ss316', 'fluid', 'ISO 14743', 'G 1/8, 6 mm',
                            '', None, 'Takes the air tube at a union\'s air port.', {'tube': '6 mm, pushed 12 mm in'}, 'buy'))
    y_c1 = Y_R1 + 2 + SOC_H / 2                          # the J1 collar's middle: 2 mm over the rotor's foot
    m.place(j1, soc_pd, loc(0, y_c1, 0), (0, 40, 0), 'LINK1').yard_hidden = True
    m.place(j1, scn_pd, loc(SOC_X, y_c1, -10), (0, 40, 0), 'LINK1').yard_hidden = True
    m.place(j1, spf_pd, loc(SOC_X, y_c1, 12), (0, 40, 0), 'VAC').yard_hidden = True

    # ═══════════════════════════════════════════════════════ J2 + link 2 ═══
    j2 = j1.child('CA_J2', loc(L1, 0, 0), sub='J2',
                  joint={'name': 'CA_J2', 'axis': [0, 1, 0], 'limits': A['limits']['j2'], 'kind': 'revolute', 'stowed': -home['t2']})
    jr = A['j2']['r'] * M
    # the twin's J2 drum (r 130, h 360): an upper cover on link 1 and a lower one on link 2, round the bearing and the gears
    up_cov = (cq.Workplane('XZ', origin=(0, -h1 / 2, 0)).circle(jr).circle(jr - 4).extrude(-h1 / 2 - (-drop + h2 / 2 + 24)))
    m.place(j1, m.part(PartDef('CLN-J2C', 'J2 drum cover, upper', up_cov.val(), 'a356_dark', 'structure', 'casting',
                               f'OD {2 * jr:.0f}', '', None, 'Closes the J2 bearing and gears between the links.', {}, 'make')),
            loc(L1, 0, 0), (0, -60, 0), 'J2')
    m.place(j1, std.cross_roller(100, 150, 13, 'Carries link 2 under link 1.'), loc(L1, -h1 / 2 - 6.5, 0), (0, -80, 0), 'J2')
    y_l2t = -drop + h2 / 2                               # link 2's top face (j1/j2 frame)
    hub2 = (cq.Workplane('XZ', origin=(0, y_l2t + 5, 0)).circle(70).circle(31).extrude(5)
            .union(cq.Workplane('XZ', origin=(0, -h1 / 2 - 1, 0)).circle(50).circle(31).extrude(-h1 / 2 - 1 - (y_l2t + 5))))
    m.place(j2, m.part(PartDef('CLN-J2H', 'J2 hub', hub2.val(), 'steel', 'structure', 'machined', 'OD 140 flange, 100 tube', 'C45', None,
                               'Joins link 2 to the bearing inner ring and carries the ring gear. The union\'s rotor passes inside it.',
                               {}, 'make')), Location(), (0, -120, 0), 'J2')
    for p in std.circle_points(6, 60, 'y', offset=y_l2t + 5):
        m.place(j2, std.shcs(6, 16, '12.9', 'Holds the J2 hub to link 2.'), std.orient(p, (0, -1, 0)), (0, -140, 0), 'J2')
    rg2_y0 = y_l2t + 12                                  # 1 mm over the hub screws' heads, 9 mm under the bearing
    rgear2 = cq.Workplane('XZ', origin=(0, rg2_y0 + 16, 0)).circle(RG2).circle(50).extrude(16)
    m.place(j2, m.part(PartDef('CLN-RCK2', 'J2 ring gear, module 2, 94 teeth (drawn at its pitch circle)', rgear2.val(), 'steel', 'drive',
                               'ISO 1328 class 7', 'pitch D 188', 'C45, induction hardened', None,
                               'Turns link 2. The pinion on the gearmotor in link 1 drives it.', {}, 'buy')),
            Location(), (0, -100, 0), 'J2')
    pin2 = (cq.Workplane('XZ', origin=(0, 16, 0)).circle(PN2).extrude(16)
            .union(cq.Workplane('XZ', origin=(0, -50 - rg2_y0, 0)).circle(8).extrude(-50 - rg2_y0 - 16)))
    m.place(j1, m.part(PartDef('CLN-PIN2', 'J2 pinion and shaft, module 2, 14 teeth', pin2.val(), 'steel', 'drive', 'ISO 1328 class 7',
                               'pitch D 28', 'C45, induction hardened', None, 'Drives the J2 ring gear from the gearmotor in link 1.', {}, 'make')),
            loc(XP2, rg2_y0, ZP2), (0, -100, -60), 'J2')
    gm2 = (cq.Workplane('XY').box(60, 60, 60).translate((0, 30, 0))
           .union(cq.Workplane('YZ', origin=(-30, 30, 0)).circle(28).extrude(-120)))
    m.place(j1, m.part(PartDef('CLN-SGM2', 'J2 servo gearmotor, 400 W, right-angle, brake', gm2.val(), 'a356_dark', 'drive', 'catalogue part',
                               '60 square head', '', None, 'Turns J2 through the pinion from inside link 1. Its brake holds the fold.',
                               {'power': '400 W', 'gearhead': '30:1 right-angle', 'overall': 'about 200:1 to J2'}, 'buy', mass_override=4.0)),
            loc(XP2, -50, ZP2), (-120, 160, 0), 'J2')
    # the J2 union: its body in link 1's tip, the duct into its side, its rotor down the hub into link 2
    swv2 = (cq.Workplane('XZ', origin=(0, 50, 0)).circle(54).extrude(100)
            .union(cq.Workplane('YZ', origin=(-40, 0, 40)).circle(27).extrude(-35))
            .union(cq.Workplane('XZ', origin=(0, -50, 0)).circle(25).extrude(-50 - (-drop + 30))))      # to the duct's start
    m.place(j1, m.part(PartDef('CLN-SWV2', 'Rotary union with slip ring, J2: DN 50 vacuum, air, 24 circuits', swv2.val(), 'steel_paint',
                               'fluid', 'catalogue part', 'DN 50, G 1/4 air, 24 x 2 A', 'IP65', None,
                               'Passes the vacuum, the air and the signals across J2. Its body sits in link 1\'s tip; its rotor turns '
                               'with link 2.', {'vacuum': 'DN 50, -30 kPa', 'air': '6 bar', 'circuits': '24 x 2 A, EtherCAT pair'}, 'buy',
                               mass_override=6.0)),
            loc(L1, 0, 0), (0, 300, 0), 'VAC')
    # the J2 union's fixed side takes link 1's lines on its body's -X face, beside the duct's port: a fitting's face where
    # it first meets the round body
    def body_face(xc: float, R: float, zc: float, half: float) -> float:
        return xc - math.sqrt(R * R - max(0.0, abs(zc) - half) ** 2)
    x_c2, x_a2 = body_face(L1, 54.0, -10.0, 9.5), body_face(L1, 54.0, 12.0, 6.5)
    m.place(j1, scn_pd, loc(x_c2, 30.0, -10, ry=180), (0, 40, 0), 'LINK1').yard_hidden = True
    m.place(j1, spf_pd, loc(x_a2, 30.0, 12, ry=180), (0, 40, 0), 'VAC').yard_hidden = True
    ac1 = std.swept('CLN-AC1', 'Arm cable in link 1: power and network, 10 mm',
                    [(SOC_X + 30, y_c1, -10), (780.0, y_c1, -10), (840.0, 30.0, -10), (x_c2 - 30, 30.0, -10)], 5.0, 'cable', 'electrical',
                    0.0, 'Carries power and the network along link 1, from the J1 union\'s turning side to the J2 union\'s fixed side. '
                    'It lies under the top cover, over the duct and the J2 gearmotor, and does not move.',
                    {'bend': f'R {CAB_BEND:.0f} (4 x D)'}, 'EN 50525', 'OD 10', 'buy', bend=CAB_BEND)
    at1 = std.swept('CLN-AT1', 'Air tube 6 x 4 in link 1', [(SOC_X + 4, y_c1, 12), (790.0, y_c1, 12), (850.0, 30.0, 12), (x_a2 - 4, 30.0, 12)],
                    3.0, 'pu', 'fluid', 2.0, 'Carries the air along link 1, from the J1 union\'s turning side to the J2 union\'s fixed side.',
                    {'tube': '6 x 4 polyurethane', 'bend': f'R {AIR_BEND_R:.0f}'}, 'ISO 14743', 'D 6', 'buy', bend=AIR_BEND_R)
    m.place(j1, ac1, Location(), (0, 60, 0), 'LINK1').yard_hidden = True
    m.place(j1, at1, Location(), (0, 60, 0), 'VAC').yard_hidden = True
    link2 = _box_link(L2, A['link2']['w'] * M, h2, 5, 56, 270, bosses=(False, True))
    m.place(j2, m.part(PartDef('CLN-L2', 'Link 2 weldment', link2, 'al6061', 'structure', 'EN 1090-3, machined after welding',
                               f'{L2:.0f} between axes, 140 x 130', '6061-T6', None,
                               'Carries the mast 0.80 m from J2. The duct and cables run inside.', {'wall': '5 mm'}, 'make')),
            loc(0, -drop, 0), (0, -80, 0), 'LINK2')
    lo_cov = cq.Workplane('XZ', origin=(0, -drop + h2 / 2, 0)).circle(jr).circle(jr - 4).extrude(-22)
    m.place(j2, m.part(PartDef('CLN-J2L', 'J2 drum cover, lower', lo_cov.val(), 'a356_dark', 'structure', 'casting',
                               f'OD {2 * jr:.0f}', '', None, 'Turns with link 2 under the upper cover. A labyrinth between them sheds water.',
                               {}, 'make')), Location(), (0, -90, 0), 'J2')
    c2a, c2b = jr + 5, L2 - 145
    x_d2 = L2 - 180                                      # where the duct leaves link 2, up to the J3 union
    x_g, z_g = x_d2 - 20, 42.0                           # the arm cable's and the air tube's glands, either side of the duct
    cw2 = A['link2']['w'] * M - 4                        # 4 mm narrower than the link: its screws grip the rim (see link 1's cover)
    cover2 = (cq.Workplane('XY').box(c2b - c2a, 3, cw2).translate(((c2a + c2b) / 2, -drop + h2 / 2 + 1.5, 0))
              .cut(cq.Workplane('XZ', origin=(x_d2, -drop + h2 / 2 + 5, 0)).circle(29).extrude(10))
              .cut(cq.Workplane('XZ', origin=(x_g, -drop + h2 / 2 + 5, -z_g)).circle(10.2).extrude(10))     # M20 gland, the cable
              .cut(cq.Workplane('XZ', origin=(x_g, -drop + h2 / 2 + 5, z_g)).circle(8.2).extrude(10)))       # M16 gland, the tube
    m.place(j2, m.part(PartDef('CLN-L2C', 'Link 2 top cover', cover2.val(), 'al6061_blk', 'structure', 'sheet 3 mm', f'{c2b - c2a:.0f} x {cw2:.0f}',
                               '', None, 'Closes link 2. Off for service. The duct leaves through it to the J3 union, and the arm cable and the air '
                               'tube through 2 glands beside it.', {}, 'make')),
            Location(), (0, 70, 0), 'LINK2')
    for i in range(5):
        for zz in (-61.5, 61.5):
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
    B3_X, y_b3 = 58.0, y_xb + 8 + 33                     # its 2 bosses: their faces 58 mm off the axis, 33 mm over its foot
    swv = (cq.Workplane('XZ', origin=(0, y_xb + 8 + 120, 0)).circle(60).extrude(120)
           .union(cq.Workplane('YZ', origin=(-60, y_xb + 8 + 60, 0)).circle(27).extrude(-70))
           .union(cq.Workplane('XY').box(36.0, 24.0, 24.0).translate((-B3_X + 18.0, y_b3, z_g)))
           .union(cq.Workplane('XY').box(36.0, 24.0, 24.0).translate((-B3_X + 18.0, y_b3, -z_g)))
           .union(cq.Workplane('XZ', origin=(0, y_xb + 8, 0)).circle(25).extrude(y_xb + 8 - (yl2 + oA + 12))))
    m.place(j2, m.part(PartDef('CLN-SWV', 'Rotary union with slip ring, J3: DN 50 vacuum, air, 12 circuits', swv.val(), 'steel_paint', 'fluid',
                               'catalogue part', 'DN 50, G 1/4 air, 12 x 2 A', 'IP65', None,
                               'Passes the vacuum and the signals across J3, which turns 462 degrees in a cycle. Its rotor turns '
                               'with the mast; the mast is the vacuum duct down to the wrist.',
                               {'vacuum': 'DN 50, -30 kPa', 'air': '6 bar', 'circuits': '12 x 2 A, EtherCAT pair'}, 'buy', mass_override=6.5)),
            loc(L2, 0, 0), (0, 400, 0), 'J3')
    # the duct from link 2 up into the J3 union's side port (the J2 rotor's outlet is in link 2, at the J2 axis)
    y_port = y_xb + 8 + 60
    d2 = std.swept('CLN-L2D', 'Vacuum duct in link 2, 54 x 2', [(0, -drop + 30, 0), (0, -drop - 12, 0), (x_d2, -drop - 12, 0),
                   (x_d2, y_port, 0), (L2 - 130, y_port, 0)], 27, 'al6061', 'fluid', 25,
                   'Carries the vacuum along link 2 from J2 and up into the J3 union.', {'bends': 'mandrel, centreline R 36'},
                   'EN 754-2', 'D 54 x 2', 'make', bend=36.0)
    m.place(j2, d2, Location(), (0, 60, 0), 'VAC')
    # the J2 union's outlet collar in link 2 (its rotor's foot is 30 mm inside the link), and link 2's lines: out through
    # the cover's 2 glands and up beside the duct to the J3 union's bosses
    y_c2 = -drop + 30 + 2 + SOC_H / 2                    # 2 mm over the rotor's foot
    m.place(j2, soc_pd, loc(0, y_c2, 0), (0, 40, 0), 'LINK2').yard_hidden = True
    m.place(j2, scn_pd, loc(SOC_X, y_c2, -10), (0, 40, 0), 'LINK2').yard_hidden = True
    m.place(j2, spf_pd, loc(SOC_X, y_c2, 12), (0, 40, 0), 'VAC').yard_hidden = True
    y_cv = -drop + h2 / 2 + 3                            # the cover's top face
    m.place(j2, std.gland(20, 'Holds the arm cable where it leaves link 2, and seals the cover.'),
            std.orient((x_g, y_cv, -z_g), (0, -1, 0)), (0, 90, 0), 'LINK2')
    m.place(j2, std.gland(16, 'Holds the air tube where it leaves link 2, and seals the cover.'),
            std.orient((x_g, y_cv, z_g), (0, -1, 0)), (0, 90, 0), 'VAC')
    # on the J3 union's bosses, in the open: their own ids, as the yard draws them and not the ones closed in the links
    m.place(j2, m.part(PartDef('CLN-SCN3', 'Circular connector M16, receptacle and plug, IP67, on the J3 union', scn.val(), 'pa66', 'electrical',
                               'catalogue part', 'M16, 30 long mated', 'IP67', None,
                               'Joins the arm cable to the J3 union\'s slip ring, on its boss. The receptacle is the union\'s; the plug is on the cable.',
                               {'mated': 'receptacle 8 mm, plug and its cable clamp 22 mm'}, 'buy')),
            loc(L2 - B3_X, y_b3, -z_g, ry=180), (0, 400, 0), 'LINK2')
    m.place(j2, m.part(PartDef('CLN-SPF3', 'Push-in fitting 6 mm, G 1/8, straight, on the J3 union', spf.val(), 'ss316', 'fluid', 'ISO 14743',
                               'G 1/8, 6 mm', '', None, 'Takes the air tube at the J3 union\'s air port, on its boss.', {'tube': '6 mm, pushed 12 mm in'}, 'buy')),
            loc(L2 - B3_X, y_b3, z_g, ry=180), (0, 400, 0), 'VAC')
    y_l2r = -drop + 15                                   # their run along link 2: beside the duct, 15 mm over its middle
    ac2 = std.swept('CLN-AC2', 'Arm cable in link 2: power and network, 10 mm',
                    [(SOC_X + 30, y_c2, -10), (140.0, y_c2, -10), (260.0, y_l2r, -z_g), (x_g, y_l2r, -z_g), (x_g, y_b3, -z_g),
                     (L2 - B3_X - 30, y_b3, -z_g)], 5.0, 'cable', 'electrical', 0.0,
                    'Carries power and the network along link 2, from the J2 union\'s turning side out through its gland and up '
                    'beside the duct to the J3 union\'s fixed side. It does not move.',
                    {'bend': f'R {CAB_BEND:.0f} (4 x D)'}, 'EN 50525', 'OD 10', 'buy', bend=CAB_BEND)
    at2 = std.swept('CLN-AT2', 'Air tube 6 x 4 in link 2',
                    [(SOC_X + 4, y_c2, 12), (120.0, y_c2, 12), (250.0, y_l2r, z_g), (x_g, y_l2r, z_g), (x_g, y_b3, z_g),
                     (L2 - B3_X - 4, y_b3, z_g)], 3.0, 'pu', 'fluid', 2.0,
                    'Carries the air along link 2, from the J2 union\'s turning side out through its gland and up beside the duct to '
                    'the J3 union\'s fixed side.', {'tube': '6 x 4 polyurethane', 'bend': f'R {AIR_BEND_R:.0f}'}, 'ISO 14743', 'D 6', 'buy',
                    bend=AIR_BEND_R)
    m.place(j2, ac2, Location(), (0, 60, 0), 'LINK2')
    m.place(j2, at2, Location(), (0, 60, 0), 'VAC')

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
    # J4 pitches the wand about Z at the pivot, pbf under the inner stage's foot. The twin holds the pivot 0.20 m off the
    # car in every working pose, and every part but the wand must keep 0.10 m off the car and the open doors: so the
    # wrist lives in about +/-95 mm along the pitch axis, 55 mm in front of the pivot and 95 mm behind it, for the
    # whole cycle (design finding 9: a size 20 actuator ON the axis stood 0.25 m out along it, and at an oblique reach
    # it went 47 mm into the car's outline and 19 mm from an open door). So the drive splits: a size 17 strain-wave gear
    # unit sits in the fork's -Z cheek on the axis, and its servo motor stands behind the hub, parallel to the axis,
    # driving the unit's input by a 2:1 toothed belt. The vacuum crosses the joint on its axis on the +Z side: the hub's
    # hollow stub, a swivel on that cheek, and a duct up into a passage through the fork to the mast, which is the duct.
    yp = -oB - pbf                                 # the pitch pivot (MAST3 frame)
    hub_w, hub_od = 76.0, 2 * A['wrist']['r'] * M  # the hub: just wider than the wand's 68 mm base tube
    c_in, c_t = hub_w / 2 + 10, 12.0               # each cheek's inner face from the pivot, and its thickness
    c_out = c_in + c_t
    yb0 = -oB - 30                                 # the fork's top block: its underside (70 mm over the pivot)
    mx_, my_ = -75.0, yp + 45.0                    # the J4 motor's axis: behind and over the hub, 2.5 mm off it
    z_d = 76.5                                     # the vacuum duct's axis (+Z), from the pivot
    r_d = 18.0                                     # the duct: 36 x 3

    def cheek(z0: float, z1: float, back: bool) -> cq.Workplane:
        """A fork cheek between z0 and z1: round under the pivot, up to the top block; the -Z one runs back to carry
        the motor."""
        c = (cq.Workplane('XY').circle(50).extrude(z1 - z0).translate((0, yp, z0))
             .union(cq.Workplane('XY').box(100, yb0 - yp + 1, z1 - z0, centered=(True, False, False)).translate((0, yp, z0))))
        if back:
            c = c.union(cq.Workplane('XY').box(97, yb0 - (my_ - 24) + 1, z1 - z0, centered=(False, False, False))
                        .translate((-97, my_ - 24, z0)))
        return c

    fork = (cq.Workplane('XY').box(s2 + 20, 30, s2 + 20).translate((0, -oB - 15, 0))
            .union(cq.Workplane('XY').box(2 * (r_d + 4), 30, z_d + r_d + 2 - (s2 + 20) / 2 + 1, centered=(True, True, False))
                   .translate((0, -oB - 15, (s2 + 20) / 2 - 1)))                            # the duct's boss, +Z
            .union(cheek(-c_out, -c_in, True))
            .union(cheek(c_in, c_out, False)))
    fork = (fork.cut(cq.Workplane('XY').circle(37).extrude(c_t + 2).translate((0, yp, -c_out - 1)))   # the gear unit's bore
            .cut(cq.Workplane('XY').circle(21).extrude(c_t + 2).translate((mx_, my_, -c_out - 1)))    # the motor's
            .cut(cq.Workplane('XY').circle(36).extrude(c_t + 2).translate((0, yp, c_in - 1)))         # the stub bearing's seat
            .cut(cq.Workplane('XZ', origin=(0, yb0 + 1, z_d)).circle(r_d + 0.5).extrude(yb0 + 1 - (yp + 38)))   # the duct past the cheek
            # the vacuum passage: up out of the duct, along -Z over the block's middle, and up into the inner stage
            .cut(cq.Workplane('XZ', origin=(0, yb0 + 18, z_d)).circle(r_d - 3).extrude(19))
            .cut(cq.Workplane('XY').box(2 * (r_d - 3), 2 * (r_d - 3), z_d, centered=(True, True, False)).translate((0, yb0 + 18, 0)))
            .cut(cq.Workplane('XZ', origin=(0, -oB + 1, 0)).circle(r_d - 3).extrude(13))
            .cut(cq.Workplane('XY').circle(5).extrude(c_t + 2).translate((-46, yp + 30, c_in - 1))))      # the clock spring's lead
    m.place(mast3, m.part(PartDef('CLN-FRK', 'Wrist fork', fork.val(), 'al6061', 'structure', 'machined from billet',
                                  f'{2 * c_out:.0f} wide', '6061-T6', None,
                                  'Hangs from the inner stage foot. Its cheeks carry the J4 gear unit and motor on one side and the '
                                  'stub bearing and the swivel on the other; the vacuum passes through it into the mast.',
                                  {}, 'make')), Location(), (0, -40, 0), 'WRIST')
    for p in ((-46, -25), (46, -25), (-46, 25), (46, 25)):          # up into the inner stage's walls, clear of the hub
        m.place(mast3, std.shcs(6, 45, '12.9', 'Holds the wrist fork to the inner stage foot.'),
                std.orient((p[0], -oB - 30, p[1]), (0, 1, 0)), (0, -80, 0), 'WRIST')
    pitch = mast3.child('CA_Pitch', loc(0, yp, 0), sub='WRIST',
                        joint={'name': 'CA_Pitch', 'axis': [0, 0, 1], 'limits': A['limits']['pitch'], 'kind': 'revolute',
                               'stowed': home['pitch']})
    # the hub: the wand's bore (blind), tube 1's socket, the passage to the stub, the stub through the +Z cheek
    stub_end = c_out + 3 + 20                      # the stub ends inside the swivel, short of its closed end
    hubp = (cq.Workplane('XY').circle(hub_od / 2).extrude(hub_w).translate((0, 0, -hub_w / 2))
            .cut(cq.Workplane('YZ', origin=(-22, 0, 0)).circle(wr2 + 1.5).extrude(hub_od))          # the wand bore, blind
            .cut(cq.Workplane('YZ', origin=(hub_od / 2 - 4, 0, 0)).circle(wr).extrude(10))       # tube 1's socket
            .union(cq.Workplane('XY').circle(25).circle(20).extrude(stub_end - hub_w / 2).translate((0, 0, hub_w / 2)))
            .cut(cq.Workplane('XY').circle(20).extrude(hub_w / 2 + 1)))                           # the passage to the stub
    m.place(pitch, m.part(PartDef('CLN-HUB', 'Wrist hub', hubp.val(), 'al6061', 'structure', 'machined', f'OD {hub_od:.0f} x {hub_w:.0f}',
                                  '7075-T6', None, 'Turns on J4 and carries the wand. The air leaves through its hollow stub.', {}, 'make')),
            Location(), (0, 0, 40), 'WRIST')
    # J4: the gear unit's output flange on the hub's -Z face; its housing through the -Z cheek, flanged on its face
    out = cq.Workplane('XY').circle(50).circle(12).extrude(5).translate((0, 0, -hub_w / 2 - 5))
    m.place(pitch, m.part(PartDef('CLN-J4-GO', 'J4 gear unit output flange', out.val(), 'steel', 'drive', 'catalogue part', 'OD 100 x 5',
                                  '', None, 'The gear unit\'s turning flange: it carries the hub.', {}, 'buy')),
            Location(), (0, 0, -60), 'WRIST')
    for k in range(6):
        a_ = math.radians(30 + 60 * k)
        m.place(pitch, std.shcs(4, 12, '12.9', 'Holds the hub to the J4 gear unit\'s output flange.'),
                std.orient((44 * math.cos(a_), 44 * math.sin(a_), -hub_w / 2 - 5), (0, 0, 1)), (0, 0, -80), 'WRIST')
    gu = (cq.Workplane('XY').circle(36).extrude(76 - (hub_w / 2 + 6)).translate((0, yp, -76))
          .union(cq.Workplane('XY').circle(45).extrude(6).translate((0, yp, -c_out - 6)))
          .union(cq.Workplane('XY').circle(8).extrude(22).translate((0, yp, -98))))          # the input shaft, through the pulley
    m.place(mast3, m.part(PartDef('CLN-J4-GU', 'J4 strain-wave gear unit, size 17, 100:1, with output bearing', gu.val(), 'steel_paint',
                                  'drive', 'catalogue part', 'OD 72 x 38', 'unit type, hollow output', None,
                                  'Turns the hub 100 times slower than its input pulley. Its cross-roller bearing carries the wand.',
                                  {'ratio': '100:1', 'size': '17'}, 'buy', mass_override=0.9)), Location(), (0, 0, -120), 'WRIST')
    for k in range(6):
        a_ = math.radians(60 * k)
        m.place(mast3, std.shcs(4, 12, '12.9', 'Holds the J4 gear unit\'s housing flange to the fork cheek.'),
                std.orient((41 * math.cos(a_), yp + 41 * math.sin(a_), -c_out - 6), (0, 0, 1)), (0, 0, -140), 'WRIST')
    # the motor: a 40 mm frame servo with brake and encoder, flanged on the -Z cheek's face, its body behind the hub
    mot_l = 100.0
    motor = (cq.Workplane('XY').rect(40, 40).extrude(6).edges('|Z').fillet(4).translate((mx_, my_, -c_out - 6))
             .union(cq.Workplane('XY').circle(20).extrude(mot_l).translate((mx_, my_, -c_out)))
             .union(cq.Workplane('XY').circle(4).extrude(98 - c_out - 6).translate((mx_, my_, -98))))
    m.place(mast3, m.part(PartDef('CLN-J4-MOT', 'J4 servo motor 200 W, 40 mm frame, brake and encoder', motor.val(), 'steel_paint', 'drive',
                                  'catalogue part', '40 x 40 x 106', 'IP65', None,
                                  'Drives the J4 gear unit by the belt. Its brake holds the wand with power off.',
                                  {'class': '200 W, 0.64 N m continuous, 48 V DC'}, 'buy', mass_override=0.8)), Location(), (-120, 60, -60), 'WRIST')
    for (dx, dy) in ((-15, -15), (15, -15), (-15, 15), (15, 15)):
        m.place(mast3, std.shcs(4, 12, '12.9', 'Holds the J4 motor flange to the fork cheek.'),
                std.orient((mx_ + dx, my_ + dy, -c_out - 6), (0, 0, 1)), (-120, 60, -90), 'WRIST')
    # the belt: 2:1 from the motor's 20T pulley to the unit's 40T input pulley, in the plane 87 mm out
    zb = -87.0
    T_belt = loc(0, yp, zb) * Location(Vector(0, 0, 0), Vector(0, 0, 1), math.degrees(math.atan2(my_ - yp, mx_))) \
        * Location(Vector(0, 0, 0), Vector(1, 0, 0), 90)
    m.place(mast3, std.pulley(40, 3, 9, 16), loc(0, yp, zb, rx=90), (0, 0, -160), 'WRIST')
    m.place(mast3, std.pulley(20, 3, 9, 8), loc(mx_, my_, zb, rx=90), (-120, 60, -160), 'WRIST')
    m.place(mast3, std.belt(3, 9, math.hypot(mx_, my_ - yp), 40 * 3 / math.pi, 20 * 3 / math.pi,
                            'Drives the J4 gear unit from its motor, 2:1.'), T_belt, (-60, 30, -180), 'WRIST')
    # the stub bearing in the +Z cheek, and the ring that holds the stub in it
    m.place(mast3, std.ball_bearing('61910', 'Supports the hub\'s hollow stub in the fork\'s +Z cheek.'),
            loc(0, yp, c_in + 6, rx=90), (0, 0, 90), 'WRIST')
    s_cl = 1.75
    m.place(pitch, std.circlip(50, False), std.orient((0, 0, c_out + 1 + s_cl), (0, 0, 1)), (0, 0, 110), 'WRIST')
    # the wrist swivel: on a spigot ring against the +Z cheek, round the stub, its port up into the duct
    z0s, z1s = c_out + 3, c_out + 26
    swv = (cq.Workplane('XY').circle(36).extrude(z1s - z0s).translate((0, yp, z0s))
           .union(cq.Workplane('XY').circle(36).circle(32).extrude(3).translate((0, yp, c_out)))             # the spigot ring
           .union(cq.Workplane('XY').box(40, 38, z1s - z0s, centered=(True, False, False)).translate((0, yp, z0s)))   # the port boss
           .cut(cq.Workplane('XY').circle(25.5).extrude(z1s - z0s - 3).translate((0, yp, z0s)))            # the bore, blind
           .cut(cq.Workplane('XZ', origin=(0, yp + 39, z_d)).circle(r_d - 3).extrude(39))                   # the port, up
           .union(cq.Workplane('XY').box(10, 12, 12).translate((-35, yp, z0s + 11.5))))                      # the air port, behind
    for a_ in (45, 135, 225, 315):
        swv = swv.cut(cq.Workplane('XY').circle(2.75).extrude(z1s - c_out + 1)
                      .translate((30 * math.cos(math.radians(a_)), yp + 30 * math.sin(math.radians(a_)), c_out - 0.5)))
    m.place(mast3, m.part(PartDef('CLN-WSW', 'Wrist rotary union: 50 mm vacuum, 1 air passage', swv.val(), 'al6061', 'fluid', 'machined',
                                  'OD 72 x 26', 'lip-sealed', None,
                                  'Lets the hub\'s stub turn while the vacuum flows through it to the duct. The air crosses in a groove '
                                  'between 2 lip seals and a channel drilled along the stub\'s wall.',
                                  {'air': '6 bar, 3 mm channel'}, 'make')), Location(), (0, 0, 140), 'VAC')
    for a_ in (45, 135, 225, 315):
        m.place(mast3, std.shcs(5, 30, 'A2-70', 'Holds the wrist swivel to the fork cheek.'),
                std.orient((30 * math.cos(math.radians(a_)), yp + 30 * math.sin(math.radians(a_)), z1s), (0, 0, -1)),
                (0, 0, 170), 'VAC')
    duct = cq.Workplane('XZ', origin=(0, yb0, z_d)).circle(r_d).circle(r_d - 3).extrude(yb0 - (yp + 38))
    m.place(mast3, m.part(PartDef('CLN-WDU', 'Wrist vacuum duct, 36 x 3', duct.val(), 'al6061', 'fluid', 'drawn tube',
                                  f'{yb0 - yp - 38:.0f} long', '6063-T6', None,
                                  'Joins the swivel to the fork\'s passage up into the mast. Bonded at both ends.', {}, 'make')),
            Location(), (0, 0, 160), 'VAC')

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
    # the air fitting's boss (2026-11-15): the fitting stands 36 mm over the wand's axis, 18.4 mm past the pivot, where the
    # knuckle's round top is only 30.9 mm up, so it stood 3 to 7 mm in the air, held by its own hose. A cast boss carries it.
    knuckle = knuckle.union(cq.Workplane('XZ', origin=(18.4, 36.0, 0)).circle(5.0).extrude(36.0 - 24.0))
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
    for zz in (-50, -22, 50):                           # the air line enters the knife at its middle
        m.place(noz, std.shcs(3, 10, 'A2-70', 'Holds the air knife to the head.'), std.orient((xk, yk + 8, zz), (0, -1, 0)),
                (90, 80, 0), 'NOZZLE')

    # ═══════════════════════════════════════════════ CABLES AND AIR, MAST TO NOZZLE ═══
    # From the J3 union's rotor at the mast top: a cable and a 6 mm air line clipped down the outer stage, a coil of both down
    # the moving stages to the wrist fork, a loop across J4 to the wand drive, a reel cable along the wand to the knuckle,
    # and a short air loop across J5 to the air knife. The hybrid cable is 10 mm; its moving bend radius is 7 x 10 mm.
    # A spring reel on the outer stage's back (-X, away from the car; the drive and strip are on +X) pays the cable and the
    # air line straight down, 12 mm off the stage, to a clamp on the back of the wrist fork. (A coil from the mast top
    # could only end at the fork, where the stages are flush when the mast is in, and there it stood beyond the wrist's
    # 0.10 m from the car and the doors: 79 mm from the car on the -Z side, 80 mm from an open door on the -X side. The
    # reel's line keeps inside the wrist's outline. Design finding 12.)
    x_ml, y_rl = -92.0, -300.0                           # the line: 12 mm off the outer stage's -X face; the reel's axle
    x_dr = x_ml - 96                                     # the drum's axle: its rim tangent to the line
    # The union's turning-side leads leave the mast top through an outlet on the collar's -X wall (the collar's socket
    # wraps the mast's top 30 mm; its flange stands on it), and the line starts at the outlet's underside, level with the
    # collar's foot (2026-11-15: the line began 6 mm under the collar's foot with nothing at its end, 28 mm from any part,
    # and a scan of every drawn line's ends found it)
    s_col = (s0 + 16) / 2                                # the collar's outer face
    mob = cq.Workplane('XY').box(12.0, 20.0, 32.0).edges('|Y').fillet(2.0).translate((-s_col - 6.0, oA - 20.0, 0))
    m.place(j3, m.part(PartDef('CLN-MOB', 'Collar cable outlet, glass-filled PA66, with a grommet', mob.val(), 'pa66', 'electrical',
                               'moulded', '12 x 20 x 32', 'IP65', None,
                               'Takes the hybrid cable and the air line out of the mast top, from the J3 union\'s turning side, down the outer stage.',
                               {}, 'make')), Location(), (-80, 0, 0), 'VAC')
    feed = std.swept('CLN-MFR', 'Hybrid cable and air line, J3 union to the mast reel', [(x_ml, oA - 30, 0), (x_ml, -130, 0), (x_dr, -130, 0),
                     (x_dr, y_rl + 90, 0)], 6, 'cable', 'electrical', 0,
                     'Brings the signals, power and air from the J3 union down the outer mast stage to the reel.', {}, 'EN 50525', 'OD 12',
                     'buy', bend=25.0)
    m.place(j3, feed, Location(), (0, 0, -120), 'VAC')
    mcr = (cq.Workplane('XY', origin=(x_dr, y_rl, -30)).circle(90).extrude(60)
           .union(cq.Workplane('XY', origin=(x_dr, y_rl, -32)).circle(25).extrude(64)))                # the drum and its hub
    m.place(j3, m.part(PartDef('CLN-MCR', 'Spring reel for a hybrid cable and an air line, 3 m', mcr.val(), 'steel_paint', 'electrical',
                               'catalogue part', 'D 180', 'IP65', None,
                               'Pays out and takes back the wrist\'s cable and air line as the mast goes down and up.',
                               {'cable': 'hybrid 10 mm + air 6 mm, 3 m', 'hub': 'slip ring and air swivel'}, 'buy', mass_override=7.0)),
            Location(), (-160, 0, 0), 'VAC')
    mrb = (cq.Workplane('XY').box(-80 - x_dr, 40, 6).translate(((x_dr - 80) / 2, y_rl, -35))
           .union(cq.Workplane('XY').box(6, 80, 76).translate((-83, y_rl, 0))))
    m.place(j3, m.part(PartDef('CLN-MRB', 'Mast reel bracket, aluminium', mrb.val(), 'al6061', 'structure', 'machined', '102 x 80',
                               '6061-T6', None, 'Holds the reel on the outer mast stage.', {}, 'make')), Location(), (-140, 0, 0), 'VAC')
    m.flex(FlexDef('CLN-MCB', 'Hybrid cable and air line on the mast reel, PUR', 'stretch', Anchor(j3, (x_ml, y_rl, 0), (0, -1, 0)),
                   Anchor(mast3, (x_ml, -950, 0), (0, -1, 0)), 6.0, 'VAC',
                   'Feeds the wrist, the wand and the nozzle down the mast. The reel pays it out as the mast goes down.',
                   style='tube', lmin=0, lmax=2900, kg_per_m=0.3, size='OD 12', standard='EN 50525',
                   spec={'carries': 'hybrid cable 10 mm (power + EtherCAT) and air 6 mm, side by side in a flat jacket'}))
    fcl = cq.Workplane('XY').box(-57.5 - (x_ml - 6), 20, 40).translate(((-57.5 + x_ml - 6) / 2, -960, 0))   # off the top block's back
    m.place(mast3, m.part(PartDef('CLN-MCK', 'Line clamp bracket on the fork', fcl.val(), 'al6061', 'structure', 'machined', '41 x 20 x 40',
                                  '6061-T6', None, 'Holds the reel line\'s lower end on the wrist fork.', {}, 'make')),
            Location(), (0, -60, -80), 'VAC')
    # J4: the power and the network cross in a flat-cable clock spring in the 10 mm between the hub and the +Z cheek (the
    # joint turns 135 degrees, the cassette 1.5 turns either way). Its fixed lead leaves through the cheek and runs up the
    # cheek's face and over the back of the fork's top block to the coil's clamp; the air crosses in the swivel. (A 10 mm hybrid
    # cable looped across J4 bent to 27 mm at best against its 70 mm, and a slip ring has no room: the wrist keeps
    # 0.10 m off the car and doors with 4 to 9 mm to spare. Design finding 12.)
    wcs = cq.Workplane('XY').circle(48).circle(27).extrude(10).translate((0, yp, hub_w / 2))
    m.place(mast3, m.part(PartDef('CLN-WCS', 'Wrist clock-spring cassette, flat cable, 8 circuits + EtherCAT pair', wcs.val(),
                                  'pa66', 'electrical', 'catalogue part', 'OD 96 x 10, bore 54', '', None,
                                  'Carries the wand\'s power and network across J4. Its flat cable winds and unwinds as the wrist turns.',
                                  {'turns': '+/- 1.5', 'circuits': '8 x 2 A at 48 V DC, EtherCAT pair'}, 'buy')),
            Location(), (0, 0, 70), 'WRIST')
    wcn = cq.Workplane('XY').box(12, 16, 12).translate((-46, yp + 30, c_out + 6))
    m.place(mast3, m.part(PartDef('CLN-WCN', 'Clock spring lead connector, M8, right angle', wcn.val(), 'pa66', 'electrical',
                                  'IEC 61076-2-104', 'M8, 8 pole', 'IP67', None, 'Joins the cassette\'s lead to the fixed cable.', {},
                                  'buy')), Location(), (0, 0, 120), 'WRIST')
    wfc = std.swept('CLN-WFC', 'Wrist fixed cable, cassette to the coil clamp', [
        (-46, yp + 38, c_out + 6), (-46, -1000, c_out + 6), (-54, -988, 60), (-64, -980, 44), (-66, -978, 24), (-66, -974, 10)],
        4.0, 'cable', 'electrical', 0.0,
        'Joins the clock spring to the coil cable. It does not move.', {}, 'EN 50525', 'OD 8')
    m.place(mast3, wfc, Location(), (0, 0, 100), 'WRIST')
    wat = std.swept('CLN-WAT', 'Wrist fixed air line, union to the coil clamp', [
        (-40, yp, z0s + 11.5), (-48, yp + 4, z0s + 11), (-57, yp + 20, 74), (-57, -1000, 73), (-64, -988, 64), (-72, -980, 46),
        (-76, -978, 26), (-78, -973, 10)], 3.0, 'hose', 'fluid', 2.0,
        'Joins the union\'s air passage to the coil\'s air line. It does not move.', {}, 'ISO 14743', 'PU 6 x 4')
    m.place(mast3, wat, Location(), (0, 0, 110), 'WRIST')
    # the wand cable's end (2026-11-15): it ran along the wand at 41 mm over its axis and stopped 4.6 mm short of the
    # knuckle, over its top, holding nothing. An entry block on the knuckle now takes it: the cable's end butts on the
    # block's back face, and inside the block the cable turns down into the knuckle to the nozzle drive.
    xe0, xe1 = wb - 20.0, wb - 4.0
    entry = (cq.Workplane('XY').box(xe1 - xe0, 47.0 - 20.0, 14.0, centered=(False, False, True)).translate((xe0, 20.0, 0))
             .edges('|Z and >Y').fillet(2.5)
             .cut(cq.Workplane('XY').add(knuckle.val().moved(Location(Vector(wb, 0, 0))))))
    entry_sol = max(entry.val().Solids(), key=lambda q: q.Volume()) if len(entry.val().Solids()) > 1 else entry.val()
    m.place(tip, m.part(PartDef('CLN-WCE', 'Wand cable entry block, glass-filled PA66', entry_sol, 'pa66', 'electrical', 'moulded',
                                f'{xe1 - xe0:.0f} x 27 x 14', 'IP67', None,
                                'Takes the wand cable\'s end on the knuckle. Inside it the cable turns down into the knuckle to the nozzle drive.',
                                {'seal': 'a grommet on the cable'}, 'make')), Location(), (300, 60, 0), 'NOZZLE')
    m.flex(FlexDef('CLN-WCB', 'Wand cable with air line, on a reel in the drive', 'stretch',
                   Anchor(pitch, (hub_od / 2 + 10 + (wb - k_cl - hub_od / 2 - 40), wr + 16, 0), (1, 0, 0)),
                   Anchor(tip, (wb - 20, 37 + 4, 0), (1, 0, 0)), 4.0, 'WAND',
                   'Feeds the nozzle drive, the light ring and the air knife along the wand. The reel takes up what the wand does not need.',
                   style='tube', lmin=0, lmax=1100, kg_per_m=0.1, size='OD 8'))
    # the nozzle loop, searched over the duty cycle: it leaves the tip up and out, and swings over the joint. A push-in
    # fitting holds each end: on the tip's top (36 mm from the wand's axis) and on the knife's top
    fit = cq.Workplane('XZ').circle(4).extrude(-3)                 # local y 0 .. 3
    fit_pd = m.part(PartDef('CLN-NAF', 'Push-in fitting, 6 mm tube, M5', fit.val(), 'brass', 'fluid', 'ISO 14743', 'M5 x 6 mm', '', None,
                            'Holds the air line\'s end and seals it.', {}, 'buy'))
    m.place(tip, fit_pd, loc(wb + 18.4, 36, 0), (40, 40, 0), 'NOZZLE')
    m.place(noz, fit_pd, loc(xk, yk + 8, 0), (40, 60, 0), 'NOZZLE')
    # each end sits on its fitting's top: lifted by how far its slanted end face reaches down (3 mm x the slant's sine)
    m.flex(FlexDef('CLN-NAL', 'Air line 6 mm, nozzle loop', 'loop', Anchor(tip, (wb + 18.4, 36 + 3 + 1.6, 0), (0.4939, 0.8695, 0.0)),
                   Anchor(noz, (xk, yk + 8 + 3 + 2.4, 0), (-0.7594, -0.6506, 0.0)), 3.0, 'NOZZLE',
                   'Brings the air across the nozzle joint to the air knife.',
                   mat='hose', category='fluid', length=366.8, min_bend=30, bulge=(0.0, (1.279, 1.252, 0), (0, 1.252, 0)), hk=0.359,
                   kg_per_m=0.02, size='OD 6',
                   spec={'bend radius': 'about 5 x 6 mm (PU tube)'}))

    # ═══════════════════════════════════════════════════════════════ VISION ═══
    # The cabin vision pod (docs/ROBOT-VISION.md; design finding 26): a sealed box under the wand's base tube, by the wrist.
    # It turns with the wand, so it looks where the wand points: through the door from the ready point (the check that no
    # one is in the cabin), and at each surface before and after the nozzle cleans it. Its place is the twin's
    # (cleanArmSpec.visionPod): the wrist fork itself has no room (the arm keeps 0.10 m off a car only within about 90 mm of
    # the mast's axis, and the fork reaches 81 mm), and under the base tube, up to 150 mm from the pivot, everything stays
    # outside the car with 0.04 m or more over the wand's 0.03 m. Its depth is set by the arm at rest, wand level: its floor
    # stays 0.10 m over the tallest fleet vehicle's roof (the Ojai's lidar, 2.04 m; fleetEnvelope.test.ts). A first draft
    # 21.5 mm deeper, with an IR light board over the cameras, stood 0.085 m over it, so the pod holds one row: 2 cameras
    # and the depth module over the radar. The light ring at the wand's tip lights the cabin for the cameras (CLN-NRG), and
    # the depth module has its own IR light. Frame: the pitch node's (+X along the wand, +Y up at pitch 0, +Z the pitch
    # axis), mm from the pivot. The wand drive (CLN-WLA) is on the tube's top, so the pod hangs below.
    VP = {k: v * M for k, v in A['visionPod'].items() if not isinstance(v, dict)}
    VL = {k: v * M for k, v in A['visionPod']['line'].items()}   # the drive line up the pod's -Z side
    WIN_T, GSK_T, VT = 3.0, 1.5, 2.5                     # window and radome, gasket, housing wall
    vx0, vx2 = VP['from'], VP['to']                      # the housing's back, the window's face
    vx1 = vx2 - WIN_T - GSK_T                            # the housing's front rim
    vy1 = -VP['below']                                   # the housing's top, on the saddle
    vy0 = vy1 - VP['depth']                              # its floor
    vz = VP['halfWidth']
    yd0 = vy0 + VT + 19.0                                # the divider: the radar's bay under it, the cameras' bay over it
    yd1 = yd0 + 2.0

    def vbx(x0: float, x1: float, y0: float, y1: float, z0: float, z1: float) -> cq.Workplane:
        return cq.Workplane('XY').box(x1 - x0, y1 - y0, z1 - z0, centered=False).translate((x0, y0, z0))

    def xcyl(r: float, x0: float, x1: float, y: float, z: float) -> cq.Workplane:
        return cq.Workplane('XY').add(cq.Solid.makeCylinder(r, x1 - x0, Vector(x0, y, z), Vector(1, 0, 0)))

    def ycyl(r: float, y0: float, y1: float, x: float, z: float) -> cq.Workplane:
        return cq.Workplane('XY').add(cq.Solid.makeCylinder(r, y1 - y0, Vector(x, y0, z), Vector(0, 1, 0)))

    SAD_X = (vx0 - 4.0, vx1 - 2.0)                       # the saddle, along the tube
    BOSS_X = (84.0, 120.0)                               # the saddle screws' bosses: clear of the boards
    YB = (vy1 + vy0) / 2                                 # the boards' middle height
    hsg = (vbx(vx0, vx1, vy0, vy1, -vz, vz).edges('|X').fillet(5.0)
           .cut(vbx(vx0 + VT, vx1 + 1.0, vy0 + VT, vy1 - VT, -vz + VT, vz - VT).edges('|X').fillet(2.5))
           .union(vbx(vx1 - 23.0, vx1, yd0, yd1, -vz + VT, vz - VT)))                 # the divider, at the front
    for bx_ in BOSS_X:
        for sz in (-1, 1):
            hsg = hsg.union(ycyl(5.0, vy1 - VT - 6.5, vy1 - VT, bx_, sz * 40.0))
    for (y_, z_) in ((YB + 16.0, -28.0), (YB + 16.0, 28.0), (YB - 16.0, -28.0), (YB - 16.0, 28.0)):   # the vision board's bosses
        hsg = hsg.union(xcyl(3.0, vx0 + VT, vx0 + VT + 2.5, y_, z_))
    m.place(pitch, m.part(PartDef('CLN-VPH', 'Vision pod housing, IP67', hsg.val(), 'a356_dark', 'sensor', 'die casting, machined',
                                  f'{vx1 - vx0:.0f} x {vy1 - vy0:.0f} x {2 * vz:.0f}', 'IP67', None,
                                  'Holds the cameras, the depth module, the radar and the vision board, sealed. '
                                  'The housing carries the vision processor\'s heat away.', {}, 'make')),
            Location(), (0, -120, 0), 'VISION')
    sad = (vbx(SAD_X[0], SAD_X[1], vy1, -20.0, -vz, vz)
           .cut(cq.Workplane('YZ', origin=(SAD_X[0] - 1.0, 0, 0)).circle(wr).extrude(SAD_X[1] - SAD_X[0] + 2.0)))
    m.place(pitch, m.part(PartDef('CLN-VSD', 'Vision pod saddle, bonded to the base tube', sad.val(), 'al6061', 'structure',
                                  'machined', f'{SAD_X[1] - SAD_X[0]:.0f} x 28 x {2 * vz:.0f}', '6061-T6', None,
                                  'Carries the pod under the wand\'s base tube. Bonded to the tube with structural epoxy, as the '
                                  'tube is bonded into the hub.', {'bond': 'two-part structural epoxy (class)'}, 'make')),
            Location(), (0, -70, 0), 'VISION')
    for bx_ in BOSS_X:
        for sz in (-1, 1):
            m.place(pitch, std.shcs(4, 28, 'A2-70', 'Holds the vision pod to its saddle, into a boss in the housing.'),
                    std.orient((bx_, -20.0, sz * 40.0), (0, -1, 0)), (0, -40, sz * 30), 'VISION')
    # inside: the vision board on 4 bosses of the back wall, its processor against the wall through a thermal pad, and the
    # EtherCAT and power board in front of it
    it = m.place(pitch, m.part(PartDef('CLN-VTP', 'Thermal pad 16 x 16 x 1', vbx(0, 1.0, -8, 8, -8, 8).val(), 'rubber', 'sensor',
                                       'catalogue part', '16 x 16 x 1', '6 W/m K (class)', None,
                                       'Carries the vision processor\'s heat into the housing\'s back wall.', {}, 'buy')),
                 loc(vx0 + VT, YB, 0), (-30, -120, 0), 'VISION')
    it.sealed = True
    it = m.place(pitch, m.part(PartDef('CLN-VSC', 'AI vision processor, 13 x 13 mm package', vbx(0, 1.5, -6.5, 6.5, -6.5, 6.5).val(),
                                       'pcb', 'sensor', 'catalogue part', '13 x 13 x 1.5', '-40 to 85 degrees C', None,
                                       'Runs the models in the pod: the cabin check, the seats, the floor, items left behind.',
                                       {'class': '7 TOPS, 4 CPU cores, image signal processor, secure boot'}, 'buy')),
                 loc(vx0 + VT + 1.0, YB, 0), (-20, -120, 0), 'VISION')
    it.sealed = True
    it = m.place(pitch, m.part(PartDef('CLN-VPB', 'Vision board', vbx(0, 1.6, -20, 20, -32, 32).val(), 'pcb', 'sensor', 'made to order',
                                       '64 x 40', '', None, 'Carries the vision processor, its memory and the 2 camera inputs.',
                                       {'memory': '4 GB (class)', 'storage': '32 GB, keeps the pictures until they are sent'}, 'make')),
                 loc(vx0 + VT + 2.5, YB, 0), (-10, -120, 0), 'VISION')
    it.sealed = True
    it = m.place(pitch, m.part(PartDef('CLN-VBC', 'Board-to-board connector', vbx(0, 5.4, -4, 4, -15, 15).val(), 'pa66', 'sensor',
                                       'catalogue part', '30 x 8 x 5.4', '', None, 'Joins the vision board to the EtherCAT board.',
                                       {}, 'buy')),
                 loc(vx0 + VT + 4.1, YB + 12.0, 0), (0, -120, 0), 'VISION')
    it.sealed = True
    spc = m.part(PartDef('CLN-VSP', 'Board spacer M2.5 x 5.4, brass', xcyl(2.5, 0, 5.4, 0, 0).val(), 'brass', 'fastener', 'catalogue part',
                         'M2.5 x 5.4', '', None, 'Holds the EtherCAT board off the vision board.', {}, 'buy'))
    for sz in (-1, 1):
        it = m.place(pitch, spc, loc(vx0 + VT + 4.1, YB - 12.0, sz * 26.0), (0, -120, 0), 'VISION')
        it.sealed = True
    it = m.place(pitch, m.part(PartDef('CLN-VEB', 'EtherCAT and power board', vbx(0, 1.6, -16, 16, -30, 30).val(), 'pcb', 'sensor',
                                       'made to order', '60 x 32', '', None,
                                       'Joins the pod to the arm\'s EtherCAT line, in and out, and makes the pod\'s supplies from 48 V.',
                                       {'EtherCAT': '2-port slave controller with 2 built-in 100 Mbit/s PHYs (class)',
                                        'supply': '48 V DC in, about 8 W at most (ASSUMPTION)'}, 'make')),
                 loc(vx0 + VT + 9.5, YB, 0), (10, -120, 0), 'VISION')
    it.sealed = True
    # the cameras' bay: 2 cameras and the depth module stand on the divider
    cam = vbx(0, 4.0, -13, 13, -15, 15).union(xcyl(7.0, 4.0, 18.0, 0, 0))
    cam_pd = m.part(PartDef('CLN-VCM', 'Camera module, global shutter, 2.3 MP, M12 lens 2.8 mm', cam.val(), 'pcb', 'sensor',
                            'catalogue part', '30 x 26, M12 lens', '', None,
                            'One eye of the pair. 2 views give the depth of the seats and the floor.',
                            {'sensor': '1/2.6 in, 1920 x 1200, 3.0 um pixels, global shutter',
                             'lens': 'M12, 2.8 mm: about 92 x 66 degrees', 'output': 'MIPI CSI-2'}, 'buy'))
    for sz in (-1, 1):
        m.place(pitch, cam_pd, loc(vx1 - 20.0, yd1 + 13.0, sz * 27.5), (0, -110, sz * 40), 'VISION')
    tof = vbx(0, 4.0, -8, 8, -10, 10).union(xcyl(2.5, 4.0, 10.0, 0, -4)).union(xcyl(2.5, 4.0, 10.0, 0, 4))
    m.place(pitch, m.part(PartDef('CLN-VTF', 'Time-of-flight depth module', tof.val(), 'pcb', 'sensor', 'catalogue part', '20 x 16',
                                  '', None, 'Measures the distance to each surface. It checks the pair\'s depth and sees in the dark.',
                                  {'range': '0.1 to 2 m (class)'}, 'buy')),
            loc(vx1 - 20.0, yd1 + 8.0, 0), (0, -110, 0), 'VISION')
    # the radar's bay: the board on the floor, its antenna 3 half wavelengths in air (7.4 mm) behind the radome
    rad = vbx(0, 1.6, -9, 9, -27.5, 27.5).union(vbx(1.6, 2.8, -7.5, 7.5, -7.5, 7.5))
    ant_gap = 3 * 299.792 / 60.5 / 2                     # 3 half wavelengths in air at 60.5 GHz, mm (ASSUMPTION: a rule of thumb)
    m.place(pitch, m.part(PartDef('CLN-VRD', 'Radar module, 60 GHz, antenna on package', rad.val(), 'pcb', 'sensor', 'catalogue part',
                                  '55 x 18', '', None,
                                  'Sees a person or an animal in the cabin by breathing and small motion, through soft material.',
                                  {'band': '60 to 64 GHz', 'field of view': 'about 120 x 120 degrees (class)'}, 'buy')),
            loc(vx1 + GSK_T - ant_gap - 2.8, vy0 + VT + 9.0, 0), (0, -130, 0), 'VISION')
    # the front: a gasket on the rim and the divider, the camera window over the cameras' bay, the radome over the radar's
    gk = (vbx(vx1, vx1 + GSK_T, vy0, vy1, -vz, vz)
          .cut(vbx(vx1 - 1.0, vx1 + GSK_T + 1.0, yd1, vy1 - VT, -vz + VT, vz - VT))
          .cut(vbx(vx1 - 1.0, vx1 + GSK_T + 1.0, vy0 + VT, yd0, -vz + VT, vz - VT)))
    m.place(pitch, m.part(PartDef('CLN-VGK', 'Vision pod window gasket', gk.val(), 'nbr', 'seal', 'cut gasket',
                                  f'{vy1 - vy0:.0f} x {2 * vz:.0f} x {GSK_T:g}', 'EPDM', None,
                                  'Seals the window and the radome to the housing (IP67). Both are bonded to it.', {}, 'buy')),
            Location(), (0, -120, 20), 'VISION')
    y_seam = (yd0 + yd1) / 2
    win = vbx(vx1 + GSK_T, vx2, y_seam, vy1 - 0.5, -vz + 0.5, vz - 0.5)
    m.place(pitch, m.part(PartDef('CLN-VWN', 'Vision pod window, coated glass', win.val(), 'lens', 'sensor', 'catalogue part',
                                  f'{2 * vz - 1:.0f} x {vy1 - 0.5 - y_seam:.0f} x {WIN_T:g}', 'anti-reflective, hydrophobic', None,
                                  'Seals the cameras\' bay. Its coating sheds dust and condensation.', {}, 'buy')),
            Location(), (0, -110, 40), 'VISION')
    rdm = vbx(vx1 + GSK_T, vx2, vy0 + 0.5, y_seam, -vz + 0.5, vz - 0.5)
    m.place(pitch, m.part(PartDef('CLN-VRW', 'Vision pod radome, black polycarbonate 3.0 mm', rdm.val(), 'pc_black', 'sensor', 'moulded',
                                  f'{2 * vz - 1:.0f} x {y_seam - vy0 - 0.5:.0f} x {WIN_T:g}', 'radar-transparent at 60 GHz', None,
                                  'Seals the radar\'s bay and passes its signal: 3.0 mm is 2 half wavelengths in polycarbonate at '
                                  '60 GHz, where the wall reflects least.',
                                  {'thickness rule': 'n x half the wavelength in the material (TI SWRA705)',
                                   'permittivity': 'polycarbonate, about 2.75 at 60 GHz'}, 'make')),
            Location(), (0, -130, 40), 'VISION')
    # the back: the 2 cable connectors and a vent; the clock spring's lead comes out of the hub through a gland
    rcp = m.part(PartDef('CLN-VCN', 'Panel connector, M8, 8 pole, A-coded', xcyl(5.0, 0, 10.0, 0, 0).val(), 'brass', 'electrical',
                         'IEC 61076-2-104', 'M8, 8 pole', 'IP67', None,
                         'Takes a cable into the pod: 48 V and the EtherCAT pair, in from the clock spring or out to the wand drive.',
                         {}, 'buy'))
    m.place(pitch, rcp, loc(vx0 - 10.0, VL['y'], 30.0), (-40, -120, 30), 'VISION')                 # IN, on the back
    m.place(pitch, rcp, loc(VL['x'], VL['y'], -vz - 10.0, ry=-90), (0, -120, -40), 'VISION')       # OUT, on the -Z side
    # the drive cable's plug on OUT turns the cable up, so it climbs the pod's side close in (a straight plug sent it 0.087 m
    # out across the pitch axis before it could bend up)
    if abs(VL['side'] - (vz + 16.0)) > 1e-6:
        raise ValueError('cleanArmSpec.visionPod.line.side must be the right-angle plug\'s axis: halfWidth + 16 mm')
    rap = vbx(-6.0, 6.0, -6.0, 10.0, -6.0, 6.0)          # its body; the cable leaves its top (+Y)
    m.place(pitch, m.part(PartDef('CLN-VRA', 'Cable plug M8, right angle, moulded', rap.val(), 'pa66', 'electrical', 'IEC 61076-2-104',
                                  'M8, 8 pole, right angle', 'IP67', None,
                                  'Plugs the drive cable into the pod and turns it up the pod\'s side.', {}, 'buy')),
            loc(VL['x'], VL['y'], -VL['side']), (0, -120, -60), 'VISION')
    m.place(pitch, m.part(PartDef('CLN-VVT', 'Pressure-equalising vent, M12, membrane', xcyl(6.0, 0, 8.0, 0, 0).val(), 'pa66',
                                  'sensor', 'catalogue part', 'M12', 'IP68 (class)', None,
                                  'Lets the pod breathe as it warms and cools, so its seals hold and no water condenses in it.',
                                  {}, 'buy')),
            loc(vx0 - 8.0, YB + 12.0, 0), (-40, -120, 0), 'VISION')
    G_ANG = math.radians(-60.0)                          # the gland on the hub's rim: 60 degrees down from the wand, forward
    m.place(pitch, m.part(PartDef('CLN-WCG', 'Cable gland M12 on the hub, for the clock spring\'s turning lead', xcyl(7.5, 0, 12.0, 0, 0).val(),
                                  'pa66', 'electrical', 'EN 62444', 'M12', 'IP68', None,
                                  'Takes the clock spring\'s turning lead out of the hub to the pod.', {}, 'buy')),
            loc(hub_od / 2 * math.cos(G_ANG), hub_od / 2 * math.sin(G_ANG), 30.0, rz=math.degrees(G_ANG)), (0, -80, 30), 'VISION')
    VC_OD, VC_BEND = 6.5, 26.0                           # ASSUMPTION: a PUR hybrid cable; its fixed bend 4 x D
    g_end = (hub_od / 2 + 12.0) * math.cos(G_ANG), (hub_od / 2 + 12.0) * math.sin(G_ANG)          # the gland's end
    g_t = (g_end[1] - VL['y']) / -math.sin(G_ANG)       # down the gland's axis to the height of IN, then along the wand
    vpl = std.swept('CLN-VPL', 'Pod cable, clock spring to the vision pod: 48 V and EtherCAT, 6.5 mm',
                    [(g_end[0], g_end[1], 30.0), (g_end[0] + g_t * math.cos(G_ANG), VL['y'], 30.0), (vx0 - 10.0, VL['y'], 30.0)],
                    VC_OD / 2, 'cable', 'electrical',
                    0.0, 'Brings 48 V and the EtherCAT line from the clock spring\'s turning side to the pod. It does not move.',
                    {'bend': f'R {VC_BEND:.0f} (4 x D)'}, 'EN 50525', f'OD {VC_OD:g}', 'buy', bend=VC_BEND)
    m.place(pitch, vpl, Location(), (-30, -140, 30), 'VISION')
    if abs(VL['r'] - VC_OD / 2) > 1e-6:
        raise ValueError('cleanArmSpec.visionPod.line.r must be the drive cable\'s radius')
    vpd = std.swept('CLN-VPD', 'Drive cable, vision pod to the wand drive: 48 V and EtherCAT, 6.5 mm',
                    [(VL['x'], VL['y'] + 10.0, -VL['side']), (VL['x'], wr + 16.0, -VL['side']), (VL['x'], wr + 16.0, -16.0)],
                    VC_OD / 2, 'cable', 'electrical', 0.0,
                    'Takes 48 V and the EtherCAT line on from the pod to the wand drive, round the base tube\'s side. It does not move.',
                    {'bend': f'R {VC_BEND:.0f} (4 x D)'}, 'EN 50525', f'OD {VC_OD:g}', 'buy', bend=VC_BEND)
    m.place(pitch, vpd, Location(), (0, -60, -60), 'VISION')

    # ════════════════════════════════════════════════════════════ CABLE SCHEDULE ═══
    _cable_schedule(m, dict(L1=L1, L2=L2, emc_mm=ENC_Y0 - 20 - y_gm, adr_mm=y_sp - (y_u0 + AU_H),
                            ecd_mm=y_tray - (ENC_Y0 + ENC_H + 15), CAB_BEND=CAB_BEND,
                            air_mains=(spec.get('site') or {}).get('airMains', []), site=spec.get('site') or {}))
    return m


TAIL_ENC = 300.0     # inside the supply enclosure, from its gland to the terminal (ASSUMPTION)
TAIL_DEV = 100.0     # to make a line off at a device's connector or fitting (ASSUMPTION)


def _cable_schedule(m: Model, g: dict) -> None:
    """The clean arm's cable schedule (cables.py). Its lines are cut at every slip ring, reel and clock spring, so each
    piece between them is its own line: the supply and network drops, the J1 motor cable, the arm cable to the J1 union,
    the cables inside the 2 links, the hybrid cable and air line down the mast and along the wand, and the air line's
    pieces from the canopy main to the nozzle."""
    P, fx = m.parts, {f.id: f for f in m.flexes}
    enc_tail = f'{TAIL_ENC:.0f} mm inside the supply enclosure to its terminal (ASSUMPTION)'
    dev_tail = f'{TAIL_DEV:.0f} mm to make it off at its connector (ASSUMPTION)'
    # Their run from the canopy's board is the site's: each arm's is measured on the site plan (src/lib/siteCanopy.ts, written
    # into cad/spec/robots.json as site.cleanArmRuns by cadSpec.ts), and the notes quote it (2026-11-16: until then each
    # ended "add it from the site's layout").
    runs = g['site'].get('cleanArmRuns', [])

    def by_arm(key: str, what: str) -> str:
        vals = [r[key] for r in runs if r.get(key) is not None]
        if not vals:
            return ''
        return (f'{what}: {min(vals):.1f} to {max(vals):.1f} m by arm, {sum(vals) / len(vals):.1f} m on average over the {len(vals)} '
                'arms, the site\'s and not in this schedule (measured on the site plan: src/lib/siteCanopy.ts; each arm in '
                'cad/spec/robots.json, site.cleanArmRuns).')
    for (lid, name, kind, od, cid, frm, to, key) in (
            ('CLN-SPW', 'Supply cable 4 x 2.5 mm2, canopy board to the supply enclosure', 'power', SUPPLY_CABLE_OD, 'CLN-ECDP',
             'its breaker in the canopy\'s board (at grade under the canopy\'s south end)', 'its isolator', 'supplyM'),
            ('CLN-SNW', 'Network cable, industrial Cat 6A, canopy switch to the supply enclosure', 'network', NET_CABLE_OD, 'CLN-ECDN',
             'the canopy\'s network switch, in its board (at grade under the canopy\'s south end)', 'its controller', 'networkM')):
        L = m.cable(lid, name, kind, od, 'ASSUMPTION: a cable of its kind (cad clean_arm, SUPPLY_CABLE_OD and NET_CABLE_OD)',
                    frm, f'the supply enclosure (CLN-ENC): {to}', 'POWER', bend_fixed=4 * od,
                    tail_b=TAIL_ENC, tails=enc_tail)
        L.run('site', 'CLN-CTY', 'from the board, up the canopy\'s last spine column and along its cable tray to this arm: the site\'s '
              'length, not in this schedule', 0.0)
        L.run('conduit', cid, 'down its rigid conduit from the tray to the enclosure\'s top', g['ecd_mm'])
        note = by_arm(key, 'Its run from the canopy\'s board, up the last column and along the cable tray, with the board\'s tail')
        if note:
            L.notes.append(note)
        else:
            L.open.append('Its run from the canopy\'s board is not measured: cad/spec/robots.json has no site.cleanArmRuns (run cadSpec).')
    L = m.cable('CLN-EMC', 'J1 motor cable, power and feedback, 12 mm', 'power', 12.0, 'EN 50525', 'the J1 drive in the supply enclosure',
                'the J1 gearmotor', 'POWER', bend_fixed=48.0, tail_a=TAIL_ENC, tail_b=TAIL_DEV, tails=f'{enc_tail}; {dev_tail}')
    L.run('drawn', 'CLN-EMC', 'straight down from the enclosure\'s gland to the gearmotor', g['emc_mm'])
    L = m.cable('CLN-ESC', 'Arm cable, enclosure to the J1 union: power and network, 10 mm', 'power', 10.0, 'EN 50525',
                'the supply enclosure (CLN-ENC)', 'the J1 union\'s slip ring, its fixed side (CLN-SWV1)', 'POWER',
                bend_fixed=g['CAB_BEND'], tail_a=TAIL_ENC, tail_b=TAIL_DEV, tails=f'{enc_tail}; {dev_tail}')
    L.run('drawn', 'CLN-ESC', 'in through the column\'s wall and down to the J1 union', P['CLN-ESC'].path_mm, bend=g['CAB_BEND'])
    for (lid, name, kind, od, a, b, sub, circuits, where) in (
            ('CLN-AC1', 'Arm cable in link 1: power and network, 10 mm', 'power', 10.0, 'CLN-SWV1', 'CLN-SWV2', 'LINK1',
             '24 circuits and the EtherCAT pair', 'along link 1 under its top cover, over the duct and the J2 gearmotor'),
            ('CLN-AC2', 'Arm cable in link 2: power and network, 10 mm', 'power', 10.0, 'CLN-SWV2', 'CLN-SWV', 'LINK2',
             '12 circuits and the EtherCAT pair', 'along link 2 beside the duct, out through its M20 gland in the cover and up beside '
             'the duct to the J3 union\'s boss'),
            ('CLN-AT1', 'Air tube 6 x 4 in link 1', 'air', AIR_OD, 'CLN-SWV1', 'CLN-SWV2', 'VAC', 'its air passage',
             'along link 1 under its top cover, beside the arm cable'),
            ('CLN-AT2', 'Air tube 6 x 4 in link 2', 'air', AIR_OD, 'CLN-SWV2', 'CLN-SWV', 'VAC', 'its air passage',
             'along link 2 beside the duct, out through its M16 gland in the cover and up beside the duct to the J3 union\'s boss')):
        power = kind == 'power'
        end = 'connector (CLN-SCN)' if power else 'air port\'s push-in fitting (CLN-SPF)'
        L = m.cable(lid, name, kind, od, 'EN 50525' if power else 'ISO 14743, PU 6 x 4',
                    f'the {a} union\'s turning side: its outlet collar\'s {end} (CLN-SOC)', f'the {b} union\'s fixed side ({circuits}): its {end}',
                    sub, bend_fixed=4 * od if power else AIR_BEND_R, tail_a=TAIL_DEV if power else 0.0, tail_b=TAIL_DEV if power else 0.0,
                    tails=f'{dev_tail}, at each plug' if power else 'its 2 push-in fittings take its ends: drawn 12 mm into each')
        L.run('drawn', lid, where, P[lid].path_mm, bend=g['CAB_BEND'] if power else AIR_BEND_R)
    L = m.cable('CLN-MFR', 'Hybrid cable and air line, J3 union to the mast reel', 'hybrid', 12.0, 'EN 50525: a 10 mm hybrid cable and a 6 mm air line in one jacket',
                'the J3 union\'s turning side (CLN-SWV)', 'the mast reel\'s hub: its slip ring and air swivel (CLN-MCR)', 'VAC',
                bend_fixed=25.0, tail_a=TAIL_DEV, tail_b=TAIL_DEV, tails=f'{dev_tail}, at each end')
    L.run('duct', 'CLN-MCL', 'inside the mast top collar, from the union\'s turning side out to the collar\'s cable outlet (CLN-MOB)',
          100.0, tol=25.0)
    L.run('drawn', 'CLN-MFR', 'from the outlet down the outer mast stage, clipped to it, to the reel', P['CLN-MFR'].path_mm, bend=25.0)
    L = m.cable('CLN-MCB', 'Hybrid cable and air line on the mast reel, PUR', 'hybrid', 12.0, 'EN 50525: the reel\'s cable, hybrid 10 mm and air 6 mm in a flat jacket',
                'the mast reel\'s drum (CLN-MCR)', 'its clamp on the wrist fork (CLN-MCK)', 'VAC', tail_b=TAIL_DEV, tails=dev_tail)
    L.run('reel', 'CLN-MCB', 'on the reel: what it holds; it pays out straight down as the mast goes down', fx['CLN-MCB'].lmax,
          moving=True, flex=fx['CLN-MCB'])
    L = m.cable('CLN-WFC', 'Wrist fixed cable, coil clamp to the clock spring', 'power', 8.0, 'EN 50525', 'the reel cable\'s clamp on the wrist fork',
                'the clock spring\'s lead connector, M8 (CLN-WCN)', 'WRIST', bend_fixed=32.0, tail_a=TAIL_DEV, tails=dev_tail)
    L.run('drawn', 'CLN-WFC', 'up the cheek\'s face and over the fork\'s top block', P['CLN-WFC'].path_mm)
    L = m.cable('CLN-WCB', 'Wand cable with air line, on a reel in the drive', 'hybrid', 8.0, 'a cable and an air line on one reel',
                'the wand drive\'s reel', 'the nozzle drive in the knuckle, through the entry block (CLN-WCE)', 'WAND',
                tail_b=TAIL_DEV, tails=f'{dev_tail}, inside the knuckle')
    L.run('reel', 'CLN-WCB', 'on the reel: what it holds; it runs along the wand to the knuckle', fx['CLN-WCB'].lmax, moving=True,
          flex=fx['CLN-WCB'])
    # the cabin vision pod's 2 lines (design finding 26): the clock spring's turning side feeds the pod, and the pod passes
    # 48 V and the EtherCAT line on to the wand drive (until 2026-11-19 no line in this schedule reached the wand drive)
    hyb = 'ASSUMPTION: a PUR hybrid cable, 2 power cores and the EtherCAT pair (class)'
    L = m.cable('CLN-VPL', 'Pod cable, clock spring to the vision pod: 48 V and EtherCAT, 6.5 mm', 'hybrid', 6.5, hyb,
                'the clock spring\'s turning side (CLN-WCS), out of the hub through its gland (CLN-WCG)',
                'the vision pod\'s IN connector, M8 (CLN-VCN)', 'VISION', bend_fixed=26.0, tail_a=TAIL_DEV,
                tails=f'{dev_tail}, at the clock spring\'s terminal; a moulded M8 plug at the pod')
    L.run('arm', '', 'inside the hub: from the clock spring\'s turning terminal along a groove in the hub\'s +Z face and down a '
          'drilled passage to the gland (planned)', 45.0, tol=10.0)
    L.run('drawn', 'CLN-VPL', 'from the gland under the hub, down and forward to the pod\'s back', P['CLN-VPL'].path_mm, bend=26.0)
    L = m.cable('CLN-VPD', 'Drive cable, vision pod to the wand drive: 48 V and EtherCAT, 6.5 mm', 'hybrid', 6.5, hyb,
                'the vision pod\'s OUT connector, M8 (CLN-VCN), through its right-angle plug (CLN-VRA)',
                'the wand drive\'s connector, on its side (CLN-WLA)', 'VISION',
                bend_fixed=26.0, tails='a moulded M8 plug at each end')
    L.run('drawn', 'CLN-VPD', 'from the plug on the pod\'s side, up beside the base tube and in to the wand drive', P['CLN-VPD'].path_mm,
          bend=26.0)
    for (lid, name, kind, od, spec, a, b, sub, run) in (
            ('CLN-ADR', 'Air drop tube, 12 x 1.5, stainless', 'air', 12.0, 'EN 10216-5', 'the canopy main\'s drop', 'the air service unit (CLN-AFR)', 'VAC',
             ('drawn', 'CLN-ADR', 'straight down from the main\'s drop to the service unit', g['adr_mm'], None)),
            ('CLN-AIL', 'Air line 6 x 1, service unit to the J1 union', 'air', AIR_OD, 'ISO 14743, PU 6 x 4', 'the air service unit (CLN-AFR)',
             'the J1 union\'s air passage (CLN-SWV1)', 'VAC', ('drawn', 'CLN-AIL', 'in through the column\'s wall and down to the union', P['CLN-AIL'].path_mm, AIR_BEND_R)),
            ('CLN-WAT', 'Wrist fixed air line, coil clamp to the wrist union', 'air', AIR_OD, 'ISO 14743, PU 6 x 4', 'the reel line\'s clamp on the wrist fork',
             'the wrist union\'s air passage (CLN-WSW)', 'WRIST', ('drawn', 'CLN-WAT', 'along the fork to the union', P['CLN-WAT'].path_mm, None)),
            ('CLN-NAL', 'Air line 6 mm, nozzle loop', 'air', AIR_OD, 'ISO 14743, PU tube', 'its push-in fitting on the wand\'s tip (CLN-NAF)',
             'its push-in fitting on the air knife (CLN-NAF)', 'NOZZLE', ('loop', 'CLN-NAL', 'a free loop across the nozzle joint', fx['CLN-NAL'].length, None))):
        L = m.cable(lid, name, kind, od, spec, a, b, sub, bend_fixed=AIR_BEND_R if od <= 6 else 0.0,
                    bend_moving=AIR_BEND_R if run[0] == 'loop' else 0.0, tail_a=TAIL_DEV if run[0] != 'loop' else 0.0,
                    tail_b=TAIL_DEV if run[0] != 'loop' else 0.0, tails='' if run[0] == 'loop' else f'{dev_tail}, at each fitting')
        L.run(run[0], run[1], run[2], run[3], bend=run[4], moving=run[0] == 'loop', flex=fx.get(run[1]) if run[0] == 'loop' else None)
        canopy = [a['lengthM'] for a in g['air_mains'] if a['to'].startswith('canopy')]
        if lid == 'CLN-ADR' and canopy:
            L.notes.append(f'The canopy\'s air main is fed from the depot\'s one compressor, in the service building: {min(canopy):.1f} to '
                           f'{max(canopy):.1f} m of main from the plant to the {len(canopy)} canopies, the site\'s and not in this schedule '
                           '(measured on the site plan: src/lib/siteAir.ts).')
