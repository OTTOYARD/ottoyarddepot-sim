"""THE CHARGER beside the OTTO-CHARGE ARM: a whole 350 kW charger in one cabinet, what is in it, how every line is wired
in it, and what it takes from the site.

Chase, 2026-11-15: "figure out the connection and wiring and CAD of the charging cabinets." The first answer drew the
cabinet as the POST of a split charger (718 x 335 x 1,723 mm, the twin's old outline), with its power unit elsewhere. Then
the power unit had nowhere to stand: ABB's Terra HP manual allows at most 60 m of cable from a power cabinet to its post
(Installation manual, Terra HP Generation 3 UL 350 kW Dynamic DC system, 9AKK107992A6491-EN rev 005, section 12.16.4:
https://inchargeus.com/wp-content/uploads/2023/10/Terra-HP-350-Edited.pdf, read 2026-11-15), it takes 2 power cabinets of
1,170 x 770 x 2,030 mm (the same manual, section 12.15) a post, the transformer yard is 56 to 146 m of duct-bank route
from the posts (src/lib/siteFeeders.ts) and full, the canopies have no free ground, and over the spine they would meet the OTTO-CLEAN ARM (its shoulder
hangs at 3.42 m). Asked, Chase chose "All-in-one posts": each post is a whole charger, fed with 480 V AC from its
transformer (the one-line's own topology, otto-q-core 0810: posts at 480 V), and no power unit stands anywhere.

THE OUTLINE is the twin's (cabinetEnvelope.ts, DCFC_CABINET_PU): 1,210 x 2,215 x 764 mm, the outline of ABB's UL Terra
360, an all-in-one 360 kW charger (H x W x D 2215 x 1210 x 764 mm, 848 kg: https://library.e.abb.com/public/
e7c2402c24c049198ea653c93aea21f0/ABB_Emobility_Terra-360_UL_Data-Sheet_A.pdf, read through a web search on 2026-11-15).
Its face toward the arm did not move (the backset grew by what the depth grew), so the arm's working space is unchanged.

THE LAYOUT, looking at the open cabinet from the car's side (+X along the car, +Y up, +Z toward the car; the cabinet's
own frame below: X the site's x, Y above the pad, Z from the cabinet's middle):
  - a 100 mm plinth, the floor, and 2 gland plates: the left one over the AC feed's shaft, the right one over the arm's
    supply shaft and a small site shaft for the network and the air;
  - LOWER LEFT, the AC input: the feed's 6 conductors (2 a phase) on 3 phase bars, the main breaker over them (it is the
    charger's disconnect and locks open for work), and 3 copper risers up to the AC distribution block under the rack;
  - UPPER LEFT, the power: 12 power modules of 30 kW in a rack, 2 columns of 6. They take air in through the left door
    and blow it out through the back wall. Their DC leaves the rack's side on 2 terminals;
  - CENTRE, the DC column, top down: the rack's DC on 2 input bars, then per pole a fuse and a contactor, joined by
    copper links; a barrier between the poles; under it the 2 output blocks, each on an insulating support. The arm's 8
    DC cores rise straight into them from the gland plate;
  - CENTRE LEFT, low: the earth bar, the auxiliary transformer (it feeds the controls, the drives and the cooling unit
    from the AC feed), its primary fuses and the AC surge arrester;
  - RIGHT, 5 rows of rail-mounted devices beside the right wiring duct, and a duct over each row; UPPER RIGHT, the
    connector's cooling unit on the back wall, its 2 coolant sockets on its front.
Every line in the cabinet is drawn where it can be bought by its drawn length: the 8 DC cores and the 2 coolant tubes from
the arm, and the 6 AC conductors, the equipment ground, the pad's earth and the network fibre from the site (each post's
feed in the site's duct bank is measured in src/lib/siteFeeders.ts). No air reaches the charger: the arm's head is
electric since 2026-11-16 (Chase chose it, with the clean arms' air knives as the depot's only use of compressed air), so
the service-air block, its strut and the site's air tube are gone. The arm's 5 small cables run in the wiring ducts, and
their routes there are planned (the cable schedule's 'duct'). The panel wiring between the devices is the charger maker's
wiring diagram and is not drawn.

SIZES. The cooling unit is the size of Phoenix Contact's unit for its liquid-cooled HPC cables, EV-HPC-PCU-01: 534 x 403
x 198 mm (RS Components' listing, https://au.rs-online.com/web/p/cooling-units/2671592, read 2026-11-15; its 3 figures
are not labelled, and this file takes them as width, height and depth), 17.44 kg (https://proax.ca/en/product/2578017/
phx1237881, read 2026-11-15), 2 L/min at 1 bar on 24 V DC (https://www.phoenixcontact.com/en-us/products/
cooling-unit-ev-hpc-pcu-01-1237881, read through a web search on 2026-11-15). This arm needs 2 L/min against about 2 bar
(the cable schedule's coolant lines), so the unit bought must have the larger pump. A 1,000 V DC contactor of the class
drawn is about 95 x 44 x 90 mm (TDK HVC27, https://www.mouser.se/epcos-tdk-hvc27-500c-24p-contactor, read 2026-11-15).
These names stay in this comment: the parts list is on screen, and no screen names a product (AGENTS.md). Every other
device, the power modules and the main breaker among them, is drawn at a class size marked ASSUMPTION on its part, to be
set from the maker's sheet when the charger is chosen.
"""
from __future__ import annotations

import cadquery as cq
from cadquery import Location

from .. import std
from ..core import PartDef, loc
from .charge_arm import _bent_bar, _bx

# ── the cabinet's own frame: X the site's x, Y above the pad's top, Z from the cabinet's middle (+Z toward the car) ──
PL_H, T_SH, T_GP = 100.0, 2.0, 4.0                  # the plinth, the sheet, the gland plates
Y_FL = PL_H + T_SH                                   # the floor's top
Y_GP = Y_FL + T_GP                                   # the gland plates' top
# THE DC COLUMN (the centre), top down from the module rack: one X a pole (+, -), and the barrier between them
C_P, C_N, X_BAR = 135.0, 235.0, 185.0
Y_KM, Y_FU, Y_INB = (1070.0, 1180.0), (1240.0, 1420.0), (1460.0, 1540.0)  # contactors', fuses' bodies; the input bars
# the 2 output blocks (front, under the column) and where the arm's DC cores end in them: they stay where the arm's
# cores rise, as before the cabinet became a whole charger
OB_W, OB_H, OB_D = 66.0, 60.0, 60.0
Y_OBP, Y_OBN = 700.0, 820.0
OB_IN = 15.0                                         # each core goes 15 mm up into its block's entry
# THE AC INPUT (the left): 3 phase bars, the main breaker over them, 3 risers up to the distribution block under the rack
X_PH = (-465.0, -375.0, -285.0)                      # the 3 phases' middles: the bars', the breaker's poles', the risers'
AC_BW, Y_ACB = 70.0, (300.0, 420.0)                  # a phase bar's width, and the bars' bottom and top
AC_DX = 22.0                                         # each phase's 2 conductors stand this far either side of its middle
MCB_W, MCB_D, Y_MCB = 270.0, 150.0, (540.0, 940.0)  # the main breaker: width, depth, body bottom and top
Y_ACD = (1380.0, 1440.0)                             # the AC distribution block, under the rack
# THE MODULE RACK (the upper left): 2 columns of 6 power modules between 2 side plates
RK_X, RK_T, RK_Y0 = (-586.0, -106.0), 6.0, 1440.0   # the side plates' outer faces, the plates' thickness, its underside
PM_W, PM_H, PM_D, PM_PITCH, PM_ROWS = 226.0, 84.0, 437.0, 100.0, 6
# THE COOLING UNIT (the upper right), on the back wall, and its 2 coolant sockets on its front
CU_W, CU_H, CU_D = 534.0, 403.0, 198.0
CU_X0, CU_Y0 = 50.0, 1650.0
X_CS, X_CR, Y_CSK = 279.0, 300.0, 1700.0            # the supply's and the return's sockets
# THE RIGHT COLUMN: rows of rail devices from X_RC0, the right duct beside them, a duct over each row
X_RC0 = 385.0
RC_ROWS = (300.0, 560.0, 840.0, 1110.0, 1420.0)      # the rows' middles
DU_R = (300.0, 355.0, 200.0, 1600.0)                 # the right duct: x, x, y, y
DU_ROWS = (360.0, 630.0, 950.0, 1190.0, 1530.0)      # the row ducts' bottoms
# the centre-left row (the auxiliary transformer's fuses and the surge arrester) and the earth bar
Y_CLROW = 480.0
PE_X = (-190.0, -150.0)                              # the equipment ground and the pad's earth, up to the earth bar


