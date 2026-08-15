"""Canonical (cm, Z-up) robotic charging arm for the Isaac Sim photoreal tier.

Mounted on top of the charger pedestal. 2-joint (shoulder + elbow), matching the
browser's ChargingArm.tsx exactly but up-res'd: real torus LED rings (emissive),
PBR metallic materials, and a charge cable. Shoulder/elbow rotate on Y (Z-up
equivalent of the browser's rotateX) to swing the arm from the folded vertical
mast toward the vehicle's nearest rear quarter panel.
"""
import math

from pxr import UsdGeom, Gf, UsdShade, Sdf, Vt

ACCENT = {"dcfc": (0.0, 0.74, 0.83), "l2": (1.0, 0.76, 0.03)}

# Charger cap top height (canonical): pedestal hh=3.8 plan units @ z0=0.25,
# cap h=0.4 @ z0=hh+0.25 -> top = (3.8 + 0.25 + 0.4) * U
U = 48.0
ARM_SHOULDER_Z = 120.0  # shoulder mount height (cm) on the charger — ~waist height

# Arm dimensions (cm). The browser's ChargingArm.tsx is sized in PLAN UNITS, so
# real length = value x U (2.4u -> 115cm, 1.4u -> 67cm). Thickness bumped a bit
# above the browser's 0.08u/0.06u (3.8/2.9cm) for a substantial industrial look.
UPPER_LEN = 115.0
FOREARM_LEN = 67.0

SHOULDER_EXT = 74.0   # deg, shoulder rotateY to swing the upper arm forward (16° above horiz)
ELBOW_EXT = 88.0      # deg, elbow rotateY to bend the forearm down to the port (+ built-in 14°)

PHASE_PROGRESS = {
    "unstow": 0.15, "approach": 0.45, "align": 0.75, "insert": 0.95, "latch": 1.00,
    "unlatch": 0.95, "extract": 0.50, "retract": 0.10,
}


def _define(cls, stage, path):
    p = cls.Define(stage, path)
    p.ClearXformOpOrder()
    return p


def _mat(stage, name, rgb, metallic=0.9, roughness=0.3, emissive=None, emissive_intensity=1.0):
    m = UsdShade.Material.Define(stage, f"/World/Arms/Materials/{name}")
    sh = UsdShade.Shader.Define(stage, f"/World/Arms/Materials/{name}/Shader")
    sh.CreateIdAttr("UsdPreviewSurface")
    sh.CreateInput("diffuseColor", Sdf.ValueTypeNames.Color3f).Set(Gf.Vec3f(*rgb))
    sh.CreateInput("metallic", Sdf.ValueTypeNames.Float).Set(metallic)
    sh.CreateInput("roughness", Sdf.ValueTypeNames.Float).Set(roughness)
    if emissive:
        sh.CreateInput("emissiveColor", Sdf.ValueTypeNames.Color3f).Set(Gf.Vec3f(*emissive))
        sh.CreateInput("emissiveIntensity", Sdf.ValueTypeNames.Float).Set(emissive_intensity)
    m.CreateSurfaceOutput().ConnectToSource(sh.ConnectableAPI(), "surface")
    return m


def _bind(m, prim):
    UsdShade.MaterialBindingAPI.Apply(prim.GetPrim()).Bind(m)


def _torus(stage, path, R, r, seg_ring=36, seg_tube=16):
    """Torus mesh in the X-Y plane (ring around Z), radii in cm."""
    pts = []
    for i in range(seg_ring):
        u = 2.0 * math.pi * i / seg_ring
        cu, su = math.cos(u), math.sin(u)
        for j in range(seg_tube):
            v = 2.0 * math.pi * j / seg_tube
            rr = R + r * math.cos(v)
            pts.append(Gf.Vec3f(rr * cu, rr * su, r * math.sin(v)))
    counts, idxs = [], []
    for i in range(seg_ring):
        i2 = (i + 1) % seg_ring
        for j in range(seg_tube):
            j2 = (j + 1) % seg_tube
            a = i * seg_tube + j
            b = i * seg_tube + j2
            c = i2 * seg_tube + j2
            d = i2 * seg_tube + j
            counts.append(4)
            idxs.extend([a, b, c, d])
    mesh = UsdGeom.Mesh.Define(stage, path)
    mesh.CreatePointsAttr(Vt.Vec3fArray(pts))
    mesh.CreateFaceVertexCountsAttr(Vt.IntArray(counts))
    mesh.CreateFaceVertexIndicesAttr(Vt.IntArray(idxs))
    return mesh


