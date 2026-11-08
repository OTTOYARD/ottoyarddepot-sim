# Sources for the robot CAD

Every external fact the CAD uses, with where it was read and when (otto-q-core CLAUDE.md rule 3: a fact
without a URL is not a fact). Read 2026-11-07 unless noted. Values the CAD draws or sizes from are marked
**used**; values only checked against are marked *checked*.

## Fastener standards (dimension tables)

| Standard | What | Source |
|---|---|---|
| ISO 4762 | socket head cap screw: head dia dk, head height k, socket s (**used**, nominal max) | https://fasten.it/norms/norm/din_en_iso_4762 · https://engineersedge.com/iso_socket_head_screw.htm (dk M3..M8 confirmed: 5.5, 7, 8.5, 10, 13) |
| ISO 7089 | plain washer d1, d2, h (**used**) | https://www.jcfasteners.com/wp-content/uploads/ISO-7089-Plain-Washer-B6iD02-SS316.pdf (M5 10/1.0, M6 12/1.6, M8 16/1.6, M10 20/2.0, M12 24/2.5) · https://www.mcmaster.com/shims/metric-general-purpose-washers/ (M4 9/0.8, M16 30/3.0) |
| ISO 7380-1, ISO 10642, ISO 4017, ISO 4032, ISO 7040, ISO 8734, ISO 4026, DIN 471/472, DIN 25201 | head and nut sizes (**used**) | tables in `otto_cad/std.py`, from the standards' nominal values. ASSUMPTION where not cross-read above: check against a supplier sheet before release. |
| ISO 261 / ISO 273 | coarse pitch, medium clearance holes (**used**) | standard values |
| ISO 898-1, ISO 3506-1 | proof stress 8.8 = 640 MPa, 10.9 = 940, 12.9 = 1100, A2-70 = 450, A4-80 = 600 (**used**) | standard values |

## Tightening torque

Computed by the VDI 2230 Part 1 (2015) method, not read from a table: preload at 90 % of proof stress under
tension plus torsion, mu_G = mu_K = 0.12 (`std.vdi2230`). *Checked* against published tables:

| Size | grade | this CAD | published | source |
|---|---|---|---|---|
| M8 | 8.8 | 25.3 N m | 25 N m (VDI 2230 table, mu 0.12) | standard table, widely reproduced |
| M8 | 12.9 | 43.6 N m | 43 N m (VDI 2230 table, mu 0.12) | standard table |
| M12 | 10.9 | 125 N m | 114 N m at mu 0.125 | https://atlascopco.com/en-us/itba/expert-hub/articles/bolt-torque-chart-the-atlas-copco-guide |
| M16 | 8.8 | 210 N m | 206 N m (VDI 2230 table, mu 0.12) | standard table |

Button-head (ISO 7380) and countersunk (ISO 10642) screws are set to 80 % of the cap-screw value: their heads
carry less load.

## Strain-wave gear ratings (ratio 100:1)

Repeated peak / momentary peak torque, catalogue component sets (**used** to size every joint):
size 17: 70 / 143 N m · size 20: 107 / 191 · size 25: 204 / 369 · size 32: 433 / 841 · size 40: 738 / 1,400 ·
size 50: 1,274 / 2,678. Source: https://www.harmonicdrive.net/products/component-sets/cup-type/csg-2a (read through
search results 2026-11-07); size 25 also in https://harmonicdrive.de/fileadmin/Downloads/Produkte/Produktbroschueren/Harmonic_Drive_Triangle_Technology_EN_1064631.pdf.
On screen the gear is named by what it is (strain-wave gear, size and ratio), not by a product name
(src/lib/publicNames.ts rule).

ASSUMPTION: the gear-set envelopes (outer diameter, cup length) are scaled from the size code
(pitch diameter about size x 2.54 mm) and are close to, not copied from, catalogue drawings.
The teeth are drawn simplified (64 a gear); the real counts (200 and 202 at 100:1) are in each part's spec.

## Clean arm J4 (the wrist pitch, design finding 9)

