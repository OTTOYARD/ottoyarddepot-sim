import { describe, expect, it } from "vitest";
import {
  backText, chargerNameFromCode, chargersDown, chargersDownLabel, downLabel, downSentence, downTag, downText, faultWords,
  sameDown, stallBadge, stallDownOf, type TwinStallStatus,
} from "./chargerFaults";
import type { TwinLayout, TwinSnapshot } from "./ottoTwin";

// The live row, read from the snapshot of run fd6ed035 on 2026-10-07 (otto-q-core 0612).
const LIVE_ROW = {
  id: "609910b1-c888-4624-8077-76c2fc83615f", status: "faulted", tethered: false, vehicle_id: null,
  reserved_by: null, reserved_until: null, tether_phase: null, tether_until: null, tether_direction: null,
  charger_state: "Faulted", fault_code: "fault.communication_dropout", fault_until: "2026-09-02T11:07:00+00:00",
} as TwinStallStatus;
// 11:07 UTC is 6:07 AM in Nashville (CDT, UTC-5); the sim clock reads in depot time
const SAME_DAY_CLOCK = "2026-09-02T09:00:00+00:00"; // 4:00 AM CT

describe("chargerFaults: reading a stall the twin has out of use", () => {
  it("reads a fault from status 'faulted' or from charger_state 'Faulted'", () => {
    expect(stallDownOf(LIVE_ROW)).toEqual({ kind: "fault", code: "fault.communication_dropout", until: "2026-09-02T11:07:00+00:00" });
    // the stall itself reads available; the charger is the one that faulted
    expect(stallDownOf({ ...LIVE_ROW, status: "available" })?.kind).toBe("fault");
    expect(stallDownOf({ ...LIVE_ROW, charger_state: null })?.kind).toBe("fault");
  });

  it("keeps the twin's 'offline' as offline, never as a fault", () => {
    expect(stallDownOf({ id: "s", status: "offline", vehicle_id: null })).toEqual({ kind: "offline", code: null, until: null });
  });

  it("a healthy charger and an older backend's row are not down", () => {
    expect(stallDownOf({ ...LIVE_ROW, status: "occupied", charger_state: "Charging" })).toBeNull();
    expect(stallDownOf({ id: "s", status: "reserved", vehicle_id: null })).toBeNull();
    expect(stallDownOf(null)).toBeNull();
  });

  it("compares two readings by what they say", () => {
    const d = stallDownOf(LIVE_ROW);
    expect(sameDown(d, stallDownOf({ ...LIVE_ROW }))).toBe(true);
    expect(sameDown(d, { ...d!, until: null })).toBe(false);
    expect(sameDown(null, undefined)).toBe(true);
    expect(sameDown(d, null)).toBe(false);
  });
});

describe("chargerFaults: the words", () => {
  it("names a known code in plain words", () => {
    const d = stallDownOf(LIVE_ROW)!;
    expect(faultWords(d.code)).toBe("communication dropout");
    expect(downLabel(d)).toBe("Charger fault: communication dropout");
    expect(downText(d, SAME_DAY_CLOCK)).toBe("Charger fault: communication dropout. Back about 6:07 AM sim.");
    expect(downTag(d)).toBe("FAULT");
    expect(downLabel({ kind: "fault", code: "fault.station_hardware", until: null })).toBe("Charger fault: hardware");
    expect(downLabel({ kind: "fault", code: "fault.connector_cable", until: null })).toBe("Charger fault: connector cable");
  });

  it("an unknown code reads as a charger fault, with no invented reason", () => {
    const d = { kind: "fault" as const, code: "fault.something_new", until: "2026-09-02T11:07:00+00:00" };
    expect(faultWords(d.code)).toBeNull();
    expect(downLabel(d)).toBe("Charger fault");
    expect(downText(d, SAME_DAY_CLOCK)).toBe("Charger fault. Back about 6:07 AM sim.");
    expect(downLabel({ kind: "fault", code: null, until: null })).toBe("Charger fault");
  });

  it("leaves the time out when the twin gave no repair end", () => {
    const d = { kind: "fault" as const, code: "fault.communication_dropout", until: null };
    expect(backText(null, SAME_DAY_CLOCK)).toBeNull();
    expect(downText(d, SAME_DAY_CLOCK)).toBe("Charger fault: communication dropout.");
    expect(downText({ ...d, until: "not a time" }, SAME_DAY_CLOCK)).toBe("Charger fault: communication dropout.");
  });

  it("names the day when the repair ends on another day, and says so when its time has passed", () => {
    expect(backText("2026-09-03T11:30:00+00:00", SAME_DAY_CLOCK)).toBe("Back about Sep 3, 6:30 AM sim.");
    // the live rows on 2026-10-07: repair ends on Sep 2, the run's clock is on Oct 6
    expect(backText(LIVE_ROW.fault_until, "2026-10-06T18:50:36+00:00")).toBe("Repair was due Sep 2, 6:07 AM sim.");
    expect(backText(LIVE_ROW.fault_until, "2026-09-02T11:30:00+00:00")).toBe("Repair was due 6:07 AM sim.");
    // no run clock to compare with: the time, with its day
    expect(backText(LIVE_ROW.fault_until, null)).toBe("Back about Sep 2, 6:07 AM sim.");
  });

  it("says the same about a named charger, for the chargers-down list", () => {
    const d = stallDownOf(LIVE_ROW)!;
    expect(downSentence("DCFC-02", d, SAME_DAY_CLOCK)).toBe("DCFC-02 has a charger fault: communication dropout. Back about 6:07 AM sim.");
    expect(downSentence("DCFC-09", { kind: "fault", code: "fault.something_new", until: null })).toBe("DCFC-09 has a charger fault.");
    expect(downSentence("L2-12", { kind: "offline", code: null, until: null })).toBe("L2-12 is offline.");
  });

  it("says offline for the twin's offline, and counts in words", () => {
    const off = { kind: "offline" as const, code: null, until: null };
    expect(downLabel(off)).toBe("Charger offline");
    expect(downText(off, SAME_DAY_CLOCK)).toBe("Charger offline.");
    expect(downTag(off)).toBe("OFFLINE");
    expect(chargersDownLabel(1)).toBe("1 charger down");
    expect(chargersDownLabel(3)).toBe("3 chargers down");
  });

  it("badges a faulted charger 'fault' and every other stall by its status", () => {
    expect(stallBadge({ status: "offline", down: { kind: "fault", code: null, until: null } })).toBe("fault");
    expect(stallBadge({ status: "offline", down: { kind: "offline", code: null, until: null } })).toBe("offline");
    expect(stallBadge({ status: "offline" })).toBe("offline"); // a car awaiting a tow: the renderer's own offline
    expect(stallBadge({ status: "charging", down: null })).toBe("charging");
  });
});

