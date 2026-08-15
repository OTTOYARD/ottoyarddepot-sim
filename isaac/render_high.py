"""Render from the stream's camera angle — high from the south, depot bbox."""
import os, json
os.environ.setdefault("ACCEPT_EULA","1")
from isaacsim import SimulationApp
app = SimulationApp({"headless":True,"width":1600,"height":900})
import omni.usd, omni.replicator.core as rep
from pxr import Usd,UsdGeom,Gf
ctx=omni.usd.get_context();ctx.open_stage("/home/ubuntu/ottoyard_depot.usda")
stage=ctx.get_stage()
for prim in Usd.PrimRange(stage.GetPseudoRoot()):
    t=prim.GetTypeName()
    if t=="DistantLight":prim.GetAttribute("inputs:intensity").Set(4000.0);prim.GetAttribute("inputs:exposure").Set(0.0)
    elif t=="DomeLight":prim.GetAttribute("inputs:intensity").Set(3000.0);prim.GetAttribute("inputs:exposure").Set(0.0)
# place a few cars at DCFC stalls
FT=30.48;L_CX=226.063;L_CY=156.988
seed=json.load(open("/home/ubuntu/layoutSeed.json"))
n=0
for s in seed["stalls"]:
    if s["stall_type"]!="dcfc":continue
    wx,wy=(s["relative_x"]-L_CX)*FT,(s["relative_y"]-L_CY)*FT
    r=UsdGeom.Xform.Define(stage,f"/World/Vehicles/c{n}")
    r.ClearXformOpOrder();r.AddTranslateOp().Set(Gf.Vec3d(wx,wy,0));r.AddRotateZOp().Set(float(s.get("heading_degrees",180)));r.AddRotateXOp().Set(90.0)
    c=UsdGeom.Xform.Define(stage,f"/World/Vehicles/c{n}/car")
    c.ClearXformOpOrder();c.AddTranslateOp().Set(Gf.Vec3d(0,69.77,0));c.AddScaleOp().Set(Gf.Vec3f(0.488216,0.488216,0.488216))
    c.GetPrim().GetReferences().AddReference("/home/ubuntu/tesla_model3.usdz")
    n+=1
    if n>=6:break
# Stream-like camera: high from the south, looking at lot centre
cam=rep.create.camera(position=(0,-14000,9000),look_at=(0,0,0),focal_length=28.0)
rp=rep.create.render_product(cam,(1600,900))
for _ in range(30):rep.orchestrator.step();app.update()
import time;os.makedirs("/home/ubuntu/render_check",exist_ok=True)
w=rep.WriterRegistry.get("BasicWriter");w.initialize(output_dir="/home/ubuntu/render_check",rgb=True);w.attach([rp])
rep.orchestrator.step();time.sleep(1);rep.orchestrator.step()
print("[RENDER] done");app.close()