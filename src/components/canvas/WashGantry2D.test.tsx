import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { WASH_SHELL } from '@/lib/structurePlan';
import { BAY_STALL_Y } from '@/lib/sitePlan';
import { advanceWashSession, IDLE_WASH, type WashSession } from '@/lib/ottoWash/washSession';
import { washPoseAt, type WashPose } from '@/lib/ottoWash/washPose';
import { WASH_GANTRY as G, WASH_HOME_DY } from '@/lib/ottoWash/washSpec';
import { paintWashGantry2D, SPRAY_FILL, STATUS_FILL, WashGantries2D } from './WashGantry2D';

/** The poses of one whole program, a frame at a time, kept every `keep` sim seconds. */
function program(interior: boolean, seat: number, keep = 1): { s: WashSession; p: WashPose }[] {
  const out: { s: WashSession; p: WashPose }[] = [];
  let s = IDLE_WASH;
  let next = 0;
  for (let t = 0; t < seat + 30; t += 0.1) {
    const on = t < seat;
    s = advanceWashSession(s, { dt: 0.1, vehicleId: 'car', active: on, interior, endsInS: on ? seat - t : null });
    if (t >= next) { out.push({ s, p: washPoseAt(s) }); next = t + keep; }
  }
  return out;
}

function mount(count = 3) {
  const { container } = render(<svg><WashGantries2D count={count} /></svg>);
  return container;
}
const part = (g: Element, k: string) => g.querySelector(`[data-part="${k}"]`) as SVGElement;
const num = (el: Element, a: string) => Number(el.getAttribute(a));
/** The gantry's offset along the bay, from its group's transform. */
const gantryDy = (g: Element) => Number(/translate\(0 (-?[\d.]+)\)/.exec(part(g, 'gantry').getAttribute('transform') ?? '')?.[1]);

