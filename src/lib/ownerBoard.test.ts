// ownerBoard.test.ts — what owners' agents set, on a REAL capture of otto-q-core 0608's ottoq_depot_owner_board
// (__fixtures__/depotOwnerBoard.0608.json: a scratch database with 0559-0608 applied, `live` during a demo run, `ended`
// after it was stopped, `unknown_depot` for a depot that does not exist; its `_note` says what was sent).
import { describe, expect, it } from "vitest";
import fx from "@/components/tabs/__fixtures__/depotOwnerBoard.0608.json";
import {
  COMMAND_CAP, NOT_ENABLED_TEXT, NOT_GRANTED_TEXT, agentLabel, boardIsForRun, boardStateText, carOwnerView,
  classifyBoardError, connectedAgents, connectedCount, isBoard, markedVehicleIds, mergeCommands, ownerFeedLine,
  ownerFeedLines, receiptText, sameIds, toolLabel, whenLabel,
  type DepotOwnerBoard, type OwnerBoardReply, type OwnerCommand,
} from "./ownerBoard";

const live = fx.live as unknown as DepotOwnerBoard;
const ended = fx.ended as unknown as DepotOwnerBoard;
const unknown = fx.unknown_depot as unknown as OwnerBoardReply;
const RUN = live.run!.sim_run_id;
// the capture's two agents, by how they connected (their names are data, read from the capture)
const KEY = agentLabel(live.agents!.find((a) => a.via === "key")!.agent, "key");
const PASS = agentLabel(live.agents!.find((a) => a.via === "passcode")!.agent, "passcode");
const car = (name: string) => Object.entries(live.by_vehicle!).find(([, v]) => v.vehicle === name)![0];
const cmd = (pred: (c: OwnerCommand) => boolean, b: DepotOwnerBoard = live) => b.commands!.find(pred)!;

describe("the capture", () => {
  it("is 0608's shape: a board while the run is live, the same depot with nothing in force after it ended", () => {
    expect(isBoard(live)).toBe(true);
    expect(isBoard(ended)).toBe(true);
    expect(isBoard(unknown)).toBe(false);
    expect(boardIsForRun(live, RUN)).toBe(true);
    expect(boardIsForRun(live, "another-run")).toBe(false);
    expect(boardIsForRun(ended, RUN)).toBe(false); // run: null
    expect(fx._note).toMatch(/^2026-10-04, scratch PostgreSQL/);
  });
});

describe("why a read failed", () => {
  it("names 0608 not applied, the read not granted, and anything else", () => {
    expect(classifyBoardError({ code: "PGRST202", message: "Could not find the function public.ottoq_depot_owner_board" }, 404)).toBe("not_enabled");
    expect(classifyBoardError({ code: "PGRST202" }, null)).toBe("not_enabled");
    expect(classifyBoardError({ code: "42883", message: "function does not exist" }, 400)).toBe("not_enabled");
    expect(classifyBoardError({ code: "42501", message: "permission denied for function ottoq_depot_owner_board" }, 401)).toBe("not_granted");
    expect(classifyBoardError({ code: "", message: "" }, 403)).toBe("not_granted");
    expect(classifyBoardError({ code: "57014", message: "canceling statement due to statement timeout" }, 500)).toBe("error");
    expect(classifyBoardError({ message: "TypeError: Failed to fetch" }, 0)).toBe("error");
  });

  it("says each state in words, and says nothing when the board answered", () => {
    expect(boardStateText("not_enabled", null, false)).toBe(NOT_ENABLED_TEXT);
    expect(NOT_ENABLED_TEXT).toBe("Owner agents are built but not switched on yet (otto-q-core 0607/0608).");
    expect(boardStateText("not_granted", null, false)).toBe(NOT_GRANTED_TEXT);
    expect(NOT_GRANTED_TEXT).toMatch(/not granted/);
    expect(boardStateText("error", "boom", false)).toBe("Could not read what owners' agents set: boom.");
    expect(boardStateText("error", "boom", true)).toBe("Could not read what owners' agents set: boom. Showing what was read last.");
    expect(boardStateText("refused", "No such depot.", false)).toBe("Owner agents: No such depot.");
    expect(boardStateText("ok", null, true)).toBeNull();
    expect(boardStateText("idle", null, false)).toBeNull();
  });
});