def _cyl(stage, path, r, h):
    """Cylinder along Z: radius r (cm), height h (cm)."""
    c = _define(UsdGeom.Cylinder, stage, path)
    c.AddScaleOp().Set(Gf.Vec3f(r, r, h / 2.0))
    return c


def _box(stage, path, w, d, h):
    """Box: w x d x h (cm)."""
    b = _define(UsdGeom.Cube, stage, path)
    b.AddScaleOp().Set(Gf.Vec3f(w / 2.0, d / 2.0, h / 2.0))
    return b


def build_arm(stage, stall_id, stall_type, wx_cm, wy_cm, toward_sign):
    """Build one arm at the charger (wx,wy) mounted on the charger top.

    toward_sign: +1 -> the vehicle is +X (east) of the charger (arm swings +X);
                 -1 -> the vehicle is -X (west) (arm swings -X).
    Returns (root_path, shoulder_rotY_op, elbow_rotY_op).
    """
    sid = "s" + "".join(c for c in stall_id if c.isalnum() or c == "_")[:8]
    root = f"/World/Arms/arm_{sid}"

    silver = _mat(stage, f"ArmSilver_{sid}", (0.76, 0.77, 0.79), 0.85, 0.28)
    dark = _mat(stage, f"ArmDark_{sid}", (0.15, 0.16, 0.17), 0.92, 0.18)
    conn_m = _mat(stage, f"ArmConn_{sid}", (0.95, 0.95, 0.96), 0.3, 0.45)
    rubber = _mat(stage, f"ArmRubber_{sid}", (0.05, 0.05, 0.06), 0.05, 0.85)
    accent = ACCENT.get(stall_type, ACCENT["dcfc"])
    led = _mat(stage, f"ArmLED_{sid}", accent, 0.2, 0.3, emissive=accent, emissive_intensity=2.5)

    # Root at the charger, shoulder mounted at waist height; forward (+X local) -> vehicle
    arm = _define(UsdGeom.Xform, stage, root)
    arm.AddTranslateOp().Set(Gf.Vec3d(wx_cm, wy_cm, ARM_SHOULDER_Z))
    arm.AddRotateZOp().Set(0.0 if toward_sign > 0 else 180.0)

    # Base flange
    _bind(dark, _cyl(stage, f"{root}/flange", 12.0, 4.0))

    # Shoulder joint (turret) — rotates on Y
    shoulder = _define(UsdGeom.Xform, stage, f"{root}/shoulder")
    shoulder.AddRotateYOp().Set(0.0)
    sh_rot = shoulder.GetRotateYOp()

    _bind(dark, _cyl(stage, f"{root}/shoulder/housing", 10.0, 12.0))
    _bind(led, _torus(stage, f"{root}/shoulder/led", 11.0, 1.4))

    # Upper arm (long in Z) — child of shoulder
    upper = _define(UsdGeom.Cube, stage, f"{root}/shoulder/upper")
    upper.AddTranslateOp().Set(Gf.Vec3d(0.0, 0.0, UPPER_LEN / 2.0))
    upper.AddScaleOp().Set(Gf.Vec3f(6.0, 6.0, UPPER_LEN / 2.0))
    _bind(silver, upper)

    # Elbow joint at the top of the upper arm — rotates on Y
    elbow = _define(UsdGeom.Xform, stage, f"{root}/shoulder/elbow")
    elbow.AddTranslateOp().Set(Gf.Vec3d(0.0, 0.0, UPPER_LEN))
    elbow.AddRotateYOp().Set(0.0)
    el_rot = elbow.GetRotateYOp()

    _bind(dark, _cyl(stage, f"{root}/shoulder/elbow/housing", 8.0, 10.0))
    _bind(led, _torus(stage, f"{root}/shoulder/elbow/led", 9.0, 1.1))

    # Forearm (long in Z, slight forward bend) — child of elbow
    forearm = _define(UsdGeom.Cube, stage, f"{root}/shoulder/elbow/forearm")
    forearm.AddTranslateOp().Set(Gf.Vec3d(8.0, 0.0, FOREARM_LEN / 2.0))
    forearm.AddRotateYOp().Set(14.0)
    forearm.AddScaleOp().Set(Gf.Vec3f(5.0, 5.0, FOREARM_LEN / 2.0))
    _bind(silver, forearm)

    # Wrist
    wrist = _define(UsdGeom.Xform, stage, f"{root}/shoulder/elbow/wrist")
    wrist.AddTranslateOp().Set(Gf.Vec3d(16.0, 0.0, FOREARM_LEN))

    _bind(dark, _cyl(stage, f"{root}/shoulder/elbow/wrist/housing", 5.0, 6.0))
    _bind(led, _torus(stage, f"{root}/shoulder/elbow/wrist/led", 5.5, 0.9))

    # Connector plug (cylinder along X, pointing forward) + tip
    conn = _define(UsdGeom.Cylinder, stage, f"{root}/shoulder/elbow/wrist/connector")
    conn.AddRotateYOp().Set(90.0)
    conn.AddScaleOp().Set(Gf.Vec3f(2.5, 4.5, 2.5))
    _bind(conn_m, conn)

    tip = _define(UsdGeom.Sphere, stage, f"{root}/shoulder/elbow/wrist/tip")
    tip.AddTranslateOp().Set(Gf.Vec3d(7.0, 0.0, 0.0))
    tip.AddScaleOp().Set(Gf.Vec3f(3.0, 3.0, 3.0))
    _bind(conn_m, tip)

    # Charge cable (runs from the charger body up along the arm to the connector)
    _build_cable(stage, f"{root}/cable", rubber)

    return root, sh_rot, el_rot