describe('the wash machines on the 2D plan', () => {
  it('draws one machine per wash bay, never more than the hall holds', () => {
    expect(mount(3).querySelectorAll('[data-wash-gantry]')).toHaveLength(3);
    expect(mount(0).querySelectorAll('[data-wash-gantry]')).toHaveLength(0);
    expect(mount(9).querySelectorAll('[data-wash-gantry]')).toHaveLength(WASH_SHELL.bays.length);
    const ids = [...mount(3).querySelectorAll('[data-wash-gantry]')].map((g) => g.getAttribute('data-wash-gantry'));
    expect(ids).toEqual(WASH_SHELL.bays.slice(0, 3).map((b) => b.id));
  });

  it('starts each machine at home, retracted, with the stop light green', () => {
    const g = mount().querySelector('[data-wash-gantry]')!;
    const bay = WASH_SHELL.bays[0];
    expect(gantryDy(g)).toBeCloseTo(WASH_HOME_DY, 6);
    expect(num(part(g, 'arm-w-pad'), 'cx')).toBeCloseTo(bay.x - (G.wipe.parkX - G.wipe.forearm), 6);
    expect(num(part(g, 'arm-e-pad'), 'cx')).toBeCloseTo(bay.x + (G.wipe.parkX - G.wipe.forearm), 6);
    expect(part(g, 'beacon').getAttribute('fill')).toBe(STATUS_FILL.home);
    expect(part(g, 'stop').getAttribute('fill')).toBe('#35d07f');
    expect(part(g, 'spray').getAttribute('visibility')).toBe('hidden');
    expect(part(g, 'air').getAttribute('visibility')).toBe('hidden');
    expect(g.querySelector('[data-part^="brush"]')).toBeNull();
    // and painting the idle pose changes nothing
    paintWashGantry2D(g as SVGGElement, bay.x, washPoseAt(IDLE_WASH));
    expect(gantryDy(g)).toBeCloseTo(WASH_HOME_DY, 3);
    expect(num(part(g, 'arm-w-pad'), 'cx')).toBeCloseTo(bay.x - (G.wipe.parkX - G.wipe.forearm), 3);
  });

  it('draws exactly the pose the 3D view draws, through a whole detail program', () => {
    const g = mount().querySelector('[data-wash-gantry]')! as SVGGElement;
    const bay = WASH_SHELL.bays[0];
    const seen = new Set<string>();
    for (const { s, p } of program(true, 990)) {
      paintWashGantry2D(g, bay.x, p);
      seen.add(s.phase);
      expect(gantryDy(g)).toBeCloseTo(p.dy, 2);
      expect(num(part(g, 'arm-w-pad'), 'cx')).toBeCloseTo(bay.x - p.padX, 2);
      expect(num(part(g, 'arm-e-pad'), 'cx')).toBeCloseTo(bay.x + p.padX, 2);
      expect(g.getAttribute('data-station')).toBe(p.station ?? '');
      expect(part(g, 'spray').getAttribute('visibility')).toBe(p.spray === 'none' ? 'hidden' : 'visible');
      if (p.spray !== 'none') expect(part(g, 'spray').getAttribute('fill')).toBe(SPRAY_FILL[p.spray]);
      expect(part(g, 'air').getAttribute('visibility')).toBe(p.air ? 'visible' : 'hidden');
      expect(part(g, 'stop').getAttribute('fill')).toBe(p.stop ? '#ff3b30' : '#35d07f');
      expect(part(g, 'beacon').getAttribute('fill')).toBe(STATUS_FILL[p.status]);
    }
    // every phase of the program was drawn: the cabin hold, all six passes and the four places the arms wipe
    for (const ph of ['cabin_hold', 'soak', 'wash_1', 'wash_2', 'rinse', 'dry_1', 'dry_2', 'wipe_front', 'wipe_sides', 'wipe_roof', 'wipe_rear']) expect(seen).toContain(ph);
  });

  it('shows the machine passing over the car: from north of its nose to south of its tail', () => {
    const g = mount().querySelector('[data-wash-gantry]')! as SVGGElement;
    const dys = program(false, 300).map(({ p }) => { paintWashGantry2D(g, WASH_SHELL.bays[0].x, p); return gantryDy(g); });
    expect(Math.min(...dys)).toBeLessThan(-7);
    expect(Math.max(...dys)).toBeGreaterThan(7);
    // and the car stands at the bay's stall line, under the rails' span
    expect(BAY_STALL_Y + G.rail.from).toBeLessThan(BAY_STALL_Y + Math.min(...dys));
    expect(BAY_STALL_Y + G.rail.to).toBeGreaterThan(BAY_STALL_Y + Math.max(...dys));
  });

  it('sprays water jets while it washes, blows while it dries, and puts the pads on the car while it wipes', () => {
    const g = mount().querySelector('[data-wash-gantry]')! as SVGGElement;
    const bay = WASH_SHELL.bays[0];
    const all = program(false, 300);
    const washing = all.find(({ s, p }) => s.phase === 'wash_1' && p.spray === 'jet')!;
    paintWashGantry2D(g, bay.x, washing.p);
    expect(part(g, 'spray').getAttribute('fill')).toBe(SPRAY_FILL.jet);
    const drying = all.find(({ s, p }) => s.phase === 'dry_1' && p.air)!;
    paintWashGantry2D(g, bay.x, drying.p);
    expect(part(g, 'air').getAttribute('visibility')).toBe('visible');
    const wiping = all.find(({ s, p }) => s.phase === 'wipe_roof' && p.wipeEngage === 1)!;
    paintWashGantry2D(g, bay.x, wiping.p);
    // on the roof pod: well inside the car's flank, and green while pressed
    expect(num(part(g, 'arm-e-pad'), 'cx') - bay.x).toBeLessThan(1);
    expect(part(g, 'arm-e-pad').getAttribute('fill')).toBe('#35d07f');
  });

  it('lets clicks through to the stalls and cars under it', () => {
    expect(mount().querySelector('[aria-label="Wash machines"]')!.getAttribute('pointer-events')).toBe('none');
  });
});
