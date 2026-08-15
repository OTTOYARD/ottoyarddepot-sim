#!/usr/bin/env python3
"""
OTTOYARD depot — OpenUSD generator from unreal/layoutSeed.json.

Rebuild of ottoq_usd_build.py that reads the CANONICAL layout seed instead of
the stale sitePlan.json. layoutSeed.json is in FEET, origin at the fence SW
corner, y NORTH-positive (same frame as the live DB and the twin legs), and
carries stall_code/render_id + heading_degrees + canopy_code/canopy_side, so the
depot geometry can never drift from the database.

Coordinate contract: cm, Z-up, x=east, y=NORTH. The lot centre is placed at the
world origin. metersPerUnit = 0.01, upAxis = Z.

  python3 unreal/ottoq_usd_build.py  ->  unreal/usd/ottoyard_depot.usda
"""
import json
import math
import os

FT = 30.48  # cm per foot
U = 48.0    # kept for the plan-unit helper, unused for feet
HERE = os.path.dirname(os.path.abspath(__file__))
SEED = json.load(open(os.path.join(HERE, "layoutSeed.json")))
OUT_DIR = os.path.join(HERE, "usd")
os.makedirs(OUT_DIR, exist_ok=True)
OUT = os.path.join(OUT_DIR, "ottoyard_depot.usda")

LOT = SEED["lot_ft"]
LOT_W, LOT_L = LOT["width_ft"], LOT["length_ft"]
CX = LOT_W / 2.0     # lot centre x (ft) -> world origin
CY = LOT_L / 2.0     # lot centre y (ft) -> world origin

