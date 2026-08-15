"""Canonical (cm, Z-up, plan-centred) adaptation of Claude's OttoMotion.

Keeps OttoMotion's motion engine — sim clock, leg interpolation, glide
smoothing — and adapts only the GEOMETRY to the shipping stage, exactly as the
isaac/README directs: adapt the module, keep the stage, don't rebuild.

Two adaptations live here:

1. Data source. The ottoq_twin_snapshot RPC needs a required p_sim_run_id and
   returns "sim_run not found" for NULL; the otto-twin-control edge function is
   the working source on this box (116 vehicles). EdgeSnapshotSource.fetch()
   resolves the live run and adapts the payload to OttoMotion's expected shape:
       run.sim_clock         -> run.sim_clock_current
       run.speed_x           -> run.time_scale   (sim seconds per real second;
                               the edge fn's `time_scale` is sim-minutes/tick,
                               a different quantity)
       legs[].kind           -> 'travel' | 'dwell'  (flow_contract = travel)
       fleet[].stall_id      -> fleet[].stall_x/stall_y (feet, via layout)

2. Coordinate frame. The shipping stage is rebuilt from layoutSeed.json:
   FEET, origin at the fence SW corner, y NORTH-positive (same frame as the DB
   and the twin legs). The depot builder centres the lot at the world origin, so
   the canonical mapping is simply:
       cx = (feet_x - LOT_CX_FT) * 30.48
       cy = (feet_y - LOT_CY_FT) * 30.48      # NO y-negation (feet is already N)
   The heading DOES negate dy: the car's forward (+Z) maps to -Y under the
   rotateX(90) up-flip, so the correct rotateZ is atan2(dx, -dy).
"""

from __future__ import annotations

import json
import urllib.request

from otto_motion import OttoMotion

NASHVILLE_DEPOT = "11111111-1111-1111-1111-111111111111"
LIVE_STATUSES = ("running", "paused")
FT = 30.48                       # cm per foot
LOT_CX_FT = 226.06299212598425   # lot_ft.width_ft / 2
LOT_CY_FT = 156.98818897637793   # lot_ft.length_ft / 2


class EdgeSnapshotSource:
    """Fetches the live snapshot from the otto-twin-control edge function and
    adapts it to the payload shape OttoMotion expects."""

    def __init__(self, supabase_url: str):
        self.base = supabase_url.rstrip("/") + "/functions/v1/otto-twin-control"
        self._layout = None  # stall UUID -> (x, y) feet

    def _get(self, path: str):
        req = urllib.request.Request(
            self.base + path, headers={"content-type": "application/json"}
        )
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read().decode())

    def _load_layout(self):
        if self._layout is not None:
            return self._layout
        lay = self._get(f"/depot/{NASHVILLE_DEPOT}/layout")
        stalls = lay.get("data", {}).get("stalls", [])
        self._layout = {
            s["id"]: (float(s["x"]), float(s["y"]))
            for s in stalls if s.get("id") is not None
        }
        return self._layout

    def _active_run_id(self):
        try:
            runs = self._get("/sim_runs?limit=10").get("data", {}).get("runs", [])
            for r in runs:
                if r.get("status") in LIVE_STATUSES:
                    return r["sim_run_id"]
        except Exception:
            return None
        return None

    def fetch(self):
        """Returns the adapted snapshot dict, or None when no run is live."""
        rid = self._active_run_id()
        if not rid:
            return None
        try:
            data = self._get(f"/sim_runs/{rid}/snapshot").get("data", {})
        except Exception:
            return None
        if not data:
            return None

        run = data.get("run") or {}
        if "sim_clock_current" not in run and run.get("sim_clock"):
            run["sim_clock_current"] = run["sim_clock"]
        # sim advance rate = speed_x (sim seconds per real second). The edge
        # function's `time_scale` is sim-minutes-per-tick, which is NOT this.
        if run.get("speed_x") is not None:
            run["time_scale"] = float(run["speed_x"])

        layout = self._load_layout()

        # The edge function publishes only the DESTINATION of each leg
        # (to_stall / to_x / to_y); from_x/from_y are null on ~all legs. The
        # browser reconstructs the travel origin from the prior leg's
        # destination (and the INGRESS gate for the first leg), so do the same
        # here or every travel leg reads as "hold at destination" (no motion).
        INGRESS_FEET = (304.6, 4.7)   # GATE-INGRESS centre (east gate, south edge)
        legs_by_veh: dict = {}
        for leg in data.get("legs", []):
            vid = leg.get("vehicle_id")
            if vid:
                legs_by_veh.setdefault(vid, []).append(leg)

        for vid, veh_legs in legs_by_veh.items():
            veh_legs.sort(key=lambda l: (l.get("seq") or 0))
            prev_to = None
            for leg in veh_legs:
                leg["kind"] = "travel" if leg.get("kind") == "flow_contract" else "dwell"
                # destination: to_stall UUID -> layout feet if to_x missing
                if leg.get("to_x") is None and leg.get("to_stall"):
                    pos = layout.get(leg["to_stall"])
                    if pos:
                        leg["to_x"], leg["to_y"] = pos
                # origin: chain from the previous leg's destination
                if leg.get("from_x") is None:
                    if prev_to is not None:
                        leg["from_x"], leg["from_y"] = prev_to
                    else:
                        leg["from_x"], leg["from_y"] = INGRESS_FEET
                if leg.get("to_x") is not None and leg.get("to_y") is not None:
                    prev_to = (leg["to_x"], leg["to_y"])

        for v in (data.get("fleet", {}).get("vehicles") or []):
            sid = v.get("stall_id")
            if sid and sid in layout:
                v["stall_x"], v["stall_y"] = layout[sid]

        return data


class CanonicalOttoMotion(OttoMotion):
    """OttoMotion adapted to the canonical depot's coordinate frame.

    The stage is rebuilt from layoutSeed.json: FEET, y NORTH-positive (same as
    the DB and the legs), lot centred at the world origin. So:
      - _to_stage: feet -> cm, NO y-negation (feet is already NORTH).
      - _heading_for: atan2(dx, -dy) — the car's forward (+Z) maps to -Y under
        the rotateX(90) up-flip, so the heading negates dy.
    negate_y=False so the base does not double-negate.
    """

    def __init__(self, *args, negate_y=False, **kwargs):
        super().__init__(*args, negate_y=negate_y, **kwargs)

    def _to_stage(self, xy_feet):
        return ((xy_feet[0] - LOT_CX_FT) * FT, (xy_feet[1] - LOT_CY_FT) * FT)

    def _heading_for(self, tgt, sim_now, cur):
        # Travel heading: atan2(dx, -dy) degrees (car forward +Z -> -Y under the
        # up-flip). east=90, north=180, south=0, west=-90.
        import math as _m
        for leg in tgt.legs:
            if leg.covers(sim_now) and leg.kind == "travel" and leg.from_xy and leg.to_xy:
                dx = leg.to_xy[0] - leg.from_xy[0]
                dy = leg.to_xy[1] - leg.from_xy[1]
                if abs(dx) > 1e-6 or abs(dy) > 1e-6:
                    return _m.degrees(_m.atan2(dx, -dy))
        # Parked: face NORTH (all charging lanes are northbound). North = 180 deg.
        return 180.0
