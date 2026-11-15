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
from ..flex import Anchor, FlexDef, check_contents
from ..actuator import SIZES, module_length, rear_od
from .charge_arm import PORT_F2, _hits, _pitch_layout, build_chain, build_ft_sensor

ELB_LEAD = 10.0      # an arm chain's lines run this far straight out of its last link into the elbow duct, mm


def _bx2(x0, x1, y0, y1, z0, z1):
    """A box between two corners, mm."""
    return cq.Workplane('XY').box(x1 - x0, y1 - y0, z1 - z0, centered=False).translate((x0, y0, z0))


DARM_MOUNT = 550.0   # each detail arm's J1 mount above grade: the charge arm's own height, so its shoulder stands at 0.99 m
# the pure-water loop across each detail arm's wrist (WSH-PWL): its length and shape, searched over every program pose
# (cadFlex.test.ts holds it to its bend at every program step, washFleetClearance.test.ts to 0.08 m off each car)
PWL_L, PWL_MB, PWL_BULGE = 900.0, 45.0, (0.0, (1, 0, 0), (1, 0, 0))   # tightest 133 mm over the twin's poses (45 allowed)
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
    m.yard_deck_y = 0.0                               # the bay floor: the trench, the pit and the ducts are under it
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
                     'A bracket holds the chain\'s fixed end in front of a floor box. 3 ducts in the slab feed the box from the wall panel.',
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
                specs={'hand-over': 'north wall, west of the exit door, 1.8 m north of the rails\' end',
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
    # the side knives' axis gearmotors hang under the bottom deck at each axis's outer end (DRYER, below); each one's
    # conduit leaves the trunk's floor straight down through a sleeve in both decks over the motor, and turns into it
    SK_X = dside['retractX'] + dside['w'] + 120.0          # a side knife axis's outer end, each side
    SK_Z = zf(dry_dy) + dside['d'] / 2 + 30.0              # its line, on the knife's north side
    SKC_X = SK_X - 45.0                                    # the gearmotor's middle, and its conduit's drop
    zL_ = zf(dry_dy) + 200 + 29 + 30.0                     # the cable trunk's lane on the top deck (zL, below)
    for (pid, nm, yd) in (('WSH-DKB', 'Beam bottom deck', beam['y0'] + 2), ('WSH-DKP', 'Beam top deck', beam['y1'] - 2)):
        deck = cq.Workplane('XY').box(bl, 4, dk_w).translate((0, yd, zmid))
        for sx in (-1, 1):                    # the top knife's lift columns pass through both decks
            deck = deck.cut(cq.Workplane('XY').box(140, 6, 140).translate((sx * KH_X, yd, zf(dry_dy) + dtop['d'] / 2 + 34)))
        for (hx, hz, hw, hd_) in ((MR_X, MR_Z, 84, 44), (TK_X, TK_Z, 64, 64), (-GM_PX, GM_PZ, 20, 20),   # the service sleeves
                                  (-SKC_X, zL_, 20, 20), (SKC_X, zL_, 20, 20)):
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
           .cut(cq.Workplane('XY').box(30, 150, PED_W - 60, centered=(True, False, True)).translate((-PED_W / 2, 40, 0)))
           .cut(cq.Workplane('XZ', origin=(0, 15, 0)).pushPoints([(sxx * 170, szz * 170) for sxx in (-1, 1) for szz in (-1, 1)])
                .circle(6.75).extrude(16)))
    ped_pd = m.part(PartDef('WSH-DPD', 'Arm pedestal weldment', ped.val(), 'steel_s355', 'structure', 'EN 1090-2 EXC2',
                            f'{PED_W:.0f} sq x {ped_h:.0f}', 'S355J2, hot-dip galvanised', None,
                            'Lifts the arm to the charge arm\'s own mount height on the carriage. The J1 actuator hangs inside it.',
                            {'window': 'for the supply lines, in the wall toward the cable chain: the elbow duct enters it'}, 'make'))
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
           .union(cq.Workplane('XY').box(8, A_LW + 46 - y_b0, 44).translate((xb - 4, (A_LW + 46 + y_b0) / 2, 0))))    # the upright
    sbr_pd = m.part(PartDef('WSH-PSB', 'Sensor bracket, stainless', sbr.val(), 'ss316', 'structure', 'bent and welded plate',
                            f'{A_LW + 46 - y_b0:.0f} long', '316L', None,
                            'Carries the camera and the mist nozzle beside the pad, on the wrist and not on the turning head. '
                            'Its foot bolts to the wrist tube\'s flat cheek.', {}, 'make'))
    # THE MIST'S WATER (2026-11-15: the pure-water tube stopped in the pedestal, and the nozzle stood screwed into the
    # bracket's 8 mm edge with no water reaching it). On the upright's top a machined holder takes the nozzle and its
    # supply: a stainless tube up the upright's east face from a push-in elbow below the bracket, where the tube from the
    # forearm (WSH-PWL, a loop across J4 and J5) plugs in. Inside the arm the tube runs through J1 to J3 beside the joint
    # cables (their bores are 18.8 and 23.5 mm: the 10 mm cable and the 6 mm tube take 16); J4's and J5's 11.7 mm bores take
    # the joint cable alone, so it leaves the forearm by a bulkhead fitting in the port the charge arm's wrist-end box uses.
    z_st = -22.0 - 3.0                                   # the supply tube's line: on the upright's east face
    noz_h = (cq.Workplane('XY').box(8, 14, 42).translate((xb - 4, A_LW + 53, -9.0)))
    noz_h_pd = m.part(PartDef('WSH-PNH', 'Mist nozzle holder, stainless', noz_h.val(), 'ss316', 'fluid', 'machined from bar',
                              '42 x 14 x 8', '316L', None,
                              'Holds the mist nozzle on the bracket\'s top and feeds it: a drilled passage from the supply tube to the nozzle\'s G 1/4 thread.',
                              {'passage': 'drilled 4 mm, plugged at its ends (not drawn)'}, 'make'))
    pst = std.swept('WSH-PST', 'Mist supply tube 6 x 1, stainless', [(xb - 4, y_b0, z_st), (xb - 4, A_LW + 46, z_st)], 3.0, 'ss316', 'fluid',
                    2.0, 'Brings the pure water up the bracket from the elbow to the nozzle holder.', {'tube': '6 x 1, 316L'}, 'EN 10216-5', 'D 6')
    # under the bracket a push-in elbow turns the supply to face +X, so the loop from the forearm arrives along J5's own
    # axis: J5 then moves that end round the axis and never turns it (a loop arriving from below, searched the same way,
    # bent to 7 mm at the rear wipe)
    pce = (cq.Workplane('XZ', origin=(xb - 4, y_b0, z_st)).circle(5.5).extrude(16.0)
           .union(cq.Workplane('YZ', origin=(xb - 4, y_b0 - 10.0, z_st)).circle(5.5).extrude(15.0)))
    pcu_pd = m.part(PartDef('WSH-PCE', 'Push-in elbow 6 mm, stainless', pce.val(), 'ss316', 'fluid', 'catalogue part', '6 mm, 90 deg',
                            '', None, 'Joins the tube from the forearm to the bracket\'s supply tube, turned to meet it along the wrist\'s axis.', {}, 'buy'))
    PWL_END = (xb + 11.0, y_b0 - 10.0, z_st)              # where the loop plugs in: the elbow's outlet, J5 frame
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
    # the lines, by their outer diameter (ASSUMPTION: class sizes, to be set from the cable and hose maker's sheets)
    L_PWR, L_NET = 21.0, 8.0                             # the machine's supply cable 5G10 and its network cable
    L_WAT, L_CHM, L_AIR = 27.0, 16.0, 12.0               # hoses: water 19 x 27, chemical 10 x 16 (2 of them); air tube 12 x 9
    A_SUP, A_MOT, A_24V, A_ECT, A_SIG, A_H2O = 12.0, 12.0, 8.0, 7.0, 7.0, 6.0   # an arm: supply, track motor, 24 V, network, dock signal, pure water
    # each detail arm's chain: the narrowest light chain (std.CHAIN_CLASSES, from the maker's sheet) that holds its 5 lines
    # side by side, drawn to its outside. 57 x 26 inside is 74 x 35 outside. (This file first drew the link 57 x 35
    # OUTSIDE while it filled 57 mm of width INSIDE it, so the drawn chain was 17 mm too narrow for what it carries.)
    R_dk = 100.0
    DK_FILL = std.chain_fill([A_SUP, A_MOT, A_24V, A_ECT], [A_H2O])
    DK = std.chain_size('light', DK_FILL, 1.1 * max(A_SUP, A_MOT), R_dk)
    dk_link = std.chain_link(DK['ba'], DK['ha'], DK['pitch'], inside=(DK['bi'], DK['hi']))
    n_dk = math.ceil((d_trav + 250 + math.pi * R_dk + 120) / DK['pitch'])
    S_ARM = {'L': None, 'R': None}
    ARM_CHAIN: dict = {}
    ARM_ACTS: dict = {}                                  # each arm's 6 actuators (the cable schedule's joint cables)
    ARM_RING: dict = {}                                  # each arm's status-ring leads (the cable schedule's ring leads)
    PWL_IN: dict = {}                                    # each arm's bulkhead, inside the forearm (the pure water's route up the arm)
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
        ARM_ACTS[name] = ch['acts']
        ARM_RING[name] = ch['ring']
        # the castings' ports, where the charge arm's terminal boxes pass its DC path (charge_arm, PORT_*): a detail arm
        # carries no DC, so each is closed by a plug moulded to it, flush with the casting's wall inside and out
        for pt in ch['ports']:
            if pt['id'] == 'F2':                        # the wrist-end port: the pure water leaves the forearm here
                continue
            m.place(pt['node'], m.part(PartDef(f'CHG-PPL{pt["id"]}', f'Port plug, {pt["link"]}, {pt["where"]}', pt['slug'], 'rubber',
                                               'seal', 'moulded to the port', pt['id'], 'EPDM 70 Shore A', None,
                                               'Closes the casting\'s port that the charge arm\'s terminal box uses: no water gets into the link.',
                                               {'fits': 'pressed in, flush with the wall inside and out'}, 'make')),
                    Location(), (0, 0, -40), 'UPPER' if pt['link'] == 'upper arm' else 'FORE')
        f2 = next(pt for pt in ch['ports'] if pt['id'] == 'F2')
        y_f2, z_f2 = A_LF - PORT_F2[0], PORT_F2[1]
        hx = _hits(ch['fore'].val(), (0.0, y_f2, z_f2), (1.0, 0.0, 0.0))
        x_in, x_out = hx[-2], hx[-1]                    # the forearm's +X wall there, inside and out
        plate = cq.Workplane('XY').add(f2['slug']).cut(cq.Workplane('YZ', origin=(x_in - 5, y_f2, z_f2)).circle(6.0).extrude(x_out - x_in + 10))
        m.place(ch['j3'], m.part(PartDef('WSH-PPF', 'Port plate, forearm, wrist end, with the pure water\'s bulkhead', plate.val(), 'ss316',
                                         'fluid', 'cut to the port', 'F2', '316L, sealed in on its edge', None,
                                         'Closes the casting\'s side port and carries the bulkhead fitting the pure-water tube leaves the forearm by.',
                                         {}, 'make')), Location(), (0, 0, -40), 'FORE')
        bhf = (cq.Workplane('YZ', origin=(x_in - 5, y_f2, z_f2)).circle(8.0).extrude(5.0)                       # its nut, inside
               .union(cq.Workplane('YZ', origin=(x_in - 0.01, y_f2, z_f2)).circle(6.0).extrude(x_out - x_in + 0.02))  # its body, in the plate
               .union(cq.Workplane('YZ', origin=(x_out, y_f2, z_f2)).polygon(6, 18.0).extrude(8.0))                 # its hex, outside
               .union(cq.Workplane('YZ', origin=(x_out + 8.0, y_f2, z_f2)).circle(5.5).extrude(12.0))               # its push-in collet
               .cut(plate))                                 # its nut and its hex seated on the plate's curved faces
        PWL_IN[name] = (x_in - 5.0, y_f2, z_f2)
        m.place(ch['j3'], m.part(PartDef('WSH-BHF', 'Bulkhead push-in fitting 6 mm, stainless', bhf.val(), 'ss316', 'fluid',
                                         'catalogue part', '6 mm, M12', '', None,
                                         'Takes the pure-water tube through the port plate, from inside the forearm to the loop across the wrist.',
                                         {}, 'buy')), Location(), (0, 0, -40), 'FORE')
        m.flex(FlexDef(f'WSH-PWL{name}', 'Pure-water tube 6 x 4 across the wrist, polyurethane', 'loop',
                       Anchor(ch['j3'], (x_out + 20.0, y_f2, z_f2), (1, 0, 0)), Anchor(ch['j5'], PWL_END, (-1, 0, 0)), 3.0, 'POLISH',
                       'Takes the pure water from the forearm across J4 and J5 to the mist nozzle\'s supply on the bracket.',
                       mat='pu', category='fluid', length=PWL_L, min_bend=PWL_MB, bulge=PWL_BULGE, hk=0.5, kg_per_m=0.02,
                       size=f'6 x 4 x {PWL_L:.0f}', standard='ISO 7628 (tube)',
                       spec={'tube': '6 x 4 polyurethane, pure-water grade', 'length': f'{PWL_L:.0f} mm',
                             'bend radius': f'{PWL_MB:.0f} mm moving (7.5 x d)'}))
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
        m.place(ch['j5'], noz_h_pd, Location(), (160, 70, 0), 'POLISH')
        m.place(ch['j5'], m.part(pst), Location(), (160, 20, -40), 'POLISH')
        m.place(ch['j5'], pcu_pd, Location(), (160, 0, -40), 'POLISH')
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
        ARM_CHAIN[name] = m.flex(FlexDef(f'WSH-DCH{name}', f'Cable chain, inside {DK["bi"]:g} x {DK["hi"]:g}, R {R_dk:g}', 'chain',
                       Anchor(bay, (x_ch, 30.0, z_dock + 250), (0, 0, -1)), Anchor(car_, (x_ch, 30.0 + 2 * R_dk, z_dock), (0, 0, -1)),
                       DK['ha'] / 2, 'TRACK', 'Carries power, network and pure water to the moving carriage. Its bend rolls along with it.',
                       mat='pa66', category='electrical', pitch=DK['pitch'], bend_r=R_dk, links=n_dk, up=(0, 1, 0), w=DK['ba'], h=DK['ha'],
                       link_part=dk_link, kg_per_m=1.6,
                       spec={'carries': 'arm supply cable 12 mm, track motor cable 12 mm, 24 V 8 mm, network 7 mm, pure-water tube 6 mm',
                             'fill': f'{DK_FILL:.0f} of its {DK["bi"]:g} mm inside width with the chain maker\'s clearances (10 % a cable, 20 % a hose, 1 mm at least)',
                             'fixed end': 'on a bracket in front of a floor box, fed by 3 ducts in the slab'}))
        # the carrier arm: a foot on the carriage plate's edge, out past the chain, and an upright whose inner face lies
        # on the outer side of the chain's last link (its outside, centred on x_ch)
        x_f0, x_up = CP_X / 2 - 20, 300 + DK['ba'] / 2       # from the track's line: the foot's start, the upright's inner face
        y_top = 30.0 + 2 * R_dk + DK['ha'] / 2 + 10 - (y_cp + CP_T)  # the upright's height above the plate
        dka = (cq.Workplane('XY').box(x_up + 10 - x_f0, 10, 80, centered=(False, False, True)).translate((x_f0, 0, 0))
               .union(cq.Workplane('XY').box(10, y_top, 80, centered=(False, False, True)).translate((x_up, 0, 0))))
        if sx < 0:
            dka = dka.mirror('YZ')
        m.place(car_, m.part(PartDef(f'WSH-DCA{name}', 'Cable chain carrier arm, stainless', dka.val(), 'ss316', 'structure', 'bent plate',
                                     f'{x_up + 10 - x_f0:.0f} x 80', '316L', None, 'Joins the chain\'s moving end to the carriage.', {}, 'make')),
                loc(x0, y_cp + CP_T, z_dock), (sx * 80, 60, 0), 'TRACK')
        # THE CHAIN'S MOVING END, INTO THE PEDESTAL (2026-11-15). Its lines ended at the last link, in the air: nothing took
        # them on to the arm. A closed stainless elbow duct now does. It fits into the last link, runs on 10 mm, turns the
        # lines a quarter circle toward the pedestal (the innermost on 4 x 12 mm, fixed; the 5 lines concentric), and
        # enters the pedestal's window in the wall that faces the chain. In the pedestal the lines rise to J1 (not drawn
        # one by one, as in the charge arm's riser).
        y_ue = 30.0 + 2 * R_dk                           # the upper run's centre: the chain's moving end
        hw_, hh_ = DK['bi'] / 2 + 3.0, DK['hi'] / 2 + 3.0
        r_in = 4 * max(A_SUP, A_MOT)
        zb0, zb1 = z_dock + ELB_LEAD + r_in - 6.0 - 3.0, z_dock + ELB_LEAD + r_in + 41.0 + 6.0 + 3.0
        xi = x0 + sx * (PED_W / 2 - 12.0)                # 12 mm through the pedestal's wall, into its window
        xa_in = x_ch - sx * hw_                          # box A's inboard wall
        # its flange: a plate on the pedestal's wall that closes the window round the duct and is bolted to the wall
        xw0 = x0 + sx * (PED_W / 2)                      # the wall's outer face
        y_pb = y_cp + CP_T                               # the pedestal's foot
        elb = (_bx2(x_ch - hw_, x_ch + hw_, y_ue - hh_, y_ue + hh_, z_dock, zb1)
               .union(_bx2(min(xi, xa_in), max(xi, xa_in), y_ue - hh_, y_ue + hh_, zb0, zb1))
               .union(_bx2(min(xw0, xw0 + sx * 6.0), max(xw0, xw0 + sx * 6.0), y_pb + 40.0 - 15.0, y_pb + 190.0 + 15.0,
                           z_dock - (PED_W - 60) / 2 - 15.0, z_dock + (PED_W - 60) / 2 + 15.0))
               .cut(_bx2(x_ch - hw_ + 3, x_ch + hw_ - 3, y_ue - hh_ + 3, y_ue + hh_ - 3, z_dock - 1, zb1 - 3))
               .cut(_bx2(min(xi - sx * 1, x_ch), max(xi - sx * 1, x_ch), y_ue - hh_ + 3, y_ue + hh_ - 3, zb0 + 3, zb1 - 3)))
        for (yy, zz) in ((y_pb + 32.0, z_dock - 125.0), (y_pb + 32.0, z_dock + 125.0), (y_pb + 198.0, z_dock - 125.0), (y_pb + 198.0, z_dock + 125.0)):
            m.place(car_, std.bhcs(6, 16, 'A4-80', 'Holds the elbow duct\'s flange to the pedestal wall, into a rivet nut.'),
                    std.orient((xw0 + sx * 6.0, yy, zz), (-sx, 0, 0)), (sx * 140, 80, 60), 'TRACK')
        m.place(car_, m.part(PartDef(f'WSH-DCX{name}', 'Arm chain elbow duct, stainless, into the pedestal', elb.val(), 'ss316', 'structure',
                                     'welded sheet 3 mm', f'{2 * hw_:.0f} x {2 * hh_:.0f}, {zb1 - z_dock:.0f} along, {abs(xi - xa_in):.0f} across', '316L', None,
                                     'Takes the arm chain\'s 5 lines from its last link round into the pedestal\'s window.',
                                     {'inside': f'the lines turn on {r_in:.0f} mm or more (4 x d, fixed); not drawn one by one',
                                      'into the pedestal': '12 mm through the window in the wall toward the chain'}, 'make')),
                Location(), (sx * 120, 80, 60), 'TRACK')

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
        # THE SIDE KNIFE'S CARRIAGE (2026-11-15). The knife slid on a joint with nothing to slide on: it hung in the air,
        # held by its own duct (a viewer's contact check found it; the B-rep one counted the duct as its holder). A toothed
        # belt axis under the beam's bottom deck now carries it: a 60 x 60 profile along the bay, its carriage over the
        # knife, a hanger tube down the knife's north face, and the axis's servo gearmotor hanging at its outer end. The
        # axis stands beside the knife's north face, clear of the duct's collar on the beam (south of it).
        zb = zd + dside['d'] / 2 + 30.0
        x_o = sx * (abs(x) + dside['w'] / 2 + 120.0)
        assert abs(zb - SK_Z) < 1e-6 and abs(abs(x_o) - SK_X) < 1e-6, 'the knife axis moved: move its conduit\'s sleeves too'
        x_i = sx * (abs(x) - (dside['retractX'] - 1200) - dside['w'] / 2 - 150.0)
        ax_l = abs(x_o - x_i)
        sax = (cq.Workplane('XY').box(ax_l, 60.0, 60.0).edges('|X').fillet(4.0)
               .cut(cq.Workplane('XY').box(ax_l + 2, 8.0, 8.0).translate((0, 0, 30.0 - 3.0)))
               .cut(cq.Workplane('XY').box(ax_l + 2, 8.0, 8.0).translate((0, 0, -30.0 + 3.0))))
        m.place(gan, m.part(PartDef(f'WSH-SAX{name}', 'Side knife belt axis, 60 x 60 profile, toothed belt', sax.val(), 'al_extr', 'drive',
                                    'catalogue part', f'60 x 60, {ax_l:.0f} long, stroke {dside["retractX"] - 1200:.0f}', 'IP54', None,
                                    'Guides the side knife across the bay and drives it by a toothed belt.',
                                    {'stroke': f'{dside["retractX"] - 1200:.0f} mm', 'guide': 'profile rail inside, recirculating balls'},
                                    'buy', mass_override=round(0.0062 * ax_l, 1))),
                loc((x_o + x_i) / 2, beam['y0'] - 30.0, zb), (sx * 120, 160, 0), 'DRYER')
        sac = cq.Workplane('XY').box(160.0, 25.0, 70.0).edges('|Y').fillet(6.0)
        m.place(ds, m.part(PartDef('WSH-SAC', 'Side knife axis carriage', sac.val(), 'al6061', 'drive', 'catalogue part', '160 x 70 x 25',
                                   '', None, 'Runs on the belt axis and carries the knife\'s hanger.', {}, 'buy')),
                loc(x, beam['y0'] - 60.0 - 12.5, zb), (sx * 120, 120, 0), 'DRYER')
        y_h0, y_h1 = dside['y1'] - 250.0, beam['y0'] - 85.0
        sah = (cq.Workplane('XY').box(60.0, y_h1 - y_h0, 60.0).cut(cq.Workplane('XY').box(52.0, y_h1 - y_h0 + 2, 52.0))
               .translate((0, (y_h0 + y_h1) / 2, 0)))
        m.place(ds, m.part(PartDef('WSH-SAH', 'Side knife hanger, SHS 60 x 60 x 4, stainless', sah.val(), 'ss316', 'structure', 'EN 10219',
                                   f'60 x 60 x 4, {y_h1 - y_h0:.0f} long', '1.4404', None,
                                   'Hangs the side knife from its carriage. Its foot is bolted to the knife\'s north face.', {}, 'make')),
                loc(x, 0, zb), (sx * 120, 60, 0), 'DRYER')
        for yy in (y_h0 + 60.0, y_h0 + 190.0):
            # from inside the tube, through its south wall into a rivet nut in the knife (an access hole opposite, not drawn)
            m.place(ds, std.bhcs(8, 20, 'A4-80', 'Holds the hanger\'s foot to the side knife, into a rivet nut.'),
                    std.orient((x, yy, zb - 26.0), (0, 0, -1)), (sx * 120, 60, 40), 'DRYER')
        sam = (cq.Workplane('XY').box(90.0, 120.0, 90.0).edges('|Y').fillet(8.0)
               .union(cq.Workplane('XZ', origin=(0, -60.0, 0)).circle(38.0).extrude(110.0)))
        m.place(gan, m.part(PartDef('WSH-SAM', 'Side knife axis servo gearmotor 0.4 kW, brake, absolute encoder', sam.val(), 'steel_paint',
                                    'drive', 'catalogue part', '0.4 kW', 'IP66, wash-down', None,
                                    'Drives the side knife\'s belt axis. Its brake holds the knife where it stops.', {}, 'buy',
                                    mass_override=6.0)),
                loc(x_o - sx * 45.0, beam['y0'] - 60.0 - 60.0, zb), (sx * 160, 100, 0), 'DRYER')
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
    # the chain: the narrowest heavy chain (std.CHAIN_CLASSES, from the maker's sheet) that holds its 6 lines side by
    # side, drawn to its outside: 125 x 42 inside is 151 x 64 outside. (This file first drew a link 120 x 50 OUTSIDE and
    # filled 117 mm of width INSIDE it, so the lines could not have fitted; the trench was 140 mm wide for it.)
    R_dc = 200.0
    DC_FILL = std.chain_fill([L_PWR, L_NET], [L_WAT, L_CHM, L_CHM, L_AIR])
    DC = std.chain_size('heavy', DC_FILL, 1.2 * L_WAT, R_dc)
    chain = std.chain_link(DC['ba'], DC['ha'], DC['pitch'], inside=(DC['bi'], DC['hi']))
    x_o = legX - trol['w'] / 2 - 132 - 15                # the trench's outer wall, toward the rail
    x_i = x_o - DC['ba'] - 20                            # its inner wall, toward the car
    xch = x_i + 10 + DC['ba'] / 2                        # the chain's centre: 10 mm clear of each wall
    g_lo, g_hi = gan.joint['limits']
    # the chain's length: half the travel (pass ends and the stow at the entrance), its half-turn bend, and 110 mm spare
    n_dc = math.ceil(((g_hi - g_lo) * 1000.0 / 2 + math.pi * R_dc + 110) / DC['pitch'])
    z_fix = (g_lo + g_hi) / 2 * 1000.0                  # mid travel (the gantry's frame stands at z = GANTRY, metres)
    y_fl = -520.0                                        # the trench floor
    y_lo = y_fl + DC['ha'] / 2 + 9                       # the lower run's centre, 9 mm over the floor (links tip in the bend)
    y_up = y_lo + 2 * R_dc                               # the upper run's centre: its links' tops 57 mm under the cover
    # the trench runs from beyond the bend at the north end of travel to beyond the driver at the south end
    tz0 = z_fix - (n_dc * DC['pitch'] - math.pi * R_dc + (z_fix - g_lo * 1000.0)) / 2 - R_dc - DC['ha'] / 2 - 40
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
    DCH = m.flex(FlexDef('WSH-DCH', f'Drag chain, inside {DC["bi"]:g} x {DC["hi"]:g}, R {R_dc:g}', 'chain',
                   Anchor(bay, (xch, y_lo, z_fix), (0, 0, -1)), Anchor(gan, (xch, y_up, 0), (0, 0, -1)),
                   DC['ha'] / 2, 'CONTROL', 'Brings power, water, chemicals, air and the network to the moving machine. Its bend rolls along '
                   'at half the machine\'s speed.', mat='pa66', category='electrical', pitch=DC['pitch'], bend_r=R_dc, links=n_dc, up=(0, 1, 0),
                   w=DC['ba'], h=DC['ha'], link_part=chain, kg_per_m=6.5,
                   spec={'carries': 'supply cable 5G10 (21 mm), network (8), water hose 19 x 27, 2 chemical hoses 10 x 16, air tube 12 x 9',
                         'fill': f'{DC_FILL:.0f} of its {DC["bi"]:g} mm inside width with the chain maker\'s clearances (10 % a cable, 20 % a hose, 1 mm at least)',
                         'fixed end': 'on a bracket on the trench floor at mid travel, fed by a tray from the supply pit',
                         'upper run': 'self-supporting up to 3.7 m with the machine at an end (chain maker to confirm), '
                                      'else it lies on the lower run'}))
    # its moving end: an end bracket on the last link, a driver duct up through the slot, an arm to the trolley's inner wall,
    # and a conduit up the leg to the cabinet's floor
    x_tw = legX - trol['w'] / 2                          # the trolley's inner wall
    dce = cq.Workplane('XY').box(DC['ba'], DC['ha'], 10).translate((xch, y_up, 5))
    m.place(gan, m.part(PartDef('WSH-DCE', 'Drag chain end bracket, stainless', dce.val(), 'ss316', 'structure', 'bent plate',
                                f'{DC["ba"]:g} x {DC["ha"]:g}', '316L', None, 'Joins the chain\'s last link to the driver.', {}, 'make')),
            Location(), (-200, 40, 0), 'CONTROL')
    y_arm = 100.0
    y_dd = y_up - DC['ha'] / 2                           # the driver duct's foot: the end bracket's underside
    dcd = (cq.Workplane('XY').box(60, y_arm + 60 - y_dd, 160).translate((xch, (y_arm + 60 + y_dd) / 2, 90))
           .cut(cq.Workplane('XY').box(54, y_arm + 60 - y_dd + 2, 154).translate((xch, (y_arm + 60 + y_dd) / 2, 90))))
    m.place(gan, m.part(PartDef('WSH-DCD', 'Drag chain driver duct, stainless', dcd.val(), 'ss316', 'structure', 'welded box 60 x 160 x 3',
                                f'{y_arm + 60 - y_dd:.0f} long', '316L', None,
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
                     {'bend': 'R 300 (5 x D)', 'fill': '19 % of its 52 mm bore (2 cables: limit 31 %)'}, 'EN 61386', 'D 60', 'make', bend=300.0)
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
    CD_R = 8.0                                           # each consumer's conduit: 16 mm, one cable of 10 mm or less (51 % of its 14 mm bore; limit 53 %)
    CD_BEND = 40.0                                       # 4 x a 10 mm cable, fixed installation (ASSUMPTION: a class figure)

    def e_conduit(pid: str, to: str, pts: list, fn: str) -> PartDef:
        if len(pts) == 2:
            (a, b) = pts
            L = math.dist(a, b)
            sh = cq.Solid.makeCylinder(CD_R, L, Vector(*a), Vector(b[0] - a[0], b[1] - a[1], b[2] - a[2])).cut(
                cq.Solid.makeCylinder(CD_R - 1, L, Vector(*a), Vector(b[0] - a[0], b[1] - a[1], b[2] - a[2])))
            pd = PartDef(pid, f'Conduit 16 x 1, stainless: {to}', sh, 'ss316', 'electrical', 'EN 61386', 'D 16', '316L', None, fn, {}, 'make')
            pd.path_mm = L
            return pd
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
                           'Brings the valves\' cable (one cable, 8 cores, for the 4 valves) from the trunk to the manifold.'), Location(), (0, 300, 0), 'CONTROL')
    m.place(gan, e_conduit('WSH-ECN', 'status beacon', [(-1722.0, yT + 10, zL - TK / 2), (-1722.0, yT + 10, zd + 125 - 20 * 10 / 400 - 0.1)],
                           'Brings the beacon\'s cable from the trunk.'), Location(), (0, 300, 0), 'CONTROL')
    m.place(gan, e_conduit('WSH-ECS', 'stop light', [(light['x'], yT + 48, zL - TK / 2), (light['x'], yT + 48, zb1 - 40), (light['x'], light['y'] + 60, zb1 - 40)],
                           'Brings the stop light\'s cable from the trunk, over the beam and down its south face.'),
            Location(), (0, 300, -200), 'CONTROL')
    # the side knives' axis gearmotors (2026-11-15): each conduit leaves the trunk's floor, drops through its sleeves in
    # both decks over the gearmotor, and turns into the motor's north face (its cable entry). The trunk lies on the top
    # deck along the beam's middle line, and each motor hangs under the bottom deck 88 mm south of it, at the axis's end.
    assert abs(zL - zL_) < 1e-6
    for sx, name in ((-1, 'L'), (1, 'R')):
        m.place(gan, e_conduit(f'WSH-ECA{name}', f'{"east" if sx < 0 else "west"} side knife axis gearmotor',
                               [(sx * SKC_X, yT, zL), (sx * SKC_X, beam['y0'] - 120.0, zL), (sx * SKC_X, beam['y0'] - 120.0, SK_Z + 45.0)],
                               'Brings a side knife axis gearmotor\'s cable from the trunk, down through the beam to the motor\'s side.'),
                Location(), (sx * 200, 300, 0), 'CONTROL')

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
        d_pd[tag].path_mm = VALVE_Y - 190
    for k, x in enumerate(vx):
        tag = '22' if k == 4 else '12'
        m.place(bay, v_pd[tag], loc(x, VALVE_Y, z_w), (0, 0, -200), 'SUPPLY')
        m.place(bay, s_pd[tag], loc(x, VALVE_Y, z_w), (0, 0, -100), 'SUPPLY')
        m.place(bay, d_pd[tag], loc(x, 0, z_w), (0, 0, -200), 'SUPPLY')
    sz_ap, sz_ad, sz_aw = duct_size([A_SUP, A_MOT, A_24V]), duct_size([A_ECT, A_SIG]), duct_size([A_H2O])
    sz_p, sz_n = duct_size([L_PWR]), duct_size([L_NET])
    # the hose duct is one size over what the fill asks (2-1/2): in a 3 in bore the 4 hoses lie side by side (74 of 77 mm),
    # in the order of their lanes on the trench floor
    sz_m = list(PVC40)[list(PVC40).index(duct_size([L_WAT, L_CHM, L_CHM, L_AIR])) + 1]
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
            drop_pd[key].path_mm = y1_ - 150
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
    y_nd = y_md - 80.0                                   # the network duct runs 25 mm under the hose duct, which it crosses on the way
    # where they enter the pit: each duct in line with its own lanes on the trench floor, so no line crosses another in
    # the pit and none runs askew beside its neighbour (askew, 2 hoses 1 mm apart close on each other)
    xpN, xpM, xpP = xch - 68, xch - 3, xch + 65
    pit = (cq.Workplane('XY').box(px1 - px0 + 10, 5, PIT_L + 10, centered=(False, False, False)).translate((px0 - 5, y_fl - 5, tz1))
           .union(cq.Workplane('XY').box(5, -y_fl - 10, PIT_L + 10, centered=(False, False, False)).translate((px0 - 5, y_fl, tz1)))
           .union(cq.Workplane('XY').box(5, -y_fl - 10, PIT_L + 10, centered=(False, False, False)).translate((px1, y_fl, tz1)))
           .union(cq.Workplane('XY').box(px1 - px0, -y_fl - 10, 5, centered=(False, False, False)).translate((px0, y_fl, tz1)))
           .union(cq.Workplane('XY').box(px1 - px0, -y_fl - 10, 5, centered=(False, False, False)).translate((px0, y_fl, z_pn)))
           .union(cq.Workplane('XY').box(30, 5, PIT_L + 10, centered=(False, False, False)).translate((px0 - 35, -15, tz1)))
           .union(cq.Workplane('XY').box(30, 5, PIT_L + 10, centered=(False, False, False)).translate((px1 + 5, -15, tz1)))
           .union(cq.Workplane('XY').box(px1 - px0 + 70, 5, 30, centered=(False, False, False)).translate((px0 - 35, -15, z_pn + 5)))
           .cut(cq.Workplane('XY').box(x_o - x_i, -y_fl - 15, 7, centered=(False, False, False)).translate((x_i, y_fl, tz1 - 1))))
    for (x, size, yy) in ((xpM, sz_m, y_md), (xpN, sz_n, y_nd), (xpP, sz_p, y_md)):
        pit = pit.cut(cq.Workplane('XY', origin=(x, yy, z_pn - 1)).circle(PVC40[size][0] / 2 + 0.1).extrude(7))
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
    for (pid, what, size, xw, xp, yy, ods) in (('WSH-SDM', 'machine media', sz_m, xwM, xpM, y_md, [L_WAT, L_CHM, L_CHM, L_AIR]),
                                               ('WSH-SDN', 'machine network', sz_n, xwN, xpN, y_nd, [L_NET]),
                                               ('WSH-SDP', 'machine power', sz_p, xwP, xpP, y_md, [L_PWR])):
        cast_duct(pid, what, size, [(xw, 0, zdw), (xw, yy, zdw), (xw, yy, zdw - 420), (xp, yy, z_pn + 1000), (xp, yy, z_pn)], ods)
    # ── the tray on the trench floor, the chain's fixed-end bracket and strain relief, and the 6 lines ──
    z_t0, z_t1 = z_fix + 130, tz1 + 60
    # The lines enter the chain on its inside floor, which the link's lower crossbar holds 11 mm over the link's foot, so
    # the tray stands on 2 runners with its floor level with the chain's: the lines run straight from the tray into it.
    y_ln = y_lo - DC['hi'] / 2 + 0.5                     # the lines' underside, 0.5 mm over the chain's inside floor
    y_tr = y_ln - 0.5 - 2                                # the tray's underside (2 mm sheet)
    T_H = math.ceil((max(L_WAT, L_PWR) + 2.5 + 4) / 2) * 2   # the tray's height: the tallest line, 2.5 mm under the lid
    tray = (cq.Workplane('XY').box(124, T_H, z_t1 - z_t0, centered=(True, False, False))
            .cut(cq.Workplane('XY').box(120, T_H - 4, z_t1 - z_t0 + 2, centered=(True, False, False)).translate((0, 2, -1)))
            .union(cq.Workplane('XY').box(10, y_tr - y_fl, z_t1 - z_t0, centered=(True, False, False)).translate((-52, y_fl - y_tr, 0)))
            .union(cq.Workplane('XY').box(10, y_tr - y_fl, z_t1 - z_t0, centered=(True, False, False)).translate((52, y_fl - y_tr, 0)))
            .translate((xch, y_tr, z_t0)))
    m.place(bay, m.part(PartDef('WSH-CTT', f'Supply tray on the trench floor, closed, stainless 124 x {T_H:.0f} x 2', tray.val(), 'ss316', 'structure',
                                'folded sheet with a screwed lid, on 2 runners', f'124 x {T_H:.0f} x {z_t1 - z_t0:.0f}', '316L', None,
                                'Carries the 6 lines along the trench floor from the pit to the chain\'s fixed end, under the chain\'s upper run.',
                                {'runners': f'{y_tr - y_fl:.0f} mm, so its floor is level with the chain\'s inside floor',
                                 'clear under the upper run': f'{y_up - DC["ha"] / 2 - (y_tr + T_H):.0f} mm'}, 'make')),
            Location(), (-300, -120, 0), 'SUPPLY')
    FB_W, FB_H = DC['ba'] + 6, y_lo + DC['ha'] / 2 + 3 - (y_fl + 8)  # the frame: round the first link's outside
    dfb = (cq.Workplane('XY').box(FB_W, 8, 165, centered=(True, False, False)).translate((xch, y_fl, z_fix - 35))
           .union(cq.Workplane('XY').box(FB_W, FB_H, 8, centered=(True, False, False)).translate((xch, y_fl + 8, z_fix))
                  .cut(cq.Workplane('XY').box(DC['bi'] + 0.6, DC['hi'] + 0.5, 10, centered=(True, False, False))
                       .translate((xch, y_lo - DC['hi'] / 2 - 0.25, z_fix - 1)))))
    m.place(bay, m.part(PartDef('WSH-DFB', 'Drag chain fixed-end bracket, stainless, welded to the trench liner', dfb.val(), 'ss316', 'structure',
                                'cut and welded plate 8 mm', f'{FB_W:.0f} x {8 + FB_H:.0f} x 165', '316L', None,
                                'Holds the chain\'s first link on the trench floor at mid travel. The lines enter the chain through its window.',
                                {}, 'make')), Location(), (-300, -160, 0), 'SUPPLY')
    lanes = (('N', 'network cable', L_NET, -51.0, 32.0, 'cable', 'electrical'), ('W', 'water hose 19 x 27', L_WAT, -31.5, 135.0, 'hose', 'fluid'),
             ('A', 'chemical hose A 10 x 16', L_CHM, -8.0, 80.0, 'hose', 'fluid'), ('B', 'chemical hose B 10 x 16', L_CHM, 10.0, 80.0, 'hose', 'fluid'),
             ('R', 'air tube 12 x 9', L_AIR, 26.0, 60.0, 'hose', 'fluid'), ('P', 'supply cable 5G10', L_PWR, 44.5, 84.0, 'cable', 'electrical'))
    SR_H = math.ceil((y_ln + max(L_WAT, L_PWR) + 8 - (y_fl + 8)) / 2) * 2   # the block closes 8 mm over the tallest line
    comb = cq.Workplane('XY').box(120, SR_H, 30, centered=(True, False, False)).translate((xch, y_fl + 8, z_fix + 55))
    for (_, _, od, lx, _, _, _) in lanes:
        comb = comb.cut(cq.Workplane('XY', origin=(xch + lx, y_ln + od / 2, z_fix + 54)).circle(od / 2 + 0.1).extrude(32))
    m.place(bay, m.part(PartDef('WSH-DFS', 'Strain relief block, 6 saddles, at the chain\'s fixed end', comb.val(), 'pa66', 'electrical',
                                'catalogue part', f'120 x {SR_H:.0f} x 30', '', None,
                                'Clamps each line in front of the chain\'s fixed end, so no pull reaches the chain or the duct.',
                                {'rule': 'strain relief at the fixed end (chain maker\'s filling rule)'}, 'buy')),
            Location(), (-300, -200, 0), 'SUPPLY')
    # what the drag chain carries, lane by lane, in its link's frame: at the fixed end the link's x runs along -Z (the lower
    # run leaves south), its y up, so its z runs along +X: a lane lx east of the chain's line lies at w = lx
    DCH.contents = [{'id': f'WSH-ML{tag}', 'part': f'WSH-ML{tag}', 'name': f'Machine {nm}', 'd': od, 'v': y_ln + od / 2 - y_lo, 'w': lx,
                     'mat': mat, 'category': cat} for (tag, nm, od, lx, _, mat, cat) in lanes]
    DCH.wi, DCH.hi, DCH.lead_a, DCH.lead_b = DC['bi'], DC['hi'], 0.0, 8.0
    check_contents(DCH)
    src = {'W': (xpM - 23.5, y_md), 'A': (xpM - 1, y_md), 'B': (xpM + 16, y_md), 'R': (xpM + 31, y_md),
           'N': (xpN, y_nd), 'P': (xpP, y_md)}           # each line's place in its duct's mouth (the 4 hoses lie side by side in theirs)
    for (tag, nm, od, lx, bend, mat, cat) in lanes:
        (xs, ys) = src[tag]
        ln = std.swept(f'WSH-ML{tag}', f'Machine {nm}, wall to the chain\'s fixed end', [(xs, ys, z_pn), (xs, ys, z_pn - 70),
                       (xch + lx, y_ln + od / 2, tz1 + 150), (xch + lx, y_ln + od / 2, z_fix)], od / 2, mat, cat, 0.0,
                       'Runs from the panel in its duct to the pit, along the tray, through the strain relief and into the chain. '
                       'Drawn from the duct\'s mouth to the chain\'s fixed end.', {'bend': f'R {bend:.0f} or more'}, '', f'OD {od:g}', 'buy', bend=bend)
        ln.end_in = {'start': {'N': 'WSH-SDN', 'P': 'WSH-SDP'}.get(tag, 'WSH-SDM')}     # it starts in its duct's mouth (line_ends.py)
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
    FE_W = DK['ba'] + 11                                 # the frame: round the first link's outside; its window: the inside
    dfe = (cq.Workplane('XY').box(FE_W + 12, 8, 115, centered=(True, False, False)).translate((0, 0, -20))
           .union(cq.Workplane('XY').box(FE_W, 44, 6, centered=(True, False, False)).translate((0, 8, 0))
                  .cut(cq.Workplane('XY').box(DK['bi'] + 0.6, DK['hi'] + 0.5, 8, centered=(True, False, False))
                       .translate((0, 30.0 - DK['hi'] / 2 - 0.25, -1)))))
    dfe_pd = m.part(PartDef('WSH-DFE', 'Arm chain fixed-end bracket, stainless', dfe.val(), 'ss316', 'structure', 'cut and welded plate',
                            f'{FE_W + 12:.0f} x 52 x 115', '316L', None, 'Holds the arm chain\'s first link on the floor, in front of the floor box.', {}, 'make'))
    a_lanes = (('12', A_SUP, -19.0, 'cable', 'electrical'), ('12', A_MOT, -5.75, 'cable', 'electrical'), ('8', A_24V, 5.5, 'cable', 'electrical'),
               ('7', A_ECT, 14.25, 'cable', 'electrical'), ('6', A_H2O, 22.0, 'hose', 'fluid'))
    for name, fd_ in ARM_CHAIN.items():
        fd_.contents = [{'id': f'WSH-DA{name}-{role}', 'part': f'WSH-DL{tag}', 'name': f'{"West" if name == "R" else "East"} arm {what}',
                         'd': od, 'v': -DK['hi'] / 2 + 0.5 + od / 2, 'w': lx, 'mat': mat, 'category': cat}
                        for (tag, od, lx, mat, cat), (role, what) in zip(a_lanes, (('SUP', 'supply cable 12 mm'), ('MOT', 'track motor cable 12 mm'),
                                                                                   ('24V', '24 V cable 8 mm'), ('ECT', 'network cable 7 mm'),
                                                                                   ('H2O', 'pure-water tube 6 mm')))]
        fd_.wi, fd_.hi, fd_.lead_a, fd_.lead_b = DK['bi'], DK['hi'], 0.0, ELB_LEAD
        check_contents(fd_)
    al_pd = {}
    for (tag, od, _, mat, cat) in a_lanes:
        if tag not in al_pd:
            al_pd[tag] = m.part(PartDef(f'WSH-DL{tag}', f'Arm line, {od:g} mm, floor box to the chain', cq.Solid.makeCylinder(od / 2, z_b0 - z_fx, Vector(0, 0, 0), Vector(0, 0, 1)),
                                        mat, cat, '', f'OD {od:g}', '', None,
                                        'Runs from the cabinet on the wall in its duct to the floor box, and from the box into the chain. '
                                        'Drawn from the box to the chain\'s fixed end.', {}, 'buy'))
            al_pd[tag].path_mm = z_b0 - z_fx
    for sx, name in ((-1, 'L'), (1, 'R')):
        x_c = sx * (XT + 300)                            # the arm chain's line
        m.place(bay, jb_pd, loc(x_c, 0, z_b0), (sx * 200, 0, 200), 'SUPPLY')
        m.place(bay, dfe_pd, loc(x_c, 0, z_fx), (sx * 200, -60, 100), 'SUPPLY')
        for (tag, od, lx, _, _) in a_lanes:
            m.place(bay, al_pd[tag], loc(x_c + lx, 30.0 - DK['hi'] / 2 + 0.5 + od / 2, z_fx), (sx * 200, 60, 150), 'SUPPLY')
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
    # ════════════════════════════════════════════════════════════ CABLE SCHEDULE ═══
    _cable_schedule(m, locals())
    return m