def _cyl_segment(stage, path, a, b, r, mat):
    """Cylinder (radius r cm) from point a to point b, quaternion-oriented."""
    dx, dy, dz = b[0] - a[0], b[1] - a[1], b[2] - a[2]
    L = math.sqrt(dx * dx + dy * dy + dz * dz)
    if L < 1e-6:
        return
    seg = _define(UsdGeom.Cylinder, stage, path)
    seg.AddTranslateOp().Set(Gf.Vec3d((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2))
    ux, uy, uz = dx / L, dy / L, dz / L
    if abs(uz - 1.0) < 1e-6:
        q = Gf.Quatf(1.0, Gf.Vec3f(0.0, 0.0, 0.0))
    elif abs(uz + 1.0) < 1e-6:
        q = Gf.Quatf(0.0, Gf.Vec3f(0.0, 1.0, 0.0))
    else:
        axis = Gf.Vec3f(-uy, ux, 0.0).GetNormalized()
        angle = math.acos(max(-1.0, min(1.0, uz)))
        q = Gf.Quatf(math.cos(angle / 2.0), axis * math.sin(angle / 2.0))
    seg.AddOrientOp(UsdGeom.XformOp.PrecisionFloat).Set(q)
    seg.AddScaleOp().Set(Gf.Vec3f(r, r, L / 2.0))
    _bind(mat, seg)
    return seg


def _build_cable(stage, path, mat):
    """Cable polyline: from the charger body, arcing up/forward to the connector."""
    pts = [
        (0.0, 0.0, -60.0),
        (3.0, 2.0, -20.0),
        (6.0, 1.0, 0.0),
        (12.0, 0.0, 30.0),
        (16.0, 0.0, 60.0),
    ]
    prev = None
    for i, p in enumerate(pts):
        if prev is not None:
            _cyl_segment(stage, f"{path}/seg_{i}", prev, p, 2.0, mat)
        prev = p


def set_arm_pose(sh_rot, el_rot, phase, direction="inbound"):
    """Rotate shoulder/elbow to match the tether phase. phase may be None (folded)."""
    if phase is None:
        sh_rot.Set(0.0)
        el_rot.Set(0.0)
        return
    progress = PHASE_PROGRESS.get(str(phase).lower(), 0.0)
    sh_rot.Set(SHOULDER_EXT * progress)
    el_rot.Set(ELBOW_EXT * progress)
