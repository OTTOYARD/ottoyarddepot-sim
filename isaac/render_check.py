"""Render the NEW depot + a Tesla at DCFC-01 with the exact stream transform, to
diagnose the 'buried cars' + exposure. Saves PNG to ~/render_check/."""
import os, json, math
os.environ.setdefault("ACCEPT_EULA", "1")
from isaacsim import SimulationApp
app = SimulationApp({"headless": True, "width": 1600, "height": 900})

import omni.usd
from pxr import Usd, UsdGeom, Gf

ctx = omni.usd.get_context()
ctx.open_stage("/home/ubuntu/ottoyard_depot.usda")
stage = ctx.get_stage()

FT = 30.48
LOT_CX_FT = 226.06299212598425
LOT_CY_FT = 156.98818897637793
def feet_to_cm(fx, fy):
    return (fx - LOT_CX_FT) * FT, (fy - LOT_CY_FT) * FT

# tune lighting — MATCH what the stream SHOULD use (exposure 0, no 2^9 blowout)
for prim in Usd.PrimRange(stage.GetPseudoRoot()):
    t = prim.GetTypeName()
    if t == "DistantLight":
        prim.GetAttribute("inputs:intensity").Set(3000.0)
        prim.GetAttribute("inputs:exposure").Set(0.0)
    elif t == "DomeLight":
        prim.GetAttribute("inputs:intensity").Set(2000.0)
        prim.GetAttribute("inputs:exposure").Set(0.0)

def add_tesla(name, wx, wy, heading_deg):
    root = UsdGeom.Xform.Define(stage, f"/World/Vehicles/{name}")
    root.ClearXformOpOrder()
    root.AddTranslateOp().Set(Gf.Vec3d(wx, wy, 0.0))
    root.AddRotateZOp().Set(float(heading_deg))
    root.AddRotateXOp().Set(90.0)
    car = UsdGeom.Xform.Define(stage, f"/World/Vehicles/{name}/car")
    car.ClearXformOpOrder()
    car.AddTranslateOp().Set(Gf.Vec3d(0.0, 69.77, 0.0))
    car.AddScaleOp().Set(Gf.Vec3f(0.488216, 0.488216, 0.488216))
    car.GetPrim().GetReferences().AddReference("/home/ubuntu/tesla_model3.usdz")
    return root

# place Teslas at a few DCFC + L2 stalls (layoutSeed feet)
seed = json.load(open("/home/ubuntu/layoutSeed.json"))
placed = 0
for s in seed["stalls"]:
    if s["stall_type"] not in ("dcfc", "l2"):
        continue
    wx, wy = feet_to_cm(s["relative_x"], s["relative_y"])
    hd = float(s.get("heading_degrees", 180))
    add_tesla("veh_" + s["stall_code"].replace("-", "_"), wx, wy, hd)
    placed += 1
    if placed >= 8:
        break
print(f"[RENDER] placed {placed} cars")

import omni.replicator.core as rep

# side/low view of the FIRST car (NASH-DCFC-STALL-01 at cm ~(-2584, 861))
camera = rep.create.camera(
    position=(-2584 + 1200, 861 - 1800, 150),
    look_at=(-2584, 861, 60),
    focal_length=35.0,
)
rp = rep.create.render_product(camera, (1600, 900))

for _ in range(25):
    rep.orchestrator.step()
    app.update()

import time
os.makedirs("/home/ubuntu/render_check", exist_ok=True)
writer = rep.WriterRegistry.get("BasicWriter")
writer.initialize(output_dir="/home/ubuntu/render_check", rgb=True)
writer.attach([rp])
rep.orchestrator.step()
time.sleep(1)
rep.orchestrator.step()
print("[RENDER] done")
app.close()
