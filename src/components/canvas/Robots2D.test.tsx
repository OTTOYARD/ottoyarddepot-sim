import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { Doors2D, DOOR_POOL, FastChargerRobots2D, paintChargeArm2D, paintCleanArm2D, paintDoors2D } from './Robots2D';
import { useDepotStore } from '@/store/depotStore';
import { useVehicleStore } from '@/store/vehicleStore';
import { twinMotionDriver } from '@/engine/TwinMotionDriver';
import { doorStore } from '@/engine/motion/doorStore';
import { poseStore } from '@/engine/motion/poseStore';
import { generateStallsV2 } from '@/lib/sitePlan';
import { chargerCabinet, placeArm, portInArmFrame } from '@/lib/ottoChargeArm/depotPlacement';
import { poseFor } from '@/lib/ottoChargeArm/armMotion';
import { STOWED } from '@/lib/ottoChargeArm/cobotIK';
import { portFor } from '@/lib/ottoChargeArm/chargePort';
import { statusColor } from '@/lib/ottoChargeArm/armStateMachine';
import { CAR_WIDTH_M } from '@/lib/ottoChargeArm/vehicleEnvelope';
import { PLAN_UNITS_PER_METRE } from '@/lib/ottoChargeArm/cobotSpec';
import { cleanSessionJoints, cleanStatusColor, IDLE_CLEAN, type CleanSession } from '@/lib/ottoCleanArm/cleanSession';
import { placeCleanArm, chargerParkedHeading } from '@/lib/ottoCleanArm/cleanArmPlacement';
import { DECK_Y } from '@/components/canvas/three/coordUtils';
import { armPlanPoints, cleanArmPlanPoints, doorPlanEdge } from '@/lib/planRobots/robotPlan';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  doorStore.clear();
  poseStore.clear();
});

const stalls = generateStallsV2();
const dcfc = stalls.filter((s) => s.type === 'dcfc');
const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const part = (g: Element, k: string) => g.querySelector(`[data-part="${k}"]`) as SVGElement;
const num = (el: Element, a: string) => Number(el.getAttribute(a));
const pointsOf = (el: Element) => (el.getAttribute('points') ?? '').trim().split(/\s+/).map((p) => p.split(',').map(Number));

function mount() {
  useDepotStore.setState({ stalls });
  return render(<svg><FastChargerRobots2D /></svg>).container;
}

