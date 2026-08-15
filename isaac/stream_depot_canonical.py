"""OTTOYARD Isaac Sim streaming server — CANONICAL depot (cm, Z-up).

Loads the canonical ottoyard_depot.usda, tunes the dusk lighting, drives
photoreal Teslas via Claude's OttoMotion (isaac/otto_motion.py + the canonical
adaptation otto_motion_canonical.py), and streams on 49100 (signaling) /
47998 (media) — the OmniverseViewer.tsx contract.

Motion is computed by OttoMotion (sim clock + leg interpolation + glide), not
snapped by this script. This script only: loads the stage, frames the camera,
builds the 40 charging arms once, creates a Tesla prim the first time a vehicle
is seen, and calls motion.update() every frame.
"""
import os
import sys
import time

os.environ.setdefault("ACCEPT_EULA", "1")

from isaacsim import SimulationApp

PUBLIC_IP = os.environ.get("PUBLIC_IP", "18.232.56.240")
SCENE = sys.argv[1] if len(sys.argv) > 1 else "/home/ubuntu/ottoyard_depot.usda"

_STREAMING_KIT = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "isaacsim-env/lib/python3.12/site-packages/isaacsim/apps/isaacsim.exp.full.streaming.kit",
)
if not os.path.isfile(_STREAMING_KIT):
    import glob
    _STREAMING_KIT = glob.glob(
        os.path.expanduser("~/isaacsim-env/lib/python*/site-packages/isaacsim/apps/isaacsim.exp.full.streaming.kit")
    )[0]

app = SimulationApp(
    {
        "headless": True,
        "hide_ui": False,
        "width": 1920,
        "height": 1080,
        "anti_aliasing": "FXAA",
    },
    experience=_STREAMING_KIT,
)

import carb
settings = carb.settings.get_settings()
settings.set("/exts/omni.kit.livestream.app/primaryStream/publicIp", PUBLIC_IP)
settings.set("/app/window/hideUi", True)
# Lock the WebRTC streaming port (must match the nginx proxy_pass target)
settings.set("/exts/omni.kit.livestream.core/serverPort", 8011)
print(f"[STREAM] publicIp = {PUBLIC_IP} (UI hidden, livestream :8011)")

import omni.usd
from pxr import Usd, UsdGeom, Gf

ctx = omni.usd.get_context()
ctx.open_stage(SCENE)
stage = ctx.get_stage()
print(f"[STREAM] loaded {SCENE}")

# Tune the canonical dusk lighting up (the builder's own note flags this).
for prim in Usd.PrimRange(stage.GetPseudoRoot()):
    t = prim.GetTypeName()
    if t == "DistantLight":
        prim.GetAttribute("inputs:intensity").Set(4000.0)
        prim.GetAttribute("inputs:exposure").Set(0.0)
    elif t == "DomeLight":
        prim.GetAttribute("inputs:intensity").Set(3000.0)
        prim.GetAttribute("inputs:exposure").Set(0.0)
print("[STREAM] lighting tuned (exposure 0)")

# DISABLE path tracing — use shaded/raster for instant first frame
settings.set("/rtx/rendermode", "shaded")
print("[STREAM] renderer: shaded")

sys.path.insert(0, os.path.expanduser("~"))
from otto_motion_canonical import EdgeSnapshotSource, CanonicalOttoMotion
from canonical_vehicle import build_tesla, feet_to_cm

_cfg = {}
with open(os.path.expanduser("~/supabase.env")) as f:
    for line in f:
        line = line.strip()
        if "=" in line and not line.startswith("#"):
            k, v = line.split("=", 1)
            _cfg[k] = v

source = EdgeSnapshotSource(_cfg["SUPABASE_URL"])
motion = CanonicalOttoMotion(
    supabase_url=_cfg["SUPABASE_URL"],
    anon_key=_cfg["SUPABASE_ANON_KEY"],
    stage=stage,
    fetch_snapshot=source.fetch,
)
print("[STREAM] OttoMotion ready (edge-function source)")

