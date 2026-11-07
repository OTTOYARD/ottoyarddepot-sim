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
