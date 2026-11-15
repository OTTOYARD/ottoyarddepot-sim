"""THE CHARGER CABINET beside the OTTO-CHARGE ARM: what is in it, how every line is wired in it, and what it takes from the
site. Chase, 2026-11-15: "figure out the connection and wiring and CAD of the charging cabinets." Until then the cabinet
was its envelope (CHG-CAB, a reference box), and every supply line had a 1.5 m tail inside it marked ASSUMPTION.

WHAT IT IS, AND WHAT IT CANNOT BE. The twin draws one cabinet a post, 718 x 335 x 1,723 mm (cabinetEnvelope.ts,
DCFC_CABINET_PU), and its depot is 30 posts of 350 kW (otto-q-core 0810). No 350 kW converter fits in that box. ABB's
Terra HP, the charger 0810 takes its efficiency from, makes 350 kW from one charge post of 2,458 x 590 x 425 mm and 2
power cabinets of 2,030 x 1,170 x 770 mm each (https://new.abb.com/ev-charging/products/car-charging/high-power-charging
and https://inchargeus.com/wp-content/uploads/2026/07/InCharge_Specsheet_Terra-High-Power_v1.5.pdf, both read through a
web search on 2026-11-15): its 2 power cabinets alone are about 20 times this box. So this cabinet is the POST of a split
charger: it fuses, switches, meters and watches the DC a power unit sends it, cools the connector, and runs the arm. The
power unit (480 V AC from the post's charger transformer to DC) stands elsewhere. Where is a site decision the twin has
not made: it draws no power unit, and the DC feed's length waits on it (the cable schedule lists that run open).

THE LAYOUT, looking at the open cabinet from the car's side (+X along the car, +Y up, +Z toward the car; the cabinet's
own frame below: X the site's x, Y above the pad, Z from the cabinet's middle):
  - a 100 mm plinth, the floor, and 2 gland plates: at the right over the arm's supply shaft and a site shaft behind it,
    at the left over a site shaft for the auxiliary supply, the network and the earth;
  - right, at the back, the DC column: the incoming DC on 2 bars, then per pole a fuse and a contactor, joined by copper
    links. A barrier stands between the 2 poles;
  - right, at the front, the 2 output blocks. The arm's 8 DC cores rise straight into them from the gland plate, and each
    contactor's link comes forward into its block;
  - left, 3 rows of rail-mounted devices and the earth bar under them; the connector's cooling unit across the middle,
    on the back wall; the arm's controller and the 2 servo drives at the top;
  - wiring ducts up each side, across the top and over each row on the left; the service-air block on the right wall.
Every line in the cabinet is drawn where it can be bought by its drawn length: the 8 DC cores, the 2 coolant tubes and
the air tube from the arm, and the 4 DC feed cores, the air, the auxiliary supply, the network and the earth from the
site. The arm's 5 small cables run in the wiring ducts, and their routes there are planned (the cable schedule's 'duct').

SIZES. The cooling unit is the size of Phoenix Contact's unit for its liquid-cooled HPC cables, EV-HPC-PCU-01: 534 x 403
x 198 mm (RS Components' listing, https://au.rs-online.com/web/p/cooling-units/2671592, read 2026-11-15; its 3 figures
are not labelled, and this file takes them as width, height and depth), 17.44 kg (https://proax.ca/en/product/2578017/
phx1237881, read 2026-11-15), 2 L/min at 1 bar on 24 V DC (https://www.phoenixcontact.com/en-us/products/
cooling-unit-ev-hpc-pcu-01-1237881, read through a web search on 2026-11-15). This arm needs 2 L/min against about 2 bar
(the cable schedule's coolant lines), so the unit bought must have the larger pump. Every other device is drawn at a
class size, marked ASSUMPTION on its part, to be set from the maker's sheet when it is chosen.
"""
from __future__ import annotations

import math

import cadquery as cq
from cadquery import Location

from .. import std
from ..core import PartDef, loc
from .charge_arm import _bent_bar, _bx

# ── the cabinet's own frame: X the site's x, Y above the pad's top, Z from the cabinet's middle (+Z toward the car) ──
PL_H, T_SH, T_GP = 100.0, 2.0, 4.0                  # the plinth, the sheet, the gland plates
Y_FL = PL_H + T_SH                                   # the floor's top
Y_GP = Y_FL + T_GP                                   # the gland plates' top
Z_PL = -167.45 + T_SH + 15.0 + 3.0                   # the mounting plate's face (on 15 mm standoffs off the back wall)
# the DC column: one X a pole (+, -), and the barrier between them
C_P, C_N, X_BAR = 135.0, 235.0, 185.0
Y_INB, Y_FU, Y_KM = (230.0, 310.0), (330.0, 510.0), (560.0, 670.0)       # the input bars, the fuses' and contactors' bodies
Z_LK = Z_PL + 35.0                                   # the copper links lie on this face: the terminal tabs' fronts
# the 2 output blocks (front) and where the arm's DC cores end in them
OB_W, OB_H, OB_D = 66.0, 60.0, 60.0
Y_OBP, Y_OBN = 700.0, 820.0
OB_IN = 15.0                                         # each core goes 15 mm up into its block's entry
# the cooling unit, on the back wall, and its 2 coolant sockets on its right face
CU_W, CU_H, CU_D = 534.0, 403.0, 198.0
CU_X0, CU_Y0 = -303.0, 920.0
# the service-air block on the right wall, in front of the right duct
AV = (301.9, 356.9, 400.0, 580.0, -87.45, -27.45)
# the wiring ducts (60 x 60 outside, 2 mm wall): the right one, the top one, the left one, and one over each left row
DU_Z = (Z_PL, Z_PL + 60.0)
DU_R, DU_T, DU_L = (300.0, 355.0, 300.0, 1600.0), (-350.0, 355.0, 1600.0, 1660.0), (-350.0, -310.0, 320.0, 1600.0)
DU_ROWS = (320.0, 560.0, 820.0)
# the rail rows on the left (their middles), and the devices on them: (id, name, w, h, d, x0, kg, what it is)
RAIL_ROWS = (250.0, 470.0, 720.0)
Y_TOPROW = 1480.0


