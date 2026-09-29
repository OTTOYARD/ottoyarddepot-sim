import { describe, expect, it } from "vitest";
import {
  GLOSSARY, MISSING, STEP_LABEL, arrivedText, blockedText, checkedText, clockCT, doneText, duration, listWords,
  minutesBetween, optionsText, ownerRequestText, pickedText, placeName, plain, replannedText, ruleWord, ruleWords,
  safetyText, sentText, serviceAddedText, serviceWord, waitedText,
} from "./plainWords";

// Sim clock 2026-09-28 18:00Z is 1:00 PM in Nashville (CDT, UTC-5).
const T = (hhmm: string) => `2026-09-28T${hhmm}:00Z`;

describe("the glossary", () => {
  it("maps every internal term the brief names to its plain word", () => {
    expect(plain("need")).toBe("service");
    expect(plain("atom")).toBe("service");
    expect(plain("proposal")).toBe("plan");
    expect(plain("proposer")).toBe("planner");
    expect(plain("enacted")).toBe("chosen");
    expect(plain("superseded")).toBe("replaced by a better plan");
    expect(plain("shield")).toBe("safety check");
    expect(plain("rule_evaluation")).toBe("safety check");
    expect(plain("dispatch")).toBe("sent");
    expect(plain("SoC")).toBe("battery");
    expect(plain("staging")).toBe("parking");
  });

  it("reads an unknown term as its own words, and nothing as nothing", () => {
    expect(plain("brand_new_thing")).toBe("brand new thing");
    expect(plain(null)).toBe("");
  });

  it("never maps a term to engine jargon", () => {
    for (const w of Object.values(GLOSSARY)) expect(w).not.toMatch(/_|shield|kernel|proposer|tick|SoC/i);
  });
});

describe("services, places and rules", () => {
  it("words services and itinerary legs", () => {
    expect(serviceWord("charge_dcfc")).toBe("fast charge");
    expect(serviceWord("perimeter_walkaround")).toBe("walk-around check");
    expect(serviceWord("stage")).toBe("park");
    expect(serviceWord("something_new")).toBe("something new");
    expect(listWords(["a", "b", "c"])).toBe("a, b and c");
    expect(listWords(["a"])).toBe("a");
  });

  it("names a stall by what it is", () => {
    expect(placeName("NASH-DCFC-STALL-08")).toBe("fast charger 08");
    expect(placeName("NASH-L2-STALL-14")).toBe("charger 14");
    expect(placeName("NASH-SVC-02")).toBe("service bay 02");
    expect(placeName("NASH-SVC-02", "service_bay")).toBe("service bay 02");
    expect(placeName(null, "staging")).toBe("parking");
    expect(placeName("ODD-CODE")).toBe("ODD-CODE");
  });

  it("names a rule by what it protects, never by its code", () => {
    expect(ruleWord("HW.005.vehicle_one_active_task")).toBe("one job at a time per car");
    expect(ruleWord("EN.001.grid_capacity_ceiling")).toBe("the depot's power limit");
    expect(ruleWord("ZZ.999.unknown")).toBe("a safety rule");
    expect(ruleWords(["HW.002.charger_state_precondition", "HW.002.x", "SLA.004.required_services_complete"]))
      .toBe("the charger is working and required services are done");
    for (const s of [ruleWord("HW.005.x"), ruleWords(["EN.003.bess_limits"])]) expect(s).not.toMatch(/[A-Z]{2,}\.\d/);
  });
});

describe("times", () => {
  it("reads depot time with AM/PM, and a gap as a gap", () => {
    expect(clockCT(T("18:05"))).toBe("1:05 PM");
    expect(clockCT(null)).toBe(MISSING);
    expect(clockCT("nonsense")).toBe(MISSING);
    expect(minutesBetween(T("18:00"), T("18:12"))).toBe(12);
    expect(minutesBetween(null, T("18:12"))).toBeNull();
    expect(duration(1)).toBe("1 minute");
    expect(duration(65)).toBe("1 hr 5 min");
    expect(duration(120)).toBe("2 hr");
  });
});

