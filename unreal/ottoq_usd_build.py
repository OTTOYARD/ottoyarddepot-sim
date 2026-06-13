#!/usr/bin/env python3
"""
OTTOYARD depot — OpenUSD generator (Track B / Omniverse).

Emits an ASCII .usda of the CURRENT depot straight from unreal/sitePlan.json —
the same source of truth that drives the cockpit, the sim, and the UE5 twin —
so the USD can never drift from "the most recent UE5 rendering". It mirrors the
geometry of ottoq_ue_build.py, the final material look of ottoq_ue_dress.py
(label-prefix rules), and the dusk lighting of ottoq_ue_dusk.py.

Pure Python, no dependencies (no pxr needed) — runs anywhere, including a fresh
cloud box that just `git clone`d the repo. Output loads in NVIDIA Omniverse /
USD Composer for RTX path tracing.

  python3 unreal/ottoq_usd_build.py
  -> unreal/usd/ottoyard_depot.usda

Coordinate contract: UE is left-handed Z-up; USD is right-handed Z-up. We keep
X, negate Y, keep Z (cm) so the depot reads identically to the UE scene.
metersPerUnit = 0.01 (cm), upAxis = Z.

NOTE: UsdLux light intensities use different units than UE — the values below
are sane starting points; expect one tuning pass inside Omniverse. Geometry and
material albedo/roughness/metallic are exact.
"""
import json
import math
import os

U = 48.0  # cm per logical unit (matches UE)
HERE = os.path.dirname(os.path.abspath(__file__))
PLAN = json.load(open(os.path.join(HERE, "sitePlan.json")))
OUT_DIR = os.path.join(HERE, "usd")
os.makedirs(OUT_DIR, exist_ok=True)
OUT = os.path.join(OUT_DIR, "ottoyard_depot.usda")

# ----------------------------------------------------------------- materials --
# (name, diffuse, roughness, metallic, emissive, opacity) — final dressed look.
MATERIALS = {
    "M_Asphalt":  ((0.045, 0.045, 0.05), 0.85, 0.0, None, 1.0),
    "M_Concrete": ((0.42, 0.42, 0.40), 0.80, 0.0, None, 1.0),
    "M_Grass":    ((0.10, 0.17, 0.06), 0.90, 0.0, None, 1.0),
    "M_Steel":    ((0.42, 0.44, 0.47), 0.38, 1.0, None, 1.0),
    "M_Dark":     ((0.06, 0.065, 0.075), 0.45, 0.85, None, 1.0),
    "M_Clad":     ((0.50, 0.51, 0.53), 0.55, 0.08, None, 1.0),
    "M_Glass":    ((0.10, 0.22, 0.24), 0.05, 0.0, None, 0.45),
    "M_Paint":    ((0.85, 0.86, 0.84), 0.55, 0.0, None, 1.0),
    "M_PV":       ((0.012, 0.035, 0.10), 0.18, 0.35, None, 1.0),
    "M_Sign":     ((0.0, 0.83, 0.66), 0.30, 0.0, (0.0, 1.5, 1.18), 1.0),
    "M_LED":      ((0.9, 0.92, 0.95), 0.30, 0.0, (2.2, 2.2, 2.3), 1.0),
    "M_Screen":   ((0.02, 0.06, 0.14), 0.10, 0.0, (0.06, 0.30, 0.85), 1.0),
    "M_Interior": ((0.95, 0.86, 0.66), 0.50, 0.0, (1.15, 0.95, 0.68), 1.0),
    "M_Barrier":  ((0.80, 0.10, 0.06), 0.40, 0.0, (0.30, 0.02, 0.0), 1.0),
    "M_City":     ((0.30, 0.42, 0.55), 0.06, 0.30, (0.10, 0.13, 0.20), 1.0),
    "M_CityB":    ((0.22, 0.27, 0.31), 0.11, 0.12, (0.16, 0.12, 0.06), 1.0),
    "M_Trunk":    ((0.26, 0.17, 0.09), 0.85, 0.0, None, 1.0),
    "M_Foliage":  ((0.13, 0.30, 0.10), 0.88, 0.0, None, 1.0),
}

