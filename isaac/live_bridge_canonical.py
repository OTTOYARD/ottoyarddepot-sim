"""Live vehicle bridge for the CANONICAL depot (cm, Z-up) — edge-function source.

Polls the SAME source as the browser 3D — the `otto-twin-control` edge function —
so the RTX feed mirrors the browser exactly. Run discovery is `GET /sim_runs`
(live = status running/paused), snapshot is `GET /sim_runs/{id}/snapshot`
(unwrapped from `data`), and stall positions come from the depot layout
(UUID -> plan coords -> canonical cm). Legs carry `from_stall`/`to_stall`
stall UUIDs and `start_sim`/`end_sim` sim-timestamps; motion is interpolated
against the snapshot's `sim_clock`, not wall time.
"""

import datetime
import json
import math
import urllib.request

from canonical_vehicle import (
    plan_to_cm, heading_to_canonical, parked_heading_canonical_deg,
    build_tesla, set_tesla_pose,
)

NASHVILLE_DEPOT = "11111111-1111-1111-1111-111111111111"
LIVE_STATUSES = ("running", "paused")
FEET_PER_PLAN_UNIT = 1.569882  # 1 plan unit = 0.4785 m = 1.569882 ft (twin geometry)


class LiveBridgeCanonical:
    def __init__(self, stage, supabase_url, anon_key, arm_rotators=None):
        self.stage = stage
        self.base = supabase_url.rstrip("/") + "/functions/v1/otto-twin-control"
        self.anon_key = anon_key
        self.vehicles = {}          # vehicle_id -> prim root path
        self.arm_rotators = arm_rotators or {}

        self.stall_pos = {}         # stall UUID -> (wx, wy) cm
        self.stall_heading = {}     # stall UUID -> canonical heading deg
        self.stall_type = {}        # stall UUID -> lane type
        self.gate_pos = {"ingress": (0.0, 0.0), "egress": (0.0, 0.0)}
        self._load_layout()

    # ── edge-function transport ─────────────────────────────────────────────
    def _get(self, path):
        req = urllib.request.Request(
            self.base + path, headers={"content-type": "application/json"}
        )
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.loads(r.read().decode())

    def _load_layout(self):
        lay = self._get(f"/depot/{NASHVILLE_DEPOT}/layout")
        stalls = lay.get("data", {}).get("stalls", [])
        for s in stalls:
            sid = s.get("id")
            if not sid:
                continue
            # Layout stall x/y are in FEET; the canonical stage uses plan units
            # (plan_to_cm, U=48cm). 1 plan unit = 1.569882 ft.
            px = float(s.get("x", 0) or 0) / FEET_PER_PLAN_UNIT
            py = float(s.get("y", 0) or 0) / FEET_PER_PLAN_UNIT
            wx, wy = plan_to_cm(px, py)
            self.stall_pos[sid] = (wx, wy)
            lane = s.get("type", "staging")
            self.stall_type[sid] = lane
            self.stall_heading[sid] = parked_heading_canonical_deg(
                lane, s.get("heading", 0) or 0, px, py
            )
        # Gate fallbacks: use the outermost stall bounding box corners.
        if self.stall_pos:
            xs = [p[0] for p in self.stall_pos.values()]
            ys = [p[1] for p in self.stall_pos.values()]
            self.gate_pos["ingress"] = (max(xs) + 2000.0, min(ys) - 2000.0)
            self.gate_pos["egress"] = (min(xs) - 2000.0, min(ys) - 2000.0)

    # ── Supabase fetches ────────────────────────────────────────────────────
    def fetch_active_run(self):
        try:
            runs = self._get("/sim_runs?limit=10").get("data", {}).get("runs", [])
            for r in runs:
                if r.get("status") in LIVE_STATUSES:
                    return r["sim_run_id"]
        except Exception:
            return None
        return None

    def fetch_snapshot(self, run_id):
        snap = self._get(f"/sim_runs/{run_id}/snapshot")
        return snap.get("data", {})

    # ── vehicle prims ───────────────────────────────────────────────────────
    def _ensure_vehicle(self, vehicle_id):
        if vehicle_id in self.vehicles:
            return self.vehicles[vehicle_id]
        root = build_tesla(self.stage, vehicle_id, 0.0, 0.0, 0.0)
        self.vehicles[vehicle_id] = root
        return root

    def _place(self, vehicle_id, wx, wy, heading_canonical_deg):
        root = self.vehicles.get(vehicle_id)
        if root:
            set_tesla_pose(self.stage, root, wx, wy, heading_canonical_deg)

    @staticmethod
    def _iso_ts(s):
        try:
            return datetime.datetime.fromisoformat(
                s.replace("Z", "+00:00")
            ).timestamp()
        except Exception:
            return None

    # ── main poll ──────────────────────────────────────────────────────────
    def step(self):
        run_id = self.fetch_active_run()
        if not run_id:
            if not getattr(self, "_warned_no_run", False):
                print("[BRIDGE] no active run found", flush=True)
                self._warned_no_run = True
            return False
        self._warned_no_run = False
        snap = self.fetch_snapshot(run_id)
        if not snap:
            print("[BRIDGE] snapshot empty", flush=True)
            return False

        sim_clock = self._iso_ts(snap.get("run", {}).get("sim_clock"))
        fleet = snap.get("fleet", {}).get("vehicles", [])
        legs = snap.get("legs", [])

        if not getattr(self, "_logged_first", False):
            print(f"[BRIDGE] run={run_id[:8]} fleet={len(fleet)} legs={len(legs)} "
                  f"stalls={len(self.stall_pos)}", flush=True)
            self._logged_first = True

        # one leg per vehicle (the leg whose window contains sim_clock wins)
        legs_by_vehicle = {}
        for leg in legs:
            vid = leg.get("vehicle_id")
            if not vid:
                continue
            s = self._iso_ts(leg.get("start_sim"))
            e = self._iso_ts(leg.get("end_sim"))
            if sim_clock is not None and s is not None and e is not None:
                if sim_clock < s or sim_clock > e:
                    continue  # not this vehicle's current leg
            legs_by_vehicle[vid] = leg

        seen = set()
        for v in fleet:
            vid = v.get("id") or v.get("av_id")
            if not vid:
                continue
            seen.add(vid)

            leg = legs_by_vehicle.get(vid)
            if leg:
                to_stall = leg.get("to_stall")
                from_stall = leg.get("from_stall")
                if not to_stall:
                    continue  # service/distribution leg in a bay (no stall ref)
                tx, ty = self.stall_pos.get(to_stall, (0.0, 0.0))
                fx, fy = self.stall_pos.get(
                    from_stall, self.gate_pos.get("ingress", (0.0, 0.0))
                )
                s = self._iso_ts(leg.get("start_sim"))
                e = self._iso_ts(leg.get("end_sim"))
                if sim_clock is not None and s is not None and e is not None and e > s:
                    t = min(1.0, max(0.0, (sim_clock - s) / (e - s)))
                else:
                    t = 1.0

                is_travel = leg.get("kind") == "flow_contract" and from_stall
                if is_travel:
                    wx = fx + (tx - fx) * t
                    wy = fy + (ty - fy) * t
                    if t < 1.0 and (abs(tx - fx) + abs(ty - fy)) > 1e-6:
                        hdg = heading_to_canonical(
                            math.atan2(ty - fy, tx - fx)
                        )
                    else:
                        hdg = self.stall_heading.get(to_stall, 0.0)
                else:
                    wx, wy = tx, ty
                    hdg = self.stall_heading.get(to_stall, 0.0)
            else:
                stall_id = v.get("stall_id")
                if not stall_id:
                    continue  # deployed / off-site — not in the depot
                wx, wy = self.stall_pos.get(stall_id, (0.0, 0.0))
                hdg = self.stall_heading.get(stall_id, 0.0)

            self._ensure_vehicle(vid)
            self._place(vid, wx, wy, hdg)

        # remove vehicles no longer in the fleet
        for vid in list(self.vehicles):
            if vid not in seen:
                prim = self.stage.GetPrimAtPath(self.vehicles[vid])
                if prim.IsValid():
                    self.stage.RemovePrim(self.vehicles[vid])
                del self.vehicles[vid]

        if not getattr(self, "_logged_place", False):
            print(f"[BRIDGE] placed {len(self.vehicles)} vehicle prims (fleet={len(fleet)})", flush=True)
            self._logged_place = True
        return True
