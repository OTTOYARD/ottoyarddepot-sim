# PARKED_ISAAC — Track B (Isaac Sim / Omniverse / UE photoreal) is parked per otto-q-core/CLAUDE.md 2.8.
# Not imported by the app; kept for future reattachment. Do not extend without unparking Track B.
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

# each slot = (x, y, angle) — angle is the stall's compass facing (0=N,90=E,180=S,270=W)
LANES = {"dcfc": [], "l2": [], "wash": [], "service": [], "staging": []}
for s in PLAN["stalls"]:
    if s["type"] in LANES:
        LANES[s["type"]].append((s["position"]["x"], s["position"]["y"], s["position"].get("angle", 180)))

GATE = (PLAN["ingress"]["x"], 198)
WEST_AISLE = PLAN["lanes"]["westAisleX"]   # one-way entry aisle — used as the arrival queue

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
                    # queue single-file up the west (entry) aisle — never parked in
                    # the gate opening or against the perimeter fence.
                    x = WEST_AISLE
                    y = 196 - gate_n * 6
                    ang = 0  # facing north, into the depot
                    gate_n += 1
                else:
                    slots = LANES[lane]
                    i = cursors[lane]
                    if i >= len(slots):
                        continue
                    cursors[lane] += 1
                    x, y, ang = slots[i]
                placements[v["id"]] = (x, y, color, v["state"], ang)
            with _lock:
                _state["placements"] = placements
                _state["tick"] = snap["run"]["tick_count"]
        except Exception as e:  # keep polling through transient errors
            _state["err"] = str(e)
        threading.Event().wait(POLL_S)

# ------------------------------------------------------------- actor pool ---
CUBE = unreal.load_asset("/Engine/BasicShapes/Cube.Cube")
SEDAN = unreal.load_asset("/Game/Fab/Generic_Sedan_Car/generic_sedan_car/StaticMeshes/generic_sedan_car")
_eas = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
_actors = {}   # veh_id -> [actor, _, [cur_x, cur_y], color]

TARGET_LEN_CM = 480.0   # a ~15.7 ft sedan
_norm = {"scale": 1.0, "yaw": 0.0, "zrest": 1.1 * U, "done": False}

def _w(x, y, z_cm):
    return unreal.Vector((x - 150.0) * U, (y - 110.0) * U, z_cm)

def _calibrate_sedan():
    """Measure the imported glTF mesh ONCE → uniform scale to a real car
    length, base yaw so the car's length runs along the depot's N-S lanes,
    and a rest-on-ground Z. Avoids guessing at glTF units/orientation."""
    if SEDAN is None or _norm["done"]:
        return
    tmp = _eas.spawn_actor_from_object(SEDAN, unreal.Vector(0, 0, 0), unreal.Rotator(0, 0, 0))
    try:
        origin, ext = tmp.get_actor_bounds(False)
        longest = max(ext.x, ext.y)
        _norm["scale"] = TARGET_LEN_CM / (2.0 * longest) if longest > 1 else 1.0
        # if the long (length) axis is X, rotate 90° so it runs along world Y (N-S lanes)
        _norm["yaw"] = 90.0 if ext.x >= ext.y else 0.0
        _norm["zrest"] = (ext.z - origin.z) * _norm["scale"] + 1.0
    finally:
        _eas.destroy_actor(tmp)
    _norm["done"] = True
    unreal.log(f"[OTTOQ bridge] sedan calibrated scale={_norm['scale']:.3f} yaw={_norm['yaw']} z={_norm['zrest']:.1f}")

def _yaw_for(ang):
    """Stall compass angle (0=N,90=E,180=S,270=W) → UE actor yaw, accounting
    for the mesh's calibrated base yaw (length aligned N-S). E/W stalls add 90."""
    extra = 90.0 if (ang % 180) == 90 else 0.0
    return _norm["yaw"] + extra

def _spawn_car(veh_id, x, y, color, yaw):
    mesh = SEDAN or CUBE
    a = _eas.spawn_actor_from_object(mesh, _w(x, y, _norm["zrest"]), unreal.Rotator(0, 0, yaw))
    if mesh is CUBE:
        a.set_actor_scale3d(unreal.Vector(4.7 * U / 100.0, 10.2 * U / 100.0, 2.1 * U / 100.0))
        try:
            mid = a.static_mesh_component.create_dynamic_material_instance(0)
            mid.set_vector_parameter_value("Color", unreal.LinearColor(*color, 1.0))
        except Exception:
            pass
    else:
        s = _norm["scale"]
        a.set_actor_scale3d(unreal.Vector(s, s, s))   # real car keeps its imported paint
    a.set_actor_label(f"OTTOQV_{veh_id[:8]}")
    a.tags = [unreal.Name(TAG)]
    return a, None

def _apply(delta):
    if _state["stop"]:
        return
    with _lock:
        placements = dict(_state["placements"])
    seen = set()
    for vid, (x, y, color, st, ang) in placements.items():
        seen.add(vid)
        yaw = _yaw_for(ang)
        if vid not in _actors:
            a, mid = _spawn_car(vid, x, y, color, yaw)
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
                a.set_actor_location(_w(cur[0], cur[1], _norm["zrest"]), False, False)
                a.set_actor_rotation(unreal.Rotator(0, 0, yaw), False)
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
# Persistent registry stashed on the `unreal` module so that re-exec'ing this
# file in the console (fresh namespace each time) can find and REPLACE the
# prior run's tick callback instead of orphaning it (orphans = duplicate
# _apply callbacks firing forever against mismatched data).
_REG = getattr(unreal, "_OTTOQ_REG", None)
if _REG is None:
    _REG = {"handle": None}
    setattr(unreal, "_OTTOQ_REG", _REG)

def _unregister_prior():
    h = _REG.get("handle")
    if h is not None:
        try:
            unreal.unregister_slate_post_tick_callback(h)
        except Exception:
            pass
        _REG["handle"] = None

def ottoq_bridge_start():
    _unregister_prior()
    # Sweep stale vehicle actors — saved levels / prior runs leave OTTOQV actors.
    swept = 0
    for a in list(_eas.get_all_level_actors()):
        try:
            if unreal.Name(TAG) in list(a.tags):
                _eas.destroy_actor(a)
                swept += 1
        except Exception:
            pass
    if swept:
        unreal.log(f"[OTTOQ bridge] swept {swept} stale vehicle actors")
    _actors.clear()
    _calibrate_sedan()
    _state["stop"] = False
    threading.Thread(target=_poll_loop, daemon=True).start()
    _REG["handle"] = unreal.register_slate_post_tick_callback(_apply)
    unreal.log("[OTTOQ bridge] started — polling twin, vehicles incoming")

def ottoq_bridge_stop():
    _state["stop"] = True
    _unregister_prior()
    for vid in list(_actors):
        try:
            _eas.destroy_actor(_actors[vid][0])
        except Exception:
            pass
        del _actors[vid]
    unreal.log("[OTTOQ bridge] stopped")

ottoq_bridge_start()
