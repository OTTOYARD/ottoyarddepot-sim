import { useEffect, useMemo, useRef } from 'react';
import { twinMotionDriver } from '@/engine/TwinMotionDriver';
import { doorStore } from '@/engine/motion/doorStore';
import { poseStore } from '@/engine/motion/poseStore';
import { useDepotStore, type StallState } from '@/store/depotStore';
import { useVehicleStore } from '@/store/vehicleStore';
import { chargerCabinet, placeArm, portInArmFrame, type ArmPlacement } from '@/lib/ottoChargeArm/depotPlacement';
import { poseFor, type ArmTarget } from '@/lib/ottoChargeArm/armMotion';
import { STOWED } from '@/lib/ottoChargeArm/cobotIK';
import { portFor } from '@/lib/ottoChargeArm/chargePort';
import { statusColor, type ArmPhase } from '@/lib/ottoChargeArm/armStateMachine';
import { IDLE_SESSION, isArmHome } from '@/lib/ottoChargeArm/roboticService';
import { CAR_WIDTH_M } from '@/lib/ottoChargeArm/vehicleEnvelope';
import { cleanSessionJoints, cleanStatusColor, IDLE_CLEAN, type CleanSession } from '@/lib/ottoCleanArm/cleanSession';
import { placeCleanArm } from '@/lib/ottoCleanArm/cleanArmPlacement';
import { DECK_Y } from '@/components/canvas/three/coordUtils';
import {
  armPlanPoints, cleanArmPlanPoints, doorPlanEdge,
  type ArmPlanPoints, type CleanArmPlanPoints, type PlanPoint,
} from '@/lib/planRobots/robotPlan';