# label-prefix -> material (order matters; mirrors ottoq_ue_dress.py RULES)
RULES = [
    ("OTTOQ_Grass", "M_Grass"),
    ("OTTOQ_Lot", "M_Asphalt"), ("OTTOQ_Road", "M_Asphalt"),
    ("OTTOQ_Forecourt", "M_Concrete"), ("OTTOQ_RearApron", "M_Concrete"),
    ("OTTOQ_BayFloor", "M_Dark"),
    ("OTTOQ_BESS_Pad", "M_Concrete"), ("OTTOQ_BESS_Inverter", "M_Steel"), ("OTTOQ_BESS_", "M_Dark"),
    ("OTTOQ_Fence", "M_Dark"), ("OTTOQ_GateArm", "M_Barrier"), ("OTTOQ_Gate", "M_Steel"),
    ("OTTOQ_Sign", "M_Sign"), ("OTTOQ_LitInterior", "M_Interior"),
    ("OTTOQ_Building_Glass", "M_Glass"),
    ("OTTOQ_Building", "M_Clad"), ("OTTOQ_Wash", "M_Clad"),
    ("OTTOQ_SVC", "M_Dark"),
    ("OTTOQ_Canopy", "M_Dark"),
    ("OTTOQ_ChScr", "M_Screen"), ("OTTOQ_ChLED", "M_Sign"),
    ("OTTOQ_CH_", "M_Steel"),
    ("OTTOQ_Carport", "M_Dark"),
    ("OTTOQ_RoofDark", "M_Dark"),
    ("OTTOQ_PoleHead", "M_LED"), ("OTTOQ_Pole", "M_Steel"),
    ("OTTOQ_City_B", "M_CityB"), ("OTTOQ_City", "M_City"),
    ("OTTOQ_TreeTrunk", "M_Trunk"), ("OTTOQ_TreeFol", "M_Foliage"),
    ("OTTOQ_Walk", "M_Concrete"), ("OTTOQ_Mark", "M_Paint"),
]


def mat_for(label):
    if "_PV" in label:
        return "M_PV"
    if "_Post" in label:
        return "M_Steel"
    for pre, m in RULES:
        if label.startswith(pre):
            return m
    return "M_Clad"


# ------------------------------------------------------------- USD emission ---
PRIMS = []


def _wx(x):
    return (x - 150.0) * U


def _wy(y):
    return -(y - 110.0) * U  # negate Y: UE left-handed -> USD right-handed


_USED = {}


def _safe(name):
    n = name.replace("-", "_").replace(".", "_").replace(" ", "_")
    # USD requires unique prim names within a parent; UE allows duplicate actor
    # labels (e.g. the canopy column spine), so de-dup with a numeric suffix.
    if n in _USED:
        _USED[n] += 1
        return f"{n}_{_USED[n]}"
    _USED[n] = 1
    return n


def box(name, x, y, w, d, h, z0=0.0):
    n = _safe(name)
    cx, cy, cz = _wx(x), _wy(y), (z0 + h / 2.0) * U
    sx, sy, sz = max(w, 0.02) * U, max(d, 0.02) * U, max(h, 0.02) * U
    PRIMS.append(f'''    def Cube "{n}" (prepend apiSchemas = ["MaterialBindingAPI"])
    {{
        double size = 1
        float3[] extent = [(-0.5, -0.5, -0.5), (0.5, 0.5, 0.5)]
        double3 xformOp:translate = ({cx:.3f}, {cy:.3f}, {cz:.3f})
        float3 xformOp:scale = ({sx:.3f}, {sy:.3f}, {sz:.3f})
        uniform token[] xformOpOrder = ["xformOp:translate", "xformOp:scale"]
        rel material:binding = </World/Looks/{mat_for(name)}>
    }}''')


