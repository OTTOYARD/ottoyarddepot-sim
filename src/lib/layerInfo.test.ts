// layerInfo.test.ts — the words behind each OTTO-Q layer's "i" keep their shape and their length: an overview, three or
// four facts, one closing line (Chase, 2026-10-06: "way more concise ... much much shorter"), and no count written into
// copy (a number on screen is the run's or a ledger's).
import { describe, expect, it } from "vitest";
import { FLAT_LAYER_PLATES, LAYER_INFO, layerInfoText } from "./layerInfo";
import { PLATES } from "@/components/tabs/ottoq/stack/stackModel";
import { LAYERS } from "./ottoqFunnel";

const words = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;
const sentences = (t: string) => t.split(/(?<=[.!?])\s+/).filter((x) => x.trim()).length;

describe("layer info", () => {
  it("covers every plate, with its own label and tagline", () => {
    expect(Object.keys(LAYER_INFO).sort()).toEqual(PLATES.map((p) => p.id).sort());
    for (const p of PLATES) {
      expect(LAYER_INFO[p.id].title).toBe(p.label);
      expect(LAYER_INFO[p.id].tagline).toBe(p.tagline);
    }
  });

  it("is an overview, three or four facts and one closing line, for every layer", () => {
    for (const p of PLATES) {
      const i = LAYER_INFO[p.id];
      expect(sentences(i.overview), `${p.id} overview`).toBeLessThanOrEqual(2);
      expect(i.points.length).toBeGreaterThanOrEqual(3);
      expect(i.points.length).toBeLessThanOrEqual(4);
      expect(sentences(i.next), `${p.id} next`).toBeLessThanOrEqual(2);
      expect(i.refs.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("stays short: under 100 words a card, no fact over 20 words, no sentence over 20 words", () => {
    for (const p of PLATES) {
      const t = layerInfoText(p.id);
      expect(words(t), `${p.id} card`).toBeLessThan(100);
      for (const pt of LAYER_INFO[p.id].points) expect(words(pt), pt).toBeLessThanOrEqual(20);
      for (const s of t.split(/(?<=[.!?])\s+/)) expect(words(s), s).toBeLessThanOrEqual(20);
    }
  });

  it("writes no count into copy: the only digits are names and versions", () => {
    // Allowed: "L1", "L2", a protocol or product version, a migration-free name. Anything else is a number that would
    // ship without a run ID (CLAUDE.md rule 6 and 2.9).
    const allowed = [/\bOCPP 2\.0\.1\b/g, /\brelease 26\.08\b/g, /\bL[12]\b/g, /\b3D\b/g];
    for (const p of PLATES) {
      let t = layerInfoText(p.id);
      for (const re of allowed) t = t.replace(re, "");
      expect(t, `${p.id} carries a digit`).not.toMatch(/\d/);
    }
  });

  it("makes none of the claims the harness document forbids", () => {
    // AGENT_HARNESS.md "Not true yet, and not to be said".
    const forbidden = [/self-learning/i, /production-proven/i, /guaranteed optimal/i, /closed-loop/i, /\bprovably safe\b/i];
    for (const p of PLATES) for (const re of forbidden) expect(layerInfoText(p.id)).not.toMatch(re);
  });

  it("says plainly that proposers never decide, and the renderer only draws", () => {
    expect(LAYER_INFO.agent.next).toMatch(/only proposes/);
    expect(LAYER_INFO.planners.next).toMatch(/No planner places a car/);
    expect(layerInfoText("depot")).toMatch(/3D view only draws/);
  });

  // Chase, 2026-10-07: "remove all specific tool naming ... make note of our proprietary or custom build safety layer and
  // rule set ... deterministic and repeatable". The open model and the lexicographic method are named by what they are.
  it("names no vendor product, and says what each layer is built on", () => {
    for (const p of PLATES) expect(layerInfoText(p.id), p.id).not.toMatch(/nemotron|cuopt|cp-?sat|or-tools|google/i);
    expect(LAYER_INFO.agent.overview).toMatch(/NVIDIA open model/);
    expect(LAYER_INFO.planners.overview).toMatch(/lexicographic optimization/);
    expect(LAYER_INFO.safety.overview).toMatch(/proprietary safety layer/);
    expect(layerInfoText("safety")).toMatch(/deterministic/);
    expect(layerInfoText("safety")).toMatch(/reproduce every verdict/);
    expect(LAYER_INFO.agent.overview).not.toMatch(/\bAI (layer|part)\b/i);
  });

  it("names the agent's goals as the engine names them", () => {
    // edge-functions/ottoq-orchestrator-agent: "objective":"readiness_first|throughput_first|energy_balanced"
    expect(layerInfoText("agent")).toMatch(/readiness first, throughput first or energy balanced/);
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