describe("one car's settings, as the Q card shows them", () => {
  it("chips: the limit with the agent that set it, each service with when, the hold with its sim time", () => {
    const v = carOwnerView(live, car("Tesla-AV-045"), RUN)!;
    expect(v.chips.map((c) => c.label)).toEqual([`Max 90% · ${KEY}`, "Exterior wash · every return", "Mechanical PM · this visit"]);
    expect(v.chips.map((c) => c.kind)).toEqual(["charge_limit", "service", "service"]);
    const held = carOwnerView(live, car("Tesla-RT-003"), RUN)!;
    expect(held.chips.map((c) => c.label)).toEqual([`Max 90% · ${KEY}`, "Exterior wash · every return", "Held until 9:00 AM"]);
  });

  it("pairs each agent with the confirmation codes OTTO-Q gave it", () => {
    const v = carOwnerView(live, car("Tesla-AV-045"), RUN)!;
    expect(v.receipts.map((r) => [r.agent, r.codes.map((c) => c.code)])).toEqual([
      [KEY, ["OQ-392E-D895"]],
      [PASS, ["OQ-D2E7-DE9C", "OQ-7728-316B"]],
    ]);
    expect(v.receipts[1].codes[0].title).toBe(`OTTO-Q's confirmation to ${PASS}: Exterior wash · every return`);
  });

  it("says who set each and when, what it does, and its code, on hover", () => {
    const v = carOwnerView(live, car("Tesla-RT-003"), RUN)!;
    const [limit, , hold] = v.chips;
    expect(limit.title).toBe(`Set by ${KEY} at 11:11 PM CT: this car charges to at most 90% instead of 100%, and OTTO-Q stops its charge there. Confirmation OQ-392E-D895.`);
    expect(hold.title).toMatch(/before 9:00 AM on Sun Sep 27 sim time\. A hold only delays a departure; it never moves the car\. Confirmation OQ-85AB-4811\.$/);
  });

  it("carries 'not applied yet' and the reset rule from the board", () => {
    const v = carOwnerView(live, car("Tesla-AV-001"), RUN)!;
    expect(v.waitingForTick).toBe(true);
    expect(v.resets).toBe(live.resets);
    const applied = { ...live, in_force: live.in_force!.map((s) => ({ ...s, waiting_for_tick: false })) };
    expect(carOwnerView(applied, car("Tesla-AV-001"), RUN)!.waitingForTick).toBe(false);
  });

  it("shows nothing for a car with nothing set, a board about another run, or an ended run", () => {
    expect(carOwnerView(live, "not-a-car", RUN)).toBeNull();
    expect(carOwnerView(live, car("Tesla-AV-001"), "another-run")).toBeNull();
    expect(carOwnerView(live, car("Tesla-AV-001"), null)).toBeNull();
    expect(carOwnerView(ended, car("Tesla-AV-001"), RUN)).toBeNull();
    expect(carOwnerView(unknown as DepotOwnerBoard, car("Tesla-AV-001"), RUN)).toBeNull();
    expect(carOwnerView(null, car("Tesla-AV-001"), RUN)).toBeNull();
  });
});

describe("which cars carry a setting (the marker in 2D and 3D)", () => {
  it("every car with a setting in force, on the run the twin shows, and no other", () => {
    const ids = markedVehicleIds(live, RUN);
    expect([...ids].sort()).toEqual(Object.keys(live.by_vehicle!).sort());
    expect(ids.size).toBe(live.counts!.cars);
    expect(markedVehicleIds(live, "another-run").size).toBe(0);
    expect(markedVehicleIds(ended, RUN).size).toBe(0);
    expect(markedVehicleIds(unknown as DepotOwnerBoard, RUN).size).toBe(0);
  });

  it("compares by membership, so an unchanged set is kept as it was", () => {
    expect(sameIds(markedVehicleIds(live, RUN), markedVehicleIds(live, RUN))).toBe(true);
    expect(sameIds(markedVehicleIds(live, RUN), new Set([car("Tesla-AV-001")]))).toBe(false);
  });
});

describe("commands across polls: one per command_id", () => {
  it("re-merging the same page changes nothing and returns the same array", () => {
    const once = mergeCommands([], live.commands);
    expect(once).toHaveLength(6);
    expect(new Set(once.map((c) => c.command_id)).size).toBe(6);
    expect(mergeCommands(once, live.commands)).toBe(once);
    expect(mergeCommands(once, [])).toBe(once);
    expect(mergeCommands(once, undefined)).toBe(once);
  });

  it("keeps them newest sent first", () => {
    const merged = mergeCommands([], [...live.commands!].reverse());
    const t = merged.map((c) => Date.parse(c.created_at));
    expect(t).toEqual([...t].sort((a, b) => b - a));
  });

  it("a command that changed since (lifted when its run ended) replaces itself, it is not added twice", () => {
    const before = mergeCommands([], live.commands);
    const after = mergeCommands(before, ended.commands);
    expect(after).not.toBe(before);
    expect(after).toHaveLength(6);
    expect(after.filter((c) => c.outcome === "applied").every((c) => !!c.lifted_at)).toBe(true);
  });

  it("keeps at most COMMAND_CAP, the newest", () => {
    const base = live.commands![0];
    const many = Array.from({ length: COMMAND_CAP + 50 }, (_, i) => ({
      ...base, command_id: `c${i}`, created_at: new Date(Date.UTC(2026, 9, 4, 4, 0, 0) + i * 1000).toISOString(),
    }));
    const kept = mergeCommands([], many);
    expect(kept).toHaveLength(COMMAND_CAP);
    expect(kept[0].command_id).toBe(`c${COMMAND_CAP + 49}`);
  });
});