def tbox(name, x, y, w, d, thick, center_z_u, pitch_deg):
    n = _safe(name)
    cx, cy, cz = _wx(x), _wy(y), center_z_u * U
    sx, sy, sz = max(w, 0.02) * U, max(d, 0.02) * U, max(thick, 0.02) * U
    PRIMS.append(f'''    def Cube "{n}" (prepend apiSchemas = ["MaterialBindingAPI"])
    {{
        double size = 1
        float3[] extent = [(-0.5, -0.5, -0.5), (0.5, 0.5, 0.5)]
        double3 xformOp:translate = ({cx:.3f}, {cy:.3f}, {cz:.3f})
        float xformOp:rotateY = {pitch_deg:.3f}
        float3 xformOp:scale = ({sx:.3f}, {sy:.3f}, {sz:.3f})
        uniform token[] xformOpOrder = ["xformOp:translate", "xformOp:rotateY", "xformOp:scale"]
        rel material:binding = </World/Looks/{mat_for(name)}>
    }}''')


def cyl(name, x, y, r, h, z0=0.0):
    n = _safe(name)
    cx, cy, cz = _wx(x), _wy(y), (z0 + h / 2.0) * U
    rr, hh = max(r, 0.01) * U, max(h, 0.02) * U
    PRIMS.append(f'''    def Cylinder "{n}" (prepend apiSchemas = ["MaterialBindingAPI"])
    {{
        uniform token axis = "Z"
        double radius = {rr:.3f}
        double height = {hh:.3f}
        float3[] extent = [({-rr:.3f}, {-rr:.3f}, {-hh / 2:.3f}), ({rr:.3f}, {rr:.3f}, {hh / 2:.3f})]
        double3 xformOp:translate = ({cx:.3f}, {cy:.3f}, {cz:.3f})
        uniform token[] xformOpOrder = ["xformOp:translate"]
        rel material:binding = </World/Looks/{mat_for(name)}>
    }}''')


def sph(name, x, y, dia, z_cm):
    n = _safe(name)
    cx, cy = _wx(x), _wy(y)
    rr = max(dia, 0.02) * U / 2.0
    PRIMS.append(f'''    def Sphere "{n}" (prepend apiSchemas = ["MaterialBindingAPI"])
    {{
        double radius = {rr:.3f}
        float3[] extent = [({-rr:.3f}, {-rr:.3f}, {-rr:.3f}), ({rr:.3f}, {rr:.3f}, {rr:.3f})]
        double3 xformOp:translate = ({cx:.3f}, {cy:.3f}, {z_cm:.3f})
        uniform token[] xformOpOrder = ["xformOp:translate"]
        rel material:binding = </World/Looks/{mat_for(name)}>
    }}''')


def stripe(x, y, w, d):
    box(f"OTTOQ_Mark_{int(x)}_{int(y)}_{int(w * 10)}_{int(d * 10)}", x, y, w, d, 0.08, z0=0.0)


