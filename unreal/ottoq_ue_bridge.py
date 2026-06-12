"""
OTTOYARD — live OTTO-TWIN → Unreal bridge.

Polls the server-authoritative twin snapshot (same feed the cockpit uses)
and drives vehicle actors inside the UE depot: spawn, glide, recolor by
state, despawn. Optionally ticks the sim itself so the demo is
self-contained.

USAGE (after ottoq_ue_build.py has built the depot):
  exec(open("/Users/chaseballenger/Desktop/ottoyarddepot-sim/unreal/ottoq_ue_bridge.py").read())
  # ... vehicles appear and move. To stop:
  ottoq_bridge_stop()

Coordinate contract: logical (x, y) → UE (x-150)*48, (y-110)*48 — identical
to the cockpit's toWorld().
"""

import json
import os
import threading
import urllib.request
import unreal

# ---------------------------------------------------------------- config ----
BASE = "https://gxdrcyphqjzjsuhxuqtg.supabase.co/functions/v1/otto-twin-control"
POLL_S = 2.0          # snapshot cadence
AUTO_TICK = True      # advance the sim ourselves (demo self-contained)
SPEED_U = 14.0        # glide speed, logical units / second
U = 48.0
TAG = "OTTOQV"

try:
    _HERE = os.path.dirname(os.path.abspath(__file__))
except NameError:
    _HERE = os.path.expanduser("~/Desktop/ottoyarddepot-sim/unreal")

# ------------------------------------------------------------- site plan ----
with open(os.path.join(_HERE, "sitePlan.json")) as f:
    PLAN = json.load(f)

LANES = {"dcfc": [], "l2": [], "wash": [], "service": [], "staging": []}
for s in PLAN["stalls"]:
    if s["type"] in LANES:
        LANES[s["type"]].append((s["position"]["x"], s["position"]["y"]))

GATE = (PLAN["ingress"]["x"], 198)

STATE_MAP = {
    "charging_dcfc": ("dcfc", (0.05, 0.85, 0.35)),
    "charging_l2": ("l2", (0.05, 0.75, 0.55)),
    "in_wash_bay": ("wash", (0.15, 0.45, 0.95)),
    "in_detail_bay": ("wash", (0.2, 0.55, 0.95)),
    "in_service_bay": ("service", (0.95, 0.6, 0.05)),
    "charge_complete_holding": ("staging", (0.0, 0.7, 0.65)),
    "service_complete_holding": ("staging", (0.0, 0.7, 0.65)),
    "staged_awaiting_service": ("staging", (0.75, 0.75, 0.78)),
    "staged_for_departure": ("staging", (0.9, 0.9, 0.92)),
    "arrived_at_gate": ("gate", (1.0, 1.0, 1.0)),
}

