// layerInfo.test.ts — the words behind each OTTO-Q layer's "i" keep the two rules the file states: every layer says all
// five things Chase asked for, and no count is written into copy (a number on screen is the run's or a ledger's).
import { describe, expect, it } from "vitest";
import { FLAT_LAYER_PLATES, LAYER_INFO } from "./layerInfo";
import { PLATES } from "@/components/tabs/ottoq/stack/stackModel";
import { LAYERS } from "./ottoqFunnel";

const allText = (p: keyof typeof LAYER_INFO) => {
  const i = LAYER_INFO[p];
  return [i.what, i.why, i.does, ...i.technically, ...i.chosen, i.never].join(" ");
};

describe("layer info", () => {
  it("covers every plate, with its own label and tagline", () => {
    expect(Object.keys(LAYER_INFO).sort()).toEqual(PLATES.map((p) => p.id).sort());
    for (const p of PLATES) {
      expect(LAYER_INFO[p.id].title).toBe(p.label);
      expect(LAYER_INFO[p.id].tagline).toBe(p.tagline);
    }
  });

  it("says what it is, why, what it does, what it technically is and why it was built so, for every layer", () => {
    for (const p of PLATES) {
      const i = LAYER_INFO[p.id];
      for (const s of [i.what, i.why, i.does, i.never]) expect(s.trim().length).toBeGreaterThan(40);
      expect(i.technically.length).toBeGreaterThanOrEqual(3);
      expect(i.chosen.length).toBeGreaterThanOrEqual(2);
      expect(i.refs.length).toBeGreaterThanOrEqual(3);
      for (const s of [...i.technically, ...i.chosen]) expect(s.trim().length).toBeGreaterThan(30);
    }
  });

  it("writes no count into copy: the only digits are names and versions", () => {
    // Allowed: "L1", "L2", a protocol or product version, a migration-free name. Anything else is a number that would
    // ship without a run ID (CLAUDE.md rule 6 and 2.9).
    const allowed = [/\bOCPP 2\.0\.1\b/g, /\brelease 26\.08\b/g, /\bL[12]\b/g, /\b3D\b/g, /\bSOLVER_STATE\.md §10\b/g];
    for (const p of PLATES) {
      let t = allText(p.id);
      for (const re of allowed) t = t.replace(re, "");
      expect(t, `${p.id} carries a digit`).not.toMatch(/\d/);
    }
  });

  it("makes none of the claims the harness document forbids", () => {
    // AGENT_HARNESS.md "Not true yet, and not to be said".
    const forbidden = [/self-learning/i, /production-proven/i, /guaranteed optimal/i, /closed-loop/i, /\bprovably safe\b/i];
    for (const p of PLATES) for (const re of forbidden) expect(allText(p.id)).not.toMatch(re);
  });

  it("says plainly that proposers never decide", () => {
    expect(LAYER_INFO.agent.never).toMatch(/never places a car/);
    expect(LAYER_INFO.planners.never).toMatch(/No planner ever writes a final assignment/);
    expect(LAYER_INFO.depot.never).toMatch(/renderer never decides/);
  });

  it("maps every flat-funnel layer to at least one plate", () => {
    expect(Object.keys(FLAT_LAYER_PLATES).sort()).toEqual(LAYERS.map((l) => l.id).sort());
    for (const plates of Object.values(FLAT_LAYER_PLATES)) {
      expect(plates.length).toBeGreaterThan(0);
      for (const p of plates) expect(LAYER_INFO[p]).toBeTruthy();
    }
    expect(FLAT_LAYER_PLATES.proposers).toEqual(["agent", "planners"]);
  });
});