# ===================================================================== build ==
def build():
    lot = PLAN["lot"]
    # ground / lot / road / aprons
    box("OTTOQ_Grass", 150, 110, 460, 360, 0.3, z0=-0.32)
    box("OTTOQ_Lot", lot["x"] + lot["w"] / 2, lot["y"] + lot["h"] / 2, lot["w"], lot["h"], 0.3, z0=-0.28)
    box("OTTOQ_Road", 150, 215, 460, 12, 0.25, z0=-0.3)
    box("OTTOQ_Forecourt", 142, 62, 156, 12, 0.06)
    box("OTTOQ_RearApron", 172, 16, 216, 20, 0.06)

    # perimeter fence + gate posts
    fh, ft = 4.6, 0.25
    gw = PLAN["gateW"]
    inx, egx = PLAN["ingress"]["x"], PLAN["egress"]["x"]
    x0, y0, x1, y1 = lot["x"], lot["y"], lot["x"] + lot["w"], lot["y"] + lot["h"]
    box("OTTOQ_Fence_N", (x0 + x1) / 2, y0, lot["w"], ft, fh)
    box("OTTOQ_Fence_W", x0, (y0 + y1) / 2, ft, lot["h"], fh)
    box("OTTOQ_Fence_E", x1, (y0 + y1) / 2, ft, lot["h"], fh)
    for i, (a, b) in enumerate([(x0, inx - gw / 2), (inx + gw / 2, egx - gw / 2), (egx + gw / 2, x1)]):
        box(f"OTTOQ_Fence_S{i}", (a + b) / 2, y1, b - a, ft, fh)
    for gx, nm in [(inx, "In"), (egx, "Out")]:
        for s in (-1, 1):
            box(f"OTTOQ_Gate{nm}_Post{'L' if s < 0 else 'R'}", gx + s * gw / 2, y1, 1.2, 1.2, 6.2)

    # guard booths + boom barriers
    for gx, nm in [(inx, "In"), (egx, "Out")]:
        side = 1.0 if gx < 150 else -1.0
        bxp = gx + side * (gw / 2 + 4.0)
        box(f"OTTOQ_Building_Guard{nm}", bxp, y1 - 4.5, 3.6, 3.8, 3.6)
        box(f"OTTOQ_RoofDark_Guard{nm}", bxp, y1 - 4.5, 4.2, 4.4, 0.4, z0=3.6)
        box(f"OTTOQ_Building_Glass_Guard{nm}", bxp - side * 1.85, y1 - 4.5, 0.2, 3.0, 1.8, z0=1.4)
        box(f"OTTOQ_Gate_Boom{nm}", gx - gw / 2 + 0.6, y1 - 0.5, 0.9, 0.9, 2.6)
        box(f"OTTOQ_GateArm_{nm}", gx, y1 - 0.5, gw - 1.5, 0.4, 0.4, z0=1.8)

    # BESS yard
    b = PLAN["bessYard"]
    box("OTTOQ_BESS_Pad", b["x"] + b["w"] / 2, b["y"] + b["h"] / 2, b["w"] - 2, b["h"] - 2, 0.08)
    for i in range(3):
        box(f"OTTOQ_BESS_{i + 1}", b["x"] + 9 + i * 15, b["y"] + b["h"] / 2, 11, 16, 6.4)
    box("OTTOQ_BESS_Inverter", b["x"] + b["w"] - 5, b["y"] + b["h"] / 2, 5, 8, 4)

    # open pull-through bays (service + wash)
    def open_bay(prefix, ox, oy, w, h, height, door_xs, kind):
        cxx, cyy = ox + w / 2.0, oy + h / 2.0
        yN, yS = oy, oy + h
        DH = height - 1.4
        box(f"{prefix}_Roof", cxx, cyy, w, h, 0.7, z0=height)
        box(f"{prefix}_Wall_W", ox + 0.5, cyy, 1.0, h, height)
        box(f"{prefix}_Wall_E", ox + w - 0.5, cyy, 1.0, h, height)
        box(f"{prefix}_Wall_LintelS", cxx, yS - 0.4, w, 0.8, height - DH, z0=DH)
        box(f"{prefix}_Wall_LintelN", cxx, yN + 0.4, w, 0.8, height - DH, z0=DH)
        bounds = [ox] + [(door_xs[i] + door_xs[i + 1]) / 2.0 for i in range(len(door_xs) - 1)] + [ox + w]
        for i in range(1, len(bounds) - 1):
            box(f"{prefix}_Wall_Part{i}", bounds[i], cyy, 0.8, h, DH)
        for i, dx in enumerate(door_xs):
            di = int(dx)
            bcx = (bounds[i] + bounds[i + 1]) / 2.0
            opening = (bounds[i + 1] - bounds[i]) - 1.6
            hw = opening / 2.0
            box(f"OTTOQ_BayFloor_{di}", bcx, cyy, opening + 0.6, h - 1.0, 0.12, z0=0.05)
            for ye, tag in ((yS - 0.45, "S"), (yN + 0.45, "N")):
                box(f"{prefix}_Door{tag}_{di}", bcx, ye, opening, 0.55, 1.0, z0=DH - 1.0)
                box(f"{prefix}_Post_Trk{tag}L_{di}", bcx - hw - 0.15, ye, 0.25, 0.45, DH)
                box(f"{prefix}_Post_Trk{tag}R_{di}", bcx + hw + 0.15, ye, 0.25, 0.45, DH)
            if kind == "wash":
                box(f"{prefix}_Post_GantL_{di}", bcx - hw + 0.5, cyy, 0.4, 0.4, height - 1.8)
                box(f"{prefix}_Post_GantR_{di}", bcx + hw - 0.5, cyy, 0.4, 0.4, height - 1.8)
                box(f"{prefix}_Post_GantTop_{di}", bcx, cyy, opening - 1.0, 0.6, 0.5, z0=height - 1.8)
                box(f"{prefix}_Post_Spray_{di}", bcx, cyy, 0.3, h - 7, 0.3, z0=height - 2.6)
            else:
                box(f"{prefix}_Post_LiftL_{di}", bcx - hw + 0.6, cyy + 2, 0.5, 0.5, 6.2)
                box(f"{prefix}_Post_LiftR_{di}", bcx + hw - 0.6, cyy + 2, 0.5, 0.5, 6.2)
                box(f"{prefix}_Post_LiftArm_{di}", bcx, cyy + 2, opening - 1.2, 0.4, 0.3, z0=6.0)

    # operations building: glass office hub + service bays
    bl = PLAN["building"]
    ox, oy, oh = bl["x"], bl["y"], bl["h"]
    ow = 40.0
    ocx, ocy = ox + ow / 2.0, oy + oh / 2.0
    OH = 14.0
    box("OTTOQ_Building_Core", ocx, oy + 0.7, ow, 1.4, OH)
    box("OTTOQ_RoofDark_Office", ocx, ocy, ow, oh, 0.7, z0=OH)
    box("OTTOQ_LitInterior_Office", ocx, ocy + 1.0, ow - 4, oh - 5, OH - 4.0, z0=1.6)
    box("OTTOQ_Building_Glass_S", ocx, oy + oh - 0.3, ow, 0.5, OH - 1.0, z0=0.6)
    box("OTTOQ_Building_Glass_W", ox + 0.3, ocy, 0.5, oh, OH - 1.0, z0=0.6)
    box("OTTOQ_Building_Glass_E", ox + ow - 0.3, ocy, 0.5, oh, OH - 1.0, z0=0.6)
    box("OTTOQ_Building_Floor2", ocx, oy + oh - 0.25, ow, 0.6, 0.4, z0=OH / 2.0)
    mx = ox + 4
    while mx <= ox + ow - 4:
        box(f"OTTOQ_Building_Post_Mul_{int(mx)}", mx, oy + oh - 0.05, 0.3, 0.3, OH - 1.2, z0=0.6)
        mx += 5
    box("OTTOQ_Sign_Office", ocx, oy + oh - 0.05, 20, 0.5, 2.2, z0=OH - 3.0)
    open_bay("OTTOQ_SVC", 110.0, oy, 40.0, oh, 11.0, [120, 138], "service")

    # wash / detailing bays
    wsh = PLAN["wash"]
    open_bay("OTTOQ_Wash", wsh["x"], wsh["y"], wsh["w"], wsh["h"], 10.0, [168, 186, 204], "wash")
    box("OTTOQ_Sign_Wash", wsh["x"] + wsh["w"] / 2.0, wsh["y"] + wsh["h"] - 0.05, 16, 0.5, 1.8, z0=10.2)

    # charging canopies: central-spine butterfly
    R, E = 13.0, 10.5
    for c in PLAN["canopies"]:
        cy = c["y"] + c["h"] / 2
        half = c["w"] / 2.0
        theta = math.degrees(math.atan2(R - E, half))
        yy = c["y"] + 6
        while yy <= c["y"] + c["h"] - 6:
            box(f"OTTOQ_Canopy{c['id']}_Post_Col", c["cx"], yy, 1.5, 1.5, R)
            yy += 19
        box(f"OTTOQ_Canopy{c['id']}_Post_Ridge", c["cx"], cy, 1.8, c["h"], 0.9, z0=R - 0.5)
        for side in (-1, 1):
            tbox(f"OTTOQ_Canopy{c['id']}_PVSlope_{'E' if side > 0 else 'W'}",
                 c["cx"] + side * (half / 2.0), cy, half + 1.5, c["h"] + 1.5, 0.5,
                 (R + E) / 2.0, -side * theta)

    # charger pedestals (DCFC / L2)
    for s in PLAN["stalls"]:
        if s["type"] not in ("dcfc", "l2"):
            continue
        sx, sy = s["position"]["x"], s["position"]["y"]
        spine = min(PLAN["canopies"], key=lambda c: abs(c["cx"] - sx))["cx"]
        px = sx + (4.5 if spine > sx else -4.5)
        sgn = 1.0 if sx > px else -1.0
        sid, is_dc = s["id"], s["type"] == "dcfc"
        hh = 3.8 if is_dc else 2.8
        ww = 1.4 if is_dc else 1.0
        box(f"OTTOQ_CH_{sid}_Base", px, sy, ww + 0.7, 1.3, 0.25)
        box(f"OTTOQ_CH_{sid}", px, sy, ww, 0.9, hh, z0=0.25)
        box(f"OTTOQ_CH_{sid}_Cap", px, sy, ww + 0.25, 1.1, 0.4, z0=hh + 0.25)
        box(f"OTTOQ_ChScr_{sid}", px + sgn * (ww / 2 + 0.04), sy, 0.12, 0.55, 0.8, z0=hh * 0.6)
        box(f"OTTOQ_ChLED_{sid}", px, sy, ww * 0.85, 0.95, 0.16, z0=hh - 0.15)
        box(f"OTTOQ_CH_{sid}_Hol", px + sgn * (ww / 2 + 0.05), sy + 0.45, 0.3, 0.3, 0.9, z0=hh * 0.45)

    # perimeter carports
    for run in PLAN["parkRuns"]:
        cp = run.get("carport")
        if not cp:
            continue
        box(f"OTTOQ_Carport_{run['id']}_Roof", cp["x"] + cp["w"] / 2, cp["y"] + cp["h"] / 2, cp["w"], cp["h"], 0.5, z0=8)
        if cp["w"] >= cp["h"]:
            xx = cp["x"] + 4
            while xx <= cp["x"] + cp["w"] - 4:
                box(f"OTTOQ_Carport_{run['id']}_Post_{int(xx)}", xx, cp["y"] + cp["h"] / 2, 0.8, 0.8, 8)
                xx += 20
        else:
            yy = cp["y"] + 4
            while yy <= cp["y"] + cp["h"] - 4:
                box(f"OTTOQ_Carport_{run['id']}_Post_{int(yy)}", cp["x"] + cp["w"] / 2, yy, 0.8, 0.8, 8)
                yy += 20

    # light poles
    for i, p in enumerate(PLAN["lightPoles"]):
        cyl(f"OTTOQ_Pole{i + 1}", p["x"], p["y"], 0.32, 18)
        box(f"OTTOQ_PoleHead{i + 1}", p["x"] + 2.5, p["y"], 5, 0.5, 0.4, z0=17.6)

    # metro city ring + trees + sidewalk
    def rnd(i):
        v = math.sin(i * 12.9898) * 43758.5453
        return v - math.floor(v)

    def tree(tid, x, y, s=1.0):
        cyl(f"OTTOQ_TreeTrunk_{tid}", x, y, 0.32 * s, 3.2 * s)
        sph(f"OTTOQ_TreeFol_{tid}a", x, y, 3.4 * s, 4.4 * s * U)
        sph(f"OTTOQ_TreeFol_{tid}b", x + 0.7 * s, y + 0.5 * s, 2.6 * s, 5.8 * s * U)

    blocks = []
    for i in range(8):
        blocks.append((18 + i * 36, -42 - rnd(i) * 70, 20 + rnd(i + 1) * 12, 20 + rnd(i + 2) * 14))
    for i in range(6):
        blocks.append((-48 - rnd(i + 10) * 55, 24 + i * 32, 20 + rnd(i + 11) * 12, 22 + rnd(i + 12) * 10))
    for i in range(6):
        blocks.append((346 + rnd(i + 20) * 55, 24 + i * 32, 20 + rnd(i + 21) * 12, 22 + rnd(i + 22) * 10))
    for i in range(5):
        blocks.append((34 + i * 58, 252 + rnd(i + 30) * 28, 24 + rnd(i + 31) * 12, 18 + rnd(i + 32) * 8))
    for j, (cx, cy, cw, cd) in enumerate(blocks):
        ch = 16 + rnd(j) * 48
        tag = "OTTOQ_City_B" if j % 3 == 0 else "OTTOQ_City_A"
        box(f"{tag}_{j}", cx, cy, cw, cd, ch)
        box(f"OTTOQ_RoofDark_City{j}", cx, cy, cw + 0.5, cd + 0.5, 0.6, z0=ch)

    ti, yy = 0, 30
    while yy <= 200:
        tree(ti, -3, yy, 1.0 + rnd(ti) * 0.4); ti += 1
        tree(ti, 299, yy, 1.0 + rnd(ti + 7) * 0.4); ti += 1
        yy += 22
    xx = 30
    while xx <= 270:
        tree(ti, xx, -14, 1.0 + rnd(ti) * 0.4); ti += 1
        xx += 34

    box("OTTOQ_Walk_S", 150, 208.5, 288, 2.5, 0.12, z0=0.03)

    # ground markings (paint)
    lanes = PLAN["lanes"]
    for s in PLAN["stalls"]:
        if s["type"] in ("dcfc", "l2"):
            x, y = s["position"]["x"], s["position"]["y"]
            stripe(x - 2.9, y, 0.32, 11.0)
            stripe(x + 2.9, y, 0.32, 11.0)
    for run in PLAN["parkRuns"]:
        horiz = run["angle"] in (90, 270)
        for i in range(run["n"]):
            x = run["x0"] + i * run["dx"]
            y = run["y0"] + i * run["dy"]
            if horiz:
                stripe(x, y - 2.9, 10.5, 0.32); stripe(x, y + 2.9, 10.5, 0.32)
            else:
                stripe(x - 2.9, y, 0.32, 10.5); stripe(x + 2.9, y, 0.32, 10.5)
    for xx in range(44, 258, 12):
        stripe(xx, lanes["northLaneY"], 4.2, 0.3)
        if xx <= 246:
            stripe(xx, lanes["southLaneY"], 4.2, 0.3)
    for gate in (PLAN["ingress"]["x"], PLAN["egress"]["x"]):
        for i in range(-3, 4):
            stripe(gate + i * 2.1, PLAN["lot"]["y"] + PLAN["lot"]["h"] + 3.2, 1.2, 4.6)