- Gear: a size 17 strain-wave unit, 100:1, repeated peak 70 N m (the component-set rating above, **used**). The
  wand side J4 turns weighs 5.15 kg (the CAD's masses) and holds 24.0 N m level at full reach: x2.9.
- Unit envelope OD 72 x 38 mm with a 100 mm output flange, 0.9 kg: ASSUMPTION (class envelope, scaled like the
  component sets), pending a supplier drawing.
- Motor: a 200 W servo, 40 mm frame, with brake and encoder, 40 x 40 x 106 mm, 0.64 N m continuous, 0.8 kg:
  ASSUMPTION (class figures for the frame size), pending a supplier sheet. Through the 2:1 belt and the gear at an
  assumed 70 % overall efficiency it gives about 90 N m continuous, so the gear's 70 N m sets the limit.
- Belt: HTD 3M, 9 mm wide, 40 and 20 teeth (ISO 13050 profile, **used**).

## Wash hall clearance (design finding 8)

The bay walls and partitions are the twin's (`structurePlan.WASH_SHELL`: outer walls 0.6 u, partitions 0.4 u, bays
18 u apart); the CAD keeps every part 30 mm or more inside them (`cadYard.test.ts`). The rail end stops (a 135 x 40 x
70 mm block in each rail end, a 32 x 25 mm polyurethane buffer, 2 x M10) are sized here: ASSUMPTION, typical of a
floor-rail gantry's overtravel stop, pending the supplier's rail system.

## Robotic charging

- Vision for coarse-to-fine alignment plus compliance (passive, impedance or force control) for the final insertion
  is the consistent pattern in the literature; open problems are lighting, socket variety and force monitoring
  (*checked*, design pattern followed): https://ar5iv.labs.arxiv.org/html/1703.05381 ·
  https://www.flexiv.com/case-studies/ev_charging_solution · https://chargedevs.com/features/rocsys-automates-charging-stations-with-soft-robots/
- CCS1 / SAE J1772 connector face about 43.8 mm diameter for the AC (J1772) part (**used** for the face boss):
  https://en.wikipedia.com/wiki/CCS1 · DC pin diameter not public in the results read: the 8 mm DC socket is an
  ASSUMPTION pending the standard's drawing.
- Robot tool flange ISO 9409-1-50-4-M6 (pitch circle 50, 4 x M6) (**used**): standard.

## Rollover wash (OTTO-WASH)

- Side brush 965 mm at 113 rpm, roof brush 880 mm at 135 rpm, gantry travel 9.8 m/min (*checked*: the twin's
  brushes are 861 and 718 mm, washSpec.ts): https://www.manualslib.com/manual/3316743/K-Rcher-Cw-3.html?page=28
