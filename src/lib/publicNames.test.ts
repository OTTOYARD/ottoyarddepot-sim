// publicNames.test.ts — no vendor product is named on screen, and every label in the app reads one table.
//
// Chase, 2026-10-07: "I want to remove all specific tool naming from our descriptions." A rule like that decays one
// string at a time, so this test reads every string the app could draw (string literals, template text and JSX text in
// src, comments excluded) and fails on a product name, with the file and line that carries it.
//
// OTTO-PULSE and OrchestrAV carry this test with publicNames.ts (src/lib/twin/__tests__/), its two import paths aside,
// so the same scan reads each cockpit's own strings. The twin's other label maps are checked in publicNames.maps.test.ts.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  LANE_ORDER, PRODUCT_NAMES, PUBLIC_NAME, proposedBy, publicLabel, publicPhrase, publicText, publicTextInline, sentenceCase,
} from "./publicNames";
import { PROVIDER_LABEL } from "./decisionText";

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== "__fixtures__") out.push(...sourceFiles(p));
    } else if (/\.tsx?$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name) && !name.endsWith(".d.ts")) {
      out.push(p);
    }
  }
  return out;
}

/** Every string a file could put on screen, with its line. Module paths (import, export, import()) are code, not copy. */
function screenStringsOf(name: string, src: string): { text: string; line: number }[] {
  const sf = ts.createSourceFile(name, src, ts.ScriptTarget.Latest, true, name.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: { text: string; line: number }[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) return;
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) return;
    if (
      ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isJsxText(n)
      || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)
    ) {
      out.push({ text: n.text, line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1 });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}
const screenStrings = (file: string) => screenStringsOf(file, readFileSync(file, "utf8"));

