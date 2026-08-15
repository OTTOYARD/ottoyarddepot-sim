"""
OTTOYARD live vehicle bridge for the Isaac Sim photoreal tier.

Polls ottoq_twin_snapshot() over PostgREST and drives realistic vehicle prims
to the live twin state: parked vehicles at their stall, travelling vehicles
interpolated along their itinerary leg. Robotic arms animated from the tether
state. The twin owns discrete truth; this renderer only draws.

Coordinate system: layout (structures + stalls) is FEET, SW-corner origin; USD is
metres (x0.3048). Vehicle positions resolve via stall UUIDs (stall_id / from_stall /
to_stall) -> layout export. Snapshot from_x/from_y/to_x/to_y are BACKEND-FRAME
diagnostics and are never drawn from (ottoTwin.ts:110).
"""

import json
import math
import time
import urllib.request

from pxr import UsdGeom, Gf

FT = 0.3048  # feet -> metres (layout structures + stalls — the ONLY positional unit here)


class LiveBridge:
    def __init__(self, stage, layout_path, supabase_url, anon_key, arm_rotators=None):
        self.stage = stage
        self.supabase_url = supabase_url.rstrip("/")
        self.anon_key = anon_key
        self.vehicles = {}  # vehicle_id -> prim root path
        self.arm_rotators = arm_rotators or {}  # stall_id -> (sh_rot_op, el_rot_op)

        with open(layout_path) as f:
            layout = json.load(f)
        self.stall_pos = {}   # stall_id -> (x_m, y_m)
        self.stall_heading = {}  # stall_id -> heading_deg
        for s in layout.get("stalls", []):
            self.stall_pos[s.get("id")] = (
                float(s.get("x", 0) or 0) * FT,
                float(s.get("y", 0) or 0) * FT,
            )
            self.stall_heading[s.get("id")] = float(s.get("heading", 0) or 0)

        # Gate positions for off-map enter/exit (from_stall/to_stall NULL)
        self.gate_pos = {}
        for s in layout.get("structures", []):
            code = (s.get("code") or "").upper()
            if "GATE" in code:
                gx = (float(s.get("x_ft", 0) or 0) + float(s.get("width_ft", 0) or 0) / 2) * FT
                gy = (float(s.get("y_ft", 0) or 0) + float(s.get("length_ft", 0) or 0) / 2) * FT
                self.gate_pos["ingress" if "INGRESS" in code else "egress"] = (gx, gy)

        self._vehicle_root = None

    # ── Vehicle prims ──────────────────────────────────────────────────────
    def _ensure_vehicle(self, vehicle_id, make, platform, color):
        if vehicle_id in self.vehicles:
            return self.vehicles[vehicle_id]
        from vehicle_builder import build_real_vehicle
        root = build_real_vehicle(self.stage, vehicle_id, 0.0, 0.0, 0.0)
        self.vehicles[vehicle_id] = root
        return root

    def _place(self, vehicle_id, x_m, y_m, heading_deg):
        from vehicle_builder import set_vehicle_pose
        root = self.vehicles.get(vehicle_id)
        if root:
            set_vehicle_pose(self.stage, root, x_m, y_m, heading_deg)

    # ── Supabase fetch ─────────────────────────────────────────────────────
    def fetch_snapshot(self, run_id):
        url = f"{self.supabase_url}/rest/v1/rpc/ottoq_twin_snapshot"
        req = urllib.request.Request(
            url,
            data=json.dumps({"p_sim_run_id": run_id}).encode(),
            headers={
                "apikey": self.anon_key,
                "Authorization": f"Bearer {self.anon_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.loads(r.read().decode())

    def fetch_active_run(self):
        url = f"{self.supabase_url}/rest/v1/ottoq_active_sim_runs?select=sim_run_id&limit=1"
        req = urllib.request.Request(
            url,
            headers={"apikey": self.anon_key, "Authorization": f"Bearer {self.anon_key}"},
        )
        with urllib.request.urlopen(req, timeout=10) as r:
            rows = json.loads(r.read().decode())
            return rows[0]["sim_run_id"] if rows else None

    # ── Main poll ──────────────────────────────────────────────────────────
    def step(self):
        run_id = self.fetch_active_run()
        if not run_id:
            return False

        snap = self.fetch_snapshot(run_id)
        if isinstance(snap, list):
            snap = snap[0] if snap else {}

        # Travel legs by vehicle
        legs_by_vehicle = {}
        for leg in snap.get("legs", []):
            vid = leg.get("vehicle_id")
            if leg.get("kind") == "travel" and leg.get("status") not in ("done", "skipped"):
                legs_by_vehicle[vid] = leg

        fleet = snap.get("fleet", {}).get("vehicles", [])
        seen = set()
        for v in fleet:
            vid = v.get("id") or v.get("av_id")
            if not vid:
                continue
            seen.add(vid)

            make = v.get("make") or ""
            platform = v.get("platform") or ""
            color = v.get("color") or "white"
            self._ensure_vehicle(vid, make, platform, color)

            leg = legs_by_vehicle.get(vid)
            if leg:
                # Resolve positions via stall UUIDs -> layout (feet x0.3048).
                # from_x/from_y/to_x/to_y are BACKEND-FRAME diagnostics only
                # (ottoTwin.ts:110) — never draw from them.
                fs = leg.get("from_stall")
                ts = leg.get("to_stall")
                fx, fy = self.stall_pos.get(fs, self.gate_pos.get("ingress", (0.0, 0.0)))
                tx, ty = self.stall_pos.get(ts, self.gate_pos.get("egress", (0.0, 0.0)))
                try:
                    import datetime
                    s = datetime.datetime.fromisoformat(leg["start_sim"].replace("Z", "+00:00")).timestamp()
                    e = datetime.datetime.fromisoformat(leg["end_sim"].replace("Z", "+00:00")).timestamp()
                    t = 0.0 if e <= s else min(1.0, max(0.0, (time.time() - s) / (e - s)))
                except Exception:
                    t = 0.5
                x = fx + (tx - fx) * t
                y = fy + (ty - fy) * t
                # heading from motion direction (depot x->USD X, depot y->USD Z)
                dx = tx - fx
                dz = ty - fy
                heading = math.degrees(math.atan2(dx, dz)) if (abs(dx) + abs(dz)) > 1e-6 else 0.0
                self._place(vid, x, y, heading)
            else:
                stall_id = v.get("stall_id")
                sx, sy = self.stall_pos.get(stall_id, (0.0, 0.0))
                hd = self.stall_heading.get(stall_id, 0.0)
                self._place(vid, sx, sy, hd)

        # Remove vehicles that left the fleet
        for vid in list(self.vehicles):
            if vid not in seen:
                prim = self.stage.GetPrimAtPath(self.vehicles[vid])
                if prim.IsValid():
                    self.stage.RemovePrim(self.vehicles[vid])
                del self.vehicles[vid]

        # Animate robotic arms
        self._animate_arms(snap.get("stalls_status", []))

        return True

    def _animate_arms(self, stalls_status):
        from arm_builder import set_arm_pose
        tethered = set()
        for s in stalls_status:
            sid = s.get("id")
            if sid in self.arm_rotators and s.get("tethered"):
                sh_rot, el_rot = self.arm_rotators[sid]
                set_arm_pose(sh_rot, el_rot, s.get("tether_phase"), s.get("tether_direction"))
                tethered.add(sid)
        for sid, (sh_rot, el_rot) in self.arm_rotators.items():
            if sid not in tethered:
                set_arm_pose(sh_rot, el_rot, None)
