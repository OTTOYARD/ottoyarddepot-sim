"""
OTTOYARD — hyper-realism dressing pass for the UE depot.

- Builds WORLD-ALIGNED materials from the imported Fab/Megascans 4K scans
  (asphalt + concrete) via world-position UVs — zero stretch on giant slabs.
- Authors PBR materials for PV glass, steels, cladding, glass, paint, and a
  procedural-noise grass (no texture needed).
- Reassigns every depot actor by label; paints the full lane-marking system
  from sitePlan.json; adds a cinematic PostProcessVolume.

Run AFTER ottoq_ue_build.py:
  exec(open("/Users/chaseballenger/Desktop/ottoyarddepot-sim/unreal/ottoq_ue_dress.py").read())
"""

import json
import os
import unreal

U = 48.0
TAG = "OTTOQM"   # marking/dress actors
MAT_DIR = "/Game/OTTOQ/Materials"

try:
    _HERE = os.path.dirname(os.path.abspath(__file__))
except NameError:
    _HERE = os.path.expanduser("~/Desktop/ottoyarddepot-sim/unreal")

with open(os.path.join(_HERE, "sitePlan.json")) as f:
    PLAN = json.load(f)

eas = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
MEL = unreal.MaterialEditingLibrary
AT = unreal.AssetToolsHelpers.get_asset_tools()
EAL = unreal.EditorAssetLibrary

# ------------------------------------------------------------ tex discovery -
def find_scan_textures(keyword):
    out = {}
    for path in EAL.list_assets("/Game/Fab", recursive=True):
        if keyword.lower() not in path.lower():
            continue
        p = path.split(".")[0]
        if p.endswith("_4K_B"):
            out["b"] = p
        elif p.endswith("_4K_N"):
            out["n"] = p
        elif p.endswith("_4K_ORM"):
            out["orm"] = p
    return out

# ------------------------------------------------------------ mat authoring -
def _new_mat(name):
    full = f"{MAT_DIR}/{name}"
    if EAL.does_asset_exist(full):
        EAL.delete_asset(full)
    return AT.create_asset(name, MAT_DIR, unreal.Material, unreal.MaterialFactoryNew())

def make_world_aligned(name, texset, size_cm):
    """World-position-projected scan material (top projection)."""
    m = _new_mat(name)
    wp = MEL.create_material_expression(m, unreal.MaterialExpressionWorldPosition, -1100, 0)
    mask = MEL.create_material_expression(m, unreal.MaterialExpressionComponentMask, -900, 0)
    mask.set_editor_property("r", True); mask.set_editor_property("g", True)
    mask.set_editor_property("b", False); mask.set_editor_property("a", False)
    div = MEL.create_material_expression(m, unreal.MaterialExpressionMultiply, -700, 0)
    k = MEL.create_material_expression(m, unreal.MaterialExpressionConstant, -900, 150)
    k.set_editor_property("r", 1.0 / size_cm)
    MEL.connect_material_expressions(wp, "", mask, "")
    MEL.connect_material_expressions(mask, "", div, "A")
    MEL.connect_material_expressions(k, "", div, "B")

    def sample(tex_path, x, y, normal=False):
        ts = MEL.create_material_expression(m, unreal.MaterialExpressionTextureSample, x, y)
        tex = unreal.load_asset(tex_path)
        ts.set_editor_property("texture", tex)
        if normal:
            ts.set_editor_property("sampler_type", unreal.MaterialSamplerType.SAMPLERTYPE_NORMAL)
        elif "ORM" in tex_path:
            # Megascans ORM imports as TC_Masks — sampler must match or the
            # material fails to compile ("should be Masks").
            ts.set_editor_property("sampler_type", unreal.MaterialSamplerType.SAMPLERTYPE_MASKS)
        MEL.connect_material_expressions(div, "", ts, "UVs")
        return ts

    if "b" in texset:
        b = sample(texset["b"], -420, -180)
        MEL.connect_material_property(b, "RGB", unreal.MaterialProperty.MP_BASE_COLOR)
    if "orm" in texset:
        orm = sample(texset["orm"], -420, 60)
        mr = MEL.create_material_expression(m, unreal.MaterialExpressionComponentMask, -180, 60)
        mr.set_editor_property("r", False); mr.set_editor_property("g", True)
        mr.set_editor_property("b", False); mr.set_editor_property("a", False)
        MEL.connect_material_expressions(orm, "", mr, "")
        MEL.connect_material_property(mr, "", unreal.MaterialProperty.MP_ROUGHNESS)
        ma = MEL.create_material_expression(m, unreal.MaterialExpressionComponentMask, -180, 180)
        ma.set_editor_property("r", True); ma.set_editor_property("g", False)
        ma.set_editor_property("b", False); ma.set_editor_property("a", False)
        MEL.connect_material_expressions(orm, "", ma, "")
        MEL.connect_material_property(ma, "", unreal.MaterialProperty.MP_AMBIENT_OCCLUSION)
    if "n" in texset:
        n = sample(texset["n"], -420, 320, normal=True)
        MEL.connect_material_property(n, "RGB", unreal.MaterialProperty.MP_NORMAL)
    MEL.recompile_material(m)
    return m

