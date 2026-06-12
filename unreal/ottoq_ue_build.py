"""
OTTOYARD depot — Unreal Engine 5 procedural blockout builder.

Builds the entire depot inside UE from unreal/sitePlan.json (exported from
src/lib/sitePlan.ts — the same geometry the engine routes on and the cockpit
renders, so this twin can never drift from the operating sim).

USAGE (UE 5.4 / 5.5, in an open project):
  1. Edit > Plugins > enable "Python Editor Script Plugin" (restart editor).
  2. Window > Developer Tools > Output Log → switch the console to Python.
  3. Run:  py "/ABSOLUTE/PATH/TO/ottoyarddepot-sim/unreal/ottoq_ue_build.py"

Re-runnable: every spawned actor is tagged OTTOQ and cleared on the next run.
Scale: 1 logical unit = 48 cm (~1.57 ft). Lot ≈ 138 m × 96 m.
"""

import json
import os
import unreal

# ----------------------------------------------------------------------------
U = 48.0          # cm per logical unit
TAG = "OTTOQ"
# __file__ is undefined when run via exec(open(...).read()) in the Python
# console — fall back to the repo's standard location.
try:
    _HERE = os.path.dirname(os.path.abspath(__file__))
except NameError:
    _HERE = os.path.expanduser("~/Desktop/ottoyarddepot-sim/unreal")
JSON_PATH = os.path.join(_HERE, "sitePlan.json")

eas = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)

CUBE = unreal.load_asset("/Engine/BasicShapes/Cube.Cube")
CYL = unreal.load_asset("/Engine/BasicShapes/Cylinder.Cylinder")

def _load_first(paths):
    for p in paths:
        a = unreal.load_asset(p)
        if a:
            return a
    return None

# Starter Content materials (fall back to the engine basic material)
BASIC = unreal.load_asset("/Engine/BasicShapes/BasicShapeMaterial.BasicShapeMaterial")
M = {
    "grass":    _load_first(["/Game/StarterContent/Materials/M_Ground_Grass.M_Ground_Grass"]) or BASIC,
    "asphalt":  _load_first(["/Game/StarterContent/Materials/M_Concrete_Poured.M_Concrete_Poured"]) or BASIC,
    "concrete": _load_first(["/Game/StarterContent/Materials/M_Concrete_Tiles.M_Concrete_Tiles"]) or BASIC,
    "steel":    _load_first(["/Game/StarterContent/Materials/M_Metal_Steel.M_Metal_Steel"]) or BASIC,
    "darkmetal": _load_first(["/Game/StarterContent/Materials/M_Metal_Burnished_Steel.M_Metal_Burnished_Steel"]) or BASIC,
    "wall":     _load_first(["/Game/StarterContent/Materials/M_Basic_Wall.M_Basic_Wall"]) or BASIC,
    "glass":    _load_first(["/Game/StarterContent/Materials/M_Glass.M_Glass"]) or BASIC,
    "gold":     _load_first(["/Game/StarterContent/Materials/M_Metal_Gold.M_Metal_Gold"]) or BASIC,
}

def W(x, y, z_cm=0.0):
    """logical (x, y) -> UE world. X=east, Y=south, Z=up (cm)."""
    return unreal.Vector((x - 150.0) * U, (y - 110.0) * U, z_cm)

def box(name, x, y, w, d, h, mat, z0=0.0):
    """Axis-aligned box from logical rect (center x,y; logical w/d; h + z0 in logical units)."""
    a = eas.spawn_actor_from_object(CUBE, W(x, y, (z0 + h / 2.0) * U), unreal.Rotator(0, 0, 0))
    a.set_actor_scale3d(unreal.Vector(max(w, 0.05) * U / 100.0, max(d, 0.05) * U / 100.0, max(h, 0.05) * U / 100.0))
    a.set_actor_label(name)
    a.tags = [unreal.Name(TAG)]
    try:
        a.static_mesh_component.set_material(0, mat)
    except Exception:
        pass
    return a

def cyl(name, x, y, r, h, mat, z0=0.0):
    a = eas.spawn_actor_from_object(CYL, W(x, y, (z0 + h / 2.0) * U), unreal.Rotator(0, 0, 0))
    a.set_actor_scale3d(unreal.Vector(r * 2 * U / 100.0, r * 2 * U / 100.0, h * U / 100.0))
    a.set_actor_label(name)
    a.tags = [unreal.Name(TAG)]
    try:
        a.static_mesh_component.set_material(0, mat)
    except Exception:
        pass
    return a