def build_cabinet(m, site, cab: dict, pad_top: float, deck: float, entries: dict) -> dict:
    """Draw the cabinet on `site` (the stall's frame). `entries`: {supply line id: (x, z, d)} where each of the arm's
    supply lines rises through the right gland plate (site frame). Returns what the caller needs: each line's path in the
    cabinet ('top': points from its end down to where it turns into its drop, and the radii of its corners), the planned
    routes of the lines that run in the ducts ('planned'), the site feeds drawn ('site'), and the pad's shafts."""
    M = 1000.0
    W, H, D = cab['width'] * M, cab['height'] * M, cab['depth'] * M
    cz = -cab['backset'] * M
    XW, ZB, ZF = W / 2, -D / 2, D / 2
    XI, ZBI = XW - T_SH, ZB + T_SH
    Y_RF = H - 30.0                                  # the shell's top; the hood stands 10 mm over it on spacers
    Y_PB = (deck - 150.0) - pad_top                  # the pad's underside (it is cast 150 mm into the slab)

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

    m.subsystem('CABINET', 'Charger cabinet (the post)', 'Fuses, switches, meters and watches the DC from the power unit, cools the '
                'connector, and runs the arm.',
                how=['The power unit makes the DC from the post\'s transformer. It stands away from the post. Its place is not yet decided.',
                     'The DC comes up through the floor onto 2 bars. Each pole has a fuse and a contactor.',
                     'The arm\'s 8 DC cores rise straight from the floor into 2 output blocks. Copper links join each block to its contactor.',
                     'An insulation monitor watches the DC to earth. A DC meter measures each charge for the bill.',
                     'The cooling unit pumps the liquid for the connector. Its air comes in through the doors and goes out at the back.',
                     'The arm\'s controller, the safety controller and the 2 servo drives for the rail and the cross-slide are at the top.',
                     'The service air goes through a filter, a regulator and a valve that locks shut.'],
                specs={'outline': f'{W:.0f} x {H:.0f} x {D:.0f} mm (the twin\'s cabinet)', 'enclosure': 'sheet steel 2 mm, IP54, 2 doors on the car\'s side',
                       'DC': '500 A, 1,000 V: 2 fuses and 2 contactors, one a pole', 'power unit': '350 kW, not drawn: a site decision'},
                group='Cables')

    # ═══════════════════════════════════════════════════════════════ the enclosure ═══
    plinth = (B(-XW, XW, 0, PL_H, ZB, ZF).cut(B(-XW + 3, XW - 3, -1, PL_H + 1, ZB + 3, ZF - 3)))
    gx, gz = XW - 3 - 30, (ZB + 3 + 30, ZF - 3 - 30)
    for sx in (-1, 1):
        for zz in gz:
            plinth = plinth.union(B(sx * gx - 30, sx * gx + 30, 0, 6, zz - 30, zz + 30))
            plinth = plinth.cut(cq.Workplane('XY').add(cq.Solid.makeCylinder(7.0, 10, cq.Vector(*P(sx * gx, -2, zz)), cq.Vector(0, 1, 0))))
    put(m.part(PartDef('CHG-CPL', 'Cabinet plinth, sheet steel 3 mm', plinth.val(), 'steel_paint', 'structure', 'folded sheet',
                       f'{W:.0f} x {D:.0f} x {PL_H:.0f}', 'S235, painted', None,
                       'Lifts the cabinet 100 mm off the pad. The supply lines come up through it. Its front and back plates come off.',
                       {'anchors': '4 x M12, one in each corner gusset'}, 'make')))
    anc = PartDef('CHG-ANC-M12', 'Anchor rod M12 x 120, injection mortar', cq.Workplane('XZ').circle(6).extrude(120)
                  .faces('<Y').chamfer(1.0).translate((0, 30, 0)).val(), 'fast_zn', 'fastener', 'ETA option 1 anchor',
                  'M12 x 120', '8.8', 40.0, 'Holds the cabinet\'s plinth to the pad.',
                  {'embedment': '90 mm', 'torque': 'ASSUMPTION: a typical setting torque for an M12 injection anchor'}, 'buy')
    for sx in (-1, 1):
        for zz in gz:
            put(anc, at(sx * gx, 6, zz), (0, 160, -300))
            put(std.washer(12), std.orient(P(sx * gx, 6, zz), (0, -1, 0)), (0, 170, -300))
            put(std.nut(12), at(sx * gx, 6 + 2.5, zz), (0, 180, -300))
    # the shell: back wall, 2 sides, floor and top, open to the doors; the floor open over the 2 gland plates, the back wall
    # slotted behind the cooling unit (its air goes out there), the top slotted under the hood
    shell = (B(-XW, XW, PL_H, Y_RF, ZB, ZF).cut(B(-XI, XI, Y_FL, Y_RF - T_SH, ZBI, ZF + 1))
             .cut(B(85, 340, PL_H - 1, Y_FL + 1, -150, 65)).cut(B(-330, -210, PL_H - 1, Y_FL + 1, -150, -90)))
    slots = cq.Workplane('XY').add([cq.Solid.makeBox(150, 8, 6, cq.Vector(xs - 75, pad_top + ys - 4, cz + ZB - 2))
                                    for xs in (-230.0, -60.0, 110.0) for ys in range(960, 1300, 20)])
    vents = cq.Workplane('XY').add([cq.Solid.makeBox(500, 6, 10, cq.Vector(-250, pad_top + Y_RF - 4, cz + zs - 5))
                                    for zs in (-100.0, -50.0, 0.0, 50.0, 100.0)])
    shell = shell.cut(slots).cut(vents)
    put(m.part(PartDef('CHG-CBD', 'Cabinet body, sheet steel 2 mm', shell.val(), 'steel_paint', 'structure', 'folded and welded sheet',
                       f'{W:.0f} x {Y_RF - PL_H:.0f} x {D:.0f}', 'S235, painted RAL 7016', None,
                       'Closes the post. The doors are on the car\'s side. The cooling unit\'s warm air leaves through the slots in the back.',
                       {'protection': 'IP54 with the doors shut (ASSUMPTION: the filter mats behind the louvres)'}, 'make')))
    hood = B(-XW, XW, H - 20, H, ZB, ZF).cut(B(-XW + 3, XW - 3, H - 21, H - 3, ZB + 3, ZF - 3))
    put(m.part(PartDef('CHG-CRF', 'Cabinet rain hood', hood.val(), 'steel_paint', 'structure', 'folded sheet 3 mm',
                       f'{W:.0f} x {D:.0f}', '', None, 'Keeps rain off the top. The 10 mm gap under its lip lets the warm air out.', {}, 'make')))
    rsp = m.part(PartDef('CHG-CRS', 'Hood spacer', cq.Workplane('XY').box(30, H - 3 - Y_RF, 30, centered=(True, False, True)).val(),
                         'steel_paint', 'structure', 'cut bar', f'30 x 30 x {H - 3 - Y_RF:.0f}', '', None, 'Holds the hood over the top.', {}, 'make'))
    for sx in (-1, 1):
        for zz in (ZB + 3 + 20, ZF - 3 - 20):
            put(rsp, at(sx * (XW - 3 - 20), Y_RF, zz), (0, 260, -300))
    # the doors: 2 trays on the car's side, louvred in front of the cooling unit (its intake); the right one takes the handle
    DW, DH = XI - 3.0, (Y_RF - 5.0) - (PL_H + 5.0)

    def door(handle: bool) -> cq.Shape:
        d = (cq.Workplane('XY').box(DW, DH, 22, centered=(True, False, False)).translate((0, 0, -22))
             .cut(cq.Workplane('XY').box(DW - 4, DH - 4, 21, centered=(True, False, False)).translate((0, 2, -23))))
        lv = cq.Workplane('XY').add([cq.Solid.makeBox(260, 8, 6, cq.Vector(-130, ys - 4, -4)) for ys in range(940, 1300, 18)])
        d = d.cut(lv.translate((0, -(PL_H + 5.0), 0)))
        if handle:
            d = d.cut(cq.Workplane('XY').box(30, 120, 6, centered=(True, False, False)).translate((-DW / 2 + 40, 700.0 - (PL_H + 5.0), -4)))
        return d.val()
    for sx, pid, handle in ((-1, 'CHG-CDL', False), (1, 'CHG-CDR', True)):
        pd = m.part(PartDef(pid, f'Cabinet door, {"left" if sx < 0 else "right"}, sheet steel 2 mm', door(handle), 'steel_paint', 'structure',
                            'folded sheet', f'{DW:.0f} x {DH:.0f} x 22', 'S235, painted RAL 7016', None,
                            'Opens to the car\'s side. Louvres in front of the cooling unit let its air in.' +
                            (' It carries the lockable handle.' if handle else ''),
                            {'opening': 'the arm parks at the end of its rail before a door opens (ASSUMPTION: the door sweeps 354 mm, and the riser stands 479 mm off the face)'},
                            'make'))
        put(pd, at(sx * (1.5 + DW / 2), PL_H + 5.0, ZF), (sx * 200, 0, 200))
    put(m.part(PartDef('CHG-CHD', 'Swing handle with cylinder lock, flush', cq.Workplane('XY').box(30, 120, 6, centered=(True, False, False)).val(),
                       'a356_dark', 'structure', 'catalogue part', '30 x 120', 'IP65', None, 'Opens and locks the right door. The left door has a rod lock inside.',
                       {}, 'buy', mass_override=0.4)), at(1.5 + 40, 700.0, ZF - 6), (200, 0, 240))
    hinge = m.part(PartDef('CHG-CHG', 'Door hinge, concealed', cq.Workplane('XY').box(30, 60, 20, centered=(True, False, False)).val(),
                           'a356_dark', 'structure', 'catalogue part', '30 x 60 x 20', '', None, 'Carries a door on the side wall.', {}, 'buy', mass_override=0.15))
    for sx in (-1, 1):
        for yh in (300.0, 900.0, 1500.0):
            put(hinge, at(sx * (XI - 15), yh, ZF - 22 - 20), (sx * 160, 0, 160))
    # the mounting plate on 6 standoffs off the back wall, open where the cooling unit stands on the wall
    mp = B(-340, 340, 120, 1660, Z_PL - 3, Z_PL).cut(B(-310, 238, 912, 1330, Z_PL - 4, Z_PL + 1))
    put(m.part(PartDef('CHG-CMT', 'Mounting plate, galvanised 3 mm', mp.val(), 'steel', 'structure', 'cut plate', '680 x 1540 x 3',
                       'DX51D Z275', None, 'Carries every device and duct. It is cut away where the cooling unit stands on the back wall.', {}, 'make')),
        ex=(0, 0, -340))
    sto = m.part(PartDef('CHG-CMS', 'Mounting plate standoff, M8', cq.Workplane('XY').add(cq.Solid.makeCylinder(8, 15, cq.Vector(0, 0, 0), cq.Vector(0, 0, 1))).val(),
                         'fast_zn', 'structure', 'catalogue part', 'D 16 x 15', '', None, 'Holds the mounting plate 15 mm off the back wall.', {}, 'buy'))
    for sx in (-1, 1):
        for ys in (140.0, 890.0, 1640.0):
            put(sto, at(sx * 320, ys, ZBI), (0, 0, -360))

    # ═══════════════════════════════════════════════════════════ the gland plates ═══
    gp = B(75, 350, Y_FL, Y_GP, -158, 75)
    holes = []
    for lid, (x, z, d) in entries.items():
        holes.append((x, z - cz, d / 2 + 0.5))
    FEED_X = (112.0, 158.0, 212.0, 258.0)            # the 4 DC feed cores: + + - -
    Z_FD, D_FD = -108.45, 26.0                       # their line (on the input bars' face), and their diameter
    AIR_IN = (330.0, -75.0)                          # the site's air, up into the air block (inside the floor's opening)
    holes += [(x, Z_FD, D_FD / 2 + 0.5) for x in FEED_X] + [(AIR_IN[0], AIR_IN[1], 6.5)]
    for (x, z, r) in holes:
        gp = gp.cut(cq.Workplane('XY').add(cq.Solid.makeCylinder(r, 20, cq.Vector(*P(x, Y_FL - 5, z)), cq.Vector(0, 1, 0))))
    put(m.part(PartDef('CHG-BGP', f'Cabinet gland plate, right, {len(holes)} entries', gp.val(), 'steel_s355', 'electrical', 'cut plate 4 mm',
                       '275 x 233 x 4', 'IP54 with its glands', None,
                       'Closes the floor over the arm\'s supply shaft and the site shaft behind it. Each line enters through it.',
                       {'glands': 'one a line, under the plate (not drawn)'}, 'make')), ex=(0, 80, -260))
    AUX_IN, NET_IN, PE_IN = (-270.0, -110.0), (-320.0, -98.0), (-250.0, -132.45)   # clear of the plinth's corner gusset
    gl = B(-340, -200, Y_FL, Y_GP, -158, -82)
    for (x, z, r) in ((AUX_IN[0], AUX_IN[1], 8.0), (NET_IN[0], NET_IN[1], 4.5), (PE_IN[0], PE_IN[1], 6.5)):
        gl = gl.cut(cq.Workplane('XY').add(cq.Solid.makeCylinder(r, 20, cq.Vector(*P(x, Y_FL - 5, z)), cq.Vector(0, 1, 0))))
    put(m.part(PartDef('CHG-BGL', 'Cabinet gland plate, left, 3 entries', gl.val(), 'steel_s355', 'electrical', 'cut plate 4 mm',
                       '140 x 76 x 4', 'IP54 with its glands', None, 'Closes the floor over the left site shaft: the auxiliary supply, the network and the earth.',
                       {}, 'make')), ex=(0, 80, -260))

    # ═══════════════════════════════════════════════════════════ the DC column ═══
    # IN: the power unit's 4 cores (2 a pole) on 2 bars; per pole a fuse, then a contactor; their terminal tabs and the
    # links between them all on one face (Z_LK), so each link lies flat on what it joins
    copper_bar = lambda w, h, t: cq.Workplane('XY').box(w, h, t, centered=(True, False, False)).val()   # noqa: E731
    inb = m.part(PartDef('CHG-CBI', 'DC input bar, copper 90 x 80 x 10', copper_bar(90, 80, 10), 'copper', 'electrical', 'EN 13601',
                         '90 x 80 x 10', 'Cu-ETP, tinned', None, 'Takes the 2 cores of one pole from the power unit and the link to its fuse.', {}, 'make'))
    ins = m.part(PartDef('CHG-CIS', 'Busbar insulator M8, 25 mm', cq.Workplane('XY').add(cq.Solid.makeCylinder(15, 25, cq.Vector(0, 0, 0), cq.Vector(0, 0, 1))).val(),
                         'pa66_red', 'electrical', 'catalogue part', 'D 30 x 25', 'GPO-3', None, 'Holds a DC bar off the mounting plate.', {}, 'buy'))
    for c in (C_P, C_N):
        put(inb, at(c, Y_INB[0], Z_LK - 10), (0, 0, -120))
        for dx in (-25, 25):
            put(ins, at(c + dx, 270.0, Z_PL), (0, 0, -140))
    lug = (cq.Workplane('XY').add(cq.Solid.makeCylinder(11.5, 40, cq.Vector(0, -80, 0), cq.Vector(0, 1, 0)))
           .union(cq.Workplane('XY').box(32, 40, 8, centered=(True, False, True)).translate((0, -40, 0)))
           .cut(cq.Workplane('XY').add(cq.Solid.makeCylinder(6.5, 20, cq.Vector(0, -20, -10), cq.Vector(0, 0, 1)))))
    lug_pd = m.part(PartDef('CHG-CLG', 'Cable lug 185 mm2, M12, tinned copper', lug.val(), 'copper', 'electrical', 'DIN 46235',
                            '185 mm2, M12', '', None, 'Ends a DC feed core on its input bar.', {}, 'buy', mass_override=0.12))
    for x in FEED_X:
        put(lug_pd, at(x, Y_INB[0] + 40, Z_FD), (0, 0, -100))
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
                            {'size': 'a class size (ASSUMPTION). A 1,000 V DC contactor of this class is about 95 x 44 x 90 mm (TDK HVC27, '
                                     'https://www.mouser.se/epcos-tdk-hvc27-500c-24p-contactor, read 2026-11-15)'}, 'buy', mass_override=1.5))
    for c in (C_P, C_N):
        put(fus_pd, at(c, Y_FU[0], Z_PL), (0, 0, -60))
        put(kmc_pd, at(c, Y_KM[0], Z_PL), (0, 0, -60))
    lk1 = m.part(PartDef('CHG-CBL1', 'Copper link 30 x 5, input bar to fuse', copper_bar(30, 45, 5), 'copper', 'electrical', 'EN 13601',
                         '30 x 5 x 45', 'Cu-ETP, tinned', None, 'Joins an input bar to its fuse.', {}, 'make'))
    lk2 = m.part(PartDef('CHG-CBL2', 'Copper link 30 x 5, fuse to contactor', copper_bar(30, 40, 5), 'copper', 'electrical', 'EN 13601',
                         '30 x 5 x 40', 'Cu-ETP, tinned', None, 'Joins a fuse to its contactor.', {}, 'make'))
    for c in (C_P, C_N):
        put(lk1, at(c, 280.0, Z_LK), (0, 0, -40))
        put(lk2, at(c, 515.0, Z_LK), (0, 0, -40))
    for (pid, c, y_t, pole) in (('CHG-CBL3P', C_P, Y_OBP + 30.0, '+'), ('CHG-CBL3N', C_N, Y_OBN + 30.0, '-')):
        shp, L_ = _bent_bar([P(c, 675.0, Z_LK + 2.5), P(c, y_t, Z_LK + 2.5), P(c, y_t, -OB_D / 2)], [10.0], 30.0, 5.0, (1.0, 0.0, 0.0))
        put(m.part(PartDef(pid, f'Copper link 30 x 5, DC{pole} contactor to output block', shp, 'copper', 'electrical', 'EN 13601',
                           f'30 x 5 x {L_:.0f}', 'Cu-ETP, tinned', None, f'Brings the DC{pole} pole forward from its contactor into its output block.'
                           + (' The DC meter\'s shunt sits in it (not drawn).' if pole == '-' else ''), {}, 'make')), ex=(0, 0, -40))
    put(m.part(PartDef('CHG-CBA', 'Pole barrier, GPO-3 4 mm', B(X_BAR - 2, X_BAR + 2, 225, 700, Z_PL, -45).val(), 'pa66_red', 'electrical',
                       'cut sheet', '475 x 102 x 4', 'GPO-3', None, 'Stands between the 2 poles of the DC column.', {}, 'make')), ex=(0, 0, -80))
    ob = cq.Workplane('XY').box(OB_W, OB_H, OB_D, centered=(True, False, True))
    for dx in (-24.75, -8.25, 8.25, 24.75):
        ob = ob.cut(cq.Workplane('XY').add(cq.Solid.makeCylinder(7.7, OB_IN + 1.0, cq.Vector(dx, -1, 0), cq.Vector(0, 1, 0))))
    ob_pd = m.part(PartDef('CHG-COB', 'DC output block, 4 x 50 mm2 in, insulated', ob.val(), 'pa66', 'electrical', 'IEC 60947-7-1',
                           f'{OB_W:.0f} x {OB_H:.0f} x {OB_D:.0f}', '', None,
                           'Joins the 4 cores of one pole to the arm. Each core enters from below and is clamped; its contactor\'s link enters at the back.',
                           {'entries': '4 x 50 mm2 from below at 16.5 mm, the cores\' own spacing', 'size': 'a class size (ASSUMPTION)'}, 'buy', mass_override=0.9))
    put(ob_pd, at(153.5, Y_OBP, 0), (0, 0, 60))
    put(ob_pd, at(219.5, Y_OBN, 0), (0, 0, 60))

    # ═════════════════════════════════════════════ the cooling unit and the service air ═══
    cu = cq.Workplane('XY').box(CU_W, CU_H, CU_D, centered=False)
    cu = cu.cut(cq.Workplane('XY').add([cq.Solid.makeBox(CU_W - 80, 4, 3, cq.Vector(40, ys, CU_D - 2)) for ys in range(30, int(CU_H) - 30, 12)]))
    put(m.part(PartDef('CHG-CCU', 'Connector cooling unit, liquid to air, 24 V DC', cu.val(), 'steel_paint', 'fluid', 'catalogue part',
                       f'{CU_W:.0f} x {CU_H:.0f} x {CU_D:.0f}', '', None,
                       'Pumps 50 % glycol through the connector\'s contacts and cools it in air. Its fan draws air in through the doors and out at the back.',
                       {'flow': '2 L/min against about 2 bar (the arm\'s 8 x 6 tubes, both ways): a larger pump than the unit of this size gives (1 bar)',
                        'size and mass': 'Phoenix Contact EV-HPC-PCU-01: 534 x 403 x 198 mm, 17.44 kg (sources in charge_cabinet.py)'},
                       'buy', mass_override=17.44)), at(CU_X0, CU_Y0, ZBI), (0, 0, 150))
    sock = (cq.Workplane('YZ').circle(7.0).extrude(16.0).cut(cq.Workplane('YZ', origin=(4.0, 0, 0)).circle(4.05).extrude(13.0)))
    sock_pd = m.part(PartDef('CHG-CCS', 'Coolant push-in socket 8 mm, stainless', sock.val(), 'ss316', 'fluid', 'catalogue part', '8 mm',
                             '', None, 'Takes a coolant tube from the arm at the cooling unit. The tube goes 12 mm in.', {}, 'buy'))
    CS_Y, CR_Y, Z_CL = 960.0, 1000.0, 16.0
    for ys in (CS_Y, CR_Y):
        put(sock_pd, at(CU_X0 + CU_W, ys, Z_CL), (60, 0, 150))
    av = B(*AV[0:2], *AV[2:4], *AV[4:6])
    put(m.part(PartDef('CHG-CAV', 'Service air block: filter, regulator, lockable 3/2 valve', av.val(), 'al6061_blk', 'fluid', 'catalogue part',
                       '55 x 180 x 60', '', None, 'Cleans the site\'s air, sets it to 6 bar and sends it to the arm. Its valve locks shut for work on the arm.',
                       {'size': 'a class size (ASSUMPTION)'}, 'buy', mass_override=1.6)), ex=(80, 0, -60))
    s6 = (cq.Workplane('XY').add(cq.Solid.makeCylinder(6.0, 16, cq.Vector(0, 0, 0), cq.Vector(0, 0, 1)))
          .cut(cq.Workplane('XY').add(cq.Solid.makeCylinder(3.05, 13, cq.Vector(0, 0, 4), cq.Vector(0, 0, 1)))))
    put(m.part(PartDef('CHG-CAS6', 'Push-in fitting 6 mm, air block outlet', s6.val(), 'ss316', 'fluid', 'ISO 14743', 'G 1/8, 6 mm', '', None,
                       'Takes the arm\'s air tube. The tube goes 12 mm in.', {}, 'buy')), at(330.0, 450.0, AV[5]), (80, 0, -40))
    s12 = (cq.Workplane('XY').add(cq.Solid.makeCylinder(9.0, 16, cq.Vector(0, -16, 0), cq.Vector(0, 1, 0)))
           .cut(cq.Workplane('XY').add(cq.Solid.makeCylinder(6.05, 13, cq.Vector(0, -17, 0), cq.Vector(0, 1, 0)))))
    put(m.part(PartDef('CHG-CAS12', 'Push-in fitting 12 mm, air block inlet', s12.val(), 'ss316', 'fluid', 'ISO 14743', 'G 1/4, 12 mm', '', None,
                       'Takes the site\'s air tube. The tube goes 12 mm in.', {}, 'buy')), at(AIR_IN[0], AV[2], AIR_IN[1]), (80, -40, -40))

    # ══════════════════════════════════════════════ the earth bar, the rails, the devices ═══
    pe = B(-300, -200, 130, 160, Z_PL + 10, Z_PL + 20)
    put(m.part(PartDef('CHG-CPE', 'Earth bar, copper 100 x 30 x 10', pe.val(), 'copper', 'electrical', 'EN 13601', '100 x 30 x 10',
                       'Cu-ETP, tinned', None, 'Takes the site\'s earth and every earth wire in the cabinet. The plate and the doors are bonded to it.',
                       {}, 'make')), ex=(0, -40, -80))
    pst = m.part(PartDef('CHG-CPT', 'Earth bar standoff, M8', cq.Workplane('XY').add(cq.Solid.makeCylinder(6, 10, cq.Vector(0, 0, 0), cq.Vector(0, 0, 1))).val(),
                         'pa66_red', 'electrical', 'catalogue part', 'D 12 x 10', '', None, 'Holds the earth bar 10 mm off the plate.', {}, 'buy'))
    for xs in (-290.0, -210.0):
        put(pst, at(xs, 145.0, Z_PL), (0, -40, -100))
    rail_l = m.part(PartDef('CHG-CDR1', 'Mounting rail 35 x 7.5, 390 mm', cq.Workplane('XY').box(390, 35, 7.5, centered=(False, True, False)).val(),
                            'steel', 'structure', 'EN 60715', '35 x 7.5 x 390', 'galvanised', None, 'Carries a row of devices.', {}, 'buy'))
    rail_t = m.part(PartDef('CHG-CDR2', 'Mounting rail 35 x 7.5, 300 mm', cq.Workplane('XY').box(300, 35, 7.5, centered=(False, True, False)).val(),
                            'steel', 'structure', 'EN 60715', '35 x 7.5 x 300', 'galvanised', None, 'Carries the top row of devices.', {}, 'buy'))
    for yr in RAIL_ROWS:
        put(rail_l, at(-305.0, yr, Z_PL), (0, 0, -60))
    put(rail_t, at(-305.0, Y_TOPROW, Z_PL), (0, 0, -60))
    Z_DV = Z_PL + 7.5                                 # a device's back, on its rail
    rows = [
        (RAIL_ROWS[0], [('CHG-CQS', 'Auxiliary isolator, 4 pole, 40 A', 72, 90, 70, -305, 0.5, 'Switches the cabinet\'s auxiliary supply off for work.'),
                        ('CHG-CMB', 'Miniature circuit breakers, 6 circuits', 108, 90, 70, -230, 0.8, 'Protect the cooling unit, the drives, the supplies and the lights.'),
                        ('CHG-CRC', 'Residual current device, 30 mA', 36, 90, 70, -119, 0.3, 'Trips on an earth fault in the auxiliary circuits.'),
                        ('CHG-CSP', 'Surge arrester, auxiliary supply', 54, 90, 70, -80, 0.4, 'Takes a surge on the auxiliary supply to earth.')]),
        (RAIL_ROWS[1], [('CHG-CPS24', 'Power supply 24 V DC, 20 A', 65, 125, 125, -305, 1.0, 'Feeds the controllers, the cooling unit and the valves.'),
                        ('CHG-CPS24', 'Power supply 24 V DC, 20 A', 65, 125, 125, -237, 1.0, 'Feeds the controllers, the cooling unit and the valves.'),
                        ('CHG-CPS48', 'Power supply 48 V DC, 20 A', 85, 125, 125, -169, 1.3, 'Feeds the joints\' drives through the joint supply cable (ASSUMPTION: they take 48 V).'),
                        ('CHG-CIM', 'Insulation monitor for the DC output', 72, 90, 70, -80, 0.3, 'Watches the DC to earth. It stops the charge on a fault.'),
                        ('CHG-CDM', 'DC energy meter, with shunt', 85, 90, 70, -4, 0.5, 'Measures each charge for the bill. Its shunt is in the DC- link.')]),
        (RAIL_ROWS[2], [('CHG-CEC', 'Charge controller, CCS and NACS communication', 90, 110, 65, -305, 0.4, 'Talks to the car through the connector and to OTTO-Q.'),
                        ('CHG-CSF', 'Safety controller', 45, 100, 115, -211, 0.3, 'Takes the scanner and the emergency stop. It cuts the drives\' torque.'),
                        ('CHG-CNS', 'Network switch, managed, 8 ports', 50, 140, 110, -162, 0.6, 'Joins the controllers to the depot\'s network.')]),
        (Y_TOPROW, [('CHG-CAC', 'Arm controller', 150, 200, 100, -305, 2.5, 'Moves the arm: it runs its 6 joints and the 2 servo drives.'),
                    ('CHG-CSD', 'Servo drive, 1 kW, 400 V', 55, 200, 175, -150, 1.5, 'Drives the rail gearmotor or the cross-slide motor.'),
                    ('CHG-CSD', 'Servo drive, 1 kW, 400 V', 55, 200, 175, -90, 1.5, 'Drives the rail gearmotor or the cross-slide motor.')]),
    ]
    devs = {}
    for (yr, items) in rows:
        for (pid, name, w, h, d, x0, kg, fn) in items:
            pd = dev(pid, name, w, h, d, 'pa66', kg, fn, {})
            put(pd, at(x0 + w / 2, yr - h / 2, Z_DV), (0, 0, 60))
            devs.setdefault(pid, []).append((x0 + w / 2, yr - h / 2, yr + h / 2))

    # ═════════════════════════════════════════════════════════════ the wiring ducts ═══
    def duct(pid, name, x0, x1, y0, y1, along_y):
        o = cq.Workplane('XY').box(x1 - x0, y1 - y0, DU_Z[1] - DU_Z[0], centered=False)
        i = (cq.Workplane('XY').box(x1 - x0 - 4, y1 - y0 + 2, DU_Z[1] - DU_Z[0] - 4, centered=False).translate((2, -1, 2)) if along_y else
             cq.Workplane('XY').box(x1 - x0 + 2, y1 - y0 - 4, DU_Z[1] - DU_Z[0] - 4, centered=False).translate((-1, 2, 2)))
        return m.part(PartDef(pid, name, o.cut(i).val(), 'pa66', 'electrical', 'EN 50085-2-3', f'60 x 60 x {max(x1 - x0, y1 - y0):.0f}', 'PVC, slotted',
                              None, 'Carries the cabinet\'s wiring and the arm\'s small cables between the devices.', {}, 'buy'))
    put(duct('CHG-CWR', 'Wiring duct 60 x 60, right', DU_R[0], DU_R[1], DU_R[2], DU_R[3], True), at(DU_R[0], DU_R[2], DU_Z[0]), (0, 0, -40))
    put(duct('CHG-CWT', 'Wiring duct 60 x 60, top', DU_T[0], DU_T[1], DU_T[2], DU_T[3], False), at(DU_T[0], DU_T[2], DU_Z[0]), (0, 0, -40))
    put(duct('CHG-CWL', 'Wiring duct 60 x 40, left', DU_L[0], DU_L[1], DU_L[2], DU_L[3], True), at(DU_L[0], DU_L[2], DU_Z[0]), (0, 0, -40))
    row_duct = duct('CHG-CWH', 'Wiring duct 60 x 60, over a row', -310.0, 80.0, 0.0, 60.0, False)
    for yd in DU_ROWS:
        put(row_duct, at(-310.0, yd, DU_Z[0]), (0, 0, -40))

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
    for i, x in enumerate(FEED_X):
        pole, k = ('+', i + 1) if i < 2 else ('-', i - 1)
        feed(f'CHG-SD{"P" if pole == "+" else "N"}{k}', f'DC feed cable, DC{pole}, core {k} of 2, 1 x 185 mm2', x, Z_FD, Y_INB[0] - 40.0,
             D_FD / 2, 'cable_red' if pole == '+' else 'cable', 'electrical',
             f'Brings half the DC{pole} current from the power unit up into the cabinet, to its lug on the input bar.',
             {'conductor': '185 mm2 copper, class 5, 1 kV (ASSUMPTION: 2 a pole carry 500 A; the site\'s cable calculation sets it)'}, 'D 26')
    feed('CHG-SAR', 'Site air tube 12 x 9, polyurethane', AIR_IN[0], AIR_IN[1], AV[2] - 4.0, 6.0, 'pu', 'fluid',
         'Brings the site\'s compressed air up into the cabinet, to the air block.', {}, 'D 12')
    feed('CHG-SAX', 'Auxiliary supply cable 5 x 6 mm2', AUX_IN[0], AUX_IN[1], RAIL_ROWS[0] - 45.0, 7.5, 'cable', 'electrical',
         'Brings 400 V auxiliary power up into the cabinet, to the auxiliary isolator.', {'conductor': '5 x 6 mm2 (ASSUMPTION)'}, 'D 15')
    feed('CHG-SNW', 'Network cable, industrial Cat 6A, site to cabinet', NET_IN[0], NET_IN[1], DU_L[2] + 10.0, 4.0, 'cable', 'electrical',
         'Brings the depot\'s network up into the cabinet\'s left duct.', {}, 'D 8')
    feed('CHG-SPE', 'Earth conductor 50 mm2, green-yellow', PE_IN[0], PE_IN[1], 130.0, 6.0, 'cable', 'electrical',
         'Joins the cabinet\'s earth bar to the site\'s earth.', {'conductor': '50 mm2 copper (ASSUMPTION)'}, 'D 12')
    m.parts['CHG-SNW'].end_in = {'start': 'CHG-PAD', 'end': 'CHG-CWL'}

    # ═════════════════════════════════════════════ the arm's lines: their paths in the cabinet ═══
    top = {}
    for lid, (x, z, d) in entries.items():
        Z = z - cz
        if lid.startswith('CHG-LD'):                 # a DC core: straight up into its output block
            y_end = (Y_OBP if lid.startswith('CHG-LDP') else Y_OBN) + OB_IN
            top[lid] = ([P(x, y_end, Z)], [])
        elif lid == 'CHG-LCS':                       # to the cooling unit's supply socket, up the right of the DC column
            xs = CU_X0 + CU_W + 4.0
            top[lid] = ([P(xs, CS_Y, Z), P(279.0, CS_Y, Z), P(279.0, 640.0, Z), P(x, 640.0, Z)], [4 * d] * 3)
        elif lid == 'CHG-LCR':
            xs = CU_X0 + CU_W + 4.0
            top[lid] = ([P(xs, CR_Y, Z), P(288.0, CR_Y, Z), P(288.0, 580.0, Z), P(x, 580.0, Z)], [4 * d] * 3)
        elif lid == 'CHG-LAR':                       # to the air block's outlet
            top[lid] = ([P(330.0, 450.0, AV[5] + 4.0), P(330.0, 450.0, Z), P(330.0, 360.0, Z), P(x, 360.0, Z)], [4 * d] * 3)
        else:                                        # a small cable: it ends at the gland plate; its run in the ducts is planned
            top[lid] = ([P(x, Y_GP + 0.5, Z)], [])

    # the planned routes in the ducts: from the gland plate to the right duct, up it, across the top and to the device
    def ducted(x, Z, x_dev, y_dev, via_left_row=None):
        pts = [(x, Y_GP, Z), (x, 200.0, Z), (327.0, 200.0, Z), (327.0, 200.0, -117.0), (327.0, 1630.0, -117.0)]
        if via_left_row is None:
            pts += [(x_dev, 1630.0, -117.0), (x_dev, y_dev, -117.0)]
        else:                                        # down the left duct to a row's duct, along it, down to the device
            pts += [(-330.0, 1630.0, -117.0), (-330.0, via_left_row + 30.0, -117.0), (x_dev, via_left_row + 30.0, -117.0), (x_dev, y_dev, -117.0)]
        return pts
    (cac_x, _, cac_top), = devs['CHG-CAC']
    (sx_x, _, sx_top), (sz_x, _, sz_top) = devs['CHG-CSD']
    (sf_x, _, sf_top), = devs['CHG-CSF']
    (ns_x, _, ns_top), = devs['CHG-CNS']
    planned = {}
    for lid, x_dev, y_dev, row, to in (('CHG-LJS', cac_x - 30, cac_top, None, 'the arm controller (CHG-CAC) and the 48 V supply (CHG-CPS48), through it'),
                                       ('CHG-LTL', cac_x + 30, cac_top, None, 'the arm controller (CHG-CAC)'),
                                       ('CHG-LSF', sf_x, sf_top, DU_ROWS[2], 'the safety controller (CHG-CSF)'),
                                       ('CHG-LMX', sx_x, sx_top, None, 'its servo drive (CHG-CSD, the left one)'),
                                       ('CHG-LMZ', sz_x, sz_top, None, 'its servo drive (CHG-CSD, the right one)')):
        x, z, d = entries[lid]
        planned[lid] = (ducted(x, z - cz, x_dev, y_dev, row), to)
    planned['CHG-SNW'] = ([(NET_IN[0], DU_L[2] + 10.0, NET_IN[1]), (-330.0, DU_ROWS[2] + 30.0, -117.0), (ns_x, DU_ROWS[2] + 30.0, -117.0),
                           (ns_x, ns_top, -117.0)], 'the network switch (CHG-CNS)')
    return {'top': top, 'planned': planned, 'site': site_lines, 'Y_GP': pad_top + Y_GP,
            'shafts': [(95.0, 355.0, cz - 145.0, cz - 65.0), (-340.0, -200.0, cz - 150.0, cz - 90.0)],
            'devices': devs}
