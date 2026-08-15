"""
OTTO-TWIN -> Isaac Sim vehicle motion.

WHY THIS FILE EXISTS
--------------------
The RTX tier went live and nothing moved. The cause is structural, not a bug in
any one line: MOTION IN THIS SYSTEM IS COMPUTED, NOT TRANSMITTED.

ottoq_twin_snapshot() carries, per vehicle, a list of itinerary LEGS -- each with
a start point, an end point and a time window. It does NOT carry "where is car X
right now". The three.js cockpit looks like it receives positions only because
TwinMotionDriver reconstructs them client-side: it interpolates across each leg's
window and extrapolates off the wall clock between polls.

So a bridge that reads the snapshot and sets each prim to its current STALL will
show a depot of perfectly still cars that teleport on poll boundaries. That is
the obvious reading of the payload and it is the reported symptom.

This module is the missing half. It owns a sim clock, interpolates legs, and
moves prims every frame.

CONTRACT
--------
Everything here is derived from the geometry contract the twin publishes at
snapshot.geometry (see migration the_contract_says_how_to_animate_a_vehicle).
Read it at runtime rather than hardcoding -- get_contract() below does, and
falls back to these constants only if the field is absent:

    geometry.motion.formula      t = clamp((sim_now-start)/(end-start), 0, 1)
    geometry.motion.between_polls  advance sim_now by wall_delta * time_scale
    geometry.positioning.leg_coordinate_units   'feet'

UNITS. Leg endpoints (legs[].from_x/from_y/to_x/to_y) are stalls.relative_x/y in
the LAYOUT frame, in FEET -- the same frame unreal/layoutSeed.json uses, which is
the frame the Isaac stage is built in. Multiply by 0.3048. Do NOT apply the
plan-unit factor (0.4785) to these; that factor is for BODY dimensions
(CAR_LENGTH 10.2 pu), not for positions. Mixing the two compresses the depot to
63.7% and makes cars clip their neighbours.

The three.js renderer cannot use these same fields because it applies its own
transform -- which is why ottoTwin.ts warns about them. That warning is scoped to
that consumer; it does not apply here.

STAGE. Hermes measured UsdGeom.GetStageMetersPerUnit() == 1.0 on depot.usd, so
stage units ARE metres and the values below go in unscaled. If that ever becomes
0.01 (Isaac's common centimetre default), set STAGE_METERS_PER_UNIT and every
distance is converted for you.

USAGE
-----
    from otto_motion import OttoMotion

    motion = OttoMotion(
        supabase_url = "https://gxdrcyphqjzjsuhxuqtg.supabase.co",
        anon_key     = "<anon key>",
        stage        = omni.usd.get_context().get_stage(),
        prim_path_for= lambda vid: f"/World/Vehicles/veh_{vid.replace('-','_')}",
    )
    motion.start()                      # background poller

    # then, EVERY FRAME (physics or render callback):
    motion.update(dt_seconds)

If you call update() only once per poll, you get teleporting again. The whole
point is that update() runs at frame rate while the poll runs at its own slow
cadence.
"""

from __future__ import annotations

import json
import math
import threading
import time
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Callable, Dict, List, Optional, Tuple

# ---------------------------------------------------------------- constants --

FEET_TO_M = 0.3048
STAGE_METERS_PER_UNIT = 1.0     # measured on depot.usd; 0.01 if the stage is cm

# Fallbacks ONLY. get_contract() overrides these from the live snapshot.
_FALLBACK_LEG_UNITS = "feet"

# A car that is parked, or whose leg data is missing, is chased toward its target
# at this speed rather than snapped. Snapping is what reads as teleporting.
GLIDE_MPS = 6.0

# Below this, treat the vehicle as arrived and stop nudging it. Prevents jitter.
ARRIVED_EPS_M = 0.05