MATERIALS = {
    "M_Asphalt":  ((0.15, 0.15, 0.17), 0.85, 0.0, None, 1.0),
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


PRIMS = []
_USED = {}


def _wx(x_ft):
    return (x_ft - CX) * FT


def _wy(y_ft):
    return (y_ft - CY) * FT


def _safe(name):
    n = name.replace("-", "_").replace(".", "_").replace(" ", "_")
    if n in _USED:
        _USED[n] += 1
        return f"{n}_{_USED[n]}"
    _USED[n] = 1
    return n


def box(name, x_ft, y_ft, w_ft, d_ft, h_ft, z0_ft=0.0):
    n = _safe(name)
    cx, cy, cz = _wx(x_ft), _wy(y_ft), (z0_ft + h_ft / 2.0) * FT
    sx, sy, sz = max(w_ft, 0.02) * FT, max(d_ft, 0.02) * FT, max(h_ft, 0.02) * FT
    PRIMS.append(f'''    def Cube "{n}" (prepend apiSchemas = ["MaterialBindingAPI"])
    {{
        double size = 1
        float3[] extent = [(-0.5, -0.5, -0.5), (0.5, 0.5, 0.5)]
        double3 xformOp:translate = ({cx:.3f}, {cy:.3f}, {cz:.3f})
        float3 xformOp:scale = ({sx:.3f}, {sy:.3f}, {sz:.3f})
        uniform token[] xformOpOrder = ["xformOp:translate", "xformOp:scale"]
        rel material:binding = </World/Looks/{mat_for(name)}>
    }}''')


def tbox(name, x_ft, y_ft, w_ft, d_ft, thick_ft, center_z_ft, pitch_deg):
    n = _safe(name)
    cx, cy, cz = _wx(x_ft), _wy(y_ft), center_z_ft * FT
    sx, sy, sz = max(w_ft, 0.02) * FT, max(d_ft, 0.02) * FT, max(thick_ft, 0.02) * FT
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


def cyl(name, x_ft, y_ft, r_ft, h_ft, z0_ft=0.0):
    n = _safe(name)
    cx, cy, cz = _wx(x_ft), _wy(y_ft), (z0_ft + h_ft / 2.0) * FT
    rr, hh = max(r_ft, 0.01) * FT, max(h_ft, 0.02) * FT
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


def sph(name, x_ft, y_ft, dia_ft, z_ft):
    n = _safe(name)
    cx, cy = _wx(x_ft), _wy(y_ft)
    rr = max(dia_ft, 0.02) * FT / 2.0
    PRIMS.append(f'''    def Sphere "{n}" (prepend apiSchemas = ["MaterialBindingAPI"])
    {{
        double radius = {rr:.3f}
        float3[] extent = [({-rr:.3f}, {-rr:.3f}, {-rr:.3f}), ({rr:.3f}, {rr:.3f}, {rr:.3f})]
        double3 xformOp:translate = ({cx:.3f}, {cy:.3f}, {z_ft * FT:.3f})
        uniform token[] xformOpOrder = ["xformOp:translate"]
        rel material:binding = </World/Looks/{mat_for(name)}>
    }}''')


def stripe(x_ft, y_ft, w_ft, d_ft):
    box(f"OTTOQ_Mark_{int(x_ft)}_{int(y_ft)}_{int(w_ft * 10)}_{int(d_ft * 10)}",
        x_ft, y_ft, w_ft, d_ft, 0.08, z0_ft=0.0)


def build():
    # ground / lot / perimeter avenues
    box("OTTOQ_Grass", CX, CY, LOT_W + 8, LOT_L + 46, 0.3, z0_ft=-0.32)
    box("OTTOQ_Lot", CX, CY, LOT_W, LOT_L, 0.3, z0_ft=-0.28)

    # structures (canopies, buildings, carports, bess, gates, fences, poles, sign)
    by_kind = {}
    for s in SEED["structures"]:
        by_kind.setdefault(s["structure_kind"], []).append(s)

    # perimeter fence
    fence = by_kind.get("fence_segment", [])
    fh = 4.6
    for f in fence:
        ox, oy = f["origin_x_ft"], f["origin_y_ft"]
        box(f"OTTOQ_Fence_{f['structure_code']}", ox + f["width_ft"] / 2, oy + f["length_ft"] / 2,
            f["width_ft"], f["length_ft"], fh)

    # gates
    for g in by_kind.get("gate", []):
        ox, oy = g["origin_x_ft"], g["origin_y_ft"]
        w, l = g["width_ft"], g["length_ft"]
        box(f"OTTOQ_Gate_{g['structure_code']}", ox + w / 2, oy + l / 2, w, l, 6.2)
        box(f"OTTOQ_Gate_Boom_{g['structure_code']}", ox + w / 2, oy + l / 2, w, 0.9, 0.4, z0_ft=1.8)

    # BESS compound
    for b in by_kind.get("bess_compound", []):
        ox, oy = b["origin_x_ft"], b["origin_y_ft"]
        w, l, h = b["width_ft"], b["length_ft"], b["height_ft"]
        box("OTTOQ_BESS_Pad", ox + w / 2, oy + l / 2, w, l, 0.08)
        for i in range(3):
            box(f"OTTOQ_BESS_{i + 1}", ox + 9 + i * 15, oy + l / 2, 11, 16, h)
        box("OTTOQ_BESS_Inverter", ox + w - 5, oy + l / 2, 5, 8, h * 0.66)

    # office building
    for ob in by_kind.get("office_building", []):
        ox, oy = ob["origin_x_ft"], ob["origin_y_ft"]
        w, l, h = ob["width_ft"], ob["length_ft"], ob["height_ft"]
        box("OTTOQ_Building_Core", ox + w / 2, oy + l / 2, w, l, h)
        box("OTTOQ_RoofDark_Office", ox + w / 2, oy + l / 2, w, l, 0.7, z0_ft=h)
        box("OTTOQ_LitInterior_Office", ox + w / 2, oy + l / 2 + 1, w - 4, l - 5, h - 4, z0_ft=1.6)

    # wash building
    for wsh in by_kind.get("wash_building", []):
        ox, oy = wsh["origin_x_ft"], wsh["origin_y_ft"]
        w, l, h = wsh["width_ft"], wsh["length_ft"], wsh["height_ft"]
        box("OTTOQ_Wash_Roof", ox + w / 2, oy + l / 2, w, l, 0.7, z0_ft=h)

    # canopies (solar = charging, metal = carport)
    for c in by_kind.get("solar_canopy", []):
        ox, oy = c["origin_x_ft"], c["origin_y_ft"]
        w, l, h = c["width_ft"], c["length_ft"], c["height_ft"]
        code = c["structure_code"]
        cx0 = ox + w / 2
        yy = oy + 6
        while yy <= oy + l - 6:
            box(f"OTTOQ_Canopy{code}_Post_Col", cx0, yy, 1.5, 1.5, h)
            yy += 19
        box(f"OTTOQ_Canopy{code}_Post_Ridge", cx0, oy + l / 2, 1.8, l, 0.9, z0_ft=h - 0.5)
        for side in (-1, 1):
            tbox(f"OTTOQ_Canopy{code}_PVSlope_{'E' if side > 0 else 'W'}",
                 cx0 + side * (w / 4), oy + l / 2, w / 2 + 1.5, l + 1.5, 0.5,
                 h - 2.0, -side * 8.0)

    for c in by_kind.get("metal_canopy", []):
        ox, oy = c["origin_x_ft"], c["origin_y_ft"]
        w, l, h = c["width_ft"], c["length_ft"], c["height_ft"]
        code = c["structure_code"]
        box(f"OTTOQ_Carport_{code}_Roof", ox + w / 2, oy + l / 2, w, l, 0.5, z0_ft=h)

    # light poles
    for i, p in enumerate(by_kind.get("lighting_pole", [])):
        ox, oy = p["origin_x_ft"], p["origin_y_ft"]
        h = p["height_ft"]
        cyl(f"OTTOQ_Pole{i + 1}", ox, oy, 0.32, h)
        box(f"OTTOQ_PoleHead{i + 1}", ox + 2.5, oy, 5, 0.5, 0.4, z0_ft=h - 0.4)

    # sign
    for s in by_kind.get("sign", []):
        ox, oy = s["origin_x_ft"], s["origin_y_ft"]
        box(f"OTTOQ_Sign_{s['structure_code']}", ox + s["width_ft"] / 2, oy + s["length_ft"] / 2,
            s["width_ft"], s["length_ft"], 2.2, z0_ft=11.0)

    # charger pedestals (DCFC / L2) — keyed by stall_code
    for s in SEED["stalls"]:
        if s["stall_type"] not in ("dcfc", "l2"):
            continue
        sx, sy = s["relative_x"], s["relative_y"]
        sid = s["stall_code"].replace("NASH-", "").replace("-", "_")
        is_dc = s["stall_type"] == "dcfc"
        # charger sits on the canopy side (the vehicle is on the opposite side)
        side = -1.0 if s.get("canopy_side") == "W" else 1.0
        px = sx + side * 4.5
        # dims in feet (converted from the plan-unit originals x1.569882)
        hh = 5.97 if is_dc else 4.4
        ww = 2.2 if is_dc else 1.57
        box(f"OTTOQ_CH_{sid}_Base", px, sy, ww + 1.1, 2.04, 0.39)
        box(f"OTTOQ_CH_{sid}", px, sy, ww, 1.41, hh, z0_ft=0.39)
        box(f"OTTOQ_CH_{sid}_Cap", px, sy, ww + 0.39, 1.73, 0.63, z0_ft=hh + 0.39)

    # ground markings: charger stall stripes
    for s in SEED["stalls"]:
        if s["stall_type"] in ("dcfc", "l2"):
            x, y = s["relative_x"], s["relative_y"]
            stripe(x - 2.9, y, 0.32, 11.0)
            stripe(x + 2.9, y, 0.32, 11.0)

    # ---- road lane paint ----  dashed centre lines on every lane the LaneGraph
    # defines (ring boulevards + avenues, northbound gap lanes, temp aisle, rear
    # apron). Drawn as alternating white stripes; lane positions match
    # src/engine/motion/LaneGraph.ts buildDepotLanes().
    lanes = SEED["lanes"]
    W = lanes["west_aisle_x"]
    E = lanes["east_aisle_x"]
    S = lanes["south_lane_y"]
    N = lanes["north_lane_y"]

    # south + north boulevards (two-way divided ring)
    for xx in range(int(W) + 10, int(E) - 8, 14):
        stripe(xx, S, 4.5, 0.3)
        stripe(xx, N, 4.5, 0.3)

    # west + east avenues
    for yy in range(int(S) + 10, int(N) - 8, 14):
        stripe(W, yy, 0.3, 4.5)
        stripe(E, yy, 0.3, 4.5)

    # northbound gap lanes through the canopy band
    for gx in lanes["gap_lanes_x"].values():
        for yy in range(int(S) + 10, int(N) - 8, 14):
            stripe(gx, yy, 0.3, 4.5)

    # temp block aisle (two-way)
    tx = lanes["temp_lane_x"]
    for yy in range(int(S) + 10, int(N) - 8, 14):
        stripe(tx, yy, 0.3, 4.5)

    # rear apron behind wash/service bays (eastbound only)
    RY = lanes["rear_lane_y"]
    for xx in range(120, int(E) - 8, 14):
        stripe(xx, RY, 4.5, 0.3)

    # forecourt (north edge of charging canopies)
    FY = lanes["forecourt_y"]
    for xx in range(int(W) + 10, int(E) - 8, 14):
        stripe(xx, FY, 4.5, 0.3)


LIGHTS = []


def add_lights():
    LIGHTS.append('''    def DistantLight "Sun"
    {
        float inputs:intensity = 2.2
        float inputs:exposure = 9.0
        float inputs:angle = 0.8
        color3f inputs:color = (1.0, 0.62, 0.38)
        double3 xformOp:rotateXYZ = (-83, 0, -62)
        uniform token[] xformOpOrder = ["xformOp:rotateXYZ"]
    }''')
    LIGHTS.append('''    def DomeLight "Sky"
    {
        float inputs:intensity = 0.8
        color3f inputs:color = (0.16, 0.20, 0.34)
        float inputs:exposure = 0.0
    }''')

    def sphere_light(name, x_ft, y_ft, z_ft, intensity, temp, radius):
        cx, cy = _wx(x_ft), _wy(y_ft)
        LIGHTS.append(f'''    def SphereLight "{_safe(name)}"
    {{
        float inputs:intensity = {intensity}
        float inputs:radius = {radius}
        bool inputs:enableColorTemperature = 1
        float inputs:colorTemperature = {temp}
        bool treatAsPoint = 0
        double3 xformOp:translate = ({cx:.3f}, {cy:.3f}, {z_ft * FT:.3f})
        uniform token[] xformOpOrder = ["xformOp:translate"]
    }}''')

    for s in SEED["structures"]:
        if s["structure_kind"] == "lighting_pole":
            sphere_light(f"L_Pole_{s['structure_code']}", s["origin_x_ft"] + 2.5,
                         s["origin_y_ft"], s["height_ft"] - 1.0, 60000.0, 4200.0, 35.0)
    for c in SEED["structures"]:
        if c["structure_kind"] == "solar_canopy":
            cy = c["origin_y_ft"] + c["length_ft"] / 2
            for dy in (-28, 0, 28):
                sphere_light(f"L_Canopy_{c['structure_code']}_{dy}",
                             c["origin_x_ft"] + c["width_ft"] / 2, cy + dy, 9.4, 26000.0, 5200.0, 30.0)


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
    doc = "OTTOYARD depot — generated from layoutSeed.json by ottoq_usd_build.py"
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

'''
    doc += '    def Scope "Lights"\n    {\n' + lights + '\n    }\n}\n'
    with open(OUT, "w") as f:
        f.write(doc)
    print(f"[BUILD] wrote {OUT}  ({len(PRIMS)} prims, {len(SEED['stalls'])} stalls, {len(SEED['structures'])} structures)")


if __name__ == "__main__":
    main()
