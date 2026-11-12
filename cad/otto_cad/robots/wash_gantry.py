"""OTTO-WASH — the touchless wash machine in each wash bay (docs/OTTO-WASH.md).

Geometry is the twin's (cad/spec/robots.json <- washSpec.ts, plan units converted once): one portal gantry on
two floor rails at x = +/-3.25 m that travels 7.37 m over the parked car, carrying a spray arch, a top and two
side air knives, and two sensor-wipe arms on a cross rail. Nothing that turns touches the car (Chase, 2026-11-11):
the arch soaks, washes with water jets and rinses, the knives dry, and the arms wipe each sensor with a soft pad.

FRAME: the bay's, as the twin's renderer draws it (WashGantry.tsx). Origin at the parked car's centre on grade,
+Y up, X across the bay, +Z = -dy (north, toward the exit door). The machine is modelled at dy = 0 with every
tool retracted; the GANTRY joint carries the twin's home (the north end) as `stowed`, and each tool's slide
is a prismatic joint the viewer can drive.
"""
from __future__ import annotations

import math

import cadquery as cq
from cadquery import Location, Vector

from .. import std
from ..core import Model, Node, PartDef, loc
from ..flex import Anchor, FlexDef

WIPE_SLIDES = 2      # sliding stages in each wipe arm's mast; each takes half the drop
WIPE_X_MIN = 330.0   # the nearest a mast's axis comes to the drive line, mm: 16 mm inside the roof pod station's 346 mm
WIPE_LOW_MM = 550.0  # the lowest a pad's centre goes: 24 mm under the nose and tail stations' 574 mm
WIPE_HINGE = 90.0    # the tilt hinge stands this far behind the pad's centre, along the forearm
WIPE_WRIST = 180.0   # from the mast's foot down to the forearm's axis
TOP_LOW_MM = 850.0   # the lowest the top knife goes: the twin takes it over the hood, 2.00 m below its stowed height. Fixed rails cannot guide that far without standing below the car's
                     # roof as the machine passes, so it hangs on 2 telescoping lift columns (design finding 7).
TOP_SLIDES = 3       # sliding stages in each lift column; each takes a third of the travel
KH_X = 290.0         # the top knife's lift columns, either side of its duct and clear of its blower on the beam
OVER_MM = 1.0        # each slide's over-travel past its share of the twin's stroke, at its end stops (the twin's
                     # stroke, from plan units, runs 0.01 mm past the stroke from the 4-decimal spec)


