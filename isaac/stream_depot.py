"""
OTTOYARD Isaac Sim streaming server.

Launches Isaac Sim in the WebRTC streaming experience, loads the photoreal
depot scene, advertises the instance's public IP, and serves the stream on
port 49100 (signaling) / 47998 (media) — the exact contract the twin's
OmniverseViewer.tsx (RTX tab) expects.

Usage:  ACCEPT_EULA=1 PUBLIC_IP=<ip> python stream_depot.py [scene.usd]
"""
import os
import sys
import time

os.environ.setdefault("ACCEPT_EULA", "1")

from isaacsim import SimulationApp

PUBLIC_IP = os.environ.get("PUBLIC_IP", "18.232.56.240")
SCENE = sys.argv[1] if len(sys.argv) > 1 else "/home/ubuntu/depot.usd"

# Critical: hide_ui must be False so the viewport is actually rendered and
# streamed (headless streaming still renders offscreen via Vulkan).
_STREAMING_KIT = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "isaacsim-env/lib/python3.12/site-packages/isaacsim/apps/isaacsim.exp.full.streaming.kit",
)
if not os.path.isfile(_STREAMING_KIT):
    # fall back to the venv path
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

# Advertise the public IP for WebRTC signaling
import carb
settings = carb.settings.get_settings()
settings.set("/exts/omni.kit.livestream.app/primaryStream/publicIp", PUBLIC_IP)
print(f"[STREAM] publicIp = {PUBLIC_IP}")

# Load the depot scene
import omni.usd
ctx = omni.usd.get_context()
ctx.open_stage(SCENE)
print(f"[STREAM] loaded {SCENE}")

# Set a nice default camera if none exists
from pxr import UsdGeom, Gf, Usd
stage = ctx.get_stage()
if not stage.GetPrimAtPath("/World/Camera"):
    cam = UsdGeom.Camera.Define(stage, "/World/Camera")
    cam.AddTranslateOp().Set(Gf.Vec3d(68.9, 60, 140))
    cam.AddRotateXYZOp().Set(Gf.Vec3f(40, 0, 0))
    print("[STREAM] added default camera")

# Live vehicle bridge (reads twin snapshot, draws vehicles — never decides)
import sys as _sys
_sys.path.insert(0, os.path.expanduser("~"))
from live_bridge import LiveBridge

_cfg = {}
with open(os.path.expanduser("~/supabase.env")) as f:
    for line in f:
        line = line.strip()
        if "=" in line and not line.startswith("#"):
            k, v = line.split("=", 1)
            _cfg[k] = v

bridge = LiveBridge(
    stage,
    os.path.expanduser("~/depot_layout.json"),
    _cfg["SUPABASE_URL"],
    _cfg["SUPABASE_ANON_KEY"],
)
print("[STREAM] live bridge ready")

# Build robotic charging arms at DCFC/L2 stalls (carried over from the 2D/3D view)
import json as _json
from arm_builder import build_arm

with open(os.path.expanduser("~/depot_layout.json")) as _f:
    _layout = _json.load(_f)
arm_rotators = {}
for _s in _layout.get("stalls", []):
    if _s.get("type") in ("dcfc", "l2"):
        _x = float(_s.get("x", 0) or 0) * 0.3048
        _y = float(_s.get("y", 0) or 0) * 0.3048
        try:
            _root, _sh, _el = build_arm(stage, _s["id"], _x + 1.6, _y, _s["type"])
            arm_rotators[_s["id"]] = (_sh, _el)
        except Exception as e:
            print(f"[ARM] build fail {_s.get('id')}: {e}", flush=True)
bridge.arm_rotators = arm_rotators
print(f"[ARM] built {len(arm_rotators)} arms")

print("[STREAM] serving — keep alive via update loop")
_last_poll = 0.0
try:
    while True:
        app.update()
        now = time.time()
        if now - _last_poll >= 2.0:
            _last_poll = now
            try:
                bridge.step()
            except Exception as e:
                print(f"[BRIDGE] poll error: {e}", flush=True)
        time.sleep(0.01)
except KeyboardInterrupt:
    pass
finally:
    app.close()
