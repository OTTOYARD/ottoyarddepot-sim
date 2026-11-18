// ============================================================================
// liftStore — how far a service bay's lift has raised each car's body, as the renderer draws it.
//
// The same channel shape as doorStore and poseStore, for the same reason: the OTTO-TIRE machine's session steps every
// frame in the motion driver's loop, and the fleet reads the car's height in ITS frame loop, so this never goes through
// React state.
//
// Who writes it: the motion driver, from each service bay's tire session (motion/tireGate.ts, the one evaluation of
// that machine), which raises a car on the lift's pads while its wheels are changed or rotated and lowers it after.
// Nothing else lifts a car, so a car absent from the store stands on the floor: the default for every car on the lot.
//
// Values are METRES of the body's rise above its rest on its wheels.
// ============================================================================

const lifts = new Map<string, number>();

export const liftStore = {
  /** A car's body rise, metres, or 0 when it stands on the floor. */
  get(id: string): number {
    return lifts.get(id) ?? 0;
  },
  /** Make the store hold exactly these cars' rises; every other car stands on the floor. */
  sync(raised: Iterable<readonly [string, number]>): void {
    lifts.clear();
    for (const [id, m] of raised) if (m > 0) lifts.set(id, m);
  },
  clear(): void {
    lifts.clear();
  },
};