def build(spec: dict) -> Model:
    W = spec['wash']
    G = W['gantry']
    M = 1000.0
    g = {k: (v * M if isinstance(v, (int, float)) else v) for k, v in G.items() if not isinstance(v, dict)}
    sub = lambda k: {kk: vv * M if isinstance(vv, (int, float)) else vv for kk, vv in G[k].items()}  # noqa: E731
    legX = G['legX'] * M
    leg, trol, beam, rail = sub('leg'), sub('trolley'), sub('beam'), sub('rail')
    arch, wipe, light = sub('arch'), sub('wipe'), sub('light')
    arch['nozzles'] = G['arch']['nozzles']
    dry_dy = G['dryer']['dy'] * M
    dtop = {k: v * M for k, v in G['dryer']['top'].items()}
    dside = {k: v * M for k, v in G['dryer']['side'].items()}
    zf = lambda dy: -dy                     # noqa: E731  bay dy -> this frame's z
    home = W['homeDy']

    m = Model('wash_gantry', 'OTTO-WASH',
              'Wash bay frame: origin at the parked car centre on grade, +Y up, X across the bay, +Z north (toward the exit). '
              'Machine at dy = 0, tools retracted.')
    m.subsystem('RAILS', 'Floor rails', 'Two steel rails, 3.25 m each side of the car, carry the machine over the parked car.',
                how=['Anchor plates every metre hold each rail to the slab with concrete screws.', 'The rails stand outside the door opening.',
                     'A stop at each rail end holds a wheel if the machine runs past its travel.'],
                specs={'track': f'{2 * legX / 1000:.2f} m', 'length': f'{(rail["to"] - rail["from"]) / 1000:.2f} m'}, group='Structure')
    m.subsystem('TRAVEL', 'Travel drive', 'Moves the whole machine back and forth over the car, 6 passes a wash.',
                how=['A geared motor inside each trolley drives one wheel. The drives keep in step by encoder.',
                     'Side rollers keep the wheels on the rails.'],
                specs={'speed': 'about 10 m/min', 'motors': '2 x 0.75 kW, with brake'}, group='Motion')
    m.subsystem('PORTAL', 'Portal frame', 'Two legs and a beam span the bay. Retracted, everything clears a car by more than 0.48 m.',
                how=['Bolted flanges join the legs to the trolleys and to the beam.', 'Galvanised steel, painted safety yellow.'],
                specs={'clear height': f'{beam["y0"] / 1000:.2f} m under the beam'}, group='Structure')
    m.subsystem('ARCH', 'Spray arch', 'Sprays the pre-soak, the wash water jets and the clear-water rinse.',
                how=[f'{arch["nozzles"]} flat-fan nozzles each side and 5 across the top.', 'Solenoid valves switch the pre-soak, the wash water and the rinse water.',
                     'The water does the washing. No brush touches the car, its cameras or its lidar.'],
                specs={'pressure': 'up to 70 bar (nozzle rating)'}, group='Tools')
    m.subsystem('DRYER', 'Air knives (dryer)', 'Blow the water off in the last 2 passes.',
                how=['A top knife on 2 telescoping lift columns follows the car top. 2 side knives close on the flanks.',
                     '3 blowers on the beam feed the knives through flexible ducts.',
                     'A concertina duct draws out as the top knife goes down. A duct loop to each side knife swings in with it.'],
                specs={'blowers': 'top 4 kW, sides 2 x 3 kW (class)'}, group='Tools')
    m.subsystem('WIPE', 'Sensor-wipe arms', 'Two arms wipe each camera, lidar and radar cover with a soft, damp pad after the car is dry.',
                how=['Each arm hangs from a carriage on 2 rails under the beam. A rack drive moves it across the bay.',
                     'A mast of 2 sliding stages lowers the wrist. The wrist turns and tilts the pad to face the car.',
                     'A camera on the wrist finds each sensor. The pad is on a sprung plate with a force sensor.',
                     'The arm stops its push at 10 N. A nozzle mists the sensor with pure water first. No chemical is used.',
                     'The gantry carries both arms along the car: the nose, the side cameras, the roof pod, the tail.',
                     'The arms park beside the car path, 1.1 m off the flank. The doors stay shut.'],
                specs={'pad': f'{2 * wipe["padR"]:.0f} mm microfibre, hook-and-loop', 'push': '10 N limit (ASSUMPTION, to be set on test)',
                       'cross travel': f'{(wipe["parkX"] - WIPE_X_MIN) / 1000:.2f} m each arm',
                       'drop': f'{(wipe["stowY"] - WIPE_LOW_MM) / 1000:.2f} m'},
                group='Tools')
    m.subsystem('CONTROL', 'Control, supply and signals', 'Runs the program, and tells the car when to stop and when to go.',
                how=['A stainless control cabinet on the inner side of the west leg holds the controller and the drives.',
                     'A stop light faces the arriving car: red while the program runs, green when the car may go.',
                     'A drag chain brings power, water, chemicals and air. It lies in a covered trench in the floor, inboard of the '
                     'west rail. Its fixed end is at mid travel.',
                     'A driver in the cover\'s slot joins its other end to the west trolley. Its bend rolls along at half the '
                     'machine\'s speed. A conduit takes the lines up the leg to the cabinet.',
                     'Nothing stands outboard of the trolleys: the end bays\' outer walls are 48 mm from them.'],
                group='Control')

    root = m.root
    bay = root.child('Bay', sub='RAILS')

    # ═══════════════════════════════════════════════════════════════ RAILS ═══
    rl = rail['to'] - rail['from']
    zc_r = (zf(rail['from']) + zf(rail['to'])) / 2
    rprof = (cq.Workplane('XY').box(rail['w'], 8, rl).translate((0, 4, 0))
             .union(cq.Workplane('XY').box(8, rail['h'], rl).translate((-rail['w'] / 2 + 4, rail['h'] / 2, 0)))
             .union(cq.Workplane('XY').box(8, rail['h'], rl).translate((rail['w'] / 2 - 4, rail['h'] / 2, 0))))
    rail_pd = m.part(PartDef('WSH-RAIL', 'Floor rail, galvanised steel channel', rprof.val(), 'steel_s355', 'structure', 'welded profile',
                             f'{rail["w"]:.0f} x {rail["h"]:.0f} x 8, {rl:.0f} long', 'S355J2', None,
                             'Carries one side of the machine. The wheels run in its channel.', {}, 'make'))
    plate = cq.Workplane('XY').box(260, 12, 160).translate((0, -6, 0)).faces('>Y').workplane(centerOption='CenterOfBoundBox') \
        .pushPoints([(-100, 0), (100, 0)]).hole(14)
    plate_pd = m.part(PartDef('WSH-RPL', 'Rail anchor plate 260 x 160 x 12', plate.val(), 'steel_s355', 'structure', 'cut plate',
                              '260 x 160 x 12', 'S355J2', None, 'Spreads the rail load into the slab. Grouted under.', {}, 'make',
                              depot='box'))
    anchor = PartDef('WSH-ANC', 'Concrete screw anchor M12 x 100', cq.Workplane('XZ').circle(6).extrude(100).union(
        cq.Workplane('XZ').polygon(6, 19 / math.cos(math.pi / 6)).extrude(-9)).val(), 'fast_zn', 'fastener',
        'ETA option 1 anchor', 'M12 x 100', '', 60.0, 'Holds the anchor plate in the slab. No mortar: it cuts its own thread.', {}, 'buy')
    n_plates = int(rl // 1000) + 1
    for sx in (-1, 1):
        m.place(bay, rail_pd, loc(sx * legX, 0, zc_r), (sx * 300, -100, 0), 'RAILS')
        for i in range(n_plates):
            z = zf(rail['from']) - i * (rl / (n_plates - 1))
            m.place(bay, plate_pd, loc(sx * legX, 0, z), (sx * 300, -160, 0), 'RAILS')
            for dx in (-100, 100):
                m.place(bay, anchor, std.orient((sx * legX + dx, 0, z), (0, -1, 0)), (sx * 300, 120, 0), 'RAILS')
    # end stops: a block in each rail end, with a polyurethane buffer toward the machine. A wheel that runs past the
    # travel strikes it (the trolley body passes over it): 185 mm past home, 232 mm past the south end
    gap_w = rail['w'] - 16                               # between the rail's walls
    stop = (cq.Workplane('XY').box(gap_w - 2, 40, 70).translate((0, 8 + 20, 0)).edges('|Z').fillet(3)
            .faces('>Y').workplane(centerOption='CenterOfBoundBox').pushPoints([(-40, 0), (40, 0)]).hole(11))
    stop_pd = m.part(PartDef('WSH-RST', 'Rail end stop block', stop.val(), 'steel_s355', 'structure', 'cut plate',
                             f'{gap_w - 2:.0f} x 40 x 70', 'S355J2', None,
                             'Stops a wheel at the rail end if the machine runs past its travel.', {}, 'make'))
    buf = cq.Solid.makeCylinder(16, 25, Vector(0, 8 + 20, 0), Vector(0, 0, 1))
    buf_pd = m.part(PartDef('WSH-RBF', 'Rail end buffer, polyurethane', buf, 'pu', 'structure', 'catalogue part', 'D 32 x 25',
                            '90 Shore A', None, 'Takes the blow of a wheel at the end stop.', {}, 'buy'))
    st_screw = std.shcs(10, 60, '8.8', 'Holds the end stop through the rail floor to its anchor plate.')
    for sx in (-1, 1):
        for (zend, toward) in ((zf(rail['from']), -1), (zf(rail['to']), 1)):
            zc = zend + toward * 35                      # the block's centre, 70 long from the rail end
            m.place(bay, stop_pd, loc(sx * legX, 0, zc), (sx * 300, 200, 0), 'RAILS')
            m.place(bay, buf_pd, loc(sx * legX, 0, zc + toward * 35, ry=0 if toward > 0 else 180), (sx * 300, 200, toward * 80), 'RAILS')
            for dx in (-40, 40):
                m.place(bay, st_screw, std.orient((sx * legX + dx, 48, zc), (0, -1, 0)), (sx * 300, 260, 0), 'RAILS')

    # ═══════════════════════════════════════════════════════════════ GANTRY ═══
    gan = bay.child('Gantry', Location(), sub='PORTAL',
                    joint={'name': 'GANTRY', 'axis': [0, 0, 1], 'limits': [-W['travel']['south'], -W['travel']['north']],
                           'kind': 'prismatic', 'stowed': -home})
    zl = zf(leg['dy'])
    # trolleys + wheels + travel drive
    trolley = (cq.Workplane('XY').box(trol['w'], trol['h'], trol['d']).translate((0, rail['h'] + 20 + trol['h'] / 2, zl))
               .edges('|Z').fillet(14)
               .cut(cq.Workplane('XY').box(trol['w'] - 16, trol['h'] - 16, trol['d'] - 16).translate((0, rail['h'] + 20 + trol['h'] / 2, zl))))
    y_ax = 8 + 100                                       # the axle: a 200 mm wheel standing on the rail's 8 mm floor
    for e in (-1, 1):
        wz_ = zl + e * (trol['d'] / 2 - 220)
        # the wheel's window in the floor plate (the side walls stay whole), and the axle holes through the side walls
        trolley = trolley.cut(cq.Workplane('XY').box(trol['w'] - 18, 120, 260).translate((0, rail['h'] + 20 + 30, wz_)))
        trolley = trolley.cut(cq.Workplane('YZ', origin=(-trol['w'], y_ax, wz_)).circle(25).extrude(2 * trol['w']))
    troll_pd = m.part(PartDef('WSH-TRL', 'Trolley weldment', trolley.val(), 'steel_yellow', 'structure', 'EN 1090-2 EXC2',
                              f'{trol["w"]:.0f} x {trol["h"]:.0f} x {trol["d"]:.0f}', 'S355J2', None,
                              'Carries one leg on 2 wheels and the travel drive.', {}, 'make'))
    wheel = (cq.Workplane('YZ').circle(100).extrude(30, both=True)
             .cut(cq.Workplane('YZ').circle(45).extrude(40, both=True)))        # the bearing's seat
    wheel_pd = m.part(PartDef('WSH-WHL', 'Travel wheel 200 x 60, polyurethane on steel hub', wheel.val(), 'pu', 'drive', 'catalogue part',
                              'D 200 x 60', '92 Shore A', None, 'Rolls in the rail channel. Quiet on wet steel.', {'load': '1,200 kg'}, 'buy'))
    # hollow-shaft helical-bevel gearmotor on the axle end, inside the trolley's inner wall: flange on the wall, gear
    # case on the axle (local +X away from the wall), the motor standing up off the gear case. (Outboard of the trolley
    # it stood 0.25 m into the outer wall of an end bay: design finding 8.)
    gmw = (cq.Workplane('XY').box(12, 180, 180).translate((6, 0, 0))
           .union(cq.Workplane('XY').box(120, 130, 120).translate((72, 0, 0)))
           .union(cq.Solid.makeCylinder(60, 170, Vector(72, 65, 0), Vector(0, 1, 0))))
    gmw_pd = m.part(PartDef('WSH-TGM', 'Travel gearmotor 0.75 kW, helical-bevel, brake, encoder', gmw.val(), 'steel_paint', 'drive',
                            'catalogue part', '0.75 kW, 4 pole', 'IP66, wash-down', None,
                            'Drives one wheel. The brake holds the machine still while it sprays.',
                            {'output': 'about 22 rpm', 'brake': '10 N m'}, 'buy', mass_override=24.0))
    guide = cq.Workplane('XZ').circle(30).extrude(18, both=True)
    guide_pd = m.part(PartDef('WSH-GRL', 'Side guide roller 60 mm', guide.val(), 'pu', 'drive', 'catalogue part', 'D 60', '', None,
                              'Keeps the wheel centred in its rail.', {}, 'buy'))
    axle = cq.Workplane('YZ', origin=(-trol['w'] / 2, 0, 0)).circle(25).extrude(trol['w'])
    axle_pd = m.part(PartDef('WSH-AXL', 'Wheel axle, 50 mm', axle.val(), 'steel', 'drive', 'machined', f'D 50 x {trol["w"]:.0f}',
                             'C45', None, 'Carries the wheel bearing between the trolley walls. The gearmotor drives it on the driven wheel.',
                             {}, 'make'))
    axb = cq.Workplane('XY').box(20, 140, 140).translate((10, 30, 0))
    axb_pd = m.part(PartDef('WSH-AXB', 'Axle end block', axb.val(), 'steel_s355', 'structure', 'cut plate', '140 x 140 x 20', 'S355J2',
                            None, 'Holds the idler wheel axle in the trolley wall.', {}, 'make'))
    for sx in (-1, 1):
        m.place(gan, troll_pd, loc(sx * legX, 0, 0), (sx * 260, 0, 0), 'TRAVEL')
        for e in (-1, 1):
            wz = zl + e * (trol['d'] / 2 - 220)
            m.place(gan, wheel_pd, loc(sx * legX, y_ax, wz), (sx * 420, -40, 0), 'TRAVEL')
            m.place(gan, std.ball_bearing('6210', 'Carries the wheel on its axle.'), loc(sx * legX, y_ax, wz, rz=90), (sx * 480, -40, 0), 'TRAVEL')
            m.place(gan, axle_pd, loc(sx * legX, y_ax, wz), (sx * 500, -40, 0), 'TRAVEL')
            for gx in (-1, 1):
                m.place(gan, guide_pd, loc(sx * legX + gx * (rail['w'] / 2 + 30), rail['h'] + 20 - 18, wz - e * 160), (sx * 360, -60, 0),
                        'TRAVEL')
            # the trolley's INNER wall: nothing stands outboard of the trolley, whose outer wall is 48 mm off an end
            # bay's outer wall (structurePlan.WASH_SHELL)
            face = sx * (legX - trol['w'] / 2)
            ry_in = 180 if sx > 0 else 0          # local +X points inboard, toward the car
            if e < 0:       # the idler: an end block over the axle
                m.place(gan, axb_pd, loc(face, y_ax, wz, ry=ry_in), (-sx * 560, 0, 0), 'TRAVEL')
                for yy in (y_ax, y_ax + 60):
                    for dz in (-50, 50):
                        std.bolt_stack(m, gan, 'TRAVEL', (face - sx * 20, yy, wz + dz), (sx, 0, 0), 12, 50, 28, nut_kind='',
                                       fn='Holds the axle end block to the trolley wall.', explode=(-sx * 600, 0, 0))
            else:           # the driven wheel: the gearmotor's flange over the axle
                m.place(gan, gmw_pd, loc(face, y_ax, wz, ry=ry_in), (-sx * 600, 0, 0), 'TRAVEL')
                for yy in (y_ax + 10, y_ax + 70):
                    for dz in (-70, 70):
                        std.bolt_stack(m, gan, 'TRAVEL', (face - sx * 12, yy, wz + dz), (sx, 0, 0), 10, 35, 20, nut_kind='',
                                       fn='Holds the travel gearmotor flange to the trolley.', explode=(-sx * 640, 0, 0))
    # legs + flanges
    leg_y0 = rail['h'] + 20 + trol['h']
    lh = leg['top'] - leg_y0
    legb = None
    for zc in (zl - leg['d'] / 2 + 100, zl + leg['d'] / 2 - 100):          # 2 posts, RHS 200 x 150 x 6
        post = (cq.Workplane('XY').box(leg['w'] - 40, lh, 200).translate((0, leg_y0 + lh / 2, zc))
                .cut(cq.Workplane('XY').box(leg['w'] - 52, lh + 2, 188).translate((0, leg_y0 + lh / 2, zc))))
        legb = post if legb is None else legb.union(post)
    for yy in (leg_y0 + lh * 0.3, leg_y0 + lh * 0.62):                       # cross braces, RHS 100 x 100 x 5
        legb = legb.union(cq.Workplane('XY').box(100, 100, leg['d'] - 400).translate((0, yy, zl))
                          .cut(cq.Workplane('XY').box(90, 90, leg['d'] - 398).translate((0, yy, zl))))
    for yy in (leg_y0 + 7.5, leg['top'] - 7.5):                               # a flange pad under and over each post
        for zc in (zl - leg['d'] / 2 + 100, zl + leg['d'] / 2 - 100):
            legb = legb.union(cq.Workplane('XY').box(leg['w'] + 60, 15, 300).translate((0, yy, zc)))
    leg_pd = m.part(PartDef('WSH-LEG', 'Portal leg weldment', legb.val(), 'steel_yellow', 'structure', 'EN 1090-2 EXC2',
                            f'{leg["w"]:.0f} x {leg["d"]:.0f} x {lh:.0f}', 'S355J2', None,
                            'Carries the beam over the trolley: 2 posts and 2 braces. Its flanges bolt top and bottom.',
                            {'posts': 'RHS 200 x 150 x 6', 'braces': 'SHS 100 x 100 x 5'}, 'make'))
    clad = cq.Workplane('XY').box(2, lh - 60, leg['d'] - 20).translate((0, leg_y0 + lh / 2, zl))
    post_x = (leg['w'] - 40) / 2                        # the posts' outer face, from the leg's centre
    clad_pd = m.part(PartDef('WSH-LCL', 'Leg cladding panel, aluminium 2 mm', clad.val(), 'al_extr', 'structure', 'sheet',
                             f'{leg["d"] - 20:.0f} x {lh - 60:.0f}', '5754-H22', None, 'Covers the leg frame. It keeps spray out of the frame.',
                             {}, 'make'))
    for sx in (-1, 1):
        m.place(gan, leg_pd, loc(sx * legX, 0, 0), (sx * 200, 0, 0), 'PORTAL')
        m.place(gan, clad_pd, loc(sx * (legX + post_x + 1), 0, 0), (sx * 420, 0, 0), 'PORTAL')
        for yy, d in ((leg_y0 + 15, (0, -1, 0)), (leg['top'] - 15, (0, 1, 0))):
            for zz in (zl - leg['d'] / 2 + 100 - 110, zl - leg['d'] / 2 + 100 + 110, zl + leg['d'] / 2 - 100 - 110,
                       zl + leg['d'] / 2 - 100 + 110):
                for xx in (-1, 1):
                    std.bolt_stack(m, gan, 'PORTAL', (sx * legX + xx * (leg['w'] / 2 + 18), yy, zz), d, 16, 60, 15 + 12,
                                   fn='Bolts the leg flange to the trolley or the beam. The lock nut holds under vibration.',
                                   explode=(sx * 200, -d[1] * 120, 0))
    # beam: 2 RHS 300 x 200 side by side (along z), joined by end plates
    bl = 2 * legX + leg['w']
    bz0, bz1 = zf(beam['dy0']), zf(beam['dy1'])
    bh = beam['y1'] - beam['y0']
    beamb = None
    ybc = (beam['y0'] + beam['y1']) / 2
    zmid = (bz0 + bz1) / 2
    for zc in (bz0 - 75, bz1 + 75):                                              # 2 chords, RHS 335 x 150 x 6
        b = (cq.Workplane('XY').box(bl, bh, 150).translate((0, ybc, zc))
             .cut(cq.Workplane('XY').box(bl + 2, bh - 12, 138).translate((0, ybc, zc))))
        beamb = b if beamb is None else beamb.union(b)
    for xc in (-bl / 2 + 60, -bl / 6, bl / 6, bl / 2 - 60):                       # cross members, SHS 120 x 120 x 5
        beamb = beamb.union(cq.Workplane('XY').box(120, 120, bz0 - bz1 - 300).translate((xc, ybc, zmid))
                            .cut(cq.Workplane('XY').box(110, 110, bz0 - bz1 - 298).translate((xc, ybc, zmid))))
    # the decks between the chords, flush with their faces: tools hang below the bottom one, drives stand on the top one
    dk_w = bz0 - bz1 - 300
    for (pid, nm, yd) in (('WSH-DKB', 'Beam bottom deck', beam['y0'] + 2), ('WSH-DKP', 'Beam top deck', beam['y1'] - 2)):
        deck = cq.Workplane('XY').box(bl, 4, dk_w).translate((0, yd, zmid))
        for sx in (-1, 1):                    # the top knife's lift columns pass through both decks
            deck = deck.cut(cq.Workplane('XY').box(140, 6, 140).translate((sx * KH_X, yd, zf(dry_dy) + dtop['d'] / 2 + 34)))
        m.place(gan, m.part(PartDef(pid, f'{nm}, aluminium checker plate 4 mm', deck.val(), 'al_extr', 'structure', 'EN 1386 tread plate',
                                    f'{bl:.0f} x {dk_w:.0f} x 4', '5754-H114', None,
                                    'Closes the beam between its chords and carries the tools hung below it and the drives on it.',
                                    {}, 'make')), Location(), (0, 400 if yd > beam['y0'] + 10 else 380, 0), 'PORTAL')
    m.place(gan, m.part(PartDef('WSH-BEAM', 'Portal beam weldment', beamb.val(), 'steel_yellow', 'structure', 'EN 1090-2 EXC2',
                                f'{bl:.0f} x {bh:.0f} x {bz0 - bz1:.0f}', 'S355J2', None,
                                'Spans the bay: 2 chords and 4 cross members, closed by a deck top and bottom into a box girder. Every tool '
                                'hangs below it at its own station, so none can meet another; the drives stand on top.',
                                {'stations (z, mm)': f'arch {zf(arch["dy"]):.0f}, wipe arms {zf(wipe["dy"]):.0f}, '
                                                     f'air knives {zf(dry_dy):.0f}'}, 'make')),
            Location(), (0, 400, 0), 'PORTAL')

    # ═══════════════════════════════════════════════════════════════ ARCH ═══
    za = zf(arch['dy'])
    ar = arch['r']
    archp = cq.Workplane('XY')
    pipes = []
    for sx in (-1, 1):
        pipes.append(cq.Workplane('XZ', origin=(sx * arch['x'], arch['top'], za)).circle(ar).circle(ar - 2).extrude(arch['top'] - 350))
    pipes.append(cq.Workplane('YZ', origin=(-arch['x'], arch['top'], za)).circle(ar).circle(ar - 2).extrude(2 * arch['x']))
    archp = pipes[0].union(pipes[1]).union(pipes[2])
    m.place(gan, m.part(PartDef('WSH-ARC', 'Spray arch manifold, 124 mm', archp.val(), 'ss316', 'fluid', 'EN 10217-7',
                                f'{2 * arch["x"]:.0f} x {arch["top"]:.0f}', '316L', None,
                                'Carries the pre-soak, the wash water and the rinse water to the nozzles. Stainless: wash chemicals do not touch carbon steel.',
                                {}, 'make')), Location(), (0, 0, 260), 'ARCH')
    noz = std.nozzle('fan', 'Makes a 15 degree flat fan. Its tip is the only part that wears.')
    for sx in (-1, 1):
        for k in range(arch['nozzles']):
            f = (k + 0.5) / arch['nozzles']
            y = 700 + f * (arch['top'] - 1200)
            m.place(gan, noz, std.orient((sx * (arch['x'] - ar), y, za), (-sx, 0, 0)), (sx * -120, 0, 300), 'ARCH')
    for k in range(5):
        m.place(gan, noz, std.orient((-1000 + k * 500, arch['top'] - ar, za), (0, -1, 0)), (0, -150, 300), 'ARCH')
    ahb_h = beam['y0'] - (arch['top'] + ar)
    ahb = cq.Workplane('XY').box(60, ahb_h, 12).translate((0, arch['top'] + ar + ahb_h / 2, za))
    ahb_pd = m.part(PartDef('WSH-AHB', 'Arch hanger strap, stainless', ahb.val(), 'ss316', 'structure', 'cut plate 12 mm',
                            f'60 x {ahb_h:.0f}', '316L', None, 'Hangs the arch top pipe from the bottom deck.', {}, 'make'))
    for x in (-1800, 0, 1800):
        m.place(gan, ahb_pd, loc(x, 0, 0), (0, 120, 300), 'ARCH')
    valve = cq.Workplane('XY').box(70, 90, 60).union(cq.Workplane('XY').circle(22).extrude(60).translate((0, 45, -30)))
    # each valve screws into its port on top of the manifold (G 1/2): its body stands on the manifold
    valve_pd = m.part(PartDef('WSH-VLV', 'Solenoid valve G 1/2, 24 V DC, stainless', valve.val(), 'ss316', 'fluid', 'catalogue part',
                              'G 1/2, 0-70 bar', 'IP65', None, 'Switches one chemical or the rinse water to the arch.', {}, 'buy'))
    for i, x in enumerate((-450, -150, 150, 450)):
        m.place(gan, valve_pd, loc(x, beam['y1'] + 60 + 45, za + 60), (0, 260, 200), 'ARCH')
    # each vertical pipe: 2 saddle clamps, each on a bracket from the leg's north post
    post_in = legX - (leg['w'] - 40) / 2
    clamp = (cq.Workplane('XZ', origin=(0, 20, 0)).circle(ar + 8).circle(ar).extrude(40)
             .union(cq.Workplane('XY').box(44, 40, 16).translate((ar + 4 + 22, 0, 0))))
    clamp_pd = m.part(PartDef('WSH-UBT', 'Pipe saddle clamp, stainless', clamp.val(), 'ss316', 'structure', 'DIN 3567 form A',
                              'for 124 pipe', '316L', None, 'Holds the arch pipe to its bracket.', {}, 'buy'))
    abr_l = post_in - (arch['x'] + ar + 48)
    abr = cq.Workplane('XY').box(abr_l, 60, 16).translate((arch['x'] + ar + 48 + abr_l / 2, 0, 0))
    abr_pd = m.part(PartDef('WSH-ABR', 'Arch bracket, stainless', abr.val(), 'ss316', 'structure', 'cut plate 16 mm',
                            f'{abr_l:.0f} x 60', '316L', None, 'Ties the arch pipe to the leg post.', {}, 'make'))
    for sx in (-1, 1):
        for y in (1200, 2400):
            T = loc(sx * arch['x'], y, za, ry=0 if sx > 0 else 180)
            m.place(gan, clamp_pd, T, (sx * 80, 0, 340), 'ARCH')
            m.place(gan, abr_pd, loc(0, y, za, ry=0 if sx > 0 else 180), (sx * 120, 0, 340), 'ARCH')

    # ════════════════════════════════════════════════════ LIFT COLUMNS (the top knife's) ═══
    def lift_columns(tag: str, jname: str, xs: tuple, z: float, foot_y: float, stroke: float, label: str, sub: str):
        """A tool's 2 lift columns: a sleeve fixed through the beam and TOP_SLIDES stages that
        slide inside it and each other, each a third of the stroke; at full travel each keeps 74 mm in the one outside it.
        The stages at both columns move as one (one cross shaft or one drive per tool), so stage k of both is one node.
        Returns the innermost stage's node (its foot at foot_y, stowed) and the sleeve's top and bottom."""
        trav = stroke / TOP_SLIDES
        st_l = trav + 100
        secs, walls = (140.0, 122.0, 106.0, 90.0), (5.0, 4.0, 4.0, 4.0)
        y_top = foot_y + 25 * TOP_SLIDES + st_l
        y_bot = y_top - 25 - trav - 74
        sl = (cq.Workplane('XZ', origin=(0, y_top, 0)).rect(secs[0], secs[0]).extrude(y_top - y_bot)
              .cut(cq.Workplane('XZ', origin=(0, y_top + 1, 0)).rect(secs[0] - 2 * walls[0], secs[0] - 2 * walls[0]).extrude(y_top - y_bot + 2)))
        sl_pd = m.part(PartDef(f'WSH-{tag}0', f'{label} sleeve, 140 x 140 x 5', sl.val(), 'ss316', 'structure', 'EN 10219',
                               f'{y_top - y_bot:.0f} long', '316L', None, 'Fixed through the beam. It guides the column\'s first stage.',
                               {'bottom': f'{y_bot / 1000:.2f} m above grade, above the car roof'}, 'make'))
        pad_pd = m.part(PartDef(f'WSH-{tag}P', f'{label} slide pad, UHMW-PE', cq.Workplane('XY').box(4, 60, 40).val(), 'pa66',
                                'bearing', 'machined', '4 x 60 x 40', 'UHMW-PE', None,
                                'Guides a stage in the one outside it. No grease to wash off.', {}, 'make'))
        for x in xs:
            m.place(gan, sl_pd, loc(x, 0, z), (x * 0.1, 300, 0), sub)
        parent = gan
        for k in range(1, TOP_SLIDES + 1):
            node = parent.child(f'{jname}{k}', Location(), sub=sub,
                                joint={'name': f'{jname}{k}', 'axis': [0, -1, 0], 'limits': [0, (trav + OVER_MM) / 1000],
                                       'kind': 'prismatic', 'stowed': 0})
            a, w = secs[k], walls[k]
            stage_top = y_top - 25 * k
            tube = (cq.Workplane('XZ', origin=(0, stage_top, 0)).rect(a, a).extrude(st_l)
                    .cut(cq.Workplane('XZ', origin=(0, stage_top + 1, 0)).rect(a - 2 * w, a - 2 * w).extrude(st_l + 2)))
            tube_pd = m.part(PartDef(f'WSH-{tag}{k}', f'{label} stage {k + 1}, {a:.0f} x {a:.0f}', tube.val(), 'ss316', 'structure',
                                     'EN 10219', f'{st_l:.0f} long', '316L', None,
                                     ('Slides a third of the travel. A belt over its pulley drives the next stage.' if k < TOP_SLIDES
                                      else 'Slides a third of the travel and carries the tool at its foot.'), {}, 'make'))
            gap = (secs[k - 1] - 2 * walls[k - 1] - a) / 2
            for x in xs:
                m.place(node, tube_pd, loc(x, 0, z), (x * 0.1, 300 - 80 * k, 0), sub)
                for ang in (0, 90, 180, 270):
                    m.place(node, pad_pd, loc(x, stage_top - 30, z, ry=ang) * loc(a / 2 + gap / 2, 0, 0), (x * 0.1, 300 - 80 * k, 0), sub)
            parent = node
        return parent, y_top, y_bot


    # ═══════════════════════════════════════════════════════ SENSOR-WIPE ARMS ═══
    # Two arms, one each side, on a cross rail under the beam (Chase, 2026-11-11: no brush; "an robot arm will locate all
    # sensors and hand wipe gently with a cloth"). Each is 4 axes on the gantry's own travel:
    #   X      a carriage on 2 profile rails under the bottom deck, rack driven, from its park beside the car's path in to
    #          WIPE_X_MIN from the drive line (the roof pod's side);
    #   DROP   a mast of a fixed sleeve and WIPE_SLIDES sliding stages, lowering the wrist from stowY to WIPE_LOW_MM;
    #   YAW    the wrist turns about the mast's axis: the forearm points in at the car (0), aft or fore (+/-90 deg);
    #   TILT   the pad swings on a hinge at the forearm's end, from face-down (stowed) to face-on (90 deg).
    # The pad's centre, face-on, stands `forearm` from the mast's axis: the twin's pose is this (washPose.wipeJoints).
    zw = zf(wipe['dy'])
    rw, rh, rbw, rbh, rbl = std.RAIL[25][0], std.RAIL[25][1], std.RAIL[25][2], std.RAIL[25][3], std.RAIL[25][4]
    y_ct = beam['y0'] - rbh                              # the carriage's top: the blocks' mounting faces
    y_cb = y_ct - 160                                    # its floor's underside
    x_trav = wipe['parkX'] - WIPE_X_MIN                  # each carriage's travel
    w_trav = (wipe['stowY'] - WIPE_LOW_MM) / WIPE_SLIDES   # each stage's travel
    w_stl = w_trav + 100                                 # a stage's length: its travel and 100 mm kept in the one outside
    w_foot = wipe['stowY'] + WIPE_WRIST                  # the last stage's foot, stowed
    w_top = w_foot + 25 * WIPE_SLIDES + w_stl            # the nested stages' top, stowed
    w_bot = w_top - 25 - w_trav - 74                     # the sleeve's bottom
    w_secs, w_walls = (110.0, 92.0, 76.0), (5.0, 4.0, 4.0)   # a 4 mm slide pad in each gap
    fa = wipe['forearm']
    padR, padT = wipe['padR'], wipe['padT']

    wcg = cq.Workplane('XY').box(300, 160, 300).cut(cq.Workplane('XY').box(284, 144, 284))
    wcg_pd = m.part(PartDef('WSH-WCG', 'Wipe arm carriage', wcg.val(), 'ss316', 'structure', 'machined weldment', '300 x 300 x 160',
                            '316L', None, 'Runs on 2 rails under the beam and carries one wipe arm across the bay.', {}, 'make'))
    # the sleeve hangs from the carriage floor on a flange and guides the first stage
    wsl = (cq.Workplane('XY').box(200, 10, 200).translate((0, y_cb - 5, 0))
           .union(cq.Workplane('XZ', origin=(0, y_cb - 10, 0)).rect(w_secs[0], w_secs[0]).extrude(y_cb - 10 - w_bot))
           .cut(cq.Workplane('XZ', origin=(0, y_cb + 1, 0)).rect(w_secs[0] - 2 * w_walls[0], w_secs[0] - 2 * w_walls[0])
                .extrude(y_cb + 2 - w_bot)))
    wsl_pd = m.part(PartDef('WSH-WM0', 'Wipe arm mast sleeve, 110 x 110 x 5, with flange', wsl.val(), 'ss316', 'structure', 'EN 10219',
                            f'{y_cb - w_bot:.0f} long', '316L', None,
                            'Hangs from the carriage. It guides the mast\'s first stage.',
                            {'bottom': f'{w_bot / 1000:.2f} m above grade, above the car roof and its pod'}, 'make'))
    wpad_pd = m.part(PartDef('WSH-WMP', 'Wipe arm mast slide pad, UHMW-PE', cq.Workplane('XY').box(4, 60, 40).val(), 'pa66',
                             'bearing', 'machined', '4 x 60 x 40', 'UHMW-PE', None,
                             'Guides a mast stage in the one outside it. No grease to wash off.', {}, 'make'))
    wst_pd = []
    for k in range(1, WIPE_SLIDES + 1):
        a, w = w_secs[k], w_walls[k]
        st_top = w_top - 25 * k
        tube = (cq.Workplane('XZ', origin=(0, st_top, 0)).rect(a, a).extrude(w_stl)
                .cut(cq.Workplane('XZ', origin=(0, st_top + 1, 0)).rect(a - 2 * w, a - 2 * w).extrude(w_stl + 2)))
        wst_pd.append(m.part(PartDef(f'WSH-WM{k}', f'Wipe arm mast stage {k + 1}, {a:.0f} x {a:.0f}', tube.val(), 'ss316', 'structure',
                                     'EN 10219', f'{w_stl:.0f} long', '316L', None,
                                     ('Slides half the drop. A belt over its pulley drives the next stage.' if k < WIPE_SLIDES
                                      else 'Slides half the drop and carries the wrist at its foot.'), {}, 'make')))
    # the mast drive: a servo gearmotor with a brake on the sleeve's outboard face; a belt inside the mast lifts the stages
    wmm = (cq.Workplane('XY').box(12, 150, 100).translate((6, 0, 0))
           .union(cq.Workplane('XY').box(90, 100, 90).translate((12 + 45, 0, 0)))
           .union(cq.Workplane('XZ', origin=(12 + 45, 50, 0)).circle(38).extrude(-150)))
    wmm_pd = m.part(PartDef('WSH-WMM', 'Mast servo gearmotor 0.2 kW, brake, absolute encoder', wmm.val(), 'steel_paint', 'drive',
                            'catalogue part', '0.2 kW', 'IP66, wash-down', None,
                            'Raises and lowers the mast by a belt inside it. Its brake holds the mast when power is off.', {}, 'buy',
                            mass_override=7.5))
    # the mast's foot: a plate closing the last stage, and the wrist's turn actuator under it
    wfp = cq.Workplane('XY').box(100, 10, 100).translate((0, w_foot - 5, 0))
    wfp_pd = m.part(PartDef('WSH-WFP', 'Mast foot plate, stainless', wfp.val(), 'ss316', 'structure', 'cut plate 10 mm', '100 x 100',
                            '316L', None, 'Closes the mast\'s last stage and carries the wrist.', {}, 'make'))
    wya = cq.Workplane('XZ', origin=(0, w_foot - 10, 0)).circle(55).extrude(100)
    wya_pd = m.part(PartDef('WSH-WYA', 'Wrist turn actuator, hollow shaft, 30 Nm, IP67', wya.val(), 'al6061', 'drive', 'catalogue part',
                            'D 110 x 100', 'IP67', None,
                            'Turns the forearm about the mast\'s axis, so the pad faces the flank, the nose or the tail.',
                            {'travel': '+/- 90 deg'}, 'buy', mass_override=3.2))
    # the forearm (built pointing +X; the right arm's is turned half round): a drop from the actuator's output to the
    # forearm's axis, the forearm, and a fork for the tilt hinge WIPE_HINGE behind the pad's centre
    y_fa = wipe['stowY']
    xh = fa - WIPE_HINGE
    wfa = (cq.Workplane('XZ', origin=(0, w_foot - 110, 0)).circle(40).extrude(12)
           .union(cq.Workplane('XZ', origin=(0, w_foot - 122, 0)).circle(22).extrude(w_foot - 122 - y_fa + 22))
           .union(cq.Workplane('YZ', origin=(0, y_fa, 0)).circle(22).extrude(xh - 34))
           .union(cq.Workplane('XY').box(68, 50, 8).translate((xh, y_fa, 34)))
           .union(cq.Workplane('XY').box(68, 50, 8).translate((xh, y_fa, -34)))
           .union(cq.Workplane('XY').box(10, 50, 76).translate((xh - 39, y_fa, 0)))
           # a tab each side of the drop, under the turn actuator's flange: the camera on one, the water nozzle on the other
           .union(cq.Workplane('XY').box(40, 44, 21).translate((10, y_fa + 47, 47.5)))
           .union(cq.Workplane('XY').box(40, 30, 21).translate((10, y_fa + 47, -47.5)))
           .cut(cq.Workplane('YZ', origin=(22, y_fa + 47, -47.5)).circle(5.2).extrude(10)))
    wfa_pd = m.part(PartDef('WSH-WFA', 'Wrist forearm with hinge fork, stainless', wfa.val(), 'ss316', 'structure', 'welded, machined',
                            f'{fa:.0f} reach', '316L', None,
                            'Carries the pad out from the mast, so the mast stays clear of the car while the pad is on it.', {}, 'make'))
    wta = cq.Workplane('XY', origin=(0, 0, 38)).circle(30).extrude(70)
    wta_pd = m.part(PartDef('WSH-WTA', 'Wrist tilt actuator, 12 Nm, IP67', wta.val(), 'al6061', 'drive', 'catalogue part', 'D 60 x 70',
                            'IP67', None, 'Swings the pad from face-down, stowed, to face-on to the car.', {'travel': '90 deg'}, 'buy',
                            mass_override=1.4))
    wcm = (cq.Workplane('XY').box(60, 44, 44).union(cq.Workplane('YZ', origin=(30, 0, 0)).circle(16).extrude(14)))
    wcm_pd = m.part(PartDef('WSH-WCM', 'Sensor-finding camera with ring light, IP67', wcm.val(), 'pa66', 'sensor', 'catalogue part',
                            '60 x 44 x 44', 'IP67', None,
                            'Finds each camera, lidar and radar cover on the car, so the pad goes to the sensor and not to the paint.',
                            {}, 'buy', mass_override=0.35))
    wmn = std.nozzle('fan', 'Mists the sensor cover with pure water before the pad swings up. A damp wipe lifts the film a dry pad would drag.')
    # the pad head, in the hinge's frame (origin on the hinge axis, the pad face-down below it): a hub, a force sensor, a sprung
    # plate, and the pad. The pad's mid-thickness stands WIPE_HINGE below the hinge.
    y_p0, y_p1 = -WIPE_HINGE + padT / 2, -WIPE_HINGE - padT / 2
    hub_l = abs(y_p0) - 23                               # the hub's stub, from the hinge axis down to the force sensor
    whb = (cq.Workplane('XY').circle(20).extrude(30, both=True)
           .union(cq.Workplane('XY').box(30, hub_l, 30).translate((0, -hub_l / 2, 0))))
    whb_pd = m.part(PartDef('WSH-WHB', 'Pad hinge hub, stainless', whb.val(), 'ss316', 'structure', 'machined', 'D 40 x 60', '316L', None,
                            'Turns in the forearm\'s fork and carries the pad head.', {}, 'make'))
    wfs = cq.Workplane('XZ', origin=(0, y_p0 + 23, 0)).circle(30).extrude(12)
    wfs_pd = m.part(PartDef('WSH-WFS', 'Force sensor, 50 N, IP67', wfs.val(), 'al6061', 'sensor', 'catalogue part', 'D 60 x 12', 'IP67',
                            None, 'Measures the pad\'s push on the car. The arm stops its push at the set limit.',
                            {'limit': '10 N (ASSUMPTION, to be set on test)'}, 'buy', mass_override=0.2))
    # the plate is 45 mm smaller in radius than the pad: beside the roof pod its rim stands 55 mm above the roof, and the
    # pad's own foam rim is all that comes near the paint
    wpp = cq.Workplane('XZ', origin=(0, y_p0 + 11, 0)).circle(padR - 45).extrude(11)
    wpp_pd = m.part(PartDef('WSH-WPP', 'Pad plate on springs, 6 mm travel', wpp.val(), 'al6061', 'tool', 'machined, 4 springs',
                            f'D {2 * (padR - 45):.0f} x 11', '6061-T6', None,
                            'Lets the pad give 6 mm, so it follows a curved cover with an even, light push.', {}, 'make'))
    wpd = cq.Workplane('XZ', origin=(0, y_p0, 0)).circle(padR).extrude(padT)
    wpd_pd = m.part(PartDef('WSH-WPD', 'Wipe pad, microfibre on foam, hook-and-loop', wpd.val(), 'pad_white', 'tool', 'consumable',
                            f'D {2 * padR:.0f} x {padT:.0f}', 'lint-free microfibre', None,
                            'The only part that touches the car. It wipes a sensor cover as a soft cloth in a hand does.',
                            {'change': 'each shift, by hand, in seconds'}, 'buy', mass_override=0.12))
    # the carriage drive: a gearmotor on the carriage's south face, its pinion on a rack under the deck
    pin = cq.Workplane('XZ', origin=(0, 10, 0)).circle(22).extrude(20).union(cq.Workplane('XZ', origin=(0, 10, 0)).circle(8).extrude(40))
    pin_pd = m.part(PartDef('WSH-PIN', 'Pinion module 2, 20 teeth, stainless', pin.val(), 'ss316', 'drive', 'DIN 867 tooth form',
                            '20 T, m 2', '', None, 'Drives the wipe arm carriage along its rack.', {}, 'buy'))
    cgm = (cq.Workplane('XY').box(90, 90, 90).union(cq.Workplane('YZ', origin=(45, 0, 0)).circle(45).extrude(160)))
    cgm_pd = m.part(PartDef('WSH-CGM', 'Carriage gearmotor 0.37 kW, brake, encoder, right-angle', cgm.val(), 'steel_paint', 'drive',
                            'catalogue part', '0.37 kW', 'IP66, wash-down', None,
                            'Moves the wipe arm across the bay.', {}, 'buy', mass_override=12.0))
    rk_l = x_trav + 300
    rk_pd = m.part(PartDef('WSH-WRK', 'Gear rack module 2, 20 x 20, stainless', cq.Workplane('XY').box(rk_l, 20, 20).val(), 'ss316',
                           'drive', 'DIN 867 tooth form', f'{rk_l:.0f} long', '', None, 'The carriage pinion runs along it.', {}, 'buy'))
    rail_l = round((x_trav + 380) / 60) * 60
    z_cgm = zw - 150 - 45
    wk_link = std.chain_link(38, 25, 38)
    # the chain's fixed end stands 200 mm outboard of the carriage's park; fully in, its bend stands just inboard of the carriage
    R_wk, n_wk = 90.0, math.ceil((x_trav + 200 + math.pi * 90.0 + 60) / 38)
    y_wf = beam['y0'] - 14.5                             # the chain's fixed run, its links against the deck
    z_wk = zw + 150 + 47                                 # 28 mm off the carriage's north face
    wkf = cq.Workplane('XY').box(40, 27, 38)
    wkm = cq.Workplane('XY').box(60, 50, 28)
    wgl = cq.Workplane('XY').box(30, 40, 30)
    for sx, name in ((-1, 'L'), (1, 'R')):
        x = sx * wipe['parkX']
        T = loc(0, 0, 0, ry=0 if sx < 0 else 180)        # the parts built pointing +X: the left arm's inboard is +X
        cx = gan.child(f'WipeX{name}', Location(), sub='WIPE',
                       joint={'name': f'WIPE_{name}_X', 'axis': [-sx, 0, 0], 'limits': [0, (x_trav + OVER_MM) / 1000],
                              'kind': 'prismatic', 'stowed': 0})
        m.place(cx, wcg_pd, loc(x, y_ct - 80, zw), (0, -120, 0), 'WIPE')
        m.place(cx, wsl_pd, loc(x, 0, zw), (sx * 60, -200, 0), 'WIPE')
        m.place(cx, wmm_pd, loc(x, (y_cb + w_top) / 2, zw) * loc(0, 0, 0, ry=0 if sx > 0 else 180) * loc(w_secs[0] / 2, 0, 0),
                (sx * 260, -160, 0), 'WIPE')
        for dy in (-62, 62):
            for dz in (-35, 35):
                m.place(cx, std.shcs(6, 16, 'A4-80', 'Holds the mast gearmotor to the sleeve.'),
                        std.orient((x + sx * (w_secs[0] / 2 + 12), (y_cb + w_top) / 2 + dy, zw + dz), (-sx, 0, 0)),
                        (sx * 300, -160, 0), 'WIPE')
        for zz in (-110, 110):
            m.place(cx, std.rail_block(25), loc(x, beam['y0'], zw + zz, ry=90, rx=180), (0, 60, 0), 'WIPE')
            for dx in (-rbl * 0.26, rbl * 0.26):
                for dz in (-rbw * 0.36, rbw * 0.36):
                    m.place(cx, std.shcs(6, 16, 'A4-80', 'Holds the rail block to the carriage, from inside it.'),
                            std.orient((x + dx, y_ct - 8, zw + zz + dz), (0, 1, 0)), (0, 90, 0), 'WIPE')
        for dx in (-78, 78):
            for dz in (-78, 78):
                m.place(cx, std.hex_bolt(8, 25, 'A4-70', 'Holds the mast sleeve\'s flange under the carriage floor.'),
                        std.orient((x + dx, y_cb - 10, zw + dz), (0, 1, 0)), (sx * 60, -230, 0), 'WIPE')
        xg = x - sx * 60
        m.place(cx, pin_pd, loc(xg, beam['y0'] - 11, z_cgm), (sx * 120, 0, -120), 'WIPE')
        m.place(cx, cgm_pd, loc(xg, beam['y0'] - 41 - 45, z_cgm, ry=0 if sx > 0 else 180), (sx * 160, 0, -220), 'WIPE')
        for dx in (-30, 30):
            for dy in (-30, 30):
                m.place(cx, std.hex_bolt(8, 25, 'A4-70', 'Holds the carriage gearmotor to the carriage, from inside it.'),
                        std.orient((xg + dx, beam['y0'] - 86 + dy, zw - 150 + 8), (0, 0, -1)), (sx * 160, 0, -240), 'WIPE')
        # the rack under the deck, south of the carriage; the 2 rails, a screw in every other counterbored hole
        x_mid = sx * (WIPE_X_MIN + wipe['parkX']) / 2
        m.place(gan, rk_pd, loc(x_mid - sx * 60, beam['y0'] - 10, z_cgm - 22 - 10), (0, 80, 0), 'WIPE')
        for zz in (-110, 110):
            m.place(gan, std.rail(25, rail_l), loc(x_mid, beam['y0'], zw + zz, ry=90, rx=180), (0, 100, 0), 'WIPE')
            for i in range(0, int(rail_l / 60), 2):
                m.place(gan, std.shcs(6, 20, 'A4-80', 'Holds the wipe arm rail to the bottom deck.'),
                        std.orient((x_mid - rail_l / 2 + 30 + 60 * i, beam['y0'] - rh + rh * 0.45, zw + zz), (0, 1, 0)),
                        (0, 150, 0), 'WIPE')
        # the mast's stages, each a node sliding down in the one outside it
        parent = cx
        for k in range(1, WIPE_SLIDES + 1):
            node = parent.child(f'WipeDrop{name}{k}', Location(), sub='WIPE',
                                joint={'name': f'WIPE_{name}_DROP{k}', 'axis': [0, -1, 0], 'limits': [0, (w_trav + OVER_MM) / 1000],
                                       'kind': 'prismatic', 'stowed': 0})
            a = w_secs[k]
            gap = (w_secs[k - 1] - 2 * w_walls[k - 1] - a) / 2
            m.place(node, wst_pd[k - 1], loc(x, 0, zw), (sx * 60, -200 - 80 * k, 0), 'WIPE')
            for ang in (0, 90, 180, 270):
                m.place(node, wpad_pd, loc(x, w_top - 25 * k - 30, zw, ry=ang) * loc(a / 2 + gap / 2, 0, 0),
                        (sx * 60, -200 - 80 * k, 0), 'WIPE')
            parent = node
        m.place(parent, wfp_pd, loc(x, 0, zw), (sx * 60, -420, 0), 'WIPE')
        m.place(parent, wya_pd, loc(x, 0, zw), (sx * 60, -460, 0), 'WIPE')
        # the wrist: it turns about the mast's axis (the node's origin stands on it)
        yaw = parent.child(f'WipeYaw{name}', loc(x, 0, zw), sub='WIPE',
                           joint={'name': f'WIPE_{name}_YAW', 'axis': [0, 1, 0], 'limits': [-1.62, 1.62], 'kind': 'revolute', 'stowed': 0})
        m.place(yaw, wfa_pd, T, (-sx * 80, -520, 0), 'WIPE')
        m.place(yaw, wta_pd, T * loc(xh, y_fa, 0), (-sx * 80, -520, 160), 'WIPE')
        m.place(yaw, wcm_pd, T * loc(10, y_fa + 47, 58 + 22), (-sx * 80, -440, 120), 'WIPE')
        m.place(yaw, wmn, T * std.orient((30, y_fa + 47, -47.5), (1, 0, 0)), (-sx * 80, -440, -120), 'WIPE')
        # the pad head: it tilts on the fork's hinge
        tilt = yaw.child(f'WipeTilt{name}', T * loc(xh, y_fa, 0), sub='WIPE',
                         joint={'name': f'WIPE_{name}_TILT', 'axis': [0, 0, 1], 'limits': [-0.05, 1.62],
                                'kind': 'revolute', 'stowed': 0})
        m.place(tilt, whb_pd, Location(), (-sx * 120, -560, 0), 'WIPE')
        m.place(tilt, wfs_pd, Location(), (-sx * 120, -600, 0), 'WIPE')
        m.place(tilt, wpp_pd, Location(), (-sx * 120, -640, 0), 'WIPE')
        m.place(tilt, wpd_pd, Location(), (-sx * 120, -700, 0), 'WIPE')
        # the carriage's power and signals: a cable chain under the deck, its bend rolling along as the carriage moves
        x_f = x + sx * 200
        m.flex(FlexDef(f'WSH-WKC{name}', 'Cable chain 38 x 25, R 90', 'chain',
                       Anchor(gan, (x_f, y_wf, z_wk), (-sx, 0, 0)), Anchor(cx, (x, y_wf - 2 * R_wk, z_wk), (-sx, 0, 0)),
                       12.5, 'WIPE', 'Carries the arm\'s motor cables, its camera cable and its water line to the moving carriage.',
                       mat='pa66', category='electrical', pitch=38, bend_r=R_wk, links=n_wk, up=(0, -1, 0), w=38, h=25,
                       link_part=wk_link, kg_per_m=0.9,
                       spec={'carries': '4 motor cables, camera and sensor cables, a 6 mm pure-water line'}))
        m.place(gan, m.part(PartDef('WSH-WKF', 'Cable chain end bracket, stainless', wkf.val(), 'ss316', 'structure', 'bent plate',
                                    '40 x 38', '316L', None, 'Holds the chain\'s fixed end under the deck.', {}, 'make')),
                loc(x_f + sx * 20, beam['y0'] - 13.5, z_wk), (sx * 60, 40, 60), 'WIPE')
        m.place(cx, m.part(PartDef('WSH-WKK', 'Cable chain carrier bracket, stainless', wkm.val(), 'ss316', 'structure', 'bent plate',
                                   '60 x 50', '316L', None, 'Joins the chain\'s moving end to the carriage.', {}, 'make')),
                loc(x, y_wf - 2 * R_wk + 12.5, zw + 150 + 14), (0, -40, 60), 'WIPE')
        # the mast's line: from a gland on the sleeve's foot down to the wrist, paid out as the mast goes down
        z_wc = zw + (w_secs[0] / 2 + 15)
        m.place(cx, m.part(PartDef('WSH-WGL', 'Cable gland block, stainless', wgl.val(), 'ss316', 'electrical', 'machined',
                                   '30 x 40 x 30', '316L', None, 'Takes the wrist\'s line out of the sleeve\'s side at its foot.', {}, 'make')),
                loc(x, w_bot + 20, z_wc), (sx * 60, -260, 80), 'WIPE')
        m.flex(FlexDef(f'WSH-WWC{name}', 'Wrist line: 2 motor cables, camera, sensor, 6 mm water, in a PUR jacket', 'stretch',
                       Anchor(cx, (x, w_bot, z_wc), (0, -1, 0)), Anchor(parent, (x, w_foot - 60, z_wc), (0, 1, 0)),
                       7.5, 'WIPE', 'Feeds the wrist, the camera and the pad\'s water nozzle as the mast goes down.',
                       style='coil', lmin=0, lmax=w_bot - (w_foot - 60) + WIPE_SLIDES * (w_trav + OVER_MM) + 40, kg_per_m=0.3,
                       size='OD 15', standard='EN 50525'))

    # ═══════════════════════════════════════════════════════════════ DRYERS ═══
    zd = zf(dry_dy)
    z_kh = zd + dtop['d'] / 2 + 34                       # over the knife brackets' flanges, inboard of the beam's chord
    y_kf = dtop['retractY'] + dtop['h'] + 120            # the flanges' top, stowed
    dt, kt_top, kt_bot = lift_columns('KH', 'DRYER_TOP', (-KH_X, KH_X), z_kh, y_kf, dtop['retractY'] - TOP_LOW_MM,
                                      'Top air knife lift column', 'DRYER')
    # the innermost stage's foot plate stands on its bracket flange; a servo gearmotor on each sleeve drives its column
    kfp_pd = m.part(PartDef('WSH-KFP', 'Lift column foot plate', cq.Workplane('XY').box(82, 8, 82).val(), 'ss316', 'structure',
                            'cut plate 8 mm', '82 x 82', '316L', None, 'Closes the column foot and bolts to the knife bracket.', {}, 'make'))
    kdm = cq.Workplane('XY').box(120, 140, 120).edges('|Y').fillet(10)
    kdm_pd = m.part(PartDef('WSH-KDM', 'Top knife lift servo gearmotor 0.4 kW, brake', kdm.val(), 'steel_paint', 'drive', 'catalogue part',
                            '0.4 kW', 'IP66', None, 'Drives its column by a toothed belt. Its brake holds the knife with power off.',
                            {}, 'buy', mass_override=7.5))
    for sx in (-1, 1):
        m.place(dt, kfp_pd, loc(sx * KH_X, y_kf + 4, z_kh), (sx * 30, -120, 0), 'DRYER')
        m.place(gan, kdm_pd, loc(sx * (KH_X - 130), kt_top - 80, z_kh), (sx * 60, 420, 0), 'DRYER')
    kc = (0, dtop['retractY'] + dtop['h'] / 2, zd)
    knife = (cq.Workplane('XY').box(2 * dtop['halfLen'], dtop['h'], dtop['d']).translate(kc)
             .cut(cq.Workplane('XY').box(2 * dtop['halfLen'] - 6, dtop['h'] - 4, dtop['d'] - 4).translate(kc))
             .union(cq.Workplane('XY').box(2 * dtop['halfLen'] - 30, 6, 8).translate((0, dtop['retractY'] + 3, zd))))
    m.place(dt, m.part(PartDef('WSH-DKT', 'Top air knife, stainless', knife.val(), 'ss316', 'tool', 'made to order',
                               f'{2 * dtop["halfLen"]:.0f} long', '', None, 'Blows a sheet of air down over the car top. It follows the shape.',
                               {}, 'make')), Location(), (0, -200, 0), 'DRYER')
    # the top knife's duct: a concertina duct from the beam's underside down to the knife top, drawn out and folded by the
    # lift. It runs 0.26 to 2.26 m as the knife drops 2 m to the hood (a PU bellows folds to about 15 %: design finding 15)
    m.flex(FlexDef('WSH-DDU', 'Concertina duct, 380 x 160, coated fabric on a steel coil frame', 'stretch',
                   Anchor(gan, (0, beam['y0'], zd), (0, -1, 0)), Anchor(dt, (0, dtop['retractY'] + dtop['h'], zd), (0, -1, 0)),
                   80.0, 'DRYER', 'Feeds the top knife from its blower. It folds as the knife goes up and stretches as it goes down.',
                   mat='hose', category='fluid', style='bellows', w=380, h=160, xd=(1, 0, 0), lmin=200, lmax=2400, kg_per_m=3.0,
                   size='380 x 160', spec={'type': 'concertina duct on a steel coil frame',
                                           'compressed': '0.26 m at the top, 11 % of its 2.4 m (the class: 5 to 8 %)'}))
    blower = (cq.Workplane('YZ').circle(260).extrude(280, both=True).union(cq.Workplane('XY').box(300, 260, 300).translate((380, 0, 0)))
              .union(cq.Workplane('XY').box(640, 14, 400).translate((80, -260 - 7, 0))))      # its base plate
    blow_pd = m.part(PartDef('WSH-BLW', 'Centrifugal blower 4 kW, wash-down', blower.val(), 'steel_paint', 'drive', 'catalogue part',
                             '4 kW, 2 pole', 'IP55', None, 'Makes the drying air. The air leaves the knives at high speed.',
                             {'class': 'carwash dryer, 3-4 kW per fan'}, 'buy', mass_override=95.0))
    m.place(gan, blow_pd, loc(-900, beam['y1'] + 14 + 260, zd), (0, 400, 0), 'DRYER')
    for sx, name in ((-1, 'L'), (1, 'R')):
        ds = gan.child(f'DryerSide{name}', Location(), sub='DRYER',
                       joint={'name': f'DRYER_SIDE_{name}', 'axis': [-sx, 0, 0], 'limits': [0, (dside['retractX'] - 1200) / 1000],
                              'kind': 'prismatic', 'stowed': 0})
        x = sx * (dside['retractX'] + dside['w'] / 2)
        kc2 = (x, (dside['y0'] + dside['y1']) / 2, zd)
        k2 = (cq.Workplane('XY').box(dside['w'], dside['y1'] - dside['y0'], dside['d'])
              .cut(cq.Workplane('XY').box(dside['w'] - 4, dside['y1'] - dside['y0'] - 6, dside['d'] - 4)))
        m.place(ds, m.part(PartDef('WSH-DKS', 'Side air knife, stainless', k2.val(), 'ss316', 'tool', 'made to order',
                                   f'{dside["y1"] - dside["y0"]:.0f} tall', '', None, 'Blows the water off one flank.', {}, 'make')),
                loc(*kc2), (sx * 260, 0, 0), 'DRYER')
        m.place(gan, blow_pd, loc(sx * (legX - 800), beam['y1'] + 14 + 260, zd, ry=0), (sx * 200, 400, 0), 'DRYER')

    # ═══════════════════════════════════════════════ fastener sets, by station ═══
    # cladding panels: a column of 8 button heads down each post
    for sx in (-1, 1):
        for i in range(8):
            for zz in (zl - leg['d'] / 2 + 100, zl + leg['d'] / 2 - 100):
                yy = leg_y0 + 120 + i * (lh - 240) / 7
                m.place(gan, std.bhcs(6, 16, 'A4-80', 'Holds the cladding panel to the leg post.'),
                        std.orient((sx * (legX + post_x + 2), leg_y0 + 120 + i * (lh - 240) / 7, zz), (-sx, 0, 0)),
                        (sx * 460, 0, 0), 'PORTAL')
    # the lift columns' sleeves: a clamp plate round each under the bottom deck, 4 x M8 into the deck
    for (tag, xs_, zc_, half, sub_) in (('WSH-KCL', (-KH_X, KH_X), z_kh, 90.0, 'DRYER'),):
        cl = cq.Workplane('XY').box(2 * half, 12, 2 * half).cut(cq.Workplane('XY').box(140, 14, 140))
        cl_pd = m.part(PartDef(tag, 'Lift column clamp plate, stainless', cl.val(), 'ss316', 'structure', 'cut plate 12 mm',
                               f'{2 * half:.0f} x {2 * half:.0f}', '316L', None, 'Holds a lift column sleeve under the bottom deck.', {}, 'make'))
        for x in xs_:
            m.place(gan, cl_pd, loc(x, beam['y0'] - 6, zc_), (x * 0.1, 140, 0), sub_)
            for dx in (-(half - 10 if half < 100 else 88), half - 10 if half < 100 else 88):
                for dz in (dx, -dx):
                    m.place(gan, std.shcs(8, 20, 'A4-80', 'Holds the lift column clamp plate to the bottom deck.'),
                            std.orient((x + dx, beam['y0'] - 12, zc_ + dz), (0, 1, 0)), (x * 0.1, 160, 0), sub_)
    # blowers: 4 x M10 feet each
    for bx in (-900, -(legX - 800), legX - 800):
        for fx in (-150, 150):
            for fz in (-150, 150):
                zf_ = zd + fz * 110 / 150
                std.bolt_stack(m, gan, 'DRYER', (bx + 80 + fx, beam['y1'] + 14, zf_), (0, -1, 0), 10, 40,
                               14 + (6 if zf_ < bz1 + 150 else 4),
                               fn='Holds the blower foot to the beam frame, on a rubber mount.', explode=(0, 430, 0))
    # air knife hanger brackets
    kb = (cq.Workplane('XY').box(60, 120, 8).union(cq.Workplane('XY').box(60, 8, 60).translate((0, 56, 26))))
    kb_pd = m.part(PartDef('WSH-KBR', 'Air knife bracket, stainless', kb.val(), 'ss316', 'structure', 'bent sheet 8 mm', '60 x 120',
                           '316L', None, 'Hangs an air knife from its slide.', {}, 'make'))
    for xb in (-dtop['halfLen'] + 200, -KH_X, KH_X, dtop['halfLen'] - 200):     # the 2 inner ones under the lift columns
        m.place(dt, kb_pd, loc(xb, dtop['retractY'] + dtop['h'] + 60, zd + dtop['d'] / 2 + 4), (0, -150, 80), 'DRYER')
        for dy in (-30, 30):
            m.place(dt, std.shcs(8, 20, 'A4-80', 'Holds the bracket to the air knife.'),
                    std.orient((xb, dtop['retractY'] + dtop['h'] + 60 + dy, zd + dtop['d'] / 2 + 8), (0, 0, -1)), (0, -150, 120), 'DRYER')
    # solenoid valves: 2 x M6 each; stop light: 4 x M6; cabinet: 4 x M10

    # ═══════════════════════════════════════════ drives the first pass left implicit ═══
    # side air knives: a flexible duct loop each, from the beam's underside over the knife's home to the knife top. The knife
    # slides in 1.46 m; the loop bows in toward the car, never out into the leg
    dsc = cq.Workplane('XZ').circle(80).circle(76).extrude(15)                  # local: y 0 .. -15
    dsc_pd = m.part(PartDef('WSH-DSC', 'Duct collar 160 mm, stainless', dsc.val(), 'ss316', 'fluid', 'rolled sheet 4 mm', 'D 160 x 15',
                            '316L', None, 'Takes the flexible duct\'s end. A hose clamp holds the duct on it.', {}, 'make'))
    for sx, name in ((-1, 'L'), (1, 'R')):
        node = next(c for c in gan.children if c.name == f'DryerSide{name}')
        x = sx * (dside['retractX'] + dside['w'] / 2)
        m.place(gan, dsc_pd, loc(x, beam['y0'], zd), (sx * 60, 100, 0), 'DRYER')
        m.place(node, dsc_pd, loc(x, dside['y1'] + 15, zd), (sx * 60, 60, 0), 'DRYER')
        m.flex(FlexDef(f'WSH-DDS{name}', 'Flexible duct, 170 mm, PU with wire helix', 'loop',
                       Anchor(gan, (x, beam['y0'] - 15, zd), (0, -1, 0)), Anchor(node, (x, dside['y1'] + 15, zd), (0, -1, 0)),
                       85.0, 'DRYER', 'Feeds a side knife from its blower. Its loop swings in as the knife closes on the car.',
                       mat='hose', category='fluid', length=2700, min_bend=280, bulge=(0.0, (-sx, 0, 0), (-sx, 0, 0)), kg_per_m=1.1,
                       size='D 170', spec={'bend radius': 'about 2 x the static 138 mm of a 150 mm wire duct (rule of thumb)'}))
    # arch: a valve manifold on the beam and the feed hose down to the arch's top pipe
    man = cq.Workplane('XY').box(1100, 60, 60).translate((0, beam['y1'] + 30, za + 60))
    m.place(gan, m.part(PartDef('WSH-MAN', 'Valve manifold, stainless, 4 stations', man.val(), 'ss316', 'fluid', 'machined',
                                '1100 x 60 x 60', '316L', None, 'Carries foam, rinse water and the 2 chemicals to the valves.', {}, 'make')),
            Location(), (0, 240, 200), 'ARCH')
    # the feed hose leaves the manifold's north face, runs down outside the beam's north face, and comes in onto the arch
    zn, xf = bz0 + 60, 400
    feed = std.swept('WSH-AFH', 'Arch feed hose, 1 in, stainless braid',
                     [(xf, beam['y1'] + 30, za + 90), (xf, beam['y1'] + 30, zn), (xf, beam['y0'] - 40, zn),
                      (xf, arch['top'] + ar + 60, za), (xf, arch['top'] + ar + 1, za)],
                     14, 'hose', 'fluid', 10, 'Brings the switched liquid from the manifold to the arch.', {'pressure': '70 bar'},
                     'EN 853', 'DN 25')
    m.place(gan, feed, Location(), (0, 200, 300), 'ARCH')

    # ═══════════════════════════════════════════════════════════════ CONTROL ═══
    zb1 = zf(beam['dy1'])
    # the stop light hangs on a bracket plate from the beam's south face
    slb_top = beam['y0'] + 120
    slb = cq.Workplane('XY').box(240, slb_top - (light['y'] - 70), 10).translate((light['x'], (slb_top + light['y'] - 70) / 2, zb1 - 5))
    m.place(gan, m.part(PartDef('WSH-SLB', 'Stop light bracket, stainless', slb.val(), 'ss316', 'structure', 'cut plate 10 mm',
                                f'240 x {slb_top - light["y"] + 70:.0f}', '316L', None, 'Hangs the stop light from the beam face.', {}, 'make')),
            Location(), (0, 0, -180), 'CONTROL')
    for dx in (-90, 90):
        for yy in (beam['y0'] + 30, beam['y0'] + 90):
            m.place(gan, std.shcs(6, 16, 'A4-80', 'Holds the stop light bracket to the beam.'),
                    std.orient((light['x'] + dx, yy, zb1 - 10), (0, 0, 1)), (0, 0, -230), 'CONTROL')
    sl = (cq.Workplane('XY').box(220, 120, 60).translate((light['x'], light['y'], zb1 - 10 - 30)).edges('|Z').fillet(10))
    m.place(gan, m.part(PartDef('WSH-STL', 'Stop light housing', sl.val(), 'steel_paint', 'electrical', 'catalogue part', '220 x 120',
                                'IP66', None, 'Faces the arriving car. It tells the car and its driver to stop or go.', {}, 'buy')),
            Location(), (0, 0, -200), 'CONTROL')
    lamp_r = PartDef('WSH-LMR', 'Signal lamp, red, 100 mm', cq.Workplane('XY').circle(40).extrude(-12).val(), 'led_red', 'electrical',
                     'EN 12368', 'D 100', '', None, 'Red: the program runs. The car must not move.', {}, 'buy')
    lamp_g = PartDef('WSH-LMG', 'Signal lamp, green, 100 mm', cq.Workplane('XY').circle(40).extrude(-12).val(), 'led_green', 'electrical',
                     'EN 12368', 'D 100', '', None, 'Green: the machine is home. The car may go.', {}, 'buy')
    m.place(gan, lamp_r, loc(light['x'] - 55, light['y'], zb1 - 70), (0, 0, -260), 'CONTROL')
    m.place(gan, lamp_g, loc(light['x'] + 55, light['y'], zb1 - 70), (0, 0, -260), 'CONTROL')
    bea = cq.Workplane('XZ', origin=(0, beam['y1'] + 400, 0)).circle(105).workplane(offset=400).circle(125).loft()
    m.place(gan, m.part(PartDef('WSH-BCN', 'Status beacon', bea.val(), 'led', 'electrical', 'catalogue part', 'D 250', 'IP66', None,
                                'Teal at home, green working, amber moving.', {}, 'buy')),
            loc(-1722, 0, zd), (0, 500, 0), 'CONTROL')
    # the cabinet hangs on 4 lugs on the inner face of the west leg's north post, over the car's side of the leg (on
    # the leg's outer face it stood 0.14 m into the outer wall of an end bay: design finding 8)
    z_cab = zl + leg['d'] / 2 - 100
    x_post = legX - post_x                               # the post's inner face
    # between the arch brackets on the post (at 1,200 and 2,400 mm): the cabinet stands 1,300 to 2,100 mm up
    cab = cq.Workplane('XY').box(300, 800, 600).edges('|Y').fillet(10).translate((x_post - 150, 1700, z_cab))
    lug = (cq.Workplane('XY').box(10, 50, 40).translate((5, 25, 0)).union(cq.Workplane('XY').box(40, 8, 40).translate((30, 4, 0))))
    lug_pd = m.part(PartDef('WSH-CLG', 'Cabinet wall lug, stainless', lug.val(), 'ss304', 'structure', 'catalogue part', '50 x 40',
                            'A4', None, 'Hangs the control cabinet on the leg.', {}, 'buy'))
    for (yy, flip) in ((2100, False), (1300, True)):
        for dz in (-70, 70):
            m.place(gan, lug_pd, loc(x_post, yy, z_cab + dz, rx=180 if flip else 0, ry=180), (-420, 0, 0), 'CONTROL')
            m.place(gan, std.hex_bolt(10, 30, 'A4-70', 'Holds the cabinet lug to the leg post.'),
                    std.orient((x_post - 10, yy + (-30 if flip else 30), z_cab + dz), (1, 0, 0)), (-440, 0, 0), 'CONTROL')
    m.place(gan, m.part(PartDef('WSH-CAB', 'Control cabinet, stainless, IP66', cab.val(), 'ss304', 'electrical', 'EN 62208',
                                '800 x 600 x 300', 'IP66', None,
                                'Holds the controller, 8 drives, the safety relay and the valve outputs. It talks to the twin over the site network.',
                                {}, 'buy', mass_override=85.0)), Location(), (-400, 0, 0), 'CONTROL')
    # the drag chain lies in a covered trench in the floor INBOARD of the west rail, 15 mm inboard of the travel gearmotor's
    # gear case. (Outboard of the rail it stood 0.41 m into the outer wall of an end bay: design finding 8. On the floor its
    # upper run stood 0.43 m up, in the path of the retracted side air knife, whose foot is 0.26 m up: design finding 13.)
    # A driver duct joins the chain's moving end, through the cover's slot, to an arm on the trolley's inner wall.
    chain = std.chain_link(120, 50, 75)
    x_o = legX - trol['w'] / 2 - 132 - 15                # the trench's outer wall, toward the rail
    x_i = x_o - 140                                      # its inner wall, toward the car
    xch = x_i + 5 + 5 + 60                               # the chain's centre: 10 mm clear of each wall
    R_dc, n_dc = 200.0, 59
    g_lo, g_hi = gan.joint['limits']
    z_fix = (g_lo + g_hi) / 2 * 1000.0                  # mid travel (the gantry's frame stands at z = GANTRY, metres)
    y_fl = -520.0                                        # the trench floor
    y_lo = y_fl + 25 + 9                                 # the lower run's centre, 9 mm over the floor (links tip in the bend)
    y_up = y_lo + 2 * R_dc                               # the upper run's centre: its links' tops 57 mm under the cover
    # the trench runs from beyond the bend at the north end of travel to beyond the driver at the south end
    tz0 = z_fix - (n_dc * 75 - math.pi * R_dc + (z_fix - g_lo * 1000.0)) / 2 - R_dc - 25 - 40
    tz1 = g_hi * 1000.0 + 170 + 40
    tr_l = tz1 - tz0
    tzc = (tz0 + tz1) / 2
    trench = (cq.Workplane('XY').box(x_o - x_i + 10, 5, tr_l).translate(((x_i + x_o) / 2, y_fl - 2.5, tzc))
              .union(cq.Workplane('XY').box(5, -y_fl - 5, tr_l).translate((x_i - 2.5, (y_fl - 15) / 2, tzc)))   # walls up to the cover
              .union(cq.Workplane('XY').box(5, -y_fl - 5, tr_l).translate((x_o + 2.5, (y_fl - 15) / 2, tzc)))
              .union(cq.Workplane('XY').box(30, 5, tr_l).translate((x_i - 20, -12.5, tzc)))      # the cover's seat angles
              .union(cq.Workplane('XY').box(30, 5, tr_l).translate((x_o + 20, -12.5, tzc))))
    m.place(bay, m.part(PartDef('WSH-CTR', 'Drag chain trench liner, galvanised', trench.val(), 'steel', 'structure', 'folded sheet 5 mm',
                                f'{x_o - x_i:.0f} x {-y_fl:.0f} x {tr_l:.0f}', 'S235, galvanised', None,
                                'Lines the trench the drag chain runs in, inboard of the west rail, under the cover.', {}, 'make')),
            Location(), (-300, -60, 0), 'CONTROL')
    s_w = 70.0                                           # the cover's slot, for the 60 mm driver
    cov = (cq.Workplane('XY').box(xch - s_w / 2 - (x_i - 35), 10, tr_l).translate(((xch - s_w / 2 + x_i - 35) / 2, -5, tzc))
           .union(cq.Workplane('XY').box(x_o + 35 - (xch + s_w / 2), 10, tr_l).translate(((x_o + 35 + xch + s_w / 2) / 2, -5, tzc))))
    m.place(bay, m.part(PartDef('WSH-CTC', 'Trench cover, slotted, galvanised checker plate', cov.val(), 'steel', 'structure',
                                'checker plate 10 mm', f'2 x {tr_l:.0f}, slot {s_w:.0f}', 'S235, galvanised, R11 slip', None,
                                'Covers the trench flush with the floor. The driver runs in its slot.', {}, 'make')),
            Location(), (-300, 60, 0), 'CONTROL')
    brush = cq.Workplane('XY').box(3, 25, tr_l).translate((0, -12.5, tzc))
    brush_pd = m.part(PartDef('WSH-CTB', 'Slot brush strip, nylon on aluminium back', brush.val(), 'pa66', 'seal', 'catalogue part',
                              f'25 x {tr_l:.0f}', '', None, 'Closes the cover\'s slot round the driver against grit and spray.', {}, 'buy'))
    for dx in (-(s_w / 2 - 1.5), s_w / 2 - 1.5):
        m.place(bay, brush_pd, loc(xch + dx, 0, 0), (-300, 90, 0), 'CONTROL')
    # tie straps from the liner's outer seat to the west rail's anchor plates, one at each plate along the trench
    x_ap = legX - 130                                    # the anchor plates' inner edge
    strap = cq.Workplane('XY').box(x_ap + 16 - (x_o + 35), 3, 40).translate(((x_ap + 16 + x_o + 35) / 2, -13.5, 0))
    strap_pd = m.part(PartDef('WSH-CTS', 'Trench tie strap, galvanised flat 40 x 3', strap.val(), 'steel', 'structure', 'flat bar',
                              f'40 x 3 x {x_ap + 16 - x_o - 35:.0f}', 'S235, galvanised', None,
                              'Ties the trench liner to the rail anchor plates, so the two stay in line.', {}, 'make'))
    for i in range(n_plates):
        z_p = zf(rail['from']) - i * (rl / (n_plates - 1))
        if tz0 + 40 < z_p < tz1 - 40:
            m.place(bay, strap_pd, loc(0, 0, z_p), (-300, 20, 0), 'CONTROL')
    m.flex(FlexDef('WSH-DCH', 'Drag chain 120 x 50, R 200', 'chain',
                   Anchor(bay, (xch, y_lo, z_fix), (0, 0, -1)), Anchor(gan, (xch, y_up, 0), (0, 0, -1)),
                   25.0, 'CONTROL', 'Brings power, water, chemicals, air and the network to the moving machine. Its bend rolls along '
                   'at half the machine\'s speed.', mat='pa66', category='electrical', pitch=75, bend_r=R_dc, links=n_dc, up=(0, 1, 0),
                   w=120, h=50, link_part=chain, kg_per_m=6.5,
                   spec={'carries': 'supply cable 5G10, network, water DN 20, 2 chemicals DN 10, air DN 12',
                         'upper run': 'self-supporting up to 3.7 m with the machine at an end (chain maker to confirm), '
                                      'else it lies on the lower run'}))
    # its moving end: an end bracket on the last link, a driver duct up through the slot, an arm to the trolley's inner wall,
    # and a conduit up the leg to the cabinet's floor
    x_tw = legX - trol['w'] / 2                          # the trolley's inner wall
    dce = cq.Workplane('XY').box(120, 50, 10).translate((xch, y_up, 5))
    m.place(gan, m.part(PartDef('WSH-DCE', 'Drag chain end bracket, stainless', dce.val(), 'ss316', 'structure', 'bent plate',
                                '120 x 50', '316L', None, 'Joins the chain\'s last link to the driver.', {}, 'make')),
            Location(), (-200, 40, 0), 'CONTROL')
    y_arm = 100.0
    dcd = (cq.Workplane('XY').box(60, y_arm + 60 - (y_up - 25), 160).translate((xch, (y_arm + 60 + y_up - 25) / 2, 90))
           .cut(cq.Workplane('XY').box(54, y_arm + 60 - (y_up - 25) + 2, 154).translate((xch, (y_arm + 60 + y_up - 25) / 2, 90))))
    m.place(gan, m.part(PartDef('WSH-DCD', 'Drag chain driver duct, stainless', dcd.val(), 'ss316', 'structure', 'welded box 60 x 160 x 3',
                                f'{y_arm + 60 - y_up + 25:.0f} long', '316L', None,
                                'Pushes and pulls the chain\'s moving end through the cover\'s slot. The lines rise inside it.', {}, 'make')),
            Location(), (-200, 80, 0), 'CONTROL')
    dcb = (cq.Workplane('XY').box(x_tw - (xch + 30), 60, 160).translate(((x_tw + xch + 30) / 2, y_arm + 30, 90))
           .cut(cq.Workplane('XY').box(x_tw - (xch + 30) + 2, 54, 154).translate(((x_tw + xch + 30) / 2, y_arm + 30, 90))))
    m.place(gan, m.part(PartDef('WSH-DCB', 'Drag chain carrier arm, stainless', dcb.val(), 'ss316', 'structure', 'welded box 60 x 160 x 3',
                                f'{x_tw - xch - 30:.0f} long', '316L', None,
                                'Joins the driver to the trolley\'s inner wall. The lines run through it to the conduit.', {}, 'make')),
            Location(), (-200, 60, 0), 'CONTROL')
    x_cd = x_tw - 45                                     # the conduit, 15 mm off the trolley's inner wall
    cond = std.swept('WSH-DCC', 'Cable conduit, chain to cabinet, 60 mm',
                     [(x_cd, y_arm + 60, 90), (x_cd, 520, 90), (x_post - 150, 1120, z_cab - 200), (x_post - 150, 1299, z_cab - 200)],
                     30, 'cable', 'electrical', 26, 'Carries the chain\'s lines from the arm up the leg to the control cabinet.',
                     {'bend': 'R 300 (5 x D)'}, 'EN 61386', 'D 60', 'make', bend=300.0)
    m.place(gan, cond, Location(), (-200, 100, 0), 'CONTROL')
    return m