describe("chargerFaults: the chargers-down list", () => {
  const layout = {
    depot: null, structures: [],
    stalls: [
      { id: "a", code: "NASH-L2-STALL-20", type: "l2" },
      { id: "b", code: "NASH-DCFC-STALL-09", type: "dcfc" },
      { id: "c", code: "NASH-DCFC-STALL-02", type: "dcfc" },
      { id: "w", code: "NASH-WASH-01", type: "wash_bay" },
      { id: "h", code: "NASH-L2-STALL-07", type: "l2" },
    ],
  } as unknown as TwinLayout;
  const snap = {
    stalls_status: [
      { id: "a", status: "faulted", vehicle_id: null, charger_state: "Faulted", fault_code: "fault.connector_cable", fault_until: null },
      { id: "b", status: "available", vehicle_id: null, charger_state: "Faulted", fault_code: "fault.station_hardware", fault_until: null },
      { id: "c", status: "faulted", vehicle_id: null, charger_state: "Faulted", fault_code: null, fault_until: null },
      { id: "w", status: "offline", vehicle_id: null }, // a bay out of use is not a charger down
      { id: "h", status: "occupied", vehicle_id: "v", charger_state: "Charging" },
    ],
  } as unknown as TwinSnapshot;

  it("lists every faulted charger, DCFC first, by the name the plan draws", () => {
    const list = chargersDown(snap, layout);
    expect(list.map((c) => c.name)).toEqual(["DCFC-02", "DCFC-09", "L2-20"]);
    expect(list.map((c) => downLabel(c.down))).toEqual(["Charger fault", "Charger fault: hardware", "Charger fault: connector cable"]);
  });

  it("uses the renderer's own name for a stall when it has one", () => {
    const list = chargersDown(snap, layout, (id) => (id === "a" ? "L2-21" : undefined));
    expect(list.find((c) => c.id === "a")?.name).toBe("L2-21");
  });

  it("still lists a faulted stall the layout does not know (a fault is a charger's)", () => {
    const list = chargersDown(snap, null);
    expect(list).toHaveLength(3);
    expect(list.every((c) => c.name === "Charger")).toBe(true);
  });

  it("an empty or older frame lists nothing", () => {
    expect(chargersDown(null, layout)).toEqual([]);
    expect(chargersDown({ stalls_status: [] } as unknown as TwinSnapshot, layout)).toEqual([]);
  });

  it("turns a twin code into the plan's name", () => {
    expect(chargerNameFromCode("NASH-DCFC-STALL-2", "dcfc")).toBe("DCFC-02");
    expect(chargerNameFromCode("NASH-L2-STALL-20", "l2")).toBe("L2-20");
    expect(chargerNameFromCode("ODD-CODE", null)).toBe("ODD-CODE");
    expect(chargerNameFromCode(null, null)).toBeNull();
  });
});
