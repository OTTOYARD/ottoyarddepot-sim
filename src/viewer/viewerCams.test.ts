// viewerCams.test.ts — every camera the view offers frames the depot it claims to.
import { describe, expect, it } from "vitest";
import { VIEWER_CAM_IDS } from "./protocol";
import { LOT, VIEWER_CAMS, lookFrom } from "./viewerCams";

const inside = (x: number, z: number) => x >= LOT.xMin && x <= LOT.xMax && z >= LOT.zMin && z <= LOT.zMax;
const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe("the live view's cameras", () => {
  it("has one camera per id, labelled and explained", () => {
    expect(Object.keys(VIEWER_CAMS).sort()).toEqual([...VIEWER_CAM_IDS].sort());
    for (const id of VIEWER_CAM_IDS) {
      expect(VIEWER_CAMS[id].id).toBe(id);
      expect(VIEWER_CAMS[id].label.length).toBeGreaterThan(0);
      expect(VIEWER_CAMS[id].hint.length).toBeGreaterThan(10);
    }
  });

  it("puts each corner camera just outside its own corner of the lot, above it, looking into the lot", () => {
    // east is -X and north is +Z (coordUtils.toWorld)
    const corner = { se: [-1, -1], sw: [1, -1], ne: [-1, 1], nw: [1, 1] } as const;
    for (const [id, [sx, sz]] of Object.entries(corner)) {
      const c = VIEWER_CAMS[id as keyof typeof corner];
      expect(c.kind).toBe("orbit");
      expect(Math.sign(c.position[0])).toBe(sx);
      expect(Math.sign(c.position[2])).toBe(sz);
      expect(inside(c.position[0], c.position[2]), `${id} stands inside the lot`).toBe(false);
      expect(c.position[1]).toBeGreaterThan(40); // above the canopies and the light poles
      expect(inside(c.target[0], c.target[2]), `${id} looks outside the lot`).toBe(true);
    }
  });

  it("turns the pole camera on its mast: the target is one unit in front of the lens, below level", () => {
    const p = VIEWER_CAMS.pole;
    expect(p.kind).toBe("pole");
    expect(inside(p.position[0], p.position[2])).toBe(true);
    expect(dist(p.position, p.target)).toBeCloseTo(1, 6);
    expect(p.target[1]).toBeLessThan(p.position[1]);
  });

  it("looks straight down from overhead, north up", () => {
    const t = VIEWER_CAMS.top;
    expect(t.position[1]).toBeGreaterThan(200);
    expect(Math.abs(t.position[0] - t.target[0])).toBeLessThan(1);
    expect(t.position[2]).toBeLessThan(t.target[2]); // seen from the south, so north is at the top of the frame
  });

  it("points by compass bearing in this world's frame", () => {
    const o: [number, number, number] = [0, 0, 0];
    const n = lookFrom(o, 0, 0), e = lookFrom(o, 90, 0), d = lookFrom(o, 0, 90);
    expect(n[2]).toBeCloseTo(1); expect(n[0]).toBeCloseTo(0);   // north is +Z
    expect(e[0]).toBeCloseTo(-1); expect(e[2]).toBeCloseTo(0);  // east is -X
    expect(d[1]).toBeCloseTo(-1);                               // straight down
  });
});
