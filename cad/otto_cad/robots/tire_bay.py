"""OTTO-TIRE: the robotic wheel service in each service bay (docs/OTTO-TIRE.md).

Chase, 2026-11-17: "I think we need robotic arms for service bays. Maybe just drill and arms to get tire off and on and
place tires or rack? Arms can probably be on rails again. Places old tires on one rack, grabs new tires from separate
rack. Sliding back and forth. ... integrate a tool/head that accounts for screws/nuts that come off of the vehicle, and
then have to be reapplied and tightened back on. It probably needs some kind of camera input as well ... The lift can be
automated when vehicles pull in. ... include electrical design for the machine and into the yard itself."

WHAT IS IN THE BAY (the numbers are the twin's: cad/spec/robots.json 'tire' <- src/lib/ottoTire/tireSpec.ts):
  LIFT      an in-ground twin-post lift: 2 rams in casings on the drive line, each with a saddle and 2 arms that swing out
            and slide to the car's lift points, and a pad on each arm that screws up to the sill, with a load cell and a
            camera. Lowered, the saddles and arms lie in recesses under the floor and the car drives over them.
  PORTAL    a frame on 2 floor rails along the side walls (the OTTO-WASH layout), travelling over the car from the NEW racks
            at the entrance to the OLD racks at the exit. Its west leg carries the portal's drive cabinet.
  ROBOTS    2 wheel robots on the portal's beam, one each side of the car: a trolley across the bay, a slew that turns the
            head to the car or to the racks, a Z-beam that slides in a guide frame under the slew, a tilt that sets the
            wheel's camber, and the head.
  HEAD      2 powered rollers that close on the tyre's tread below its centre and hold the wheel by its shape; 5 nutrunner
            spindles on a pitch circle the head sets (100 to 130 mm) and turns to the nuts; a suction tool for an aero
            cover; a 3D camera and a camera on the spindles' axis. Each spindle keeps its own nut or bolt in its socket
            from the moment it leaves the hub until it is back on and tight.
  RACKS     each side: NEW wheels at the entrance end, OLD wheels at the exit end, 2 floor-level cradles each.
  CONTROL   the bay's control cabinet and the lift's power unit on the north wall, the portal's drive cabinet, the supply
            chain beside the west rail, and every line from the building's hand-over to each motor (the cable schedule).

FRAME: the bay's, world axes (as OTTO-WASH's CAD): origin at the bay's lift mark on the floor (the drive line at plan y
BAY_STALL_Y, where each car's axle midpoint stops), +X WEST, +Y up, +Z NORTH (toward the exit door). Millimetres.
The WEST robot is 'W' (+X side), the EAST 'E'; the east robot is the west one turned a half turn about the bay's vertical
axis, so they are the same parts. The machine is modelled at rest (tireProgram.homeState): portal parked at the exit end,
robots parked, rams down, arms stowed.

Sources for every bought part's class size and every external fact are in the PartDef specs and in cad/SOURCES.md
(section OTTO-TIRE). No product name reaches the screen (AGENTS.md): names stay in these comments.
"""
from __future__ import annotations

import math

import cadquery as cq
from cadquery import Location, Vector

from .. import std
from ..actuator import build_actuator, front_ring_points, module_length, out_flange_points, SIZES
from ..core import Model, Node, PartDef, loc
from ..flex import Anchor, FlexDef

M = 1000.0


# ═══════════════════════════════════════════════════════════════════════════════ helpers ═══


def bx(x0, x1, y0, y1, z0, z1) -> cq.Workplane:
    """A box by its 6 limits, mm."""
    return cq.Workplane('XY').box(x1 - x0, y1 - y0, z1 - z0, centered=False).translate((x0, y0, z0))


def cyl_y(r, y0, y1, x=0.0, z=0.0, ri=0.0) -> cq.Workplane:
    """A cylinder (or a tube, ri > 0) along Y from y0 to y1, its axis at (x, z)."""
    w = cq.Workplane('XZ', origin=(x, y0, z)).circle(r)
    if ri > 0:
        w = w.circle(ri)
    return w.extrude(-(y1 - y0))          # XZ's normal is -Y: a negative extrude runs toward +Y


def cyl_x(r, x0, x1, y=0.0, z=0.0, ri=0.0) -> cq.Workplane:
    w = cq.Workplane('YZ', origin=(x0, y, z)).circle(r)
    if ri > 0:
        w = w.circle(ri)
    return w.extrude(x1 - x0)


def cyl_z(r, z0, z1, x=0.0, y=0.0, ri=0.0) -> cq.Workplane:
    w = cq.Workplane('XY', origin=(x, y, z0)).circle(r)
    if ri > 0:
        w = w.circle(ri)
    return w.extrude(z1 - z0)


def mk(m: Model, pid, name, shape, mat, cat, standard='', size='', grade='', fn='', spec=None, make='make', **kw) -> PartDef:
    sh = shape.val() if isinstance(shape, cq.Workplane) else shape
    return m.part(PartDef(pid, name, sh, mat, cat, standard, size, grade, None, fn, dict(spec or {}), make, **kw))


def zigzag_ring(r_root, r_tip, n, w, axis='y') -> cq.Workplane:
    """A toothed ring (a gear drawn as a zigzag band, as std draws strain-wave teeth): n teeth, width w, about `axis`."""
    pts = []
    for i in range(n * 2):
        a = math.pi * i / n
        r = r_tip if i % 2 == 0 else r_root
        pts.append((r * math.cos(a), r * math.sin(a)))
    if axis == 'y':
        return cq.Workplane('XZ').polyline(pts).close().extrude(w / 2, both=True)
    if axis == 'z':
        return cq.Workplane('XY').polyline(pts).close().extrude(w / 2, both=True)
    return cq.Workplane('YZ').polyline(pts).close().extrude(w / 2, both=True)


def pinion(m: Model, pid, module, z, w, bore, axis='y', fn='') -> PartDef:
    """A spur pinion: z teeth of `module` (pitch diameter module x z), w wide, about `axis` through its centre.
    Its id starts 'TB-PIN': check.py counts its teeth in a 'TB-GR' rack or ring as a gear mesh."""
    pd_ = module * z
    shape = zigzag_ring(pd_ / 2 - 1.25 * module, pd_ / 2 + module, z, w, axis)
    hub = {'y': cyl_y(bore / 2 + 8, -w / 2 - 6, w / 2 + 6), 'x': cyl_x(bore / 2 + 8, -w / 2 - 6, w / 2 + 6),
           'z': cyl_z(bore / 2 + 8, -w / 2 - 6, w / 2 + 6)}[axis]
    hole = {'y': cyl_y(bore / 2, -w, w), 'x': cyl_x(bore / 2, -w, w), 'z': cyl_z(bore / 2, -w, w)}[axis]
    return mk(m, pid, f'Spur pinion m{module:g} z{z}', shape.union(hub).cut(hole), 'steel', 'drive', 'ISO 53 profile',
              f'm{module:g}, {z} teeth, {w:g} wide', 'case hardened', fn or 'Drives the rack or the ring with no slip.',
              {'pitch diameter': f'{pd_:g} mm', 'teeth': 'drawn as a zigzag band (the CAD\'s gear convention)'}, 'buy',
              depot='cyl_' + axis)


