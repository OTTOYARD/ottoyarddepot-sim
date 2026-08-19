# PARKED_ISAAC — Track B (Isaac Sim / Omniverse / UE photoreal) is parked per otto-q-core/CLAUDE.md 2.8.
# Not imported by the app; kept for future reattachment. Do not extend without unparking Track B.
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
import math
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

def tbox(name, x, y, w, d, thick, mat, center_z_u, pitch_deg):
    """Tilted slab: box centered at logical (x,y) and height center_z_u (logical
    units), pitched pitch_deg about the world Y axis. Used for sloped roofs."""
    a = eas.spawn_actor_from_object(CUBE, W(x, y, center_z_u * U), unreal.Rotator(0.0, pitch_deg, 0.0))
    a.set_actor_scale3d(unreal.Vector(max(w, 0.05) * U / 100.0, max(d, 0.05) * U / 100.0, max(thick, 0.05) * U / 100.0))
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

    # ---- guard booths + boom-barrier gates (security layer) ----
    for gx, nm in [(inx, "In"), (egx, "Out")]:
        side = 1.0 if gx < 150 else -1.0            # booth toward the median between the two gates
        bxp = gx + side * (gw / 2 + 4.0)            # beside the gate gap, clear of the drive lane
        box(f"OTTOQ_Building_Guard{nm}", bxp, y1 - 4.5, 3.6, 3.8, 3.6, M["wall"])
        box(f"OTTOQ_RoofDark_Guard{nm}", bxp, y1 - 4.5, 4.2, 4.4, 0.4, M["darkmetal"], z0=3.6)
        box(f"OTTOQ_Building_Glass_Guard{nm}", bxp - side * 1.85, y1 - 4.5, 0.2, 3.0, 1.8, M["glass"], z0=1.4)
        # boom barrier: pivot post at the gap edge + arm across the lane
        # (named OTTOQ_GateArm_* for later raise/lower animation)
        box(f"OTTOQ_Gate_Boom{nm}", gx - gw / 2 + 0.6, y1 - 0.5, 0.9, 0.9, 2.6, M["steel"])
        box(f"OTTOQ_GateArm_{nm}", gx, y1 - 0.5, gw - 1.5, 0.4, 0.4, M["gold"], z0=1.8)

    # ---- BESS yard ----
    b = plan["bessYard"]
    box("OTTOQ_BESS_Pad", b["x"] + b["w"] / 2, b["y"] + b["h"] / 2, b["w"] - 2, b["h"] - 2, 0.08, M["concrete"])
    for i in range(3):
        box(f"OTTOQ_BESS_{i + 1}", b["x"] + 9 + i * 15, b["y"] + b["h"] / 2, 11, 16, 6.4, M["darkmetal"])
    box("OTTOQ_BESS_Inverter", b["x"] + b["w"] - 5, b["y"] + b["h"] / 2, 5, 8, 4, M["steel"])

    # ---- OPEN PULL-THROUGH BAY SHED (reused for service + wash) ----
    # Open front & rear (roll-up doors shown retracted), side/end walls, a
    # ridge of partitions between bays, dark interior + equipment. No solid
    # front wall below the lintel — AVs pull straight in, techs work inside.
    def open_bay(prefix, x0, y0, w, h, height, door_xs, ohalf, kind):
        cxx, cyy = x0 + w / 2.0, y0 + h / 2.0
        yN, yS = y0, y0 + h
        DH = height - 1.4  # door-opening height
        dark, wall, steel = M["darkmetal"], M["wall"], M["steel"]
        box(f"{prefix}_Roof", cxx, cyy, w, h, 0.7, dark, z0=height)
        box(f"{prefix}_Wall_W", x0 + 0.5, cyy, 1.0, h, height, wall)
        box(f"{prefix}_Wall_E", x0 + w - 0.5, cyy, 1.0, h, height, wall)
        box(f"{prefix}_Wall_LintelS", cxx, yS - 0.4, w, 0.8, height - DH, wall, z0=DH)
        box(f"{prefix}_Wall_LintelN", cxx, yN + 0.4, w, 0.8, height - DH, wall, z0=DH)
        # bay boundaries: end walls + midpoints between adjacent doors. Each bay's
        # opening (door, floor, equipment) is sized to its actual span so the door
        # matches the full opening width — not a fixed guess.
        bounds = [x0] + [(door_xs[i] + door_xs[i + 1]) / 2.0 for i in range(len(door_xs) - 1)] + [x0 + w]
        for i in range(1, len(bounds) - 1):
            box(f"{prefix}_Wall_Part{i}", bounds[i], cyy, 0.8, h, DH, wall)
        for i, dx in enumerate(door_xs):
            di = int(dx)
            bcx = (bounds[i] + bounds[i + 1]) / 2.0       # true bay center
            opening = (bounds[i + 1] - bounds[i]) - 1.6   # clear opening between partitions/walls
            hw = opening / 2.0
            box(f"OTTOQ_BayFloor_{di}", bcx, cyy, opening + 0.6, h - 1.0, 0.12, dark, z0=0.05)
            # RETRACTABLE roll-up doors — retracted to a coil under the lintel,
            # door spans the FULL opening, with side tracks on both jambs (front +
            # rear). Bay is hollow front-to-back; named for later open/close anim.
            for ye, tag in ((yS - 0.45, "S"), (yN + 0.45, "N")):
                box(f"{prefix}_Door{tag}_{di}", bcx, ye, opening, 0.55, 1.0, dark, z0=DH - 1.0)
                box(f"{prefix}_Post_Trk{tag}L_{di}", bcx - hw - 0.15, ye, 0.25, 0.45, DH, steel)
                box(f"{prefix}_Post_Trk{tag}R_{di}", bcx + hw + 0.15, ye, 0.25, 0.45, DH, steel)
            if kind == "wash":
                # overhead wash gantry + sprayer boom — ALL above vehicle height
                box(f"{prefix}_Post_GantL_{di}", bcx - hw + 0.5, cyy, 0.4, 0.4, height - 1.8, steel)
                box(f"{prefix}_Post_GantR_{di}", bcx + hw - 0.5, cyy, 0.4, 0.4, height - 1.8, steel)
                box(f"{prefix}_Post_GantTop_{di}", bcx, cyy, opening - 1.0, 0.6, 0.5, steel, z0=height - 1.8)
                box(f"{prefix}_Post_Spray_{di}", bcx, cyy, 0.3, h - 7, 0.3, steel, z0=height - 2.6)
            else:
                # two-post lift: posts at the bay EDGES + overhead cross-arm,
                # so the center lane stays clear for pull-through.
                box(f"{prefix}_Post_LiftL_{di}", bcx - hw + 0.6, cyy + 2, 0.5, 0.5, 6.2, steel)
                box(f"{prefix}_Post_LiftR_{di}", bcx + hw - 0.6, cyy + 2, 0.5, 0.5, 6.2, steel)
                box(f"{prefix}_Post_LiftArm_{di}", bcx, cyy + 2, opening - 1.2, 0.4, 0.3, steel, z0=6.0)

    # ---- operations building: GLASS office hub (west) + open service bays (east) ----
    bl = plan["building"]
    ox, oy, oh = bl["x"], bl["y"], bl["h"]
    ow = 40.0
    ocx, ocy = ox + ow / 2.0, oy + oh / 2.0
    OH = 14.0
    # Uniform glass curtain wall wrapping S + W + E (corner-to-corner, no side
    # gap); opaque rear (north) wall + roof; a single interior glow volume so
    # all glass faces read consistently lit.
    box("OTTOQ_Building_Core", ocx, oy + 0.7, ow, 1.4, OH, M["wall"])               # rear (north) wall
    box("OTTOQ_RoofDark_Office", ocx, ocy, ow, oh, 0.7, M["darkmetal"], z0=OH)
    box("OTTOQ_LitInterior_Office", ocx, ocy + 1.0, ow - 4, oh - 5, OH - 4.0, M["glass"], z0=1.6)
    box("OTTOQ_Building_Glass_S", ocx, oy + oh - 0.3, ow, 0.5, OH - 1.0, M["glass"], z0=0.6)
    box("OTTOQ_Building_Glass_W", ox + 0.3, ocy, 0.5, oh, OH - 1.0, M["glass"], z0=0.6)
    box("OTTOQ_Building_Glass_E", ox + ow - 0.3, ocy, 0.5, oh, OH - 1.0, M["glass"], z0=0.6)
    box("OTTOQ_Building_Floor2", ocx, oy + oh - 0.25, ow, 0.6, 0.4, M["darkmetal"], z0=OH / 2.0)
    mx = ox + 4
    while mx <= ox + ow - 4:
        box(f"OTTOQ_Building_Post_Mul_{int(mx)}", mx, oy + oh - 0.05, 0.3, 0.3, OH - 1.2, M["steel"], z0=0.6)
        mx += 5
    box("OTTOQ_Sign_Office", ocx, oy + oh - 0.05, 20, 0.5, 2.2, M["gold"], z0=OH - 3.0)
    # 2 open service bays (east half of the building footprint)
    open_bay("OTTOQ_SVC", 110.0, oy, 40.0, oh, 11.0, [120, 138], 6.0, "service")

    # ---- wash / detailing bays (open self-serve, retractable doors) ----
    wsh = plan["wash"]
    open_bay("OTTOQ_Wash", wsh["x"], wsh["y"], wsh["w"], wsh["h"], 10.0, [168, 186, 204], 6.0, "wash")
    box("OTTOQ_Sign_Wash", wsh["x"] + wsh["w"] / 2.0, wsh["y"] + wsh["h"] - 0.05, 16, 0.5, 1.8, M["gold"], z0=10.2)

    # ---- charging canopies: CENTRAL-SPINE BUTTERFLY ----
    # Columns run ONLY down the center spine so AVs pull in/out from both sides
    # with nothing in their path; the roof cantilevers out as two PV slopes that
    # peak at the ridge and fall to the eaves (matches the ref renders).
    R, E = 13.0, 10.5  # ridge (center) and eave (outer) heights, logical units
    for c in plan["canopies"]:
        cy = c["y"] + c["h"] / 2
        half = c["w"] / 2.0
        theta = math.degrees(math.atan2(R - E, half))
        # central column spine — single row at cx
        yy = c["y"] + 6
        while yy <= c["y"] + c["h"] - 6:
            box(f"OTTOQ_Canopy{c['id']}_Post_Col", c["cx"], yy, 1.5, 1.5, R, M["steel"])
            yy += 19
        # ridge beam along the spine
        box(f"OTTOQ_Canopy{c['id']}_Post_Ridge", c["cx"], cy, 1.8, c["h"], 0.9, M["steel"], z0=R - 0.5)
        # two tilted PV roof slopes: inner edge high at ridge, outer low at eave
        for side in (-1, 1):
            tbox(f"OTTOQ_Canopy{c['id']}_PVSlope_{'E' if side > 0 else 'W'}",
                 c["cx"] + side * (half / 2.0), cy, half + 1.5, c["h"] + 1.5, 0.5,
                 M["darkmetal"], (R + E) / 2.0, -side * theta)

    # ---- charger pedestals: realistic DCFC / L2 units beside each stall ----
    # housing + chamfered cap, a car-facing screen, a teal status strip, and a
    # connector holster — DCFC taller/wider than L2.
    for s in plan["stalls"]:
        if s["type"] not in ("dcfc", "l2"):
            continue
        sx, sy = s["position"]["x"], s["position"]["y"]
        spine = min(plan["canopies"], key=lambda c: abs(c["cx"] - sx))["cx"]
        px = sx + (4.5 if spine > sx else -4.5)
        sgn = 1.0 if sx > px else -1.0  # +1 = car is to the +x side of the pedestal
        sid = s["id"]
        is_dc = s["type"] == "dcfc"
        hh = 3.8 if is_dc else 2.8
        ww = 1.4 if is_dc else 1.0
        box(f"OTTOQ_CH_{sid}_Base", px, sy, ww + 0.7, 1.3, 0.25, M["steel"])
        box(f"OTTOQ_CH_{sid}", px, sy, ww, 0.9, hh, M["steel"], z0=0.25)
        box(f"OTTOQ_CH_{sid}_Cap", px, sy, ww + 0.25, 1.1, 0.4, M["steel"], z0=hh + 0.25)
        box(f"OTTOQ_ChScr_{sid}", px + sgn * (ww / 2 + 0.04), sy, 0.12, 0.55, 0.8, M["glass"], z0=hh * 0.6)
        box(f"OTTOQ_ChLED_{sid}", px, sy, ww * 0.85, 0.95, 0.16, M["gold"], z0=hh - 0.15)
        box(f"OTTOQ_CH_{sid}_Hol", px + sgn * (ww / 2 + 0.05), sy + 0.45, 0.3, 0.3, 0.9, M["steel"], z0=hh * 0.45)

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

    # ---- METRO CITY SURROUNDINGS: skyline massing + perimeter trees + sidewalk ----
    SPHERE = unreal.load_asset("/Engine/BasicShapes/Sphere.Sphere")

    def rnd(i):  # deterministic 0..1 (stable across runs)
        v = math.sin(i * 12.9898) * 43758.5453
        return v - math.floor(v)

    def sph(name, x, y, dia, z_cm, mat):
        a = eas.spawn_actor_from_object(SPHERE, W(x, y, z_cm), unreal.Rotator(0, 0, 0))
        a.set_actor_scale3d(unreal.Vector(dia * U / 100.0, dia * U / 100.0, dia * U / 100.0))
        a.set_actor_label(name)
        a.tags = [unreal.Name(TAG)]
        try:
            a.static_mesh_component.set_material(0, mat)
        except Exception:
            pass
        return a

    def tree(tid, x, y, s=1.0):
        cyl(f"OTTOQ_TreeTrunk_{tid}", x, y, 0.32 * s, 3.2 * s, M["wall"])
        sph(f"OTTOQ_TreeFol_{tid}a", x, y, 3.4 * s, 4.4 * s * U, M["grass"])
        sph(f"OTTOQ_TreeFol_{tid}b", x + 0.7 * s, y + 0.5 * s, 2.6 * s, 5.8 * s * U, M["grass"])

    # city blocks ringing the site (varied heights, mid-rise → tower)
    blocks = []
    for i in range(8):   # north (behind)
        blocks.append((18 + i * 36, -42 - rnd(i) * 70, 20 + rnd(i + 1) * 12, 20 + rnd(i + 2) * 14))
    for i in range(6):   # west
        blocks.append((-48 - rnd(i + 10) * 55, 24 + i * 32, 20 + rnd(i + 11) * 12, 22 + rnd(i + 12) * 10))
    for i in range(6):   # east
        blocks.append((346 + rnd(i + 20) * 55, 24 + i * 32, 20 + rnd(i + 21) * 12, 22 + rnd(i + 22) * 10))
    for i in range(5):   # south, across the road
        blocks.append((34 + i * 58, 252 + rnd(i + 30) * 28, 24 + rnd(i + 31) * 12, 18 + rnd(i + 32) * 8))
    for j, (cx, cy, cw, cd) in enumerate(blocks):
        ch = 16 + rnd(j) * 48
        tag = "OTTOQ_City_B" if j % 3 == 0 else "OTTOQ_City_A"
        box(f"{tag}_{j}", cx, cy, cw, cd, ch, M["wall"])
        box(f"OTTOQ_RoofDark_City{j}", cx, cy, cw + 0.5, cd + 0.5, 0.6, M["darkmetal"], z0=ch)

    # perimeter tree rows (just outside the fence on the grass apron) + north row
    ti, yy = 0, 30
    while yy <= 200:
        tree(ti, -3, yy, 1.0 + rnd(ti) * 0.4); ti += 1
        tree(ti, 299, yy, 1.0 + rnd(ti + 7) * 0.4); ti += 1
        yy += 22
    xx = 30
    while xx <= 270:
        tree(ti, xx, -14, 1.0 + rnd(ti) * 0.4); ti += 1
        xx += 34

    # frontage sidewalk along the public road
    box("OTTOQ_Walk_S", 150, 208.5, 288, 2.5, 0.12, M["concrete"], z0=0.03)

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
