// publicNames.test.ts — no vendor product is named on screen, and every label in the app reads one table.
//
// Chase, 2026-10-07: "I want to remove all specific tool naming from our descriptions." A rule like that decays one
// string at a time, so this test reads every string the app could draw (string literals, template text and JSX text in
// src, comments excluded) and fails on a product name, with the file and line that carries it.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  LANE_ORDER, PRODUCT_NAMES, PUBLIC_NAME, publicLabel, publicPhrase, publicText, sentenceCase,
} from "./publicNames";
import { PROVIDER_LABEL } from "./decisionText";
import { STACK_PROVIDER_LABEL } from "./intelligenceStack";
import { PROPOSER_WORD } from "./ottoqFunnel";
import { laneName } from "@/components/tabs/ottoq/stack/stackModel";

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
    expect(files.length).toBeGreaterThan(200); // the scan read the app, not an empty folder
    for (const file of files) {
      if (file.endsWith("publicNames.ts")) continue; // the table that maps product names away, and its patterns
      for (const s of screenStrings(file)) {
        const re = PRODUCT_NAMES.find((r) => r.test(s.text));
        if (re) hits.push(`${file}:${s.line} ${re} in ${JSON.stringify(s.text.trim().slice(0, 80))}`);
      }
    }
    expect(hits).toEqual([]);
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
    expect(publicPhrase("greedy_constrained")).toBe("the heuristic planner");
    expect(publicPhrase("ottoq_service_priority")).toBe("the service-priority planner");
  });

  it("passes a key it has no name for through as words, never as a guess", () => {
    expect(publicLabel("some_new_solver")).toBe("some new solver");
    expect(publicPhrase("some_new_solver")).toBeNull();
    expect(publicLabel(null)).toBe("");
  });

  it("feeds every label map in the app", () => {
    expect(STACK_PROVIDER_LABEL).toEqual(PROVIDER_LABEL);
    for (const [k, v] of Object.entries(PROVIDER_LABEL)) expect(v).toBe(PUBLIC_NAME[k].label);
    for (const [k, v] of Object.entries(PROPOSER_WORD)) expect(v).toBe(PUBLIC_NAME[k].phrase);
    // two keys that are one planner share one lane, and the lanes keep their order
    expect(PROPOSER_WORD.forward_lex).toBe(PROPOSER_WORD.cpsat_service);
    expect(new Set([PROPOSER_WORD.cuopt, PROPOSER_WORD.cuopt_fallback, PROPOSER_WORD.nvidia_cuopt]).size).toBe(1);
    expect(LANE_ORDER.map(laneName)).toEqual(["Lexicographic", "GPU", "Heuristic", "Priority"]);
    expect(laneName("other planners")).toBe("Other");
  });

  it("starts a sentence with a capital", () => {
    expect(sentenceCase("the GPU planner")).toBe("The GPU planner");
    expect(sentenceCase("")).toBe("");
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
});