# ===================================================================== lights =
LIGHTS = []


def add_lights():
    # dusk key sun (low + warm) — DistantLight points -Z; tilt near horizontal
    LIGHTS.append('''    def DistantLight "Sun"
    {
        float inputs:intensity = 2.2
        float inputs:exposure = 9.0
        float inputs:angle = 0.8
        color3f inputs:color = (1.0, 0.62, 0.38)
        double3 xformOp:rotateXYZ = (-83, 0, -62)
        uniform token[] xformOpOrder = ["xformOp:rotateXYZ"]
    }''')
    # dusk sky ambient
    LIGHTS.append('''    def DomeLight "Sky"
    {
        float inputs:intensity = 0.8
        color3f inputs:color = (0.16, 0.20, 0.34)
        float inputs:exposure = 0.0
    }''')

    def sphere_light(name, x, y, z_cm, intensity, temp, radius):
        cx, cy = _wx(x), _wy(y)
        LIGHTS.append(f'''    def SphereLight "{_safe(name)}"
    {{
        float inputs:intensity = {intensity}
        float inputs:radius = {radius}
        bool inputs:enableColorTemperature = 1
        float inputs:colorTemperature = {temp}
        bool treatAsPoint = 0
        double3 xformOp:translate = ({cx:.3f}, {cy:.3f}, {z_cm:.3f})
        uniform token[] xformOpOrder = ["xformOp:translate"]
    }}''')

    # 12 warm pole-head downlights
    for i, p in enumerate(PLAN["lightPoles"]):
        sphere_light(f"L_Pole_{i}", p["x"] + 2.5, p["y"], 17.0 * U, 60000.0, 4200.0, 35.0)
    # 9 cool canopy wash lights (3 per canopy along the ridge)
    ci = 0
    for c in PLAN["canopies"]:
        cy = c["y"] + c["h"] / 2
        for dy in (-28, 0, 28):
            sphere_light(f"L_Canopy_{ci}", c["cx"], cy + dy, 9.4 * U, 26000.0, 5200.0, 30.0)
            ci += 1
    # 2 gate security spots
    for nm, gx in (("In", PLAN["ingress"]["x"]), ("Out", PLAN["egress"]["x"])):
        sphere_light(f"L_Gate_{nm}", gx, 203, 7.2 * U, 30000.0, 5600.0, 25.0)
    # office spill
    bl = PLAN["building"]
    sphere_light("L_Office", bl["x"] + 20, bl["y"] + bl["h"] / 2, 7.0 * U, 22000.0, 3500.0, 35.0)