/**
 * THE FAST CHARGERS' ROBOTS AND THE CARS' DOORS ON THE 2D PLAN.
 *
 * Seen from above, as the 3D view draws them: each fast charger's OTTO-CHARGE ARM reaching from
 * its pedestal to the car's charge port and folding home again, its OTTO-CLEAN ARM swinging out
 * over the roof and in through the open doors, and every car's doors as they open and shut. The
 * app opens on this plan, so until these were drawn the plan showed none of it.
 *
 * NOTHING HERE DECIDES ANYTHING. It reads the sessions the motion driver steps on the sim clock
 * (the depart gate's arm, TwinMotionDriver.armSessionAt; the cleaning arm, cleanSessionAt) and the
 * doors the same sessions open (doorStore), and draws them through the 3D view's own geometry seen
 * from above (lib/planRobots/robotPlan.ts, held equal to the 3D rigs by its tests). So the plan and
 * the 3D view show each robot in the same place doing the same thing.
 *
 * Driven imperatively once a frame, like the cars' dots and the wash machines: a React render a
 * frame for twenty arms would be waste. A stall whose arms have not moved is not repainted. Clicks
 * go through to the stalls and cars.
 */

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const xy = (p: PlanPoint) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`;
const FAULT = '#ff2d2d';
/** The arms' aluminium and its outline (the 3D materials' aluminium and charcoal). */
const ALU = '#d8dade';
const ALU_EDGE = '#3a3f48';

function setLine(el: SVGElement | null, a: PlanPoint, b: PlanPoint): void {
  if (!el) return;
  el.setAttribute('x1', a.x.toFixed(3)); el.setAttribute('y1', a.y.toFixed(3));
  el.setAttribute('x2', b.x.toFixed(3)); el.setAttribute('y2', b.y.toFixed(3));
}
function setDot(el: SVGElement | null, p: PlanPoint): void {
  if (!el) return;
  el.setAttribute('cx', p.x.toFixed(3)); el.setAttribute('cy', p.y.toFixed(3));
}

/**
 * Write one stall's OTTO-CHARGE ARM onto its plan group: the links from the pedestal through the
 * elbow and the wrist to the connector, the status light, and the charge cable from the cabinet
 * while the arm is out of its cradle. `ok` false is the 3D view's refusal (the port is out of the
 * arm's reach): the light goes red and no cable is drawn.
 */
export function paintChargeArm2D(
  g: SVGGElement, pts: ArmPlanPoints, phase: ArmPhase, ok: boolean, cabinet: PlanPoint,
): void {
  const q = (k: string) => g.querySelector<SVGElement>(`[data-part="${k}"]`);
  const chain = `${xy(pts.base)} ${xy(pts.elbow)} ${xy(pts.wrist)}`;
  q('links-edge')?.setAttribute('points', chain);
  q('links')?.setAttribute('points', chain);
  setLine(q('tool'), pts.wrist, pts.tcp);
  setDot(q('elbow'), pts.elbow);
  setDot(q('wrist'), pts.wrist);
  const light = ok ? hex(statusColor(phase)) : FAULT;
  const head = q('head');
  setDot(head, pts.tcp);
  head?.setAttribute('fill', light);
  const led = q('led');
  setDot(led, pts.base);
  led?.setAttribute('fill', light);
  const cable = q('cable');
  const out = ok && !isArmHome(phase);
  cable?.setAttribute('visibility', out ? 'visible' : 'hidden');
  if (out) setLine(cable, cabinet, pts.tcp);
  g.setAttribute('data-phase', phase);
}

/**
 * Write one stall's OTTO-CLEAN ARM onto its plan group: its two links from the canopy mount to
 * the mast, the mast, and, while it is out, the wand from the mast's foot to the nozzle, and the
 * status light.
 */
export function paintCleanArm2D(g: SVGGElement, pts: CleanArmPlanPoints, s: Pick<CleanSession, 'phase' | 'finishing'>): void {
  const q = (k: string) => g.querySelector<SVGElement>(`[data-part="${k}"]`);
  const chain = `${xy(pts.j1)} ${xy(pts.elbow)} ${xy(pts.mast)}`;
  q('links-edge')?.setAttribute('points', chain);
  q('links')?.setAttribute('points', chain);
  setDot(q('mast'), pts.mast);
  const out = s.phase !== 'home';
  for (const k of ['wand', 'nozzle', 'tip']) q(k)?.setAttribute('visibility', out ? 'visible' : 'hidden');
  if (out) {
    setLine(q('wand'), pts.pivot, pts.knuckle);
    setLine(q('nozzle'), pts.knuckle, pts.tip);
    setDot(q('tip'), pts.tip);
  }
  const led = q('led');
  setDot(led, pts.j1);
  led?.setAttribute('stroke', hex(cleanStatusColor(s)));
  g.setAttribute('data-phase', s.phase);
}

/** One fast charger's two robots, placed once; painted by FastChargerRobots2D's frame loop. */
interface StallRobots {
  stall: StallState;
  arm: ArmPlacement;
  cabinet: PlanPoint;
  /** the port the arm last worked to: a retract plays out against the inlet it came out of */
  target: ArmTarget | null;
  targetFor: string | null;
  armKey: string;
  cleanKey: string;
}

/**
 * Every fast charger's OTTO-CHARGE ARM and OTTO-CLEAN ARM (the 3D view's: one of each on every
 * 'dcfc' stall, DepotScene3D.roboticStalls). Charge arms first: they work at the car's flank, the
 * cleaning arm over its roof.
 */
export function FastChargerRobots2D() {
  const stalls = useDepotStore((s) => s.stalls);
  const robotic = useMemo(() => stalls.filter((s) => s.type === 'dcfc'), [stalls]);
  const armRefs = useRef(new Map<string, SVGGElement>());
  const cleanRefs = useRef(new Map<string, SVGGElement>());

  useEffect(() => {
    const robots: StallRobots[] = robotic.map((stall) => {
      const { x, y, angle } = stall.position;
      const k = chargerCabinet('dcfc', x, y, angle);
      return {
        stall, arm: placeArm(stall.id, x, y, angle), cabinet: { x: k.x, y: k.y },
        target: null, targetFor: null, armKey: '', cleanKey: '',
      };
    });
    const sides = new Map(robotic.map((s) => [s.id, placeCleanArm(s.position.x, s.position.y, s.position.angle, DECK_Y).sides]));
    let raf = 0;
    const frame = () => {
      for (const r of robots) {
        const { stall } = r;
        const ag = armRefs.current.get(stall.id);
        if (ag) {
          const s = twinMotionDriver.armSessionAt(stall.id) ?? IDLE_SESSION;
          // the port of the car the arm serves, while it is on the roster; held after (ChargingArm's rule)
          if (s.vehicleId && s.vehicleId !== r.targetFor) {
            const v = useVehicleStore.getState().vehicles.find((x) => x.id === s.vehicleId);
            if (v) {
              const port = portFor(v.id, v.oem);
              r.target = { port: portInArmFrame(port.along, port.height, CAR_WIDTH_M / 2, r.arm.toward), normal: { x: 0, y: 0, z: -1 } };
              r.targetFor = v.id;
            }
          }
          const key = `${s.phase}|${s.t.toFixed(4)}|${r.targetFor ?? ''}`;
          if (key !== r.armKey) {
            r.armKey = key;
            const pose = r.target ? poseFor({ phase: s.phase, t: s.t }, r.target) : { angles: STOWED, ok: true };
            paintChargeArm2D(ag, armPlanPoints(r.arm, pose.angles), s.phase, pose.ok, r.cabinet);
          }
        }
        const cg = cleanRefs.current.get(stall.id);
        const sd = sides.get(stall.id);
        if (cg && sd) {
          const s = twinMotionDriver.cleanSessionAt(stall.id) ?? IDLE_CLEAN;
          const key = `${s.phase}|${s.t.toFixed(4)}|${s.finishing}`;
          if (key !== r.cleanKey) {
            r.cleanKey = key;
            const { x, y, angle } = stall.position;
            paintCleanArm2D(cg, cleanArmPlanPoints(x, y, angle, cleanSessionJoints(s, sd)), s);
          }
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [robotic]);

  return (
    <g aria-label="Fast charger robots" pointerEvents="none">
      {robotic.map((s) => (
        <g key={`arm-${s.id}`} data-charge-arm={s.id}
          ref={(el) => { if (el) armRefs.current.set(s.id, el); else armRefs.current.delete(s.id); }}>
          <line data-part="cable" stroke="#14161a" strokeWidth={0.22} strokeLinecap="round" visibility="hidden" />
          <polyline data-part="links-edge" fill="none" stroke={ALU_EDGE} strokeWidth={0.8} strokeLinecap="round" strokeLinejoin="round" />
          <polyline data-part="links" fill="none" stroke={ALU} strokeWidth={0.52} strokeLinecap="round" strokeLinejoin="round" />
          <line data-part="tool" stroke="#9aa0a8" strokeWidth={0.34} strokeLinecap="round" />
          <circle data-part="elbow" r={0.3} fill="#9aa0a8" />
          <circle data-part="wrist" r={0.24} fill="#9aa0a8" />
          <circle data-part="head" r={0.34} fill={hex(statusColor('stowed'))} stroke={ALU_EDGE} strokeWidth={0.08} />
          <circle data-part="led" r={0.5} fill={hex(statusColor('stowed'))} stroke={ALU_EDGE} strokeWidth={0.1} />
        </g>
      ))}
      {robotic.map((s) => (
        <g key={`clean-${s.id}`} data-clean-arm={s.id}
          ref={(el) => { if (el) cleanRefs.current.set(s.id, el); else cleanRefs.current.delete(s.id); }}>
          <polyline data-part="links-edge" fill="none" stroke={ALU_EDGE} strokeWidth={0.6} strokeLinecap="round" strokeLinejoin="round" />
          <polyline data-part="links" fill="none" stroke={ALU} strokeWidth={0.38} strokeLinecap="round" strokeLinejoin="round" />
          <circle data-part="mast" r={0.26} fill="#9aa0a8" stroke={ALU_EDGE} strokeWidth={0.08} />
          <line data-part="wand" stroke="#c4cad3" strokeWidth={0.2} strokeLinecap="round" visibility="hidden" />
          <line data-part="nozzle" stroke="#9aa0a8" strokeWidth={0.2} strokeLinecap="round" visibility="hidden" />
          <circle data-part="tip" r={0.22} fill="#ffb020" visibility="hidden" />
          {/* a ring, not a disc: J1 stands over the roof's centre, where the car shows its charging bolt */}
          <circle data-part="led" r={0.42} fill="none" stroke={hex(cleanStatusColor(IDLE_CLEAN))} strokeWidth={0.16} />
        </g>
      ))}
    </g>
  );
}

/** How many cars' doors the plan can show open at once: every fast charger and every bay, twice over. */
export const DOOR_POOL = 48;

/**
 * Write the open doors onto the pool: each car with a door open (doorStore), at the car's live
 * pose (poseStore), both flanks, from the hinge to the swung rear edge. Unused slots are hidden.
 * Returns how many doors were drawn.
 */
export function paintDoors2D(slots: readonly SVGLineElement[]): number {
  let n = 0;
  doorStore.forEach((id, d) => {
    const pose = poseStore.get(id);
    if (!pose) return;
    for (const [side, f] of [[1, d.right], [-1, d.left]] as const) {
      if (!(f > 0) || n >= slots.length) continue;
      const { hinge, edge } = doorPlanEdge(pose.x, pose.y, pose.heading, side, f);
      const el = slots[n++];
      setLine(el, hinge, edge);
      el.setAttribute('visibility', 'visible');
      el.setAttribute('data-vid', id);
    }
  });
  for (let i = n; i < slots.length; i++) {
    if (slots[i].getAttribute('visibility') !== 'hidden') slots[i].setAttribute('visibility', 'hidden');
  }
  return n;
}

/** The cars' open doors: under the robots that reach through them, over the cars they hang off. */
export function Doors2D() {
  const ref = useRef<SVGGElement | null>(null);
  useEffect(() => {
    let raf = 0;
    const frame = () => {
      const g = ref.current;
      if (g) paintDoors2D(Array.from(g.querySelectorAll<SVGLineElement>('line[data-part="door"]')));
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <g ref={ref} aria-label="Car doors" pointerEvents="none">
      {Array.from({ length: DOOR_POOL }, (_, i) => (
        <line key={i} data-part="door" stroke="#e8edf3" strokeWidth={0.42} strokeLinecap="round" visibility="hidden" />
      ))}
    </g>
  );
}
