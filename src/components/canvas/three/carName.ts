import type { Vehicle } from '@/engine/types';

/**
 * What the 3D view calls a car in its "Following …" chip: the renderer's label ("twin-sim-021 · Waymo"), or, for a car
 * the fleet API never named, its operator and the end of its id ("Waymo · …0002"). Never a bare 36-character id.
 *
 * The label is built from the snapshot's `av_id` (= vehicles.av_api_vehicle_id; TwinMotionDriver), and some cars carry
 * none. Measured 2026-10-02 at the twin depot: 16 of its 116 autonomous cars, a seeded series whose ids begin a1111111-,
 * b2222222- and c3333333-. Their depot display names ("Waymo-002") are not on the snapshot, so the view cannot show
 * those; operator plus the id's last four characters tells all sixteen apart.
 */
export function carName(id: string, v?: Pick<Vehicle, 'label' | 'oem'> | null): string {
  if (v?.label) return v.label;
  const op = v?.oem
    ? v.oem.split(/[_\s-]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ')
    : 'Car';
  return `${op} · …${id.slice(-4)}`;
}
