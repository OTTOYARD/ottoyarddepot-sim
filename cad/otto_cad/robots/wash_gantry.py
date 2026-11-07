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


def _brush(r_core: float, r_out: float, length: float, strips: int = 56) -> cq.Shape:
    """A wash brush: a core tube and closed-cell foam strips, drawn as a star prism along local Y."""
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
                how=['Each wand drops on a vertical slide outside its flank.', 'A horizontal slide reaches in through the door opening.'],
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
    for e in (-1, 1):
        trolley = trolley.cut(cq.Workplane('XY').box(trol['w'] + 2, 120, 260).translate((0, rail['h'] + 20 + 30, zl + e * (trol['d'] / 2 - 220))))
    troll_pd = m.part(PartDef('WSH-TRL', 'Trolley weldment', trolley.val(), 'steel_yellow', 'structure', 'EN 1090-2 EXC2',
                              f'{trol["w"]:.0f} x {trol["h"]:.0f} x {trol["d"]:.0f}', 'S355J2', None,
                              'Carries one leg on 2 wheels and the travel drive.', {}, 'make'))
    wheel = (cq.Workplane('YZ').circle(100).extrude(30, both=True)
             .cut(cq.Workplane('YZ').circle(26).extrude(40, both=True))
             .union(cq.Workplane('YZ').circle(110).circle(98).extrude(4, both=True).translate((32, 0, 0))))
    wheel_pd = m.part(PartDef('WSH-WHL', 'Travel wheel 200 x 60, polyurethane on steel hub', wheel.val(), 'pu', 'drive', 'catalogue part',
                              'D 200 x 60', '92 Shore A', None, 'Rolls in the rail channel. Quiet on wet steel.', {'load': '1,200 kg'}, 'buy'))
    gmw = (cq.Workplane('YZ').circle(60).extrude(170).union(cq.Workplane('XY').box(120, 130, 120).translate((-40, 0, 0))))
    gmw_pd = m.part(PartDef('WSH-TGM', 'Travel gearmotor 0.75 kW, helical-bevel, brake, encoder', gmw.val(), 'steel_paint', 'drive',
                            'catalogue part', '0.75 kW, 4 pole', 'IP66, wash-down', None,
                            'Drives one wheel. The brake holds the machine still while it sprays.',
                            {'output': 'about 22 rpm', 'brake': '10 N m'}, 'buy', mass_override=24.0))
    guide = cq.Workplane('XZ').circle(30).extrude(18, both=True)
    guide_pd = m.part(PartDef('WSH-GRL', 'Side guide roller 60 mm', guide.val(), 'pu', 'drive', 'catalogue part', 'D 60', '', None,
                              'Keeps the wheel centred in its rail.', {}, 'buy'))
    for sx in (-1, 1):
        m.place(gan, troll_pd, loc(sx * legX, 0, 0), (sx * 260, 0, 0), 'TRAVEL')
        for e in (-1, 1):
            wz = zl + e * (trol['d'] / 2 - 220)
            m.place(gan, wheel_pd, loc(sx * legX, rail['h'] + 20 + 100 - 100 + 12 + 88, wz), (sx * 420, -40, 0), 'TRAVEL')
            m.place(gan, std.ball_bearing('6210', 'Carries the wheel on its axle.'), loc(sx * legX, 120, wz, rz=90), (sx * 480, -40, 0), 'TRAVEL')
            for gx in (-1, 1):
                m.place(gan, guide_pd, loc(sx * legX + gx * (rail['w'] / 2 + 22), rail['h'] - 10, wz), (sx * 360, -60, 0), 'TRAVEL')
            for k in range(4):
                a = math.radians(45 + 90 * k)
                m.place(gan, std.hex_bolt(12, 50, '8.8', 'Holds the wheel axle block to the trolley.'),
                        std.orient((sx * (legX + trol['w'] / 2), 120 + 70 * math.cos(a), wz + 70 * math.sin(a)), (-sx, 0, 0)),
                        (sx * 540, 0, 0), 'TRAVEL')
        m.place(gan, gmw_pd, loc(sx * (legX + trol['w'] / 2 + 10), 120, zl + (trol['d'] / 2 - 220), rz=0 if sx > 0 else 180),
                (sx * 600, 0, 0), 'TRAVEL')
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
    clad_pd = m.part(PartDef('WSH-LCL', 'Leg cladding panel, aluminium 2 mm', clad.val(), 'al_extr', 'structure', 'sheet',
                             f'{leg["d"] - 20:.0f} x {lh - 60:.0f}', '5754-H22', None, 'Covers the leg frame. It keeps spray out of the frame.',
                             {}, 'make'))
    for sx in (-1, 1):
        m.place(gan, leg_pd, loc(sx * legX, 0, 0), (sx * 200, 0, 0), 'PORTAL')
        m.place(gan, clad_pd, loc(sx * (legX + leg['w'] / 2 + 2), 0, 0), (sx * 420, 0, 0), 'PORTAL')
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
    for zc in (bz0 - 75, bz1 + 75):                                              # 2 chords, RHS 250 x 150 x 6
        b = (cq.Workplane('XY').box(bl, 250, 150).translate((0, beam['y0'] + 125, zc))
             .cut(cq.Workplane('XY').box(bl + 2, 238, 138).translate((0, beam['y0'] + 125, zc))))
        beamb = b if beamb is None else beamb.union(b)
    for xc in (-bl / 2 + 60, -bl / 6, bl / 6, bl / 2 - 60):                       # cross members, SHS 120 x 120 x 5
        beamb = beamb.union(cq.Workplane('XY').box(120, 120, bz0 - bz1 - 300).translate((xc, beam['y0'] + 125, (bz0 + bz1) / 2))
                            .cut(cq.Workplane('XY').box(110, 110, bz0 - bz1 - 298).translate((xc, beam['y0'] + 125, (bz0 + bz1) / 2))))
    m.place(gan, m.part(PartDef('WSH-BEAM', 'Portal beam weldment', beamb.val(), 'steel_yellow', 'structure', 'EN 1090-2 EXC2',
                                f'{bl:.0f} x {bh:.0f} x {bz0 - bz1:.0f}', 'S355J2', None,
                                'Spans the bay: 2 chords and 4 cross members. Every tool hangs at its own station along it, so none can meet another.',
                                {'stations (z, mm)': f'arch {zf(arch["dy"]):.0f}, wands {zf(wand["dy"]):.0f}, top brush {zf(top["dy"]):.0f}, '
                                                     f'side brushes {zf(side["dy"]):.0f}, air knives {zf(dry_dy):.0f}'}, 'make')),
            Location(), (0, 400, 0), 'PORTAL')
    cov = cq.Workplane('XY').box(bl, 2, bz0 - bz1).translate((0, beam['y1'] + 1, (bz0 + bz1) / 2))
    m.place(gan, m.part(PartDef('WSH-BCV', 'Beam top cover, aluminium 2 mm', cov.val(), 'al_extr', 'structure', 'sheet',
                                f'{bl:.0f} x {bz0 - bz1:.0f}', '5754-H22', None, 'Keeps spray off the valves and blowers on the beam.', {}, 'make')),
            Location(), (0, 600, 0), 'PORTAL')

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
    valve = cq.Workplane('XY').box(70, 90, 60).union(cq.Workplane('XY').circle(22).extrude(60).translate((0, 45, -30)))
    valve_pd = m.part(PartDef('WSH-VLV', 'Solenoid valve G 1/2, 24 V DC, stainless', valve.val(), 'ss316', 'fluid', 'catalogue part',
                              'G 1/2, 0-70 bar', 'IP65', None, 'Switches one chemical or the rinse water to the arch.', {}, 'buy'))
    for i, x in enumerate((-450, -150, 150, 450)):
        m.place(gan, valve_pd, loc(x, beam['y1'] + 45, za + 60), (0, 260, 200), 'ARCH')
    for sx in (-1, 1):
        for y in (1200, 2400):
            ub = (cq.Workplane('XY').box(16, 16, ar * 2 + 40).union(cq.Workplane('XY').box(ar * 2 + 30, 16, 16).translate((0, 0, ar + 20))))
            m.place(gan, m.part(PartDef('WSH-UBT', 'Pipe clamp M10, stainless', ub.val(), 'fast_a4', 'fastener', 'DIN 3570',
                                        'for 124 pipe', 'A4', 25.0, 'Holds the arch pipe to its bracket.', {}, 'buy')),
                    loc(sx * (arch['x'] + 0), y, za - ar - 10), (sx * 80, 0, 340), 'ARCH')

    # ═══════════════════════════════════════════════════════════ TOP BRUSH ═══
    zt = zf(top['dy'])
    tb = gan.child('TopBrush', Location(), sub='TOPBRUSH',
                   joint={'name': 'TOP_BRUSH', 'axis': [0, -1, 0], 'limits': [0, (top['retractY'] - 1000) / 1000 * 1000],
                          'kind': 'prismatic', 'stowed': 0})
    m.place(tb, m.part(PartDef('WSH-TBR', 'Top brush, closed-cell foam strips', _brush(60, top['r'], 2 * top['halfLen']),
                               'brush_blue', 'tool', 'catalogue part', f'D {2 * top["r"]:.0f} x {2 * top["halfLen"]:.0f}', '', None,
                               'Scrubs the car top. Foam strips do not hold grit, so they do not scratch the paint.',
                               {'speed': 'about 135 rpm'}, 'buy', mass_override=45.0)),
            loc(0, top['retractY'], zt, rz=90), (0, -250, 0), 'TOPBRUSH')
    shaft = cq.Workplane('YZ').circle(30).circle(24).extrude(top['halfLen'] + 140, both=True)
    m.place(tb, m.part(PartDef('WSH-TSH', 'Top brush shaft, stainless', shaft.val(), 'ss316', 'drive', 'machined',
                               f'D 60 x {2 * top["halfLen"] + 280:.0f}', '', None, 'Carries the brush between its 2 bearings.', {}, 'make')),
            loc(0, top['retractY'], zt), (0, -180, 0), 'TOPBRUSH')
    fbu = (cq.Workplane('YZ').rect(140, 140).extrude(14).edges('|X').fillet(16)
           .union(cq.Workplane('YZ').circle(46).extrude(46)).cut(cq.Workplane('YZ').circle(30).extrude(80, both=True)))
    fbu_pd = m.part(PartDef('WSH-FBU', 'Flanged bearing unit, 4-bolt, stainless, 60 mm', fbu.val(), 'ss316', 'bearing', 'ISO 3228',
                            'bore 60', 'sealed, wash-down', None, 'Carries one end of a brush shaft.', {}, 'buy'))
    hh = beam['y0'] - top['retractY'] + 120
    hcen = (0, (beam['y0'] + top['retractY']) / 2 - 60, zt)
    hanger = (cq.Workplane('XY').box(160, hh, 140).translate(hcen)
              .cut(cq.Workplane('XY').box(150, hh + 2, 130).translate(hcen))
              .union(cq.Workplane('XY').box(160, 160, 140).translate((0, top['retractY'], zt))
                     .cut(cq.Workplane('YZ', origin=(-100, top['retractY'], zt)).circle(46).extrude(200))))
    hanger_pd = m.part(PartDef('WSH-THG', 'Top brush hanger', hanger.val(), 'ss316', 'structure', 'machined weldment',
                               '160 x 140', '316L', None, 'Hangs the brush from its lift carriage.', {}, 'make'))
    for sx in (-1, 1):
        m.place(tb, hanger_pd, loc(sx * top['hangerX'], 0, 0), (sx * 120, 0, 0), 'TOPBRUSH')
        m.place(tb, fbu_pd, loc(sx * (top['hangerX'] - 80 * sx) + (0 if sx > 0 else 0), top['retractY'], zt, rz=0 if sx > 0 else 180),
                (sx * 200, 0, 0), 'TOPBRUSH')
        for k in range(4):
            yy, zz = top['retractY'] + (50 if k < 2 else -50), zt + (50 if k % 2 else -50)
            m.place(tb, std.hex_bolt(12, 40, 'A4-70', 'Holds the bearing unit to the hanger.'),
                    std.orient((sx * (top['hangerX'] - 80 * sx + 16 * sx), yy, zz), (-sx, 0, 0)), (sx * 260, 0, 0), 'TOPBRUSH')
    tgm = (cq.Workplane('YZ').circle(70).extrude(220).union(cq.Workplane('XY').box(160, 150, 150).translate((-60, 0, 0))))
    m.place(tb, m.part(PartDef('WSH-TBM', 'Top brush gearmotor 0.75 kW, 135 rpm', tgm.val(), 'steel_paint', 'drive', 'catalogue part',
                               '0.75 kW', 'IP66, wash-down', None, 'Turns the top brush. Its current tells the lift how hard the brush presses.',
                               {}, 'buy', mass_override=26.0)), loc(top['hangerX'] + 120, top['retractY'], zt), (400, 0, 0), 'TOPBRUSH')
    # lift: 2 vertical rails on the beam face and a lift gearmotor with toothed belts
    lr = std.rail(25, 1600)
    for sx in (-1, 1):
        m.place(gan, lr, loc(sx * top['hangerX'], beam['y0'] - 820, zt + 90, rx=90), (sx * 100, 0, 200), 'TOPBRUSH')
        m.place(tb, std.rail_block(25), loc(sx * top['hangerX'], top['retractY'] + 400, zt + 90 - 22, rx=90), (sx * 140, 0, 160),
                'TOPBRUSH')
    lgm = cq.Workplane('YZ').circle(55).extrude(200).union(cq.Workplane('XY').box(130, 130, 130).translate((-50, 0, 0)))
    m.place(gan, m.part(PartDef('WSH-TLM', 'Top brush lift gearmotor 0.37 kW, brake', lgm.val(), 'steel_paint', 'drive', 'catalogue part',
                                '0.37 kW', 'IP66', None, 'Raises and lowers the top brush. Its brake holds it when power is off.', {}, 'buy',
                                mass_override=16.0)),
            loc(0, beam['y1'] + 80, zt), (0, 300, 0), 'TOPBRUSH')

    # ═══════════════════════════════════════════════════════════ SIDE BRUSHES ═══
    zs = zf(side['dy'])
    sh = side['y1'] - side['y0']
    for sx, name, mat in ((-1, 'L', 'brush_blue'), (1, 'R', 'brush_red')):
        sb = gan.child(f'SideBrush{name}', Location(), sub='SIDEBRUSH',
                       joint={'name': f'SIDE_BRUSH_{name}', 'axis': [-sx, 0, 0],
                              'limits': [0, (side['retractX'] - 900) / 1000 * 1000], 'kind': 'prismatic', 'stowed': 0})
        x = sx * side['retractX']
        m.place(sb, m.part(PartDef(f'WSH-SBR{name}', 'Side brush, closed-cell foam strips', _brush(70, side['r'], sh), mat, 'tool',
                                   'catalogue part', f'D {2 * side["r"]:.0f} x {sh:.0f}', '', None,
                                   'Scrubs one flank, its doors and wheels.', {'speed': 'about 113 rpm'}, 'buy', mass_override=55.0)),
                loc(x, (side['y0'] + side['y1']) / 2, zs), (sx * 350, 0, 0), 'SIDEBRUSH')
        sshaft = cq.Workplane('XZ', origin=(0, side['y1'] + 250, 0)).circle(35).circle(29).extrude(sh + 260)
        m.place(sb, m.part(PartDef('WSH-SSH', 'Side brush shaft, stainless', sshaft.val(), 'ss316', 'drive', 'machined', f'D 70 x 6 tube, {sh + 260:.0f}',
                                   '', None, 'Hangs the brush from its carriage.', {}, 'make')), loc(x, 0, zs), (sx * 300, 0, 0), 'SIDEBRUSH')
        crg = (cq.Workplane('XY').box(300, 160, 300).translate((x, beam['y0'] - 80, zs))
               .cut(cq.Workplane('XY').box(284, 144, 284).translate((x, beam['y0'] - 80, zs))))
        m.place(sb, m.part(PartDef('WSH-SCG', 'Side brush carriage', crg.val(), 'ss316', 'structure', 'machined weldment', '300 x 300 x 160',
                                   '316L', None, 'Runs on 2 rails under the beam and carries the brush, its motor and bearings.', {}, 'make')),
                Location(), (0, -120, 0), 'SIDEBRUSH')
        sgm = cq.Workplane('XZ').circle(75).extrude(-260).union(cq.Workplane('XY').box(170, 150, 170).translate((0, 70, 0)))
        m.place(sb, m.part(PartDef('WSH-SBM', 'Side brush gearmotor 1.1 kW, 113 rpm', sgm.val(), 'steel_paint', 'drive', 'catalogue part',
                                   '1.1 kW', 'IP66, wash-down', None, 'Turns one side brush. Its current tells the carriage how hard it presses.',
                                   {}, 'buy', mass_override=31.0)), loc(x, beam['y0'] - 160 - 330, zs + 220), (sx * 150, 0, 260), 'SIDEBRUSH')
        m.place(sb, fbu_pd, loc(x, beam['y0'] - 170, zs, rz=90), (0, -40, 0), 'SIDEBRUSH')
        for zz in (-110, 110):
            m.place(sb, std.rail_block(25), loc(x, beam['y0'] - 36, zs + zz, rx=180), (0, 60, 0), 'SIDEBRUSH')
        rk = cq.Workplane('XY').box(1500, 20, 20).translate((sx * (side['retractX'] - 650), beam['y0'] - 10, zs - 180))
        m.place(gan, m.part(PartDef('WSH-SRK', 'Gear rack module 2, 20 x 20, stainless', rk.val(), 'ss316', 'drive', 'DIN 867 tooth form',
                                    '1500 long', '', None, 'The carriage pinion runs along it.', {}, 'buy')), Location(), (0, 80, 0), 'SIDEBRUSH')
        for zz in (-110, 110):
            m.place(gan, std.rail(25, 1800), loc(sx * (side['retractX'] - 700), beam['y0'], zs + zz, ry=90, rx=180), (0, 100, 0), 'SIDEBRUSH')
        for k in range(12):
            for zz in (-110, 110):
                m.place(gan, std.shcs(6, 30, 'A4-80', 'Holds the side brush rail to the beam.'),
                        std.orient((sx * (side['retractX'] - 1570) + sx * k * 150, beam['y0'] - 8, zs + zz), (0, 1, 0)), (0, 150, 0),
                        'SIDEBRUSH')

    # ═══════════════════════════════════════════════════════════════ DRYERS ═══
    zd = zf(dry_dy)
    dt = gan.child('DryerTop', Location(), sub='DRYER',
                   joint={'name': 'DRYER_TOP', 'axis': [0, -1, 0], 'limits': [0, (dtop['retractY'] - 1500) / 1000 * 1000],
                          'kind': 'prismatic', 'stowed': 0})
    kc = (0, dtop['retractY'] + dtop['h'] / 2, zd)
    knife = (cq.Workplane('XY').box(2 * dtop['halfLen'], dtop['h'], dtop['d']).translate(kc)
             .cut(cq.Workplane('XY').box(2 * dtop['halfLen'] - 6, dtop['h'] - 4, dtop['d'] - 4).translate(kc))
             .union(cq.Workplane('XY').box(2 * dtop['halfLen'] - 30, 6, 8).translate((0, dtop['retractY'] + 3, zd))))
    m.place(dt, m.part(PartDef('WSH-DKT', 'Top air knife, stainless', knife.val(), 'ss316', 'tool', 'made to order',
                               f'{2 * dtop["halfLen"]:.0f} long', '', None, 'Blows a sheet of air down over the car top. It follows the shape.',
                               {}, 'make')), Location(), (0, -200, 0), 'DRYER')
    duct = (cq.Workplane('XZ', origin=(0, beam['y0'] - 20, zd)).rect(380, 160).extrude(beam['y0'] - 20 - dtop['retractY'] - dtop['h'])
            .faces('>Y or <Y').shell(-2))
    m.place(dt, m.part(PartDef('WSH-DDU', 'Flexible duct, 380 x 160', duct.val(), 'hose', 'fluid', 'catalogue part', '380 x 160', '', None,
                               'Feeds the top knife from its blower. It folds as the knife lifts.', {}, 'buy')),
            Location(), (0, -100, 0), 'DRYER')
    blower = (cq.Workplane('YZ').circle(260).extrude(280, both=True).union(cq.Workplane('XY').box(300, 260, 300).translate((380, 0, 0))))
    blow_pd = m.part(PartDef('WSH-BLW', 'Centrifugal blower 4 kW, wash-down', blower.val(), 'steel_paint', 'drive', 'catalogue part',
                             '4 kW, 2 pole', 'IP55', None, 'Makes the drying air. The air leaves the knives at high speed.',
                             {'class': 'carwash dryer, 3-4 kW per fan'}, 'buy', mass_override=95.0))
    m.place(gan, blow_pd, loc(-900, beam['y1'] + 270, zd), (0, 400, 0), 'DRYER')
    for sx, name in ((-1, 'L'), (1, 'R')):
        ds = gan.child(f'DryerSide{name}', Location(), sub='DRYER',
                       joint={'name': f'DRYER_SIDE_{name}', 'axis': [-sx, 0, 0], 'limits': [0, (dside['retractX'] - 1200) / 1000 * 1000],
                              'kind': 'prismatic', 'stowed': 0})
        x = sx * (dside['retractX'] + dside['w'] / 2)
        kc2 = (x, (dside['y0'] + dside['y1']) / 2, zd)
        k2 = (cq.Workplane('XY').box(dside['w'], dside['y1'] - dside['y0'], dside['d']).translate(kc2)
              .cut(cq.Workplane('XY').box(dside['w'] - 4, dside['y1'] - dside['y0'] - 6, dside['d'] - 4).translate(kc2)))
        m.place(ds, m.part(PartDef('WSH-DKS', 'Side air knife, stainless', k2.val(), 'ss316', 'tool', 'made to order',
                                   f'{dside["y1"] - dside["y0"]:.0f} tall', '', None, 'Blows the water off one flank.', {}, 'make')),
                Location(), (sx * 260, 0, 0), 'DRYER')
        m.place(gan, blow_pd, loc(sx * (legX - 800), beam['y1'] + 270, zd, ry=0), (sx * 200, 400, 0), 'DRYER')

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
        sleeve_top = wand['topY'] + st_len + 60
        sleeve = (cq.Workplane('XZ', origin=(x, sleeve_top, zw)).rect(sections[0], sections[0]).extrude(sleeve_top - (beam['y0'] - 40))
                  .cut(cq.Workplane('XZ', origin=(x, sleeve_top + 1, zw)).rect(sections[0] - 10, sections[0] - 10).extrude(sleeve_top - beam['y0'] + 42)))
        m.place(gan, m.part(PartDef('WSH-WS1', f'Wand column stage 1 (sleeve), {sections[0]:.0f} x {sections[0]:.0f}', sleeve.val(), 'ss316',
                                    'structure', 'EN 10219', f'{sleeve_top - beam["y0"] + 40:.0f} long', '316L', None,
                                    'Fixed through the beam. It guides the next stage.', {'stowed top': f'{sleeve_top / 1000:.2f} m above grade'},
                                    'make')), Location(), (sx * 100, 300, 0), 'WAND')
        parent = gan
        for k in range(1, WAND_STAGES):
            node = parent.child(f'Wand{name}Drop{k}', Location(), sub='WAND',
                                joint={'name': f'WAND_{name}_DROP{k}', 'axis': [0, -1, 0], 'limits': [0, stroke / n_mov / 1000 * 1000],
                                       'kind': 'prismatic', 'stowed': 0})
            a = sections[k]
            stage_top = sleeve_top - 25 * k
            tube = (cq.Workplane('XZ', origin=(x, stage_top, zw)).rect(a, a).extrude(st_len)
                    .cut(cq.Workplane('XZ', origin=(x, stage_top + 1, zw)).rect(a - 8, a - 8).extrude(st_len + 2)))
            m.place(node, m.part(PartDef(f'WSH-WS{k + 1}', f'Wand column stage {k + 1}, {a:.0f} x {a:.0f}', tube.val(), 'ss316', 'structure',
                                         'EN 10219', f'{st_len:.0f} long', '316L', None,
                                         'Slides a third of the drop. A belt over its pulley drives the next stage.' if k < n_mov
                                         else 'Carries the reach slide at its foot.', {}, 'make')),
                    Location(), (sx * (100 + 40 * k), 300 - 100 * k, 0), 'WAND')
            parent = node
        # the head hangs from the last stage's foot: the reach slide
        foot_y = sleeve_top - 25 * n_mov - st_len
        wh = parent.child(f'Wand{name}Reach', Location(), sub='WAND',
                          joint={'name': f'WAND_{name}_REACH', 'axis': [-sx, 0, 0], 'limits': [0, (wand['x'] - wand['reachX']) / 1000 * 1000],
                                 'kind': 'prismatic', 'stowed': 0})
        arm = cq.Workplane('YZ', origin=(x, foot_y - 40, zw)).circle(wand['r'] * 0.6).extrude(-sx * 560)
        m.place(wh, m.part(PartDef('WSH-WAR', 'Wand reach tube, 52 mm', arm.val(), 'ss316', 'structure', 'EN 10217-7', 'D 52',
                                   '316L', None, 'Reaches in through the door opening to the cabin floor. It is the vacuum duct.', {}, 'make')),
                Location(), (sx * -200, -160, 0), 'WAND')
        head = (cq.Workplane('XY').box(220, 110, 340).edges().fillet(20).translate((x - sx * 640, foot_y - 40, zw))
                .faces('<Y').shell(-3))
        m.place(wh, m.part(PartDef('WSH-WHD', 'Wand vacuum head with lamp', head.val(), 'pa66', 'tool', 'moulded', '220 x 340', '', None,
                                   'Vacuums the floor and lights it for the camera.', {}, 'make')), Location(), (sx * -320, -220, 0), 'WAND')
        dr = cq.Workplane('XY').box(120, 140, 120).edges('|Y').fillet(10).translate((x + sx * 115, sleeve_top - 60, zw))
        m.place(gan, m.part(PartDef('WSH-WDM', 'Wand drop servo gearmotor 0.4 kW, brake', dr.val(), 'steel_paint', 'drive', 'catalogue part',
                                    '0.4 kW', 'IP66', None, 'Drives stage 2 by a toothed belt. Its brake holds the column with power off.',
                                    {}, 'buy', mass_override=7.5)), Location(), (sx * 220, 320, 0), 'WAND')
    m.notes['wand_column'] = {'stages': WAND_STAGES, 'stageLengthMm': round(st_len), 'stowedTopMm': round(wand['topY'] + st_len + 60),
                              'washHallHeightMm': round(10 * spec['yardstick_m_per_plan_unit'] * 1000)}

    # ═══════════════════════════════════════════════ fastener sets, by station ═══
    # cladding panels: 3 columns x 8 rows of button heads each
    for sx in (-1, 1):
        for i in range(8):
            for zz in (zl - leg['d'] / 2 + 100, zl, zl + leg['d'] / 2 - 100):
                m.place(gan, std.bhcs(6, 16, 'A4-80', 'Holds the cladding panel to the leg frame.'),
                        std.orient((sx * (legX + leg['w'] / 2 + 3), leg_y0 + 120 + i * (lh - 240) / 7, zz), (-sx, 0, 0)),
                        (sx * 460, 0, 0), 'PORTAL')
    # beam cover: 2 rows of 20 along the chords
    for i in range(20):
        for zz in (bz0 - 75, bz1 + 75):
            m.place(gan, std.bhcs(5, 12, 'A4-80', 'Holds the beam cover to the chord.'),
                    std.orient((-bl / 2 + 150 + i * (bl - 300) / 19, beam['y1'] + 2, zz), (0, -1, 0)), (0, 640, 0), 'PORTAL')
    # travel gearmotors: 4 x M10 each, through the torque arm into the trolley
    for sx in (-1, 1):
        for k in range(4):
            a = math.radians(45 + 90 * k)
            m.place(gan, std.hex_bolt(10, 35, '8.8', 'Holds the travel gearmotor flange to the trolley.'),
                    std.orient((sx * (legX + trol['w'] / 2 + 12), 120 + 55 * math.cos(a), zl + (trol['d'] / 2 - 220) + 55 * math.sin(a)),
                               (-sx, 0, 0)), (sx * 640, 0, 0), 'TRAVEL')
            m.place(gan, std.washer(10), std.orient((sx * (legX + trol['w'] / 2 + 12), 120 + 55 * math.cos(a),
                                                     zl + (trol['d'] / 2 - 220) + 55 * math.sin(a)), (-sx, 0, 0)), (sx * 620, 0, 0), 'TRAVEL')
    # top brush gearmotor and lift gearmotor flanges
    for k in range(4):
        a = math.radians(45 + 90 * k)
        m.place(tb, std.hex_bolt(10, 30, 'A4-70', 'Holds the top brush gearmotor to its hanger.'),
                std.orient((top['hangerX'] + 90, top['retractY'] + 60 * math.cos(a), zt + 60 * math.sin(a)), (-1, 0, 0)),
                (440, 0, 0), 'TOPBRUSH')
        m.place(gan, std.hex_bolt(8, 25, 'A4-70', 'Holds the lift gearmotor to the beam.'),
                std.orient((45 * math.cos(a), beam['y1'] + 4, zt + 45 * math.sin(a)), (0, -1, 0)), (0, 330, 0), 'TOPBRUSH')
    # lift rails to the beam face, and the rail blocks to the hangers
    for sx in (-1, 1):
        for i in range(13):
            m.place(gan, std.shcs(6, 25, 'A4-80', 'Holds the lift rail to the beam face.'),
                    std.orient((sx * top['hangerX'], beam['y0'] - 1580 + i * 120, zt + 90 - 20), (0, 0, 1)), (sx * 100, 0, 240), 'TOPBRUSH')
        for dx in (-17, 17):
            for dy in (-22, 22):
                m.place(tb, std.shcs(6, 20, 'A4-80', 'Holds the rail block to the hanger.'),
                        std.orient((sx * top['hangerX'] + dx, top['retractY'] + 400 + dy, zt + 90 - 52), (0, 0, 1)), (sx * 140, 0, 200),
                        'TOPBRUSH')
    # side brush: gearmotor flanges, bearing units, rail blocks
    for sx, name in ((-1, 'L'), (1, 'R')):
        node = next(c for c in gan.children if c.name == f'SideBrush{name}')
        x = sx * side['retractX']
        for k in range(4):
            a = math.radians(45 + 90 * k)
            m.place(node, std.hex_bolt(10, 30, 'A4-70', 'Holds the side brush gearmotor to its carriage.'),
                    std.orient((x + 70 * math.cos(a), beam['y0'] - 160, zs + 220 + 70 * math.sin(a)), (0, 1, 0)), (sx * 150, 60, 300),
                    'SIDEBRUSH')
            m.place(node, std.hex_bolt(12, 40, 'A4-70', 'Holds the side brush bearing unit to the carriage.'),
                    std.orient((x + 50 * (1 if k % 2 else -1), beam['y0'] - 160, zs + 50 * (1 if k < 2 else -1)), (0, 1, 0)),
                    (0, 40, 0), 'SIDEBRUSH')
        for zz in (-110, 110):
            for dx in (-24, 24):
                for dz in (-20, 20):
                    m.place(node, std.shcs(6, 16, 'A4-80', 'Holds the rail block to the carriage.'),
                            std.orient((x + dx, beam['y0'] - 160 + 4, zs + zz + dz), (0, 1, 0)), (0, 90, 0), 'SIDEBRUSH')
    # blowers: 4 x M10 feet each
    for bx in (-900, -(legX - 800), legX - 800):
        for fx in (-150, 150):
            for fz in (-150, 150):
                std.bolt_stack(m, gan, 'DRYER', (bx + fx, beam['y1'] + 14, zd + fz), (0, -1, 0), 10, 40, 14,
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
    for x in (-450, -150, 150, 450):
        for dx in (-25, 25):
            m.place(gan, std.shcs(6, 20, 'A4-80', 'Holds the valve to its manifold plate.'),
                    std.orient((x + dx, beam['y1'] + 6, za + 60), (0, -1, 0)), (0, 300, 200), 'ARCH')
    for dx in (-90, 90):
        for dy in (-40, 40):
            m.place(gan, std.shcs(6, 16, 'A4-80', 'Holds the stop light to the beam.'),
                    std.orient((light['x'] + dx, light['y'] + dy, zf(beam['dy1']) - 12), (0, 0, 1)), (0, 0, -230), 'CONTROL')
    for dy in (-300, 300):
        for dz in (-220, 220):
            m.place(gan, std.hex_bolt(10, 30, 'A4-70', 'Holds the control cabinet to the leg.'),
                    std.orient((legX + leg['w'] / 2 + 12, 1600 + dy, zl + dz), (-1, 0, 0)), (420, 0, 0), 'CONTROL')
    # wand masts: a 4-screw clamp each under the beam
    for sx in (-1, 1):
        for k in range(4):
            a = math.radians(45 + 90 * k)
            m.place(gan, std.shcs(8, 25, 'A4-80', 'Clamps the wand mast under the beam.'),
                    std.orient((sx * wand['x'] + 60 * math.cos(a), beam['y0'] - 6, zw + 60 * math.sin(a)), (0, 1, 0)), (sx * 100, 160, 0),
                    'WAND')

    # ═══════════════════════════════════════════ drives the first pass left implicit ═══
    # side brush carriages: a gearmotor and pinion on each, meshing the rack under the beam
    pin = cq.Workplane('XZ').circle(22).extrude(13, both=True).union(cq.Workplane('XZ').circle(8).extrude(40, both=True))
    pin_pd = m.part(PartDef('WSH-PIN', 'Pinion module 2, 20 teeth, stainless', pin.val(), 'ss316', 'drive', 'DIN 867 tooth form',
                            '20 T, m 2', '', None, 'Drives the brush carriage along its rack.', {}, 'buy'))
    cgm = cq.Workplane('XZ').circle(50).extrude(-160).union(cq.Workplane('XY').box(110, 110, 110).translate((0, 50, 0)))
    cgm_pd = m.part(PartDef('WSH-CGM', 'Carriage gearmotor 0.37 kW, brake, encoder', cgm.val(), 'steel_paint', 'drive', 'catalogue part',
                            '0.37 kW', 'IP66, wash-down', None,
                            'Moves the side brush in to the flank. Its current says how hard the brush presses.', {}, 'buy',
                            mass_override=12.0))
    for sx, name in ((-1, 'L'), (1, 'R')):
        node = next(c for c in gan.children if c.name == f'SideBrush{name}')
        x = sx * side['retractX']
        m.place(node, pin_pd, loc(x - sx * 110, beam['y0'] - 34, zs - 180), (sx * 120, 0, -120), 'SIDEBRUSH')
        m.place(node, cgm_pd, loc(x - sx * 110, beam['y0'] - 60, zs - 180 - 60, rx=90), (sx * 160, 0, -220), 'SIDEBRUSH')
        for k in range(4):
            a = math.radians(45 + 90 * k)
            m.place(node, std.hex_bolt(8, 25, 'A4-70', 'Holds the carriage gearmotor to its bracket.'),
                    std.orient((x - sx * 110 + 38 * math.cos(a), beam['y0'] - 60 + 38 * math.sin(a), zs - 180 - 6), (0, 0, 1)),
                    (sx * 160, 0, -240), 'SIDEBRUSH')
    # top brush lift: a cross shaft on the beam with a belt drum over each hanger, in 2 pillow-block bearings
    shaft_l = 2 * top['hangerX'] + 300
    lsh = cq.Workplane('YZ', origin=(-shaft_l / 2, beam['y1'] + 60, zt)).circle(20).extrude(shaft_l)
    m.place(gan, m.part(PartDef('WSH-LSH', 'Lift cross shaft, 40 mm, stainless', lsh.val(), 'ss316', 'drive', 'machined',
                                f'D 40 x {shaft_l:.0f}', '', None, 'Turns both belt drums together, so the brush lifts level.', {}, 'make')),
            Location(), (0, 340, 0), 'TOPBRUSH')
    drum = cq.Workplane('YZ').circle(70).extrude(30, both=True).cut(cq.Workplane('YZ').circle(20).extrude(40, both=True))
    drum_pd = m.part(PartDef('WSH-DRM', 'Lift belt drum 140 mm', drum.val(), 'al6061', 'drive', 'machined', 'D 140 x 60',
                             '6061-T6', None, 'Winds the lift belt that hangs the top brush.', {}, 'make'))
    pb = (cq.Workplane('XY').box(60, 50, 160).translate((0, -25, 0))
          .union(cq.Workplane('YZ').circle(40).extrude(26, both=True)).cut(cq.Workplane('YZ').circle(20).extrude(40, both=True)))
    pb_pd = m.part(PartDef('WSH-PBU', 'Pillow-block bearing unit, 40 mm, stainless', pb.val(), 'ss316', 'bearing', 'ISO 3228',
                           'bore 40', 'sealed, wash-down', None, 'Carries the lift shaft on the beam.', {}, 'buy'))
    for sx in (-1, 1):
        m.place(gan, drum_pd, loc(sx * top['hangerX'], beam['y1'] + 60, zt), (sx * 60, 360, 0), 'TOPBRUSH')
        m.place(gan, pb_pd, loc(sx * (top['hangerX'] + 110), beam['y1'] + 60, zt), (sx * 90, 380, 0), 'TOPBRUSH')
        for dz in (-55, 55):
            std.bolt_stack(m, gan, 'TOPBRUSH', (sx * (top['hangerX'] + 110), beam['y1'] + 10, zt + dz), (0, -1, 0), 12, 50, 14,
                           fn='Holds the pillow block to the beam.', explode=(sx * 90, 400, 0), stainless=True)
    # side air knives: a flexible duct each, up to its blower on the beam
    for sx, name in ((-1, 'L'), (1, 'R')):
        node = next(c for c in gan.children if c.name == f'DryerSide{name}')
        x = sx * (dside['retractX'] + dside['w'] / 2)
        dd = (cq.Workplane('XZ', origin=(x, beam['y0'] - 20, zd)).rect(150, 170).extrude(beam['y0'] - 20 - dside['y1'])
              .faces('>Y or <Y').shell(-2))
        m.place(node, m.part(PartDef('WSH-DDS', 'Flexible duct, 150 x 170', dd.val(), 'hose', 'fluid', 'catalogue part', '150 x 170', '',
                                     None, 'Feeds a side knife from its blower. It flexes as the knife closes on the car.', {}, 'buy')),
                Location(), (sx * 300, 0, 0), 'DRYER')
    # arch: a valve manifold on the beam and the feed hose down to the arch's top pipe
    man = cq.Workplane('XY').box(1100, 60, 60).translate((0, beam['y1'] + 30, za + 60))
    m.place(gan, m.part(PartDef('WSH-MAN', 'Valve manifold, stainless, 4 stations', man.val(), 'ss316', 'fluid', 'machined',
                                '1100 x 60 x 60', '316L', None, 'Carries foam, rinse water and the 2 chemicals to the valves.', {}, 'make')),
            Location(), (0, 240, 200), 'ARCH')
    feed = std.swept('WSH-AFH', 'Arch feed hose, 1 in, stainless braid',
                     [(0, beam['y1'] + 30, za + 30), (0, beam['y1'] - 120, za + 10), (0, arch['top'] + ar + 40, za), (0, arch['top'] + ar + 4, za)],
                     14, 'hose', 'fluid', 10, 'Brings the switched liquid from the manifold to the arch.', {'pressure': '70 bar'},
                     'EN 853', 'DN 25')
    m.place(gan, feed, Location(), (0, 200, 300), 'ARCH')

    # ═══════════════════════════════════════════════════════════════ CONTROL ═══
    zb1 = zf(beam['dy1'])
    sl = (cq.Workplane('XY').box(220, 120, 60).translate((light['x'], light['y'], zb1 - 40)).edges('|Z').fillet(10))
    m.place(gan, m.part(PartDef('WSH-STL', 'Stop light housing', sl.val(), 'steel_paint', 'electrical', 'catalogue part', '220 x 120',
                                'IP66', None, 'Faces the arriving car. It tells the car and its driver to stop or go.', {}, 'buy')),
            Location(), (0, 0, -200), 'CONTROL')
    lamp_r = PartDef('WSH-LMR', 'Signal lamp, red, 100 mm', cq.Workplane('XY').circle(40).extrude(-12).val(), 'led_red', 'electrical',
                     'EN 12368', 'D 100', '', None, 'Red: the program runs. The car must not move.', {}, 'buy')
    lamp_g = PartDef('WSH-LMG', 'Signal lamp, green, 100 mm', cq.Workplane('XY').circle(40).extrude(-12).val(), 'led_green', 'electrical',
                     'EN 12368', 'D 100', '', None, 'Green: the machine is home. The car may go.', {}, 'buy')
    m.place(gan, lamp_r, loc(light['x'] - 55, light['y'], zb1 - 70), (0, 0, -260), 'CONTROL')
    m.place(gan, lamp_g, loc(light['x'] + 55, light['y'], zb1 - 70), (0, 0, -260), 'CONTROL')
    bea = cq.Workplane('XZ', origin=(0, beam['y1'] + 20 + 400, 0)).circle(105).workplane(offset=400).circle(125).loft()
    m.place(gan, m.part(PartDef('WSH-BCN', 'Status beacon', bea.val(), 'led', 'electrical', 'catalogue part', 'D 250', 'IP66', None,
                                'Teal at home, green working, amber moving.', {}, 'buy')),
            loc(-1722, 0, zd), (0, 500, 0), 'CONTROL')
    cab = cq.Workplane('XY').box(300, 800, 600).edges('|Y').fillet(10).translate((legX + leg['w'] / 2 + 160, 1600, zl))
    m.place(gan, m.part(PartDef('WSH-CAB', 'Control cabinet, stainless, IP66', cab.val(), 'ss304', 'electrical', 'EN 62208',
                                '800 x 600 x 300', 'IP66', None,
                                'Holds the controller, 8 drives, the safety relay and the valve outputs. It talks to the twin over the site network.',
                                {}, 'buy', mass_override=85.0)), Location(), (400, 0, 0), 'CONTROL')
    chain = std.chain_link(120, 50, 75)
    n_ch = int((zf(rail['from']) - home * -1000 * 0 - 0) // 75)
    for i in range(70):
        m.place(bay, chain, loc(legX + rail['w'] / 2 + 140, 30, zf(rail['to']) + 100 + i * 75, ry=90), (300, 60, 0), 'CONTROL')
    return m