# =============================================================== assemble usd =
def material_block(name, spec):
    diffuse, rough, metal, emissive, opacity = spec
    lines = [f'        def Material "{name}"', '        {',
             f'            token outputs:surface.connect = </World/Looks/{name}/Shader.outputs:surface>',
             '            def Shader "Shader"', '            {',
             '                uniform token info:id = "UsdPreviewSurface"',
             f'                color3f inputs:diffuseColor = ({diffuse[0]}, {diffuse[1]}, {diffuse[2]})',
             f'                float inputs:roughness = {rough}',
             f'                float inputs:metallic = {metal}']
    if emissive:
        lines.append(f'                color3f inputs:emissiveColor = ({emissive[0]}, {emissive[1]}, {emissive[2]})')
    if opacity < 1.0:
        lines.append(f'                float inputs:opacity = {opacity}')
    lines += ['                token outputs:surface', '            }', '        }']
    return "\n".join(lines)


def main():
    build()
    add_lights()
    looks = "\n".join(material_block(n, s) for n, s in MATERIALS.items())
    geo = "\n".join(PRIMS)
    lights = "\n".join(LIGHTS)
    doc = f'''#usda 1.0
(
    defaultPrim = "World"
    metersPerUnit = 0.01
    upAxis = "Z"
    doc = "OTTOYARD depot — generated from sitePlan.json by ottoq_usd_build.py"
)

def Xform "World"
{{
    def Scope "Looks"
    {{
{looks}
    }}

    def Xform "Geo"
    {{
{geo}
    }}

    def Xform "Lights"
    {{
{lights}
    }}
}}
'''
    with open(OUT, "w") as f:
        f.write(doc)
    n_geo = len(PRIMS)
    n_lights = len(LIGHTS)
    print(f"[ottoq usd] wrote {OUT}")
    print(f"[ottoq usd] geo prims: {n_geo}  lights: {n_lights}  materials: {len(MATERIALS)}")


if __name__ == "__main__":
    main()