describe('the fast chargers\' robots on the 2D plan', () => {
  it('draws a charge arm and a cleaning arm on every fast charger, and on nothing else', () => {
    const c = mount();
    const ids = dcfc.map((s) => s.id);
    expect(ids.length).toBeGreaterThanOrEqual(10);
    expect([...c.querySelectorAll('[data-charge-arm]')].map((g) => g.getAttribute('data-charge-arm'))).toEqual(ids);
    expect([...c.querySelectorAll('[data-clean-arm]')].map((g) => g.getAttribute('data-clean-arm'))).toEqual(ids);
    // under the pointer: a click on a robot is a click on its stall
    expect(c.querySelector('[aria-label="Fast charger robots"]')?.getAttribute('pointer-events')).toBe('none');
  });

  it('paints the charge arm at the 3D arm\'s joints, from its cradle to the port and home again', () => {
    const c = mount();
    const s = dcfc[0];
    const g = c.querySelector(`[data-charge-arm="${s.id}"]`) as SVGGElement;
    const arm = placeArm(s.id, s.position.x, s.position.y, s.position.angle);
    const k = chargerCabinet('dcfc', s.position.x, s.position.y, s.position.angle);
    const port = portFor('v1', 'tesla');
    const target = { port: portInArmFrame(port.along, port.height, CAR_WIDTH_M / 2, arm.toward), normal: { x: 0, y: 0, z: -1 } };
    for (const [phase, t] of [['stowed', 1], ['approach', 0.5], ['insert', 1], ['charging', 1], ['extract', 0.5], ['retract', 1]] as const) {
      const pose = phase === 'stowed' ? { angles: STOWED, ok: true } : poseFor({ phase, t }, target);
      const pts = armPlanPoints(arm, pose.angles);
      paintChargeArm2D(g, pts, phase, pose.ok, { x: k.x, y: k.y });
      const chain = pointsOf(part(g, 'links'));
      for (const [i, p] of [pts.base, pts.elbow, pts.wrist].entries()) {
        expect(chain[i][0]).toBeCloseTo(p.x, 2);
        expect(chain[i][1]).toBeCloseTo(p.y, 2);
      }
      expect(num(part(g, 'head'), 'cx')).toBeCloseTo(pts.tcp.x, 2);
      expect(num(part(g, 'head'), 'cy')).toBeCloseTo(pts.tcp.y, 2);
      expect(num(part(g, 'led'), 'cx')).toBeCloseTo(pts.base.x, 2);
      expect(part(g, 'led').getAttribute('fill')).toBe(hex(statusColor(phase)));
      // the cable runs from the cabinet to the connector while the arm is out of its cradle
      expect(part(g, 'cable').getAttribute('visibility')).toBe(phase === 'stowed' ? 'hidden' : 'visible');
      expect(g.getAttribute('data-phase')).toBe(phase);
    }
    // latched, the connector is at the car's flank: about half a car width from the stall's centre line
    paintChargeArm2D(g, armPlanPoints(arm, poseFor({ phase: 'charging', t: 1 }, target).angles), 'charging', true, k);
    const head = { x: num(part(g, 'head'), 'cx'), y: num(part(g, 'head'), 'cy') };
    expect(Math.hypot(head.x - s.position.x, head.y - s.position.y)).toBeLessThan(3 * PLAN_UNITS_PER_METRE);
    // a port out of reach is the 3D view's refusal: a red light and no cable
    paintChargeArm2D(g, armPlanPoints(arm, STOWED), 'charging', false, k);
    expect(part(g, 'led').getAttribute('fill')).toBe('#ff2d2d');
    expect(part(g, 'cable').getAttribute('visibility')).toBe('hidden');
  });

  it('paints the cleaning arm at the 3D arm\'s joints, its wand only while it is out', () => {
    const c = mount();
    const s = dcfc[0];
    const g = c.querySelector(`[data-clean-arm="${s.id}"]`) as SVGGElement;
    const { sides } = placeCleanArm(s.position.x, s.position.y, s.position.angle, DECK_Y);
    const at = (phase: CleanSession['phase'], t: number, finishing = false): CleanSession =>
      ({ ...IDLE_CLEAN, phase, t, finishing, vehicleId: 'v1', phaseElapsed: 0 });
    for (const sess of [IDLE_CLEAN, at('swing_a', 0.5), at('enter_a', 1), at('clean_a', 0.4), at('exit_b', 0.2, true), at('doors_close', 0.5)]) {
      const pts = cleanArmPlanPoints(s.position.x, s.position.y, s.position.angle, cleanSessionJoints(sess, sides));
      paintCleanArm2D(g, pts, sess);
      const chain = pointsOf(part(g, 'links'));
      for (const [i, p] of [pts.j1, pts.elbow, pts.mast].entries()) {
        expect(chain[i][0]).toBeCloseTo(p.x, 2);
        expect(chain[i][1]).toBeCloseTo(p.y, 2);
      }
      const out = sess.phase !== 'home';
      expect(part(g, 'wand').getAttribute('visibility')).toBe(out ? 'visible' : 'hidden');
      if (out) expect(num(part(g, 'tip'), 'cx')).toBeCloseTo(pts.tip.x, 2);
      expect(part(g, 'led').getAttribute('stroke')).toBe(hex(cleanStatusColor(sess)));
      expect(num(part(g, 'led'), 'cx')).toBeCloseTo(pts.j1.x, 2);
    }
  });

  it('reaches into the cabin through the door while it cleans, and is over the roof when home', () => {
    for (const s of dcfc) {
      const { sides } = placeCleanArm(s.position.x, s.position.y, s.position.angle, DECK_Y);
      const h = chargerParkedHeading(s.position.angle);
      // across the car, plan units, from its centre line: + to its right
      const across = (p: { x: number; y: number }) => (p.x - s.position.x) * -Math.sin(h) + (p.y - s.position.y) * Math.cos(h);
      const half = (CAR_WIDTH_M / 2) * PLAN_UNITS_PER_METRE;
      const cleaning = { ...IDLE_CLEAN, phase: 'clean_a' as const, t: 0.5, vehicleId: 'v1' };
      const tip = cleanArmPlanPoints(s.position.x, s.position.y, s.position.angle, cleanSessionJoints(cleaning, sides)).tip;
      expect(Math.abs(across(tip)), `${s.id} tip in the cabin`).toBeLessThan(half);
      const home = cleanArmPlanPoints(s.position.x, s.position.y, s.position.angle, cleanSessionJoints(IDLE_CLEAN, sides));
      expect(Math.abs(across(home.mast)), `${s.id} home over the roof`).toBeLessThan(half);
    }
  });

  it('draws what the driver\'s sessions say, frame by frame', async () => {
    const s = dcfc[1];
    useVehicleStore.setState({ vehicles: [{ id: 'v1', oem: 'waymo' } as never] });
    vi.spyOn(twinMotionDriver, 'armSessionAt').mockImplementation((id) =>
      id === s.id ? { phase: 'charging', phaseElapsed: 60, t: 1, vehicleId: 'v1' } : null);
    vi.spyOn(twinMotionDriver, 'cleanSessionAt').mockImplementation((id) =>
      id === s.id ? { ...IDLE_CLEAN, phase: 'clean_b', t: 0.3, vehicleId: 'v1' } : null);
    const c = mount();
    const arm = c.querySelector(`[data-charge-arm="${s.id}"]`)!;
    const clean = c.querySelector(`[data-clean-arm="${s.id}"]`)!;
    await waitFor(() => expect(arm.getAttribute('data-phase')).toBe('charging'));
    await waitFor(() => expect(clean.getAttribute('data-phase')).toBe('clean_b'));
    expect(part(arm, 'led').getAttribute('fill')).toBe(hex(statusColor('charging')));
    expect(part(clean, 'wand').getAttribute('visibility')).toBe('visible');
    // every other stall stays home
    const other = c.querySelector(`[data-charge-arm="${dcfc[0].id}"]`)!;
    await waitFor(() => expect(other.getAttribute('data-phase')).toBe('stowed'));
    expect(c.querySelector(`[data-clean-arm="${dcfc[0].id}"]`)!.getAttribute('data-phase')).toBe('home');
  });
});

