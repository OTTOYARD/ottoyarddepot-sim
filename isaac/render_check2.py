"""Definitive burial check: place ONE car at the lot centre, print its world
bound, render from ground level (horizontal)."""
import os, json, math
os.environ.setdefault("ACCEPT_EULA", "1")
from isaacsim import SimulationApp
app = SimulationApp({"headless": True, "width": 1600, "height": 900})

import omni.usd
from pxr import Usd, UsdGeom, Gf

ctx = omni.usd.get_context()
ctx.open_stage("/home/ubuntu/ottoyard_depot.usda")
stage = ctx.get_stage()

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

# place one car at the lot centre (world origin), facing north (180)
r = add_tesla("testcar", 0.0, 0.0, 180.0)
b = UsdGeom.Xformable(r).ComputeWorldBound(Usd.TimeCode.Default(), 'default').ComputeAlignedRange()
print("[BOUND] car Z min=%.2f max=%.2f  (wheels should be ~0, roof ~146)" % (b.GetMin()[2], b.GetMax()[2]))

import omni.replicator.core as rep

# ground-level camera, 8m south of the car, 70cm high, looking at the car body
camera = rep.create.camera(position=(0, -800, 70), look_at=(0, 0, 70), focal_length=35.0)
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