def rack_bar(m: Model, pid, module, length, w, h, fn='') -> PartDef:
    """A gear rack along +Z (length), teeth on its +X face (the pinion's side), w deep across X (teeth included), h tall
    (Y). Its id starts 'TB-GR' (check.py's mesh pairs)."""
    p = math.pi * module
    n = int(length // p)
    wb = w - 2.25 * module                           # the root line; the teeth stand 2.25 module past it
    off = (length - n * p) / 2
    pts = [(0.0, 0.0), (wb, 0.0)]
    for i in range(n):
        z0 = off + i * p
        pts += [(wb, z0 + p * 0.05), (w, z0 + p * 0.3), (w, z0 + p * 0.45), (wb, z0 + p * 0.7)]
    pts += [(wb, length), (0.0, length)]
    shape = cq.Workplane('XZ', origin=(0, h / 2, 0)).polyline(pts).close().extrude(h)
    return mk(m, pid, f'Gear rack m{module:g}, {length:.0f} long', shape, 'steel', 'drive', 'DIN 3962 class 8', f'm{module:g} x {length:.0f}',
              'induction hardened', fn or 'The pinion rolls along it: positive drive with no slip.', {}, 'buy', depot='box')


def servo_motor(m: Model, pid, frame, length, kw, fn, brake=False, mass=None, conn=True) -> PartDef:
    """A servo motor as its catalogue envelope: square flange `frame` at y = 0 (its pilot and shaft toward +Y), the body
    toward -Y, a connector on its side. ASSUMPTION: a class size, set from the maker's sheet when the motor is chosen."""
    body = cq.Workplane('XY').box(frame, length, frame).translate((0, -length / 2 - 12, 0)).edges('|Y').chamfer(frame * 0.32)   # the corners relieved for the flange screws
    flange = cq.Workplane('XY').box(frame, 12, frame).translate((0, -6, 0)).edges('|Y').fillet(frame * 0.08)
    shaft = cyl_y(frame * 0.12, 0, frame * 0.45)
    pilot = cyl_y(frame * 0.3, 0, 3)
    conn_box = bx(-frame * 0.18, frame * 0.18, -length * 0.45, -length * 0.15, frame / 2, frame / 2 + 22)
    shape = body.union(flange).union(shaft).union(pilot)
    if conn:
        shape = shape.union(conn_box)
    return mk(m, pid, f'Servo motor {kw:g} kW, frame {frame:g}' + (', with brake' if brake else ''), shape, 'al6061_blk',
              'drive', 'IEC 60034', f'flange {frame:g}, {length:g} long', 'IP65', fn,
              {'power': f'{kw:g} kW', 'feedback': 'absolute multiturn, on the power cable', 'class size': 'ASSUMPTION'}, 'buy',
              mass_override=mass if mass is not None else round(0.9 + 6.5 * kw ** 0.75 + 0.002 * frame * length / 10, 1))


def gearhead(m: Model, pid, frame, length, ratio, fn, mass=None) -> PartDef:
    """A planetary gearhead as its envelope: input flange at y = 0 (the motor on -Y), output shaft toward +Y."""
    body = cyl_y(frame * 0.5, 10, length)
    fl = cq.Workplane('XY').box(frame, 10, frame).translate((0, 5, 0)).edges('|Y').fillet(frame * 0.08)
    out = cyl_y(frame * 0.14, length, length + frame * 0.4)
    shape = body.union(fl).union(out)
    return mk(m, pid, f'Planetary gearhead {ratio}:1, frame {frame:g}', shape, 'al6061', 'drive', 'catalogue part',
              f'frame {frame:g}, {length:g} long', 'low backlash', fn, {'ratio': f'{ratio}:1', 'class size': 'ASSUMPTION'}, 'buy',
              mass_override=mass if mass is not None else round(0.002 * frame * frame * length / 100, 1))


def anchor_bolt(m: Model, d=16, L=125) -> PartDef:
    s = {12: 19, 16: 24}[d]
    sh = cq.Workplane('XZ').circle(d / 2).extrude(L).union(cq.Workplane('XZ').polygon(6, s / math.cos(math.pi / 6)).extrude(-d * 0.6))
    return mk(m, f'TB-ANC{d}', f'Concrete screw anchor M{d} x {L}', sh, 'fast_zn', 'fastener', 'ETA option 1 anchor',
              f'M{d} x {L}', '', 'Holds the plate to the slab. No mortar: it cuts its own thread in the drilled hole.', {}, 'buy')


# ═══════════════════════════════════════════════════════════════════════════════ build ═══


def build(spec: dict) -> Model:
    T = spec['tire']
    m = Model('tire_bay', 'OTTO-TIRE',
              'Service bay frame: origin at the bay\'s lift mark on the floor (where each car\'s axle midpoint stops), +Y up, '
              '+X west, +Z north (toward the exit). The machine at rest: portal parked at the exit end, rams down, arms stowed.')
    m.yard_deck_y = 0.0                               # the bay floor: the casings, the recess pans' undersides and the ducts are under it
    _subsystems(m, T)
    bay = m.root.child('Bay', sub='LIFT')
    holes = build_lift(m, bay, T)
    build_rails(m, bay, T)
    por = build_portal(m, bay, T)
    for side in ('W', 'E'):
        build_robot(m, por, side, T)
    build_racks(m, bay, T)
    build_nests(m, por, T)
    _slab(m, bay, T, holes)
    return m


def _slab(m: Model, bay: Node, T: dict, holes: list) -> None:
    """The bay's floor slab, a reference part: every machine part anchored in it touches it (the contact test's one
    piece), and it is the building's, so it counts in no total and the yard draws its own floor."""
    B = T['bay']
    slab = bx(-B['halfWidth'] * M, B['halfWidth'] * M, -250, 0, -B['south'] * M, B['north'] * M)
    for h in holes:
        slab = slab.cut(h)
    it = m.place(bay, mk(m, 'TB-SLB', 'Bay floor slab (the building\'s, for context)', slab, 'concrete', 'structure', 'cast slab',
                         f'{2 * B["halfWidth"]:.2f} x {B["south"] + B["north"]:.2f} m x 250', 'C30/37', 'The service bay\'s floor: the lift\'s '
                         'casings and pans, the portal\'s rails and the racks are anchored in it.', {}, reference=True),
                 Location(), (0, -600, 0), 'LIFT')
    it.yard_hidden = True


def _subsystems(m: Model, T: dict) -> None:
    L = T['lift']
    m.subsystem('LIFT', 'Lift: rams and casings', 'Lifts the car by its sills: 0.50 m for the robots, 1.85 m for a person under it.',
                how=['2 hydraulic rams in steel casings in the floor, on the drive line, one under the front lift points and one under the rear.',
                     'A ram lifts its half of the car straight up. No linkage, about 20 bar at the rated load.',
                     '2 toothed lock bars hang from each saddle. A pawl drops into a tooth every 75 mm as the car goes up.',
                     'The robots start only with all 4 pawls in and the oil let off: the car stands on steel.'],
                specs={'rated load': f'{L["ratedKg"]:,} kg', 'rise': f'{L["serviceRise"]:.2f} m for the robots, {L["fullRise"]:.2f} m full',
                       'rams': f'{L["ramD"] * 1000:.0f} mm, {L["casingDepth"]:.1f} m casings'}, group='Lift')
    m.subsystem('ARMS', 'Lift: saddles and arms', 'Swings 4 arms out under the car and slides each to a lift point.',
                how=['Each saddle carries 2 arms on worm slewing drives. A worm holds its angle with the power off.',
                     'Each arm slides out on a rack and pinion to reach its point.',
                     'Lowered, the saddle and the arms lie in recesses with their tops under the floor. The car drives over them.'],
                specs={'reach': f'{L["reach"][0]:.2f} to {L["reach"][1]:.2f} m from the pivot'}, group='Lift')
    m.subsystem('RAILS', 'Portal rails', 'Two floor rails along the side walls carry the portal over the car.',
                how=['Each rail is a profile rail on a welded box beam, on anchor plates every 0.95 m.',
                     'The rails stand outside the door opening and the racks. Nothing a car drives over.',
                     'A stop at each rail end holds an end truck if the portal runs past its travel.'],
                specs={'track': f'{2 * T["portal"]["railX"]:.2f} m', 'length': f'{T["portal"]["railTo"] - T["portal"]["railFrom"]:.2f} m'},
                group='Structure')
    m.subsystem('TRAVEL', 'Portal travel drives', 'Moves the portal along the bay, from the NEW racks to the OLD racks.',
                how=['A servo motor and a right-angle gearbox in each end truck drive a pinion on a rack.',
                     'The 2 drives keep in step by their encoders. A brake on each motor holds the portal.'],
                specs={'speed': f'{T["portal"]["mps"]:g} m/s', 'motors': '2 x 2.0 kW (class)'}, group='Motion')
    m.subsystem('PORTAL', 'Portal frame', 'Two legs and a box beam span the bay over the car.',
                how=['Bolted flanges join each leg to its end truck and to the beam.',
                     f'The beam\'s underside is {T["portal"]["beamUnder"]:.2f} m up: 0.66 m over the tallest fleet car on the lift.',
                     'It waits at the exit end, so a car drives in and out under nothing.'], group='Structure')
    m.subsystem('TROLLEY', 'Robot trolleys', 'Moves each robot across the bay, from the car\'s wheel to its rack.',
                how=['2 profile rails under the beam carry both trolleys.',
                     'A servo gearmotor on each trolley drives a pinion on a rack on the beam\'s south face.'],
                specs={'travel': f'{T["trolley"]["from"]:.2f} to {T["trolley"]["to"]:.2f} m from the drive line'}, group='Motion')
    m.subsystem('SLEW', 'Robot slew', 'Turns each robot between the car and the wall (the racks and the cover nest).',
                how=['A ball slewing ring with an outer gear hangs under the trolley. A servo gearmotor on the trolley turns it by a pinion.',
                     'A slip ring with a fibre rotary joint on the axis carries power, EtherCAT and the cameras\' fibre across it.',
                     'No cable twists, so the slew may turn any way.'],
                specs={'turn': f'{math.degrees(T["slew"]["from"]):.0f} to {math.degrees(T["slew"]["to"]):.0f} degrees'}, group='Motion')
    m.subsystem('ZAXIS', 'Robot vertical axis', 'Lifts and lowers each head between the racks and the car\'s wheels.',
                how=['A guide frame hangs under the slew plate. The Z-beam slides in 4 blocks on it.',
                     'A servo gearmotor with a brake drives a pinion on the beam\'s rack. The brake holds the head with the power off.',
                     'A cable chain hangs in a loop beside the beam and carries the head\'s lines.'],
                specs={'stroke': f'{(T["zaxis"]["to"] - T["zaxis"]["from"]):.2f} m',
                       'head axis': f'{T["zaxis"]["from"]:.2f} to {T["zaxis"]["to"]:.2f} m above the floor'}, group='Motion')
    m.subsystem('HEADDRV', 'Head drive box', 'Drives the head\'s 5 nutrunners and its servo motors from beside them.',
                how=['A steel box on the guide frame\'s back turns with the robot.',
                     'It holds the 5 nutrunner drives, the DC supply for the head\'s servo motors and the head\'s safety module.',
                     'So only power, EtherCAT and one fibre cross the slip ring.'], group='Control')
    m.subsystem('TILT', 'Head tilt', 'Sets the wheel\'s camber, so the wheel goes onto its hub square.',
                how=['A joint actuator with a strain-wave gear hangs under the Z-beam\'s foot.',
                     'The head hangs from its output flange by a yoke. Its cross-roller bearing carries the head.'],
                specs={'tilt': f'+/- {math.degrees(T["head"]["tilt"]):.0f} degrees'}, group='Motion')
    m.subsystem('HEAD', 'Wheel head', 'Takes a wheel off its hub and puts one on: it carries the nutrunners, the grip and the cameras.',
                how=['A cast aluminium housing carries the spindle cluster at its front.',
                     'A junction box on its side splits the servo bus to its small drives and holds the vacuum pump.'],
                specs={'mass': f'{T["head"]["massKg"]} kg (class, without a wheel)'}, group='Head')
    m.subsystem('NUTS', 'Nutrunners and their cluster', 'Takes the 5 nuts off, keeps each in its socket, and puts them back to torque.',
                how=['5 nutrunner spindles stand on a cluster that turns +/- 40 degrees to the nuts\' angle.',
                     'A scroll ring moves all 5 out or in together to the car\'s pitch circle, 100 to 130 mm.',
                     'An offset head on each spindle brings its drive in to the socket, so 5 spindles fit a 100 mm circle.',
                     'A magnet in each socket holds its nut or bolt until it is back on and tight.',
                     'Each spindle\'s transducer records torque and angle for every nut.'],
                specs={'torque': '250 N m peak a spindle (class)', 'pitch circle': '100 to 130 mm'}, group='Head')
    m.subsystem('COVER', 'Cover tool', 'Takes an aero cover off the wheel before the nuts, and presses it back on after.',
                how=['4 suction cups on rods at the housing\'s corners. 4 electric cylinders push them out past the sockets.',
                     'A vacuum pump in the junction box holds the cover.'],
                specs={'stroke': f'{T["head"]["cover"] * 1000:.0f} mm'}, group='Head')
    m.subsystem('GRIP', 'Grip', 'Holds the wheel by its tyre while it comes off, travels and goes on.',
                how=['2 powered rollers close on the tread below the wheel\'s centre and hold it by its shape.',
                     'A left and right-hand screw closes both together, the same distance from the head\'s axis.',
                     'The carriage slides back under the housing: the wheel stays still while the sockets move onto the nuts.',
                     'Turned by their motors, the rollers turn the wheel to line its holes up with the studs.'],
                specs={'clamp': f'{T["head"]["clampMin"]:.2f} to {T["head"]["clampMax"]:.2f} m from the axis'}, group='Head')
    m.subsystem('VISION', 'Cameras', 'Sees the wheel, its nuts and the cover, and checks each move.',
                how=['A 3D camera on the housing finds the wheel, its centre, the nuts and how deep they sit.',
                     'A camera on the spindles\' axis centres the head on the hub and checks a nut is in each socket.',
                     'A light ring round the cluster lights the wheel under the wheel arch.'], group='Head')
    m.subsystem('RACKS', 'Wheel racks', 'Holds the new wheels at the entrance end and takes the old ones at the exit end.',
                how=['Each side has 2 cradles for NEW wheels and 2 for OLD wheels, on the floor outside the door opening.',
                     'A wheel stands on 2 free rollers and leans on a back stop with rubber bumpers.',
                     'A sensor in each cradle sees a wheel. A person rolls wheels in and out and never lifts one.'],
                specs={'cradles': '8 (4 each side)'}, group='Racks')
    m.subsystem('SOCKETS', 'Socket racks', 'Holds the head\'s second socket set, for a car with 17 mm wheel bolts.',
                how=['A stand each side, north of the lift, holds 2 rings of 5 socket holders on the head\'s pitch circle.',
                     'The head puts its 21 mm sockets into the empty ring and takes the 17 mm set from the other.',
                     'It swaps back before the car leaves. The axis camera checks all 5 sockets after each change.'], group='Racks')
    m.subsystem('NEST', 'Cover nests', 'Holds an aero cover on the portal\'s leg while its wheel is changed.',
                how=['2 hooks take the cover\'s rim and 2 rubber pads take its back.',
                     'A sensor sees a cover in the nest.'], group='Racks')
    m.subsystem('PADS', 'Lift: pads', 'Puts a rubber pad under each lift point and checks it.',
                how=['Each ram rises on its own until both its pads touch. Then both rams lift the car together.',
                     'A load cell under each pad reads its share of the car. The lift stops if the 4 shares do not agree with the car\'s weight.',
                     'A camera beside each pad looks up at the lift point before the car leaves the floor.'],
                specs={'pad': f'{L["padD"] * 1000:.0f} mm rubber, its top the arm\'s top'}, group='Lift')


# ═════════════════════════════════════════════════════════════════════════════════ LIFT ═══
# Each post in its own frame: origin on the post's axis on the floor, +Y up, the arms stow toward -Z (the bay's centre).
# The front post stands at Z = postZ[0] as drawn; the rear one is the same post turned a half turn about its axis.
# Heights (mm, at rise 0): the arms' tops flush with the floor (0); the arm frame's origin (its root plate's underside)
# at -100; the swing drives' output flanges -112..-100; the saddle box -192..-102; the ram's top flange -217..-192; the
# saddle recess's floor -205; the casing's flange -231..-211 under the recess pan; the lock plate -310..-295 inside the
# casing; the barrel's head -350..-310 under it.
ARM_Y0 = -100.0          # the arm frame's origin at rise 0
SAD_Y = (-192.0, -102.0)
RAM_FL = (-217.0, -192.0)
REC_FLOOR = -205.0       # the saddle recess's floor top
ARM_REC_FLOOR = -112.0   # each arm recess's floor top
CAS_FL = (-231.0, -211.0)
LOCK_PL = (-310.0, -295.0)
BAR_Z = 185.0            # the 2 lock bars stand at z = +/- BAR_Z
SAD_X, SAD_Z = 250.0, 170.0
REC_X, REC_Z = 470.0, 215.0
ARM_REC_X = 240.0        # the arms' recess, across (both arms in one)
REEL_X = (345.0, 455.0)  # the cable reel's pocket at the saddle recess's +x end (past the casing's flange), and its floor
REEL_FLOOR = -320.0
ARM_TAIL = 60.0          # each arm's box reaches this far behind its pivot (its telescope motor is in it)
ARM_BOX_END = 470.0      # and this far out
SLIDE_IN = 100.0         # the slide's inner end at the shortest reach
CUP_R = 85.0


def PAN_ANCHORS(az1: float) -> list:
    """The recess pan's anchors, each through its lip into the slab."""
    return [(sx * (REC_X + 26), sz * (REC_Z + 26)) for sx in (1, -1) for sz in (1, -1)] + \
        [(sx * (ARM_REC_X + 26), az1 + 60) for sx in (1, -1)] + [(sx * (ARM_REC_X + 26), -REC_Z - 120) for sx in (1, -1)]


def build_lift(m: Model, bay: Node, T: dict) -> list:
    """Both posts. Returns the slab's holes for them (bay frame)."""
    L = T['lift']
    holes = []
    for k, (pz, turn) in enumerate(((L['postZ'][0] * M, 0), (L['postZ'][1] * M, 180))):
        tag = 'F' if k == 0 else 'R'
        post = bay.child(f'Post{tag}', loc(0, 0, pz, ry=turn), sub='LIFT')
        hole = _post(m, post, tag, turn, L)
        holes.append(hole.rotate((0, 0, 0), (0, 1, 0), turn).translate((0, 0, pz)))
    return holes


def _post(m: Model, post: Node, tag: str, turn: int, L: dict) -> None:
    pivx = L['pivotX'] * M
    ram_d = L['ramD'] * M
    cas_r = L['casingD'] * M / 2
    cas_d = L['casingDepth'] * M
    # ── the casing, its lock plate and the barrel: under the floor (the yard does not draw them) ─────────────────────
    cas = (cyl_y(cas_r, -cas_d, CAS_FL[0], ri=cas_r - 10)
           .union(cyl_y(cas_r + 20, CAS_FL[0], CAS_FL[1], ri=cas_r - 10))
           .union(cyl_y(cas_r, -cas_d - 25, -cas_d))
           .union(cyl_y(cas_r - 10, LOCK_PL[0], LOCK_PL[1], ri=135))
           .cut(cyl_y(25, LOCK_PL[0] - 1, LOCK_PL[1] + 1, z=BAR_Z)).cut(cyl_y(25, LOCK_PL[0] - 1, LOCK_PL[1] + 1, z=-BAR_Z)))
    for zz in (BAR_Z, -BAR_Z):                        # the lock bars' slots through the lock plate
        cas = cas.cut(bx(-25, 25, LOCK_PL[0] - 1, LOCK_PL[1] + 1, zz - 20, zz + 20))
    it = m.place(post, mk(m, 'TB-CAS', 'Lift casing, welded steel, in the floor', cas, 'steel_paint', 'structure', 'welded tube',
                          f'OD {2 * cas_r:.0f} x {cas_d:.0f}', 'S355, epoxy coated, oil-tight', 'Holds the ram\'s barrel upright in '
                          'the floor and keeps oil out of the ground. Its lock plate carries the 2 pawls.',
                          {'installation': 'set in the slab in a cored hole and grouted (the site\'s civil work)',
                           'containment': 'a sealed casing: oil that leaks from the barrel stays in it'}, mass_override=None),
                 Location(), (0, -400, 0), 'LIFT')
    it.yard_hidden = True
    barrel = (cyl_y(130, -cas_d, -350, ri=105).union(cyl_y(150, -350, -310, ri=101)))
    it = m.place(post, mk(m, 'TB-BRL', 'Lift ram barrel with gland', barrel, 'steel', 'structure', 'hydraulic cylinder barrel',
                          f'OD 260 x {cas_d - 350:.0f}', 'honed bore, chrome-free', 'Holds the oil under the ram. The gland at its '
                          'top seals the ram and guides it.', {'working pressure': 'about 20 bar at the rated load',
                                                               'port': 'G 3/4 at the base, fed by the pipe from the power unit'}),
                 Location(), (0, -350, 0), 'LIFT')
    it.yard_hidden = True
    gl = cyl_y(103, -312, -296, ri=100.2)
    it = m.place(post, mk(m, 'TB-RWP', 'Ram wiper and rod seal, PU', gl, 'pu', 'seal', 'ISO 6195 type A', 'D 200', '93 Shore A',
                          'Wipes grit off the ram as it goes down and seals the gland.', {}, 'buy'), Location(), (0, -300, 0), 'LIFT')
    it.yard_hidden = True
    for zz in (BAR_Z, -BAR_Z):
        pawl = (bx(-30, 30, LOCK_PL[1], LOCK_PL[1] + 55, -40, 40).cut(bx(-21, 21, LOCK_PL[1] - 1, LOCK_PL[1] + 56, -16, 16)))
        it = m.place(post, mk(m, 'TB-PWL', 'Lock pawl housing with pawl and 24 V release solenoid', pawl, 'steel', 'structure',
                              'welded housing', '60 x 80 x 55', 'S355', 'Its pawl drops into the lock bar\'s teeth as the car goes up. '
                              'The car stands on it, not on the oil. Its solenoid lifts the pawl only to lower the car.',
                              {'pawl': 'spring-applied: with the power off it locks', 'switch': 'a sensor reads the pawl in or out',
                               'teeth': f'every {L["lockPitch"] * 1000:.0f} mm'}, 'make', depot='box'),
                     loc(0, 0, zz), (0, -200, zz * 0.5), 'LIFT')
        it.yard_hidden = True
    # ── the recess pan: the saddle's recess, the arms' recess and the reel's pocket, set in the slab, lips flush ─────
    az1 = -(L['reach'][0] * M + CUP_R + 36 + 30)     # the arms' recess ends past the stowed pads' cameras
    outer = (bx(-REC_X - 6, REC_X + 6, REC_FLOOR - 6, 0, -REC_Z - 6, REC_Z + 6)
             .union(bx(-ARM_REC_X - 6, ARM_REC_X + 6, ARM_REC_FLOOR - 6, 0, az1 - 6, -REC_Z))
             .union(bx(REEL_X[0] - 6, REEL_X[1] + 6, REEL_FLOOR - 6, 0, -101, 101)))
    cav = (bx(-REC_X, REC_X, REC_FLOOR, 1, -REC_Z, REC_Z)
           .union(bx(-ARM_REC_X, ARM_REC_X, ARM_REC_FLOOR, 1, az1, -REC_Z + 1))
           .union(bx(REEL_X[0], REEL_X[1], REEL_FLOOR, 1, -95, 95)))
    pan = outer.cut(cav).cut(cyl_y(cas_r - 8, REC_FLOOR - 7, REC_FLOOR + 1))
    lip = (bx(-REC_X - 46, REC_X + 46, -6, 0, -REC_Z - 46, REC_Z + 46)
           .union(bx(-ARM_REC_X - 46, ARM_REC_X + 46, -6, 0, az1 - 46, -REC_Z)))
    pan = pan.union(lip.cut(bx(-REC_X - 6, REC_X + 6, -7, 1, -REC_Z - 6, REC_Z + 6))
                    .cut(bx(-ARM_REC_X - 6, ARM_REC_X + 6, -7, 1, az1 - 6, -REC_Z))).cut(cav)
    for (xx, zz) in PAN_ANCHORS(az1):
        pan = pan.cut(cyl_y(std.HOLE[12] / 2, -7, 1, x=xx, z=zz))
    m.place(post, mk(m, 'TB-PAN', 'Lift recess pan, galvanised steel', pan, 'steel_s355', 'structure', 'welded sheet 6 mm',
                     f'{2 * REC_X:.0f} x {-az1 + REC_Z:.0f}', 'S235, hot-dip galvanised', 'Forms the recesses the saddle and the 2 '
                     'arms lie in when the lift is down, with its lips flush with the floor. The car drives over it.',
                     {'drain': 'its floor falls 1 % to the casing (ASSUMPTION: the site\'s civil design)', 'load': 'drive-over, 2.5 t a wheel'}),
            Location(), (0, -100, 0), 'LIFT')
    for (xx, zz) in PAN_ANCHORS(az1):
        m.place(post, anchor_bolt(m, 12, 100), std.orient((xx, 0, zz), (0, -1, 0)), (0, 60, 0), 'LIFT')
    # ── the ram, its top flange, the saddle and what rides on it (the ram's node) ───────────────────────────────────
    lo, hi = 0.0, L['fullRise']
    ram_n = post.child(f'Ram{tag}', Location(), sub='LIFT',
                       joint={'name': f'TB_RAM_{tag}', 'axis': [0, 1, 0], 'limits': [lo, hi], 'kind': 'prismatic', 'stowed': 0.0})
    ram_len = 2400.0
    m.place(ram_n, mk(m, 'TB-RAM', 'Lift ram, chromed steel tube', cyl_y(ram_d / 2, RAM_FL[0] - ram_len + 25, RAM_FL[0], ri=ram_d / 2 - 12),
                      'steel', 'structure', 'hydraulic ram', f'D {ram_d:.0f} x {ram_len:.0f}', 'chrome 25 um on 42CrMo4',
                      'Lifts the saddle. Oil under it in the barrel pushes it up.', {'stroke': f'{L["fullRise"] * 1000:.0f} mm'}),
            Location(), (0, -300, 0), 'LIFT')
    fl = cyl_y(145, RAM_FL[0], RAM_FL[1])
    for p in std.circle_points(8, 115, 'y'):
        fl = fl.cut(cyl_y(std.HOLE[16] / 2, RAM_FL[0] - 1, RAM_FL[1] + 1, x=p[0], z=p[2]))
    m.place(ram_n, mk(m, 'TB-RFL', 'Ram top flange', fl, 'steel', 'structure', 'machined', 'D 290 x 25', '42CrMo4',
                      'Joins the ram to the saddle with 8 screws.', {}), Location(), (0, -150, 0), 'LIFT')
    sad = (bx(-SAD_X, SAD_X, SAD_Y[0], SAD_Y[1], -SAD_Z, SAD_Z)
           .cut(bx(-SAD_X + 10, SAD_X - 10, SAD_Y[0] + 15, SAD_Y[1] - 10, -SAD_Z + 10, SAD_Z - 10))
           .cut(cyl_y(72, SAD_Y[1] - 11, SAD_Y[1] + 1, x=pivx)).cut(cyl_y(72, SAD_Y[1] - 11, SAD_Y[1] + 1, x=-pivx)))
    for p in std.circle_points(8, 115, 'y'):
        sad = sad.cut(cyl_y(std.HOLE[16] / 2, SAD_Y[0] - 1, SAD_Y[0] + 16, x=p[0], z=p[2]))
    m.place(ram_n, mk(m, 'TB-SAD', 'Lift saddle, welded box', sad, 'steel_yellow', 'structure', 'welded plate 10 and 15 mm',
                      f'{2 * SAD_X:.0f} x {2 * SAD_Z:.0f} x {SAD_Y[1] - SAD_Y[0]:.0f}', 'S355', 'Carries the 2 arms\' swing drives '
                      'and their half of the car. Bolted to the ram\'s flange.', {}), Location(), (0, 0, 0), 'LIFT')
    sc = std.shcs(16, 40, '10.9', 'Fastens the ram\'s top flange to the saddle, from under the flange.')
    for p in std.circle_points(8, 115, 'y'):
        m.place(ram_n, sc, std.orient((p[0], RAM_FL[0], p[2]), (0, 1, 0)), (0, -120, 0), 'LIFT')
    # the 2 lock bars, on brackets at the saddle's ends
    bar_len = L['fullRise'] * M + 120
    for zz in (BAR_Z, -BAR_Z):
        sgn = 1 if zz > 0 else -1
        brk = bx(-40, 40, SAD_Y[0], SAD_Y[0] + 22, min(sgn * SAD_Z, zz + sgn * 30), max(sgn * SAD_Z, zz + sgn * 30))
        m.place(ram_n, mk(m, f'TB-LBK{"N" if zz > 0 else "S"}', 'Lock bar bracket', brk, 'steel_yellow', 'structure', 'flame-cut plate',
                          '80 x 22', 'S355', 'Hangs a lock bar from the saddle\'s end.', {}), Location(), (0, 30, sgn * 60), 'LIFT')
        pitch = L['lockPitch'] * M
        bar = bx(-14, 14, SAD_Y[0] - bar_len, SAD_Y[0], -12, 12)
        for i in range(int((bar_len - 60) // pitch)):
            y0 = SAD_Y[0] - 60 - i * pitch
            bar = bar.cut(bx(8, 15, y0 - 18, y0, -13, 13))        # a tooth's notch on the face toward the pawl
        m.place(ram_n, mk(m, 'TB-LBR', 'Lock bar, toothed, hardened steel', bar, 'steel', 'structure', 'flame-cut and ground',
                          f'28 x 24 x {bar_len:.0f}', '42CrMo4, teeth induction hardened',
                          f'Hangs from the saddle into the casing. The pawl drops into its teeth every {pitch:.0f} mm.', {}, depot='box'),
                loc(0, 0, zz), (0, -250, 0), 'LIFT')
        for dx in (-22, 22):
            m.place(ram_n, std.shcs(12, 50, '10.9', 'Fastens the lock bar to its bracket.'),
                    std.orient((dx, SAD_Y[0] + 22, zz), (0, -1, 0)), (0, 60, 0), 'LIFT')
    # ── the 2 swing drives (in the saddle) and the 2 arms ───────────────────────────────────────────────────────────
    top_in = SAD_Y[1] - 10                            # the saddle's top plate's underside
    sd = (cyl_y(80, top_in - 64, top_in - 14).union(cyl_y(96, top_in - 14, top_in))
          .union(cyl_y(70, top_in, SAD_Y[1] + 2)).cut(cyl_y(30, top_in - 65, SAD_Y[1] + 3))
          .union(bx(55, 120, top_in - 62, top_in - 28, -75, 75)))
    for p in std.circle_points(8, 88, 'y', start=22.5):
        sd = sd.cut(cyl_y(std.HOLE[10] / 2, top_in - 15, top_in + 1, x=p[0], z=p[2]))
    sd_pd = mk(m, 'TB-SWD', 'Worm slewing drive with 24 V gearmotor', sd, 'steel_paint', 'drive', 'catalogue part', 'D 200 x 76',
               'IP65', 'Swings its arm out to the lift point and back. The worm does not turn back: the arm holds its angle with the '
                       'power off.', {'output torque': '400 N m (class)', 'ratio': '62:1', 'class size': 'ASSUMPTION'}, 'buy',
               mass_override=11.0)
    for sx in (1, -1):
        # the drive's worm boss points toward the saddle's end on its own side
        m.place(ram_n, sd_pd, loc(sx * pivx, 0, 0, ry=0 if sx > 0 else 180), (sx * 60, 0, 0), 'ARMS')
        for p in std.circle_points(8, 88, 'y', start=22.5):
            m.place(ram_n, std.shcs(10, 20, '10.9', 'Fastens the slewing drive up under the saddle\'s top plate.'),
                    std.orient((sx * pivx + p[0], top_in - 14, p[2]), (0, 1, 0)), (sx * 60, -40, 0), 'ARMS')
    # which arm a post's +x and -x sides are: the front post's +x is the west car side; the rear post is turned
    sides = {1: 'W', -1: 'E'} if turn == 0 else {1: 'E', -1: 'W'}
    for sx in (1, -1):
        _arm(m, ram_n, tag, sides[sx], sx, pivx, L)
    # the saddle's junction box on its +x end wall, under the arms' swing, and the cable reel in its pocket beside it
    jb = bx(SAD_X, SAD_X + 50, SAD_Y[0] + 12, SAD_Y[1] - 8, -55, 55)
    m.place(ram_n, mk(m, 'TB-SJB', 'Saddle junction box, IP67', jb, 'al6061', 'electrical', 'EN 62208', '50 x 70 x 110', 'IP67',
                      'Joins the reel\'s cable to the 2 arms\' cables: power and EtherCAT to the pads and the swing drives.', {}, 'buy',
                      mass_override=0.8), Location(), (100, 0, 0), 'PADS')
    ra = REEL_FLOOR + 10 + 85
    reel = (cyl_x(85, REEL_X[0] + 10, REEL_X[1] - 10, y=ra).union(bx(REEL_X[0] + 5, REEL_X[1] - 5, REEL_FLOOR, REEL_FLOOR + 10, -90, 90)))
    m.place(post, mk(m, 'TB-SCR', 'Spring cable reel, 2.5 m', reel, 'pa66_yellow', 'electrical', 'catalogue part', 'D 170 x 90',
                     'IP65', 'Pays the saddle\'s cable up as the ram rises and winds it back as it lowers.',
                     {'cable': '2.5 m of hybrid cable (power and EtherCAT)', 'class size': 'ASSUMPTION'}, 'buy', mass_override=4.5),
            Location(), (120, 0, 0), 'PADS')
    return outer.union(cyl_y(cas_r + 20, -2000, CAS_FL[1]))


def _arm(m: Model, ram_n: Node, tag: str, side: str, sx: int, pivx: float, L: dict) -> None:
    """One lift arm on its post's +x (sx = 1) or -x side: its swing node, its slide and its pad. The arm's frame: origin on
    its pivot axis at its root plate's underside, the arm along -Z at swing 0. Its parts are symmetric about its own
    vertical middle, so the same parts serve both sides."""
    arm = ram_n.child(f'Arm{tag}{side}', loc(sx * pivx, ARM_Y0, 0), sub='ARMS',
                      joint={'name': f'TB_SW{tag}_{side}', 'axis': [0, -sx, 0], 'limits': [0.0, math.radians(110)],
                             'kind': 'revolute', 'stowed': 0.0})
    root = cyl_y(95, 0, 10)
    rps = [(28, -44), (-28, -44), (28, 44), (-28, 44), (35, 0), (-35, 0)]     # inside the box, clear of its walls
    for (px, pz) in rps:
        root = root.cut(cyl_y(std.HOLE[8] / 2, -1, 11, x=px, z=pz))
    box = (bx(-50, 50, 10, 100, -ARM_BOX_END, ARM_TAIL).cut(bx(-42, 42, 18, 92, -ARM_BOX_END - 1, ARM_TAIL - 8)))
    m.place(arm, mk(m, 'TB-ARP', 'Lift arm root plate', root, 'steel', 'structure', 'machined', 'D 190 x 10', 'S355',
                    'Joins the arm to its slewing drive with 6 screws.', {}), Location(), (0, 40, 0), 'ARMS')
    m.place(arm, mk(m, 'TB-ARM', 'Lift arm, welded box 100 x 90', box, 'steel_yellow', 'structure', 'welded box, 8 mm wall',
                    f'100 x 90 x {ARM_BOX_END + ARM_TAIL:.0f}', 'S355', 'Holds the sliding inner arm. Its top is flush with the floor '
                    'when the lift is down.', {}), Location(), (0, 60, 0), 'ARMS')
    for (px, pz) in rps:
        m.place(arm, std.shcs(8, 25, '10.9', 'Fastens the arm and its root plate to the slewing drive\'s output.'),
                std.orient((px, 18, pz), (0, -1, 0)), (0, 50, 0), 'ARMS')
    # the telescope: a servo motor in the box's tail turns a ball screw along the box; the slide carries its nut
    z_mf = ARM_TAIL - 8 - 82                          # the motor's flange face (its body fills the tail)
    mot = servo_motor(m, 'TB-ATM', 60, 70, 0.2, 'Slides the inner arm out to the lift point.', mass=1.2, conn=False)
    m.place(arm, mot, loc(0, 58, z_mf, rx=-90), (0, 0, 60), 'ARMS')
    z_se = -(SLIDE_IN + 6 + 40 + (L['reach'][1] - L['reach'][0]) * M + 4)   # past the nut at full reach
    scr = cyl_z(8, z_se, z_mf - 27, y=58)
    m.place(arm, mk(m, 'TB-ABS', 'Ball screw 16 x 5', scr, 'bearing', 'drive', 'ISO 3408', f'16 x 5 x {z_mf - 27 - z_se:.0f}',
                    'C7', 'Turns in the slide\'s nut and moves the slide.', {}, 'buy'), Location(), (0, 0, -40), 'ARMS')
    lo = 0.0
    hi = (L['reach'][1] - L['reach'][0]) * M / 1000
    slide = arm.child(f'Slide{tag}{side}', Location(), sub='ARMS',
                      joint={'name': f'TB_RCH{tag}_{side}', 'axis': [0, 0, -1], 'limits': [lo, hi], 'kind': 'prismatic', 'stowed': 0.0})
    r_pad = L['reach'][0] * M
    z_tip = -(r_pad - CUP_R)
    sl = (bx(-40, 40, 20, 80, z_tip, -SLIDE_IN).cut(bx(-34, 34, 26, 74, z_tip - 1, -SLIDE_IN + 1))
          .union(bx(-34, 34, 26, 74, -SLIDE_IN - 6, -SLIDE_IN).cut(cyl_z(10, -SLIDE_IN - 7, -SLIDE_IN + 1, y=58))))
    m.place(slide, mk(m, 'TB-ASL', 'Lift arm inner slide, box 80 x 60', sl, 'steel', 'structure', 'cold-formed box, 6 mm wall',
                      f'80 x 60 x {-z_tip - SLIDE_IN:.0f}', 'S355', 'Slides out of the arm to reach the lift point. Wear strips '
                      'on its faces keep it tight in the arm.', {}), Location(), (0, 0, -60), 'ARMS')
    nut = cyl_z(16, -SLIDE_IN - 46, -SLIDE_IN - 6, y=58, ri=8)
    m.place(slide, mk(m, 'TB-ABN', 'Ball nut with flange, in the slide', nut, 'steel', 'drive', 'ISO 3408', '16 x 5', 'C7',
                      'Turns the screw\'s turn into the slide\'s travel.', {}, 'buy'), Location(), (0, 0, -60), 'ARMS')
    # the pad at the slide's tip: a cup, a steel base, the load cell and the rubber block, its top flush with the arm's
    cz = -r_pad
    cup = cyl_y(CUP_R, 10, 100, z=cz, ri=CUP_R - 10).union(cyl_y(CUP_R, 10, 18, z=cz))
    m.place(slide, mk(m, 'TB-PCP', 'Pad cup, welded to the slide', cup, 'steel_yellow', 'structure', 'welded tube', 'D 170 x 90', 'S355',
                      'Holds the pad. Its rim is flush with the floor when the lift is down.', {}), Location(), (0, 0, -80), 'PADS')
    base = cyl_y(70, 18, 60, z=cz)
    m.place(slide, mk(m, 'TB-PBS', 'Pad base', base, 'steel', 'structure', 'turned', 'D 140 x 42', 'S355',
                      'Carries the load cell in the cup.', {}), Location(), (0, 0, -80), 'PADS')
    lc = cyl_y(68, 60, 75, z=cz)
    m.place(slide, mk(m, 'TB-PLC', 'Pad load cell, 30 kN', lc, 'ss304', 'sensor', 'OIML R60 class C3', 'D 136 x 15', 'IP68',
                      'Reads the pad\'s share of the car. The lift stops if the 4 shares do not agree with the car\'s weight.',
                      {'capacity': '30 kN (class)', 'class size': 'ASSUMPTION'}, 'buy', mass_override=1.1), Location(), (0, 0, -90), 'PADS')
    rb = cyl_y(L['padD'] * M / 2, 75, 100, z=cz)
    m.place(slide, mk(m, 'TB-PRB', 'Pad rubber block', rb, 'rubber', 'structure', 'catalogue part', f'D {L["padD"] * 1000:.0f} x 25',
                      'NBR 80 Shore A, oil resistant', 'Bears on the car\'s lift point without marking it.', {}, 'buy'), Location(), (0, 0, -100), 'PADS')
    zc0 = cz - CUP_R
    cam = bx(-18, 18, 62, 100, zc0 - 36, zc0)
    m.place(slide, mk(m, 'TB-PCM', 'Pad camera with infrared light, IP67', cam, 'al6061_blk', 'sensor', 'catalogue part', '36 x 38 x 36',
                      'IP67', 'Looks up past the pad at the lift point: it checks the pad is centred under it before the car leaves the floor.',
                      {'class size': 'ASSUMPTION'}, 'buy', mass_override=0.15), Location(), (0, 30, -40), 'PADS')


# ═══════════════════════════════════════════════════════════════════════════ PORTAL RAILS ═══
RB_W, RB_Y0, RB_Y1 = 160.0, 15.0, 155.0         # each rail beam: width (X), its underside (on the plates) and top
TRUCK_Y0 = RB_Y1 + std.RAIL[35][3]              # an end truck's underside: on its 2 rail blocks
TRUCK_W, TRUCK_H = 400.0, 220.0
RACK_Y = (65.0, 105.0)                           # the travel rack's band on the rail beam's inboard face


def build_rails(m: Model, bay: Node, T: dict) -> None:
    P = T['portal']
    z0, z1 = P['railFrom'] * M, P['railTo'] * M
    L = z1 - z0
    beam = bx(-RB_W / 2, RB_W / 2, RB_Y0, RB_Y1, z0, z1).cut(bx(-RB_W / 2 + 8, RB_W / 2 - 8, RB_Y0 + 8, RB_Y1 - 8, z0 + 8, z1 - 8))
    beam_pd = mk(m, 'TB-RLB', 'Portal rail beam, welded box 160 x 140', beam, 'steel_yellow', 'structure', 'welded box, 8 mm wall',
                 f'160 x 140 x {L:.0f}', 'S355', 'Carries one side of the portal: its profile rail on top, its rack on the inboard face.',
                 {'level': 'grouted to 0.2 mm in 1 m (the rail maker\'s mounting limit, ASSUMPTION)'})
    plate = bx(-130, 130, 0, RB_Y0, -110, 110)
    for dx in (-105, 105):
        plate = plate.cut(cyl_y(std.HOLE[16] / 2, -1, RB_Y0 + 1, x=dx))
    plate_pd = mk(m, 'TB-RLP', 'Rail anchor plate 260 x 220 x 15', plate, 'steel_s355', 'structure', 'cut plate', '260 x 220 x 15', 'S355',
                  'Spreads the rail\'s load into the slab. Grouted under.', {}, depot='box')
    n_pl = 11
    rail = std.rail(35, L)
    w, h, bw, bh, bl, pitch, sc = std.RAIL[35]
    n_sc = int(L // pitch)
    zs = [-L / 2 + (L - (n_sc - 1) * pitch) / 2 + i * pitch for i in range(n_sc)]
    rs = std.shcs(sc, 25, '12.9', 'Fastens the profile rail to its beam.')
    for xc in (P['railX'] * M, -P['railX'] * M):
        m.place(bay, beam_pd, loc(xc, 0, 0), (math.copysign(250, xc), -80, 0), 'RAILS')
        for i in range(n_pl):
            zp = z0 + 150 + i * (L - 300) / (n_pl - 1)
            m.place(bay, plate_pd, loc(xc, 0, zp), (math.copysign(250, xc), -140, 0), 'RAILS')
            for dx in (-105, 105):
                m.place(bay, anchor_bolt(m, 16, 125), std.orient((xc + dx, RB_Y0, zp), (0, -1, 0)), (math.copysign(250, xc), 100, 0), 'RAILS')
        m.place(bay, rail, loc(xc, RB_Y1, (z0 + z1) / 2), (math.copysign(250, xc), 60, 0), 'RAILS')
        for zz in zs:
            m.place(bay, rs, std.orient((xc, RB_Y1 + h - h * 0.45, (z0 + z1) / 2 + zz), (0, -1, 0)), (math.copysign(250, xc), 120, 0), 'RAILS')
        # the travel rack on the inboard face, in 1 m pieces, its teeth toward the bay's centre
        inb = -1 if xc > 0 else 1
        zz0 = z0 + 50
        while zz0 < z1 - 100:
            ln = min(1000.0, z1 - 50 - zz0)
            rk = rack_bar(m, f'TB-GR-PR{ln:.0f}', 4, ln, 40, RACK_Y[1] - RACK_Y[0], 'The portal\'s travel pinion rolls along it.')
            xb = xc + inb * RB_W / 2
            at = loc(xb, (RACK_Y[0] + RACK_Y[1]) / 2, zz0 + ln, ry=180) if inb < 0 else loc(xb, (RACK_Y[0] + RACK_Y[1]) / 2, zz0)
            m.place(bay, rk, at, (inb * -120, 0, 0), 'TRAVEL')
            for k in range(int(ln // 125)):
                zk = zz0 + 62.5 + k * 125
                m.place(bay, std.shcs(8, 25, '10.9', 'Fastens the rack to the rail beam, from inside the beam.'),
                        std.orient((xb - inb * 8, (RACK_Y[0] + RACK_Y[1]) / 2, zk), (inb, 0, 0)), (inb * -140, 0, 0), 'TRAVEL')
            zz0 += ln
        # an end stop at each rail end: a block on the beam's top beside the rail, a buffer toward the truck
        for (ze, tw) in ((z0, 1), (z1, -1)):
            st = bx(-RB_W / 2, -w / 2 - 6, RB_Y1, RB_Y1 + 60, -40, 40)
            st_pd = mk(m, 'TB-RST', 'Rail end stop block', st, 'steel_yellow', 'structure', 'welded block', '57 x 60 x 80', 'S355',
                       'Stops the end truck if the portal runs past its travel.', {})
            for sx in (1, -1):
                m.place(bay, st_pd, loc(xc, 0, ze + tw * 40, ry=0 if sx > 0 else 180), (0, 60, tw * 60), 'RAILS')
                buf = cyl_z(22, 0, 40, x=0, y=0)
                bpd = mk(m, 'TB-RBF', 'End stop buffer, polyurethane', buf, 'pu', 'structure', 'catalogue part', 'D 44 x 40', '90 Shore A',
                         'Takes the blow of an end truck at the end stop.', {}, 'buy')
                xs = xc + sx * (-(RB_W / 2 + w / 2 + 6) / 2)
                m.place(bay, bpd, loc(xs, RB_Y1 + 30, ze + tw * 80, ry=0 if tw > 0 else 180), (0, 60, tw * 100), 'RAILS')


# ═════════════════════════════════════════════════════════════════════════════════ PORTAL ═══
BEAM_Y0 = 3100.0
BEAM_Y1 = BEAM_Y0 + 460.0
BEAM_HZ = 170.0                                   # the beam's half width (Z)
BEAM_HX = 3770.0
LEG_W, LEG_D = 240.0, 300.0
LEG_BOLTS = [(x, z) for x in (-148.0, 148.0) for z in (-100.0, 0.0, 100.0)]
TROL_RAIL_Z = 110.0
TRACK_Y = (3260.0, 3300.0)                        # the trolleys' rack band on the beam's south face
CHAIN_FIX_X = 1750.0                              # each trolley chain's fixed end, over the beam (|X|)


def build_portal(m: Model, bay: Node, T: dict) -> Node:
    P = T['portal']
    if (abs(TRUCK_W - P['truckW'] * M) > 1e-6 or abs(TRUCK_H - P['truckH'] * M) > 1e-6 or abs(LEG_W - P['legW'] * M) > 1e-6
            or abs(LEG_D - P['legD'] * M) > 1e-6 or abs(TRUCK_Y0 + TRUCK_H - P['truckTop'] * M) > 1e-6):
        raise ValueError('the portal\'s truck or leg sizes no longer agree with the spec (portal.truckW/H/Top, legW/D)')
    lo, hi = P['travelFrom'], P['travelTo']
    por = bay.child('Portal', Location(), sub='PORTAL',
                    joint={'name': 'TB_PORTAL', 'axis': [0, 0, 1], 'limits': [lo, hi], 'kind': 'prismatic', 'stowed': P['park']})
    xr = P['railX'] * M
    # ── end trucks: a welded box on 2 rail blocks, its travel drive inside ──────────────────────────────────────────
    tr = (bx(-TRUCK_W / 2, TRUCK_W / 2, TRUCK_Y0, TRUCK_Y0 + TRUCK_H, -P['truckL'] * M / 2, P['truckL'] * M / 2)
          .cut(bx(-TRUCK_W / 2 + 10, TRUCK_W / 2 - 10, TRUCK_Y0 + 10, TRUCK_Y0 + TRUCK_H - 10, -P['truckL'] * M / 2 + 10, P['truckL'] * M / 2 - 10)))
    tr = tr.cut(cyl_y(30, TRUCK_Y0 - 1, TRUCK_Y0 + 11, x=-156))          # the pinion shaft's hole (the truck's inboard side is -x)
    truck_pd = mk(m, 'TB-TRK', 'Portal end truck, welded box', tr, 'steel_yellow', 'structure', 'welded box, 10 mm',
                  f'{TRUCK_W:.0f} x {TRUCK_H:.0f} x {P["truckL"] * 1000:.0f}', 'S355',
                  'Rides its floor rail on 2 blocks and carries one leg. Its travel drive is inside it.', {})
    blk = std.rail_block(35)
    bw, bl = std.RAIL[35][2], std.RAIL[35][4]
    gb = (bx(-32, 88, 0, 150, -70, 70).cut(cyl_z(13, 15, 71, x=28, y=75))     # output 32 mm from its inboard side; the motor's input bore
          .cut(cyl_z(31, 65, 71, x=28, y=75)))                                    # and the recess its pilot sits in
    gb_pd = mk(m, 'TB-TGB', 'Travel gearbox, right angle, 20:1', gb, 'al6061', 'drive', 'catalogue part', '120 x 150 x 140', 'IP65',
               'Turns the motor\'s drive down to the pinion. A brake on the motor holds the portal.', {'class size': 'ASSUMPTION'}, 'buy',
               mass_override=14.0)
    tm = servo_motor(m, 'TB-TMT', 100, 170, 2.0, 'Drives the portal along the bay; the 2 sides keep in step by their encoders.',
                     brake=True, conn=False)
    tp = pinion(m, 'TB-PIN-TRV', 4, 20, 34, 30, 'y', 'Drives the portal along its rack.')
    for sx in (1, -1):
        xc = sx * xr
        side = 'W' if sx > 0 else 'E'
        # each truck in the side's own frame: its inboard side toward the bay's centre (-x on the west, turned on the east)
        tf = por.child(f'Truck{side}', loc(xc, 0, 0, ry=0 if sx > 0 else 180), sub='PORTAL')
        m.place(tf, truck_pd, Location(), (300, 80, 0), 'PORTAL')
        for zb in (-330, 330):
            m.place(tf, blk, loc(0, RB_Y1, zb), (300, -40, 0), 'PORTAL')
            for (dx, dz) in ((bw * 0.36, bl * 0.26), (-bw * 0.36, bl * 0.26), (bw * 0.36, -bl * 0.26), (-bw * 0.36, -bl * 0.26)):
                m.place(tf, std.shcs(10, 30, '12.9', 'Fastens the truck to its rail block.'),
                        std.orient((dx, TRUCK_Y0 + 10, zb + dz), (0, -1, 0)), (300, 40, 0), 'PORTAL')
        m.place(tf, gb_pd, loc(-156, TRUCK_Y0 + 10, 0), (200, 120, 0), 'TRAVEL')
        m.place(tf, tm, loc(-128, TRUCK_Y0 + 85, 70, rx=-90), (200, 120, 120), 'TRAVEL')
        sh = cyl_y(15, (RACK_Y[0] + RACK_Y[1]) / 2, TRUCK_Y0 + 10)
        m.place(tf, mk(m, 'TB-TSH', 'Travel pinion shaft with bearing', sh, 'steel', 'drive', 'machined', 'D 30', '42CrMo4',
                       'Carries the pinion under the truck. A bearing in the truck\'s floor takes its side load.', {}), loc(-156, 0, 0),
                (200, -60, 0), 'TRAVEL')
        m.place(tf, tp, loc(-156, (RACK_Y[0] + RACK_Y[1]) / 2, 0), (200, -100, 0), 'TRAVEL')
        # the leg, its 2 flanges and their bolts
        leg_y0, leg_y1 = TRUCK_Y0 + TRUCK_H, BEAM_Y0
        leg = (bx(-LEG_W / 2, LEG_W / 2, leg_y0 + 20, leg_y1 - 20, -LEG_D / 2, LEG_D / 2)
               .cut(bx(-LEG_W / 2 + 8, LEG_W / 2 - 8, leg_y0 + 20, leg_y1 - 20, -LEG_D / 2 + 8, LEG_D / 2 - 8)))
        fl = bx(-LEG_W / 2 - 58, LEG_W / 2 + 58, 0, 20, -LEG_D / 2 - 10, LEG_D / 2 + 10)
        for (fx, fz) in LEG_BOLTS:
            fl = fl.cut(cyl_y(std.HOLE[20] / 2, -1, 21, x=fx, z=fz))
        leg_pd = mk(m, 'TB-LEG', 'Portal leg, box 240 x 360', leg.union(fl.translate((0, leg_y0, 0))).union(fl.translate((0, leg_y1 - 20, 0))),
                    'steel_yellow', 'structure', 'welded box, 8 mm wall, 2 flanges 20', f'240 x 360 x {leg_y1 - leg_y0:.0f}', 'S355',
                    'Stands the beam on its end truck.', {})
        m.place(tf, leg_pd, Location(), (300, 400, 0), 'PORTAL')
        for (fx, fz) in LEG_BOLTS:
            std.bolt_stack(m, tf, 'PORTAL', (fx, leg_y0 + 20, fz), (0, -1, 0), 20, 50, 30, '8.8', 'nyloc',
                           'Bolts the leg\'s foot to the end truck.', (300, 200, 0))
            std.bolt_stack(m, tf, 'PORTAL', (fx, leg_y1 - 20, fz), (0, 1, 0), 20, 50, 32, '8.8', 'nyloc',
                           'Bolts the leg\'s head to the beam\'s bottom flange.', (300, 500, 0))
    # ── the beam: a box girder from leg to leg, with the trolleys' rails under it and their rack on its south face ────
    bm = (bx(-BEAM_HX, BEAM_HX, BEAM_Y0, BEAM_Y1, -BEAM_HZ, BEAM_HZ)
          .cut(bx(-BEAM_HX + 10, BEAM_HX - 10, BEAM_Y0 + 12, BEAM_Y1 - 12, -BEAM_HZ + 10, BEAM_HZ - 10)))
    for xc in (xr, -xr):
        for (fx, fz) in LEG_BOLTS:
            bm = bm.cut(cyl_y(std.HOLE[20] / 2, BEAM_Y0 - 1, BEAM_Y0 + 13, x=xc + fx, z=fz))
    m.place(por, mk(m, 'TB-BEM', 'Portal beam, box girder 340 x 460', bm, 'steel_yellow', 'structure', 'welded box, webs 10, flanges 12',
                    f'340 x 460 x {2 * BEAM_HX:.0f}', 'S355', 'Spans the bay over the car. The 2 wheel robots run under it.', {}),
            Location(), (0, 600, 0), 'PORTAL')
    rlen = 2 * 3350.0
    trail = std.rail(30, rlen)
    w30, h30, bw30, bh30, bl30, p30, sc30 = std.RAIL[30]
    n30 = int(rlen // p30)
    for zr in (TROL_RAIL_Z, -TROL_RAIL_Z):
        m.place(por, trail, loc(0, BEAM_Y0, zr, rx=180, ry=90), (0, -60, 0), 'TROLLEY')
        for i in range(n30):
            xx = -rlen / 2 + (rlen - (n30 - 1) * p30) / 2 + i * p30
            m.place(por, std.shcs(sc30, 30, '12.9', 'Fastens the trolley rail under the beam.'),
                    std.orient((xx, BEAM_Y0 - h30 + h30 * 0.45, zr), (0, 1, 0)), (0, -80, 0), 'TROLLEY')
    return por


# ═════════════════════════════════════════════════════════════════════════════ THE ROBOTS ═══
# Each robot in its SIDE frame: the west robot's is the bay's, the east robot's the same turned a half turn about the bay's
# vertical axis, so one set of parts serves both. In it: +x runs from the drive line out to the side wall, +z north (for
# the west robot), y is the height above the floor. The trolley's joint moves the slew axis to x = TB_TROL (metres); the
# slew turns about it (0: the head faces the car, toward -x; pi: the wall); the Z-beam slides down from its guide frame.
TP_Y = (3033.0, 3058.0)          # the trolley plate, under the blocks
TP_X = 300.0
TP_Z = (-300.0, 350.0)
BLK_X = 240.0                    # the 4 trolley blocks at x = +/-240, z = +/-110
SR_IN = (2955.0, 3033.0, 150.0, 205.0)    # the slewing ring's inner ring: y0, y1, bore radius, outer radius (on the trolley)
SR_OUT = (2953.0, 3031.0, 208.0, 259.0, 268.0)   # its outer ring: y0, y1, inner radius, tooth root and tip (m4, 132 teeth)
SLW_Y = (2928.0, 2953.0)         # the slew plate, under the outer ring
SLW_PIN_Z = 296.0                # the slew pinion (m4, 16 teeth): (528 + 64) / 2 from the axis
TRV_PIN = (3277.0, -227.0)       # the trolley pinion (m3, 20 teeth): its height and z, on the rack on the beam's south face
GF_Y = (1525.0, 2908.0)          # the guide frame's plates (their top flanges 2908 to 2928)
GF_X = (116.0, 136.0)            # its front and back plates (|x|): the Z blocks' faces
GF_ZS = (190.0, 210.0)           # its side plate (+z)
ZB_W = 80.0                      # the Z-beam's half width (160 x 160)
ZB_L = 1300.0                    # its length; its foot at 860 mm with TB_Z = 0 (the head's axis 460 under it)
ZB_FOOT0 = 860.0
Z_PIN_Y = 1800.0                 # the Z pinion's height (axis along x) on the rack on the beam's +z face
ZC_R = 150.0                     # the vertical chain's bend radius
ZC_A = 2800.0                    # its fixed end's height (the fixed run hangs down from it)
ZC_ZM = -102.5                   # its moving run (z), on the beam's -z face; the fixed run 2 x R further out
BOX = (136.0, 326.0, 2150.0, 2875.0, -150.0, 150.0)   # the head's drive box on the guide frame's back plate
ZC_HANG_Z = (-412.0, -390.0)       # the chain hanger's 2 screw rows up into the slew plate's arm
TILT_Y = -140.0                  # the tilt axis under the Z-beam's foot (Z frame)
TILT_OUT_Z = 150.0               # the tilt actuator's output face (tilt frame z): its housing toward -z


def frame_loc(o, xd, yd) -> Location:
    """A location whose local x and y axes point along xd and yd (unit, square to each other), at o."""
    from OCP.gp import gp_Trsf
    zd = (xd[1] * yd[2] - xd[2] * yd[1], xd[2] * yd[0] - xd[0] * yd[2], xd[0] * yd[1] - xd[1] * yd[0])
    t = gp_Trsf()
    t.SetValues(xd[0], yd[0], zd[0], o[0], xd[1], yd[1], zd[1], o[1], xd[2], yd[2], zd[2], o[2])
    return Location(t)


def gearbox(m: Model, pid, name, body: cq.Workplane, ratio, fn, mass, spec=None) -> PartDef:
    return mk(m, pid, name, body, 'al6061', 'drive', 'catalogue part', '', 'low backlash, IP65', fn,
              {'ratio': f'{ratio}:1', 'class size': 'ASSUMPTION', **(spec or {})}, 'buy', mass_override=mass)


def build_robot(m: Model, por: Node, side: str, T: dict) -> Node:
    """One wheel robot on the portal's beam: its side frame, its rack on the beam, the trolley, the slew, the guide frame,
    the Z-beam, the tilt and the head."""
    TR_ = T['trolley']
    H = T['head']
    if abs(ZB_FOOT0 - (T['zaxis']['from'] + H['axisBelowFoot']) * M) > 1e-6 or abs(TILT_Y + (H['axisBelowFoot'] - H['tiltY']) * M) > 1e-6:
        raise ValueError('ZB_FOOT0 or TILT_Y no longer agrees with the spec (zaxis.from, head.axisBelowFoot, head.tiltY)')
    S = por.child(f'Side{side}', loc(0, 0, 0, ry=0 if side == 'W' else 180), sub='TROLLEY')
    # ── the trolley's rack on the beam's south face (in the side frame), from 0.70 m out to the leg ──────────────────
    xx0 = 700.0
    while xx0 < 3350 - 1:
        ln = min(1000.0, 3350 - xx0)
        rk = rack_bar(m, f'TB-GR-TR{ln:.0f}', 3, ln, 30, 40, 'The trolley\'s pinion rolls along it.')
        m.place(S, rk, loc(xx0, 3280, -BEAM_HZ, ry=90), (0, 0, -120), 'TROLLEY')
        for k in range(int(ln // 125)):
            m.place(S, std.shcs(6, 20, '10.9', 'Fastens the trolley\'s rack to the beam, from inside the beam.'),
                    std.orient((xx0 + 62.5 + k * 125, 3280, -BEAM_HZ + 10), (0, 0, -1)), (0, 0, -140), 'TROLLEY')
        xx0 += ln
    tr = S.child(f'Trolley{side}', Location(), sub='TROLLEY',
                 joint={'name': f'TB_TROL_{side}', 'axis': [1, 0, 0], 'limits': [TR_['from'], TR_['to']], 'kind': 'prismatic',
                        'stowed': TR_['park']})
    _trolley(m, tr, side)
    sl = tr.child(f'Slew{side}', Location(), sub='SLEW',
                  joint={'name': f'TB_SLEW_{side}', 'axis': [0, 1, 0], 'limits': [T['slew']['from'], T['slew']['to']],
                         'kind': 'revolute', 'stowed': 0.0})
    _slew(m, tr, sl, side)
    zn = sl.child(f'Z{side}', loc(0, ZB_FOOT0, 0), sub='ZAXIS',
                  joint={'name': f'TB_Z_{side}', 'axis': [0, 1, 0], 'limits': [0.0, T['zaxis']['to'] - T['zaxis']['from']],
                         'kind': 'prismatic', 'stowed': T['zaxis']['to'] - T['zaxis']['from']})
    _guide(m, sl, zn, side, T)
    _zbeam(m, sl, zn, side, T)
    build_head(m, zn, side, T)
    return tr


def _trolley(m: Model, tr: Node, side: str) -> None:
    w30, h30, bw30, bh30, bl30, p30, sc30 = std.RAIL[30]
    pl = bx(-TP_X, TP_X, TP_Y[0], TP_Y[1], TP_Z[0], TP_Z[1])
    blk_screws = [(sx * BLK_X + dx, sz * 110 + dz) for sx in (1, -1) for sz in (1, -1)
                  for dx in (-bl30 * 0.26, bl30 * 0.26) for dz in (-bw30 * 0.36, bw30 * 0.36)]
    for (x, z) in blk_screws:                                   # counterbored from below: the slewing ring turns under them
        pl = pl.cut(cyl_y(std.HOLE[8] / 2, TP_Y[0] - 1, TP_Y[1] + 1, x=x, z=z)).cut(cyl_y(7.5, TP_Y[0] - 1, TP_Y[0] + 8.5, x=x, z=z))
    for p in std.circle_points(12, 177.5, 'y', start=15):       # the inner ring's screws, down through the plate
        pl = pl.cut(cyl_y(std.HOLE[12] / 2, TP_Y[0] - 1, TP_Y[1] + 1, x=p[0], z=p[2]))
    pl = pl.cut(cyl_y(52, TP_Y[0] - 1, TP_Y[1] + 1))           # the slip ring
    pl = pl.cut(cyl_y(14, TP_Y[0] - 1, TP_Y[1] + 1, z=SLW_PIN_Z))   # the slew gearbox's output shaft
    for (dx, dz) in ((35, 35), (35, -35), (-35, 35), (-35, -35)):
        pl = pl.cut(cyl_y(3.4, TP_Y[0] - 1, TP_Y[1] + 1, x=dx, z=SLW_PIN_Z + dz))
    for (dx, dz) in ((30, 30), (30, -30), (-30, 30), (-30, -30)):     # the trolley gearbox's screws, counterbored from below
        pl = pl.cut(cyl_y(std.HOLE[8] / 2, TP_Y[0] - 1, TP_Y[1] + 1, x=dx, z=TRV_PIN[1] + dz)).cut(
            cyl_y(7.5, TP_Y[0] - 1, TP_Y[0] + 8.5, x=dx, z=TRV_PIN[1] + dz))
    m.place(tr, mk(m, 'TB-TPL', 'Trolley plate, steel 25 mm', pl, 'steel_yellow', 'structure', 'flame-cut and machined plate',
                   f'{2 * TP_X:.0f} x {TP_Z[1] - TP_Z[0]:.0f} x 25', 'S355', 'Rides the 2 rails under the beam on 4 blocks. It carries the '
                   'slewing ring, the trolley drive and the slew drive.', {}), Location(), (0, -60, 0), 'TROLLEY')
    blk = std.rail_block(30)
    for sx in (1, -1):
        for sz in (1, -1):
            m.place(tr, blk, loc(sx * BLK_X, BEAM_Y0, sz * TROL_RAIL_Z, rx=180, ry=90), (0, 40, 0), 'TROLLEY')
    bs = std.shcs(8, 25, '12.9', 'Fastens the trolley plate to its rail block, from under the plate.')
    for (x, z) in blk_screws:
        m.place(tr, bs, std.orient((x, TP_Y[0] + 8.5, z), (0, 1, 0)), (0, -80, 0), 'TROLLEY')
    # ── the trolley drive: a right-angle gearbox on the plate, its shaft up to the pinion on the beam's rack ─────────
    yp, zp = TRV_PIN
    gb = (bx(-45, 45, TP_Y[1], TP_Y[1] + 90, zp - 45, zp + 45)
          .cut(cyl_x(8, -46, -18, y=TP_Y[1] + 45, z=zp)).cut(cyl_x(19, -46, -42, y=TP_Y[1] + 45, z=zp)))
    for (dx, dz) in ((30, 30), (30, -30), (-30, 30), (-30, -30)):
        gb = gb.cut(cyl_y(4, TP_Y[1] - 1, TP_Y[1] + 14, x=dx, z=zp + dz))
    m.place(tr, gearbox(m, 'TB-TGR', 'Trolley gearbox, right angle, 10:1', gb, 10, 'Turns the motor\'s drive up to the pinion.', 6.5),
            Location(), (0, 60, -80), 'TROLLEY')
    sh = cyl_y(12.5, TP_Y[1] + 90, yp + 21, z=zp)
    m.place(tr, mk(m, 'TB-TGS', 'Trolley gearbox output shaft', sh, 'steel', 'drive', 'machined', 'D 25', '42CrMo4',
                   'Carries the pinion up beside the beam\'s south face.', {}), Location(), (0, 80, -80), 'TROLLEY')
    m.place(tr, pinion(m, 'TB-PIN-TRL', 3, 20, 30, 25, 'y', 'Drives the trolley along the beam\'s rack.'), loc(0, yp, zp),
            (0, 120, -80), 'TROLLEY')
    m.place(tr, servo_motor(m, 'TB-TRM', 60, 120, 0.4, 'Drives the trolley across the bay. Its brake holds it.', brake=True, conn=False),
            loc(-45, TP_Y[1] + 45, zp, rz=-90), (-100, 60, -80), 'TROLLEY')
    gs = std.shcs(8, 25, '12.9', 'Fastens the trolley gearbox to the plate, from under the plate.')
    for (dx, dz) in ((30, 30), (30, -30), (-30, 30), (-30, -30)):
        m.place(tr, gs, std.orient((dx, TP_Y[0] + 8.5, zp + dz), (0, 1, 0)), (0, -80, -80), 'TROLLEY')
    # ── the slip ring with its fibre rotary joint, on the slew axis: its stator on the plate, its rotor on the slew plate
    st = cyl_y(60, TP_Y[1], TP_Y[1] + 10).union(cyl_y(48, TP_Y[1] + 10, TP_Y[1] + 34)).union(cyl_y(50, 2975, TP_Y[1]))
    st = st.cut(cyl_y(51.5, TP_Y[0] - 0.5, TP_Y[1] + 0.01).cut(cyl_y(50, TP_Y[0] - 1, TP_Y[1] + 1)))
    m.place(tr, mk(m, 'TB-SRS', 'Slip ring with fibre rotary joint, stator', st, 'al6061_blk', 'electrical', 'catalogue part',
                   'D 120 x 119', 'IP65', 'Brings power, EtherCAT and the vision fibre across the slew. The slew may turn any way and '
                   'no cable twists.', {'circuits': '4 x 16 A (400 V and earth), 4 for EtherCAT, 2 spare',
                                        'fibre': '1 channel, single-mode', 'class size': 'ASSUMPTION'}, 'buy', mass_override=3.5),
            Location(), (0, 100, 0), 'SLEW')
    ss = std.shcs(5, 12, '10.9', 'Fastens the slip ring\'s stator flange to the trolley plate.')
    for p in std.circle_points(4, 55, 'y', start=45):
        m.place(tr, ss, std.orient((p[0], TP_Y[1] + 10, p[2]), (0, -1, 0)), (0, 120, 0), 'SLEW')
    # ── the slew drive: a gearbox on the plate's north side, its shaft down to the pinion on the slewing ring's teeth ──
    gs2 = (bx(-45, 45, TP_Y[1], TP_Y[1] + 10, SLW_PIN_Z - 45, SLW_PIN_Z + 45)
           .union(cyl_y(42, TP_Y[1] + 10, TP_Y[1] + 90, z=SLW_PIN_Z))
           .union(bx(-40, 40, TP_Y[1] + 90, TP_Y[1] + 100, SLW_PIN_Z - 40, SLW_PIN_Z + 40))
           .cut(cyl_y(10, TP_Y[1] + 60, TP_Y[1] + 101, z=SLW_PIN_Z)).cut(cyl_y(24.5, TP_Y[1] + 96.5, TP_Y[1] + 101, z=SLW_PIN_Z)))
    for (dx, dz) in ((35, 35), (35, -35), (-35, 35), (-35, -35)):
        gs2 = gs2.cut(cyl_y(4.5, TP_Y[1] - 1, TP_Y[1] + 11, x=dx, z=SLW_PIN_Z + dz))
    m.place(tr, gearbox(m, 'TB-SGR', 'Slew gearbox, planetary, 10:1', gs2, 10, 'Turns the slew motor\'s drive down to the pinion.', 7.0),
            Location(), (0, 80, 80), 'SLEW')
    m.place(tr, mk(m, 'TB-SGS', 'Slew gearbox output shaft', cyl_y(12.5, 2962, TP_Y[1]), 'steel', 'drive', 'machined', 'D 25', '42CrMo4',
                   'Carries the pinion down through the plate to the slewing ring\'s teeth.', {}), loc(0, 0, SLW_PIN_Z), (0, 40, 80), 'SLEW')
    m.place(tr, pinion(m, 'TB-PIN-SLW', 4, 16, 50, 25, 'y', 'Turns the slewing ring.'), loc(0, 2992, SLW_PIN_Z), (0, -40, 80), 'SLEW')
    m.place(tr, servo_motor(m, 'TB-SLM', 80, 130, 0.4, 'Turns the robot between the car and the wall. Its brake holds the turn.',
                            brake=True, conn=False), loc(0, TP_Y[1] + 100, SLW_PIN_Z, rx=180), (0, 160, 80), 'SLEW')
    s8 = std.shcs(8, 20, '10.9', 'Fastens the slew gearbox to the trolley plate.')
    for (dx, dz) in ((35, 35), (35, -35), (-35, 35), (-35, -35)):
        m.place(tr, s8, std.orient((dx, TP_Y[1] + 10, SLW_PIN_Z + dz), (0, -1, 0)), (0, 120, 80), 'SLEW')
    s6 = std.shcs(6, 16, '10.9', 'Fastens the slew motor to its gearbox.')
    for (dx, dz) in ((32, 32), (32, -32), (-32, 32), (-32, -32)):
        m.place(tr, s6, std.orient((dx, TP_Y[1] + 112, SLW_PIN_Z + dz), (0, -1, 0)), (0, 200, 80), 'SLEW')


def _slew(m: Model, tr: Node, sl: Node, side: str) -> None:
    y0, y1, ri, ro = SR_IN
    inner = cyl_y(ro, y0, y1, ri=ri)
    for p in std.circle_points(12, 177.5, 'y', start=15):
        inner = inner.cut(cyl_y(std.HOLE[12] / 2 - 1.0, y1 - 25, y1 + 1, x=p[0], z=p[2]))
    m.place(tr, mk(m, 'TB-SRI', 'Slewing ring, inner ring (fixed)', inner, 'steel', 'drive', 'ISO 76 rated, catalogue part',
                   'D 300 / 410 x 78', 'ground raceway', 'Screwed up under the trolley plate. The balls run between it and the '
                   'outer ring.', {'class size': 'ASSUMPTION: a single-row ball slewing ring with an external gear, raceway D 411'},
                   'buy', mass_override=14.0), Location(), (0, -40, 0), 'SLEW')
    sc = std.shcs(12, 45, '10.9', 'Fastens the slewing ring\'s inner ring up under the trolley plate.')
    for p in std.circle_points(12, 177.5, 'y', start=15):
        m.place(tr, sc, std.orient((p[0], TP_Y[1], p[2]), (0, -1, 0)), (0, 100, 0), 'SLEW')
    oy0, oy1, ori, root, tip = SR_OUT
    outer = zigzag_ring(root, tip, 132, oy1 - oy0, 'y').translate((0, (oy0 + oy1) / 2, 0)).cut(cyl_y(ori, oy0 - 1, oy1 + 1))
    for p in std.circle_points(12, 233.5, 'y', start=15):
        outer = outer.cut(cyl_y(std.HOLE[12] / 2 - 1.0, oy0 - 1, oy0 + 25, x=p[0], z=p[2]))
    m.place(sl, mk(m, 'TB-GR-SLW', 'Slewing ring, outer ring with gear m4 x 132 (turns)', outer, 'steel', 'drive',
                   'ISO 76 rated, catalogue part', 'D 416 / 536 x 78', 'teeth induction hardened',
                   'Turns with the slew. The slew pinion drives its teeth.', {'gear': 'm4, 132 teeth, pitch diameter 528 mm'}, 'buy',
                   mass_override=22.0), Location(), (0, -60, 0), 'SLEW')
    balls = cyl_y(ori, 2982, 3002, ri=ro)
    it = m.place(sl, mk(m, 'TB-SRB', 'Slewing ring ball set and spacers', balls, 'bearing', 'drive', 'catalogue part', 'raceway D 411',
                        '', 'Carries the slew\'s weight and its overturning moment between the 2 rings.', {}, 'buy', mass_override=1.5),
                 Location(), (0, -60, 0), 'SLEW')
    it.sealed = True
    # the slew plate: a disc under the outer ring with an arm toward -z for the vertical chain's fixed end
    ps = cyl_y(280, SLW_Y[0], SLW_Y[1]).union(bx(-80, 80, SLW_Y[0], SLW_Y[1], -455, -200)).cut(cyl_y(60, SLW_Y[0] - 1, SLW_Y[1] + 1))
    for p in std.circle_points(12, 233.5, 'y', start=15):
        ps = ps.cut(cyl_y(std.HOLE[12] / 2, SLW_Y[0] - 1, SLW_Y[1] + 1, x=p[0], z=p[2])).cut(cyl_y(10, SLW_Y[0] - 1, SLW_Y[0] + 13, x=p[0], z=p[2]))
    for (x, z) in _gf_screws() + [(dx, z) for dx in (-45, 45) for z in ZC_HANG_Z]:
        ps = ps.cut(cyl_y(4.25, SLW_Y[0] - 1, SLW_Y[0] + 20, x=x, z=z))
    m.place(sl, mk(m, 'TB-SLP', 'Slew plate, steel 25 mm', ps, 'steel_yellow', 'structure', 'flame-cut and machined plate', 'D 560 x 25',
                   'S355', 'Hangs the guide frame and the vertical chain\'s fixed end from the slewing ring\'s outer ring.', {}),
            Location(), (0, -100, 0), 'SLEW')
    so = std.shcs(12, 35, '10.9', 'Fastens the slew plate up to the slewing ring\'s outer ring, from under the plate.')
    for p in std.circle_points(12, 233.5, 'y', start=15):
        m.place(sl, so, std.orient((p[0], SLW_Y[0] + 13, p[2]), (0, 1, 0)), (0, -140, 0), 'SLEW')
    rot = cyl_y(55, SLW_Y[1], SLW_Y[1] + 5).union(cyl_y(50, SLW_Y[1] + 5, 2975)).cut(cyl_y(20, SLW_Y[1] - 1, 2976))
    m.place(sl, mk(m, 'TB-SRR', 'Slip ring with fibre rotary joint, rotor', rot, 'al6061_blk', 'electrical', 'catalogue part', 'D 110 x 22',
                   'IP65', 'Turns with the slew. Its lines leave it down through the slew plate.', {}, 'buy', mass_override=0.8),
            Location(), (0, 60, 0), 'SLEW')


def _gf_screws() -> list:
    """The guide frame's top flange screws (slew frame x, z): 3 in each flange."""
    return [(sx * 168, z) for sx in (1, -1) for z in (-35, 20, 75)]


def _guide(m: Model, sl: Node, zn: Node, side: str, T: dict) -> None:
    """The guide frame under the slew plate: its front and back plates carry the Z-beam's 4 blocks, its side plate joins
    them, the Z drive stands inside it and the head's drive box on its back."""
    y0, y1 = GF_Y
    gf = (bx(-GF_X[1], -GF_X[0], y0, y1, -60, GF_ZS[1]).union(bx(GF_X[0], GF_X[1], y0, y1, -60, GF_ZS[1]))
          .union(bx(-GF_X[0], GF_X[0], y0, y1, GF_ZS[0], GF_ZS[1]))
          .union(bx(-200, -GF_X[0], y1, SLW_Y[0], -60, 100)).union(bx(GF_X[0], 200, y1, SLW_Y[0], -60, 100)))
    for (x, z) in _gf_screws():
        gf = gf.cut(cyl_y(std.HOLE[10] / 2, y1 - 1, SLW_Y[0] + 1, x=x, z=z))
    zl = T['zaxis']
    w25, h25, bw25, bh25, bl25, p25, sc25 = std.RAIL[25]
    blocks = [(sx, y) for sx in (1, -1) for y in (zl['guideY'][0] * M, zl['guideY'][1] * M)]
    for (sx, y) in blocks:
        for (dz, dy) in ((bw25 * 0.36, bl25 * 0.26), (-bw25 * 0.36, bl25 * 0.26), (bw25 * 0.36, -bl25 * 0.26), (-bw25 * 0.36, -bl25 * 0.26)):
            gf = gf.cut(cyl_x(std.HOLE[6] / 2, -GF_X[1] - 1, -GF_X[0] + 1, y=y + dy, z=dz) if sx < 0 else
                        cyl_x(std.HOLE[6] / 2, GF_X[0] - 1, GF_X[1] + 1, y=y + dy, z=dz))
    for (dy, dz) in ((30, 30), (30, -30), (-30, 30), (-30, -30)):          # the Z gearbox's screws through the back plate
        gf = gf.cut(cyl_x(std.HOLE[8] / 2, GF_X[0] - 1, GF_X[1] + 1, y=Z_PIN_Y + dy, z=137 + dz))
    for (dy, dz) in ((-300, -100), (-300, 100), (300, -100), (300, 100)):  # the drive box's screws through the back plate
        gf = gf.cut(cyl_x(std.HOLE[8] / 2, GF_X[0] - 1, GF_X[1] + 1, y=(BOX[2] + BOX[3]) / 2 + dy, z=dz))
    m.place(sl, mk(m, 'TB-GDF', 'Guide frame, welded steel', gf, 'steel_yellow', 'structure', 'welded plate 20 mm',
                   f'272 x {y1 - y0 + 20:.0f} x 270', 'S355, stress relieved, block faces machined',
                   'Hangs under the slew plate and holds the Z-beam\'s 4 blocks. The Z drive is inside it.', {}),
            Location(), (0, -300, 0), 'ZAXIS')
    fs = std.shcs(10, 30, '10.9', 'Fastens the guide frame\'s top flange up to the slew plate.')
    for (x, z) in _gf_screws():
        m.place(sl, fs, std.orient((x, y1, z), (0, 1, 0)), (0, -340, 0), 'ZAXIS')
    blk = std.rail_block(25)
    bsc = std.shcs(6, 30, '12.9', 'Fastens a Z block to the guide frame, through the plate.')
    for (sx, y) in blocks:
        # the block's top face on the plate's inner face: local +Y (its top) toward the plate, its length along y
        at = frame_loc((sx * (ZB_W), y, 0), (0, 0, sx), (sx, 0, 0))
        m.place(sl, blk, at, (sx * 60, 0, 0), 'ZAXIS')
        for (dz, dy) in ((bw25 * 0.36, bl25 * 0.26), (-bw25 * 0.36, bl25 * 0.26), (bw25 * 0.36, -bl25 * 0.26), (-bw25 * 0.36, -bl25 * 0.26)):
            m.place(sl, bsc, std.orient((sx * GF_X[1], y + dy, dz), (-sx, 0, 0)), (sx * 120, 0, 0), 'ZAXIS')
    # ── the Z drive: a right-angle gearbox screwed to the back plate, its shaft along -x to the pinion; the motor on top
    gb = (bx(22, GF_X[0], Z_PIN_Y - 45, Z_PIN_Y + 45, 92, 182)
          .cut(cyl_y(10, Z_PIN_Y + 5, Z_PIN_Y + 46, x=68, z=137)).cut(cyl_y(24.5, Z_PIN_Y + 41.5, Z_PIN_Y + 46, x=68, z=137)))
    for (dy, dz) in ((30, 30), (30, -30), (-30, 30), (-30, -30)):
        gb = gb.cut(cyl_x(4, GF_X[0] - 16, GF_X[0] + 1, y=Z_PIN_Y + dy, z=137 + dz))
    m.place(sl, gearbox(m, 'TB-ZGR', 'Z gearbox, right angle, 20:1', gb, 20, 'Turns the Z motor\'s drive to the pinion on the Z-beam\'s rack.',
                        9.0), Location(), (60, 0, 80), 'ZAXIS')
    m.place(sl, mk(m, 'TB-ZGS', 'Z gearbox output shaft', cyl_x(12.5, -21, 22, y=Z_PIN_Y, z=137), 'steel', 'drive', 'machined', 'D 25',
                   '42CrMo4', 'Carries the Z pinion.', {}), Location(), (30, 0, 80), 'ZAXIS')
    m.place(sl, pinion(m, 'TB-PIN-Z', 3, 20, 30, 25, 'x', 'Drives the Z-beam up and down its rack.'), loc(0, Z_PIN_Y, 137), (0, 0, 120), 'ZAXIS')
    m.place(sl, servo_motor(m, 'TB-ZMT', 80, 150, 1.0, 'Drives the Z-beam. Its brake holds the head when the power is off. The drive '
                            'tests the brake every shift.', brake=True, conn=False), loc(68, Z_PIN_Y + 45, 137, rx=180), (60, 200, 80), 'ZAXIS')
    zs = std.shcs(8, 30, '12.9', 'Fastens the Z gearbox to the guide frame\'s back plate.')
    for (dy, dz) in ((30, 30), (30, -30), (-30, 30), (-30, -30)):
        m.place(sl, zs, std.orient((GF_X[1], Z_PIN_Y + dy, 137 + dz), (-1, 0, 0)), (120, 0, 80), 'ZAXIS')
    z6 = std.shcs(6, 16, '10.9', 'Fastens the Z motor to its gearbox.')
    for (dx, dz) in ((32, 32), (32, -32), (-32, 32), (-32, -32)):
        m.place(sl, z6, std.orient((68 + dx, Z_PIN_Y + 57, 137 + dz), (0, -1, 0)), (60, 240, 80), 'ZAXIS')


def _zbeam(m: Model, sl: Node, zn: Node, side: str, T: dict) -> None:
    """The Z-beam (Z frame: origin on the axis at its foot, the beam up to ZB_L), its rails and rack, its foot, the
    vertical chain from the guide frame to it, and the head's drive box with its 2 ducts."""
    w25, h25, bw25, bh25, bl25, p25, sc25 = std.RAIL[25]
    beam = bx(-ZB_W, ZB_W, 0, ZB_L, -ZB_W, ZB_W).cut(bx(-ZB_W + 15, ZB_W - 15, -1, ZB_L + 1, -ZB_W + 8, ZB_W - 8))
    beam = beam.cut(bx(-30, 30, ZB_L - 140, ZB_L - 60, -ZB_W - 1, -ZB_W + 9))      # the chain's lines go in here
    m.place(zn, mk(m, 'TB-ZBM', 'Z-beam, steel box 160 x 160', beam, 'steel_yellow', 'structure',
                   'welded box: 2 machined flats 15 mm, 2 sides 8 mm', f'160 x 160 x {ZB_L:.0f}', 'S355, rail faces ground',
                   'Slides down out of the guide frame and carries the tilt and the head at its foot. The head\'s lines run '
                   'down inside it.', {}), Location(), (0, 0, 0), 'ZAXIS')
    rl = ZB_L - 40
    rail = std.rail(25, rl)
    n25 = int(rl // p25)
    rs = std.shcs(sc25, 20, '12.9', 'Fastens a Z rail to the Z-beam.')
    for sx in (1, -1):
        m.place(zn, rail, frame_loc((sx * ZB_W, ZB_L / 2, 0), (0, 0, sx), (sx, 0, 0)), (sx * 40, 0, 0), 'ZAXIS')
        for i in range(n25):
            yy = ZB_L / 2 - rl / 2 + (rl - (n25 - 1) * p25) / 2 + i * p25
            m.place(zn, rs, std.orient((sx * (ZB_W + h25 * 0.55), yy, 0), (-sx, 0, 0)), (sx * 80, 0, 0), 'ZAXIS')
    rk = rack_bar(m, 'TB-GR-Z', 3, ZB_L - 100, 30, 40, 'The Z pinion rolls along it.')
    m.place(zn, rk, frame_loc((0, 50, ZB_W), (0, 0, 1), (1, 0, 0)), (0, 0, 60), 'ZAXIS')
    rks = std.shcs(6, 16, '10.9', 'Fastens the Z rack to the beam, from inside the beam.')
    for k in range(int((ZB_L - 100) // 100)):
        m.place(zn, rks, std.orient((0, 100 + k * 100, ZB_W - 8), (0, 0, 1)), (0, 0, 40), 'ZAXIS')
    cap = bx(-ZB_W, ZB_W, ZB_L, ZB_L + 10, -ZB_W, ZB_W)
    for (x, z) in ((72.5, 40), (72.5, -40), (-72.5, 40), (-72.5, -40)):
        cap = cap.cut(cyl_y(std.HOLE[8] / 2, ZB_L - 1, ZB_L + 11, x=x, z=z))
    m.place(zn, mk(m, 'TB-ZCP', 'Z-beam top cap', cap, 'steel_yellow', 'structure', 'cut plate', '160 x 160 x 10', 'S355',
                   'Closes the Z-beam\'s top.', {}), Location(), (0, 60, 0), 'ZAXIS')
    for (x, z) in ((72.5, 40), (72.5, -40), (-72.5, 40), (-72.5, -40)):
        m.place(zn, std.shcs(8, 25, '10.9', 'Fastens the top cap to the Z-beam.'), std.orient((x, ZB_L + 10, z), (0, -1, 0)), (0, 80, 0), 'ZAXIS')
    foot = bx(-100, 100, -20, 0, -175, 200)
    for (x, z) in ((72.5, 50), (72.5, -50), (-72.5, 50), (-72.5, -50)):
        foot = foot.cut(cyl_y(std.HOLE[10] / 2, -21, 1, x=x, z=z)).cut(cyl_y(8.5, -21, -10, x=x, z=z))
    foot = foot.cut(bx(-30, 30, -21, 1, -170, -110))         # the lines go down through it to the head
    m.place(zn, mk(m, 'TB-ZFT', 'Z-beam foot plate', foot, 'steel_yellow', 'structure', 'machined plate', '200 x 375 x 20', 'S355',
                   'Closes the Z-beam\'s foot. The tilt actuator\'s hanger is welded under it.', {}), Location(), (0, -40, 0), 'ZAXIS')
    for (x, z) in ((72.5, 50), (72.5, -50), (-72.5, 50), (-72.5, -50)):
        m.place(zn, std.shcs(10, 35, '10.9', 'Fastens the foot plate up to the Z-beam\'s walls.'), std.orient((x, -10, z), (0, 1, 0)),
                (0, -60, 0), 'ZAXIS')
    # ── the vertical chain: fixed end on a hanger from the slew plate's arm, the moving end on the beam's -z face ───────
    LZ = ZCHAIN_LINES
    fill = std.chain_fill([d for (_, _, d) in LZ], [])
    ZC = std.chain_size('light', fill, max(d for (_, _, d) in LZ), ZC_R)
    link = std.chain_link(ZC['ba'], ZC['ha'], ZC['pitch'], inside=(ZC['bi'], ZC['hi']))
    zc_fixed = ZC_ZM - 2 * ZC_R
    s_max = ZC_A - (ZB_FOOT0 + ZB_L - 80)
    n_links = math.ceil((s_max + math.pi * ZC_R + 20) / ZC['pitch'])
    w0 = -ZC['bi'] / 2
    contents = []
    for (lid, name, d) in LZ:
        slot = d + max(0.1 * d, 1.0)
        contents.append({'id': lid, 'name': name, 'd': d, 'v': 0.0, 'w': w0 + slot / 2, 'mat': 'cable', 'category': 'electrical'})
        w0 += slot
    hz = (zc_fixed - ZC['ha'] / 2 - 25, zc_fixed - ZC['ha'] / 2 - 5)   # the hanger plate (z), outboard of the fixed run
    hg = (bx(-70, 70, ZC_A - 40, SLW_Y[0] - 20, hz[0], hz[1]).union(bx(-70, 70, SLW_Y[0] - 20, SLW_Y[0], hz[0], zc_fixed + 25)))
    for dx in (-45, 45):
        for z in ZC_HANG_Z:
            if hz[0] <= z <= zc_fixed + 25:
                hg = hg.cut(cyl_y(std.HOLE[8] / 2, SLW_Y[0] - 21, SLW_Y[0] + 1, x=dx, z=z))
    m.place(sl, mk(m, 'TB-ZCH', 'Vertical chain hanger, welded steel', hg, 'steel_yellow', 'structure', 'welded plate 20 mm', '140 x 150',
                   'S355', 'Hangs the vertical chain\'s fixed end from the slew plate\'s arm.', {}), Location(), (0, 0, -100), 'ZAXIS')
    for dx in (-45, 45):
        for z in ZC_HANG_Z:
            if hz[0] <= z <= zc_fixed + 25:
                m.place(sl, std.shcs(8, 30, '10.9', 'Fastens the chain hanger up to the slew plate\'s arm.'),
                        std.orient((dx, SLW_Y[0] - 20, z), (0, 1, 0)), (0, -60, -100), 'ZAXIS')
    eb = bx(-ZC['ba'] / 2, ZC['ba'] / 2, ZC_A, ZC_A + 12, zc_fixed - ZC['ha'] / 2 - 5, zc_fixed + ZC['ha'] / 2)
    m.place(sl, mk(m, 'TB-ZCE', 'Vertical chain end bracket, fixed', eb, 'steel', 'structure', 'bent plate', f'{ZC["ba"]:g} x 12', 'S235',
                   'Holds the vertical chain\'s fixed end to its hanger.', {}), Location(), (0, 40, -100), 'ZAXIS')
    y_b = ZB_L - 80                                         # the moving end: 80 mm under the beam's top (Z frame)
    em = bx(-ZC['ba'] / 2, ZC['ba'] / 2, y_b, y_b + 12, ZC_ZM - ZC['ha'] / 2, -ZB_W)
    m.place(zn, mk(m, 'TB-ZCM', 'Vertical chain end bracket, moving', em, 'steel', 'structure', 'bent plate', f'{ZC["ba"]:g} x 12', 'S235',
                   'Joins the vertical chain\'s moving end to the Z-beam. Its lines go into the beam beside it.', {}),
            Location(), (0, 40, -60), 'ZAXIS')
    m.flex(FlexDef(f'TB-ZCN{side}', f'Cable chain, inside {ZC["bi"]:g} x {ZC["hi"]:g}, R {ZC_R:g}', 'chain',
                   Anchor(sl, (0, ZC_A, zc_fixed), (0, -1, 0)), Anchor(zn, (0, y_b, ZC_ZM), (0, -1, 0)),
                   ZC['ha'] / 2, 'ZAXIS', 'Carries the head\'s lines from the guide frame to the Z-beam as it slides. It hangs in a loop.',
                   mat='pa66', category='electrical', pitch=ZC['pitch'], bend_r=ZC_R, links=n_links, up=(0, 0, 1), w=ZC['ba'], h=ZC['ha'],
                   link_part=link, kg_per_m=1.4, contents=contents, wi=ZC['bi'], hi=ZC['hi'], lead_a=12.0, lead_b=12.0,
                   spec={'carries': ', '.join(f'{n} ({d:g} mm)' for (_, n, d) in LZ),
                         'fill': f'{fill:.1f} of its {ZC["bi"]:g} mm inside width'}))
    # ── the head's drive box on the guide frame's back plate, and its 2 ducts ─────────────────────────────────────────
    x0, x1, y0, y1, z0, z1 = BOX
    box = bx(x0, x1, y0, y1, z0, z1).edges('|X').fillet(8)
    m.place(sl, mk(m, 'TB-HDB', 'Head drive box, steel, IP54', box, 'steel_paint', 'electrical', 'EN 62208',
                   f'{x1 - x0:.0f} x {y1 - y0:.0f} x {z1 - z0:.0f}', 'IP54, filtered fan',
                   'Holds the 5 nutrunner drives, the DC supply for the head\'s and the Z drive\'s servo motors, and the head\'s safety '
                   'and EtherCAT modules. It turns with the slew, so only 4 lines cross the slip ring.',
                   {'contents': '5 nutrunner drive modules, a 600 V DC bus supply, a safety I/O module (FSoE), an EtherCAT coupler, '
                                'a 5-port vision switch with a fibre port', 'class size': 'ASSUMPTION'}, 'buy', mass_override=38.0),
            Location(), (200, 0, 0), 'HEADDRV')
    for (dy, dz) in ((-300, -100), (-300, 100), (300, -100), (300, 100)):
        m.place(sl, std.shcs(8, 30, '10.9', 'Fastens the head drive box to the guide frame\'s back plate.'),
                std.orient((GF_X[0], (y0 + y1) / 2 + dy, dz), (1, 0, 0)), (160, 0, 0), 'HEADDRV')
    # duct 1: from the slip ring's rotor down through the slew plate, out to z -100 and back over the box's top
    d1 = (bx(-25, 25, y1, SLW_Y[0], -25, 25).union(bx(-25, 25, y1, y1 + 25, -130, 25)).union(bx(-25, 300, y1, y1 + 25, -130, -70)))
    d1 = d1.cut(bx(-21, 21, y1 + 4, SLW_Y[0] + 1, -21, 21)).cut(bx(-21, 21, y1 + 4, y1 + 21, -126, 21)).cut(bx(-21, 296, y1 + 4, y1 + 21, -126, -74))
    m.place(sl, mk(m, 'TB-HD1', 'Cable duct, slip ring to the head drive box, 50 x 25', d1, 'steel_paint', 'electrical', 'folded sheet 2 mm',
                   '50 x 25', 'S235, painted', 'Carries the 4 lines from the slip ring\'s rotor to the head drive box.', {}),
            Location(), (100, 120, 0), 'HEADDRV')
    # duct 2: from the box's -z face, out to the chain's fixed run and down into its end bracket
    zf = zc_fixed
    d2 = (bx(150, 250, y1 - 45, y1 - 5, zf - 20, z0).union(bx(-30, 250, y1 - 45, y1 - 5, zf - 20, zf + 20))
          .union(bx(-30, 30, ZC_A + 12, y1 - 5, zf - 20, zf + 20)))
    d2 = d2.cut(bx(154, 246, y1 - 41, y1 - 9, zf - 16, z0 + 1)).cut(bx(-26, 246, y1 - 41, y1 - 9, zf - 16, zf + 16)).cut(
        bx(-26, 26, ZC_A + 11, y1 - 9, zf - 16, zf + 16))
    m.place(sl, mk(m, 'TB-HD2', 'Cable duct, head drive box to the vertical chain, 100 x 40', d2, 'steel_paint', 'electrical',
                   'folded sheet 2 mm', '100 x 40', 'S235, painted', 'Carries the head\'s 8 lines from the drive box to the vertical chain.', {}),
            Location(), (100, 120, -120), 'HEADDRV')


# The head's lines, from the head drive box down the vertical chain and the Z-beam to the head (id, name, outside mm).
# ASSUMPTION (class sizes, set from the makers' sheets when the parts are chosen): a nutrunner's tool cable 12 mm, the
# hybrid servo bus (DC power, EtherCAT and safety) 16 mm, a chain-rated Cat 6A camera cable 8.5 mm.
ZCHAIN_LINES = [(f'NR{k}', f'Nutrunner {k} tool cable', 12.0) for k in range(1, 6)] + \
    [('HBUS', 'Head servo bus, hybrid', 16.0), ('CAM3', '3D camera cable, Cat 6A', 8.5), ('CAMA', 'Axis camera cable, Cat 6A', 8.5)]


# ══════════════════════════════════════════════════════════════════════════════ TILT + HEAD ═══
# The head's frame (HEAD in the spec): origin on the spindles' axis at the housing's front face, +x forward (toward the
# wheel), +y up, +z to the right. The tilt axis stands at (tiltX, tiltY) in it, on the slew axis.
HS = 185.0                       # the housing's half height and half width (it is 370 x 370)
HB = -420.0                      # the housing's back face
HF = 30.0                        # its front plate's thickness (x -30 .. 0)
CL_BORE = 165.0                  # the cluster bearing's outside radius, in the front plate
CL_R = 145.0                     # the cluster's front disc
SP_RM = 115.0                    # each spindle motor's axis from the head's axis (at the smallest pitch circle)
SP_RO = 50.0                     # each socket's axis from the head's axis at the smallest pitch circle (100 mm)
SP_BACK = -335.0                 # the spindle motors' rear ends: clear of the cluster drive's pinion
SP_OH = (-65.0, -25.0)           # each offset head, behind the cluster's front disc (x)
CUP_YZ = 140.0                   # the 4 suction cups at (+/-140, +/-140)
GRIP_RAIL_Z = 110.0
CLAMP_X = (77.0, 157.0)          # each clamp post (x, at grip 0); the roller starts at 160 (the face 180, less 20)
POST_Y = (-385.0, -286.0)
CLAMP_SCREW = (117.0, -325.0)    # the clamp screw's axis (x, y)


def build_head(m: Model, zn: Node, side: str, T: dict) -> None:
    H = T['head']
    ti = zn.child(f'Tilt{side}', loc(0, TILT_Y, 0), sub='TILT',
                  joint={'name': f'TB_TILT_{side}', 'axis': [0, 0, 1], 'limits': [-H['tilt'], H['tilt']], 'kind': 'revolute', 'stowed': 0.0})
    build_actuator(m, zn, ti, 40, loc(0, TILT_Y, 0), loc(0, 0, TILT_OUT_Z, rx=90), 'TB-TLT', 'TILT', gland_m=20, gland_ang=0.0)
    # the hanger: a boss welded under the foot plate, clamping the actuator's front drum
    boss = bx(-130, 130, -265, -20, 72, 112).cut(cyl_z(107, 71, 113, y=TILT_Y))
    for (dx, dy) in ((1, 0), (-1, 0), (0, -1)):
        x0 = 130 if dx else 0
        boss = boss.cut(cyl_x(std.HOLE[8] / 2, -131, 131, y=TILT_Y, z=106) if dx else cyl_y(std.HOLE[8] / 2, -266, TILT_Y, z=106))
    m.place(zn, mk(m, 'TB-TLH', 'Tilt actuator hanger, welded steel', boss, 'steel_yellow', 'structure', 'welded block, bored',
                   '260 x 245 x 40', 'S355', 'Hangs under the Z-beam\'s foot and clamps the tilt actuator\'s front drum.', {}),
            Location(), (0, -60, 60), 'TILT')
    hs = std.shcs(8, 30, '12.9', 'Clamps the tilt actuator\'s drum in its hanger.')
    m.place(zn, hs, std.orient((130, TILT_Y, 106), (-1, 0, 0)), (60, 0, 60), 'TILT')
    m.place(zn, hs, std.orient((-130, TILT_Y, 106), (1, 0, 0)), (-60, 0, 60), 'TILT')
    m.place(zn, std.shcs(8, 25, '12.9', 'Clamps the tilt actuator\'s drum in its hanger, from below.'),
            std.orient((0, -265, 106), (0, 1, 0)), (0, -60, 60), 'TILT')
    # the yoke: from the actuator's output flange down to the head's top, on the +z side
    yk = bx(-90, 90, -135, 80, TILT_OUT_Z, TILT_OUT_Z + 22).union(bx(-90, 90, -135, -115, 116, TILT_OUT_Z + 22))
    for p in out_flange_points(40):
        yk = yk.cut(cyl_z(std.HOLE[8] / 2, TILT_OUT_Z - 1, TILT_OUT_Z + 23, x=p[0], y=-p[2]))
    for (x, z) in YOKE_SCREWS:
        yk = yk.cut(cyl_y(std.HOLE[10] / 2, -136, -114, x=x, z=z))
    m.place(ti, mk(m, 'TB-YOK', 'Head yoke, welded steel', yk, 'steel_yellow', 'structure', 'welded plate 22 and 20 mm', '180 x 230 x 56',
                   'S355', 'Hangs the head from the tilt actuator\'s output flange. The actuator\'s cross-roller bearing carries it.', {}),
            Location(), (0, 0, 80), 'TILT')
    ys = std.shcs(8, 30, '12.9', 'Fastens the yoke to the tilt actuator\'s output flange.')
    for p in out_flange_points(40):
        m.place(ti, ys, std.orient((p[0], -p[2], TILT_OUT_Z + 22), (0, 0, -1)), (0, 0, 120), 'TILT')
    hd = ti.child(f'Head{side}', loc(H['tiltX'] * M, -H['tiltY'] * M, 0, ry=180), sub='HEAD')
    yh = std.shcs(10, 35, '10.9', 'Fastens the yoke\'s foot to the head\'s top.')
    for (x, z) in YOKE_SCREWS:      # tilt frame (x, z) -> head frame (-200 - x, -z)
        m.place(ti, yh, std.orient((x, -115, z), (0, -1, 0)), (0, 60, 80), 'TILT')
    _head_body(m, hd, side, H)
    _cluster(m, hd, side, H)
    _cover(m, hd, side, H)
    _grip(m, hd, side, H)


YOKE_SCREWS = [(x, 133.0) for x in (-70, -25, 25, 70)]


def _head_body(m: Model, hd: Node, side: str, H: dict) -> None:
    # the housing: a cast aluminium box, its front plate 30 thick with the cluster's bore and the 4 cup bores
    hsg = bx(HB, 0, -HS, HS, -HS, HS).cut(bx(HB + 15, -HF, -HS + 8, HS - 15, -HS + 8, HS - 8))
    hsg = hsg.cut(cyl_x(CL_BORE, -HF - 1, 1))
    for sy in (1, -1):
        for sz in (1, -1):
            hsg = hsg.cut(cyl_x(26, -HF - 1, 1, y=sy * CUP_YZ, z=sz * CUP_YZ))          # the cup's pocket
    hsg = hsg.cut(cyl_x(21, HB - 1, HB + 16))                                           # the cluster's rear bearing
    hsg = hsg.cut(cyl_x(21, HB - 1, HB + 16, y=A_MOT[0], z=A_MOT[1]))                    # the A motor's pinion shaft
    for (x, z) in YOKE_SCREWS:
        hsg = hsg.cut(cyl_y(4.25, HS - 15, HS + 1, x=-200 - x, z=-z))
    hsg = hsg.cut(bx(-380, -310, HS - 16, HS + 1, 60, 150))                              # the lines' way in, under the junction box
    m.place(hd, mk(m, 'TB-HSG', 'Head housing, cast aluminium', hsg, 'a356_dark', 'structure', 'sand casting, machined',
                   '420 x 370 x 370', 'A356-T6, bores to H7', 'Carries the spindle cluster on its bearings, the cover cups, the grip '
                   'carriage\'s rails and the cameras.', {'IP rating': 'IP54 (the front is open round the sockets)'}),
            Location(), (0, 0, 0), 'HEAD')
    # the cluster's front bearing: a thin-section 4-point bearing, 290 x 330 x 20, in the front plate's bore
    m.place(hd, mk(m, 'TB-CLB', 'Cluster bearing, thin section, 290 x 330 x 20', cyl_x(CL_BORE, -25, -5, ri=CL_R), 'bearing', 'drive',
                   'catalogue part (thin-section 4-point contact)', '290 x 330 x 20', 'preloaded', 'Carries the spindle cluster at the front '
                   'and takes the tightening reaction.', {}, 'buy', mass_override=2.4), Location(), (60, 0, 0), 'NUTS')
    # the 3D camera on top of the housing's front, the axis camera inside the cluster, the light ring round the bore
    cam = bx(-90, -20, HS, HS + 50, -60, 60).edges('|X').fillet(6)
    m.place(hd, mk(m, 'TB-C3D', '3D camera, structured light, IP67', cam, 'al6061_blk', 'sensor', 'catalogue part', '70 x 50 x 120', 'IP67',
                   'Finds the wheel, its centre, its nuts and the cover, and measures how deep the nuts sit, before the head moves in.',
                   {'range': '0.2 to 1.0 m (class)', 'class size': 'ASSUMPTION'}, 'buy', mass_override=0.9), Location(), (0, 80, 0), 'VISION')
    for (dx, dz) in ((-75, -45), (-75, 45), (-35, -45), (-35, 45)):
        m.place(hd, std.shcs(5, 12, 'A2-70', 'Fastens the 3D camera to the housing\'s top.'), std.orient((dx, HS + 50, dz), (0, -1, 0)),
                (0, 120, 0), 'VISION')
    ring = cyl_x(171, 0, 6, ri=166)
    m.place(hd, mk(m, 'TB-LED', 'Light ring, white LED, IP67', ring, 'led', 'sensor', 'catalogue part', 'D 342 x 6', 'IP67',
                   'Lights the wheel and its nuts for the 2 cameras, under the wheel arch.', {}, 'buy', mass_override=0.3),
            Location(), (40, 0, 0), 'VISION')
    # the head's junction box on the housing's +z side, at the back: the lines from the Z-beam come in at its top
    jb = bx(-410, -300, 40, HS - 5, HS, HS + 60).edges('|Z').fillet(5)
    m.place(hd, mk(m, 'TB-HJB', 'Head junction box, IP67', jb, 'al6061', 'electrical', 'EN 62208', '110 x 140 x 60', 'IP67',
                   'Splits the head\'s servo bus to its 6 small drives and holds the vacuum pump and its valve.',
                   {'contents': 'a bus splitter, the electric vacuum pump (12 L/min class), a vacuum switch, 4 cup valves'}, 'buy',
                   mass_override=1.6), Location(), (0, 0, 80), 'HEAD')
    for (dx, dy) in ((-395, 55), (-395, 165), (-315, 55), (-315, 165)):
        m.place(hd, std.shcs(5, 12, 'A2-70', 'Fastens the head junction box to the housing.'), std.orient((dx, dy, HS + 60), (0, 0, -1)),
                (0, 0, 110), 'HEAD')


A_MOT = (-58.0, -58.0)           # the cluster drive's pinion (y, z): on the back wall, in mesh with the cluster's ring gear


def _cluster(m: Model, hd: Node, side: str, H: dict) -> None:
    cl = hd.child(f'Cluster{side}', Location(), sub='NUTS',
                  joint={'name': f'TB_ACLU_{side}', 'axis': [1, 0, 0], 'limits': [-H['aRange'], H['aRange']], 'kind': 'revolute', 'stowed': 0.0})
    disc = cyl_x(CL_R, -25, -5).cut(cyl_x(16, -26, -4))
    for k in range(5):
        slot = bx(-26, -4, SP_RO - 14, SP_RO + 30, -13, 13)          # in the unit frame: the output shaft's radial slot
        disc = disc.cut(slot.rotate((0, 0, 0), (1, 0, 0), 72 * k))
    tube = cyl_x(26, SP_OH[0] - 1, -25).union(cyl_x(40, -345, SP_OH[0] - 1)).cut(cyl_x(16, -346, -24))   # thin between the offset heads' inner ends
    back = cyl_x(62, -360, -345).union(zigzag_ring(59.5, 64, 62, 15, 'x').translate((-352.5, 0, 0))).union(cyl_x(20, HB + 1, -360))
    m.place(cl, mk(m, 'TB-CLD', 'Spindle cluster, front disc', disc, 'al6061', 'structure', 'machined plate', 'D 290 x 20', '6061-T6',
                   'Carries the 5 spindles on their radial slides and turns them to the nut pattern.', {}), Location(), (40, 0, 0), 'NUTS')
    m.place(cl, mk(m, 'TB-CLT', 'Spindle cluster, centre tube', tube, 'al6061', 'structure', 'turned tube', 'D 80 x 320', '6061-T6',
                   'Joins the cluster\'s front disc to its rear gear. The axis camera\'s cable runs back through it.', {}), Location(), (0, 0, 0), 'NUTS')
    it = m.place(cl, mk(m, 'TB-GR-CLU', 'Spindle cluster, rear gear m2 x 62 with its shaft', back, 'steel', 'drive', 'machined, hobbed',
                        'm2, 62 teeth, D 132', 'case hardened', 'Takes the cluster drive\'s pinion. Its shaft runs in the rear bearing.', {}),
                 Location(), (-40, 0, 0), 'NUTS')
    it.sealed = True
    it = m.place(hd, mk(m, 'TB-CRB', 'Cluster rear bearing 6004', cyl_x(21, HB + 1, HB + 13, ri=20), 'bearing', 'drive', 'ISO 15', '20 x 42 x 12',
                        'C3', 'Carries the cluster\'s rear shaft in the housing\'s back wall.', {}, 'buy'), Location(), (-60, 0, 0), 'NUTS')
    it.sealed = True
    # the cluster drive: a motor on the housing's back, its pinion through the wall in mesh with the rear gear
    py, pz = A_MOT
    it = m.place(hd, pinion(m, 'TB-PIN-CLU', 2, 20, 15, 10, 'x', 'Turns the spindle cluster to the nut pattern.'), loc(-352.5, py, pz),
                 (-40, 0, 0), 'NUTS')
    it.sealed = True
    it = m.place(hd, mk(m, 'TB-CLS', 'Cluster drive shaft', cyl_x(5, HB + 18, -339, y=py, z=pz), 'steel', 'drive', 'machined', 'D 10',
                        '42CrMo4', 'Carries the cluster pinion from the motor\'s shaft.', {}), Location(), (-60, 0, 0), 'NUTS')
    it.sealed = True
    it = m.place(hd, mk(m, 'TB-CSB', 'Cluster drive bearing 6200', cyl_x(21, HB + 4, HB + 15, y=py, z=pz, ri=5), 'bearing', 'drive', 'ISO 15',
                        '10 x 42 x 12 (class)', 'C3', 'Carries the drive shaft in the housing\'s back wall.', {}, 'buy'), Location(), (-60, 0, 0), 'NUTS')
    it.sealed = True
    m.place(hd, servo_motor(m, 'TB-CLM', 40, 70, 0.1, 'Turns the spindle cluster, through a 50:1 gear in its body, to the nuts\' angle '
                            'that the cameras find.', conn=False), loc(HB, py, pz, rz=-90), (-80, 0, 0), 'NUTS')
    # the pitch-circle scroll: a ring behind the front disc whose groove moves the 5 spindles in and out together
    scr = cyl_x(80, -95, -77, ri=40)
    it = m.place(cl, mk(m, 'TB-PCS', 'Pitch circle scroll ring', scr, 'steel', 'drive', 'machined', 'D 170 x 18', '42CrMo4, nitrided',
                        'Turned by a small gearmotor on the disc, its spiral groove moves the 5 spindles\' follower pins out or in '
                        'together: the head sets the car\'s pitch circle, 100 to 130 mm.', {}), Location(), (40, 0, 0), 'NUTS')
    it.sealed = True
    sm = cyl_x(15, -105, -25, y=120 * math.cos(math.radians(108)), z=120 * math.sin(math.radians(108)))   # in the gap between spindles 2 and 3
    it = m.place(cl, mk(m, 'TB-SCM', 'Scroll gearmotor, 24 V, with encoder', sm, 'al6061_blk', 'drive', 'catalogue part', 'D 30 x 80', 'IP54',
                        'Turns the scroll ring to set the pitch circle.', {'class size': 'ASSUMPTION'}, 'buy', mass_override=0.4),
                 Location(), (-40, 0, 0), 'NUTS')
    it.sealed = True
    cam = cyl_x(20, -5, 25)
    m.place(cl, mk(m, 'TB-CAX', 'Axis camera with its lens, IP67', cam, 'al6061_blk', 'sensor', 'catalogue part', 'D 40 x 30', 'IP67',
                        'Looks out along the spindles\' axis between the sockets: it centres the head on the hub and checks each '
                        'nut is in its socket.', {'class size': 'ASSUMPTION'}, 'buy', mass_override=0.25), Location(), (40, 0, 0), 'VISION')
    win = cyl_x(18, 25, 27)
    m.place(cl, mk(m, 'TB-CAW', 'Axis camera window, sapphire', win, 'lens', 'sensor', 'catalogue part', 'D 36 x 2', '',
                   'Keeps grit off the axis camera\'s lens.', {}, 'buy'), Location(), (60, 0, 0), 'VISION')
    for k in range(5):
        a = 72 * k
        u = (0.0, math.cos(math.radians(a)), math.sin(math.radians(a)))
        pk = cl.child(f'Pcd{k + 1}{side}', Location(), sub='NUTS',
                      joint={'name': f'TB_PCD{k + 1}_{side}', 'axis': [0.0, u[1], u[2]], 'limits': [0.0, (H['pcdMax'] - H['pcdMin']) / 2],
                             'kind': 'prismatic', 'stowed': (0.1143 - H['pcdMin']) / 2})
        _spindle(m, pk, a, H)


def _spindle(m: Model, pk: Node, a_deg: float, H: dict) -> None:
    """One nutrunner spindle on its radial slide, built in the unit frame (radial +Y, the spindle's axis +X) and turned to
    its place: the socket's axis at SP_RO from the head's axis at the smallest pitch circle."""
    T = loc(0, 0, 0, rx=a_deg)
    sx = H['socketTip'] * M
    oh = bx(SP_OH[0], SP_OH[1], SP_RO - 22, SP_RM + 30, -22, 22).edges('|X').fillet(10)
    m.place(pk, mk(m, 'TB-SOH', 'Nutrunner offset head, 65 mm', oh, 'steel', 'drive', 'catalogue part', '40 x 159 x 44', 'gear case',
                   'Carries the spindle\'s drive 65 mm in to the socket, so 5 spindles fit a 100 mm pitch circle. It slides in a radial '
                   'dovetail on the back of the cluster\'s disc.', {'gear': '3 spur gears, 1:1', 'class size': 'ASSUMPTION'}, 'buy', mass_override=1.1),
            T, (30, 0, 0), 'NUTS')
    mot = cyl_x(28, SP_BACK, SP_OH[0], y=SP_RM)
    m.place(pk, mk(m, 'TB-SPM', 'Nutrunner spindle, 250 N m, with transducer', mot, 'al6061_blk', 'drive', 'catalogue part',
                   f'D 56 x {SP_OH[0] - SP_BACK:.0f}', 'IP54', 'Runs its nut off and on and tightens it to the car\'s torque. Its transducer reads torque and '
                   'angle for every nut, and the record goes to the car\'s service record.',
                   {'torque': '250 N m peak (175 N m tightening plus margin to break a nut free)', 'speed': '200 rpm free',
                    'follower pin': 'on its inner side, in the scroll ring\'s groove', 'class size': 'ASSUMPTION'}, 'buy',
                   mass_override=4.2), T, (-60, 0, 0), 'NUTS')
    ad = cyl_x(12, SP_OH[1], 45, y=SP_RO)
    m.place(pk, mk(m, 'TB-SKA', 'Socket extension, 1/2 in square, quick change', ad, 'steel', 'drive', 'catalogue part', '1/2 in x 70', '',
                   'Carries the socket out through the cluster\'s disc. Its ball lock lets go of a socket that the socket rack holds.', {}, 'buy'),
            T, (60, 0, 0), 'NUTS')
    hexf = H.get('hexMm', 21.0)
    sk = (cyl_x(15, 45, sx, y=SP_RO).cut(cq.Workplane('YZ', origin=(sx - 25, SP_RO, 0)).polygon(6, hexf / math.cos(math.pi / 6)).extrude(26))
          .cut(cyl_x(12, sx - 30, sx - 24, y=SP_RO)).cut(cyl_x(9, sx - 70, sx - 29, y=SP_RO)))     # the magnet's pocket, the stud's bore
    m.place(pk, mk(m, 'TB-SOK', 'Wheel nut socket 21 mm, deep, magnetic', sk, 'fast_blk', 'drive', 'DIN 3129 (deep impact socket)',
                   '21 mm hex, 1/2 in drive, 105 long', 'CrMo, impact rated',
                   'Drives its nut. A magnet ring at its bottom holds the nut (or the bolt) from the moment it leaves the stud until it '
                   'is back on and tight, so no nut is ever loose in the bay.', {'magnet': 'NdFeB ring, 40 N hold (class)'}, 'buy'),
            T, (90, 0, 0), 'NUTS')
    it = m.place(pk, mk(m, 'TB-SMG', 'Socket magnet ring', cyl_x(12, sx - 30, sx - 25, y=SP_RO, ri=9.5), 'magnet', 'drive', 'catalogue part',
                        'D 24 x 5', 'NdFeB, nickel plated', 'Holds the nut in the socket.', {}, 'buy'), T, (90, 0, 0), 'NUTS')
    it.sealed = True


def _cover(m: Model, hd: Node, side: str, H: dict) -> None:
    cv = hd.child(f'Cover{side}', Location(), sub='COVER',
                  joint={'name': f'TB_COVER_{side}', 'axis': [1, 0, 0], 'limits': [0.0, H['cover']], 'kind': 'prismatic', 'stowed': 0.0})
    stroke = H['cover'] * M
    rod = cyl_x(8, -35 - stroke - 20, -35, ri=4)
    cup = cyl_x(25, -35, -8).union(cyl_x(26, -8, 0, ri=18))
    cyl = cyl_x(17, HB + 15, -HF - 6, ri=8)
    for sy in (1, -1):
        for sz in (1, -1):
            y, z = sy * CUP_YZ, sz * CUP_YZ
            m.place(cv, mk(m, 'TB-CRD', 'Cover cup rod, stainless, hollow', rod, 'ss304', 'structure', 'ground tube', f'D 16 x {stroke + 55:.0f}',
                           '1.4301', 'Pushes its cup out past the sockets. The vacuum runs inside it.', {}), loc(0, y, z), (60, sy * 20, sz * 20), 'COVER')
            m.place(cv, mk(m, 'TB-CUP', 'Suction cup, 50 mm bellows, oil resistant', cup, 'rubber', 'structure', 'catalogue part', 'D 52',
                           'NBR 60 Shore A', 'Holds an aero cover by its face.', {}, 'buy'), loc(0, y, z), (90, sy * 20, sz * 20), 'COVER')
            it = m.place(hd, mk(m, 'TB-CYL', 'Electric cylinder, 300 mm stroke, 24 V', cyl, 'al6061', 'drive', 'catalogue part',
                                f'D 34 x {-HF - 6 - HB - 15:.0f}', 'IP54', 'Drives its cup rod out and in. The 4 run together.',
                                {'class size': 'ASSUMPTION'}, 'buy', mass_override=1.3), loc(0, y, z), (-40, 0, 0), 'COVER')
            it.sealed = True


def _grip(m: Model, hd: Node, side: str, H: dict) -> None:
    """The grip: a carriage on 2 rails under the housing (TB_GRIP slides it back), and on its front beam the 2 clamp posts
    (TB_CLAMPL, TB_CLAMPR: each one's distance from the head's axis), each with its powered roller."""
    w15, h15, bw15, bh15, bl15, p15, sc15 = std.RAIL[15]
    gr = hd.child(f'Grip{side}', Location(), sub='GRIP',
                  joint={'name': f'TB_GRIP_{side}', 'axis': [-1, 0, 0], 'limits': [0.0, H['grip']], 'kind': 'prismatic', 'stowed': 0.0})
    # ── the 2 rails under the housing's floor (their tops down), and the carriage's 4 blocks ─────────────────────────
    rl = 400.0
    under = lambda x, z: frame_loc((x, -HS, z), (0, 0, 1), (0, -1, 0))        # noqa: E731  a rail or block hung under the floor, along x
    n15 = int(rl // p15)
    for sz in (1, -1):
        m.place(hd, std.rail(15, rl), under(-210, sz * GRIP_RAIL_Z), (0, -40, 0), 'GRIP')
        for i in range(n15):
            xx = -210 - rl / 2 + (rl - (n15 - 1) * p15) / 2 + i * p15
            m.place(hd, std.shcs(sc15, 10, '12.9', 'Fastens a grip rail under the housing.'),
                    std.orient((xx, -HS - h15 * 0.55, sz * GRIP_RAIL_Z), (0, 1, 0)), (0, -60, 0), 'GRIP')
    blk = std.rail_block(15)
    for xb in (-150.0, -50.0):
        for sz in (1, -1):
            m.place(gr, blk, under(xb, sz * GRIP_RAIL_Z), (0, -60, 0), 'GRIP')
            for (dx, dz) in ((bl15 * 0.26, bw15 * 0.36), (-bl15 * 0.26, bw15 * 0.36), (bl15 * 0.26, -bw15 * 0.36), (-bl15 * 0.26, -bw15 * 0.36)):
                m.place(gr, std.shcs(4, 20, '12.9', 'Fastens the grip carriage to its block, from under the carriage.'),
                        std.orient((xb + dx, -224, sz * GRIP_RAIL_Z + dz), (0, 1, 0)), (0, -100, 0), 'GRIP')
    # ── the carriage: a plate on the 4 blocks, its front beam across the head (the clamp beam) and its 2 end plates ─────
    car = (bx(-220, 160, -224, -209, -140, 140).union(bx(80, 160, -250, -224, -425, 425))
           .union(bx(87, 147, -340, -250, 415, 425)).union(bx(87, 147, -340, -250, -425, -415))
           .union(bx(-170, -130, -224, -215, 140, 185)).union(bx(-160, -140, -224, -186, 150, 185)))
    car = car.cut(cyl_z(8, -426, 426, x=CLAMP_SCREW[0], y=CLAMP_SCREW[1])).cut(cyl_x(14, -161, -139, y=-200, z=165))
    car = car.cut(cyl_z(12.5, 421.5, 426, x=CLAMP_SCREW[0], y=CLAMP_SCREW[1]))                # the clamp motor's pilot
    for xb in (-150.0, -50.0):
        for sz in (1, -1):
            for (dx, dz) in ((bl15 * 0.26, bw15 * 0.36), (-bl15 * 0.26, bw15 * 0.36), (bl15 * 0.26, -bw15 * 0.36), (-bl15 * 0.26, -bw15 * 0.36)):
                car = car.cut(cyl_y(std.HOLE[4] / 2, -225, -208, x=xb + dx, z=sz * GRIP_RAIL_Z + dz))
    m.place(gr, mk(m, 'TB-GRC', 'Grip carriage, welded aluminium', car, 'al6061', 'structure', 'welded plate 15 and 26 mm',
                   '380 x 850 x 131', '6061-T6', 'Slides back under the housing to hold the wheel still while the sockets go on. Its front '
                   'beam carries the 2 clamp posts.', {}), Location(), (0, -80, 0), 'GRIP')
    # the grip slide's screw beside the carriage, its 2 bearing blocks under the floor, its motor behind the housing
    for (x0, x1) in ((-420, -405), (-45, -30)):
        bb = bx(x0, x1, -220, -HS, 150, 180).cut(cyl_x(8, x0 - 1, x1 + 1, y=-200, z=165))
        if x0 < -100:
            bb = bb.cut(cyl_x(12.5, x0 - 1, x0 + 3.5, y=-200, z=165))                         # the motor's pilot
        m.place(hd, mk(m, f'TB-GSB{"R" if x0 < -100 else "F"}', 'Grip screw bearing block', bb, 'al6061', 'drive', 'machined', '15 x 35 x 30',
                       '6061-T6', 'Carries the grip screw under the housing\'s floor.', {}), Location(), (0, -40, 60), 'GRIP')
    m.place(hd, mk(m, 'TB-GSS', 'Grip ball screw 16 x 5', cyl_x(8, -402, -30, y=-200, z=165), 'bearing', 'drive', 'ISO 3408', '16 x 5 x 372',
                   'C7', 'Moves the grip carriage along the head.', {}, 'buy'), Location(), (0, -60, 60), 'GRIP')
    m.place(gr, mk(m, 'TB-GSN', 'Grip ball nut with flange', cyl_x(14, -165, -135, y=-200, z=165, ri=8), 'steel', 'drive', 'ISO 3408', '16 x 5',
                   'C7', 'Joins the carriage to the grip screw.', {}, 'buy'), Location(), (0, -60, 80), 'GRIP')
    m.place(hd, servo_motor(m, 'TB-GSM', 40, 60, 0.1, 'Slides the grip carriage. It holds the wheel still while the head moves the '
                            'sockets onto the nuts.', brake=True, conn=False), loc(-420, -200, 165, rz=-90), (-60, -40, 60), 'GRIP')
    # ── the 2 clamp posts on rails under the clamp beam, the left/right-hand clamp screw between them, its motor ─────
    m.place(gr, mk(m, 'TB-CSS', 'Clamp ball screw 16 x 5, left and right hand', cyl_z(8, -415, 407, x=CLAMP_SCREW[0], y=CLAMP_SCREW[1]),
                   'bearing', 'drive', 'ISO 3408', '16 x 5 x 822', 'C7', 'Closes or opens both clamp posts together, the same distance '
                   'from the head\'s axis.', {}, 'buy'), Location(), (0, -100, 0), 'GRIP')
    m.place(gr, servo_motor(m, 'TB-CMT', 40, 60, 0.2, 'Closes the clamp posts. Its torque limit sets the grip force on the tyre.',
                            brake=True, conn=False), loc(CLAMP_SCREW[0], CLAMP_SCREW[1], 425, rx=-90), (0, -100, 120), 'GRIP')
    w25, h25, bw25, bh25, bl25, p25, sc25 = std.RAIL[25]
    beam_rail = frame_loc((CLAMP_SCREW[0], -250, 0), (-1, 0, 0), (0, -1, 0))   # the clamp rail hung under the clamp beam, along z
    n_cr = int(830 // p25)
    m.place(gr, std.rail(25, 830.0), beam_rail, (0, -120, 0), 'GRIP')
    for i in range(n_cr):
        zz = -415 + (830 - (n_cr - 1) * p25) / 2 + i * p25
        m.place(gr, std.shcs(sc25, 16, '12.9', 'Fastens the clamp rail under the clamp beam.'),
                std.orient((CLAMP_SCREW[0], -250 - h25 * 0.55, zz), (0, 1, 0)), (0, -140, 0), 'GRIP')
    blk25 = std.rail_block(25)
    bs25 = [(dx, dz) for dx in (-bw25 * 0.36, bw25 * 0.36) for dz in (-bl25 * 0.26, bl25 * 0.26)]
    for (tag, ax) in (('L', -1), ('R', 1)):
        cn = gr.child(f'Clamp{tag}{side}', Location(), sub='GRIP',
                      joint={'name': f'TB_CLAMP{tag}_{side}', 'axis': [0, 0, ax], 'limits': [H['clampMin'], H['clampMax']],
                             'kind': 'prismatic', 'stowed': H['clampMax']})
        post = bx(CLAMP_X[0], CLAMP_X[1], POST_Y[0], POST_Y[1], -35, 35).cut(bx(CLAMP_X[0] + 8, CLAMP_X[1] - 8, POST_Y[0] + 8, POST_Y[1] - 12, -27, 27))
        post = post.cut(cyl_z(9, -36, 36, x=CLAMP_SCREW[0], y=CLAMP_SCREW[1]))
        for (dx, dz) in bs25:
            post = post.cut(cyl_y(std.HOLE[6] / 2, POST_Y[1] - 13, POST_Y[1] + 1, x=CLAMP_SCREW[0] + dx, z=dz))
        m.place(cn, mk(m, 'TB-CPO', 'Clamp post, welded aluminium box', post, 'al6061', 'structure', 'welded box 8 mm', '80 x 99 x 70', '6061-T6',
                       'Hangs from its block and carries its roller. Its ball nut is inside it.', {}), Location(), (0, -60, 0), 'GRIP')
        m.place(cn, blk25, frame_loc((CLAMP_SCREW[0], -250, 0), (-1, 0, 0), (0, -1, 0)), (0, -40, 0), 'GRIP')
        for (dx, dz) in bs25:
            m.place(cn, std.shcs(6, 20, '12.9', 'Fastens a clamp post to its block, from inside the post.'),
                    std.orient((CLAMP_SCREW[0] + dx, POST_Y[1] - 12, dz), (0, 1, 0)), (0, -80, 0), 'GRIP')
        nut = cyl_z(14, -20, 20, x=CLAMP_SCREW[0], y=CLAMP_SCREW[1], ri=8).union(cyl_z(20, -27, -20, x=CLAMP_SCREW[0], y=CLAMP_SCREW[1], ri=8))
        it = m.place(cn, mk(m, 'TB-CSN', 'Clamp ball nut with flange', nut, 'steel', 'drive', 'ISO 3408', '16 x 5', 'C7',
                            'Joins the post to the clamp screw (left hand in one post, right hand in the other).', {}, 'buy'),
                     Location(), (0, -60, 0), 'GRIP')
        it.sealed = True
        rx0 = H['socketTip'] * M + H['faceAhead'] * M - H['rollerBack'] * M          # the roller's back end: the face, less 20
        rol = cyl_x(H['rollerR'] * M, rx0, rx0 + H['rollerL'] * M, y=H['rollerY'] * M).union(cyl_x(15, CLAMP_X[1], rx0, y=H['rollerY'] * M))
        m.place(cn, mk(m, 'TB-ROL', 'Clamp roller, polyurethane on steel, powered', rol, 'pu', 'structure', 'catalogue part',
                       f'D {2 * H["rollerR"] * 1000:.0f} x {H["rollerL"] * 1000:.0f}', '90 Shore A, steel core',
                       'Holds the tyre by its tread below its centre. Turned by its motor, it turns the wheel to the studs.', {}, 'buy'),
                Location(), (80, 0, 0), 'GRIP')
        it = m.place(cn, mk(m, 'TB-RGM', 'Roller gearmotor, 24 V, with brake', cyl_x(16, CLAMP_X[0] + 12, CLAMP_X[1] - 8, y=-358), 'al6061_blk',
                            'drive', 'catalogue part', 'D 32 x 60', 'IP54', 'Turns its roller through a gear pair. Its brake holds the wheel.',
                            {'class size': 'ASSUMPTION'}, 'buy', mass_override=0.6), Location(), (0, -40, 0), 'GRIP')
        it.sealed = True


# ═════════════════════════════════════════════════════════════════════════════════ RACKS ═══
# Each rack in its own frame: x is the distance out from the drive line (|X|), z along the bay from its centre. The east
# side's racks are the west's turned a half turn about their own vertical axis, so the NEW racks are at the entrance end on
# both sides (the portal carries both robots to one Z).


def build_racks(m: Model, bay: Node, T: dict) -> None:
    R = T['rack']
    k = 0
    for zc in list(R['newZ']) + list(R['oldZ']):
        for side, turn in (('W', 0), ('E', 180)):
            k += 1
            node = bay.child(f'Rack{side}{k}', loc(0, 0, zc * M, ry=turn), sub='RACKS')
            _cradle(m, node, R)
    S = T['socketRack']
    for side, turn in (('W', 0), ('E', 180)):
        node = bay.child(f'SocketRack{side}', loc(0, 0, S['z'] * M, ry=turn), sub='SOCKETS')
        _socket_rack(m, node, S, T['head'])


def _cradle(m: Model, node: Node, R: dict) -> None:
    """One cradle: a low welded frame anchored to the floor, 2 free rollers the tyre stands on, a back stop with 2 rubber
    bumpers, and a wheel sensor. Nothing at the head's rollers' and clamp posts' place (0.16 to 0.42 m from the cradle's
    middle) stands more than 20 mm off the floor."""
    x0, x1 = R['frameX0'] * M, R['frameX1'] * M
    bxk = R['backX'] * M
    fr = (bx(x0, x1, 0, 20, 130, 170).union(bx(x0, x1, 0, 20, -170, -130))
          .union(bx(x0, x0 + 40, 0, 20, -130, 130)).union(bx(3000, 3040, 0, 20, -130, 130))
          .union(bx(bxk + 60, bxk + 120, 0, 20, -230, 230)).union(bx(x1 - 40, x1, 0, 20, -130, 130)))
    anc = [(x0 + 20, 150), (x0 + 20, -150), (x1 - 20, 150), (x1 - 20, -150)]
    for (x, z) in anc:
        fr = fr.cut(cyl_y(std.HOLE[12] / 2, -1, 21, x=x, z=z))
    m.place(node, mk(m, 'TB-RKF', 'Wheel rack frame, welded steel tube', fr, 'steel_yellow', 'structure', 'welded tube 40 x 20 x 3',
                     f'{x1 - x0:.0f} x 460 x 20', 'S235, hot-dip galvanised', 'Holds a wheel\'s 2 rollers and its back stop on the '
                     'floor, 20 mm high where the head\'s rollers reach under the wheel.', {}), Location(), (0, -40, 0), 'RACKS')
    for (x, z) in anc:
        m.place(node, anchor_bolt(m, 12, 100), std.orient((x, 20, z), (0, -1, 0)), (0, 60, 0), 'RACKS')
    ya = R['tyreBottom'] * M - 40 + 4.7                    # the rollers' axis: a tyre's bottom stands tyreBottom up on them
    for zr in (60, -60):
        blk = bx(-12.5, 12.5, 20, ya + 22, -22, 22).cut(cyl_x(10, -13, 13, y=ya))
        bpd = mk(m, 'TB-RKB', 'Wheel rack roller bearing block', blk, 'steel', 'structure', 'catalogue part', '25 x 44 x 47',
                 'sealed ball bearing', 'Carries a rack roller\'s shaft.', {}, 'buy')
        for xb in (x0 + 27.5, 3012.5):
            m.place(node, bpd, loc(xb, 0, zr), (0, 40, 0), 'RACKS')
        rol = cyl_x(40, x0 + 40, 3000, y=ya).union(cyl_x(10, x0 + 15, 3025, y=ya))
        m.place(node, mk(m, 'TB-RKR', 'Wheel rack roller, polyurethane on steel', rol, 'pu', 'structure', 'catalogue part',
                         f'D 80 x {3000 - x0 - 40:.0f}', '90 Shore A', 'Carries the tyre. It turns freely, so a person can roll the '
                         'wheel round to read its tyre, and the head\'s rollers can turn it.', {}, 'buy'),
                loc(0, 0, zr), (0, 80, 0), 'RACKS')
    for zp in (200, -200):
        post = bx(bxk + 60, bxk + 120, 20, R['backTop'] * M, -30, 30).cut(bx(bxk + 64, bxk + 116, 20, R['backTop'] * M - 4, -26, 26))
        arm = bx(bxk, bxk + 60, R['backTop'] * M - 150, R['backTop'] * M - 50, -25, 25)
        m.place(node, mk(m, 'TB-RKP', 'Wheel rack back stop post with its arm', post.union(arm), 'steel_yellow', 'structure',
                         'welded tube 60 x 60 x 4', f'60 x 60 x {R["backTop"] * M - 20:.0f}', 'S235, hot-dip galvanised',
                         'Stands behind the wheel. Its arm carries a bumper the tyre leans on.', {}), loc(0, 0, zp), (40, 0, 0), 'RACKS')
        m.place(node, mk(m, 'TB-RKU', 'Back stop bumper, rubber', bx(bxk - 10, bxk, R['backTop'] * M - 145, R['backTop'] * M - 55, -22, 22),
                         'rubber', 'structure', 'catalogue part', '90 x 44 x 10', 'NBR 70 Shore A',
                         'Takes the tyre if the wheel leans back. It does not mark the tyre.', {}, 'buy'), loc(0, 0, zp), (60, 0, 0), 'RACKS')
    xb = bx(bxk + 60, bxk + 120, 370, 430, -170, 170)
    m.place(node, mk(m, 'TB-RKX', 'Back stop crossbar', xb, 'steel_yellow', 'structure', 'tube 60 x 60 x 4', '60 x 60 x 340', 'S235',
                     'Joins the 2 posts and carries the wheel sensor.', {}), Location(), (40, 0, 0), 'RACKS')
    sen = bx(bxk + 20, bxk + 60, 380, 420, -20, 20)
    m.place(node, mk(m, 'TB-RKS', 'Wheel sensor, diffuse photoelectric, IO-Link, IP67', sen, 'pa66', 'sensor', 'IEC 60947-5-2',
                     '40 x 40 x 40', 'IP67', 'Sees a wheel in the cradle. The bay knows which racks are full before the portal moves.',
                     {}, 'buy', mass_override=0.1), Location(), (60, 0, 0), 'RACKS')


def _socket_rack(m: Model, node: Node, S: dict, H: dict) -> None:
    """One socket rack: a base plate, a post, and 2 ring plates of 5 socket holders on the head's pitch circle, each
    holder at a spindle's angle. Ring A's holders stand empty and take the head's 21 mm set; ring B's hold the 17 mm set."""
    fx = S['faceX'] * M
    r = S['pcd'] * M / 2
    base = bx(fx + 20, fx + 320, 0, 20, -150, 150)
    anc = [(fx + 50, 120), (fx + 50, -120), (fx + 290, 120), (fx + 290, -120)]
    for (x, z) in anc:
        base = base.cut(cyl_y(std.HOLE[12] / 2, -1, 21, x=x, z=z))
    post = bx(fx + 80, fx + 180, 20, 950, -50, 50).cut(bx(fx + 84, fx + 176, 20, 946, -46, 46))
    m.place(node, mk(m, 'TB-SRK', 'Socket rack stand, welded steel', base.union(post), 'steel_yellow', 'structure', 'welded plate and tube 100 x 100 x 4',
                     '300 x 300 x 950', 'S235, painted', 'Holds the 2 rings of socket holders where the head reaches them.', {}),
            Location(), (60, 0, 0), 'SOCKETS')
    for (x, z) in anc:
        m.place(node, anchor_bolt(m, 12, 100), std.orient((x, 20, z), (0, -1, 0)), (60, 60, 0), 'SOCKETS')
    ring_r = {0: 15.0, 1: 13.0}                                   # each ring's holder bore: the 21 mm sockets, the 17 mm ones
    for ri, yr in enumerate(S['ringY']):
        y = yr * M
        pl = bx(fx + 60, fx + 80, -90, 90, -90, 90)
        m.place(node, mk(m, 'TB-SRP', 'Socket ring plate', pl, 'steel_yellow', 'structure', 'cut plate', '180 x 180 x 20', 'S235',
                         'Carries 5 socket holders on the head\'s pitch circle.', {}), loc(0, y, 0), (60, 0, 0), 'SOCKETS')
        hl = cyl_x(19, fx, fx + 60, ri=ring_r[ri])
        hpd = mk(m, f'TB-SHL{17 if ri else 21}', f'Socket holder for a {17 if ri else 21} mm socket, spring detent', hl, 'pom', 'structure',
                 'machined', 'D 38 x 60', 'POM-C, steel detent', 'Holds a socket by its nose. Its detent keeps the socket when the '
                 'head pulls back, and lets it go when the head\'s extension locks into it and pulls.', {}, 'make')
        for k in range(5):
            a = math.radians(72 * k)
            m.place(node, hpd, loc(0, y + r * math.cos(a), r * math.sin(a)), (40, 0, 0), 'SOCKETS')
            if ri == 1:
                tip = fx + S['engage'] * M
                sk = (cyl_x(13, tip - 105, tip).cut(cq.Workplane('YZ', origin=(tip - 25, 0, 0)).polygon(6, 17 / math.cos(math.pi / 6)).extrude(26))
                      .cut(cyl_x(9, tip - 70, tip - 24)).cut(bx(tip - 106, tip - 93, -6.4, 6.4, -6.4, 6.4)))
                m.place(node, mk(m, 'TB-SOK17', 'Wheel bolt socket 17 mm, deep, magnetic', sk, 'fast_blk', 'drive', 'DIN 3129 (deep impact socket)',
                                 '17 mm hex, 1/2 in drive, 105 long', 'CrMo, impact rated', 'The head\'s second set, for a car with 17 mm '
                                 'wheel bolts. A magnet ring at its bottom holds the bolt.', {'magnet': 'NdFeB ring'}, 'buy'),
                        loc(0, y + r * math.cos(a), r * math.sin(a)), (80, 0, 0), 'SOCKETS')
        for (dy, dz) in ((-70, -70), (-70, 70), (70, -70), (70, 70)):
            m.place(node, std.shcs(8, 25, '10.9', 'Fastens a socket ring plate to the stand\'s post.'),
                    std.orient((fx + 60, y + dy, dz), (1, 0, 0)), (20, 0, 0), 'SOCKETS')


def build_nests(m: Model, por: Node, T: dict) -> None:
    """The cover nest on each leg's inner face (in its truck's frame: the leg's inner face at x = -LEG_W / 2): a plate, 2
    hooks the cover's rim rests on, 2 rubber pads its back leans on, and a sensor."""
    C = T['coverNest']
    P = T['portal']
    face_t = -(P['railX'] - C['x']) * M                        # the cover's outer face, truck frame
    seat = C['seatY'] * M
    for side in ('W', 'E'):
        tf = next(n for n in por.children if n.name == f'Truck{side}')
        pl = bx(-LEG_W / 2 - 20, -LEG_W / 2, seat - 60, seat + 560, -140, 140)
        for (yy, zz) in ((seat - 50, -110), (seat - 50, 110), (seat + 530, -110), (seat + 530, 110)):
            pl = pl.cut(cyl_x(std.HOLE[8] / 2, -LEG_W / 2 - 21, -LEG_W / 2 + 1, y=yy, z=zz))
        m.place(tf, mk(m, 'TB-NSP', 'Cover nest plate, stainless', pl, 'ss304', 'structure', 'cut plate', '620 x 280 x 20', '1.4301',
                       'Carries the cover nest on the leg\'s inner face.', {}), Location(), (-60, 0, 0), 'NEST')
        for (yy, zz) in ((seat - 50, -110), (seat - 50, 110), (seat + 530, -110), (seat + 530, 110)):
            m.place(tf, std.shcs(8, 20, 'A2-70', 'Fastens the cover nest plate to the leg (a blind rivet nut in the leg\'s wall).'),
                    std.orient((-LEG_W / 2 - 20, yy, zz), (1, 0, 0)), (-80, 0, 0), 'NEST')
        for zz in (-100, 100):
            hk = (bx(face_t - 12, -LEG_W / 2 - 20, seat - 25, seat, -18, 18)
                  .union(bx(face_t - 12, face_t - 4, seat, seat + 12, -18, 18)))
            m.place(tf, mk(m, 'TB-NSH', 'Cover nest hook, stainless, rubber lined', hk, 'ss304', 'structure', 'bent plate 8 mm', '36 x 37',
                           '1.4301, NBR lining', 'Takes the cover\'s rim. Its lip stops the cover sliding off.', {}), loc(0, 0, zz), (-60, -30, 0), 'NEST')
            pad = bx(face_t + 50, -LEG_W / 2 - 20, seat + 300, seat + 380, -25, 25)
            m.place(tf, mk(m, 'TB-NSR', 'Cover nest pad, rubber', pad, 'rubber', 'structure', 'catalogue part', '80 x 50', 'NBR 60 Shore A',
                           'The cover\'s back leans on it.', {}, 'buy'), loc(0, 0, zz), (-60, 0, 0), 'NEST')
        sen = bx(-LEG_W / 2 - 50, -LEG_W / 2 - 20, seat + 420, seat + 460, -20, 20)
        m.place(tf, mk(m, 'TB-NSS', 'Cover sensor, inductive, IO-Link, IP67', sen, 'pa66', 'sensor', 'IEC 60947-5-2', '30 x 40 x 40', 'IP67',
                       'Sees a cover in the nest, so the head never leaves one behind or puts a second on top of it.', {}, 'buy',
                       mass_override=0.1), Location(), (-60, 0, 0), 'NEST')
