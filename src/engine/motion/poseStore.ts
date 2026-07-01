// ============================================================================
// poseStore — the mutable, NON-React live-pose channel.
//
// This is the keystone of smooth many-vehicle motion. The motion driver writes
// every vehicle's live pose here each physics step (~60fps); the renderers
// (3D meshes, 2D dots) read it imperatively in their OWN animation frame and
// write straight into the transform. Live movement therefore NEVER goes through
// React state — so it never triggers a re-render. React only re-renders when the
// vehicle ROSTER changes (a car is added/removed or changes status), which is
// rare. That removes the "re-render 132 components every frame" jank at the root.
//
// Poses are stored in reused objects (mutated in place) so there is zero
// per-frame allocation.
// ============================================================================

export interface LivePose {
  x: number;       // logical x (west→east)
  y: number;       // logical y (north→south, y-down)
  heading: number; // radians, 0 = +x (east), CCW
}

const poses = new Map<string, LivePose>();

export const poseStore = {
  /** Write a vehicle's live pose (mutates in place, no allocation). */
  set(id: string, x: number, y: number, heading: number): void {
    const p = poses.get(id);
    if (p) {
      p.x = x;
      p.y = y;
      p.heading = heading;
    } else {
      poses.set(id, { x, y, heading });
    }
  },
  get(id: string): LivePose | undefined {
    return poses.get(id);
  },
  has(id: string): boolean {
    return poses.has(id);
  },
  delete(id: string): void {
    poses.delete(id);
  },
  clear(): void {
    poses.clear();
  },
};