describe("every trail template", () => {
  it("Arrived: what it needs and when it must be ready", () => {
    expect(arrivedText({ needs: ["charge", "wash", "inspect"], targetBattery: 100, readyBy: T("20:30") }))
      .toEqual({ title: "Arrived", detail: "Needs charge to 100%, wash and inspection. Must be ready by 3:30 PM." });
    expect(arrivedText({ needs: [], targetBattery: null, readyBy: null }).detail)
      .toBe(`Needs ${MISSING}. Must be ready by ${MISSING}.`);
  });

  it("Checked the depot", () => {
    expect(checkedText({ wanted: "dcfc", free: 0, waiting: 3 }).detail).toBe("0 fast chargers free, 3 cars waiting.");
    expect(checkedText({ wanted: "dcfc", free: 1, waiting: null }).detail).toBe("1 fast charger free.");
    expect(checkedText({ wanted: "l2", free: null, waiting: null }).detail).toBe("Looked for a free charger.");
  });

  it("Found N ways", () => {
    expect(optionsText(3).title).toBe("Found 3 ways to do it");
    expect(optionsText(1).title).toBe("Found 1 way to do it");
    expect(optionsText(null).detail).toBe(`Options compared: ${MISSING}.`);
  });

  it("Picked the best: its ready time against the others", () => {
    expect(pickedText({ place: "fast charger 03", ready: T("19:10"), nextBest: T("19:25") }))
      .toEqual({ title: "Picked fast charger 03", detail: "ready 2:10 PM, against 2:25 PM for the next best." });
    expect(pickedText({ place: "charger 14", ready: null, nextBest: null }).detail).toBe(`ready time ${MISSING}.`);
  });

  it("Safety checks passed, or what stopped it", () => {
    expect(safetyText({ passed: 12, failed: [] }).title).toBe("12 safety checks passed");
    expect(safetyText({ passed: null, failed: [] }).detail).toBe(`Checks run: ${MISSING}.`);
    expect(safetyText({ passed: 11, failed: ["HW.005.vehicle_one_active_task"] }))
      .toEqual({ title: "Safety check stopped it", detail: "Failed: one job at a time per car." });
    expect(blockedText({ failed: ["HW.005.vehicle_one_active_task"], then: "Kept it in line instead." }))
      .toEqual({ title: "Safety check stopped it", detail: "Failed: one job at a time per car. Kept it in line instead." });
    expect(blockedText({ failed: [], then: null }).detail).toBe(`Rule ${MISSING}.`);
  });

  it("Sent", () => {
    expect(sentText({ place: "fast charger 03", at: T("18:02") })).toEqual({ title: "Sent to fast charger 03", detail: "at 1:02 PM" });
    expect(sentText({ place: null, at: null }).title).toBe(`Sent to ${MISSING}`);
  });

  it("Done: battery, services, and how early it left", () => {
    expect(doneText({ battery: 100, servicesDone: ["wash", "inspect"], servicesCarried: [], leftAt: T("19:48"), due: T("20:00") }).detail)
      .toBe("Battery 100%. Wash and inspection done. Left 2:48 PM, 12 minutes before due.");
    expect(doneText({ battery: 95, servicesDone: [], servicesCarried: ["detail"], leftAt: T("20:05"), due: T("20:00") }).detail)
      .toBe("Battery 95%. Full detail moved to next visit. Left 3:05 PM, 5 minutes after due.");
    expect(doneText({ battery: null, servicesDone: [], servicesCarried: [], leftAt: T("20:05"), due: null }).detail)
      .toBe(`Battery ${MISSING}. Left 3:05 PM, due time ${MISSING}.`);
  });

  it("the branches: re-planned, waited, service added, owner request", () => {
    expect(replannedText({ minutes: 20, cause: "Charger fault" })).toEqual({ title: "Re-planned", detail: "Charger fault: 20 minutes later" });
    expect(replannedText({ minutes: -5, cause: null }).detail).toBe("5 minutes earlier");
    expect(waitedText({ why: "Service bays busy", minutes: 7 }).detail).toBe("Service bays busy, for 7 minutes");
    expect(waitedText({ why: "No free fast charger", minutes: null }).detail).toBe("No free fast charger");
    expect(serviceAddedText({ service: "interior_tidy", verdict: "confirm" }).detail).toBe("Quick check confirmed the interior tidy.");
    expect(serviceAddedText({ service: "interior_tidy", verdict: "clear" }).title).toBe("Service not needed");
    expect(serviceAddedText({ service: "sensor_clean", verdict: "escalate" }).detail).toBe("Quick check found more: sensor clean needs a technician.");
    expect(ownerRequestText({ what: "wash", at: T("18:30") }).detail).toBe("wash, booked 1:30 PM");
  });

  it("labels every step kind", () => {
    expect(Object.values(STEP_LABEL).every((l) => l && !/_/.test(l))).toBe(true);
  });
});