def build_cabinet(m, site, cab: dict, pad_top: float, deck: float, entries: dict) -> dict:
    """Draw the charger on `site` (the stall's frame). `entries`: {supply line id: (x, z, d)} where each of the arm's
    supply lines rises through the right gland plate (site frame). Returns what the caller needs: each line's path in the
    cabinet ('top': points from its end down to where it turns into its drop, and the radii of its corners), the planned
    routes of the lines that run in the ducts ('planned'), the site feeds drawn ('site'), and the pad's shafts."""
    M = 1000.0
    W, H, D = cab['width'] * M, cab['height'] * M, cab['depth'] * M
    cz = -cab['backset'] * M
    XW, ZB, ZF = W / 2, -D / 2, D / 2
    XI, ZBI = XW - T_SH, ZB + T_SH
    if XI < 600.0 or H < 2200.0 or D < 760.0:
        raise ValueError('the charger\'s layout needs the all-in-one outline (cabinetEnvelope.DCFC_CABINET_PU): '
                         f'{W:.0f} x {H:.0f} x {D:.0f} mm is smaller')
    Y_RF = H - 30.0                                  # the shell's top; the hood stands 10 mm over it on spacers
    Y_PB = (deck - 150.0) - pad_top                  # the pad's underside (it is cast 150 mm into the slab)
    Z_PL = ZBI + 15.0 + 3.0                          # the mounting plate's face (on 15 mm standoffs off the back wall)
    Z_LK = Z_PL + 35.0                               # every copper tab's front, and every link's back, lie on this face
    Z_DV = Z_PL + 7.5                                # a rail device's back, on its rail
    ZD = Z_PL + 30.0                                 # a wiring duct's middle
    AC_Z = Z_LK + 5.0                                # the AC conductors' line: their lugs' tongues lie on the bars' fronts
    PE_Z = Z_PL + 15.0                               # the earth conductors' line: the earth bar's middle
    PM_Z0 = ZBI + 20.0                               # the modules' backs: 20 mm off the back wall for their warm air

    def P(x, y, z):                                  # cabinet frame -> site frame
        return (x, pad_top + y, cz + z)

    def B(x0, x1, y0, y1, z0, z1):                   # a box in the cabinet's frame, placed in the site's
        return _bx(x0, x1, pad_top + y0, pad_top + y1, cz + z0, cz + z1)

    def at(x, y, z, ry=0.0):
        return loc(x, pad_top + y, cz + z, ry=ry)

    def put(pd, T=None, ex=(0, 0, -300), sub='CABINET'):
        it = m.place(site, pd, T if T is not None else Location(), ex, sub)
        it.yard_hidden = True                        # the yard draws its own cabinet over all of it (ChargingField)
        return it

    def dev(pid, name, w, h, d, mat, kg, fn, spec, std_=''):
        """A bought device drawn as its outline, at its own origin: X centred, Y from 0 up, Z from 0 forward."""
        return m.part(PartDef(pid, name, cq.Workplane('XY').box(w, h, d, centered=(True, False, False)).val(), mat, 'electrical',
                              std_ or 'catalogue part', f'{w:.0f} x {h:.0f} x {d:.0f}', '', None, fn,
                              {**spec, 'size': 'a class size (ASSUMPTION): set it from the maker\'s sheet'}, 'buy', mass_override=kg))

    copper_bar = lambda w, h, t: cq.Workplane('XY').box(w, h, t, centered=(True, False, False)).val()   # noqa: E731

    m.subsystem('CABINET', 'Charger (an all-in-one 350 kW charger)', 'Makes the DC from the post\'s 480 V AC feed, switches '
                'and meters it to the arm, cools the connector, and runs the arm.',
                how=['The 480 V AC feed from the post\'s transformer comes up through the floor onto 3 bars, one a phase.',
                     'The main breaker switches and protects the feed. It locks open for work.',
                     'Copper risers take the AC up to 12 power modules in a rack. Each module makes up to 30 kW of DC.',
                     'The modules take air in through the left door and blow it out through the back wall.',
                     'The DC comes from the rack onto 2 bars. Each pole has a fuse and a contactor.',
                     'The arm\'s 8 DC cores rise straight from the floor into 2 output blocks. Copper links join each block to its contactor.',
                     'An insulation monitor watches the DC to earth. A DC meter measures each charge for the bill.',
                     'An auxiliary transformer feeds the controls, the drives and the cooling unit from the AC feed.',
                     'The cooling unit pumps the liquid for the connector.',
                     'The arm\'s controller, the safety controller and the 2 servo drives for the rail and the cross-slide are on the right.',
                     'No air reaches the charger: the arm\'s head is electric.'],
                specs={'outline': f'{W:.0f} x {H:.0f} x {D:.0f} mm (an all-in-one 350 kW charger)',
                       'enclosure': 'sheet steel 2 mm, IP54, 2 doors on the car\'s side',
                       'AC in': '480 V, 3 phase, about 450 A at 350 kW out (ASSUMPTION: 95 % efficient, power factor 0.99)',
                       'DC out': '500 A, 1,000 V: 2 fuses and 2 contactors, one a pole',
                       'power': '12 power modules of 30 kW (ASSUMPTION: a class of module)'},
                group='Cables')

    # ═══════════════════════════════════════════════════════════════ the enclosure ═══
    plinth = (B(-XW, XW, 0, PL_H, ZB, ZF).cut(B(-XW + 3, XW - 3, -1, PL_H + 1, ZB + 3, ZF - 3)))
    gx, gz = XW - 3 - 30, (ZB + 3 + 30, ZF - 3 - 30)
    for sx in (-1, 1):
        for zz in gz:
            plinth = plinth.union(B(sx * gx - 30, sx * gx + 30, 0, 6, zz - 30, zz + 30))
            plinth = plinth.cut(cq.Workplane('XY').add(cq.Solid.makeCylinder(7.0, 10, cq.Vector(*P(sx * gx, -2, zz)), cq.Vector(0, 1, 0))))
    put(m.part(PartDef('CHG-CPL', 'Charger plinth, sheet steel 3 mm', plinth.val(), 'steel_paint', 'structure', 'folded sheet',
                       f'{W:.0f} x {D:.0f} x {PL_H:.0f}', 'S235, painted', None,
                       'Lifts the charger 100 mm off the pad. The feed and the arm\'s lines come up through it. Its front and back plates come off.',
                       {'anchors': '4 x M12, one in each corner gusset'}, 'make')))
    anc = PartDef('CHG-ANC-M12', 'Anchor rod M12 x 120, injection mortar', cq.Workplane('XZ').circle(6).extrude(120)
                  .faces('<Y').chamfer(1.0).translate((0, 30, 0)).val(), 'fast_zn', 'fastener', 'ETA option 1 anchor',
                  'M12 x 120', '8.8', 40.0, 'Holds the charger\'s plinth to the pad.',
                  {'embedment': '90 mm', 'torque': 'ASSUMPTION: a typical setting torque for an M12 injection anchor'}, 'buy')
    for sx in (-1, 1):
        for zz in gz:
            put(anc, at(sx * gx, 6, zz), (0, 160, -300))
            put(std.washer(12), std.orient(P(sx * gx, 6, zz), (0, -1, 0)), (0, 170, -300))
            put(std.nut(12), at(sx * gx, 6 + 2.5, zz), (0, 180, -300))
    # the shell: back wall, 2 sides, floor and top, open to the doors. The floor is open over the 2 gland plates; the back
    # wall is slotted behind the module rack and behind the cooling unit (their warm air goes out there), the top under
    # the hood
    shell = (B(-XW, XW, PL_H, Y_RF, ZB, ZF).cut(B(-XI, XI, Y_FL, Y_RF - T_SH, ZBI, ZF + 1))
             .cut(B(80, 355, PL_H - 1, Y_FL + 1, -355, 70)).cut(B(-510, -130, PL_H - 1, Y_FL + 1, -362, -300)))
    slots = cq.Workplane('XY').add([cq.Solid.makeBox(150, 8, 6, cq.Vector(xs - 75, pad_top + ys - 4, cz + ZB - 2))
                                    for xs in (-500.0, -340.0, -180.0) for ys in range(1470, 2020, 20)]
                                   + [cq.Solid.makeBox(150, 8, 6, cq.Vector(xs - 75, pad_top + ys - 4, cz + ZB - 2))
                                      for xs in (150.0, 317.0, 484.0) for ys in range(1700, 2010, 20)])
    vents = cq.Workplane('XY').add([cq.Solid.makeBox(1000, 6, 10, cq.Vector(-500, pad_top + Y_RF - 4, cz + zs - 5))
                                    for zs in (-200.0, -100.0, 0.0, 100.0, 200.0)])
    shell = shell.cut(slots).cut(vents)
    put(m.part(PartDef('CHG-CBD', 'Charger body, sheet steel 2 mm', shell.val(), 'steel_paint', 'structure', 'folded and welded sheet',
                       f'{W:.0f} x {Y_RF - PL_H:.0f} x {D:.0f}', 'S235, painted RAL 7016', None,
                       'Closes the charger. The doors are on the car\'s side. The warm air of the modules and the cooling unit leaves through the slots in the back.',
                       {'protection': 'IP54 with the doors shut (ASSUMPTION: the filter mats behind the louvres)'}, 'make')))
    hood = B(-XW, XW, H - 20, H, ZB, ZF).cut(B(-XW + 3, XW - 3, H - 21, H - 3, ZB + 3, ZF - 3))
    put(m.part(PartDef('CHG-CRF', 'Charger rain hood', hood.val(), 'steel_paint', 'structure', 'folded sheet 3 mm',
                       f'{W:.0f} x {D:.0f}', '', None, 'Keeps rain off the top. The 10 mm gap under its lip lets the warm air out.', {}, 'make')))
    rsp = m.part(PartDef('CHG-CRS', 'Hood spacer', cq.Workplane('XY').box(30, H - 3 - Y_RF, 30, centered=(True, False, True)).val(),
                         'steel_paint', 'structure', 'cut bar', f'30 x 30 x {H - 3 - Y_RF:.0f}', '', None, 'Holds the hood over the top.', {}, 'make'))
    for sx in (-1, 1):
        for zz in (ZB + 3 + 20, ZF - 3 - 20):
            put(rsp, at(sx * (XW - 3 - 20), Y_RF, zz), (0, 260, -300))
    # the doors: 2 trays on the car's side. The left one is louvred in front of the module rack (its intake), the right
    # one in front of the cooling unit, and the right one takes the handle
    DW, DH = XI - 3.0, (Y_RF - 5.0) - (PL_H + 5.0)
    Y_HD = 1050.0                                     # the handle's bottom

    def door(sx: int) -> cq.Shape:
        d = (cq.Workplane('XY').box(DW, DH, 22, centered=(True, False, False)).translate((0, 0, -22))
             .cut(cq.Workplane('XY').box(DW - 4, DH - 4, 21, centered=(True, False, False)).translate((0, 2, -23))))
        xc = sx * (1.5 + DW / 2)                     # the door's middle, in the cabinet's frame
        x0, x1 = (-560.0, -130.0) if sx < 0 else (80.0, 550.0)
        y0, y1 = (1470.0, 2020.0) if sx < 0 else (1690.0, 2020.0)
        lv = cq.Workplane('XY').add([cq.Solid.makeBox(x1 - x0, 8, 6, cq.Vector(x0 - xc, ys - 4 - (PL_H + 5.0), -4))
                                     for ys in range(int(y0), int(y1), 18)])
        d = d.cut(lv)
        if sx > 0:
            d = d.cut(cq.Workplane('XY').box(30, 120, 6, centered=(True, False, False)).translate((-DW / 2 + 40, Y_HD - (PL_H + 5.0), -4)))
        return d.val()
    for sx, pid in ((-1, 'CHG-CDL'), (1, 'CHG-CDR')):
        pd = m.part(PartDef(pid, f'Charger door, {"left" if sx < 0 else "right"}, sheet steel 2 mm', door(sx), 'steel_paint', 'structure',
                            'folded sheet', f'{DW:.0f} x {DH:.0f} x 22', 'S235, painted RAL 7016', None,
                            'Opens to the car\'s side. ' + ('Louvres in front of the module rack let its air in.' if sx < 0 else
                                                            'Louvres in front of the cooling unit let its air in. It carries the lockable handle.'),
                            {'opening': f'the arm parks clear of a door before it opens (ASSUMPTION: each door sweeps {DW:.0f} mm, and '
                                        f'the arm\'s base axis stands {-cz - D / 2:.0f} mm off the face)'}, 'make'))
        put(pd, at(sx * (1.5 + DW / 2), PL_H + 5.0, ZF), (sx * 200, 0, 200))
    put(m.part(PartDef('CHG-CHD', 'Swing handle with cylinder lock, flush', cq.Workplane('XY').box(30, 120, 6, centered=(True, False, False)).val(),
                       'a356_dark', 'structure', 'catalogue part', '30 x 120', 'IP65', None, 'Opens and locks the right door. The left door has a rod lock inside.',
                       {}, 'buy', mass_override=0.4)), at(1.5 + 40, Y_HD, ZF - 6), (200, 0, 240))
    hinge = m.part(PartDef('CHG-CHG', 'Door hinge, concealed', cq.Workplane('XY').box(30, 60, 20, centered=(True, False, False)).val(),
                           'a356_dark', 'structure', 'catalogue part', '30 x 60 x 20', '', None, 'Carries a door on the side wall.', {}, 'buy', mass_override=0.15))
    for sx in (-1, 1):
        for yh in (300.0, 1100.0, 1900.0):
            put(hinge, at(sx * (XI - 15), yh, ZF - 22 - 20), (sx * 160, 0, 160))
    # the mounting plate on 7 standoffs off the back wall: the lower part right across, and the upper right part behind
    # the DC column and the right column. The rack and the cooling unit stand on the back wall above it
    mp = B(-585, 585, 120, 1430, Z_PL - 3, Z_PL).union(B(-100, 585, 1430, 1640, Z_PL - 3, Z_PL))
    put(m.part(PartDef('CHG-CMT', 'Mounting plate, galvanised 3 mm', mp.val(), 'steel', 'structure', 'cut plate', '1170 x 1520 x 3',
                       'DX51D Z275', None, 'Carries the AC input, the DC column and every device and duct. The rack and the cooling unit stand on the back wall above it.', {}, 'make')),
        ex=(0, 0, -340))
    sto = m.part(PartDef('CHG-CMS', 'Mounting plate standoff, M8', cq.Workplane('XY').add(cq.Solid.makeCylinder(8, 15, cq.Vector(0, 0, 0), cq.Vector(0, 0, 1))).val(),
                         'fast_zn', 'structure', 'catalogue part', 'D 16 x 15', '', None, 'Holds the mounting plate 15 mm off the back wall.', {}, 'buy'))
    for (xs, ys) in ((-560.0, 140.0), (560.0, 140.0), (-560.0, 785.0), (560.0, 785.0), (-560.0, 1410.0), (560.0, 1620.0), (-80.0, 1620.0)):
        put(sto, at(xs, ys, ZBI), (0, 0, -360))

    # ═══════════════════════════════════════════════════════════ the gland plates ═══
    NET_IN = (327.0, ZD)                             # the site's network, up into the right duct
    gp = B(75, 360, Y_FL, Y_GP, -360, 75)
    holes = [(x, z - cz, d / 2 + 0.5) for (x, z, d) in entries.values()]
    holes += [(NET_IN[0], NET_IN[1], 4.5)]
    for (x, z, r) in holes:
        gp = gp.cut(cq.Workplane('XY').add(cq.Solid.makeCylinder(r, 20, cq.Vector(*P(x, Y_FL - 5, z)), cq.Vector(0, 1, 0))))
    put(m.part(PartDef('CHG-BGP', f'Charger gland plate, right, {len(holes)} entries', gp.val(), 'steel_s355', 'electrical', 'cut plate 4 mm',
                       '285 x 435 x 4', 'IP54 with its glands', None,
                       'Closes the floor over the arm\'s supply shaft and the network\'s shaft behind it. Each line enters through it.',
                       {'glands': 'one a line, under the plate (not drawn)'}, 'make')), ex=(0, 80, -260))
    AC_X = [x + s * AC_DX for x in X_PH for s in (-1, 1)]
    gl = B(-515, -125, Y_FL, Y_GP, -367, -295)
    for (x, z, r) in [(x, AC_Z, 11.0) for x in AC_X] + [(x, PE_Z, 7.0) for x in PE_X]:
        gl = gl.cut(cq.Workplane('XY').add(cq.Solid.makeCylinder(r, 20, cq.Vector(*P(x, Y_FL - 5, z)), cq.Vector(0, 1, 0))))
    put(m.part(PartDef('CHG-BGL', 'Charger gland plate, left, 8 entries', gl.val(), 'steel_s355', 'electrical', 'cut plate 4 mm',
                       '390 x 72 x 4', 'IP54 with its glands', None, 'Closes the floor over the AC feed\'s shaft: its 6 conductors and the 2 earths.',
                       {}, 'make')), ex=(0, 80, -260))

    # ═══════════════════════════════════════════════════════════════ the AC input ═══
    # the feed's 2 conductors a phase on its bar; the main breaker over the bars; copper risers from its top up to the
    # distribution block under the rack. Every tab's front and every link's back on one face (Z_LK)
    ins = m.part(PartDef('CHG-CIS', 'Busbar insulator M8, 25 mm', cq.Workplane('XY').add(cq.Solid.makeCylinder(15, 25, cq.Vector(0, 0, 0), cq.Vector(0, 0, 1))).val(),
                         'pa66_red', 'electrical', 'catalogue part', 'D 30 x 25', 'GPO-3', None, 'Holds a bar off the mounting plate.', {}, 'buy'))
    acb = m.part(PartDef('CHG-CAT', 'AC phase bar, copper 70 x 120 x 10', copper_bar(AC_BW, Y_ACB[1] - Y_ACB[0], 10), 'copper', 'electrical', 'EN 13601',
                         f'{AC_BW:.0f} x {Y_ACB[1] - Y_ACB[0]:.0f} x 10', 'Cu-ETP, tinned', None,
                         'Takes the 2 conductors of one phase from the transformer and the link to the main breaker.', {}, 'make'))
    for x in X_PH:
        put(acb, at(x, Y_ACB[0], Z_LK - 10), (0, 0, -120))
        for ys in (330.0, 400.0):
            put(ins, at(x, ys, Z_PL), (0, 0, -140))
    lug = (cq.Workplane('XY').add(cq.Solid.makeCylinder(12.5, 45, cq.Vector(0, -90, 0), cq.Vector(0, 1, 0)))
           .union(cq.Workplane('XY').box(38, 45, 10, centered=(True, False, True)).translate((0, -45, 0)))
           .cut(cq.Workplane('XY').add(cq.Solid.makeCylinder(7.0, 20, cq.Vector(0, -22, -10), cq.Vector(0, 0, 1)))))
    lug_pd = m.part(PartDef('CHG-CLA', 'Compression lug 350 kcmil, 1 hole M12, tinned copper', lug.val(), 'copper', 'electrical', 'UL 486A-486B',
                            '350 kcmil, M12', '', None, 'Ends an AC feed conductor on its phase bar.', {}, 'buy', mass_override=0.15))
    for x in AC_X:
        put(lug_pd, at(x, Y_ACB[0] + 45, AC_Z), (0, 0, -100))
    acl = m.part(PartDef('CHG-CAL', 'Copper link 40 x 5, phase bar to main breaker', copper_bar(40, 150, 5), 'copper', 'electrical', 'EN 13601',
                         '40 x 5 x 150', 'Cu-ETP, tinned', None, 'Joins a phase bar to its pole of the main breaker.', {}, 'make'))
    for x in X_PH:
        put(acl, at(x, Y_ACB[1] - 35, Z_LK), (0, 0, -40))
    mcb = cq.Workplane('XY').box(MCB_W, Y_MCB[1] - Y_MCB[0], MCB_D, centered=(True, False, False))
    for x in X_PH:
        for y_tab in (-20.0, Y_MCB[1] - Y_MCB[0]):
            mcb = mcb.union(cq.Workplane('XY').box(30, 20, 5, centered=(True, False, False)).translate((x + 375.0, y_tab, 30)))
    put(m.part(PartDef('CHG-CMC', 'Main breaker, 3 pole, 800 A frame, 480 V AC', mcb.val(), 'pa66', 'electrical', 'UL 489',
                       f'{MCB_W:.0f} x {Y_MCB[1] - Y_MCB[0]:.0f} x {MCB_D:.0f}', '', None,
                       'Switches and protects the charger\'s 480 V feed. It is the charger\'s disconnect, and it locks open for work.',
                       {'rating': '800 A frame, 600 A trip, 65 kA (ASSUMPTION: the site\'s short-circuit study sets it)',
                        'size': 'a class size (ASSUMPTION): set it from the maker\'s sheet'}, 'buy', mass_override=15.0)),
        at(-375.0, Y_MCB[0], Z_PL), (0, 0, -60))
    rsr = m.part(PartDef('CHG-CAR', 'AC riser, copper 40 x 5, main breaker to the distribution block', copper_bar(40, Y_ACD[0] - (Y_MCB[1] + 5), 5),
                         'copper', 'electrical', 'EN 13601', f'40 x 5 x {Y_ACD[0] - (Y_MCB[1] + 5):.0f}', 'Cu-ETP, tinned, in a heat-shrink sleeve',
                         None, 'Takes one phase from the main breaker up to the distribution block under the module rack.', {}, 'make'))
    for x in X_PH:
        put(rsr, at(x, Y_MCB[1] + 5, Z_LK), (0, 0, -40))
    put(m.part(PartDef('CHG-CAD', 'AC distribution block, 3 bars in a GPO-3 housing', B(-500, -250, *Y_ACD, Z_PL, Z_PL + 62).val(), 'pa66',
                       'electrical', 'catalogue part', '250 x 60 x 62', '', None,
                       'Takes the 3 risers and feeds each power module\'s AC input through the rack\'s back (not drawn).',
                       {'size': 'a class size (ASSUMPTION)'}, 'buy', mass_override=3.0)), ex=(0, 0, -60))

    # ════════════════════════════════════════════════════════════ the module rack ═══
    RK_Y1 = RK_Y0 + RK_T + PM_ROWS * PM_PITCH - (PM_PITCH - PM_H)        # the top plate's underside: the top modules' tops
    rk_side = m.part(PartDef('CHG-RKS', 'Module rack side plate, steel 6 mm', _bx(0, RK_T, 0, RK_Y1 + RK_T - RK_Y0, 0, 80.0 - ZBI).val(),
                             'steel_s355', 'structure', 'cut plate 6 mm', f'{RK_Y1 + RK_T - RK_Y0:.0f} x {80.0 - ZBI:.0f} x 6', '', None,
                             'Carries the shelves and the modules. It is bolted to the back wall.', {}, 'make'))
    for x0 in (RK_X[0], RK_X[1] - RK_T):
        put(rk_side, at(x0, RK_Y0, ZBI), (0, 0, -80))
    rk_x0, rk_x1 = RK_X[0] + RK_T, RK_X[1] - RK_T
    rk_plate = m.part(PartDef('CHG-RKP', 'Module rack bottom and top plate, steel 6 mm', _bx(0, rk_x1 - rk_x0, 0, RK_T, 0, 80.0 - ZBI).val(),
                              'steel_s355', 'structure', 'cut plate 6 mm', f'{rk_x1 - rk_x0:.0f} x {80.0 - ZBI:.0f} x 6', '', None,
                              'Closes the rack at the bottom and the top.', {}, 'make'))
    put(rk_plate, at(rk_x0, RK_Y0, ZBI), (0, -60, -80))
    put(rk_plate, at(rk_x0, RK_Y1, ZBI), (0, 60, -80))
    shelf = m.part(PartDef('CHG-RKH', 'Module rack shelf, steel 2 mm', _bx(0, rk_x1 - rk_x0, 0, 2.0, 0, 80.0 - ZBI).val(), 'steel_s355',
                           'structure', 'folded sheet 2 mm', f'{rk_x1 - rk_x0:.0f} x {80.0 - ZBI:.0f} x 2', '', None, 'Carries a row of 2 modules.', {}, 'make'))
    y_row0 = RK_Y0 + RK_T
    for k in range(1, PM_ROWS):
        put(shelf, at(rk_x0, y_row0 + k * PM_PITCH - 2.0, ZBI), (0, 0, -80))
    pm = cq.Workplane('XY').box(PM_W, PM_H, PM_D, centered=False)
    pm = pm.cut(cq.Workplane('XY').add([cq.Solid.makeBox(PM_W - 40, 3, 3, cq.Vector(20, ys, PM_D - 2)) for ys in range(14, int(PM_H) - 10, 9)]))
    pm_pd = m.part(PartDef('CHG-CPM', 'Power module, 30 kW, 480 V AC in, 150 to 1,000 V DC out', pm.val(), 'steel_paint', 'electrical',
                           'catalogue part', f'{PM_W:.0f} x {PM_H:.0f} x {PM_D:.0f}', '', None,
                           'Turns its share of the AC feed into DC. 12 of them, in parallel, make up to 360 kW. Its fans draw air in at the front and out at the back.',
                           {'rating': '30 kW, 1,000 V DC (ASSUMPTION: a class of module; the charger\'s maker sets the module and their number)',
                            'size and mass': 'a class size and mass (ASSUMPTION)'}, 'buy', mass_override=15.0))
    for k in range(PM_ROWS):
        for x0 in (rk_x0, rk_x1 - PM_W):
            put(pm_pd, at(x0, y_row0 + k * PM_PITCH, PM_Z0), (0, 0, 120))
    rkt = m.part(PartDef('CHG-CRT', 'Rack DC output terminal, insulated', _bx(0, 20.0, 0, 30.0, 0, 20.0).val(), 'pa66_red', 'electrical',
                         'catalogue part', '20 x 30 x 20', '', None, 'Brings one pole of the modules\' DC out of the rack to its copper link.',
                         {'size': 'a class size (ASSUMPTION)'}, 'buy', mass_override=0.2))
    for y_t in (1465.0, 1605.0):
        put(rkt, at(RK_X[1], y_t, Z_LK - 20.0), (60, 0, -60))

    # ═══════════════════════════════════════════════════════════ the DC column ═══
    # IN, at the top: the rack's DC on 2 bars; per pole a fuse, then a contactor, then a link down and forward into its
    # output block. Their terminal tabs and the links between them all on one face (Z_LK)
    inb = m.part(PartDef('CHG-CBI', 'DC input bar, copper 90 x 80 x 10', copper_bar(90, Y_INB[1] - Y_INB[0], 10), 'copper', 'electrical', 'EN 13601',
                         '90 x 80 x 10', 'Cu-ETP, tinned', None, 'Takes one pole of the DC from the module rack and the link to its fuse.', {}, 'make'))
    for c in (C_P, C_N):
        put(inb, at(c, Y_INB[0], Z_LK - 10), (0, 0, -120))
        for dx in (-25, 25):
            put(ins, at(c + dx, (Y_INB[0] + Y_INB[1]) / 2, Z_PL), (0, 0, -140))
    put(m.part(PartDef('CHG-CDLP', 'Copper link 30 x 5, rack DC+ to its input bar', B(-90.0, C_P - 15.0, 1465.0, 1495.0, Z_LK, Z_LK + 5).val(),
                       'copper', 'electrical', 'EN 13601', f'30 x 5 x {C_P - 15 + 90:.0f}', 'Cu-ETP, tinned, in a red heat-shrink sleeve', None,
                       'Brings the DC+ from the rack\'s terminal to its input bar.', {}, 'make')), ex=(0, 0, -40))
    dln = (B(-90.0, C_N + 15.0, 1605.0, 1635.0, Z_LK, Z_LK + 5).union(B(C_N - 15.0, C_N + 15.0, Y_INB[1] - 20.0, 1605.0, Z_LK, Z_LK + 5)))
    put(m.part(PartDef('CHG-CDLN', 'Copper link 30 x 5, rack DC- to its input bar, cut L', dln.val(), 'copper', 'electrical', 'EN 13601',
                       f'30 x 5, {C_N + 15 + 90:.0f} + {1635 - Y_INB[1] + 20:.0f}', 'Cu-ETP, tinned, in a black heat-shrink sleeve', None,
                       'Brings the DC- from the rack\'s terminal over the DC+ bar to its own input bar.', {}, 'make')), ex=(0, 0, -40))
    fus = (cq.Workplane('XY').box(60, Y_FU[1] - Y_FU[0], 100, centered=(True, False, False))
           .union(cq.Workplane('XY').box(30, 20, 5, centered=(True, False, False)).translate((0, -20, 30)))
           .union(cq.Workplane('XY').box(30, 20, 5, centered=(True, False, False)).translate((0, Y_FU[1] - Y_FU[0], 30))))
    fus_pd = m.part(PartDef('CHG-CFU', 'DC fuse 630 A, 1,000 V DC, in its base', fus.val(), 'pa66', 'electrical', 'IEC 60269-7',
                            '60 x 180 x 100', '', None, 'Opens its pole if the DC shorts.', {'size': 'a class size (ASSUMPTION): set it from the maker\'s sheet'},
                            'buy', mass_override=1.2))
    kmc = (cq.Workplane('XY').box(50, Y_KM[1] - Y_KM[0], 90, centered=(True, False, False))
           .union(cq.Workplane('XY').box(30, 20, 5, centered=(True, False, False)).translate((0, -20, 30)))
           .union(cq.Workplane('XY').box(30, 20, 5, centered=(True, False, False)).translate((0, Y_KM[1] - Y_KM[0], 30))))
    kmc_pd = m.part(PartDef('CHG-CKM', 'DC contactor 500 A, 1,000 V DC', kmc.val(), 'pa66', 'electrical', 'IEC 60947-4-1',
                            '50 x 110 x 90', '', None, 'Connects its pole to the arm only while a car charges. It opens on every stop.',
                            {'size': 'a class size (ASSUMPTION). A 1,000 V DC contactor of this class is about 95 x 44 x 90 mm (source in charge_cabinet.py)'},
                            'buy', mass_override=1.5))
    for c in (C_P, C_N):
        put(fus_pd, at(c, Y_FU[0], Z_PL), (0, 0, -60))
        put(kmc_pd, at(c, Y_KM[0], Z_PL), (0, 0, -60))
    lk1 = m.part(PartDef('CHG-CBL1', 'Copper link 30 x 5, input bar to fuse', copper_bar(30, 45, 5), 'copper', 'electrical', 'EN 13601',
                         '30 x 5 x 45', 'Cu-ETP, tinned', None, 'Joins an input bar to its fuse.', {}, 'make'))
    lk2 = m.part(PartDef('CHG-CBL2', 'Copper link 30 x 5, fuse to contactor', copper_bar(30, 50, 5), 'copper', 'electrical', 'EN 13601',
                         '30 x 5 x 50', 'Cu-ETP, tinned', None, 'Joins a fuse to its contactor.', {}, 'make'))
    for c in (C_P, C_N):
        put(lk1, at(c, Y_FU[1] + 5.0, Z_LK), (0, 0, -40))
        put(lk2, at(c, Y_KM[1] + 5.0, Z_LK), (0, 0, -40))
    for (pid, c, y_t, pole) in (('CHG-CBL3P', C_P, Y_OBP + 30.0, '+'), ('CHG-CBL3N', C_N, Y_OBN + 30.0, '-')):
        shp, L_ = _bent_bar([P(c, Y_KM[0] - 15.0, Z_LK + 2.5), P(c, y_t, Z_LK + 2.5), P(c, y_t, -OB_D / 2)], [10.0], 30.0, 5.0, (1.0, 0.0, 0.0))
        put(m.part(PartDef(pid, f'Copper link 30 x 5, DC{pole} contactor to output block', shp, 'copper', 'electrical', 'EN 13601',
                           f'30 x 5 x {L_:.0f}', 'Cu-ETP, tinned', None, f'Brings the DC{pole} pole down from its contactor and forward into its output block.'
                           + (' The DC meter\'s shunt sits in it (not drawn).' if pole == '-' else ''), {}, 'make')), ex=(0, 0, -40))
    put(m.part(PartDef('CHG-CBA', 'Pole barrier, GPO-3 4 mm', B(X_BAR - 2, X_BAR + 2, Y_KM[0] - 30.0, 1560.0, Z_PL, Z_LK + 60.0).val(), 'pa66_red',
                       'electrical', 'cut sheet', f'{1560.0 - Y_KM[0] + 30:.0f} x {Z_LK + 60 - Z_PL:.0f} x 4', 'GPO-3', None,
                       'Stands between the 2 poles of the DC column.', {}, 'make')), ex=(0, 0, -80))
    ob = cq.Workplane('XY').box(OB_W, OB_H, OB_D, centered=(True, False, True))
    for dx in (-24.75, -8.25, 8.25, 24.75):
        ob = ob.cut(cq.Workplane('XY').add(cq.Solid.makeCylinder(7.7, OB_IN + 1.0, cq.Vector(dx, -1, 0), cq.Vector(0, 1, 0))))
    ob_pd = m.part(PartDef('CHG-COB', 'DC output block, 4 x 50 mm2 in, insulated', ob.val(), 'pa66', 'electrical', 'IEC 60947-7-1',
                           f'{OB_W:.0f} x {OB_H:.0f} x {OB_D:.0f}', '', None,
                           'Joins the 4 cores of one pole to the arm. Each core enters from below and is clamped; its contactor\'s link enters at the back.',
                           {'entries': '4 x 50 mm2 from below at 16.5 mm, the cores\' own spacing', 'size': 'a class size (ASSUMPTION)'}, 'buy', mass_override=0.9))
    put(ob_pd, at(153.5, Y_OBP, 0), (0, 0, 60))
    put(ob_pd, at(219.5, Y_OBN, 0), (0, 0, 60))
    for (pid, x0, x1, y0) in (('CHG-COS1', 158.0, 186.0, Y_OBP), ('CHG-COS2', 190.0, 216.0, Y_OBN)):
        put(m.part(PartDef(pid, 'Output block support, GPO-3', B(x0, x1, y0, y0 + OB_H, Z_PL, -OB_D / 2).val(), 'pa66_red', 'electrical',
                           'cut and bonded GPO-3', f'{x1 - x0:.0f} x {OB_H:.0f} x {-OB_D / 2 - Z_PL:.0f}', 'GPO-3', None,
                           'Holds an output block off the mounting plate, beside its link.', {}, 'make')), ex=(0, 0, -60))

    # ═════════════════════════════════════ the earth bar, the auxiliary transformer, the centre-left row ═══
    pe = B(-230, -110, 130, 160, Z_PL + 10, Z_PL + 20)
    put(m.part(PartDef('CHG-CPE', 'Earth bar, copper 120 x 30 x 10', pe.val(), 'copper', 'electrical', 'EN 13601', '120 x 30 x 10',
                       'Cu-ETP, tinned', None, 'Takes the feed\'s equipment ground, the pad\'s earth and every earth wire in the charger. The plate, the rack and the doors are bonded to it.',
                       {}, 'make')), ex=(0, -40, -80))
    pst = m.part(PartDef('CHG-CPT', 'Earth bar standoff, M8', cq.Workplane('XY').add(cq.Solid.makeCylinder(6, 10, cq.Vector(0, 0, 0), cq.Vector(0, 0, 1))).val(),
                         'pa66_red', 'electrical', 'catalogue part', 'D 12 x 10', '', None, 'Holds the earth bar 10 mm off the plate.', {}, 'buy'))
    for xs in (-220.0, -120.0):
        put(pst, at(xs, 145.0, Z_PL), (0, -40, -100))
    put(dev('CHG-CAX', 'Auxiliary transformer, 480 V to 400/230 V, 3 kVA', 180, 170, 140, 'steel_paint', 25.0,
            'Feeds the controls, the drives and the cooling unit from the AC feed, through the auxiliary breaker.', {'rating': '3 kVA (ASSUMPTION)'}),
        at(-110.0, 200.0, Z_PL), (0, 0, 60))
    rail_cl = m.part(PartDef('CHG-CDR4', 'Mounting rail 35 x 7.5, 185 mm', cq.Workplane('XY').box(185, 35, 7.5, centered=(False, True, False)).val(),
                             'steel', 'structure', 'EN 60715', '35 x 7.5 x 185', 'galvanised', None, 'Carries the auxiliary fuses and the surge arrester.', {}, 'buy'))
    put(rail_cl, at(-205.0, Y_CLROW, Z_PL), (0, 0, -60))
    devs = {}
    for (pid, name, w, h, d, x0, kg, fn) in (
            ('CHG-CAF', 'Auxiliary transformer fuses, 3 pole, 10 A', 54, 90, 70, -205, 0.4, 'Protect the auxiliary transformer\'s 480 V side.'),
            ('CHG-CSP', 'Surge arrester, 480 V AC, type 1+2', 108, 90, 70, -148, 0.9, 'Takes a surge on the AC feed to earth.')):
        put(dev(pid, name, w, h, d, 'pa66', kg, fn, {}), at(x0 + w / 2, Y_CLROW - h / 2, Z_DV), (0, 0, 60))
        devs.setdefault(pid, []).append((x0 + w / 2, Y_CLROW - h / 2, Y_CLROW + h / 2))

    # ═══════════════════════════════════════════════════════════════════ the cooling unit ═══
    cu = cq.Workplane('XY').box(CU_W, CU_H, CU_D, centered=False)
    cu = cu.cut(cq.Workplane('XY').add([cq.Solid.makeBox(CU_W - 80, 4, 3, cq.Vector(40, ys, CU_D - 2)) for ys in range(90, int(CU_H) - 30, 12)]))
    put(m.part(PartDef('CHG-CCU', 'Connector cooling unit, liquid to air, 24 V DC', cu.val(), 'steel_paint', 'fluid', 'catalogue part',
                       f'{CU_W:.0f} x {CU_H:.0f} x {CU_D:.0f}', '', None,
                       'Pumps 50 % glycol through the connector\'s contacts and cools it in air. Its fan draws air in through the right door and out at the back.',
                       {'flow': '2 L/min against about 2 bar (the arm\'s 8 x 6 tubes, both ways): a larger pump than the unit of this size gives (1 bar)',
                        'size and mass': 'the size of a cooling unit made for liquid-cooled HPC cables: 534 x 403 x 198 mm, 17.44 kg (sources in charge_cabinet.py)'},
                       'buy', mass_override=17.44)), at(CU_X0, CU_Y0, ZBI), (0, 0, 150))
    sock = (cq.Workplane('XY').circle(7.0).extrude(16.0).cut(cq.Workplane('XY', origin=(0, 0, 3.0)).circle(4.05).extrude(14.0)))
    sock_pd = m.part(PartDef('CHG-CCS', 'Coolant push-in socket 8 mm, stainless', sock.val(), 'ss316', 'fluid', 'catalogue part', '8 mm',
                             '', None, 'Takes a coolant tube from the arm at the cooling unit. The tube goes 12 mm in.', {}, 'buy'))
    Z_SK = ZBI + CU_D                                 # the sockets stand on the cooling unit's front face
    for xs in (X_CS, X_CR):
        put(sock_pd, at(xs, Y_CSK, Z_SK), (0, 0, 150))

    # ════════════════════════════════════════════════════════ the right column and its ducts ═══
    rail_r = m.part(PartDef('CHG-CDR3', 'Mounting rail 35 x 7.5, 215 mm', cq.Workplane('XY').box(215, 35, 7.5, centered=(False, True, False)).val(),
                            'steel', 'structure', 'EN 60715', '35 x 7.5 x 215', 'galvanised', None, 'Carries a row of devices.', {}, 'buy'))
    for yr in RC_ROWS:
        put(rail_r, at(X_RC0, yr, Z_PL), (0, 0, -60))
    rows = [
        (RC_ROWS[0], [('CHG-CQS', 'Auxiliary breaker, 3 pole, 16 A', 54, 90, 70, 0, 0.4, 'Switches the auxiliary transformer\'s 400 V side off for work.'),
                      ('CHG-CMB', 'Miniature circuit breakers, 6 circuits', 108, 90, 70, 57, 0.8, 'Protect the cooling unit, the drives, the supplies and the lights.'),
                      ('CHG-CRC', 'Residual current device, 30 mA', 36, 90, 70, 168, 0.3, 'Trips on an earth fault in the auxiliary circuits.')]),
        (RC_ROWS[1], [('CHG-CPS24', 'Power supply 24 V DC, 20 A', 65, 125, 125, 0, 1.0, 'Feeds the controllers, the cooling unit and the valves.'),
                      ('CHG-CPS24', 'Power supply 24 V DC, 20 A', 65, 125, 125, 65, 1.0, 'Feeds the controllers, the cooling unit and the valves.'),
                      ('CHG-CPS48', 'Power supply 48 V DC, 20 A', 85, 125, 125, 130, 1.3, 'Feeds the joints\' drives through the joint supply cable (ASSUMPTION: they take 48 V).')]),
        (RC_ROWS[2], [('CHG-CIM', 'Insulation monitor for the DC output', 72, 90, 70, 0, 0.3, 'Watches the DC to earth. It stops the charge on a fault.'),
                      ('CHG-CDM', 'DC energy meter, with shunt', 85, 90, 70, 75, 0.5, 'Measures each charge for the bill. Its shunt is in the DC- link.'),
                      ('CHG-CSD', 'Servo drive, 1 kW, 400 V', 55, 200, 175, 160, 1.5, 'Drives the rail gearmotor or the cross-slide motor.')]),
        (RC_ROWS[3], [('CHG-CEC', 'Charge controller, CCS and NACS communication', 90, 110, 65, 0, 0.4, 'Talks to the car through the connector and to OTTO-Q.'),
                      ('CHG-CSF', 'Safety controller', 45, 100, 115, 93, 0.3, 'Takes the scanner and the emergency stop. It cuts the drives\' torque.'),
                      ('CHG-CNS', 'Network switch, managed, 8 ports and 2 fibre ports', 50, 140, 110, 141, 0.6, 'Joins the controllers to the depot\'s network, on its fibre.')]),
        (RC_ROWS[4], [('CHG-CAC', 'Arm controller', 150, 200, 100, 0, 2.5, 'Moves the arm: it runs its 6 joints and the 2 servo drives.'),
                      ('CHG-CSD', 'Servo drive, 1 kW, 400 V', 55, 200, 175, 155, 1.5, 'Drives the rail gearmotor or the cross-slide motor.')]),
    ]
    for (yr, items) in rows:
        for (pid, name, w, h, d, dx0, kg, fn) in items:
            x0 = X_RC0 + dx0
            put(dev(pid, name, w, h, d, 'pa66', kg, fn, {}), at(x0 + w / 2, yr - h / 2, Z_DV), (0, 0, 60))
            devs.setdefault(pid, []).append((x0 + w / 2, yr - h / 2, yr + h / 2))

    def duct(pid, name, x0, x1, y0, y1, along_y):
        o = cq.Workplane('XY').box(x1 - x0, y1 - y0, 60.0, centered=False)
        i = (cq.Workplane('XY').box(x1 - x0 - 4, y1 - y0 + 2, 56.0, centered=False).translate((2, -1, 2)) if along_y else
             cq.Workplane('XY').box(x1 - x0 + 2, y1 - y0 - 4, 56.0, centered=False).translate((-1, 2, 2)))
        return m.part(PartDef(pid, name, o.cut(i).val(), 'pa66', 'electrical', 'EN 50085-2-3', f'60 x 60 x {max(x1 - x0, y1 - y0):.0f}', 'PVC, slotted',
                              None, 'Carries the charger\'s wiring and the arm\'s small cables between the devices.', {}, 'buy'))
    put(duct('CHG-CWR', 'Wiring duct 60 x 60, right', *DU_R, True), at(DU_R[0], DU_R[2], Z_PL), (0, 0, -40))
    row_duct = duct('CHG-CWH', 'Wiring duct 60 x 60, over a row', DU_R[1], XI - 3.0, 0.0, 60.0, False)
    for yd in DU_ROWS:
        put(row_duct, at(DU_R[1], yd, Z_PL), (0, 0, -40))

    # ════════════════════════════════════════════════════════════════ the site feeds ═══
    # each drawn from the pad's underside, where the site's duct brings it, up through its gland plate to what it serves
    site_lines = []

    def feed(pid, name, x, z, y_top, r, mat, cat, fn, spec, size):
        pd = m.part(PartDef(pid, name, cq.Workplane('XY').add(cq.Solid.makeCylinder(r, y_top - Y_PB, cq.Vector(*P(x, Y_PB, z)), cq.Vector(0, 1, 0))).val(),
                            mat, cat, '', size, '', None, fn, spec, 'buy'))
        pd.end_in = {'start': 'CHG-PAD'}           # its lower end is where the site's duct meets the pad (line_ends.py)
        pd.path_mm = y_top - Y_PB
        b0, t0 = P(x, Y_PB, z), P(x, y_top, z)     # its ends by name: start at the pad, end at what it serves
        pd.path_ends = (b0, (b0[0], b0[1] + 10.0, b0[2]), t0, (t0[0], t0[1] - 10.0, t0[2]), r)
        put(pd, ex=(0, -200, -300), sub='CABINET')
        site_lines.append(pid)
        return pd
    for i, x in enumerate(AC_X):
        ph, k = i // 2 + 1, i % 2 + 1
        feed(f'CHG-SL{ph}{"AB"[k - 1]}', f'AC feed conductor, L{ph}, {k} of 2, 350 kcmil', x, AC_Z, Y_ACB[0] - 45.0, 10.5, 'cable', 'electrical',
             f'Brings half of phase L{ph} from the post\'s transformer up into the charger, to its lug on the L{ph} bar.',
             {'conductor': '350 kcmil copper, XHHW-2, 600 V (ASSUMPTION: 2 a phase for about 450 A at 480 V, at 125 % for a continuous '
                           'load; the site\'s cable calculation sets them. The longest feed drops 1.5 % at full load: src/lib/siteFeeders.ts)'}, 'D 21')
    feed('CHG-SEG', 'Equipment ground, 1/0 AWG copper, green', PE_X[0], PE_Z, 130.0, 6.25, 'cable', 'electrical',
         'Brings the feed\'s equipment ground from the transformer up to the earth bar.',
         {'conductor': '1/0 AWG copper (ASSUMPTION: NEC 250.122 for an 800 A frame breaker)'}, 'D 12.5')
    feed('CHG-SPE', 'Earth conductor 1/0 AWG, to the pad\'s earth electrode', PE_X[1], PE_Z, 130.0, 6.0, 'cable', 'electrical',
         'Joins the earth bar to the earth electrode cast in the pad.', {'conductor': '1/0 AWG copper (ASSUMPTION)'}, 'D 12')
    feed('CHG-SNW', 'Network fibre, 2 x single-mode, armoured, site to charger', NET_IN[0], NET_IN[1], DU_R[2] + 10.0, 3.0, 'cable', 'electrical',
         'Brings the depot\'s network up into the charger\'s right duct, to the switch\'s fibre port.',
         {'why fibre': 'the farthest posts are 102 to 123 m of cable from the office, past a copper Ethernet channel\'s 100 m (src/lib/siteFeeders.ts)'}, 'D 6')
    m.parts['CHG-SNW'].end_in = {'start': 'CHG-PAD', 'end': 'CHG-CWR'}

    # ═════════════════════════════════════════════ the arm's lines: their paths in the cabinet ═══
    top = {}
    for lid, (x, z, d) in entries.items():
        Z = z - cz
        if lid.startswith('CHG-LD'):                 # a DC core: straight up into its output block
            y_end = (Y_OBP if lid.startswith('CHG-LDP') else Y_OBN) + OB_IN
            top[lid] = ([P(x, y_end, Z)], [])
        elif lid == 'CHG-LCS':                       # to the cooling unit's supply socket, up the right of the DC column
            top[lid] = ([P(X_CS, Y_CSK, Z_SK + 4.0), P(X_CS, Y_CSK, Z), P(X_CS, 640.0, Z), P(x, 640.0, Z)], [4 * d] * 3)
        elif lid == 'CHG-LCR':
            top[lid] = ([P(X_CR, Y_CSK, Z_SK + 4.0), P(X_CR, Y_CSK, Z), P(X_CR, 580.0, Z), P(x, 580.0, Z)], [4 * d] * 3)
        else:                                        # a small cable: it ends at the gland plate; its run in the ducts is planned
            top[lid] = ([P(x, Y_GP + 0.5, Z)], [])

    # the planned routes in the ducts: from the gland plate across to the right duct, up it, along a row's duct and down
    # into the device
    X_DU = (DU_R[0] + DU_R[1]) / 2

    def ducted(x, Z, x_dev, y_dev, y_duct):
        return [(x, Y_GP, Z), (x, 200.0, Z), (X_DU, 200.0, Z), (X_DU, 200.0, ZD), (X_DU, y_duct, ZD), (x_dev, y_duct, ZD), (x_dev, y_dev, ZD)]
    row_mid = [yd + 30.0 for yd in DU_ROWS]
    (cac_x, _, cac_top), = devs['CHG-CAC']
    (sx_x, _, sx_top), (sz_x, _, sz_top) = devs['CHG-CSD']
    (sf_x, _, sf_top), = devs['CHG-CSF']
    (ns_x, _, ns_top), = devs['CHG-CNS']
    planned = {}
    for lid, x_dev, y_dev, y_duct, to in (('CHG-LJS', cac_x - 30, cac_top, row_mid[4], 'the arm controller (CHG-CAC) and the 48 V supply (CHG-CPS48), through it'),
                                          ('CHG-LTL', cac_x + 30, cac_top, row_mid[4], 'the arm controller (CHG-CAC)'),
                                          ('CHG-LSF', sf_x, sf_top, row_mid[3], 'the safety controller (CHG-CSF)'),
                                          ('CHG-LMX', sx_x, sx_top, row_mid[2], 'its servo drive (CHG-CSD, in the third row)'),
                                          ('CHG-LMZ', sz_x, sz_top, row_mid[4], 'its servo drive (CHG-CSD, in the top row)')):
        x, z, d = entries[lid]
        planned[lid] = (ducted(x, z - cz, x_dev, y_dev, y_duct), to)
    planned['CHG-SNW'] = ([(NET_IN[0], DU_R[2] + 10.0, NET_IN[1]), (X_DU, row_mid[3], ZD), (ns_x, row_mid[3], ZD), (ns_x, ns_top, ZD)],
                          'the network switch (CHG-CNS)')
    return {'top': top, 'planned': planned, 'site': site_lines, 'Y_GP': pad_top + Y_GP,
            'shafts': [(-510.0, -130.0, cz - 362.0, cz - 300.0), (305.0, 355.0, cz - 350.0, cz - 315.0)],
            'devices': devs}