# Frame the default camera on the depot bounding box (layout feet -> canonical cm).
import math as _m
_layout = source._load_layout()
_xs, _ys = [], []
for _fx, _fy in _layout.values():
    _wx, _wy = feet_to_cm(_fx, _fy)
    _xs.append(_wx); _ys.append(_wy)
if _xs and _ys:
    _cx = (min(_xs) + max(_xs)) / 2.0
    _cy = (min(_ys) + max(_ys)) / 2.0
    _span = max(max(_xs) - min(_xs), max(_ys) - min(_ys)) or 1.0
    _eye = Gf.Vec3d(_cx, _cy - _span * 1.1, _span * 0.7)
    _tgt = Gf.Vec3d(_cx, _cy, 0.0)
    _up = Gf.Vec3d(0, 0, 1)
    cam = UsdGeom.Camera.Define(stage, "/World/Camera")
    cam.AddTransformOp().Set(Gf.Matrix4d().SetLookAt(_eye, _tgt, _up))
    print(f"[STREAM] camera framed: span={_span:.0f}cm")

# Build robotic charging arms at every DCFC/L2 charger, keyed by stall_code
# (arm.cycles[].stall_id -> stalls.stall_code -> this). Positions from
# layoutSeed.json feet, same frame as the vehicles.
import json as _json
from arm_builder_canonical import build_arm

with open(os.path.expanduser("~/layoutSeed.json")) as _f:
    _seed = _json.load(_f)

arm_rotators = {}
_n_arms = 0
for _s in _seed.get("stalls", []):
    if _s.get("stall_type") not in ("dcfc", "l2"):
        continue
    _sx = float(_s["relative_x"]); _sy = float(_s["relative_y"])
    _side = _s.get("canopy_side", "W")
    _px = _sx + (-1.0 if _side == "W" else 1.0) * 4.5   # charger is on the canopy side
    _toward = 1.0 if _side == "W" else -1.0             # arm swings toward the vehicle
    _wx, _wy = feet_to_cm(_px, _sy)
    try:
        _root, _sh, _el = build_arm(stage, _s["stall_code"], _s["stall_type"], _wx, _wy, _toward)
        arm_rotators[_s["stall_code"]] = (_sh, _el)
        _n_arms += 1
    except Exception as e:
        print(f"[ARM] build fail {_s.get('stall_code')}: {e}", flush=True)
print(f"[ARM] built {_n_arms} arms (keyed by stall_code)")

# Wire up the arm animator: stall_codes (UUID->code) from the layout
_stall_codes = source.get_stall_codes()
from arm_animator_canonical import ArmAnimator, fetch_arm_snapshot
arm_anim = ArmAnimator(arm_rotators, _stall_codes)

# Background thread: poll the RPC for arm cycles every 2 s
import threading as _th
_arm_running = True
def _arm_poller():
    while _arm_running:
        try:
            cycles, timings = fetch_arm_snapshot(
                _cfg["SUPABASE_URL"], _cfg["SUPABASE_ANON_KEY"])
            arm_anim.set_data(cycles, timings)
        except Exception as e:
            print(f"[ARM] poll error: {e}", flush=True)
        time.sleep(2)
_th.Thread(target=_arm_poller, daemon=True).start()

motion.start()
print("[STREAM] serving — OttoMotion driving vehicles every frame")

_last_t = time.time()
_last_log = 0.0
try:
    while True:
        app.update()
        now = time.time()
        dt = now - _last_t
        _last_t = now

        # Create a Tesla prim the first time a vehicle is seen. OttoMotion only
        # WRITES transforms to existing prims; it never creates them.
        for _vid in list(motion._targets.keys()):
            _path = motion.prim_path_for(_vid)
            if not stage.GetPrimAtPath(_path):
                build_tesla(stage, _vid, 0.0, 0.0, 0.0)

        motion.update(dt)
        arm_anim.update(motion._sim_now)

        if now - _last_log >= 5.0:
            _last_log = now
            print(f"[MOTION] poll={motion.poll_count} targets={len(motion._targets)} "
                  f"placed={len(motion._current)} err={motion.last_error!r}", flush=True)

        time.sleep(0.01)
except KeyboardInterrupt:
    pass
finally:
    motion.stop()
    app.close()
