"""OTTO-WASH — the robotic rollover machine in each wash bay (docs/OTTO-WASH.md).

Geometry is the twin's (cad/spec/robots.json <- washSpec.ts, plan units converted once): one portal gantry on
two floor rails at x = +/-3.25 m that travels 7.37 m over the parked car, carrying a spray arch, a top brush,
two side brushes, a top and two side air knives, and two vacuum wands for a detail seat.

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

WAND_STAGES = 4      # the sleeve and 3 sliding stages (3 stood the stowed column 4 cm under the wash hall roof)
WAND_REACH_STAGES = 2   # 2 telescoping reach tubes: 1 tube from the column met the other side's head at the centreline
TOP_LOW_MM = 850.0   # the lowest the top brush axis and the top knife go: the twin takes them over the hood, 1.80 m and
                     # 2.00 m below their stowed heights. Design finding 7: the brush's 2 lift rails guide 1.39 m of it
                     # (they cannot hang lower, over the car), and the knife hangs on its duct.
OVER_MM = 1.0        # each wand slide's over-travel past its share of the twin's stroke, at its end stops (the twin's
                     # stroke, from plan units, runs 0.01 mm past the stroke from the 4-decimal spec)


def _brush(r_core: float, r_out: float, length: float, strips: int = 56) -> cq.Shape:
    """A wash brush: closed-cell foam strips on a core bored to its shaft (r_core), drawn as a star prism along local Y."""
    pts = []
    for i in range(strips * 2):
        a = math.pi * i / strips
        r = r_out if i % 2 == 0 else r_out * 0.86
        pts.append((r * math.cos(a), r * math.sin(a)))
    star = cq.Workplane('XZ').polyline(pts).close().circle(r_core).extrude(length / 2, both=True)
    return star.val()


def build(spec: dict) -> Model:
    W = spec['wash']
    G = W['gantry']
    M = 1000.0
    g = {k: (v * M if isinstance(v, (int, float)) else v) for k, v in G.items() if not isinstance(v, dict)}
    sub = lambda k: {kk: vv * M if isinstance(vv, (int, float)) else vv for kk, vv in G[k].items()}  # noqa: E731
    legX = G['legX'] * M
    leg, trol, beam, rail = sub('leg'), sub('trolley'), sub('beam'), sub('rail')
    arch, top, side, wand, light = sub('arch'), sub('topBrush'), sub('sideBrush'), sub('wand'), sub('light')
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
                how=['Anchor plates every metre hold each rail to the slab with concrete screws.', 'The rails stand outside the door opening.'],
                specs={'track': f'{2 * legX / 1000:.2f} m', 'length': f'{(rail["to"] - rail["from"]) / 1000:.2f} m'}, group='Structure')
    m.subsystem('TRAVEL', 'Travel drive', 'Moves the whole machine back and forth over the car, 6 passes a wash.',
                how=['A geared motor drives one wheel each side. The drives keep in step by encoder.',
                     'Side rollers keep the wheels on the rails.'],
                specs={'speed': 'about 10 m/min', 'motors': '2 x 0.75 kW, with brake'}, group='Motion')
    m.subsystem('PORTAL', 'Portal frame', 'Two legs and a beam span the bay. Retracted, everything clears a car by more than 0.48 m.',
                how=['Bolted flanges join the legs to the trolleys and to the beam.', 'Galvanised steel, painted safety yellow.'],
                specs={'clear height': f'{beam["y0"] / 1000:.2f} m under the beam'}, group='Structure')
    m.subsystem('ARCH', 'Spray arch', 'Sprays the pre-soak foam, then the clear-water rinse.',
                how=[f'{arch["nozzles"]} flat-fan nozzles each side and 5 across the top.', 'Solenoid valves switch the foam and the rinse water.'],
                specs={'pressure': 'up to 70 bar (nozzle rating)'}, group='Tools')
    m.subsystem('TOPBRUSH', 'Top brush (overhead)', 'Washes the bonnet, the roof and the roof pod. It follows the car top.',
                how=['A geared motor turns the brush.', 'A lift drive on 2 rails lowers it until the motor current says it touches, then follows the shape.'],
                specs={'brush': f'{2 * top["r"]:.0f} mm, {2 * top["halfLen"]:.0f} mm long'}, group='Tools')
    m.subsystem('SIDEBRUSH', 'Side brushes', 'Wash the flanks, the doors and the wheels.',
                how=['Each brush hangs from a carriage on 2 rails under the beam.', 'A rack drive moves it in to the flank. A geared motor turns it.'],
                specs={'brush': f'{2 * side["r"]:.0f} mm, {side["y1"] - side["y0"]:.0f} mm tall'}, group='Tools')
    m.subsystem('DRYER', 'Air knives (dryer)', 'Blow the water off in the last 2 passes.',
                how=['A top knife follows the car top. 2 side knives close on the flanks.', '3 blowers on the beam feed them through flexible ducts.'],
                specs={'blowers': 'top 4 kW, sides 2 x 3 kW (class)'}, group='Tools')
    m.subsystem('WAND', 'Detail vacuum wands', 'Vacuum the cabin floor through the open doors on a detail seat.',
                how=['Each wand drops on a 4-stage column outside its flank.', '2 telescoping tubes reach in through the door opening.'],
                specs={'drop': f'{(wand["topY"] - wand["workY"]) / 1000:.2f} m', 'reach': f'{(wand["x"] - wand["reachX"]) / 1000:.2f} m'},
                group='Tools')
    m.subsystem('CONTROL', 'Control, supply and signals', 'Runs the program, and tells the car when to stop and when to go.',
                how=['A stainless control cabinet on the east leg holds the controller and the drives.',
                     'A stop light faces the arriving car: red while the program runs, green when the car may go.',
                     'A drag chain beside the east rail brings power, water, chemicals and air.'],
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
                              '260 x 160 x 12', 'S355J2', None, 'Spreads the rail load into the slab. Grouted under.', {}, 'make'))
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
    # hollow-shaft gearmotor on the axle end: flange on the trolley wall, gear case, motor (local +X outboard)
    gmw = (cq.Workplane('XY').box(12, 180, 180).translate((6, 0, 0))
           .union(cq.Workplane('XY').box(120, 130, 120).translate((72, 0, 0)))
           .union(cq.Workplane('YZ', origin=(132, 0, 0)).circle(60).extrude(170)))
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
            face = sx * (legX + trol['w'] / 2)
            if e < 0:       # the idler: an end block over the axle
                m.place(gan, axb_pd, loc(face, y_ax, wz, rz=0 if sx > 0 else 180), (sx * 560, 0, 0), 'TRAVEL')
                for yy in (y_ax, y_ax + 60):
                    for dz in (-50, 50):
                        std.bolt_stack(m, gan, 'TRAVEL', (face + sx * 20, yy, wz + dz), (-sx, 0, 0), 12, 50, 28, nut_kind='',
                                       fn='Holds the axle end block to the trolley wall.', explode=(sx * 600, 0, 0))
            else:           # the driven wheel: the gearmotor's flange over the axle
                m.place(gan, gmw_pd, loc(face, y_ax, wz, rz=0 if sx > 0 else 180), (sx * 600, 0, 0), 'TRAVEL')
                for yy in (y_ax + 10, y_ax + 70):
                    for dz in (-70, 70):
                        std.bolt_stack(m, gan, 'TRAVEL', (face + sx * 12, yy, wz + dz), (-sx, 0, 0), 10, 35, 20, nut_kind='',
                                       fn='Holds the travel gearmotor flange to the trolley.', explode=(sx * 640, 0, 0))
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
        for sx in (-1, 1):                                                        # the wand columns pass through both decks
            deck = deck.cut(cq.Workplane('XY').box(110, 6, 110).translate((sx * wand['x'], yd, zf(wand['dy']))))
        m.place(gan, m.part(PartDef(pid, f'{nm}, aluminium checker plate 4 mm', deck.val(), 'al_extr', 'structure', 'EN 1386 tread plate',
                                    f'{bl:.0f} x {dk_w:.0f} x 4', '5754-H114', None,
                                    'Closes the beam between its chords and carries the tools hung below it and the drives on it.',
                                    {}, 'make')), Location(), (0, 400 if yd > beam['y0'] + 10 else 380, 0), 'PORTAL')
    m.place(gan, m.part(PartDef('WSH-BEAM', 'Portal beam weldment', beamb.val(), 'steel_yellow', 'structure', 'EN 1090-2 EXC2',
                                f'{bl:.0f} x {bh:.0f} x {bz0 - bz1:.0f}', 'S355J2', None,
                                'Spans the bay: 2 chords and 4 cross members, closed by a deck top and bottom into a box girder. Every tool '
                                'hangs below it at its own station, so none can meet another; the drives stand on top.',
                                {'stations (z, mm)': f'arch {zf(arch["dy"]):.0f}, wands {zf(wand["dy"]):.0f}, top brush {zf(top["dy"]):.0f}, '
                                                     f'side brushes {zf(side["dy"]):.0f}, air knives {zf(dry_dy):.0f}'}, 'make')),
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
                                'Carries the foam and the rinse water to the nozzles. Stainless: wash chemicals do not touch carbon steel.',
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

    # ═══════════════════════════════════════════════════════════ TOP BRUSH ═══
    zt = zf(top['dy'])
    tb = gan.child('TopBrush', Location(), sub='TOPBRUSH',
                   joint={'name': 'TOP_BRUSH', 'axis': [0, -1, 0], 'limits': [0, (top['retractY'] - TOP_LOW_MM) / 1000],
                          'kind': 'prismatic', 'stowed': 0})
    m.place(tb, m.part(PartDef('WSH-TBR', 'Top brush, closed-cell foam strips', _brush(30, top['r'], 2 * top['halfLen']),
                               'brush_blue', 'tool', 'catalogue part', f'D {2 * top["r"]:.0f} x {2 * top["halfLen"]:.0f}', '', None,
                               'Scrubs the car top. Foam strips do not hold grit, so they do not scratch the paint.',
                               {'speed': 'about 135 rpm'}, 'buy', mass_override=45.0)),
            loc(0, top['retractY'], zt, rz=90), (0, -250, 0), 'TOPBRUSH')
    HW, HB = 100, 220                                    # hanger width (x) and its bearing block's height
    x_in, x_out = top['hangerX'] - HW / 2, top['hangerX'] + HW / 2
    shaft = cq.Workplane('YZ', origin=(-x_out, 0, 0)).circle(30).circle(24).extrude(x_out + x_out + 110)
    m.place(tb, m.part(PartDef('WSH-TSH', 'Top brush shaft, stainless', shaft.val(), 'ss316', 'drive', 'machined',
                               f'D 60 x {2 * x_out + 110:.0f}', '', None,
                               'Carries the brush between its 2 bearings. Its right end drives from the gearmotor\'s hollow output.', {}, 'make')),
            loc(0, top['retractY'], zt), (0, -180, 0), 'TOPBRUSH')
    fbu = (cq.Workplane('YZ').rect(140, 140).extrude(14).edges('|X').fillet(16)
           .union(cq.Workplane('YZ').circle(46).extrude(46)).cut(cq.Workplane('YZ').circle(30).extrude(80, both=True)))
    fbu_pd = m.part(PartDef('WSH-FBU', 'Flanged bearing unit, 4-bolt, stainless, 60 mm', fbu.val(), 'ss316', 'bearing', 'ISO 3228',
                            'bore 60', 'sealed, wash-down', None, 'Carries one end of a brush shaft.', {}, 'buy'))
    y_hb = top['retractY'] + HB / 2                      # the hollow upper part rises from the bearing block to the deck
    hh = beam['y0'] - y_hb
    hcen = (0, y_hb + hh / 2, zt)
    hanger = (cq.Workplane('XY').box(HW, hh, 140).translate(hcen)
              .cut(cq.Workplane('XY').box(HW - 10, hh + 2, 130).translate(hcen))
              .union(cq.Workplane('XY').box(HW, HB, 140).translate((0, top['retractY'], zt)))
              .cut(cq.Workplane('YZ', origin=(-HW, top['retractY'], zt)).circle(46).extrude(2 * HW)))
    hanger_pd = m.part(PartDef('WSH-THG', 'Top brush hanger', hanger.val(), 'ss316', 'structure', 'machined weldment',
                               f'{HW} x 140', '316L', None, 'Hangs the brush from its lift rail. Its block carries a bearing unit.', {}, 'make'))
    for sx in (-1, 1):
        m.place(tb, hanger_pd, loc(sx * top['hangerX'], 0, 0), (sx * 120, 0, 0), 'TOPBRUSH')
        # the bearing unit on the hanger's inner face, its boss in the hanger block's bore
        m.place(tb, fbu_pd, loc(sx * (x_in - 14), top['retractY'], zt, rz=0 if sx > 0 else 180), (sx * 200, 0, 0), 'TOPBRUSH')
        for k in range(4):
            yy, zz = top['retractY'] + (50 if k < 2 else -50), zt + (50 if k % 2 else -50)
            m.place(tb, std.hex_bolt(12, 40, 'A4-70', 'Holds the bearing unit to the hanger.'),
                    std.orient((sx * (x_in - 14), yy, zz), (sx, 0, 0)), (sx * 260, 0, 0), 'TOPBRUSH')
    # a right-angle hollow-shaft gearmotor on the right hanger's outer face: flange, gear case on the shaft, motor up
    tgm = (cq.Workplane('XY').box(12, HB, 140).translate((6, 0, 0))
           .union(cq.Workplane('XY').box(140, 150, 130).translate((12 + 70, 0, 0)))
           .cut(cq.Workplane('YZ').circle(30).extrude(160))
           .union(cq.Workplane('XZ', origin=(82, 75, 0)).circle(60).extrude(-200)))
    m.place(tb, m.part(PartDef('WSH-TBM', 'Top brush gearmotor 0.75 kW, 135 rpm, right-angle', tgm.val(), 'steel_paint', 'drive', 'catalogue part',
                               '0.75 kW', 'IP66, wash-down', None, 'Turns the top brush. Its current tells the lift how hard the brush presses.',
                               {}, 'buy', mass_override=26.0)), loc(x_out, top['retractY'], zt), (400, 0, 0), 'TOPBRUSH')
    for dy in (-95, 95):
        for dz in (-40, 40):
            m.place(tb, std.hex_bolt(10, 30, 'A4-70', 'Holds the top brush gearmotor to its hanger.'),
                    std.orient((x_out + 12, top['retractY'] + dy, zt + dz), (-1, 0, 0)), (440, 0, 0), 'TOPBRUSH')
    # lift: 2 vertical rails on the beam face and a lift gearmotor with toothed belts
    # each rail stands on a mast plate hung from the bottom deck; its block's face meets the hanger's north face
    lr = std.rail(25, 1600)
    w_r, h_r, bw_r, bh_r = std.RAIL[25][0], std.RAIL[25][1], std.RAIL[25][2], std.RAIL[25][3]
    z_rb = zt + 70 + bh_r                                 # the rail's base (its blocks reach back to z = zt + 70)
    lmp = cq.Workplane('XY').box(120, 1600, 12).translate((0, beam['y0'] - 800, z_rb + 6))
    lmp_pd = m.part(PartDef('WSH-LMP', 'Lift mast plate, stainless', lmp.val(), 'ss316', 'structure', 'cut plate 12 mm', '120 x 1600',
                            '316L', None, 'Carries a lift rail. Welded under the bottom deck.', {}, 'make'))
    for sx in (-1, 1):
        m.place(gan, lmp_pd, loc(sx * top['hangerX'], 0, 0), (sx * 100, 0, 260), 'TOPBRUSH')
        m.place(gan, lr, loc(sx * top['hangerX'], beam['y0'] - 800, z_rb, rx=-90), (sx * 100, 0, 200), 'TOPBRUSH')
        m.place(tb, std.rail_block(25), loc(sx * top['hangerX'], top['retractY'] + 400, z_rb, rx=-90), (sx * 140, 0, 160), 'TOPBRUSH')
    lgm = (cq.Workplane('XY').box(180, 10, 180).translate((0, 5, 0))
           .union(cq.Workplane('XY').box(130, 90, 130).translate((0, 55, 0)))
           .cut(cq.Workplane('YZ', origin=(-100, 50, 0)).circle(20.5).extrude(200))
           .union(cq.Workplane('XY', origin=(0, 50, 65)).circle(45).extrude(180)))
    m.place(gan, m.part(PartDef('WSH-TLM', 'Top brush lift gearmotor 0.37 kW, brake, hollow shaft', lgm.val(), 'steel_paint', 'drive',
                                'catalogue part', '0.37 kW', 'IP66', None,
                                'Turns the lift cross shaft: raises and lowers the top brush. Its brake holds it when power is off.', {}, 'buy',
                                mass_override=16.0)),
            loc(0, beam['y1'], zt), (0, 300, 0), 'TOPBRUSH')

    # ═══════════════════════════════════════════════════════════ SIDE BRUSHES ═══
    zs = zf(side['dy'])
    sh = side['y1'] - side['y0']
    rw, rh, rbw, rbh, rbl = std.RAIL[25][0], std.RAIL[25][1], std.RAIL[25][2], std.RAIL[25][3], std.RAIL[25][4]
    y_ct = beam['y0'] - rbh                              # the carriage's top: the blocks' mounting faces
    y_cb = y_ct - 160                                    # its floor's underside
    crg = (cq.Workplane('XY').box(300, 160, 300).cut(cq.Workplane('XY').box(284, 144, 284))
           .cut(cq.Workplane('XZ', origin=(0, -60, 0)).circle(30).extrude(40)))
    crg_pd = m.part(PartDef('WSH-SCG', 'Side brush carriage', crg.val(), 'ss316', 'structure', 'machined weldment', '300 x 300 x 160',
                            '316L', None, 'Runs on 2 rails under the beam and carries the brush, its motor and bearing.', {}, 'make'))
    sgm = (cq.Workplane('XY').box(170, 140, 170).cut(cq.Workplane('XZ', origin=(0, 80, 0)).circle(30).extrude(160))
           .union(cq.Workplane('XY', origin=(0, 0, -85)).circle(70).extrude(-240)))
    sgm_pd = m.part(PartDef('WSH-SBM', 'Side brush gearmotor 1.1 kW, 113 rpm, right-angle, hollow shaft', sgm.val(), 'steel_paint', 'drive',
                            'catalogue part', '1.1 kW', 'IP66, wash-down', None,
                            'Turns one side brush. Its current tells the carriage how hard the brush presses.', {}, 'buy', mass_override=31.0))
    y_sb_top = side['y1'] + 20                           # the brush's shaft rises from its foot to the bearing unit
    y_fbu = y_cb + 8                                     # the bearing unit stands on the carriage floor, inside
    sshaft = cq.Workplane('XZ', origin=(0, y_fbu + 46, 0)).circle(30).circle(24).extrude(y_fbu + 46 - side['y0'] + 20)
    sshaft_pd = m.part(PartDef('WSH-SSH', 'Side brush shaft, stainless', sshaft.val(), 'ss316', 'drive', 'machined',
                               f'D 60 x 6 tube, {y_fbu + 46 - side["y0"] + 20:.0f}', '', None,
                               'Carries the brush. The gearmotor turns it; the bearing unit in the carriage holds it.', {}, 'make'))
    rk = cq.Workplane('XY').box(1500, 20, 20)
    rk_pd = m.part(PartDef('WSH-SRK', 'Gear rack module 2, 20 x 20, stainless', rk.val(), 'ss316', 'drive', 'DIN 867 tooth form',
                           '1500 long', '', None, 'The carriage pinion runs along it.', {}, 'buy'))
    z_cgm = zs - 150 - 45                                # the carriage gearmotor, on the carriage's south face
    for sx, name, mat in ((-1, 'L', 'brush_blue'), (1, 'R', 'brush_red')):
        sb = gan.child(f'SideBrush{name}', Location(), sub='SIDEBRUSH',
                       joint={'name': f'SIDE_BRUSH_{name}', 'axis': [-sx, 0, 0],
                              'limits': [0, (side['retractX'] - 900) / 1000], 'kind': 'prismatic', 'stowed': 0})
        x = sx * side['retractX']
        m.place(sb, m.part(PartDef(f'WSH-SBR{name}', 'Side brush, closed-cell foam strips', _brush(30, side['r'], sh), mat, 'tool',
                                   'catalogue part', f'D {2 * side["r"]:.0f} x {sh:.0f}', '', None,
                                   'Scrubs one flank, its doors and wheels.', {'speed': 'about 113 rpm'}, 'buy', mass_override=55.0)),
                loc(x, (side['y0'] + side['y1']) / 2, zs), (sx * 350, 0, 0), 'SIDEBRUSH')
        m.place(sb, sshaft_pd, loc(x, 0, zs), (sx * 300, 0, 0), 'SIDEBRUSH')
        m.place(sb, crg_pd, loc(x, y_ct - 80, zs), (0, -120, 0), 'SIDEBRUSH')
        m.place(sb, sgm_pd, loc(x, y_cb - 70, zs), (sx * 150, 0, 260), 'SIDEBRUSH')
        m.place(sb, fbu_pd, loc(x, y_fbu, zs, rz=90), (0, -40, 0), 'SIDEBRUSH')
        for zz in (-110, 110):
            m.place(sb, std.rail_block(25), loc(x, beam['y0'], zs + zz, ry=90, rx=180), (0, 60, 0), 'SIDEBRUSH')
            for dx in (-rbl * 0.26, rbl * 0.26):
                for dz in (-rbw * 0.36, rbw * 0.36):
                    m.place(sb, std.shcs(6, 16, 'A4-80', 'Holds the rail block to the carriage, from inside it.'),
                            std.orient((x + dx, y_ct - 8, zs + zz + dz), (0, 1, 0)), (0, 90, 0), 'SIDEBRUSH')
        # the bearing unit: 4 x M12 through its flange and the carriage floor into the gearmotor case
        for dx in (-50, 50):
            for dz in (-50, 50):
                m.place(sb, std.hex_bolt(12, 40, 'A4-70', 'Holds the bearing unit through the carriage floor into the gearmotor case.'),
                        std.orient((x + dx, y_fbu + 14, zs + dz), (0, -1, 0)), (0, 40, 0), 'SIDEBRUSH')
        # the gearmotor: 4 x M10 from inside the carriage, on a 110 mm radius clear of the bearing flange
        for k in range(4):
            a = math.radians(45 + 90 * k)
            m.place(sb, std.hex_bolt(10, 30, 'A4-70', 'Holds the side brush gearmotor under the carriage floor.'),
                    std.orient((x + 110 * math.cos(a), y_fbu, zs + 110 * math.sin(a)), (0, -1, 0)), (sx * 150, 60, 300), 'SIDEBRUSH')
        # the rack under the deck, south of the carriage; the rails, in every other counterbored hole
        m.place(gan, rk_pd, loc(sx * (side['retractX'] - 650), beam['y0'] - 10, z_cgm - 22 - 10), (0, 80, 0), 'SIDEBRUSH')
        xr = sx * (side['retractX'] - 700)
        for zz in (-110, 110):
            m.place(gan, std.rail(25, 1800), loc(xr, beam['y0'], zs + zz, ry=90, rx=180), (0, 100, 0), 'SIDEBRUSH')
            for i in range(0, 30, 2):
                m.place(gan, std.shcs(6, 20, 'A4-80', 'Holds the side brush rail to the bottom deck.'),
                        std.orient((xr - 870 + 60 * i, beam['y0'] - rh + rh * 0.45, zs + zz), (0, 1, 0)), (0, 150, 0), 'SIDEBRUSH')

    # ═══════════════════════════════════════════════════════════════ DRYERS ═══
    zd = zf(dry_dy)
    dt = gan.child('DryerTop', Location(), sub='DRYER',
                   joint={'name': 'DRYER_TOP', 'axis': [0, -1, 0], 'limits': [0, (dtop['retractY'] - TOP_LOW_MM) / 1000],
                          'kind': 'prismatic', 'stowed': 0})
    kc = (0, dtop['retractY'] + dtop['h'] / 2, zd)
    knife = (cq.Workplane('XY').box(2 * dtop['halfLen'], dtop['h'], dtop['d']).translate(kc)
             .cut(cq.Workplane('XY').box(2 * dtop['halfLen'] - 6, dtop['h'] - 4, dtop['d'] - 4).translate(kc))
             .union(cq.Workplane('XY').box(2 * dtop['halfLen'] - 30, 6, 8).translate((0, dtop['retractY'] + 3, zd))))
    m.place(dt, m.part(PartDef('WSH-DKT', 'Top air knife, stainless', knife.val(), 'ss316', 'tool', 'made to order',
                               f'{2 * dtop["halfLen"]:.0f} long', '', None, 'Blows a sheet of air down over the car top. It follows the shape.',
                               {}, 'make')), Location(), (0, -200, 0), 'DRYER')
    duct = (cq.Workplane('XZ', origin=(0, beam['y0'], zd)).rect(380, 160).extrude(beam['y0'] - dtop['retractY'] - dtop['h'])
            .faces('>Y or <Y').shell(-2))
    m.place(dt, m.part(PartDef('WSH-DDU', 'Flexible duct, 380 x 160', duct.val(), 'hose', 'fluid', 'catalogue part', '380 x 160', '', None,
                               'Feeds the top knife from its blower. It folds as the knife lifts.', {}, 'buy')),
            Location(), (0, -100, 0), 'DRYER')
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

    # ═══════════════════════════════════════════════════════════════ WANDS ═══
    # Each wand drops on a 4-stage telescoping column: the outer sleeve is fixed through the beam and stands above
    # it; the 3 inner stages each slide a third of the drop (topY -> workY), as the OTTO-CLEAN ARM's mast stages do.
    # Retracted, the head stands at topY, just under the beam. With 3 stages the stowed sleeve stood 4.75 m above
    # grade, 4 cm under the wash hall's 4.79 m roof (structurePlan.WASH_SHELL, 10 plan units); 4 stages stow lower.
    zw = zf(wand['dy'])
    stroke = wand['topY'] - wand['workY']
    n_mov = WAND_STAGES - 1
    st_len = stroke / n_mov + 120
    sections = (110.0, 94.0, 80.0, 66.0)
    for sx, name in ((-1, 'L'), (1, 'R')):
        x = sx * wand['x']
        # the solids are drawn for the left column at its own axis, inboard = +X; each side places them at its column
        col = loc(x, 0, zw, ry=180 if sx > 0 else 0)
        sleeve_top = wand['topY'] + st_len + 60
        sleeve = (cq.Workplane('XZ', origin=(0, sleeve_top, 0)).rect(sections[0], sections[0]).extrude(sleeve_top - (beam['y0'] - 40))
                  .cut(cq.Workplane('XZ', origin=(0, sleeve_top + 1, 0)).rect(sections[0] - 10, sections[0] - 10).extrude(sleeve_top - beam['y0'] + 42)))
        m.place(gan, m.part(PartDef('WSH-WS1', f'Wand column stage 1 (sleeve), {sections[0]:.0f} x {sections[0]:.0f}', sleeve.val(), 'ss316',
                                    'structure', 'EN 10219', f'{sleeve_top - beam["y0"] + 40:.0f} long', '316L', None,
                                    'Fixed through the beam. It guides the next stage.', {'stowed top': f'{sleeve_top / 1000:.2f} m above grade'},
                                    'make')), col, (sx * 100, 300, 0), 'WAND')
        parent = gan
        for k in range(1, WAND_STAGES):
            node = parent.child(f'Wand{name}Drop{k}', Location(), sub='WAND',
                                joint={'name': f'WAND_{name}_DROP{k}', 'axis': [0, -1, 0], 'limits': [0, (stroke / n_mov + OVER_MM) / 1000],
                                       'kind': 'prismatic', 'stowed': 0})
            a = sections[k]
            stage_top = sleeve_top - 25 * k
            tube = (cq.Workplane('XZ', origin=(0, stage_top, 0)).rect(a, a).extrude(st_len)
                    .cut(cq.Workplane('XZ', origin=(0, stage_top + 1, 0)).rect(a - 8, a - 8).extrude(st_len + 2)))
            # 4 slide pads at the stage's top, filling the gap to the stage outside it
            gap = (sections[k - 1] - (10 if k == 1 else 8) - a) / 2
            for ang in (0, 90, 180, 270):
                pad = cq.Workplane('XY').box(gap, 60, 40).translate((a / 2 + gap / 2, stage_top - 30, 0))
                m.place(node, m.part(PartDef(f'WSH-WP{k + 1}', f'Column slide pad, UHMW-PE, stage {k + 1}', pad.val(), 'pa66',
                                             'bearing', 'machined', f'{gap:.1f} x 60 x 40', 'UHMW-PE', None,
                                             'Guides the stage in the one outside it. No grease to wash off.', {}, 'make')),
                        col * loc(0, 0, 0, ry=ang), (sx * (100 + 40 * k), 300 - 100 * k, 0), 'WAND')
            m.place(node, m.part(PartDef(f'WSH-WS{k + 1}', f'Wand column stage {k + 1}, {a:.0f} x {a:.0f}', tube.val(), 'ss316', 'structure',
                                         'EN 10219', f'{st_len:.0f} long', '316L', None,
                                         'Slides a third of the drop. A belt over its pulley drives the next stage.' if k < n_mov
                                         else 'Carries the reach slide at its foot.', {}, 'make')),
                    col, (sx * (100 + 40 * k), 300 - 100 * k, 0), 'WAND')
            parent = node
        # the head on a 2-stage telescoping reach, the drop column's scheme turned on its side: the slide block at the
        # last stage's foot guides tube 1, tube 1 guides tube 2, and tube 2 is the vacuum duct that carries the head.
        # Each tube slides half the reach: a belt in the block drives tube 1 and a doubling cable drives tube 2, so the
        # two move together. At full reach each tube keeps 60 mm inside the one outside it. The twin draws the head at
        # the column at zero reach; the CAD's head starts beside the block, so at full reach its centre is 125 mm further
        # in than the twin's, 114 mm from the car's centreline and 89 mm clear of the other side's head. (One tube from
        # the column, with a 220 mm head 640 mm out, put the two heads 0.27 m into each other at the vacuum pose.)
        foot_y = sleeve_top - 25 * n_mov - st_len
        y_r = foot_y - 40                                # the reach axis
        half = (wand['x'] - wand['reachX']) / WAND_REACH_STAGES
        r1, r2, r2i = 30.0, 26.0, 23.0                   # tube 1: 60 x 4; tube 2: 52 x 3
        x_out = 50 - half - 60                           # both tubes' outboard ends at zero reach
        hx0, hw = 55.0, 140.0                            # the head's outboard face at zero reach, and its depth along the reach
        wrc = cq.Workplane('XY').box(100, 80, 100).translate((0, y_r, 0)).cut(
            cq.Workplane('YZ', origin=(-60, y_r, 0)).circle(r1).extrude(120))
        m.place(parent, m.part(PartDef('WSH-WRC', 'Wand reach slide block', wrc.val(), 'ss316', 'drive', 'machined', '100 x 100 x 80',
                                       '316L', None, 'Guides reach tube 1 under the last stage. A belt in it drives the reach.', {}, 'make')),
                col, (sx * 80, -120, 0), 'WAND')
        n1 = parent.child(f'Wand{name}Reach1', Location(), sub='WAND',
                          joint={'name': f'WAND_{name}_REACH1', 'axis': [-sx, 0, 0], 'limits': [0, (half + OVER_MM) / 1000], 'kind': 'prismatic',
                                 'stowed': 0})
        t1 = cq.Workplane('YZ', origin=(x_out, y_r, 0)).circle(r1).circle(r2).extrude(50 - x_out)
        m.place(n1, m.part(PartDef('WSH-WAR1', 'Wand reach tube 1, 60 x 4', t1.val(), 'ss316', 'structure', 'EN 10217-7',
                                   f'D 60 x 4 x {50 - x_out:.0f}', '316L', None,
                                   'Slides half the reach in the slide block. Tube 2 slides in it.', {}, 'make')),
                col, (sx * -150, -160, 0), 'WAND')
        n2 = n1.child(f'Wand{name}Reach2', Location(), sub='WAND',
                      joint={'name': f'WAND_{name}_REACH2', 'axis': [-sx, 0, 0], 'limits': [0, (half + OVER_MM) / 1000], 'kind': 'prismatic',
                             'stowed': 0})
        t2 = cq.Workplane('YZ', origin=(x_out, y_r, 0)).circle(r2).circle(r2i).extrude(hx0 - x_out)
        m.place(n2, m.part(PartDef('WSH-WAR2', 'Wand reach tube 2, 52 x 3, the vacuum duct', t2.val(), 'ss316', 'structure', 'EN 10217-7',
                                   f'D 52 x 3 x {hx0 - x_out:.0f}', '316L', None,
                                   'Slides the other half of the reach in tube 1 and carries the head in through the door opening. '
                                   'The air goes up it.', {}, 'make')),
                col, (sx * -250, -200, 0), 'WAND')
        head = (cq.Workplane('XY').box(hw, 110, 250).edges().fillet(20).translate((hx0 + hw / 2, y_r, 0))
                .faces('<Y').shell(-3))
        m.place(n2, m.part(PartDef('WSH-WHD', 'Wand vacuum head with lamp', head.val(), 'pa66', 'tool', 'moulded', '140 x 250', '', None,
                                   'Vacuums the floor and lights it for the camera.', {}, 'make')), col, (sx * -320, -240, 0), 'WAND')
        dr = cq.Workplane('XY').box(120, 140, 120).edges('|Y').fillet(10).translate((-115, sleeve_top - 60, 0))
        m.place(gan, m.part(PartDef('WSH-WDM', 'Wand drop servo gearmotor 0.4 kW, brake', dr.val(), 'steel_paint', 'drive', 'catalogue part',
                                    '0.4 kW', 'IP66', None, 'Drives stage 2 by a toothed belt. Its brake holds the column with power off.',
                                    {}, 'buy', mass_override=7.5)), col, (sx * 220, 320, 0), 'WAND')
    m.notes['wand_column'] = {'stages': WAND_STAGES, 'reachStages': WAND_REACH_STAGES,
                              'stageLengthMm': round(st_len), 'stowedTopMm': round(wand['topY'] + st_len + 60),
                              'washHallHeightMm': round(10 * spec['yardstick_m_per_plan_unit'] * 1000)}

    # ═══════════════════════════════════════════════ fastener sets, by station ═══
    # cladding panels: a column of 8 button heads down each post
    for sx in (-1, 1):
        for i in range(8):
            for zz in (zl - leg['d'] / 2 + 100, zl + leg['d'] / 2 - 100):
                yy = leg_y0 + 120 + i * (lh - 240) / 7
                if sx > 0 and zz > zl and 1180 < yy < 2020:   # behind the control cabinet: its lugs hold the panel there
                    continue
                m.place(gan, std.bhcs(6, 16, 'A4-80', 'Holds the cladding panel to the leg post.'),
                        std.orient((sx * (legX + post_x + 2), leg_y0 + 120 + i * (lh - 240) / 7, zz), (-sx, 0, 0)),
                        (sx * 460, 0, 0), 'PORTAL')
    # lift gearmotor flange: 4 x M8 at its corners into the top deck
    for dx in (-75, 75):
        for dz in (-75, 75):
            m.place(gan, std.hex_bolt(8, 25, 'A4-70', 'Holds the lift gearmotor to the top deck.'),
                    std.orient((dx, beam['y1'] + 10, zt + dz), (0, -1, 0)), (0, 330, 0), 'TOPBRUSH')
    # lift rails to the beam face, and the rail blocks to the hangers
    for sx in (-1, 1):
        for i in range(13):
            # in every other counterbored hole of the rail (pitch 60, first at 50 from the end), into the mast plate
            m.place(gan, std.shcs(6, 20, 'A4-80', 'Holds the lift rail to its mast plate.'),
                    std.orient((sx * top['hangerX'], beam['y0'] - 800 - 750 + i * 120, z_rb - h_r + h_r * 0.45), (0, 0, 1)),
                    (sx * 100, 0, 240), 'TOPBRUSH')
        for dx in (-17.3, 17.3):
            for dy in (-21.8, 21.8):
                m.place(tb, std.shcs(6, 16, 'A4-80', 'Holds the rail block to the hanger, from inside it.'),
                        std.orient((sx * top['hangerX'] + dx, top['retractY'] + 400 + dy, zt + 65), (0, 0, 1)), (sx * 140, 0, 200),
                        'TOPBRUSH')
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
    for i in range(4):
        xb = -dtop['halfLen'] + 200 + i * (2 * dtop['halfLen'] - 400) / 3
        m.place(dt, kb_pd, loc(xb, dtop['retractY'] + dtop['h'] + 60, zd + dtop['d'] / 2 + 4), (0, -150, 80), 'DRYER')
        for dy in (-30, 30):
            m.place(dt, std.shcs(8, 20, 'A4-80', 'Holds the bracket to the air knife.'),
                    std.orient((xb, dtop['retractY'] + dtop['h'] + 60 + dy, zd + dtop['d'] / 2 + 8), (0, 0, -1)), (0, -150, 120), 'DRYER')
    # solenoid valves: 2 x M6 each; stop light: 4 x M6; cabinet: 4 x M10
    # wand columns: a clamp plate round each sleeve under the bottom deck, 4 x M8 into the deck
    wcl = cq.Workplane('XY').box(200, 12, 200).cut(cq.Workplane('XY').box(110, 14, 110))
    wcl_pd = m.part(PartDef('WSH-WCL', 'Wand column clamp plate, stainless', wcl.val(), 'ss316', 'structure', 'cut plate 12 mm',
                            '200 x 200', '316L', None, 'Holds the wand column sleeve under the bottom deck.', {}, 'make'))
    for sx in (-1, 1):
        m.place(gan, wcl_pd, loc(sx * wand['x'], beam['y0'] - 6, zw), (sx * 100, 140, 0), 'WAND')
        for dx in (-78, 78):
            for dz in (-78, 78):
                m.place(gan, std.shcs(8, 20, 'A4-80', 'Holds the wand column clamp plate to the bottom deck.'),
                        std.orient((sx * wand['x'] + dx, beam['y0'] - 12, zw + dz), (0, 1, 0)), (sx * 100, 160, 0), 'WAND')

    # ═══════════════════════════════════════════ drives the first pass left implicit ═══
    # side brush carriages: a gearmotor on each carriage's south face, its pinion on the rack under the deck
    pin = cq.Workplane('XZ', origin=(0, 10, 0)).circle(22).extrude(20).union(cq.Workplane('XZ', origin=(0, 10, 0)).circle(8).extrude(40))
    pin_pd = m.part(PartDef('WSH-PIN', 'Pinion module 2, 20 teeth, stainless', pin.val(), 'ss316', 'drive', 'DIN 867 tooth form',
                            '20 T, m 2', '', None, 'Drives the brush carriage along its rack.', {}, 'buy'))
    cgm = (cq.Workplane('XY').box(90, 90, 90).union(cq.Workplane('YZ', origin=(45, 0, 0)).circle(45).extrude(160)))
    cgm_pd = m.part(PartDef('WSH-CGM', 'Carriage gearmotor 0.37 kW, brake, encoder, right-angle', cgm.val(), 'steel_paint', 'drive',
                            'catalogue part', '0.37 kW', 'IP66, wash-down', None,
                            'Moves the side brush in to the flank. Its current says how hard the brush presses.', {}, 'buy',
                            mass_override=12.0))
    for sx, name in ((-1, 'L'), (1, 'R')):
        node = next(c for c in gan.children if c.name == f'SideBrush{name}')
        x = sx * side['retractX']
        xg = x - sx * 60
        m.place(node, pin_pd, loc(xg, beam['y0'] - 11, z_cgm), (sx * 120, 0, -120), 'SIDEBRUSH')
        m.place(node, cgm_pd, loc(xg, beam['y0'] - 41 - 45, z_cgm, ry=0 if sx > 0 else 180), (sx * 160, 0, -220), 'SIDEBRUSH')
        for dx in (-30, 30):
            for dy in (-30, 30):
                m.place(node, std.hex_bolt(8, 25, 'A4-70', 'Holds the carriage gearmotor to the carriage, from inside it.'),
                        std.orient((xg + dx, beam['y0'] - 86 + dy, zs - 150 + 8), (0, 0, -1)), (sx * 160, 0, -240), 'SIDEBRUSH')
    # top brush lift: a cross shaft on the beam with a belt drum over each hanger, in 2 pillow-block bearings
    shaft_l = 2 * top['hangerX'] + 300
    y_ls = beam['y1'] + 50                               # the lift shaft's axis, 50 above the top deck
    lsh = cq.Workplane('YZ', origin=(-shaft_l / 2, y_ls, zt)).circle(20).extrude(shaft_l)
    m.place(gan, m.part(PartDef('WSH-LSH', 'Lift cross shaft, 40 mm, stainless', lsh.val(), 'ss316', 'drive', 'machined',
                                f'D 40 x {shaft_l:.0f}', '', None, 'Turns both belt drums together, so the brush lifts level.', {}, 'make')),
            Location(), (0, 340, 0), 'TOPBRUSH')
    drum = cq.Workplane('YZ').circle(45).extrude(30, both=True).cut(cq.Workplane('YZ').circle(20).extrude(40, both=True))
    drum_pd = m.part(PartDef('WSH-DRM', 'Lift belt drum 90 mm', drum.val(), 'al6061', 'drive', 'machined', 'D 90 x 60',
                             '6061-T6', None, 'Winds the lift belt that hangs the top brush.', {}, 'make'))
    pb = (cq.Workplane('XY').box(60, 14, 160).translate((0, -50 + 7, 0))
          .union(cq.Workplane('XY').box(60, 36, 70).translate((0, -18, 0)))
          .union(cq.Workplane('YZ').circle(40).extrude(26, both=True)).cut(cq.Workplane('YZ').circle(20).extrude(40, both=True)))
    pb_pd = m.part(PartDef('WSH-PBU', 'Pillow-block bearing unit, 40 mm, stainless', pb.val(), 'ss316', 'bearing', 'ISO 3228',
                           'bore 40', 'sealed, wash-down', None, 'Carries the lift shaft on the beam.', {}, 'buy'))
    for sx in (-1, 1):
        m.place(gan, drum_pd, loc(sx * top['hangerX'], y_ls, zt), (sx * 60, 360, 0), 'TOPBRUSH')
        m.place(gan, pb_pd, loc(sx * (top['hangerX'] + 110), y_ls, zt), (sx * 90, 380, 0), 'TOPBRUSH')
        for dz in (-55, 55):
            std.bolt_stack(m, gan, 'TOPBRUSH', (sx * (top['hangerX'] + 110), beam['y1'] + 14, zt + dz), (0, -1, 0), 12, 40, 18,
                           fn='Holds the pillow block to the top deck.', explode=(sx * 90, 400, 0), stainless=True)
    # side air knives: a flexible duct each, up to its blower on the beam
    for sx, name in ((-1, 'L'), (1, 'R')):
        node = next(c for c in gan.children if c.name == f'DryerSide{name}')
        x = sx * (dside['retractX'] + dside['w'] / 2)
        dd = (cq.Workplane('XZ', origin=(0, beam['y0'], 0)).rect(150, 170).extrude(beam['y0'] - dside['y1'])
              .faces('>Y or <Y').shell(-2))
        m.place(node, m.part(PartDef('WSH-DDS', 'Flexible duct, 150 x 170', dd.val(), 'hose', 'fluid', 'catalogue part', '150 x 170', '',
                                     None, 'Feeds a side knife from its blower. It flexes as the knife closes on the car.', {}, 'buy')),
                loc(x, 0, zd), (sx * 300, 0, 0), 'DRYER')
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
    # the cabinet hangs on 4 lugs over the leg's north post, through the cladding
    z_cab = zl + leg['d'] / 2 - 100
    cab_x0 = legX + post_x + 2                           # the cladding's outer face
    cab = cq.Workplane('XY').box(300, 800, 600).edges('|Y').fillet(10).translate((cab_x0 + 150, 1600, z_cab))
    lug = (cq.Workplane('XY').box(10, 50, 40).translate((5, 25, 0)).union(cq.Workplane('XY').box(40, 8, 40).translate((30, 4, 0))))
    lug_pd = m.part(PartDef('WSH-CLG', 'Cabinet wall lug, stainless', lug.val(), 'ss304', 'structure', 'catalogue part', '50 x 40',
                            'A4', None, 'Hangs the control cabinet on the leg.', {}, 'buy'))
    for (yy, flip) in ((2000, False), (1200, True)):
        for dz in (-70, 70):
            m.place(gan, lug_pd, loc(cab_x0, yy, z_cab + dz, rx=180 if flip else 0), (420, 0, 0), 'CONTROL')
            m.place(gan, std.hex_bolt(10, 30, 'A4-70', 'Holds the cabinet lug through the cladding to the leg post.'),
                    std.orient((cab_x0 + 10, yy + (-30 if flip else 30), z_cab + dz), (-1, 0, 0)), (440, 0, 0), 'CONTROL')
    m.place(gan, m.part(PartDef('WSH-CAB', 'Control cabinet, stainless, IP66', cab.val(), 'ss304', 'electrical', 'EN 62208',
                                '800 x 600 x 300', 'IP66', None,
                                'Holds the controller, 8 drives, the safety relay and the valve outputs. It talks to the twin over the site network.',
                                {}, 'buy', mass_override=85.0)), Location(), (400, 0, 0), 'CONTROL')
    # the drag chain lies in a trough beside the east rail, outboard of the travel gearmotor's sweep (it hangs to 18 mm
    # above the slab and reaches 302 mm out from the trolley wall); the trough's 5 mm floor runs on under the gearmotor
    # to the rail's anchor plates, which hold it. (Beside the rail, the trolley's gearmotor and guide roller ran
    # through the trough and the chain as the machine travelled.)
    chain = std.chain_link(120, 50, 75)
    xc0 = legX + 130                                     # the anchor plates' outer edge
    x_in = legX + trol['w'] / 2 + 302 + 15               # the trough's inner wall: 15 mm outboard of the gearmotor
    xch = x_in + 5 + 5 + 60                              # the chain's centre: 5 mm clear of each wall
    z0, n_ch = zf(rail['to']) + 100, 70
    tr_l = n_ch * 75 + 100
    tr_w = (xch + 70) - xc0
    trough = (cq.Workplane('XY').box(tr_w, 5, tr_l).translate((xc0 + tr_w / 2, 2.5, z0 - 37.5 - 50 + tr_l / 2))
              .union(cq.Workplane('XY').box(5, 70, tr_l).translate((x_in + 2.5, 35, z0 - 37.5 - 50 + tr_l / 2)))
              .union(cq.Workplane('XY').box(5, 70, tr_l).translate((xc0 + tr_w - 2.5, 35, z0 - 37.5 - 50 + tr_l / 2))))
    m.place(bay, m.part(PartDef('WSH-CTR', 'Drag chain trough, galvanised', trough.val(), 'steel', 'structure', 'folded sheet 5 mm',
                                f'{tr_w:.0f} x 70 x {tr_l:.0f}', 'S235, galvanised', None,
                                'Guides the drag chain on the floor beside the east rail, clear of the travel drive.', {}, 'make')),
            Location(), (300, -60, 0), 'CONTROL')
    for i in range(n_ch):
        m.place(bay, chain, loc(xch, 5 + 25, z0 + i * 75, ry=90), (300, 60, 0), 'CONTROL')
    return m
