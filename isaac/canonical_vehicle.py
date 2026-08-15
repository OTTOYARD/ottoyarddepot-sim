"""Canonical (cm, Z-up) Tesla vehicle prims for the Isaac Sim photoreal tier.

The depot is the CANONICAL ottoyard_depot.usda (from ottoq_usd_build.py):
metersPerUnit=0.01 (cm), upAxis=Z, plan units mapped via U=48 cm/unit centred at
(150, 110) with Y negated. The Tesla USDZ is Y-up, so we rotate the vehicle root
rotateX(+90) to convert, and scale 0.488216 to fit car.length_m 4.8807.
"""
import math

from pxr import UsdGeom, Gf

U = 48.0
TESLA_SCALE = 0.488216          # cm stage (100x the metre-stage 0.00488216)
GROUND_OFFSET_CM = 69.77        # wheels-on-ground offset (cm)
TESLA_PATH = "/home/ubuntu/tesla_model3.usdz"

NORTH = -math.pi / 2
DEPOT_CX = 150
DEPOT_CY = 106


def plan_to_cm(px, py):
    """Plan units (x=east, y=south) -> canonical cm (x=east, y=north)."""
    return (px - 150.0) * U, -(py - 110.0) * U


def heading_to_canonical(theta_rad):
    """Twin heading (radians, 0=+x/east, y-down) -> canonical rotateZ degrees.

    Canonical Y is -plan Y, so the angle negates."""
    return -theta_rad * 180.0 / math.pi


def parked_heading_canonical_deg(lane, angle_deg, sx, sy):
    """Twin parkedHeading() -> canonical rotateZ degrees (see TwinMotionDriver.ts)."""
    if lane in ("dcfc", "l2", "wash", "service"):
        theta = NORTH
    else:
        vertical = angle_deg in (90, 270)
        if vertical:
            theta = math.pi if sx < DEPOT_CX else 0.0
        else:
            theta = NORTH if sy < DEPOT_CY else math.pi / 2
    return heading_to_canonical(theta)


def _define(cls, stage, path):
    p = cls.Define(stage, path)
    p.ClearXformOpOrder()
    return p


def build_tesla(stage, vehicle_id, wx_cm=0.0, wy_cm=0.0, heading_canonical_deg=0.0):
    """Build one photoreal Tesla at canonical cm coords. Returns root path.

    Prim path matches OttoMotion's default: /World/Vehicles/veh_<uuid>.

    Orientation: the Tesla USDZ is Y-up with length along Z (bbox X=width,
    Y=height, Z=length). rotateX(90) turns Y-up into Z-up; it must be applied
    BEFORE the heading rotation, so rotateX is added LAST (USD applies the last
    xformOp first). OttoMotion owns the heading via xformOp:rotateZ, which is
    added BEFORE rotateX so it composes on top of the up-flip."""
    vid = vehicle_id.replace("-", "_")
    root = f"/World/Vehicles/veh_{vid}"

    veh = _define(UsdGeom.Xform, stage, root)
    veh.AddTranslateOp().Set(Gf.Vec3d(wx_cm, wy_cm, 0.0))
    veh.AddRotateZOp().Set(float(heading_canonical_deg))  # heading (applied after rotateX)
    veh.AddRotateXOp().Set(90.0)                          # Y-up -> Z-up (applied first)

    car = _define(UsdGeom.Xform, stage, f"{root}/car")
    car.GetPrim().GetReferences().AddReference(TESLA_PATH)
    car.AddTranslateOp().Set(Gf.Vec3d(0.0, GROUND_OFFSET_CM, 0.0))
    car.AddScaleOp().Set(Gf.Vec3f(TESLA_SCALE, TESLA_SCALE, TESLA_SCALE))

    return root


def set_tesla_pose(stage, root, wx_cm, wy_cm, heading_canonical_deg):
    """Move an existing Tesla prim (translate + rotateZ)."""
    prim = stage.GetPrimAtPath(root)
    if not prim.IsValid():
        return
    veh = UsdGeom.Xform(prim)
    veh.GetTranslateOp().Set(Gf.Vec3d(wx_cm, wy_cm, 0.0))
    try:
        h = float(heading_canonical_deg)
        if math.isnan(h):
            h = 0.0
    except (TypeError, ValueError):
        h = 0.0
    z_op = veh.GetRotateZOp()
    if z_op:
        z_op.Set(h)