describe('the cars\' doors on the 2D plan', () => {
  const slotsOf = (c: Element) => Array.from(c.querySelectorAll<SVGLineElement>('line[data-part="door"]'));

  it('draws each open door from its hinge to its swung edge, at the car\'s live pose', () => {
    const c = render(<svg><Doors2D /></svg>).container;
    const slots = slotsOf(c);
    expect(slots).toHaveLength(DOOR_POOL);
    poseStore.set('v1', 120, 80, 0.6);
    poseStore.set('v2', 60, 40, -2.1);
    doorStore.set('v1', 1, 1);
    doorStore.set('v2', 0.5, 0);      // one door open
    doorStore.set('ghost', 1, 1);     // a car with no pose is not drawn anywhere
    expect(paintDoors2D(slots)).toBe(3);
    const drawn = slots.filter((l) => l.getAttribute('visibility') === 'visible');
    expect(drawn).toHaveLength(3);
    const v1right = doorPlanEdge(120, 80, 0.6, 1, 1);
    const l = drawn.find((x) => x.getAttribute('data-vid') === 'v1')!;
    expect(num(l, 'x1')).toBeCloseTo(v1right.hinge.x, 2);
    expect(num(l, 'y2')).toBeCloseTo(v1right.edge.y, 2);
    expect(drawn.filter((x) => x.getAttribute('data-vid') === 'v2')).toHaveLength(1);
    // all shut: nothing drawn
    doorStore.clear();
    expect(paintDoors2D(slots)).toBe(0);
    expect(slots.every((x) => x.getAttribute('visibility') === 'hidden')).toBe(true);
  });

  it('follows the doors as they open, frame by frame', async () => {
    const c = render(<svg><Doors2D /></svg>).container;
    poseStore.set('v1', 100, 100, 1.2);
    doorStore.set('v1', 0.7, 0.7);
    await waitFor(() => expect(slotsOf(c).filter((x) => x.getAttribute('visibility') === 'visible')).toHaveLength(2));
  });
});