TAIL_CAB = 500.0     # inside a cabinet or the pull box, from its gland to the terminal (ASSUMPTION)
TAIL_DEV = 300.0     # into a motor's or a device's terminal box (ASSUMPTION)


def _cable_schedule(m: Model, g: dict) -> None:
    """The wash machine's cable schedule (cables.py): the machine's 6 supply lines from the wall to the cabinet and the
    media duct, the stainless tubes on to the valves, each consumer's cable from the cabinet along the trunk, the 2 detail
    arms' lines from their drive cabinet and their joint cables, and the docks' feeds."""
    from .charge_arm import joint_cables, link_casting, ring_leads
    from ..cables import bent_length, chain_mm
    P, fx = m.parts, {f.id: f for f in m.flexes}
    cab_tail = f'{TAIL_CAB:.0f} mm inside the cabinet or box, from its gland to the terminal (ASSUMPTION)'
    dev_tail = f'{TAIL_DEV:.0f} mm into the device\'s terminal box (ASSUMPTION)'

    def route(points, R):
        try:
            L, r = bent_length(points, R)
            return L, (None if r == math.inf else r)
        except ValueError:
            return bent_length(points, 0.0)[0], None
    # ── the machine's supply: wall -> pull box -> slab duct -> pit -> tray -> drag chain -> carrier arm -> conduit / media duct
    DCH, yT, x_tw = fx['WSH-DCH'], g['yT'], g['x_tw']
    xch, y_up, y_arm, x_cd = g['xch'], g['y_up'], g['y_arm'], g['x_tw'] - 45
    def drop_id(size: str, iso: bool = False) -> str:          # a conduit drop from the panel to the pull box
        return f'WSH-SDC{size.replace("/", "").replace("-", "")}{"I" if iso else ""}'
    src = {'N': ('the bay\'s network switch in the detail arm drive cabinet (WSH-DAC)', 'WSH-SDN', drop_id(g['sz_n'])),
           'P': ('the bay isolator (WSH-SIS)', 'WSH-SDP', drop_id(g['sz_p'], True)),
           'W': ('its shut-off valve at the wall (WSH-SBV22)', 'WSH-SDM', 'WSH-SD22'),
           'A': ('its shut-off valve at the wall (WSH-SBV12)', 'WSH-SDM', 'WSH-SD12'),
           'B': ('its shut-off valve at the wall (WSH-SBV12)', 'WSH-SDM', 'WSH-SD12'),
           'R': ('its shut-off valve at the wall (WSH-SBV12)', 'WSH-SDM', 'WSH-SD12')}
    for (tag, nm, od, lx, bend, mat, cat) in g['lanes']:
        lid = f'WSH-ML{tag}'
        fluid = cat == 'fluid'
        frm, duct, drop = src[tag]
        kind = {'N': 'network', 'P': 'power', 'R': 'air'}.get(tag, 'water' if tag == 'W' else 'chemical')
        to = ('the control cabinet (WSH-CAB)' if tag in 'NP' else f'its coupling to the stainless {nm.split()[0]} tube at the media duct\'s foot')
        L = m.cable(lid, f'Machine {nm}, wall to the machine', kind, od, 'the chain\'s own line (cad wash_gantry, lanes)', frm, to, 'CONTROL',
                    bend_fixed=bend, bend_moving=bend, tail_a=TAIL_CAB if not fluid else 0.0, tail_b=TAIL_CAB if tag in 'NP' else 0.0,
                    tails=cab_tail if not fluid else 'the valve\'s and the coupling\'s fittings take its ends')
        if tag in 'NP':
            L.run('conduit', drop, f'down the wall from {"the isolator" if tag == "P" else "the cabinet"} in its conduit to the pull box', P[drop].path_mm)
        else:
            L.run('conduit', drop, 'down the wall from its valve, in its stainless drop tube, to the pull box', P[drop].path_mm)
        L.run('site', 'WSH-SPB', 'across the pull box to its duct', 150.0, tol=75.0)
        L.run('conduit', duct, 'in its duct cast into the slab, from the pull box to the supply pit', P[duct].path_mm)
        L.run('drawn', lid, 'from the duct\'s mouth across the pit, along the tray and through the strain relief into the chain', P[lid].path_mm, bend=bend)
        mm, rb = chain_mm(DCH, lid)
        L.run('chain', 'WSH-DCH', 'in the drag chain, in its own lane', mm, bend=rb, moving=True)
        v = next(c['v'] for c in DCH.contents if c['id'] == lid)
        x_dest, z_dest = (x_cd, 90.0) if tag in 'NP' else (g['MR_X'], g['MR_Z'])
        pts = [(xch + lx, y_up - v, 0.0), (xch + lx, y_up - v, 90.0), (xch + lx, y_arm + 30, 90.0), (x_dest, y_arm + 30, z_dest), (x_dest, y_arm + 60, z_dest)]
        mm, rb = route(pts, bend)
        L.run('duct', 'WSH-DCD', 'up the chain\'s driver duct and along the carrier arm (WSH-DCB) to its conduit' if tag in 'NP'
              else 'up the chain\'s driver duct and along the carrier arm (WSH-DCB) to the media duct\'s foot', mm, tol=27.0 + 77.0, bend=rb)
        if tag in 'NP':
            L.run('conduit', 'WSH-DCC', 'in the 60 mm conduit up the leg to the cabinet\'s floor', P['WSH-DCC'].path_mm, bend=300.0)
    # the stainless tubes in the media duct: from the couplings at its foot to the valve manifold (the air to its coupling)
    MR_X, MR_Z, MD_H, z_ml, x_me = g['MR_X'], g['MR_Z'], g['MD_H'], g['z_ml'], g['x_me']
    md_pts = [(MR_X, y_arm + 60, MR_Z), (MR_X, yT + MD_H / 2, MR_Z), (MR_X, yT + MD_H / 2, z_ml), (x_me, yT + MD_H / 2, z_ml)]
    md_mm = bent_length(md_pts, 0.0)[0]
    for (tid, nm, od, to) in (('WSH-MTW', 'Water tube 22 x 1, stainless', 22.0, 'the valve manifold\'s water inlet (WSH-MAN)'),
                              ('WSH-MTA', 'Chemical A tube 12 x 1, stainless', 12.0, 'the valve manifold\'s chemical A inlet (WSH-MAN)'),
                              ('WSH-MTB', 'Chemical B tube 12 x 1, stainless', 12.0, 'the valve manifold\'s chemical B inlet (WSH-MAN)'),
                              ('WSH-MTR', 'Air tube 12 x 1, stainless', 12.0, 'the air service coupling on the beam (WSH-APT)')):
        L = m.cable(tid, nm, 'air' if 'Air' in nm else 'water' if 'Water' in nm else 'chemical', od, 'EN 10216-5 (the media duct\'s spec)',
                    'its coupling to the chain\'s hose at the media duct\'s foot', to, 'CONTROL')
        L.run('duct', 'WSH-MRD', 'in the closed media duct: up the leg, through the beam and along its top', md_mm, tol=2 * (MD_H - 4) / 2)
        if tid == 'WSH-MTR':
            L.run('duct', 'WSH-MRD', 'on along the beam to the coupling', 120.0)
        L.notes.append('Bent on site in the duct: its bends are the duct\'s corners.')
    # ── each consumer's cable: from the cabinet up the trunk and along the beam, then in its own conduit ──
    TK_X, TK_Z, TK, zL = g['TK_X'], g['TK_Z'], g['TK'], g['zL']
    trunk0 = bent_length([(TK_X, 2100.0, TK_Z), (TK_X, yT + TK / 2, TK_Z), (TK_X, yT + TK / 2, zL)], 0.0)[0]
    cons = [('WSH-ECL', None, 'the east travel motor', -g['GM_PX'], 'TRAVEL'), ('WSH-ECV', None, 'the valve manifold\'s 4 valves (one 8-core cable)', -300.0, 'ARCH'),
            ('WSH-ECN', None, 'the status beacon', -1722.0, 'CONTROL'), ('WSH-ECS', None, 'the stop light', g['light']['x'], 'CONTROL')]
    for bx in (-900, -(g['legX'] - 800), g['legX'] - 800):
        cons.append(('WSH-ECB', f'{bx + 380:.0f}', 'a blower motor', bx + 380, 'DRYER'))
    for sx in (-1, 1):
        cons.append(('WSH-ECK', f'{sx * (KH_X - 130):.0f}', 'a top knife lift motor', sx * (KH_X - 130), 'DRYER'))
    n_by = {}
    for (cid, key, what, x_c, sub) in cons:
        n_by[cid] = n_by.get(cid, 0) + 1
        lid = f'{cid}C{n_by[cid]}' if key is not None else f'{cid}C'
        L = m.cable(lid, f'Cable to {what}, 10 mm' + (f' (at x = {key} mm)' if key else ''), 'power', 10.0,
                    'one cable of 10 mm or less a conduit (the conduits\' fill rule)', 'the control cabinet (WSH-CAB)', what, sub,
                    bend_fixed=g['CD_BEND'], tail_a=TAIL_CAB, tail_b=TAIL_DEV, tails=f'{cab_tail}; {dev_tail}')
        L.run('duct', 'WSH-ETK', 'up the cable trunk from the cabinet\'s top, through the beam and along its top', trunk0 + abs(TK_X - x_c),
              tol=2 * (TK - 4) / 2)
        L.run('conduit', cid, f'in its 16 mm conduit to {what}', P[cid].path_mm, bend=g['CD_BEND'])
    L = m.cable('WSH-ECRC', 'Cable to the west travel motor, 10 mm', 'power', 10.0, 'one cable of 10 mm or less a conduit (the conduits\' fill rule)',
                'the control cabinet (WSH-CAB)', 'the west travel motor', 'TRAVEL', bend_fixed=g['CD_BEND'], tail_a=TAIL_CAB, tail_b=TAIL_DEV,
                tails=f'{cab_tail}; {dev_tail}')
    L.run('conduit', 'WSH-ECR', 'down from the cabinet\'s floor in its 16 mm conduit to the motor', P['WSH-ECR'].path_mm)
    # the side knives' axis gearmotors (added 2026-11-15): up the trunk and along the beam, then each in its own conduit
    # down through the beam to the motor
    for sx, name in ((-1, 'L'), (1, 'R')):
        L = m.cable(f'WSH-SAMC{name}', f'Cable to the {"east" if sx < 0 else "west"} side knife\'s axis gearmotor, 10 mm', 'power', 10.0,
                    'servo cable: motor, brake and encoder (ASSUMPTION: one cable of 10 mm)', 'the control cabinet (WSH-CAB)',
                    f'the side knife axis gearmotor (WSH-SAM), {"east" if sx < 0 else "west"}', 'DRYER', tail_a=TAIL_CAB, tail_b=TAIL_DEV,
                    tails=f'{cab_tail}; {dev_tail}')
        cid = f'WSH-ECA{name}'
        L.run('duct', 'WSH-ETK', 'up the cable trunk from the cabinet\'s top and along the beam\'s top', trunk0 + abs(TK_X - sx * g['SKC_X']),
              tol=2 * (TK - 4) / 2)
        L.run('conduit', cid, 'in its 16 mm conduit from the trunk\'s floor, down through its sleeves in both decks and into the '
              'gearmotor\'s north face', P[cid].path_mm, bend=g['CD_BEND'])
        L.bend_fixed = g['CD_BEND']
    def pure_water_up(L, name, side):
        """The pure-water tube from the pedestal up the arm (2026-11-15): into J1 through its gland, through J1, J2 and J3's
        hollow shafts beside each joint cable (bores 18.8, 23.5 and 18.8 mm: the 10 mm cable and the 6 mm tube take 16), and
        through the links between them as the joint cables run, then inside the forearm to the bulkhead in its side port."""
        import numpy as np
        from ..flex import loc_matrix, node_frames
        W0 = node_frames(m.root, {})
        acts = g['ARM_ACTS'][name]

        def wpt(node, p):
            return (W0[id(node)] @ np.array([*p, 1.0]))[:3]
        L.run('arm', '', 'up the pedestal to J1\'s gland, beside the supply cable (at most the mount\'s height, ASSUMPTION)', DARM_MOUNT,
              tol=0.25 * DARM_MOUNT)
        for k in range(3):
            a = acts[k]
            L.run('arm', f'{a["prefix"]}-HSG', f'through {a["joint"]}\'s gland and its hollow shaft, beside its joint cable', a['L'])
            out_c = wpt(a['fixed'], loc_matrix(a['Tf'])[:3, 3])
            if k < 2:
                b = acts[k + 1]
                to = wpt(b['fixed'], (loc_matrix(b['gland'].loc) @ np.array([0, 0, 0, 1.0]))[:3])
                what = f'{b["joint"]}\'s gland'
            else:
                to = wpt(a['moving'], g['PWL_IN'][name])
                what = 'the bulkhead in the side port'
            st = float(np.linalg.norm(to - out_c))
            L.run('arm', link_casting(m, a['moving']), f'inside the link from {a["joint"]}\'s output to {what}: straight {st:.0f} mm, and up '
                  'to a quarter more for its dressing beside the joint cable', st * 1.125, tol=st * 0.125)
        L.notes.append('It leaves the forearm by the bulkhead fitting and goes on in the loop across the wrist (its own line, below): '
                       'J4\'s and J5\'s 11.7 mm bores take the joint cable alone.')

    # ── each detail arm: its lines from the drive cabinet on the wall to the arm, and its joint cables ──
    a_role = {'SUP': ('supply cable 12 mm', 'power', 'P', 0), 'MOT': ('track motor cable 12 mm', 'power', 'P', 1), '24V': ('24 V cable 8 mm', 'control', 'P', 2),
              'ECT': ('network cable 7 mm', 'network', 'D', 3), 'H2O': ('pure-water tube 6 mm', 'water', 'W', 4)}
    for sx, name in ((-1, 'L'), (1, 'R')):
        fdk = fx[f'WSH-DCH{name}']
        side = 'west' if sx > 0 else 'east'
        for c in fdk.contents:
            role = c['id'].rsplit('-', 1)[1]
            what, kind, dch, _ = a_role[role]
            od = c['d']
            duct = f'WSH-SD{name}{dch}'
            to, tail_b, basis = {
                'SUP': (f'the {side} arm\'s J1 actuator, its gland in the pedestal\'s top', DARM_MOUNT,
                        f'{DARM_MOUNT:.0f} mm up the pedestal to J1\'s gland: at most the mount\'s height above the floor (ASSUMPTION)'),
                'MOT': (f'the {side} arm\'s track gearmotor on its carriage', TAIL_DEV, dev_tail),
                '24V': (f'the {side} arm\'s J1 actuator, beside the supply cable', DARM_MOUNT,
                        f'{DARM_MOUNT:.0f} mm up the pedestal to J1: at most the mount\'s height above the floor (ASSUMPTION)'),
                'ECT': (f'the {side} arm\'s J1 actuator, beside the supply cable', DARM_MOUNT,
                        f'{DARM_MOUNT:.0f} mm up the pedestal to J1: at most the mount\'s height above the floor (ASSUMPTION)'),
                'H2O': (f'the {side} arm\'s bulkhead fitting in its forearm\'s port plate (WSH-BHF), inside', 0.0, '')}[role]
            L = m.cable(c['id'], f'{side.capitalize()} arm {what}', kind, od, 'the arm chain\'s own line (cad wash_gantry, a_lanes)',
                        'the detail arm drive cabinet (WSH-DAC)' if role != 'H2O' else 'the pure water\'s shut-off valve at the wall (WSH-SBV12)',
                        to, 'SUPPLY', bend_fixed=4 * od, bend_moving=7.5 * od,
                        tail_a=TAIL_CAB if role != 'H2O' else 0.0, tail_b=tail_b,
                        tails=f'{cab_tail}; {basis}' if role != 'H2O' else 'its fittings take its ends')
            drop = 'WSH-SD12' if role == 'H2O' else drop_id(g['sz_ap'] if dch == 'P' else g['sz_ad'])
            L.run('conduit', drop, 'down the wall from its valve in its drop tube' if role == 'H2O' else 'down the wall from the cabinet in its conduit', P[drop].path_mm)
            L.run('site', 'WSH-SPB', 'across the pull box to its duct', 150.0, tol=75.0)
            L.run('conduit', duct, f'in the {side} arm\'s {dict(P="power", D="data", W="pure water")[dch]} duct cast into the slab, to the floor box',
                  P[duct].path_mm)
            L.run('drawn', c['part'], 'from the floor box (WSH-DJB) through its gland into the chain', P[c['part']].path_mm)
            mm, rb = chain_mm(fdk, c['id'])
            L.run('chain', fdk.id, 'in the arm\'s cable chain, in its own lane', mm, bend=rb, moving=True)
            L.run('duct', f'WSH-DCX{name}', 'through the elbow duct into the pedestal', ELB_LEAD + 150.0, tol=50.0)
            if role == 'H2O':                           # on up the arm to the forearm's port, beside the joint cables
                pure_water_up(L, name, side)
        joint_cables(m, g['ARM_ACTS'][name], f'WSH-JC{name}', 4.0, None, f' ({side} arm)')
        ring_leads(m, g['ARM_RING'][name], 'WSH-', name, f' ({side} arm)')
        # the mist's water across the wrist and up the bracket
        fd = fx[f'WSH-PWL{name}']
        L = m.cable(f'WSH-PW{name}', f'{side.capitalize()} arm pure-water tube across the wrist, 6 x 4', 'water', 6.0,
                    '6 x 4 polyurethane, pure-water grade', f'the bulkhead fitting in the forearm\'s port plate (WSH-BHF), outside',
                    'the push-in elbow under the sensor bracket (WSH-PCE)', 'POLISH', bend_moving=PWL_MB,
                    tails='its 2 push-in fittings take its ends (ASSUMPTION: 15 mm into each)', tail_a=15.0, tail_b=15.0)
        L.run('loop', fd.id, 'in its loop across J4 and J5, from the forearm\'s side to the elbow under the sensor bracket', fd.length, moving=True, flex=fd)
        L = m.cable(f'WSH-PS{name}', f'{side.capitalize()} arm mist supply tube 6 x 1, stainless', 'water', 6.0, 'EN 10216-5, 316L, 6 x 1',
                    'the push-in elbow under the sensor bracket (WSH-PCE)', 'the mist nozzle holder (WSH-PNH), its drilled passage to the nozzle',
                    'POLISH', tails='the union and the holder take its ends')
        L.run('drawn', 'WSH-PST', 'up the bracket\'s east face', P['WSH-PST'].path_mm)
        # the dock's feed: the exit signal's cable and the pad rinse tube, from the floor box up the dock post
        for (lid, nm, kind, od, to) in ((f'WSH-DKS{name}', 'exit signal cable 7 mm', 'control', 7.0, f'the {side} dock\'s exit signal (WSH-DCKS)'),
                                        (f'WSH-DKR{name}', 'pad rinse tube 6 mm', 'water', 6.0, f'the {side} dock\'s rinse nozzle in its cup (WSH-DCKC)')):
            L = m.cable(lid, f'{side.capitalize()} dock {nm}', kind, od, 'ASSUMPTION: of its kind',
                        'the detail arm drive cabinet (WSH-DAC)' if kind == 'control' else 'a tee on the arm\'s pure-water tube in the floor box (ASSUMPTION)',
                        to, 'DOCK', tail_b=TAIL_DEV, tails=dev_tail)
            if kind == 'control':
                L.run('conduit', drop_id(g['sz_ad']), 'down the wall from the cabinet in its conduit', P[drop_id(g['sz_ad'])].path_mm)
                L.run('site', 'WSH-SPB', 'across the pull box to its duct', 150.0, tol=75.0)
                L.run('conduit', f'WSH-SD{name}D', f'in the {side} arm\'s data duct to the floor box', P[f'WSH-SD{name}D'].path_mm)
            L.run('conduit', f'WSH-DKF{name}', 'in the dock feed conduit from the floor box into the track beam under the dock post', P[f'WSH-DKF{name}'].path_mm)
            L.run('site', '', 'up inside the dock post to its device: not drawn', 600.0, tol=300.0)
            L.open.append('Its run up inside the dock post is not drawn.')
