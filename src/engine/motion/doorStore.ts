// ============================================================================
// doorStore — how far each car's doors stand open, as the renderer draws them.
//
// The same channel shape as poseStore, for the same reason: the OTTO-CLEAN ARM's
// session steps every frame in the motion driver's loop, and the fleet reads the door
// angles in ITS frame loop, so this never goes through React state.
//
// Who writes it: the motion driver, from each fast-charger stall's cleaning session
// (motion/cleanGate.ts, the one evaluation of that arm), which opens a car's doors as
// the charge arm mates and shuts them after the cleaning arm is home, inside the
// window of the twin's interior-clean step. Nothing else opens a door, so a car absent
// from the store has both doors shut — the default for every car on the lot.
//
// Values are OPENING FRACTIONS, 0 (shut) .. 1 (open to vehicleEnvelope.DOOR.openDeg),
// one per flank: `right` is the car's right flank (authored +z), `left` its left.
// ============================================================================

export interface DoorState {
  right: number;
  left: number;
}

const doors = new Map<string, DoorState>();

const clamp01 = (v: number) => (v > 0 ? (v < 1 ? v : 1) : 0);

export const doorStore = {
  /** Set a car's door openings (mutates in place). Both shut forgets the car. */
  set(id: string, right: number, left: number): void {
    const r = clamp01(right), l = clamp01(left);
    if (r === 0 && l === 0) { doors.delete(id); return; }
    const d = doors.get(id);
    if (d) { d.right = r; d.left = l; } else doors.set(id, { right: r, left: l });
  },
  /** A car's door openings, or undefined when both are shut. */
  get(id: string): DoorState | undefined {
    return doors.get(id);
  },
  delete(id: string): void {
    doors.delete(id);
  },
  /** Make the store hold exactly these cars' openings, both doors alike; every other car's doors shut. */
  sync(open: Iterable<readonly [string, number]>): void {
    const keep = new Set<string>();
    for (const [id, f] of open) {
      const v = clamp01(f);
      if (v === 0) continue;
      keep.add(id);
      const d = doors.get(id);
      if (d) { d.right = v; d.left = v; } else doors.set(id, { right: v, left: v });
    }
    for (const id of [...doors.keys()]) if (!keep.has(id)) doors.delete(id);
  },
  clear(): void {
    doors.clear();
  },
  /** Every car with a door open, and its openings (the 2D plan draws them, Robots2D.tsx). */
  forEach(fn: (id: string, d: Readonly<DoorState>) => void): void {
    doors.forEach((d, id) => fn(id, d));
  },
  /** How many cars have a door open (for the perf probe and the tests). */
  size(): number {
    return doors.size;
  },
};