describe("no product names on screen", () => {
  it("no string in the app carries a vendor product name", () => {
    const hits: string[] = [];
    const files = sourceFiles("src");
    expect(files.length).toBeGreaterThan(100); // the scan read the app, not an empty folder
    for (const file of files) {
      if (file.endsWith("publicNames.ts")) continue; // the table that maps product names away, and its patterns
      for (const s of screenStrings(file)) {
        const re = PRODUCT_NAMES.find((r) => r.test(s.text));
        if (re) hits.push(`${file}:${s.line} ${re} in ${JSON.stringify(s.text.trim().slice(0, 80))}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it("the list holds the model makers' products as well as the planners', and no engine key", () => {
    const hit = (t: string) => PRODUCT_NAMES.some((re) => re.test(t));
    for (const t of ["Claude (Anthropic)", "GPT-4o (OpenAI)", "Gemini (Google)", "NVIDIA cuOpt", "Google OR-Tools CP-SAT", "Nemotron 3 Ultra"]) {
      expect(hit(t), t).toBe(true);
    }
    // a maker named as a maker, a public name and an engine's own lower-case key are not products
    for (const t of ["the agent, on an NVIDIA open model", "the lexicographic planner", "nvidia_cuopt", "cpsat_service", "openai"]) {
      expect(hit(t), t).toBe(false);
    }
  });

  it("the scan sees JSX text, template text and plain strings, and skips comments and module paths", () => {
    // A guard that cannot fail proves nothing: run its parser over a file that has one of each.
    const found = screenStringsOf("probe.tsx", [
      'import { X } from "@/lib/CP-SAT";',
      "// cuOpt in a comment",
      'const a = "OR-Tools";',
      "const b = `the ${a} and Nemotron`;",
      "const C = () => <div>NVIDIA Omniverse</div>;",
      'const D = lazy(() => import("@/x/OmniverseViewer"));',
    ].join("\n")).map((x) => x.text.trim()).filter(Boolean);
    expect(found).toContain("OR-Tools");
    expect(found).toContain("and Nemotron");
    expect(found).toContain("NVIDIA Omniverse");
    expect(found.some((t) => t.includes("cuOpt"))).toBe(false);
    expect(found.some((t) => t.includes("@/lib/CP-SAT") || t.includes("@/x/OmniverseViewer"))).toBe(false);
  });
});

describe("one table for every name", () => {
  it("names each engine key by what it does, never by a product", () => {
    for (const [key, n] of Object.entries(PUBLIC_NAME)) {
      for (const word of [n.label, n.phrase, n.lane]) {
        expect(word, key).not.toMatch(/nemotron|cuopt|cp-?sat|or-tools|google/i);
      }
      expect(n.phrase.startsWith("the "), key).toBe(true);
    }
    expect(publicLabel("forward_lex")).toBe("Lexicographic planner");
    expect(publicLabel("cpsat_service")).toBe("Lexicographic planner");
    expect(publicLabel("nvidia_cuopt")).toBe("GPU planner");
    expect(publicLabel("nvidia_nemotron")).toBe("Agent");
    // the decision ledger's own key for the agent (ottoq_decisions.l2_engine), which no label map lists
    expect(publicLabel("nemotron")).toBe("Agent");
    expect(publicPhrase("greedy_constrained")).toBe("the heuristic planner");
    expect(publicPhrase("ottoq_service_priority")).toBe("the service-priority planner");
  });

  it("passes a key it has no name for through as words, never as a guess", () => {
    expect(publicLabel("some_new_solver")).toBe("some new solver");
    expect(publicPhrase("some_new_solver")).toBeNull();
    expect(publicLabel(null)).toBe("");
  });

  it("feeds the provider labels a decision is worded with", () => {
    expect(Object.keys(PROVIDER_LABEL).length).toBeGreaterThan(0);
    for (const [k, v] of Object.entries(PROVIDER_LABEL)) expect(v).toBe(PUBLIC_NAME[k].label);
    // two keys that are one planner share one name, and the lanes keep their order
    expect(PUBLIC_NAME.forward_lex).toBe(PUBLIC_NAME.cpsat_service);
    expect(new Set([PUBLIC_NAME.cuopt, PUBLIC_NAME.cuopt_fallback, PUBLIC_NAME.nvidia_cuopt]).size).toBe(1);
    expect(LANE_ORDER).toEqual(["the lexicographic planner", "the GPU planner", "the heuristic planner", "the service-priority planner"]);
  });

  it("starts a sentence with a capital", () => {
    expect(sentenceCase("the GPU planner")).toBe("The GPU planner");
    expect(sentenceCase("")).toBe("");
  });
});

describe("who proposed a decision, from the feed's engine column", () => {
  // The values are the ones ottoq_activity_feed wrote on runs a0001fd6 and 73d71553 (read 2026-11-10).
  it("never draws a model's id: it reads Agent, then the planners that took the hand-off", () => {
    expect(proposedBy("nvidia/nemotron-3-ultra-550b-a55b -> cpsat_service")).toBe("Agent → Lexicographic planner");
    expect(proposedBy("nvidia/nemotron-3-super-120b-a12b -> cpsat_service+nvidia_cuopt")).toBe("Agent → Lexicographic planner + GPU planner");
    expect(proposedBy("nvidia/nemotron-3-ultra-550b-a55b -> no solver call recorded")).toBe("Agent");
    // a model the table has never met is still a model's id, and is still not drawn
    expect(proposedBy("some-lab/some-model-9 -> cpsat_service")).toBe("Agent → Lexicographic planner");
  });

  it("names a planner by its public name, once", () => {
    expect(proposedBy("forward_lex")).toBe("Lexicographic planner");
    expect(proposedBy("cuopt")).toBe("GPU planner");
    expect(proposedBy("nemotron")).toBe("Agent");
    expect(proposedBy("ottoq_service_priority")).toBe("Service-priority planner");
    expect(proposedBy("greedy_constrained")).toBe("Heuristic planner");
    expect(proposedBy("kernel_regime -> cpsat_service+forward_lex")).toBe("Lexicographic planner");
  });

  it("says nothing for the decide path's own branches, the challenger or no engine", () => {
    for (const e of ["deterministic_v1", "reservation_honoured", "needs_card", "kernel_regime", "challenger Q3",
      "deterministic_fallback -> no solver call recorded", "", null, undefined]) {
      expect(proposedBy(e), String(e)).toBeNull();
    }
  });

  it("draws no product name and no engine key, whatever the column holds", () => {
    for (const e of ["nvidia/nemotron-3-ultra-550b-a55b -> nvidia_cuopt", "nvidia_nemotron -> cpsat_service", "cuopt_fallback",
      "anthropic_advisor", "nvidia/nemotron-3-ultra-550b-a55b -> some_new_solver"]) {
      const words = proposedBy(e) ?? "";
      expect(words, e).not.toMatch(/nemotron|cuopt|cp-?sat|or-tools|google|anthropic|claude|_|\//i);
      expect(PRODUCT_NAMES.some((re) => re.test(words)), e).toBe(false);
    }
  });
});

describe("text the app does not write", () => {
  it("names a product in a model's review by its public name and leaves the rest as written", () => {
    expect(publicText("NVIDIA Nemotron 3 Ultra flagged 4 offers from cuOpt.")).toBe(
      "The agent model flagged 4 offers from the GPU planner.",
    );
    expect(publicText("CP-SAT (Google OR-Tools) made 3 offers. cuopt_fallback made none.")).toBe(
      "The lexicographic planner made 3 offers. The GPU planner made none.",
    );
    expect(publicText("nemotron HTTP 502: upstream unavailable")).toBe("The agent model HTTP 502: upstream unavailable");
    expect(publicText("model nvidia/nemotron-3-ultra-550b-a55b timed out")).toBe("model the agent model timed out");
    expect(publicText("Read by the forward_lex bridge.")).toBe("Read by the lexicographic planner bridge.");
    expect(publicText("No solver names here.")).toBe("No solver names here.");
    for (const t of ["NVIDIA cuOpt", "Google OR-Tools CP-SAT", "Nemotron 3 Ultra 550B A55B", "nvidia_nemotron"]) {
      expect(publicText(t)).not.toMatch(/nemotron|cuopt|cp-?sat|or-tools|google/i);
    }
  });

  // The agent's own directives, 2026-10-13 and 2026-10-20 (10 of 9,360 agent decisions): it quoted the build brief by
  // its file name. The rule it cites is OTTO-Q's; the file name is ours and says how the app is built.
  it("keeps a rule the agent cites and drops the file it cited it from", () => {
    expect(publicText("owed mechanical_pm or sensor_calibration — CLAUDE.md rule 9 violated: preventive maintenance is required"))
      .toBe("owed mechanical_pm or sensor_calibration — rule 9 violated: preventive maintenance is required");
    expect(publicText("Directives name all newest high-severity scout findings per CLAUDE.md rule 9."))
      .toBe("Directives name all newest high-severity scout findings per rule 9.");
    expect(publicText("CLAUDE.md says a car never leaves with a service open.")).toBe("The build brief says a car never leaves with a service open.");
    expect(publicText("See claude.md.")).toBe("See the build brief.");
  });

  it("keeps a small letter on a name that starts text drawn inside a sentence of ours", () => {
    expect(publicTextInline("nemotron HTTP 502: upstream unavailable")).toBe("the agent model HTTP 502: upstream unavailable");
    expect(publicTextInline("CP-SAT returned nothing")).toBe("the lexicographic planner returned nothing");
    // text that names nothing, or that the writer started with its own capital, is left as written
    expect(publicTextInline("The queue is long. cuOpt made 2 offers.")).toBe("The queue is long. The GPU planner made 2 offers.");
    expect(publicTextInline("HTTP 404: not found")).toBe("HTTP 404: not found");
  });
});
