import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const edge = readFileSync("supabase/functions/otto-twin-control/index.ts", "utf8");

describe("OTTO-Q pipeline status receipt", () => {
  it("reports the complete agent, solver, disposition, and command funnel", () => {
    for (const field of [
      "agent_decisions",
      "vehicle_commands",
      "solver_proposals",
      "chained_solver_proposals",
      "pending_solver_proposals",
      "proposal_statuses",
      "proposal_reasons",
      "proposal_sources",
    ]) {
      expect(edge).toContain(field);
    }
  });

  it("reads disposition reasons without changing proposal packets", () => {
    expect(edge).toContain('select("status, disposition_reason, source, proposal")');
    expect(edge).not.toMatch(/\.from\("ottoq_external_proposals"\)\s*\.update/);
  });
});
