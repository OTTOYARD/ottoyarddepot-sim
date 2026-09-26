import { describe, expect, it } from "vitest";
import { describeEvent, eventDomain, eventTone, repeatText } from "./eventFeed";

// Payloads below are copied from run 736406cf / 689095e2 events (otto-q-core db/checks/0355), trimmed.

describe("eventDomain", () => {
  it("files each event under the operator's question it answers", () => {
    expect(eventDomain("charge.session_started")).toBe("charging");
    expect(eventDomain("arm.mate_latched")).toBe("charging");
    expect(eventDomain("ottoq.charge_start_refused")).toBe("charging");
    expect(eventDomain("ottoq.replan_escalated")).toBe("vehicles");
    expect(eventDomain("fleet.arrival_delayed")).toBe("vehicles");
    expect(eventDomain("twin.staging_overflow")).toBe("depot");
    expect(eventDomain("sim_tick_failed")).toBe("depot");
    expect(eventDomain("sdr_issued")).toBe("records");
    expect(eventDomain("twin.oem_webhook_emitted")).toBe("records");
  });
});

describe("eventTone", () => {
  it("reads the emitter's severity, including the two the old tab rendered grey", () => {
    expect(eventTone("warning")).toBe("problem");
    expect(eventTone("critical")).toBe("critical");
    expect(eventTone("error")).toBe("critical");            // sim_tick_failed
    expect(eventTone("safety_critical")).toBe("critical");
    expect(eventTone("info")).toBe("normal");
    expect(eventTone(null)).toBe("normal");
  });
});

describe("describeEvent", () => {
  it("says what the staging summary means, not its type", () => {
    const t = describeEvent("twin.staging_overflow", { svc_cap: 2, overflow: 49, wash_cap: 3, escalated: 40 });
    expect(t.title).toBe("Staging over capacity");
    expect(t.detail).toBe("49 waiting · wash 3 · service 2 bays · 40 escalated");
  });

  it("names the rule that refused a charge", () => {
    const t = describeEvent("ottoq.charge_start_refused", { requested_kw: 350, blocking_rules: ["EN.001.grid_capacity_ceiling"] });
    expect(t.detail).toBe("EN.001.grid_capacity_ceiling · 350 kW asked");
  });

  it("gives a bay interruption its minutes (G191's signature)", () => {
    const t = describeEvent("ottoq.booking_interrupted", {
      purpose: "wash", actual_min: 0.8, planned_min: 9, release_reason: "bay_exit_before_planned_end",
    });
    expect(t.title).toBe("Bay visit cut short");
    expect(t.detail).toBe("wash · 0.8 of 9 min · bay exit before planned end");
  });

  it("reports a charge's energy and duration", () => {
    const t = describeEvent("charge.session_completed", { soc_start: 51, soc_end: 90, energy_kwh: 34.686, duration_s: 5622 });
    expect(t.detail).toBe("51% → 90% · 34.7 kWh · 94 min");
  });

  it("strips the fault prefix on a charger fault", () => {
    const t = describeEvent("charge.session_faulted", { reason: "fault.communication_dropout", repair_minutes: 10, auto_rerouted: true });
    expect(t.detail).toBe("communication dropout · repair 10 min · rerouted");
  });

  it("falls back to the type and a few scalars for an event it does not know", () => {
    const t = describeEvent("twin.something_new", { level: 3, zone: "B", nested: { x: 1 } });
    expect(t.title).toBe("Something new");
    expect(t.detail).toBe("level 3 · zone B");
  });

  it("never throws on a missing payload", () => {
    expect(describeEvent("twin.recharge_stranded", null).title).toBe("Recharging below-floor vehicles");
  });

  it("names what made the weather an anomaly (317d4331: heat, 454 times, every one 'clear')", () => {
    const heat = describeEvent("twin.weather_anomaly", { label: "clear", temp_c: 40.6, wind_kmh: 12.52, cloud_pct: 26.35, precip_mm_hr: 0 });
    expect(heat).toEqual({ title: "Extreme heat", detail: "40.6 °C · clear · wind 13 km/h" });
    const storm = describeEvent("twin.weather_anomaly", { label: "storm", temp_c: 21.04, wind_kmh: 64, precip_mm_hr: 18.25 });
    expect(storm).toEqual({ title: "Storm", detail: "21 °C · storm · 18.3 mm/h · wind 64 km/h" });
    expect(describeEvent("twin.weather_anomaly", { label: "clear", temp_c: -12.2 }).title).toBe("Extreme cold");
  });
});

describe("repeatText", () => {
  const clock = (iso: string) => iso.slice(11, 16);
  it("is silent for a single event", () => {
    expect(repeatText({ repeats: 1, clipped: false, first_sim_at: "2026-09-25T12:00:00Z" }, clock)).toBeNull();
  });
  it("says since when a standing summary has fired", () => {
    expect(repeatText({ repeats: 408, clipped: false, first_sim_at: "2026-09-25T12:14:00Z" }, clock)).toBe("×408 since 12:14");
  });
  it("does not invent a start for a group that began before the window", () => {
    expect(repeatText({ repeats: 486, clipped: true, first_sim_at: "2026-09-25T10:58:00Z" }, clock)).toBe("×486 in view");
  });
});
