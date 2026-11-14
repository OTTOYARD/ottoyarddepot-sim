"""OTTO-WASH — the touchless wash machine in each wash bay (docs/OTTO-WASH.md).

Geometry is the twin's (cad/spec/robots.json <- washSpec.ts, plan units converted once): one portal gantry on
two floor rails at x = +/-3.25 m that travels 7.37 m over the parked car, carrying a spray arch and a top and two
side air knives; and two detail arms, one each side of the car, each on its own floor track. No brush touches the car
(Chase, 2026-11-11): the arch soaks, washes with water jets and rinses, the knives dry, the gantry stows at the
entrance, and the arms come from their docks at the exit and polish each sensor with a soft pad (Chase, 2026-11-12).

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
from ..actuator import SIZES, module_length, rear_od
from .charge_arm import _pitch_layout, build_chain, build_ft_sensor

DARM_MOUNT = 550.0   # each detail arm's J1 mount above grade: the charge arm's own height, so its shoulder stands at 0.99 m
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
    arch, light = sub('arch'), sub('light')
    det = W['detail']                       # the detail arms: track, dock, tool and stow (metres, radians)
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
                     'Side rollers keep the wheels on the rails.',
                     'Between cars, and while the arms work, the machine is stowed at the entrance end, 1.8 m behind the car.'],
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
    m.subsystem('TRACK', 'Detail arm tracks', 'A floor track each side of the car takes a detail arm to any place along the car.',
                how=['2 profile rails on a steel beam, anchored to the slab every metre.',
                     'A servo gearmotor on the carriage drives a pinion on a rack between the rails.',
                     'A cable chain beside the track brings power, network and pure water to the carriage.',
                     'The chain\'s fixed end is bolted to the floor at a floor box. 3 ducts in the slab feed the box from the wall panel.',
                     'The tracks stand 2.1 m from the drive line, inside the gantry rails. The gantry passes over them.'],
                specs={'travel': f'{(det["trackTo"] - det["dockDy"]):.2f} m', 'speed': '1.5 m/s (class)',
                       'from the flank': f'{det["trackX"] - spec["car"]["width"] / 2:.2f} m'}, group='Motion')
    m.subsystem('DOCK', 'Arm docks and pad care', 'Each arm parks at the exit end, folded along its track, with its pad in a rinse cup.',
                how=['A nozzle in the cup rinses the pad with pure water after each car. The pad turns in the cup to throw the water off.',
                     'The dock stands north of the gantry\'s travel, so a parked arm is never under the gantry.',
                     'A signal on each dock faces the car: red while the bay works, green when the car may go.'],
                specs={'pad rinse': 'pure water, after each car'}, group='Tools')
    m.subsystem('J1', 'Detail arm J1 base turn', 'Turns the whole arm about the vertical axis.',
                how=['A size 40 actuator in the pedestal top turns the turret.', 'It is the charge arm\'s own joint.'],
                specs={'gear': 'strain-wave, size 40, 100:1'}, group='Detail arm')
    m.subsystem('J2', 'Detail arm J2 shoulder', 'Leans the upper arm toward or away from the car.',
                how=['A size 50 actuator in the turret boss drives the upper arm.', 'A gas spring balancer carries most of the gravity load.'],
                specs={'gear': 'strain-wave, size 50, 100:1'}, group='Detail arm')
    m.subsystem('UPPER', 'Detail arm upper arm', 'The 1.344 m cast link from the shoulder to the elbow.',
                how=['A hollow aluminium casting, 7 mm wall.'], group='Detail arm')
    m.subsystem('J3', 'Detail arm J3 elbow', 'Folds the forearm to set the reach and the height of the wrist.',
                how=['A size 40 actuator in the upper arm boss drives the forearm.'], specs={'gear': 'strain-wave, size 40, 100:1'},
                group='Detail arm')
    m.subsystem('FORE', 'Detail arm forearm', 'The 1.142 m cast link from the elbow to the wrist centre.',
                how=['A hollow aluminium casting with a dog-leg, so it folds past the upper arm.'], group='Detail arm')
    m.subsystem('WRIST', 'Detail arm wrist (J4, J5, J6)', 'Points the pad square onto a sensor at any angle, as a hand does.',
                how=['The 3 wrist axes meet at one point. So the pad turns about that point and stays on the sensor.',
                     'J6 turns the pad a quarter turn each way to polish. It does not spin free, so no cable winds up.'],
                specs={'gears': 'strain-wave, sizes 25, 25 and 20'}, group='Detail arm')
    m.subsystem('SAFETY', 'Detail arm status', 'Light rings on the arm show its state.',
                how=['Teal at rest, green at work, amber on the move.'], group='Detail arm')
    m.subsystem('POLISH', 'Polishing head', 'A soft pad on a floating, force-sensing head polishes each camera, lidar and radar cover.',
                how=['A 6-axis force sensor reads the push. The arm holds it at 5 N and stops at 10 N.',
                     'A floating joint lets the pad tilt 6 degrees and give 8 mm. So it lies flat on a curved cover.',
                     'The pad is microfibre over soft foam, 120 mm across. It is small enough for the edge of a roof lidar.',
                     'A camera beside the pad finds each sensor. A nozzle mists it with pure water first. No chemical is used.'],
                specs={'pad': f'{2000 * det["padR"]:.0f} mm microfibre on foam, hook-and-loop', 'push': '5 N working, 10 N limit (ASSUMPTION, to be set on test)',
                       'reach': '2.49 m from the shoulder'}, group='Tools')
    m.subsystem('CONTROL', 'Control, supply and signals', 'Runs the program, and tells the car when to stop and when to go.',
                how=['A stainless control cabinet on the inner side of the west leg holds the controller and the drives.',
                     'A stop light faces the arriving car: red while the program runs, green when the car may go.',
                     'A drag chain brings power, the network, water, 2 chemicals and air. It lies in a covered trench in the floor, '
                     'inboard of the west rail. Its fixed end is at mid travel.',
                     'A driver in the cover\'s slot joins its other end to the west trolley. Its bend rolls along at half the '
                     'machine\'s speed.',
                     'A conduit takes the supply cable and the network cable up the leg to the cabinet.',
                     'A closed duct takes the water, the chemicals and the air up the leg, through the beam, to the valve manifold.',
                     'A cable trunk runs from the cabinet through the beam and along its top. A conduit leaves it to each blower, '
                     'each lift motor, the east travel motor, the valves, the beacon and the stop light.',
                     'Nothing stands outboard of the trolleys: the end bays\' outer walls are 48 mm from them.'],
                group='Control')
    m.subsystem('SUPPLY', 'Bay supply', 'Brings power, the network, water, chemicals and air from the building to the machine and to the 2 detail arms.',
                how=['A service panel on the north wall, beside the exit door, is where the building hands over every line.',
                     'On it: a lockable isolator, the detail arms\' drive cabinet, and a shut-off valve for each of the 5 media.',
                     'Every line drops to a pull box at the wall\'s foot. From there it runs in a duct cast into the slab.',
                     '3 ducts end in a pit at the north end of the drag chain\'s trench: power, network and media.',
                     'A closed tray on the trench floor takes those lines to the chain\'s fixed end, at mid travel.',
                     'A bracket holds the chain\'s first link there. A strain relief block clamps each line in front of it.',
                     '3 more ducts go to a floor box at each arm chain\'s fixed end: power, data and pure water.',
                     'The wall, the ducts in the slab and the plant\'s stubs belong to the building. They are shown for context.'],
                specs={'hand-over': 'north wall, west of the exit door, 1.4 m and more north of the gantry\'s travel',
                       'duct fill': '53 % for 1 cable, 31 % for 2, 40 % for more (NEC chapter 9, table 1)',
                       'machine lines': 'supply cable 5G10, network, water 19 mm, 2 chemicals 10 mm, air 12 mm tube',
                       'each arm\'s lines': 'supply, track motor, 24 V, network, 6 mm pure water'}, group='Control')

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
    # the services that pass through the beam between its chords (ON THE MACHINE, below): the media duct from the chain's
    # carrier arm, the cable trunk from the cabinet's top, and the east travel motor's conduit
    MR_X, MR_Z = legX - trol['w'] / 2 - 130, 145.0       # the media duct: on the carrier arm's top, beside the cabinet's conduit
    TK_X, TK_Z = legX - post_x - 160, zl + leg['d'] / 2 - 100 - 240   # the trunk: on the cabinet's top, 15 mm west of the media duct
    GM_PX, GM_PZ = legX - trol['w'] / 2 - 72, zl + trol['d'] / 2 - 220  # a travel gearmotor's motor axis
    for (pid, nm, yd) in (('WSH-DKB', 'Beam bottom deck', beam['y0'] + 2), ('WSH-DKP', 'Beam top deck', beam['y1'] - 2)):
        deck = cq.Workplane('XY').box(bl, 4, dk_w).translate((0, yd, zmid))
        for sx in (-1, 1):                    # the top knife's lift columns pass through both decks
            deck = deck.cut(cq.Workplane('XY').box(140, 6, 140).translate((sx * KH_X, yd, zf(dry_dy) + dtop['d'] / 2 + 34)))
        for (hx, hz, hw, hd_) in ((MR_X, MR_Z, 84, 44), (TK_X, TK_Z, 64, 64), (-GM_PX, GM_PZ, 20, 20)):   # the service sleeves
            deck = deck.cut(cq.Workplane('XY').box(hw, 6, hd_).translate((hx, yd, hz)))
        m.place(gan, m.part(PartDef(pid, f'{nm}, aluminium checker plate 4 mm', deck.val(), 'al_extr', 'structure', 'EN 1386 tread plate',
                                    f'{bl:.0f} x {dk_w:.0f} x 4', '5754-H114', None,
                                    'Closes the beam between its chords and carries the tools hung below it and the drives on it.',
                                    {}, 'make')), Location(), (0, 400 if yd > beam['y0'] + 10 else 380, 0), 'PORTAL')
    m.place(gan, m.part(PartDef('WSH-BEAM', 'Portal beam weldment', beamb.val(), 'steel_yellow', 'structure', 'EN 1090-2 EXC2',
                                f'{bl:.0f} x {bh:.0f} x {bz0 - bz1:.0f}', 'S355J2', None,
                                'Spans the bay: 2 chords and 4 cross members, closed by a deck top and bottom into a box girder. Every tool '
                                'hangs below it at its own station, so none can meet another; the drives stand on top.',
                                {'stations (z, mm)': f'arch {zf(arch["dy"]):.0f}, air knives {zf(dry_dy):.0f}'}, 'make')),
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


    # ═══════════════════════════════════════════════════════ DETAIL ARMS ═══
    # Chase, 2026-11-12: "the final sensor polisher should be swivel/mechanical arms similar to robocharging arm ... able to
    # move like a hand almost to reach difficult angles of cameras and sensors ... independent arms on either side of the
    # car slide down the rail ... and stow before the vehicle departs". So each side of the car has ONE six-axis arm on its
    # own floor track. The arm IS the OTTO-CHARGE ARM's arm (charge_arm.build_chain): the same castings, the same six
    # actuators, the same balancer, so one set of spares and one set of skills serves both. It carries a polishing head
    # where the charge arm carries its connector, and it rides a carriage where the charge arm stands on a riser.
    #   track     2 size-25 rails on a beam at x = +/-trackX, from the dock (north, the exit) to past the car's tail;
    #   dock      north of the gantry's travel: a parked arm is folded along its track, heading north, its pad in a rinse cup;
    #   base      the arm's own frame, as the charge arm's: origin on J1's axis at the mount, +Y up, +Z toward the car.
    CA = spec['chargeArm']
    A_H, A_LU, A_LF, A_LW = (CA[k] * M for k in ('shoulderHeight', 'upperArm', 'forearm', 'wrist'))
    a_radii = {k: v * M for k, v in CA['radii'].items()}
    a_plate_under = -CA['mountPlateUnderside'] * M
    XT = det['trackX'] * M
    z_dock = zf(det['dockDy'] * M)
    z_end = zf(det['trackTo'] * M)                       # the carriage's south stop
    d_trav = z_dock - z_end                              # the carriage's travel, mm
    LT_P = det['tool'] * M                               # J6 flange to the pad's face
    padR = det['padR'] * M
    st_q2, st_q3 = det['stow']['j2'], det['stow']['j3']
    st_q5 = math.pi - (st_q2 + st_q3)                    # the tool hangs straight down
    wc_y = A_H + A_LU * math.cos(st_q2) + A_LF * math.cos(st_q2 + st_q3)       # stowed wrist centre, base frame
    wc_r = A_LU * math.sin(st_q2) + A_LF * math.sin(st_q2 + st_q3)             # and its distance north of J1
    pad_y = DARM_MOUNT + wc_y - (A_LW + LT_P)            # the stowed pad's face, above grade
    rw_, rh_, rbw_, rbh_, rbl_ = std.RAIL[25][0], std.RAIL[25][1], std.RAIL[25][2], std.RAIL[25][3], std.RAIL[25][4]
    RAIL_PC = 2040.0                                     # one rail piece (34 holes at 60)
    n_pc = math.ceil((d_trav + 700) / RAIL_PC)
    tr_l = n_pc * RAIL_PC                                # the track's length
    z_tn = z_dock + 420                                  # the rails' north end: the docked carriage's edge, the end stop and its buffer
    y_bt = 72.0                                          # the beam's top: the rails' seat
    y_cp = y_bt + rbh_                                   # the carriage plate's underside
    CP_T, CP_X, CP_Z = 20.0, 440.0, 660.0                # the carriage plate
    RAIL_DX, BLK_DZ = 100.0, 250.0                       # the rails each side of the rack, and the blocks along them
    GM_X, GM_Z = 40.0, -260.0                            # the track drive on the plate: its pinion on the rack's flank, south of the pedestal
    PED_W = 300.0
    y_pt = DARM_MOUNT + a_plate_under                    # the pedestal's top: the mount plate's underside
    z_cup = z_dock + wc_r                                # the rinse cup, under the parked pad
    tb_l = (z_cup + 130) - (z_tn - tr_l)                 # the beam runs on north past the rails, to carry the dock
    z_bc = (z_cup + 130 + z_tn - tr_l) / 2               # its centre
    tbeam = cq.Workplane('XY').box(240, y_bt - 12, tb_l).cut(cq.Workplane('XY').box(228, y_bt - 24, tb_l + 2))
    tbeam_pd = m.part(PartDef('WSH-DTB', 'Detail arm track beam, RHS 240 x 60 x 6', tbeam.val(), 'steel_s355', 'structure', 'EN 10219',
                              f'{tb_l:.0f} long', 'S355J2, hot-dip galvanised', None,
                              'Carries the 2 rails and the rack of one detail arm track, flat and straight, and the dock at its north end.',
                              {'flatness': '0.3 mm per metre, shimmed on its anchor plates'}, 'make'))
    tpl = (cq.Workplane('XY').box(360, 12, 160)
           .cut(cq.Workplane('XZ', origin=(0, 7, 0)).pushPoints([(-150, 0), (150, 0)]).circle(7).extrude(14)))
    tpl_pd = m.part(PartDef('WSH-DTP', 'Track anchor plate 360 x 160 x 12', tpl.val(), 'steel_s355', 'structure', 'cut plate',
                            '360 x 160 x 12', 'S355J2', None, 'Holds the track beam to the slab.', {}, 'make'))
    trk = cq.Workplane('XY').box(20, 20, tr_l)
    trk_pd = m.part(PartDef('WSH-DRK', 'Gear rack module 3, 20 x 20, stainless', trk.val(), 'ss316', 'drive', 'DIN 867 tooth form',
                            f'{tr_l:.0f} long, in pieces', '', None, 'The carriage pinion runs along it.', {}, 'buy'))
    # the end stop stands on the beam top astride the rack, welded to the beam; its buffer meets the carriage plate's edge
    tst = (cq.Workplane('XY').box(120, 70, 30, centered=(True, False, True))
           .cut(cq.Workplane('XY').box(24, 21, 32, centered=(True, False, True)))
           .union(cq.Workplane('XY').circle(22).extrude(20).translate((0, rbh_ + CP_T / 2, 15))))
    tst_pd = m.part(PartDef('WSH-DTS', 'Track end stop with buffer', tst.val(), 'steel_s355', 'structure', 'welded to the beam, PU buffer',
                            '120 x 70 x 50', '', None, 'Stops the carriage if it runs past its travel.', {}, 'make'))
    blk_pts = [(sxx * RAIL_DX + ex, szz * BLK_DZ + ez) for sxx in (-1, 1) for szz in (-1, 1)
               for ex in (-rbw_ * 0.36, rbw_ * 0.36) for ez in (-rbl_ * 0.26, rbl_ * 0.26)]
    cpl = (cq.Workplane('XY').box(CP_X, CP_T, CP_Z)
           .cut(cq.Workplane('XZ', origin=(0, CP_T, 0)).pushPoints(blk_pts).circle(3.3).extrude(2 * CP_T))       # M6 through
           .cut(cq.Workplane('XZ', origin=(0, CP_T, 0)).pushPoints(blk_pts).circle(5.5).extrude(7 + CP_T / 2))   # heads sunk 7 mm
           .cut(cq.Workplane('XZ', origin=(0, CP_T, 0)).pushPoints([(GM_X, GM_Z)]).circle(13).extrude(2 * CP_T)))
    cpl_pd = m.part(PartDef('WSH-DCP', 'Arm carriage plate, 440 x 660 x 20', cpl.val(), 'steel_s355', 'structure', 'machined plate',
                            '440 x 660 x 20', 'S355J2', None, 'Rides the 4 rail blocks and carries the pedestal and the track drive.', {}, 'make'))
    ped_h = y_pt - (y_cp + CP_T)
    ped = (cq.Workplane('XY').box(380, 14, 380, centered=(True, False, True))
           .union(cq.Workplane('XY').box(PED_W, ped_h - 16, PED_W, centered=(True, False, True))
                  .cut(cq.Workplane('XY').box(PED_W - 16, ped_h, PED_W - 16, centered=(True, False, True))))
           .union(cq.Workplane('XY').box(PED_W, 16, PED_W, centered=(True, False, True)).translate((0, ped_h - 16, 0)))
           .cut(cq.Workplane('XZ', origin=(0, ped_h + 1, 0)).circle(118).extrude(18))
           .cut(cq.Workplane('XY').box(PED_W - 80, 150, 30, centered=(True, False, True)).translate((0, 40, PED_W / 2)))
           .cut(cq.Workplane('XZ', origin=(0, 15, 0)).pushPoints([(sxx * 170, szz * 170) for sxx in (-1, 1) for szz in (-1, 1)])
                .circle(6.75).extrude(16)))
    ped_pd = m.part(PartDef('WSH-DPD', 'Arm pedestal weldment', ped.val(), 'steel_s355', 'structure', 'EN 1090-2 EXC2',
                            f'{PED_W:.0f} sq x {ped_h:.0f}', 'S355J2, hot-dip galvanised', None,
                            'Lifts the arm to the charge arm\'s own mount height on the carriage. The J1 actuator hangs inside it.',
                            {'window': 'for the cables, toward the cable chain'}, 'make'))
    from ..actuator import stack as _stack
    y_sh = 26 + _stack(SIZES[40])['y_drum']               # J1's drum shoulder, base frame
    mpl = (cq.Workplane('XY').box(300, 26, 300, centered=(True, False, True)).translate((0, a_plate_under, 0))
           .edges('|Y').fillet(12)
           .cut(cq.Workplane('XZ', origin=(0, a_plate_under + 27, 0)).circle(rear_od(SIZES[40]) / 2 + 1).extrude(28))
           .cut(cq.Workplane('XZ', origin=(0, a_plate_under + 27, 0)).circle(SIZES[40].od / 2).extrude(a_plate_under + 27 - y_sh)))
    mp_pts = [(p[0], p[2]) for p in std.circle_points(8, 122, 'y', start=22.5)]
    mpl = mpl.faces('>Y').workplane(centerOption='CenterOfBoundBox').pushPoints(mp_pts).cboreHole(13.5, 20.5, 12.5)
    mpl_pd = m.part(PartDef('WSH-DMP', 'Arm mount plate', mpl.val(), 'steel_paint', 'structure', 'machined', '300 x 300 x 26',
                            'S355J2', None, 'Carries the J1 actuator and spreads its load into the pedestal.', {'flatness': '0.05 mm'},
                            'make'))
    dgm = (cq.Workplane('XY').box(140, 12, 140).translate((0, 6, 0))
           .union(cq.Workplane('XY').box(90, 110, 90).translate((0, 12 + 55, 0)))
           .union(cq.Workplane('XZ', origin=(0, 122, 0)).circle(42).extrude(-170)))
    dgm_pd = m.part(PartDef('WSH-DGM', 'Track servo gearmotor 1.5 kW, brake, absolute encoder', dgm.val(), 'steel_paint', 'drive',
                            'catalogue part', '1.5 kW', 'IP66, wash-down', None,
                            'Drives the carriage along the track. Its brake holds the carriage when power is off.', {}, 'buy',
                            mass_override=19.0))
    # the pinion under the plate, on the rack's flank; its shaft comes up through the plate to the gearmotor's hollow output
    dpn = cq.Workplane('XZ', origin=(0, 0, 0)).circle(30).extrude(24).union(cq.Workplane('XZ', origin=(0, CP_T, 0)).circle(12).extrude(CP_T))
    dpn_pd = m.part(PartDef('WSH-DPN', 'Pinion module 3, 20 teeth, stainless', dpn.val(), 'ss316', 'drive', 'DIN 867 tooth form',
                            '20 T, m 3', '', None, 'Drives the carriage along its rack.', {}, 'buy'))
    # the polishing head, in the tool frame (origin on the J6 flange face, +Y out): the force sensor (charge arm's own),
    # a floating joint, the backing plate and the pad
    y_ft = 40.0
    fl = (cq.Workplane('XZ', origin=(0, y_ft, 0)).circle(50).extrude(-8)
          .cut(cq.Workplane('XZ', origin=(0, y_ft + 9, 0)).pushPoints([(p[0], p[2]) for p in std.circle_points(3, 40, 'y', start=60)])
               .circle(3.4).extrude(10))
          .union(cq.Workplane('XZ', origin=(0, y_ft + 22, 0)).circle(50).extrude(-8)))
    fl_el = cq.Solid.makeCylinder(26, 14, Vector(0, y_ft + 8, 0), Vector(0, 1, 0))
    fl_sp = [cq.Solid.makeCylinder(7, 14, Vector(38 * math.cos(2 * math.pi * i / 3), y_ft + 8, 38 * math.sin(2 * math.pi * i / 3)),
                                   Vector(0, 1, 0)) for i in range(3)]
    fl_pd = m.part(PartDef('WSH-PFL', 'Floating joint: elastomer gimbal and 3 springs', cq.Compound.makeCompound(fl.vals() + [fl_el] + fl_sp),
                           'al6061', 'tool', 'machined, elastomer bonded', 'OD 100 x 30', '', None,
                           'Lets the pad tilt 6 degrees and give 8 mm, so it lies flat on a curved cover with an even, light push.',
                           {'tilt': '6 deg', 'give': '8 mm'}, 'make', mass_override=0.45))
    bp = cq.Workplane('XZ', origin=(0, y_ft + 30, 0)).circle(padR - 8).extrude(-8)
    bp_pd = m.part(PartDef('WSH-PBP', 'Pad backing plate, hook face', bp.val(), 'pa66', 'tool', 'moulded', f'D {2 * (padR - 8):.0f} x 8',
                           'PA66', None, 'Holds the pad by hook-and-loop. Smaller than the pad, so only foam comes near the paint.', {},
                           'make'))
    pad = cq.Workplane('XZ', origin=(0, y_ft + 38, 0)).circle(padR).extrude(-(LT_P - y_ft - 38))
    pad_pd = m.part(PartDef('WSH-PAD', 'Polishing pad, microfibre on soft foam', pad.val(), 'pad_white', 'tool', 'consumable',
                            f'D {2 * padR:.0f} x {LT_P - y_ft - 38:.0f}', 'lint-free microfibre', None,
                            'The only part that touches the car. It polishes a sensor cover as a soft cloth in a hand does.',
                            {'change': 'each shift, by hand, in seconds'}, 'buy', mass_override=0.06))
    # The sensor bracket, on the wrist tube (charge_arm.build_chain's CHG-WTB, J5 frame: the tool's axis is +Y). The tube's
    # cheek is a flat plate at x = cheek5_x. The J5 flange screws' heads stand on it inside 51 mm of the J5 axis, and the J6
    # socket ring stands out past it from tube_top - 30 up. Between the two is a clear flat strip, and the foot sits on it.
    L5_ = _pitch_layout(25)
    cheek5_x = L5_['out_x'] + 14
    s6_ = SIZES[20]
    tube_top = A_LW - module_length(s6_) + s6_.of_t + s6_.xrb[2] + 4
    r6_ = max(s6_.od, rear_od(s6_)) / 2
    xb = max(cheek5_x, r6_ + 22) + 8                     # the upright's outer face: clear of the J6 socket and its light ring
    y_b0, y_b1 = 56.0, tube_top - 30 - 2                 # the foot: above the flange screws' heads, 2 mm under the socket ring
    y_bm = (y_b0 + y_b1) / 2
    FOOT_T, FOOT_Z = 8.0, 110.0
    sbr = (cq.Workplane('XY').box(FOOT_T, y_b1 - y_b0, FOOT_Z).translate((cheek5_x + FOOT_T / 2, y_bm, 0))             # the foot
           .union(cq.Workplane('XY').box(xb - cheek5_x - FOOT_T, y_b1 - y_b0, 44).translate(((xb + cheek5_x + FOOT_T) / 2, y_bm, 0)))  # the web
           .union(cq.Workplane('XY').box(8, A_LW + 60 - y_b0, 44).translate((xb - 4, (A_LW + 60 + y_b0) / 2, 0))))    # the upright
    sbr_pd = m.part(PartDef('WSH-PSB', 'Sensor bracket, stainless', sbr.val(), 'ss316', 'structure', 'bent and welded plate',
                            f'{A_LW + 60 - y_b0:.0f} long', '316L', None,
                            'Carries the camera and the mist nozzle beside the pad, on the wrist and not on the turning head. '
                            'Its foot bolts to the wrist tube\'s flat cheek.', {}, 'make'))
    cam = (cq.Workplane('XY').box(44, 60, 44).union(cq.Workplane('XZ', origin=(0, 30, 0)).circle(16).extrude(-14)))
    cam_pd = m.part(PartDef('WSH-PCM', 'Sensor-finding camera with ring light, IP67', cam.val(), 'pa66', 'sensor', 'catalogue part',
                            '44 x 60 x 44', 'IP67', None,
                            'Finds each camera, lidar and radar cover on the car, so the pad goes to the sensor and not to the paint.',
                            {}, 'buy', mass_override=0.35))
    mist = std.nozzle('fan', 'Mists the sensor cover with pure water before the pad touches it. A damp polish lifts the film a dry pad would drag.')
    # the dock: a post north of the track with the rinse cup under the parked pad, and the exit signal
    cup_r = padR + 25
    cup = (cq.Workplane('XZ', origin=(0, pad_y + 30, 0)).circle(cup_r + 3).extrude(30 + 40 + 3)
           .cut(cq.Workplane('XZ', origin=(0, pad_y + 31, 0)).circle(cup_r).extrude(31 + 40)))
    cup_pd = m.part(PartDef('WSH-DCKC', 'Pad rinse cup, stainless', cup.val(), 'ss316', 'fluid', 'spun sheet 3 mm',
                            f'D {2 * (cup_r + 3):.0f} x 73', '316L', None,
                            'The parked pad hangs in it. A nozzle rinses the pad, and the pad turns to throw the water off.', {}, 'make'))
    post_h = pad_y - 43 - y_bt                           # the post stands on the track beam's north end
    post = (cq.Workplane('XY').box(200, 12, 200, centered=(True, False, True))
            .union(cq.Workplane('XY').box(80, post_h - 12, 80, centered=(True, False, True)).translate((0, 12, 0))
                   .cut(cq.Workplane('XY').box(68, post_h, 68, centered=(True, False, True)).translate((0, 12, 0))))
            .union(cq.Workplane('XY').box(160, 10, 160, centered=(True, False, True)).translate((0, post_h - 10, 0)))
            .cut(cq.Workplane('XZ', origin=(0, 13, 0)).pushPoints([(sxx * 75, szz * 75) for sxx in (-1, 1) for szz in (-1, 1)])
                 .circle(5.5).extrude(14)))
    post_pd = m.part(PartDef('WSH-DCKP', 'Dock post weldment', post.val(), 'steel_s355', 'structure', 'EN 1090-2 EXC2',
                             f'80 sq x {post_h:.0f}', 'S355J2, hot-dip galvanised', None,
                             'Carries the rinse cup and the exit signal. It is bolted to the track beam\'s north end.', {}, 'make'))
    sig = cq.Workplane('XY').box(120, 240, 60)
    sig_pd = m.part(PartDef('WSH-DCKS', 'Exit signal housing', sig.val(), 'steel_paint', 'electrical', 'catalogue part',
                            '120 x 240 x 60', 'IP66', None, 'Faces the car in the bay: red while the bay works, green when the car may go.',
                            {}, 'buy'))
    lamp_r2 = PartDef('WSH-LMR', 'Signal lamp, red, 100 mm', cq.Workplane('XY').circle(40).extrude(-12).val(), 'led_red', 'electrical',
                      'catalogue part', 'D 100', 'IP66', None, 'Red: the car must stay.', {}, 'buy')
    lamp_g2 = PartDef('WSH-LMG', 'Signal lamp, green, 100 mm', cq.Workplane('XY').circle(40).extrude(-12).val(), 'led_green', 'electrical',
                      'catalogue part', 'D 100', 'IP66', None, 'Green: the car may go.', {}, 'buy')
    dk_link = std.chain_link(57, 35, 56)
    R_dk = 100.0
    n_dk = math.ceil((d_trav + 250 + math.pi * R_dk + 120) / 56)
    S_ARM = {'L': None, 'R': None}
    for sx, name in ((-1, 'L'), (1, 'R')):
        x0 = sx * XT
        # ── the track, on the slab ──
        z_tc = z_tn - tr_l / 2
        m.place(bay, tbeam_pd, loc(x0, (y_bt + 12) / 2, z_bc), (sx * 200, 0, 0), 'TRACK')
        # an anchor plate each metre, one under the dock, and one in line with the gantry rail's north plate for the tie
        z_tie = zf(rail['from'])
        zps = sorted({round(z_tn - 80 - i * 1000, 1) for i in range(int(tr_l // 1000))} | {round(z_tn - tr_l + 80, 1), round(z_cup + 40, 1)},
                     reverse=True)
        zps = [z for z in zps if abs(z - z_tie) > 240] + [z_tie]
        for zp in zps:
            m.place(bay, tpl_pd, loc(x0, 6, zp), (sx * 200, -60, 0), 'TRACK')
            for dx in (-150, 150):
                m.place(bay, anchor, std.orient((x0 + dx, 12, zp), (0, -1, 0)), (sx * 200, 100, 0), 'TRACK')
        # the tie to the gantry rail: a flat bar on the slab from this track's plate to the rail's north anchor plate. It
        # keeps the track parallel to the rail, so the arm's places on the car stay where the gantry's own are.
        x_a, x_b = XT + 180, legX - 130 + 15                 # the track plate's edge, and 15 mm onto the rail plate
        tie = cq.Workplane('XY').box(x_b - x_a, 8, 60, centered=(True, False, True))
        m.place(bay, m.part(PartDef('WSH-DTT', 'Track tie bar, galvanised flat 60 x 8', tie.val(), 'steel', 'structure', 'flat bar',
                                    f'60 x 8 x {x_b - x_a:.0f}', 'S235, galvanised', None,
                                    'Ties the arm track to the gantry rail, so the two stay parallel.', {}, 'make')),
                loc(sx * (x_a + x_b) / 2, 0, z_tie), (sx * 250, -40, 0), 'TRACK')
        for k in range(n_pc):
            zc = z_tn - RAIL_PC / 2 - k * RAIL_PC
            for dx in (-RAIL_DX, RAIL_DX):
                m.place(bay, std.rail(25, RAIL_PC), loc(x0 + dx, y_bt, zc), (sx * 200, 80, 0), 'TRACK')
                for i in range(0, 34, 2):               # each screw's head on its counterbore's floor, 0.45 of the rail down
                    m.place(bay, std.shcs(6, 20, 'A4-80', 'Holds the track rail to its beam.'),
                            std.orient((x0 + dx, y_bt + rh_ * 0.55, zc - RAIL_PC / 2 + 30 + 60 * i), (0, -1, 0)), (sx * 200, 130, 0), 'TRACK')
        m.place(bay, trk_pd, loc(x0, y_bt + 10, z_tc), (sx * 200, 60, 0), 'TRACK')
        for zz, ry_ in ((z_tn - 40, 180), (z_tn - tr_l + 40, 0)):
            m.place(bay, tst_pd, loc(x0, y_bt, zz, ry=ry_), (sx * 200, 160, 0), 'TRACK')
        # ── the carriage: it slides south from the dock ──
        car_ = bay.child(f'DArmRail{name}', Location(), sub='TRACK',
                         joint={'name': f'DARM_{name}_RAIL', 'axis': [0, 0, -1], 'limits': [0, (d_trav + OVER_MM) / 1000],
                                'kind': 'prismatic', 'stowed': 0})
        m.place(car_, cpl_pd, loc(x0, y_cp + CP_T / 2, z_dock), (0, 60, 0), 'TRACK')
        for dx in (-RAIL_DX, RAIL_DX):
            for dz in (-BLK_DZ, BLK_DZ):
                m.place(car_, std.rail_block(25), loc(x0 + dx, y_bt, z_dock + dz), (0, 30, 0), 'TRACK')
        for (ex, ez) in blk_pts:                        # their heads sunk 7 mm into the plate, under the pedestal's foot
            m.place(car_, std.shcs(6, 20, 'A4-80', 'Holds the carriage plate to a rail block.'),
                    std.orient((x0 + ex, y_cp + CP_T - 7, z_dock + ez), (0, -1, 0)), (0, 110, 0), 'TRACK')
        m.place(car_, ped_pd, loc(x0, y_cp + CP_T, z_dock, ry=0 if sx < 0 else 180), (0, 90, 0), 'TRACK')
        for ex in (-170, 170):                          # outside the pedestal's tube, into the plate's tapped holes
            for ez in (-170, 170):
                m.place(car_, std.hex_bolt(12, 30, 'A4-70', 'Holds the pedestal\'s foot to the carriage plate.'),
                        std.orient((x0 + ex, y_cp + CP_T + 14, z_dock + ez), (0, -1, 0)), (0, 140, 0), 'TRACK')
        # the track drive at the carriage's south end: the gearmotor on the plate, its pinion under it on the rack's flank
        xg = x0 + GM_X
        m.place(car_, dgm_pd, loc(xg, y_cp + CP_T, z_dock + GM_Z), (0, 180, -120), 'TRACK')
        m.place(car_, dpn_pd, loc(xg, y_cp, z_dock + GM_Z), (0, -60, -120), 'TRACK')
        for ex in (-55, 55):                            # on the flange, outside the motor's body
            for ez in (-55, 55):
                m.place(car_, std.shcs(8, 25, 'A4-80', 'Holds the track gearmotor to the carriage plate.'),
                        std.orient((xg + ex, y_cp + CP_T + 12, z_dock + GM_Z + ez), (0, -1, 0)), (0, 220, -120), 'TRACK')
        # ── the arm's base frame on the carriage: +Z toward the car ──
        base_ = car_.child(f'DArmBase{name}', loc(x0, DARM_MOUNT, z_dock, ry=-sx * 90), sub='J1')
        m.place(base_, mpl_pd, Location(), (0, 60, 0), 'J1')
        for p in std.circle_points(8, 122, 'y', offset=a_plate_under + 26 - 12.5, start=22.5):
            m.place(base_, std.shcs(12, 45, '10.9', 'Holds the mount plate to the pedestal\'s top flange.'), std.orient(p, (0, -1, 0)),
                    (0, 200, 0), 'J1')
        S_side = dict(CA)
        S_side['stowed'] = {'j1': sx * math.pi / 2, 'j2': st_q2, 'j3': st_q3, 'j4': 0.0, 'j5': st_q5, 'j6': 0.0}
        ch = build_chain(m, base_, S_side, A_H, A_LU, A_LF, A_LW, a_radii, a_plate_under, jp=f'DARM_{name}_')
        # ── the polishing head on J6 ──
        tool_ = ch['j6'].child(f'DArmTool{name}', loc(0, 0, 0), sub='POLISH')
        build_ft_sensor(m, tool_, 'POLISH')
        m.place(tool_, fl_pd, Location(), (0, 100, 0), 'POLISH')
        for p in std.circle_points(3, 40, 'y', offset=y_ft + 8, start=60):     # between the 3 springs, outside the elastomer
            m.place(tool_, std.shcs(6, 16, 'A4-80', 'Holds the floating joint to the force sensor.'), std.orient(p, (0, -1, 0)),
                    (0, 120, 0), 'POLISH')
        m.place(tool_, bp_pd, Location(), (0, 140, 0), 'POLISH')
        m.place(tool_, pad_pd, Location(), (0, 180, 0), 'POLISH')
        # ── on the wrist, not on the turning head: the camera and the mist nozzle ──
        m.place(ch['j5'], sbr_pd, Location(), (120, 0, 0), 'POLISH')
        for zz in (-40, 40):                            # through the foot's ears, either side of the web, into the cheek
            m.place(ch['j5'], std.shcs(5, 16, 'A4-80', 'Holds the sensor bracket to the wrist tube.'),
                    std.orient((cheek5_x + FOOT_T, y_bm, zz), (-1, 0, 0)), (160, 0, 0), 'POLISH')
        m.place(ch['j5'], cam_pd, loc(xb + 22, A_LW + 20, 0), (200, 0, 0), 'POLISH')
        m.place(ch['j5'], mist, std.orient((xb - 4, A_LW + 60, 0), (0, 1, 0)), (160, 80, 0), 'POLISH')
        # ── the dock, north of the track ──
        m.place(bay, post_pd, loc(x0, y_bt, z_cup), (sx * 260, 0, 200), 'DOCK')
        m.place(bay, cup_pd, loc(x0, 0, z_cup), (sx * 260, 80, 200), 'DOCK')
        m.place(bay, std.nozzle('jet', 'Rinses the parked pad with pure water.'), std.orient((x0, pad_y - 40, z_cup), (0, 1, 0)),
                (sx * 260, 40, 200), 'DOCK')
        for ex in (-75, 75):
            for ez in (-75, 75):
                m.place(bay, std.hex_bolt(10, 25, 'A4-70', 'Holds the dock post to the track beam, into a rivet nut.'),
                        std.orient((x0 + ex, y_bt + 12, z_cup + ez), (0, -1, 0)), (sx * 260, 100, 200), 'DOCK')
        # the exit signal on the post's car side, facing south to the car in the bay
        xs_ = x0 - sx * (40 + 60)
        m.place(bay, sig_pd, loc(xs_, y_bt + post_h - 10 - 140, z_cup), (-sx * 120, 0, 200), 'DOCK')
        m.place(bay, m.part(lamp_r2), loc(xs_, y_bt + post_h - 10 - 90, z_cup - 30), (-sx * 120, 0, 100), 'DOCK')
        m.place(bay, m.part(lamp_g2), loc(xs_, y_bt + post_h - 10 - 190, z_cup - 30), (-sx * 120, 0, 100), 'DOCK')
        # ── the carriage's supply: a cable chain on the floor, outboard of the track ──
        x_ch = x0 + sx * 300
        m.flex(FlexDef(f'WSH-DCH{name}', 'Cable chain 57 x 35, R 100', 'chain',
                       Anchor(bay, (x_ch, 30.0, z_dock + 250), (0, 0, -1)), Anchor(car_, (x_ch, 30.0 + 2 * R_dk, z_dock), (0, 0, -1)),
                       17.5, 'TRACK', 'Carries power, network and pure water to the moving carriage. Its bend rolls along with it.',
                       mat='pa66', category='electrical', pitch=56, bend_r=R_dk, links=n_dk, up=(0, 1, 0), w=57, h=35,
                       link_part=dk_link, kg_per_m=1.6,
                       spec={'carries': 'arm supply cable 12 mm, track motor cable 12 mm, 24 V 8 mm, network 7 mm, pure-water tube 6 mm',
                             'fill': '51 of its 57 mm width with the chain maker\'s clearances (10 % a cable, 20 % a hose, 1 mm at least)',
                             'fixed end': 'on a bracket in front of a floor box, fed by 3 ducts in the slab'}))
        # the carrier arm: a foot on the carriage plate's edge, out past the chain, and an upright whose inner face lies
        # on the outer side of the chain's last link (57 wide, centred on x_ch)
        x_f0, x_up = CP_X / 2 - 20, 300 + 57 / 2             # from the track's line: the foot's start, the upright's inner face
        y_top = 30.0 + 2 * R_dk + 17.5 + 10 - (y_cp + CP_T)  # the upright's height above the plate
        dka = (cq.Workplane('XY').box(x_up + 10 - x_f0, 10, 80, centered=(False, False, True)).translate((x_f0, 0, 0))
               .union(cq.Workplane('XY').box(10, y_top, 80, centered=(False, False, True)).translate((x_up, 0, 0))))
        if sx < 0:
            dka = dka.mirror('YZ')
        m.place(car_, m.part(PartDef(f'WSH-DCA{name}', 'Cable chain carrier arm, stainless', dka.val(), 'ss316', 'structure', 'bent plate',
                                     f'{x_up + 10 - x_f0:.0f} x 80', '316L', None, 'Joins the chain\'s moving end to the carriage.', {}, 'make')),
                loc(x0, y_cp + CP_T, z_dock), (sx * 80, 60, 0), 'TRACK')

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
    R_dc = 200.0
    g_lo, g_hi = gan.joint['limits']
    # the chain's length: half the travel (pass ends and the stow at the entrance), its half-turn bend, and 110 mm spare
    n_dc = math.ceil(((g_hi - g_lo) * 1000.0 / 2 + math.pi * R_dc + 110) / 75)
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
                   spec={'carries': 'supply cable 5G10 (21 mm), network (8), water hose 19 x 27, 2 chemical hoses 10 x 16, air tube 12 x 9',
                         'fill': '117 of 120 mm of width with the chain maker\'s clearances (10 % a cable, 20 % a hose): no spare',
                         'fixed end': 'on a bracket on the trench floor at mid travel, fed by a tray from the supply pit',
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
                                'Joins the driver to the trolley\'s inner wall. The lines run through it to the conduit and the media duct.', {}, 'make')),
            Location(), (-200, 60, 0), 'CONTROL')
    x_cd = x_tw - 45                                     # the conduit, 15 mm off the trolley's inner wall
    cond = std.swept('WSH-DCC', 'Cable conduit, chain to cabinet, 60 mm',
                     [(x_cd, y_arm + 60, 90), (x_cd, 520, 90), (x_post - 150, 1120, z_cab - 200), (x_post - 150, 1299, z_cab - 200)],
                     30, 'cable', 'electrical', 26, 'Carries the supply cable and the network cable from the arm up the leg to the control cabinet.',
                     {'bend': 'R 300 (5 x D)', 'fill': '26 % of its 52 mm bore (2 cables: limit 31 %)'}, 'EN 61386', 'D 60', 'make', bend=300.0)
    m.place(gan, cond, Location(), (-200, 100, 0), 'CONTROL')
    # ═══════════════════════════════════════════ ON THE MACHINE: FROM THE CHAIN AND THE CABINET TO EACH CONSUMER ═══
    # The chain's lines part at the carrier arm. The supply cable and the network cable go up the conduit (WSH-DCC) to the
    # cabinet. The water, the 2 chemicals and the air go up a closed stainless duct, through the beam between its chords,
    # and along the beam's top to the valve manifold. From the cabinet a closed cable trunk goes up through the beam and
    # along its top; a conduit leaves it to each motor, to the valves, to the beacon and to the stop light.
    yT = beam['y1']
    MD_W, MD_H = 80.0, 40.0                               # the media duct: 4 tubes side by side, 22 + 12 + 12 + 12 = 58 of its 76 mm bore
    z_ml = za + 60                                       # the manifold's axis: the duct's lane on the north chord's top
    x_me = 550.0                                         # the manifold's west end
    md = (cq.Workplane('XY').box(MD_W, yT + MD_H - (y_arm + 60), MD_H, centered=(True, False, True)).translate((MR_X, y_arm + 60, MR_Z))
          .union(cq.Workplane('XY').box(MD_W, MD_H, z_ml + MD_W / 2 - (MR_Z - MD_H / 2), centered=(True, False, False))
                 .translate((MR_X, yT, MR_Z - MD_H / 2)))
          .union(cq.Workplane('XY').box(MR_X + MD_W / 2 - x_me, MD_H, MD_W, centered=(False, False, True)).translate((x_me, yT, z_ml))))
    md = (md.cut(cq.Workplane('XY').box(MD_W - 4, yT + MD_H - 2 - (y_arm + 59), MD_H - 4, centered=(True, False, True))
                 .translate((MR_X, y_arm + 59, MR_Z)))
          .cut(cq.Workplane('XY').box(MD_W - 4, MD_H - 4, z_ml + MD_W / 2 - 2 - (MR_Z - MD_H / 2 + 2), centered=(True, False, False))
               .translate((MR_X, yT + 2, MR_Z - MD_H / 2 + 2)))
          .cut(cq.Workplane('XY').box(MR_X + MD_W / 2 - 2 - (x_me - 1), MD_H - 4, MD_W - 4, centered=(False, False, True))
               .translate((x_me - 1, yT + 2, z_ml))))
    m.place(gan, m.part(PartDef('WSH-MRD', 'Media duct, carrier arm to valve manifold, stainless 80 x 40 x 2', md.val(), 'ss316', 'fluid',
                                'welded box duct', f'80 x 40, {yT - y_arm:.0f} up and {MR_X - x_me + z_ml - MR_Z:.0f} along the beam', '316L', None,
                                'Carries the water tube, the 2 chemical tubes and the air tube from the chain\'s carrier arm up the leg, '
                                'through the beam and along its top to the valve manifold.',
                                {'carries': 'water 22 x 1, 2 chemicals 12 x 1, air 12 x 1 (stainless tube)',
                                 'through the beam': 'a sleeve in each deck, between the chords'}, 'make')),
            Location(), (-200, 200, 0), 'CONTROL')
    apt = cq.Workplane('XZ', origin=(0, 45, 0)).circle(12).extrude(45)
    m.place(gan, m.part(PartDef('WSH-APT', 'Air service coupling G 1/2, self-sealing', apt.val(), 'brass', 'fluid', 'catalogue part', 'G 1/2',
                                '', None, 'Ends the air tube on the beam. It gives compressed air for service on the machine. '
                                'No tool on this machine uses air.', {}, 'buy')),
            loc(x_me + 120, yT + MD_H, z_ml), (0, 320, 200), 'CONTROL')
    # the cable trunk: up from the cabinet's top through the beam, south along the beam's top, then the length of the beam
    TK = 60.0
    zL = zd + 200 + 29 + TK / 2                          # its lane: 29 mm north of the blowers' base plates
    xLe = -(TK_X + TK / 2)                               # its east end
    tk = (cq.Workplane('XY').box(TK, yT + TK - 2100, TK, centered=(True, False, True)).translate((TK_X, 2100, TK_Z))
          .union(cq.Workplane('XY').box(TK, TK, TK_Z + TK / 2 - (zL - TK / 2), centered=(True, False, False)).translate((TK_X, yT, zL - TK / 2)))
          .union(cq.Workplane('XY').box(TK_X + TK / 2 - xLe, TK, TK, centered=(False, False, True)).translate((xLe, yT, zL))))
    tk = (tk.cut(cq.Workplane('XY').box(TK - 4, yT + TK - 2 - 2099, TK - 4, centered=(True, False, True)).translate((TK_X, 2099, TK_Z)))
          .cut(cq.Workplane('XY').box(TK - 4, TK - 4, TK_Z + TK / 2 - 2 - (zL - TK / 2 + 2), centered=(True, False, False))
               .translate((TK_X, yT + 2, zL - TK / 2 + 2)))
          .cut(cq.Workplane('XY').box(TK_X + TK / 2 - 2 - (xLe + 2), TK - 4, TK - 4, centered=(False, False, True)).translate((xLe + 2, yT + 2, zL))))
    m.place(gan, m.part(PartDef('WSH-ETK', 'Cable trunk, cabinet to the beam top, stainless 60 x 60 x 2', tk.val(), 'ss316', 'electrical',
                                'welded box duct with a screwed lid', f'60 x 60, {TK_X + TK / 2 - xLe:.0f} along the beam', '316L', None,
                                'Carries the motor, valve and signal cables from the control cabinet up through the beam and along its top. '
                                'Each cable leaves it in its own conduit.', {}, 'make')),
            Location(), (-100, 260, -100), 'CONTROL')
    CD_R = 8.0                                           # each consumer's conduit: 16 mm, one cable of 10 mm or less (39 % of its 14 mm bore)
    CD_BEND = 40.0                                       # 4 x a 10 mm cable, fixed installation (ASSUMPTION: a class figure)

    def e_conduit(pid: str, to: str, pts: list, fn: str) -> PartDef:
        if len(pts) == 2:
            (a, b) = pts
            L = math.dist(a, b)
            sh = cq.Solid.makeCylinder(CD_R, L, Vector(*a), Vector(b[0] - a[0], b[1] - a[1], b[2] - a[2])).cut(
                cq.Solid.makeCylinder(CD_R - 1, L, Vector(*a), Vector(b[0] - a[0], b[1] - a[1], b[2] - a[2])))
            return PartDef(pid, f'Conduit 16 x 1, stainless: {to}', sh, 'ss316', 'electrical', 'EN 61386', 'D 16', '316L', None, fn, {}, 'make')
        return std.swept(pid, f'Conduit 16 x 1, stainless: {to}', pts, CD_R, 'ss316', 'electrical', CD_R - 1, fn,
                         {'bend': f'R {CD_BEND:.0f}'}, 'EN 61386', 'D 16', 'make', bend=CD_BEND)

    y_gmt = y_ax + 65 + 170                              # a travel gearmotor's top
    m.place(gan, e_conduit('WSH-ECR', 'west travel motor', [(GM_PX, y_gmt, GM_PZ), (GM_PX, 1300, GM_PZ)],
                           'Brings the west travel motor\'s cable down from the cabinet\'s floor.'), Location(), (-260, 0, 0), 'CONTROL')
    m.place(gan, e_conduit('WSH-ECL', 'east travel motor', [(-GM_PX, yT + 48, zL + TK / 2), (-GM_PX, yT + 48, GM_PZ), (-GM_PX, y_gmt, GM_PZ)],
                           'Brings the east travel motor\'s cable from the trunk, through the beam and down the east leg.'),
            Location(), (260, 0, 0), 'CONTROL')
    z_bx = zd + 150                                      # a blower motor's north face
    ecb = m.part(e_conduit('WSH-ECB', 'blower motor', [(0, TK, 0), (0, 200, 0), (0, 200, z_bx - zL)],
                           'Brings a blower motor\'s cable from the trunk.'))
    for bx in (-900, -(legX - 800), legX - 800):
        m.place(gan, ecb, loc(bx + 380, yT, zL), (0, 460, 0), 'CONTROL')
    eck = m.part(e_conduit('WSH-ECK', 'top knife lift motor', [(0, TK, 0), (0, kt_top - 80 - yT, 0), (0, kt_top - 80 - yT, z_kh + 60 - zL)],
                           'Brings a lift motor\'s cable from the trunk.'))
    for sx in (-1, 1):
        m.place(gan, eck, loc(sx * (KH_X - 130), yT, zL), (0, 460, 0), 'CONTROL')
    m.place(gan, e_conduit('WSH-ECV', 'valve manifold', [(-300.0, yT + 30, zL + TK / 2), (-300.0, yT + 30, za + 30)],
                           'Brings the 4 valve cables from the trunk to the manifold.'), Location(), (0, 300, 0), 'CONTROL')
    m.place(gan, e_conduit('WSH-ECN', 'status beacon', [(-1722.0, yT + 10, zL - TK / 2), (-1722.0, yT + 10, zd + 125 - 20 * 10 / 400 - 0.1)],
                           'Brings the beacon\'s cable from the trunk.'), Location(), (0, 300, 0), 'CONTROL')
    m.place(gan, e_conduit('WSH-ECS', 'stop light', [(light['x'], yT + 48, zL - TK / 2), (light['x'], yT + 48, zb1 - 40), (light['x'], light['y'] + 60, zb1 - 40)],
                           'Brings the stop light\'s cable from the trunk, over the beam and down its south face.'),
            Location(), (0, 300, -200), 'CONTROL')

    # ═══════════════════════════════════════════════════ THE BAY SUPPLY: FROM THE WALL TO EVERY CHAIN'S FIXED END ═══
    # The site hands every line over at ONE place: a service panel on the north wall, on the pier west of the exit door,
    # north of the gantry's travel and of the arm docks. This is how a rollover wash is fed: its plant (pumps, dosing,
    # compressor, switchboard) stands in a room beside the bay, and the lines cross to the machine in ducts cast into the
    # slab, because a rollover's floor must stay clear for the car and the machine. (Three Common Mistakes Entrepreneurs
    # Make When Building a Car Wash, read 2026-11-14: conduit that is missing or badly placed at construction "can make or
    # break a carwash", https://marketscale.com/industries/aec/three-common-mistakes-entrepreneurs-make-when-building-a-car-wash/ .
    # ASSUMPTION: no rollover maker's site plan was read; the duct sizes and routes below are this CAD's own design.)
    #   wall     an isolator for the machine; a drive cabinet for the 2 detail arms (it also holds the bay's network switch);
    #            5 shut-off valves (water, 2 chemicals, air, pure water); a pull box at the wall's foot.
    #   slab     PVC ducts from the pull box: 3 to a pit at the north end of the drag chain's trench (power, network, media;
    #            mains voltage and network never share a duct), and 3 to a floor box at each arm chain's fixed end.
    #   trench   a closed tray on the trench floor from the pit to the chain's fixed end at mid travel; the chain's end
    #            bracket and strain relief there. The chain's upper run passes 0.36 m over the tray.
    # The building's parts (the wall, the ducts in the slab, the plant's stubs) are reference parts, as the charge arm's pad is.
    U_ = spec['yardstick_m_per_plan_unit'] * M
    z_w = (30.0 / 2 - 0.6) * U_                          # the north wall's inner face: the hall is 30 u deep about the bay's centre
                                                         # (sitePlan.WASH, BAY_STALL_Y), its wall 0.6 u (structurePlan.WALL_T)
    x_door = 11.0 / 2 * U_                               # the exit door's edge (structurePlan.DOOR_WIDTH 11 u)
    x_wall = 7.4 * U_                                    # an end bay's outer wall (cadYard.test.ts)
    bx0, bx1 = x_door + 25, legX + trol['w'] / 2 - 3     # the panel: off the door's edge, and no wider than the trolleys' outer walls
    # Duct sizes. Fill: NEC chapter 9, table 1 (53 % of the bore for 1 cable, 31 % for 2, 40 % for more; read 2026-11-14,
    # https://www.ecmweb.com/national-electrical-code/code-basics/article/20892946/fill-er-up ). The same 40 % is used for
    # the hose duct (ASSUMPTION: no code sets a fill for hoses in a sleeve). ASSUMPTION, from memory and not re-read:
    # schedule 40 PVC conduit's OD and bore (NEC chapter 9, table 4) and its standard elbow radius (table 2).
    PVC40 = {'1/2': (21.3, 15.3, 101.6), '3/4': (26.7, 20.4, 114.3), '1': (33.4, 26.1, 146.1), '1-1/4': (42.2, 34.5, 184.2),
             '1-1/2': (48.3, 40.4, 209.6), '2': (60.3, 52.0, 241.3), '2-1/2': (73.0, 62.1, 266.7), '3': (88.9, 77.3, 330.2)}

    def duct_size(ods: list) -> str:
        lim = {1: 0.53, 2: 0.31}.get(len(ods), 0.40)
        for size, (_, bore, _) in PVC40.items():
            if sum(d * d for d in ods) <= lim * bore * bore:
                return size
        raise ValueError(f'no duct for {ods}')

    def fill(ods: list, size: str) -> str:
        return f'{100 * sum(d * d for d in ods) / PVC40[size][1] ** 2:.0f} % of the bore (limit {({1: 53, 2: 31}.get(len(ods), 40))} %)'

    # the lines, by their outer diameter (ASSUMPTION: class sizes, to be set from the cable and hose maker's sheets)
    L_PWR, L_NET = 21.0, 8.0                             # the machine's supply cable 5G10 and its network cable
    L_WAT, L_CHM, L_AIR = 27.0, 16.0, 12.0               # hoses: water 19 x 27, chemical 10 x 16 (2 of them); air tube 12 x 9
    A_SUP, A_MOT, A_24V, A_ECT, A_SIG, A_H2O = 12.0, 12.0, 8.0, 7.0, 7.0, 6.0   # an arm: supply, track motor, 24 V, network, dock signal, pure water
    zdw = z_w - 75.0                                     # the drops' and ducts' line, inside the pull box
    DAC_W, DAC_H, DAC_D = 500.0, 700.0, 250.0
    ISO_W, ISO_H, ISO_D = 300.0, 400.0, 180.0
    dx0 = bx0 + 5
    vx = [dx0 + 30 + 50 * k for k in range(5)]           # the valves: pure water, air, chemical B, chemical A, water
    ex = [dx0 + d for d in (285.0, 330.0, 375.0, 420.0, 460.0)]   # the cabinet's drops: arm R power, data; arm L power, data; machine network
    ix = bx1 - ISO_W + 110                               # the isolator's drop
    wall = cq.Workplane('XY').box(x_wall - x_door, 2200, 0.6 * U_, centered=(False, False, False)).translate((x_door, 0, z_w))
    m.place(bay, m.part(PartDef('WSH-SWL', 'Wash hall north wall, the pier west of the exit door (part of the building)', wall.val(), 'concrete',
                                'structure', 'building', f'{x_wall - x_door:.0f} x 2200 x {0.6 * U_:.0f}', '', None,
                                'Carries the bay\'s service panel. Shown for context.', {}, 'buy', reference=True)),
            Location(), (0, 0, 300), 'SUPPLY')
    pbx = cq.Workplane('XY').box(bx1 - bx0, 150, 150, centered=(False, False, False)).translate((bx0, 0, z_w - 150))
    m.place(bay, m.part(PartDef('WSH-SPB', 'Pull box at the wall foot, stainless, IP66, 3 compartments', pbx.val(), 'ss304', 'electrical',
                                'EN 62208', f'{bx1 - bx0:.0f} x 150 x 150', 'IP66', None,
                                'Every drop from the panel ends in it and every duct in the slab starts under it. '
                                'Its compartments keep power, network and media apart.', {}, 'buy', mass_override=14.0)),
            Location(), (0, 0, -150), 'SUPPLY')
    dac = cq.Workplane('XY').box(DAC_W, DAC_H, DAC_D, centered=(False, False, False)).edges('|Z').fillet(10).translate((dx0, 1100, z_w - DAC_D))
    m.place(bay, m.part(PartDef('WSH-DAC', 'Detail arm drive cabinet, stainless, IP66', dac.val(), 'ss304', 'electrical', 'EN 62208',
                                f'{DAC_H:.0f} x {DAC_W:.0f} x {DAC_D:.0f}', 'IP66', None,
                                'Holds the 2 detail arms\' power supplies, their 2 track drives, their safety relay and the bay\'s network '
                                'switch. It feeds each arm through the slab and its cable chain.', {}, 'buy', mass_override=48.0)),
            Location(), (0, 0, -300), 'SUPPLY')
    iso = cq.Workplane('XY').box(ISO_W, ISO_H, ISO_D, centered=(False, False, False)).edges('|Z').fillet(8).translate((bx1 - ISO_W, 1300, z_w - ISO_D))
    m.place(bay, m.part(PartDef('WSH-SIS', 'Bay isolator, 3 pole, lockable, in a stainless enclosure', iso.val(), 'ss304', 'electrical',
                                'IEC 60947-3', f'{ISO_H:.0f} x {ISO_W:.0f} x {ISO_D:.0f}', 'IP66', None,
                                'Switches off the supply to the machine and to the detail arms\' cabinet, in sight of both. It takes a padlock.',
                                {'handle height': '1.5 m'}, 'buy', mass_override=9.0)),
            Location(), (0, 0, -300), 'SUPPLY')
    ish = (cq.Workplane('XY').circle(45).extrude(-8).union(cq.Workplane('XY').box(20, 90, 26).translate((0, 0, -8 - 13))))
    m.place(bay, m.part(PartDef('WSH-SIH', 'Isolator handle, red on yellow, padlockable', ish.val(), 'accent', 'electrical', 'IEC 60947-3',
                                'D 90', '', None, 'Turns the bay isolator.', {}, 'buy')),
            loc(bx1 - ISO_W / 2, 1500, z_w - ISO_D), (0, 0, -380), 'SUPPLY')
    nip = cq.Solid.makeCylinder(13.35, bx1 - ISO_W - (dx0 + DAC_W), Vector(dx0 + DAC_W, 1500, z_w - 90), Vector(1, 0, 0))
    m.place(bay, m.part(PartDef('WSH-SNP', 'Conduit nipple, trade size 3/4, isolator to the arm cabinet', nip, 'steel_s355', 'electrical',
                                'rigid conduit', f'3/4 x {bx1 - ISO_W - dx0 - DAC_W:.0f}', '', None,
                                'Brings the detail arm cabinet\'s supply from the isolator.', {}, 'make')), Location(), (0, 0, -300), 'SUPPLY')
    for (pid, nm, x, y0, r, fn) in (
            ('WSH-SSE', 'Supply conduit from the plant room switchboard (part of the building)', bx1 - ISO_W / 2, 1300 + ISO_H, 21.1,
             'Brings the 3-phase supply to the bay isolator. Shown for context.'),
            ('WSH-SSN', 'Network conduit from the site network (part of the building)', dx0 + 150, 1100 + DAC_H, 13.35,
             'Brings the site network to the switch in the arm cabinet. Shown for context.')):
        m.place(bay, m.part(PartDef(pid, nm, cq.Solid.makeCylinder(r, 2200 - y0, Vector(x, y0, z_w - 60), Vector(0, 1, 0)), 'steel_s355',
                                    'electrical', 'building', f'D {2 * r:.0f}', '', None, fn, {}, 'buy', reference=True)),
                Location(), (0, 200, -300), 'SUPPLY')
    VALVE_Y = 820.0
    v_pd, s_pd, d_pd = {}, {}, {}
    for (tag, bw, r) in (('22', 44.0, 11.0), ('12', 30.0, 6.0)):
        vb = (cq.Workplane('XY').box(bw, 80, 40).translate((0, 0, -50)).union(cq.Workplane('XY').box(10, 10, 80).translate((0, 25, -110))))
        v_pd[tag] = m.part(PartDef(f'WSH-SBV{tag}', f'Shut-off ball valve, angle pattern, {tag} mm, stainless, lockable lever', vb.val(), 'ss316',
                                   'fluid', 'catalogue part', f'{tag} mm', '', None,
                                   'Shuts one medium off at the wall. The line beyond it can then be opened.', {}, 'buy'))
        s_pd[tag] = m.part(PartDef(f'WSH-SS{tag}', f'Plant supply stub through the wall, {tag} mm (part of the building)',
                                   cq.Solid.makeCylinder(r, 30, Vector(0, 0, -30), Vector(0, 0, 1)), 'ss316', 'fluid', 'building', f'D {tag}', '',
                                   None, 'Brings one medium from the plant room to its valve. Shown for context.', {}, 'buy', reference=True))
        d_pd[tag] = m.part(PartDef(f'WSH-SD{tag}', f'Valve drop tube, {tag} x 1, stainless', cq.Solid.makeCylinder(r, VALVE_Y - 40 - 150, Vector(0, 150, -50), Vector(0, 1, 0))
                                   .cut(cq.Solid.makeCylinder(r - 1, VALVE_Y - 40 - 150, Vector(0, 150, -50), Vector(0, 1, 0))), 'ss316', 'fluid',
                                   'EN 10216-5', f'{tag} x 1, {VALVE_Y - 190:.0f}', '', None, 'Takes one medium from its valve down to the pull box.', {}, 'make'))
    for k, x in enumerate(vx):
        tag = '22' if k == 4 else '12'
        m.place(bay, v_pd[tag], loc(x, VALVE_Y, z_w), (0, 0, -200), 'SUPPLY')
        m.place(bay, s_pd[tag], loc(x, VALVE_Y, z_w), (0, 0, -100), 'SUPPLY')
        m.place(bay, d_pd[tag], loc(x, 0, z_w), (0, 0, -200), 'SUPPLY')
    sz_ap, sz_ad, sz_aw = duct_size([A_SUP, A_MOT, A_24V]), duct_size([A_ECT, A_SIG]), duct_size([A_H2O])
    sz_p, sz_n, sz_m = duct_size([L_PWR]), duct_size([L_NET]), duct_size([L_WAT, L_CHM, L_CHM, L_AIR])
    drop_pd = {}
    for (x, size, y1_, what) in ((ex[0], sz_ap, 1100, 'arm power'), (ex[1], sz_ad, 1100, 'arm data'), (ex[2], sz_ap, 1100, 'arm power'),
                                 (ex[3], sz_ad, 1100, 'arm data'), (ex[4], sz_n, 1100, 'machine network'), (ix, sz_p, 1300, 'machine power')):
        key = (size, y1_)
        if key not in drop_pd:
            od, bore, _ = PVC40[size]
            sh = cq.Solid.makeCylinder(od / 2, y1_ - 150, Vector(0, 150, 0), Vector(0, 1, 0)).cut(
                cq.Solid.makeCylinder(bore / 2, y1_ - 150, Vector(0, 150, 0), Vector(0, 1, 0)))
            drop_pd[key] = m.part(PartDef(f'WSH-SDC{size.replace("/", "").replace("-", "")}{"I" if y1_ > 1100 else ""}',
                                          f'Conduit drop, trade size {size}, panel to the pull box', sh, 'steel_s355', 'electrical',
                                          'rigid conduit', f'{size} x {y1_ - 150:.0f}', '', None,
                                          'Takes cables from the panel down the wall to the pull box.', {}, 'make'))
        m.place(bay, drop_pd[key], loc(x, 0, zdw), (0, 0, -260), 'SUPPLY')

    def cast_duct(pid: str, what: str, size: str, pts: list, ods: list) -> None:
        od, bore, rad = PVC40[size]
        pd = std.swept(pid, f'Duct in the slab, PVC, trade size {size}: {what} (part of the building)', pts, od / 2, 'hose', 'electrical',
                       bore / 2, f'Takes the {what} lines under the floor. Cast into the slab before the machine comes.',
                       {'lines': ', '.join(f'{d:g} mm' for d in ods), 'fill': fill(ods, size), 'bends': f'R {rad:.0f}, 360 degrees or less in all'},
                       'UL 651', size, 'buy', bend=rad)
        pd.reference = True
        m.place(bay, pd, Location(), (0, -260, 0), 'SUPPLY')

    # ── the pit at the trench's north end, and the 3 ducts to it ──
    PIT_L = 500.0
    px0, px1 = x_i - 190, x_o + 25
    z_pn = tz1 + 5 + PIT_L                               # the pit's north wall, inner face
    y_md = -400.0                                        # the machine's ducts: under the arm ducts, and deep enough for their elbows
    xpM, xpN, xpP = px0 + 70, xch - 57.5, px1 - 62.5      # where they enter the pit: media, network, power
    pit = (cq.Workplane('XY').box(px1 - px0 + 10, 5, PIT_L + 10, centered=(False, False, False)).translate((px0 - 5, y_fl - 5, tz1))
           .union(cq.Workplane('XY').box(5, -y_fl - 10, PIT_L + 10, centered=(False, False, False)).translate((px0 - 5, y_fl, tz1)))
           .union(cq.Workplane('XY').box(5, -y_fl - 10, PIT_L + 10, centered=(False, False, False)).translate((px1, y_fl, tz1)))
           .union(cq.Workplane('XY').box(px1 - px0, -y_fl - 10, 5, centered=(False, False, False)).translate((px0, y_fl, tz1)))
           .union(cq.Workplane('XY').box(px1 - px0, -y_fl - 10, 5, centered=(False, False, False)).translate((px0, y_fl, z_pn)))
           .union(cq.Workplane('XY').box(30, 5, PIT_L + 10, centered=(False, False, False)).translate((px0 - 35, -15, tz1)))
           .union(cq.Workplane('XY').box(30, 5, PIT_L + 10, centered=(False, False, False)).translate((px1 + 5, -15, tz1)))
           .union(cq.Workplane('XY').box(px1 - px0 + 70, 5, 30, centered=(False, False, False)).translate((px0 - 35, -15, z_pn + 5)))
           .cut(cq.Workplane('XY').box(x_o - x_i, -y_fl - 15, 7, centered=(False, False, False)).translate((x_i, y_fl, tz1 - 1))))
    for (x, size) in ((xpM, sz_m), (xpN, sz_n), (xpP, sz_p)):
        pit = pit.cut(cq.Workplane('XY', origin=(x, y_md, z_pn - 1)).circle(PVC40[size][0] / 2 + 0.1).extrude(7))
    m.place(bay, m.part(PartDef('WSH-CTP', 'Supply pit liner, galvanised', pit.val(), 'steel', 'structure', 'folded and welded sheet 5 mm',
                                f'{px1 - px0:.0f} x {-y_fl:.0f} x {PIT_L:.0f}', 'S235, galvanised', None,
                                'Lines the pit at the trench\'s north end. The 3 ducts from the wall end in its north wall, and the lines '
                                'turn here into the tray on the trench floor.', {}, 'make')), Location(), (-300, -60, 200), 'SUPPLY')
    pcov = cq.Workplane('XY').box(px1 - px0 + 70, 10, PIT_L + 40, centered=(False, False, False)).translate((px0 - 35, -10, tz1))
    m.place(bay, m.part(PartDef('WSH-CTQ', 'Supply pit cover, galvanised checker plate, bolted', pcov.val(), 'steel', 'structure',
                                'checker plate 10 mm', f'{px1 - px0 + 70:.0f} x {PIT_L + 40:.0f}', 'S235, galvanised, R11 slip', None,
                                'Covers the pit flush with the floor. Off to pull or change a line.', {}, 'make')),
            Location(), (-300, 60, 200), 'SUPPLY')
    xwM, xwN, xwP = vx[2], ex[4], ix
    for (pid, what, size, xw, xp, ods) in (('WSH-SDM', 'machine media', sz_m, xwM, xpM, [L_WAT, L_CHM, L_CHM, L_AIR]),
                                           ('WSH-SDN', 'machine network', sz_n, xwN, xpN, [L_NET]),
                                           ('WSH-SDP', 'machine power', sz_p, xwP, xpP, [L_PWR])):
        cast_duct(pid, what, size, [(xw, 0, zdw), (xw, y_md, zdw), (xw, y_md, zdw - 420), (xp, y_md, z_pn + 1000), (xp, y_md, z_pn)], ods)
    # ── the tray on the trench floor, the chain's fixed-end bracket and strain relief, and the 6 lines ──
    z_t0, z_t1 = z_fix + 130, tz1 + 60
    tray = (cq.Workplane('XY').box(124, 46, z_t1 - z_t0, centered=(True, False, False))
            .cut(cq.Workplane('XY').box(120, 42, z_t1 - z_t0 + 2, centered=(True, False, False)).translate((0, 2, -1))).translate((xch, y_fl, z_t0)))
    m.place(bay, m.part(PartDef('WSH-CTT', 'Supply tray on the trench floor, closed, stainless 124 x 46 x 2', tray.val(), 'ss316', 'structure',
                                'folded sheet with a screwed lid', f'124 x 46 x {z_t1 - z_t0:.0f}', '316L', None,
                                'Carries the 6 lines along the trench floor from the pit to the chain\'s fixed end, under the chain\'s upper run.',
                                {'clear under the upper run': f'{y_up - 25 - (y_fl + 46):.0f} mm'}, 'make')),
            Location(), (-300, -120, 0), 'SUPPLY')
    dfb = (cq.Workplane('XY').box(126, 8, 165, centered=(True, False, False)).translate((xch, y_fl, z_fix - 35))
           .union(cq.Workplane('XY').box(126, 54, 8, centered=(True, False, False)).translate((xch, y_fl + 8, z_fix))
                  .cut(cq.Workplane('XY').box(114, 46, 10, centered=(True, False, False)).translate((xch, y_fl + 12, z_fix - 1)))))
    m.place(bay, m.part(PartDef('WSH-DFB', 'Drag chain fixed-end bracket, stainless, welded to the trench liner', dfb.val(), 'ss316', 'structure',
                                'cut and welded plate 8 mm', '126 x 62 x 165', '316L', None,
                                'Holds the chain\'s first link on the trench floor at mid travel. The lines enter the chain through its window.',
                                {}, 'make')), Location(), (-300, -160, 0), 'SUPPLY')
    y_ln = y_fl + 13                                     # the lines' underside: level with the chain's floor
    lanes = (('W', 'water hose 19 x 27', L_WAT, -41.5, 135.0, 'hose', 'fluid'), ('A', 'chemical hose A 10 x 16', L_CHM, -18.0, 80.0, 'hose', 'fluid'),
             ('B', 'chemical hose B 10 x 16', L_CHM, 0.0, 80.0, 'hose', 'fluid'), ('R', 'air tube 12 x 9', L_AIR, 16.0, 60.0, 'hose', 'fluid'),
             ('N', 'network cable', L_NET, 28.0, 32.0, 'cable', 'electrical'), ('P', 'supply cable 5G10', L_PWR, 44.5, 84.0, 'cable', 'electrical'))
    comb = cq.Workplane('XY').box(120, 40, 30, centered=(True, False, False)).translate((xch, y_fl + 8, z_fix + 55))
    for (_, _, od, lx, _, _, _) in lanes:
        comb = comb.cut(cq.Workplane('XY', origin=(xch + lx, y_ln + od / 2, z_fix + 54)).circle(od / 2 + 0.1).extrude(32))
    m.place(bay, m.part(PartDef('WSH-DFS', 'Strain relief block, 6 saddles, at the chain\'s fixed end', comb.val(), 'pa66', 'electrical',
                                'catalogue part', '120 x 40 x 30', '', None,
                                'Clamps each line in front of the chain\'s fixed end, so no pull reaches the chain or the duct.',
                                {'rule': 'strain relief at the fixed end (chain maker\'s filling rule)'}, 'buy')),
            Location(), (-300, -200, 0), 'SUPPLY')
    src = {'W': (xpM - 10, y_md - 5), 'A': (xpM + 14, y_md + 10), 'B': (xpM + 14, y_md - 9), 'R': (xpM - 8, y_md + 17),
           'N': (xpN, y_md), 'P': (xpP, y_md)}           # each line's place in its duct's mouth (the 4 hoses share the media duct)
    for (tag, nm, od, lx, bend, mat, cat) in lanes:
        (xs, ys) = src[tag]
        ln = std.swept(f'WSH-ML{tag}', f'Machine {nm}, wall to the chain\'s fixed end', [(xs, ys, z_pn), (xs, ys, z_pn - 70),
                       (xch + lx, y_ln + od / 2, tz1 + 150), (xch + lx, y_ln + od / 2, z_fix)], od / 2, mat, cat, 0.0,
                       'Runs from the panel in its duct to the pit, along the tray, through the strain relief and into the chain. '
                       'Drawn from the duct\'s mouth to the chain\'s fixed end.', {'bend': f'R {bend:.0f} or more'}, '', f'OD {od:g}', 'buy', bend=bend)
        m.place(bay, ln, Location(), (-300, -240, 0), 'SUPPLY')
    # ── each detail arm: 3 ducts to a floor box at its chain's fixed end, the end bracket, and the lines into the chain ──
    z_fx = z_dock + 250                                  # the arm chains' fixed end
    z_b0, z_b1 = z_fx + 95, z_fx + 335                   # the floor box
    z_up = z_fx + 275                                    # where the ducts come up into it
    jb = cq.Workplane('XY').box(160, 110, z_b1 - z_b0, centered=(True, False, False)).edges('|Y').fillet(8)
    jb_pd = m.part(PartDef('WSH-DJB', 'Floor box at an arm chain\'s fixed end, stainless, IP67', jb.val(), 'ss316', 'electrical', 'EN 62208',
                           f'160 x 110 x {z_b1 - z_b0:.0f}', 'IP67', None,
                           'The 3 ducts from the wall come up into it. The arm\'s lines leave it through glands into the chain, and '
                           'the dock\'s feed leaves its other end.', {}, 'buy', mass_override=6.5))
    dfe = (cq.Workplane('XY').box(80, 8, 115, centered=(True, False, False)).translate((0, 0, -20))
           .union(cq.Workplane('XY').box(68, 44, 6, centered=(True, False, False)).translate((0, 8, 0))
                  .cut(cq.Workplane('XY').box(50.6, 34.5, 8, centered=(True, False, False)).translate((0, 14.5, -1)))))
    dfe_pd = m.part(PartDef('WSH-DFE', 'Arm chain fixed-end bracket, stainless', dfe.val(), 'ss316', 'structure', 'cut and welded plate',
                            '80 x 52 x 115', '316L', None, 'Holds the arm chain\'s first link on the floor, in front of the floor box.', {}, 'make'))
    a_lanes = (('12', A_SUP, -19.0, 'cable', 'electrical'), ('12', A_MOT, -5.75, 'cable', 'electrical'), ('8', A_24V, 5.5, 'cable', 'electrical'),
               ('7', A_ECT, 14.25, 'cable', 'electrical'), ('6', A_H2O, 22.0, 'hose', 'fluid'))
    al_pd = {}
    for (tag, od, _, mat, cat) in a_lanes:
        if tag not in al_pd:
            al_pd[tag] = m.part(PartDef(f'WSH-DL{tag}', f'Arm line, {od:g} mm, floor box to the chain', cq.Solid.makeCylinder(od / 2, z_b0 - z_fx, Vector(0, 0, 0), Vector(0, 0, 1)),
                                        mat, cat, '', f'OD {od:g}', '', None,
                                        'Runs from the cabinet on the wall in its duct to the floor box, and from the box into the chain. '
                                        'Drawn from the box to the chain\'s fixed end.', {}, 'buy'))
    for sx, name in ((-1, 'L'), (1, 'R')):
        x_c = sx * (XT + 300)                            # the arm chain's line
        m.place(bay, jb_pd, loc(x_c, 0, z_b0), (sx * 200, 0, 200), 'SUPPLY')
        m.place(bay, dfe_pd, loc(x_c, 0, z_fx), (sx * 200, -60, 100), 'SUPPLY')
        for (tag, od, lx, _, _) in a_lanes:
            m.place(bay, al_pd[tag], loc(x_c + lx, 16.5 + od / 2, z_fx), (sx * 200, 60, 150), 'SUPPLY')
        # the dock's feed: the signal's cable and the rinse nozzle's tube, from the box to the track beam, and up inside the post
        xk = x_c - sx * 40
        dk = std.swept(f'WSH-DKF{name}', 'Dock feed conduit 20 x 1, stainless: signal cable and rinse tube',
                       [(xk, 42.0, z_b1), (xk, 42.0, z_cup), (sx * (XT + 120), 42.0, z_cup)], 10.0, 'ss316', 'electrical', 9.0,
                       'Takes the exit signal\'s cable and the pad rinse nozzle\'s tube from the floor box into the track beam under the dock post. '
                       'They rise inside the post.', {'bend': 'R 60'}, 'EN 61386', 'D 20', 'make', bend=60.0)
        m.place(bay, dk, Location(), (sx * 200, 0, 260), 'SUPPLY')
        # the 3 ducts: down from the pull box, south, across to the chain's line, south, and up into the floor box. Each
        # side has its own depth, so the east arm's ducts pass under the west arm's.
        y_d = -230.0 if sx > 0 else -310.0
        xw = (vx[0] - 12, ex[0], ex[1]) if sx > 0 else (vx[0] + 13, ex[2], ex[3])
        zl_ = (z_w - 330, z_w - 460, z_w - 560) if sx > 0 else (z_w - 290, z_w - 460, z_w - 560)
        ducts = (((-40.0, sz_aw, [A_H2O], 'pure water'), (0.0, sz_ap, [A_SUP, A_MOT, A_24V], 'power'), (45.0, sz_ad, [A_ECT, A_SIG], 'data'))
                 if sx > 0 else
                 ((-45.0, sz_aw, [A_H2O], 'pure water'), (0.0, sz_ap, [A_SUP, A_MOT, A_24V], 'power'), (40.0, sz_ad, [A_ECT, A_SIG], 'data')))
        for (dxx, size, ods, what), x_w, z_l in zip(ducts, xw, zl_):
            x_1 = x_c + dxx
            cast_duct(f'WSH-SD{name}{dict(power="P", data="D").get(what, "W")}', f'{"west" if sx > 0 else "east"} arm {what}', size,
                      [(x_w, 0, zdw), (x_w, y_d, zdw), (x_w, y_d, z_l), (x_1, y_d, z_l), (x_1, y_d, z_up), (x_1, 0, z_up)], ods)
    return m