def make_pbr(name, color, rough, metal, emissive=None, translucent=False, opacity=1.0):
    m = _new_mat(name)
    c = MEL.create_material_expression(m, unreal.MaterialExpressionConstant3Vector, -500, -150)
    c.set_editor_property("constant", unreal.LinearColor(*color, 1.0))
    MEL.connect_material_property(c, "", unreal.MaterialProperty.MP_BASE_COLOR)
    r = MEL.create_material_expression(m, unreal.MaterialExpressionConstant, -500, 60)
    r.set_editor_property("r", rough)
    MEL.connect_material_property(r, "", unreal.MaterialProperty.MP_ROUGHNESS)
    mt = MEL.create_material_expression(m, unreal.MaterialExpressionConstant, -500, 170)
    mt.set_editor_property("r", metal)
    MEL.connect_material_property(mt, "", unreal.MaterialProperty.MP_METALLIC)
    if emissive:
        e = MEL.create_material_expression(m, unreal.MaterialExpressionConstant3Vector, -500, 300)
        e.set_editor_property("constant", unreal.LinearColor(*emissive, 1.0))
        MEL.connect_material_property(e, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
    if translucent:
        m.set_editor_property("blend_mode", unreal.BlendMode.BLEND_TRANSLUCENT)
        o = MEL.create_material_expression(m, unreal.MaterialExpressionConstant, -500, 420)
        o.set_editor_property("r", opacity)
        MEL.connect_material_property(o, "", unreal.MaterialProperty.MP_OPACITY)
    MEL.recompile_material(m)
    return m

def make_grass(name):
    m = _new_mat(name)
    noise = MEL.create_material_expression(m, unreal.MaterialExpressionNoise, -700, -60)
    noise.set_editor_property("scale", 0.0009)
    noise.set_editor_property("turbulence", True)
    noise.set_editor_property("levels", 5)
    a = MEL.create_material_expression(m, unreal.MaterialExpressionConstant3Vector, -700, -260)
    a.set_editor_property("constant", unreal.LinearColor(0.085, 0.16, 0.045, 1.0))
    b = MEL.create_material_expression(m, unreal.MaterialExpressionConstant3Vector, -700, 140)
    b.set_editor_property("constant", unreal.LinearColor(0.16, 0.26, 0.075, 1.0))
    lerp = MEL.create_material_expression(m, unreal.MaterialExpressionLinearInterpolate, -420, -60)
    MEL.connect_material_expressions(a, "", lerp, "A")
    MEL.connect_material_expressions(b, "", lerp, "B")
    MEL.connect_material_expressions(noise, "", lerp, "Alpha")
    MEL.connect_material_property(lerp, "", unreal.MaterialProperty.MP_BASE_COLOR)
    r = MEL.create_material_expression(m, unreal.MaterialExpressionConstant, -420, 160)
    r.set_editor_property("r", 0.92)
    MEL.connect_material_property(r, "", unreal.MaterialProperty.MP_ROUGHNESS)
    MEL.recompile_material(m)
    return m

# --------------------------------------------------------------- authoring --
unreal.log("[OTTOQ dress] building materials…")
asph_tex = find_scan_textures("Asphalt")
conc_tex = find_scan_textures("Concrete")
unreal.log(f"[OTTOQ dress] asphalt textures: {asph_tex}")
unreal.log(f"[OTTOQ dress] concrete textures: {conc_tex}")

M_ASPHALT = make_world_aligned("M_OTTOQ_Asphalt", asph_tex, 750.0) if asph_tex else None
M_CONCRETE = make_world_aligned("M_OTTOQ_Concrete", conc_tex, 520.0) if conc_tex else None
M_GRASS = make_grass("M_OTTOQ_Grass")
M_PV = make_pbr("M_OTTOQ_PV", (0.012, 0.035, 0.10), 0.18, 0.35)
M_STEEL = make_pbr("M_OTTOQ_Steel", (0.42, 0.44, 0.47), 0.38, 1.0)
M_DARK = make_pbr("M_OTTOQ_DarkSteel", (0.06, 0.065, 0.075), 0.45, 0.85)
M_CLAD = make_pbr("M_OTTOQ_Cladding", (0.50, 0.51, 0.53), 0.55, 0.08)
M_GLASS = make_pbr("M_OTTOQ_Glass", (0.10, 0.22, 0.24), 0.06, 0.25, translucent=True, opacity=0.42)
M_PAINT = make_pbr("M_OTTOQ_Paint", (0.85, 0.86, 0.84), 0.55, 0.0)
M_LED = make_pbr("M_OTTOQ_LED", (0.9, 0.92, 0.95), 0.3, 0.0, emissive=(2.2, 2.2, 2.3))
M_INTERIOR = make_pbr("M_OTTOQ_Interior", (0.95, 0.86, 0.66), 0.5, 0.0, emissive=(1.15, 0.95, 0.68))
M_SIGN = make_pbr("M_OTTOQ_Sign", (0.0, 0.83, 0.66), 0.3, 0.0, emissive=(0.0, 1.5, 1.18))
M_SCREEN = make_pbr("M_OTTOQ_Screen", (0.02, 0.06, 0.14), 0.1, 0.0, emissive=(0.06, 0.30, 0.85))
M_BARRIER = make_pbr("M_OTTOQ_Barrier", (0.80, 0.10, 0.06), 0.4, 0.0, emissive=(0.30, 0.02, 0.0))

# ----------------------------------------------------------- assignment -----
# RULES are matched by startswith in order — list more-specific prefixes first.
RULES = [
    ("OTTOQ_Grass", M_GRASS),
    ("OTTOQ_Lot", M_ASPHALT), ("OTTOQ_Road", M_ASPHALT),
    ("OTTOQ_Forecourt", M_CONCRETE), ("OTTOQ_RearApron", M_CONCRETE),
    ("OTTOQ_BayFloor", M_DARK),
    ("OTTOQ_BESS_Pad", M_CONCRETE),
    ("OTTOQ_BESS_Inverter", M_STEEL),
    ("OTTOQ_BESS_", M_DARK),
    ("OTTOQ_Fence", M_DARK), ("OTTOQ_GateArm", M_BARRIER), ("OTTOQ_Gate", M_STEEL),
    ("OTTOQ_Sign", M_SIGN), ("OTTOQ_LitInterior", M_INTERIOR),
    ("OTTOQ_Building_Glass", M_GLASS),
    ("OTTOQ_Building", M_CLAD), ("OTTOQ_Wash", M_CLAD),
    ("OTTOQ_SVC", M_DARK),
    ("OTTOQ_Canopy", M_DARK),          # roof + posts default…
    ("OTTOQ_ChScr", M_SCREEN), ("OTTOQ_ChLED", M_SIGN),
    ("OTTOQ_CH_", M_STEEL),
    ("OTTOQ_Carport", M_DARK),
    ("OTTOQ_RoofDark", M_DARK),
    ("OTTOQ_PoleHead", M_LED), ("OTTOQ_Pole", M_STEEL),
]
SPECIAL_PV = "_PV"
SPECIAL_POST = "_Post"

count = 0
for a in eas.get_all_level_actors():
    label = a.get_actor_label() or ""
    if not label.startswith("OTTOQ_"):
        continue
    mat = None
    if SPECIAL_PV in label:
        mat = M_PV
    elif SPECIAL_POST in label:
        mat = M_STEEL
    else:
        for prefix, mm in RULES:
            if label.startswith(prefix):
                mat = mm
                break
    if mat is None:
        continue
    try:
        a.static_mesh_component.set_material(0, mat)
        count += 1
    except Exception:
        pass
unreal.log(f"[OTTOQ dress] re-skinned {count} actors")

# ------------------------------------------------------------- markings -----
CUBE = unreal.load_asset("/Engine/BasicShapes/Cube.Cube")

def W(x, y, z_cm=0.0):
    return unreal.Vector((x - 150.0) * U, (y - 110.0) * U, z_cm)

def stripe(x, y, w, d, rot=0.0):
    a = eas.spawn_actor_from_object(CUBE, W(x, y, 2.0), unreal.Rotator(0, 0, rot))
    a.set_actor_scale3d(unreal.Vector(w * U / 100.0, d * U / 100.0, 0.04))
    a.tags = [unreal.Name(TAG)]
    a.set_actor_label(f"OTTOQM_stripe_{x}_{y}")
    try:
        a.static_mesh_component.set_material(0, M_PAINT)
        a.static_mesh_component.set_cast_shadow(False)
    except Exception:
        pass

# clear previous markings
n = 0
for a in list(eas.get_all_level_actors()):
    try:
        if unreal.Name(TAG) in list(a.tags):
            eas.destroy_actor(a); n += 1
    except Exception:
        pass
unreal.log(f"[OTTOQ dress] cleared {n} old markings")

lanes = PLAN["lanes"]
# charging stall side lines (cars sit N-S)
for s in PLAN["stalls"]:
    if s["type"] in ("dcfc", "l2"):
        x, y = s["position"]["x"], s["position"]["y"]
        stripe(x - 2.9, y, 0.32, 11.0)
        stripe(x + 2.9, y, 0.32, 11.0)
# parking stall lines per run orientation
for run in PLAN["parkRuns"]:
    horiz = run["angle"] in (90, 270)
    for i in range(run["n"]):
        x = run["x0"] + i * run["dx"]
        y = run["y0"] + i * run["dy"]
        if horiz:
            stripe(x, y - 2.9, 10.5, 0.32)
            stripe(x, y + 2.9, 10.5, 0.32)
        else:
            stripe(x - 2.9, y, 0.32, 10.5)
            stripe(x + 2.9, y, 0.32, 10.5)
# collector center dashes (two-way)
for xx in range(44, 258, 12):
    stripe(xx, lanes["northLaneY"], 4.2, 0.3)
    if xx <= 246:
        stripe(xx, lanes["southLaneY"], 4.2, 0.3)
# aisle edge dashes
for yy in range(86, 198, 11):
    stripe(lanes["westAisleX"] + 6, yy, 0.3, 4.2)
for yy in range(52, 198, 11):
    stripe(lanes["eastAisleX"] - 6, yy, 0.3, 4.2)
# gate crosswalk bars
for gate in (PLAN["ingress"]["x"], PLAN["egress"]["x"]):
    for i in range(-3, 4):
        stripe(gate + i * 2.1, PLAN["lot"]["y"] + PLAN["lot"]["h"] + 3.2, 1.2, 4.6)
unreal.log("[OTTOQ dress] markings painted")

# ----------------------------------------------------------------- post -----
for a in list(eas.get_all_level_actors()):
    if (a.get_actor_label() or "") == "OTTOQ_PPV":
        eas.destroy_actor(a)
ppv = eas.spawn_actor_from_class(unreal.PostProcessVolume, unreal.Vector(0, 0, 0), unreal.Rotator(0, 0, 0))
ppv.set_actor_label("OTTOQ_PPV")
ppv.tags = [unreal.Name(TAG)]
ppv.set_editor_property("unbound", True)
s = ppv.settings
for k, v in [
    ("override_bloom_intensity", True), ("bloom_intensity", 0.25),
    ("override_auto_exposure_bias", True), ("auto_exposure_bias", 0.35),
    ("override_motion_blur_amount", True), ("motion_blur_amount", 0.0),
    ("override_color_saturation", True),
]:
    try:
        s.set_editor_property(k, v)
    except Exception:
        pass
try:
    s.set_editor_property("color_saturation", unreal.Vector4(1.04, 1.04, 1.04, 1.0))
except Exception:
    pass
ppv.set_editor_property("settings", s)

unreal.SystemLibrary.execute_console_command(None, "r.ScreenPercentage 125")
les.save_current_level()
EAL.save_directory("/Game/OTTOQ")
unreal.log("[OTTOQ dress] DONE — hyper-real pass applied")