# ------------------------------------------------------------------ http ----
def _get(path):
    req = urllib.request.Request(BASE + path, headers={"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=8) as r:
        j = json.loads(r.read().decode())
    if not j.get("ok"):
        raise RuntimeError(j.get("error", "request failed"))
    return j["data"]

def _post(path, body=None):
    data = json.dumps(body or {}).encode()
    req = urllib.request.Request(BASE + path, data=data, method="POST",
                                 headers={"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode())

def _find_run():
    runs = _get("/sim_runs?limit=10")["runs"]
    for r in runs:
        if r["status"] == "running":
            return r["sim_run_id"]
    return None

# ------------------------------------------------------------ shared state --
_state = {"placements": {}, "run_id": None, "stop": False, "tick": 0, "err": ""}
_lock = threading.Lock()

def _poll_loop():
    while not _state["stop"]:
        try:
            rid = _state["run_id"]
            if not rid:
                rid = _find_run()
                if not rid:
                    rid = _post("/scenarios/start", {"scenario_code": "normal_day"})["data"]["sim_run_id"]
                _state["run_id"] = rid
            if AUTO_TICK:
                try:
                    _post(f"/sim_runs/{rid}/tick")
                except Exception:
                    pass
            snap = _get(f"/sim_runs/{rid}/snapshot")
            cursors = {k: 0 for k in LANES}
            gate_n = 0
            placements = {}
            for v in snap["fleet"]["vehicles"]:
                m = STATE_MAP.get(v["state"])
                if not m:
                    continue
                lane, color = m
                if lane == "gate":
                    x = GATE[0] - 14 + (gate_n % 5) * 7
                    y = GATE[1] + (gate_n // 5) * 8
                    gate_n += 1
                else:
                    slots = LANES[lane]
                    i = cursors[lane]
                    if i >= len(slots):
                        continue
                    cursors[lane] += 1
                    x, y = slots[i]
                placements[v["id"]] = (x, y, color, v["state"])
            with _lock:
                _state["placements"] = placements
                _state["tick"] = snap["run"]["tick_count"]
        except Exception as e:  # keep polling through transient errors
            _state["err"] = str(e)
        threading.Event().wait(POLL_S)

# ------------------------------------------------------------- actor pool ---
CUBE = unreal.load_asset("/Engine/BasicShapes/Cube.Cube")
_eas = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
_actors = {}   # veh_id -> (actor, mid, [cur_x, cur_y], color)

def _spawn_car(veh_id, x, y, color):
    a = _eas.spawn_actor_from_object(CUBE, _w(x, y, 1.1 * U), unreal.Rotator(0, 0, 0))
    a.set_actor_scale3d(unreal.Vector(4.7 * U / 100.0, 10.2 * U / 100.0, 2.1 * U / 100.0))
    a.set_actor_label(f"OTTOQV_{veh_id[:8]}")
    a.tags = [unreal.Name(TAG)]
    mid = None
    try:
        mid = a.static_mesh_component.create_dynamic_material_instance(0)
        mid.set_vector_parameter_value("Color", unreal.LinearColor(*color, 1.0))
    except Exception:
        pass
    return a, mid

def _w(x, y, z_cm):
    return unreal.Vector((x - 150.0) * U, (y - 110.0) * U, z_cm)

def _apply(delta):
    if _state["stop"]:
        return
    with _lock:
        placements = dict(_state["placements"])
    seen = set()
    for vid, (x, y, color, st) in placements.items():
        seen.add(vid)
        if vid not in _actors:
            a, mid = _spawn_car(vid, x, y, color)
            _actors[vid] = [a, mid, [x, y], color]
            continue
        rec = _actors[vid]
        a, mid, cur, old_color = rec
        # glide toward target
        dx, dy = x - cur[0], y - cur[1]
        dist = (dx * dx + dy * dy) ** 0.5
        step = SPEED_U * delta
        if dist > 0.05:
            t = min(1.0, step / dist)
            cur[0] += dx * t
            cur[1] += dy * t
            try:
                a.set_actor_location(_w(cur[0], cur[1], 1.1 * U), False, False)
            except Exception:
                pass
        if mid and color != old_color:
            try:
                mid.set_vector_parameter_value("Color", unreal.LinearColor(*color, 1.0))
                rec[3] = color
            except Exception:
                pass
    # despawn vehicles that left the visible set
    for vid in [k for k in _actors if k not in seen]:
        try:
            _eas.destroy_actor(_actors[vid][0])
        except Exception:
            pass
        del _actors[vid]

# ----------------------------------------------------------------- control --
_handle = None
_thread = None

def ottoq_bridge_start():
    global _handle, _thread
    _state["stop"] = False
    _thread = threading.Thread(target=_poll_loop, daemon=True)
    _thread.start()
    _handle = unreal.register_slate_post_tick_callback(_apply)
    unreal.log("[OTTOQ bridge] started — polling twin, vehicles incoming")

def ottoq_bridge_stop():
    global _handle
    _state["stop"] = True
    if _handle:
        unreal.unregister_slate_post_tick_callback(_handle)
        _handle = None
    for vid in list(_actors):
        try:
            _eas.destroy_actor(_actors[vid][0])
        except Exception:
            pass
        del _actors[vid]
    unreal.log("[OTTOQ bridge] stopped")

ottoq_bridge_start()