def _parse_ts(value) -> Optional[float]:
    """RFC3339 / ISO8601 -> epoch seconds. Returns None on anything unparseable."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    s = str(value).strip()
    if not s:
        return None
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.timestamp()


def _clamp01(x: float) -> float:
    return 0.0 if x < 0.0 else (1.0 if x > 1.0 else x)


@dataclass
class Leg:
    kind: str            # 'travel' | 'dwell'
    from_xy: Optional[Tuple[float, float]]
    to_xy: Optional[Tuple[float, float]]
    start_s: Optional[float]
    end_s: Optional[float]
    status: str = ""

    def position_at(self, sim_now: float) -> Optional[Tuple[float, float]]:
        """Interpolated position in LAYOUT FEET, or None if this leg cannot place."""
        if self.to_xy is None:
            return None
        # A dwell leg holds at its destination -- the car is parked, not moving.
        if self.kind != "travel":
            return self.to_xy
        if self.from_xy is None:
            return self.to_xy
        if self.start_s is None or self.end_s is None or self.end_s <= self.start_s:
            # No usable window. Hold at the destination rather than inventing motion.
            return self.to_xy
        t = _clamp01((sim_now - self.start_s) / (self.end_s - self.start_s))
        fx, fy = self.from_xy
        tx, ty = self.to_xy
        return (fx + (tx - fx) * t, fy + (ty - fy) * t)

    def covers(self, sim_now: float) -> bool:
        if self.start_s is None or self.end_s is None:
            return False
        return self.start_s <= sim_now <= self.end_s


@dataclass
class VehicleTarget:
    vehicle_id: str
    legs: List[Leg] = field(default_factory=list)
    fallback_xy: Optional[Tuple[float, float]] = None   # stall position, feet

    def position_at(self, sim_now: float) -> Optional[Tuple[float, float]]:
        # Prefer the leg whose window contains now; that is the authoritative one.
        for leg in self.legs:
            if leg.covers(sim_now):
                p = leg.position_at(sim_now)
                if p is not None:
                    return p
        # Otherwise the most recent leg that has already started -- a car that has
        # overrun its estimate is still at the end of that leg, not nowhere.
        started = [l for l in self.legs if l.start_s is not None and l.start_s <= sim_now]
        if started:
            started.sort(key=lambda l: l.start_s or 0.0)
            p = started[-1].position_at(sim_now)
            if p is not None:
                return p
        return self.fallback_xy


class OttoMotion:
    def __init__(
        self,
        supabase_url: str,
        anon_key: str,
        stage=None,
        prim_path_for: Optional[Callable[[str], str]] = None,
        poll_seconds: float = 2.0,
        sim_run_id: Optional[str] = None,
        on_error: Optional[Callable[[Exception], None]] = None,
    ):
        self.url = supabase_url.rstrip("/")
        self.key = anon_key
        self.stage = stage
        self.prim_path_for = prim_path_for or (
            lambda vid: "/World/Vehicles/veh_" + str(vid).replace("-", "_")
        )
        self.poll_seconds = poll_seconds
        self.sim_run_id = sim_run_id
        self.on_error = on_error

        self._lock = threading.Lock()
        self._targets: Dict[str, VehicleTarget] = {}
        self._sim_now: Optional[float] = None      # epoch seconds, SIM clock
        self._time_scale: float = 1.0
        self._leg_units: str = _FALLBACK_LEG_UNITS
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._current: Dict[str, Tuple[float, float]] = {}   # smoothed, metres
        self.last_error: Optional[str] = None
        self.poll_count = 0

    # ------------------------------------------------------------- polling --

    def _rpc(self, fn: str, payload: dict) -> dict:
        req = urllib.request.Request(
            f"{self.url}/rest/v1/rpc/{fn}",
            data=json.dumps(payload).encode(),
            headers={
                "apikey": self.key,
                "Authorization": f"Bearer {self.key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read().decode())

    def _poll_once(self) -> None:
        snap = self._rpc("ottoq_twin_snapshot", {"p_sim_run_id": self.sim_run_id})
        if isinstance(snap, list):
            snap = snap[0] if snap else {}
        if not isinstance(snap, dict):
            return

        run = snap.get("run") or {}
        sim_clock = _parse_ts(run.get("sim_clock_current"))
        try:
            scale = float(run.get("time_scale") or 1.0)
        except (TypeError, ValueError):
            scale = 1.0

        geom = snap.get("geometry") or {}
        pos = geom.get("positioning") or {}
        leg_units = pos.get("leg_coordinate_units") or _FALLBACK_LEG_UNITS

        # Build targets from legs, keyed by vehicle.
        targets: Dict[str, VehicleTarget] = {}
        for raw in (snap.get("legs") or []):
            vid = raw.get("vehicle_id")
            if not vid:
                continue
            t = targets.setdefault(vid, VehicleTarget(vehicle_id=vid))
            fx, fy = raw.get("from_x"), raw.get("from_y")
            tx, ty = raw.get("to_x"), raw.get("to_y")
            t.legs.append(Leg(
                kind=(raw.get("kind") or "dwell"),
                from_xy=(float(fx), float(fy)) if fx is not None and fy is not None else None,
                to_xy=(float(tx), float(ty)) if tx is not None and ty is not None else None,
                start_s=_parse_ts(raw.get("start_sim")),
                end_s=_parse_ts(raw.get("end_sim")),
                status=raw.get("status") or "",
            ))

        # Fallback: a parked car with no legs still has to be somewhere. Use the
        # stall the fleet block reports, if the payload carries one.
        for v in ((snap.get("fleet") or {}).get("vehicles") or []):
            vid = v.get("id")
            if not vid:
                continue
            t = targets.setdefault(vid, VehicleTarget(vehicle_id=vid))
            sx, sy = v.get("stall_x"), v.get("stall_y")
            if sx is not None and sy is not None:
                t.fallback_xy = (float(sx), float(sy))

        with self._lock:
            self._targets = targets
            self._time_scale = scale
            self._leg_units = leg_units
            # CORRECTION, not assignment: only jump the sim clock if we have never
            # had one, or if it has drifted implausibly. Otherwise let update()
            # keep advancing it, so motion stays smooth across the poll boundary.
            if sim_clock is not None:
                if self._sim_now is None or abs(sim_clock - self._sim_now) > 5.0:
                    self._sim_now = sim_clock
            self.poll_count += 1

    def _loop(self) -> None:
        while not self._stop.is_set():
            try:
                self._poll_once()
                self.last_error = None
            except Exception as e:            # keep polling through transient errors
                self.last_error = str(e)
                if self.on_error:
                    try:
                        self.on_error(e)
                    except Exception:
                        pass
            self._stop.wait(self.poll_seconds)

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()

    # -------------------------------------------------------------- frame ---

    def _to_stage(self, xy_feet: Tuple[float, float]) -> Tuple[float, float]:
        """Layout feet -> stage units."""
        m = FEET_TO_M if self._leg_units == "feet" else 1.0
        s = m / STAGE_METERS_PER_UNIT
        return (xy_feet[0] * s, xy_feet[1] * s)

    def update(self, dt: float) -> Dict[str, Tuple[float, float, float]]:
        """
        Call EVERY FRAME. Advances the sim clock, recomputes interpolated
        positions, eases prims toward them, and writes transforms.

        Returns {vehicle_id: (x, y, heading_degrees)} in stage units, so this is
        testable headlessly with stage=None.
        """
        with self._lock:
            if self._sim_now is None:
                return {}
            # THE POLL IS A CORRECTION CHANNEL, NOT THE CLOCK. Advancing here is
            # what makes motion smooth instead of stepping at the poll rate.
            self._sim_now += dt * self._time_scale
            sim_now = self._sim_now
            targets = dict(self._targets)

        out: Dict[str, Tuple[float, float, float]] = {}
        for vid, tgt in targets.items():
            goal_feet = tgt.position_at(sim_now)
            if goal_feet is None:
                continue
            gx, gy = self._to_stage(goal_feet)

            cur = self._current.get(vid)
            if cur is None:
                # First sight of this vehicle: place it, do not glide it in from
                # the origin -- that is the "pile of cars at the entrance" artifact.
                cx, cy = gx, gy
            else:
                cx, cy = cur
                dx, dy = gx - cx, gy - cy
                dist = math.hypot(dx, dy)
                if dist > ARRIVED_EPS_M:
                    # Interpolation already supplies the motion for a car on a
                    # timed leg; this only smooths CORRECTIONS (a re-plan, a poll
                    # snapping a stale position) so they do not read as a jump.
                    step = (GLIDE_MPS / STAGE_METERS_PER_UNIT) * dt
                    f = 1.0 if step >= dist else (step / dist)
                    cx += dx * f
                    cy += dy * f
                else:
                    cx, cy = gx, gy
            self._current[vid] = (cx, cy)

            heading = self._heading_for(tgt, sim_now, (cx, cy))
            out[vid] = (cx, cy, heading)
            if self.stage is not None:
                self._write_prim(vid, cx, cy, heading)

        # Vehicles that left the payload should not be left frozen on stage.
        for vid in [k for k in self._current if k not in targets]:
            self._current.pop(vid, None)
        return out

    def _heading_for(self, tgt: VehicleTarget, sim_now: float,
                     cur: Tuple[float, float]) -> float:
        """Degrees, matching the layout's heading_degrees convention."""
        for leg in tgt.legs:
            if leg.covers(sim_now) and leg.kind == "travel" \
               and leg.from_xy and leg.to_xy:
                dx = leg.to_xy[0] - leg.from_xy[0]
                dy = leg.to_xy[1] - leg.from_xy[1]
                if abs(dx) > 1e-6 or abs(dy) > 1e-6:
                    return math.degrees(math.atan2(dx, dy))
        return 0.0

    def _write_prim(self, vid: str, x: float, y: float, heading_deg: float) -> None:
        """Set translate + Y rotation on the vehicle's Xform."""
        try:
            from pxr import Gf, UsdGeom
        except ImportError:
            return
        prim = self.stage.GetPrimAtPath(self.prim_path_for(vid))
        if not prim or not prim.IsValid():
            return
        xf = UsdGeom.Xformable(prim)
        ops = {op.GetOpName(): op for op in xf.GetOrderedXformOps()}

        t_op = ops.get("xformOp:translate") or xf.AddTranslateOp()
        # Stage is Y-up (matching the Tesla asset), so ground plane is X/Z and the
        # layout's y maps to stage z. Existing Y stays: it is the wheels-on-ground
        # offset set by the vehicle builder, and this must not fight it.
        cur_y = 0.0
        try:
            cur_y = float(t_op.Get()[1])
        except Exception:
            pass
        t_op.Set(Gf.Vec3d(float(x), cur_y, float(y)))

        r_op = ops.get("xformOp:rotateY") or xf.AddRotateYOp()
        r_op.Set(float(heading_deg))


__all__ = ["OttoMotion", "VehicleTarget", "Leg", "FEET_TO_M", "STAGE_METERS_PER_UNIT"]
