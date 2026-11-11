// publicNames.maps.test.ts — every label map this cockpit has reads the one names table (publicNames.ts).
//
// These maps are the twin's own (the funnel, the planners plate). The scan and the table's own tests are in
// publicNames.test.ts, which OTTO-PULSE and OrchestrAV carry.
import { describe, expect, it } from "vitest";
import { LANE_ORDER, PUBLIC_NAME } from "./publicNames";
import { PROVIDER_LABEL } from "./decisionText";
import { PROPOSER_WORD } from "./ottoqFunnel";
import { laneName } from "@/components/tabs/ottoq/stack/stackModel";

describe("one table for every name: the twin's label maps", () => {
  it("feeds every label map in the app", () => {
    for (const [k, v] of Object.entries(PROVIDER_LABEL)) expect(v).toBe(PUBLIC_NAME[k].label);
    for (const [k, v] of Object.entries(PROPOSER_WORD)) expect(v).toBe(PUBLIC_NAME[k].phrase);
    // two keys that are one planner share one lane, and the lanes keep their order
    expect(PROPOSER_WORD.forward_lex).toBe(PROPOSER_WORD.cpsat_service);
    expect(new Set([PROPOSER_WORD.cuopt, PROPOSER_WORD.cuopt_fallback, PROPOSER_WORD.nvidia_cuopt]).size).toBe(1);
    expect(LANE_ORDER.map(laneName)).toEqual(["Lexicographic", "GPU", "Heuristic", "Priority"]);
    expect(laneName("other planners")).toBe("Other");
  });
});