def clear_previous():
    n = 0
    for a in list(eas.get_all_level_actors()):
        try:
            if unreal.Name(TAG) in list(a.tags):
                eas.destroy_actor(a)
                n += 1
        except Exception:
            pass
    unreal.log(f"[OTTOQ] cleared {n} previous actors")

def spawn_class(cls, loc=unreal.Vector(0, 0, 0), rot=unreal.Rotator(0, 0, 0), label=""):
    a = eas.spawn_actor_from_class(cls, loc, rot)
    if label:
        a.set_actor_label(label)
    a.tags = [unreal.Name(TAG)]
    return a

def lighting_rig():
    # unreal.Rotator is (ROLL, PITCH, YAW) — pitch must be negative to aim
    # the sun DOWN. (Getting this wrong lights the sky and leaves the
    # ground pitch black.)
    sun = spawn_class(unreal.DirectionalLight, unreal.Vector(0, 0, 8000), unreal.Rotator(0.0, -42.0, 35.0), "OTTOQ_Sun")
    try:
        sun.light_component.set_intensity(10.0)
        sun.light_component.set_editor_property("atmosphere_sun_light", True)
    except Exception:
        pass
    spawn_class(unreal.SkyAtmosphere, unreal.Vector(0, 0, 0), label="OTTOQ_SkyAtmosphere")
    sky = spawn_class(unreal.SkyLight, unreal.Vector(0, 0, 5000), label="OTTOQ_SkyLight")
    try:
        sky.light_component.set_editor_property("real_time_capture", True)
    except Exception:
        pass
    try:
        spawn_class(unreal.VolumetricCloud, unreal.Vector(0, 0, 0), label="OTTOQ_Clouds")
    except Exception:
        pass
    try:
        fog = spawn_class(unreal.ExponentialHeightFog, unreal.Vector(0, 0, 0), label="OTTOQ_Fog")
        fog.component.set_editor_property("fog_density", 0.008)
    except Exception:
        pass