describe("one line per command in the Agent tab", () => {
  it("an applied command: who, what, OTTO-Q's receipt, and the confirmation code", () => {
    const l = ownerFeedLine(cmd((c) => c.tool === "set_charge_limit" && c.outcome === "applied"));
    expect(l.kind).toBe("owner");
    expect(l.text).toBe(`${KEY} · Charge limit · Done. All 4 Teslas charge to at most 90% instead of 100%.`);
    expect(l.owner!.code).toBe("OQ-392E-D895");
    expect(l.tone).toBe("ok");
    expect(l.at).toBe("2026-09-27T12:00:00+00:00"); // the SIM clock it was sent at, the axis every feed line uses
    expect(l.owner!.sent).toBe("11:11 PM CT");
    expect(l.owner!.more).toContain("1 is charging and will stop at 90%");
    expect(l.owner!.more.some((m) => /OrchestrAV/.test(m))).toBe(false);
  });

  it("a refused command says why, and carries no code", () => {
    const l = ownerFeedLine(cmd((c) => c.tool === "set_charge_limit" && c.outcome === "refused"));
    expect(l.text).toBe(`${PASS} · Refused: 70% is below the 80% minimum in your contract. Choose 80% to 100%.`);
    expect(l.owner!.code).toBeNull();
    expect(l.tone).toBe("refused");
  });

  it("names the one car a command was for, and a command lifted with its run says so", () => {
    const hold = ownerFeedLine(cmd((c) => c.tool === "hold_vehicle"));
    expect(hold.car).toBe("Tesla-RT-003");
    expect(hold.text).toBe(`${PASS} · Hold · Done. Tesla-RT-003 will not leave before 9:00 AM sim time; once it is ready it waits in staging, and no charger is kept for it.`);
    expect(hold.owner!.note).toBeNull();
    const lifted = ownerFeedLine(cmd((c) => c.tool === "hold_vehicle", ended));
    expect(lifted.owner!.note).toBe("lifted: the run ended (completed)");
    expect(ownerFeedLine({ ...cmd((c) => c.tool === "hold_vehicle"), undone_at: "2026-10-04T04:20:00Z" }).owner!.note).toBe("undone since");
  });

  it("only the commands sent on the run the twin shows; every line in words", () => {
    expect(ownerFeedLines(live.commands!, RUN)).toHaveLength(6);
    expect(ownerFeedLines(live.commands!, "another-run")).toHaveLength(0);
    expect(ownerFeedLines(live.commands!, null)).toHaveLength(0);
    for (const l of ownerFeedLines(ended.commands!, RUN)) expect(l.text).not.toMatch(/\bundefined\b|\bnull\b|NaN|\[object/);
  });
});

describe("small words", () => {
  it("agent, when, tool, receipt", () => {
    expect(agentLabel("desk", "key")).toBe("desk (key)");
    expect(agentLabel("desk", null)).toBe("desk");
    expect(agentLabel(null, null)).toBe("An owner's agent");
    expect([whenLabel("now"), whenLabel("next_return"), whenLabel("every_return")]).toEqual(["this visit", "next return", "every return"]);
    expect([toolLabel("set_charge_limit"), toolLabel("request_service"), toolLabel("hold_vehicle"), toolLabel("something_new")])
      .toEqual(["Charge limit", "Service ordered", "Hold", "Something new"]);
    const r = receiptText(cmd((c) => c.tool === "request_service" && c.cars === 4).summary);
    expect(r.head).toBe("Done. All 4 Teslas get exterior wash (in the wash bay, about 10 min) on every visit from now on, this one included.");
    expect(r.bullets).toEqual(["2 are at the depot and get it on this visit", "1 already has it planned on this visit", "1 is out and gets it when it comes in"]);
  });

  it("connected agents: the live board's two, one after the run ended (its passcode session ended with the run)", () => {
    expect(connectedCount(live)).toBe(2);
    expect(connectedAgents(live).map((a) => agentLabel(a.agent, a.via))).toEqual([PASS, KEY]);
    expect(connectedCount(ended)).toBe(1);
    expect(connectedAgents(ended).map((a) => a.via)).toEqual(["key"]);
    expect(connectedCount(unknown as DepotOwnerBoard)).toBe(0);
    expect(connectedCount(null)).toBe(0);
  });
});