- Dryer blowers 2 x 4 kW (https://cdn.shopify.com/s/files/1/1321/2015/files/ARIES_2.0.pdf); 2 x 3 kW side and
  2 x 3-4 kW top (https://www.tsg-solutions.com/app/uploads/2019/09/rollovers-m-nex.pdf) (**used**: top 4 kW,
  sides 3 kW class; blower mass 95 kg is an ASSUMPTION for the class).
- Brush and gearmotor masses (side brush 55 kg, top brush 45 kg, gearmotors 16-31 kg): ASSUMPTION, typical of the
  class, marked "catalogue class mass" in the bill of materials.

## Vacuum (OTTO-CLEAN ARM, wash wands)

- Car-wash vacuum producer class: 3 kW, 410 m3/h, 30 kPa, 50/38 mm hose (**used** for the class figures):
  https://www.sterners.se/en/mercur/products/vacuum-cleaners/auto-vac-4000/

## Gas spring balancer (charge arm J2)

The balancer search (charge_arm.torque_budget) found the best spring to be a near-constant force: the signature of a
nitrogen gas spring. Gas springs: ISO 11901-1. Progression 15 % over the stroke is an ASSUMPTION typical of the type.

## Service lines (design findings 10 to 14, read 2026-11-07)

- 500 A DC liquid-cooled charging cable: OD 35.7 mm, minimum bend radius 357 mm (10 x OD) moved, 1.94 kg/m
  (**used** for the charge cable span, its take-up groove radius of 380 mm and its mass):
  https://www.phoenixcontact.com/us/products/1089665/pdf · https://www.phoenixcontact.com/us/products/1085637/pdf
- A second 500 A class cable: bend radius 200 mm fixed, 305 mm in free movement, 1.6 kg/m (*checked*: the 357 mm
  figure is the stricter one, so it governs): https://www.mouser.com/datasheet/2/829/HPC500_CCS1_Standard_CC56_B-3105972.pdf
- Hybrid cable (power + EtherCAT), OD 10 mm: bend radius 7 x OD moved, 4 x OD fixed (**used** for the joints'
  harness, the clean arm's coil and its fixed wrist lead):
  https://www.beckhoff.com/es-es/products/i-o/accessories/cable-by-the-meter/hybrid-cables/zb7200-xxxx.html
- PU vacuum hose ID 50 / OD 60: static inner bend radius 95 mm (**used** as the base for the clean arm's vacuum
  figures): https://www.marek.eu/katalog-obrazku/produkt-6619/15467-10-07-09-00020-vsl-60-50-pu-ds.pdf
- A hose's moving bend radius is about twice its static one (**used** as a rule of thumb for every moving hose and
  duct; ASSUMPTION for any one product): https://www.varcopumper.com/what_is_hose_bend_radius_why_important.asp
- 152 mm PU wire-helix duct: bend radius 138 mm (**used**: the wash side knives' 170 mm ducts are held to 280 mm
  moving, twice the static figure, ASSUMPTION pending the duct maker):
  https://uk.rs-online.com/web/p/flexible-ducting/0271411
- Spiral (coiled) cables extend 3 to 5 times their retracted length: 4 times for one maker's control cable, 3 times
  for another of its power cables (**used** to judge every coiled line; design finding 15): read 2026-11-07,
  https://datasheets.globalspec.com/ds/4257/LAPP · https://docs.rs-online.com/077e/A700000015880550.pdf
- Coil-frame concertina ducts fold to 5 to 8 % of their extended length: a duct hose that collapses to 5 % of its
  length, and a 300 mm duct of 5 m that packs to 0.4 m (**used** for the wash top knife's duct, which needs 11 %;
  design finding 15): read 2026-11-07, https://www.mcmaster.com/products/hvac-flex-ducts/ ·
  https://www.beyondtools.com/products/300mm-12-x-5m-replacement-flexible-ventilation-pvc-ducting-suit-fan-1025-1-by-tradequip
- Energy chain class 120 x 50, bend radius 200 mm, for the wash machine's supply (*checked* against a maker's range):
  https://pdf2.datasheet.su/igus/200-03-125.pdf. The upper run's unsupported length with the machine at an end (up to
  3.7 m) is to be confirmed by the chain maker; else it lies on the lower run.
- Cable reels with a slip ring and a rotary joint for hoses on one hub exist: up to 200 A in a compact series and
  1,600 A low voltage in a heavy series, rotary joints 3/8 to 3 in (*checked*, the class of the charge cable
  take-up's hub union): https://www.conductix.ch/sites/default/files/downloads/KAT7100-0002-E_Product_Overview_Motor_Driven_Reels.pdf ·
  reels with current up to 400 A and fluid joints up to 200 bar: https://www.directindustry.com/prod/raasm-spa/product-181436-2647547.html
- Flat-cable clock-spring cups for a part that turns back and forth exist (*checked*, the class of the clean arm
  wrist's clock spring; read 2026-11-07): https://elocab.bizlinktech.com/products/elocab/elocab-clock-spring-cables/
- ASSUMPTION, figures for those classes without a product source: the take-up's hub union as built here (2 x 500 A DC
  at 1000 V, signals, 2 coolant passages and air, made to order); the take-up's spring (about 80 N at the rim); the
  wrist clock spring's 8 circuits at 2 A with an EtherCAT pair, 1.5 turns either way, in 8 mm; the wrist swivel's air
  passage (a groove between 2 lip seals and a 3 mm channel along the stub's wall); the wash trench (0.52 m deep,
  slotted checker-plate cover, brush strips).
