"""Arm animation driven by arm.cycles[] + arm.timings from the RPC.

Per-frame: for each live cycle, lerp the shoulder/elbow angles through the
phase sequence (mate: unstow->approach->align->insert->latch;
demate: unlatch->extract->retract).  Charging holds at the latched pose.
"""
import math
import json
import urllib.request
from datetime import datetime, timezone

from arm_builder_canonical import SHOULDER_EXT, ELBOW_EXT, PHASE_PROGRESS

MATE_ORDER = ["unstow", "approach", "align", "insert", "latch"]
DEMATE_ORDER = ["unlatch", "extract", "retract"]


def fetch_arm_snapshot(supabase_url, anon_key):
    """Resolve the active run, call the RPC, return (cycles, timings).

    Returns ([], {}) when no run is active or the RPC fails.
    """
    try:
        # find active run via the edge function
        req = urllib.request.Request(
            supabase_url + "/functions/v1/otto-twin-control/sim_runs?limit=10",
            headers={"content-type": "application/json"})
        runs = json.load(urllib.request.urlopen(req, timeout=15))
        runs = runs.get("data", {}).get("runs", [])
        run_id = None
        for r in runs:
            if r.get("status") in ("running", "paused"):
                run_id = r["sim_run_id"]
                break
        if not run_id:
            return [], {}

        # call ottoq_twin_snapshot RPC (auth required)
        rpc_req = urllib.request.Request(
            supabase_url + "/rest/v1/rpc/ottoq_twin_snapshot",
            data=json.dumps({"p_sim_run_id": run_id}).encode(),
            headers={"content-type": "application/json",
                     "apikey": anon_key,
                     "authorization": "Bearer " + anon_key,
                     "accept-profile": "ottoq",
                     "prefer": "params=single-object"})
        snap = json.load(urllib.request.urlopen(rpc_req, timeout=15))
        arm = snap.get("arm") or {}
        return arm.get("cycles", []) or [], arm.get("timings", {}) or {}
    except Exception:
        return [], {}


class ArmAnimator:
    """Drives the charging-arm joints from the live RPC cycle data."""

    def __init__(self, arm_rotators, stall_codes):
        # arm_rotators: stall_code -> (ShoulderOp, ElbowOp)
        # stall_codes:  UUID -> stall_code (from the layout)
        self._rotators = arm_rotators
        self._codes = stall_codes
        self._cycles = []
        self._timings = {}

    def set_data(self, cycles, timings):
        self._cycles = cycles
        self._timings = timings

    def update(self, sim_now):
        """Advance every cycle to sim_now (sim-seconds float).

        sim_now is expected to be a Unix-timestamp float (the same clock
        that phase_deadline uses when parsed from ISO 8601).
        """
        if sim_now is None:
            return
        phase_seconds = self._timings.get("phase_seconds", {})
        for c in self._cycles:
            stall_uuid = c.get("stall_id")
            stall_code = self._codes.get(stall_uuid)
            if not stall_code or stall_code not in self._rotators:
                continue

            phase = c.get("phase", "")
            direction = c.get("direction", "mate")
            deadline_iso = c.get("phase_deadline", "")

            dur = phase_seconds.get(phase, 1.0)
            if not deadline_iso or not dur:
                continue

            # parse deadline to sim-seconds
            try:
                deadline = datetime.fromisoformat(
                    deadline_iso.replace("Z", "+00:00")).timestamp()
            except Exception:
                continue

            phase_start = deadline - dur
            t = (sim_now - phase_start) / dur
            t = max(0.0, min(1.0, t))

            # previous phase in the mate/demate order
            order = MATE_ORDER if direction == "mate" else DEMATE_ORDER
            prev_progress = 0.0
            try:
                idx = order.index(phase)
                if idx > 0:
                    prev_progress = PHASE_PROGRESS.get(order[idx - 1], 0.0)
            except ValueError:
                pass

            this_progress = PHASE_PROGRESS.get(phase, 0.0)
            progress = prev_progress + (this_progress - prev_progress) * t

            sh_op, el_op = self._rotators[stall_code]
            sh_op.Set(SHOULDER_EXT * progress)
            el_op.Set(ELBOW_EXT * progress)