def build(plan):
    lot = plan["lot"]

    # ---- ground / lot / road ----
    box("OTTOQ_Grass", 150, 110, 460, 360, 0.3, M["grass"], z0=-0.32)
    box("OTTOQ_Lot", lot["x"] + lot["w"] / 2, lot["y"] + lot["h"] / 2, lot["w"], lot["h"], 0.3, M["asphalt"], z0=-0.28)
    box("OTTOQ_Road", 150, 215, 460, 12, 0.25, M["asphalt"], z0=-0.3)

    # forecourt + rear apron (concrete)
    box("OTTOQ_Forecourt", 142, 62, 156, 12, 0.06, M["concrete"])
    box("OTTOQ_RearApron", 172, 16, 216, 20, 0.06, M["concrete"])

    # ---- perimeter fence (gate gaps on the south run) ----
    fh, ft = 4.6, 0.25
    gw = plan["gateW"]
    inx, egx = plan["ingress"]["x"], plan["egress"]["x"]
    x0, y0, x1, y1 = lot["x"], lot["y"], lot["x"] + lot["w"], lot["y"] + lot["h"]
    box("OTTOQ_Fence_N", (x0 + x1) / 2, y0, lot["w"], ft, fh, M["darkmetal"])
    box("OTTOQ_Fence_W", x0, (y0 + y1) / 2, ft, lot["h"], fh, M["darkmetal"])
    box("OTTOQ_Fence_E", x1, (y0 + y1) / 2, ft, lot["h"], fh, M["darkmetal"])
    seg = [(x0, inx - gw / 2), (inx + gw / 2, egx - gw / 2), (egx + gw / 2, x1)]
    for i, (a, b) in enumerate(seg):
        box(f"OTTOQ_Fence_S{i}", (a + b) / 2, y1, b - a, ft, fh, M["darkmetal"])
    for gx, nm in [(inx, "In"), (egx, "Out")]:
        for s in (-1, 1):
            box(f"OTTOQ_Gate{nm}_Post{'L' if s < 0 else 'R'}", gx + s * gw / 2, y1, 1.2, 1.2, 6.2, M["steel"])

    # ---- BESS yard ----
    b = plan["bessYard"]
    box("OTTOQ_BESS_Pad", b["x"] + b["w"] / 2, b["y"] + b["h"] / 2, b["w"] - 2, b["h"] - 2, 0.08, M["concrete"])
    for i in range(3):
        box(f"OTTOQ_BESS_{i + 1}", b["x"] + 9 + i * 15, b["y"] + b["h"] / 2, 11, 16, 6.4, M["darkmetal"])
    box("OTTOQ_BESS_Inverter", b["x"] + b["w"] - 5, b["y"] + b["h"] / 2, 5, 8, 4, M["steel"])

    # ---- operations building + service bays ----
    bl = plan["building"]
    box("OTTOQ_Building", bl["x"] + bl["w"] / 2, bl["y"] + bl["h"] / 2, bl["w"], bl["h"], 13, M["wall"])
    box("OTTOQ_Building_Glass", bl["x"] + 19, bl["y"] + bl["h"] - 0.2, 34, 0.3, 8, M["glass"], z0=0.6)
    for i, dx in enumerate([120, 138]):
        box(f"OTTOQ_SVC{i + 1}_Front", dx, bl["y"] + bl["h"] - 0.1, 12, 0.4, 8.4, M["darkmetal"])
        box(f"OTTOQ_SVC{i + 1}_Rear", dx, bl["y"] + 0.1, 12, 0.4, 8.4, M["darkmetal"])

    # ---- wash bays ----
    wsh = plan["wash"]
    box("OTTOQ_Wash", wsh["x"] + wsh["w"] / 2, wsh["y"] + wsh["h"] / 2, wsh["w"], wsh["h"], 10, M["wall"])
    for i, dx in enumerate([168, 186, 204]):
        box(f"OTTOQ_W{i + 1}_Front", dx, wsh["y"] + wsh["h"] - 0.1, 11, 0.4, 7.4, M["glass"])
        box(f"OTTOQ_W{i + 1}_Rear", dx, wsh["y"] + 0.1, 11, 0.4, 7.4, M["darkmetal"])

    # ---- charging canopies + PV ----
    for c in plan["canopies"]:
        cy = c["y"] + c["h"] / 2
        box(f"OTTOQ_Canopy{c['id']}_Roof", c["cx"], cy, c["w"], c["h"], 0.7, M["darkmetal"], z0=11)
        box(f"OTTOQ_Canopy{c['id']}_PV", c["cx"], cy, c["w"] - 1.5, c["h"] - 1.5, 0.18, M["darkmetal"], z0=11.8)
        yy = c["y"] + 5
        while yy <= c["y"] + c["h"] - 5:
            for s in (-1, 1):
                box(f"OTTOQ_Canopy{c['id']}_Post", c["cx"] + s * (c["w"] / 2 - 1.4), yy, 1.0, 1.0, 11, M["steel"])
            yy += 22

    # ---- charger pedestals (beside each charging stall, toward its canopy spine) ----
    for s in plan["stalls"]:
        if s["type"] not in ("dcfc", "l2"):
            continue
        sx, sy = s["position"]["x"], s["position"]["y"]
        spine = min(plan["canopies"], key=lambda c: abs(c["cx"] - sx))["cx"]
        px = sx + (4.5 if spine > sx else -4.5)
        hh = 3.6 if s["type"] == "dcfc" else 2.8
        box(f"OTTOQ_CH_{s['id']}", px, sy, 1.3, 0.7, hh, M["steel"])

    # ---- perimeter carports ----
    for run in plan["parkRuns"]:
        cp = run.get("carport")
        if not cp:
            continue
        box(f"OTTOQ_Carport_{run['id']}_Roof", cp["x"] + cp["w"] / 2, cp["y"] + cp["h"] / 2, cp["w"], cp["h"], 0.5, M["darkmetal"], z0=8)
        if cp["w"] >= cp["h"]:
            xx = cp["x"] + 4
            while xx <= cp["x"] + cp["w"] - 4:
                box(f"OTTOQ_Carport_{run['id']}_Post", xx, cp["y"] + cp["h"] / 2, 0.8, 0.8, 8, M["steel"])
                xx += 20
        else:
            yy = cp["y"] + 4
            while yy <= cp["y"] + cp["h"] - 4:
                box(f"OTTOQ_Carport_{run['id']}_Post", cp["x"] + cp["w"] / 2, yy, 0.8, 0.8, 8, M["steel"])
                yy += 20

    # ---- light poles ----
    for i, p in enumerate(plan["lightPoles"]):
        cyl(f"OTTOQ_Pole{i + 1}", p["x"], p["y"], 0.32, 18, M["steel"])
        box(f"OTTOQ_PoleHead{i + 1}", p["x"] + 2.5, p["y"], 5, 0.5, 0.4, M["gold"], z0=17.6)

    unreal.log("[OTTOQ] depot geometry complete")

def main():
    with open(JSON_PATH, "r") as f:
        plan = json.load(f)
    unreal.log(f"[OTTOQ] building from {JSON_PATH} — {len(plan['stalls'])} stalls")
    clear_previous()
    lighting_rig()
    build(plan)
    try:
        les.save_current_level()
    except Exception:
        pass
    unreal.log("[OTTOQ] DONE — orbit the viewport. Re-run any time after layout changes.")

main()
