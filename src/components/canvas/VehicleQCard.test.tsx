import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent, within } from "@testing-library/react";
import { QCardBody } from "./VehicleQCard";
import { VehicleDot } from "./VehicleDot";
import { useQCard } from "@/store/qCardStore";
import { useOwnerBoardStore } from "@/store/ownerBoardStore";
import { buildQCard, type QDepotCard } from "@/lib/vehicleQCard";
import { agentLabel, carOwnerView, type DepotOwnerBoard } from "@/lib/ownerBoard";
import board from "@/components/tabs/__fixtures__/depotOwnerBoard.0608.json";
import type { Vehicle } from "@/engine/types";

afterEach(() => { cleanup(); useQCard.getState().close(); useOwnerBoardStore.getState().reset(null); });

const card: QDepotCard = {
  vehicle_id: "v1", display_name: "Zoox-AV-003", state: "charging_dcfc", soc: 64, target_soc: 100,
  stall: { code: "NASH-DCFC-STALL-04", kind: "dcfc" },
  reservations: [{ purpose: "wash", state: "held", stall_code: "NASH-WASH-01", starts_at: "2026-09-22T15:30:00Z", ends_at: "2026-09-22T15:45:00Z" }],
  card: {
    needs: [{ svc: "charge", status: "in_progress" }, { svc: "exterior_wash", status: "pending" }, { svc: "interior_inspection", status: "done", done_at: "2026-09-22T14:40:00Z" }],
    steps: [
      { seq: 1, leg_type: "inspect", atom: "interior_inspection", status: "done", actual_end: "2026-09-22T14:40:00Z" },
      { seq: 2, leg_type: "charge_dcfc", status: "current", progress_pct: 45, expected_end: "2026-09-22T15:20:00Z", eta_source: "charge_physics" },
      { seq: 3, leg_type: "wash", status: "upcoming", planned_start: "2026-09-22T15:30:00Z", planned_end: "2026-09-22T15:45:00Z" },
    ],
  },
};

describe("QCardBody", () => {
  it("draws the plan as a checklist: done, in progress, next", () => {
    render(<QCardBody card={buildQCard({ vehicleId: "v1", card })} onClose={() => {}} cardsStatus="ok" />);
    const rows = screen.getAllByTestId("qcard-step");
    expect(rows.map((r) => r.getAttribute("data-state"))).toEqual(["done", "current", "upcoming"]);
    expect(rows[2].textContent).toContain("wash bay 01");
    expect(rows[2].textContent).toContain("booked");
    expect(screen.getByTestId("qcard-battery").textContent).toBe("64% / 100%");
    expect(screen.getByTestId("qcard-now").textContent).toContain("end time from the charge physics");
    expect(screen.getByTestId("qcard-leave").getAttribute("data-cleared")).toBe("false");
  });

  it("draws a missing number as a dash, never 0", () => {
    const q = buildQCard({ vehicleId: "v1", card: { ...card, soc: null, card: null } });
    render(<QCardBody card={q} onClose={() => {}} cardsStatus="ok" />);
    expect(screen.getByTestId("qcard-battery").textContent).toBe("— / 100%");
    expect(screen.getByTestId("qcard-now").textContent).toContain("—");
    expect(screen.getByTestId("qcard-now").textContent).not.toMatch(/\b0%/);
    expect(screen.getByTestId("qcard-no-steps").textContent).toContain("no plan steps published");
  });

  it("closes from its ✕", () => {
    const onClose = vi.fn();
    render(<QCardBody card={buildQCard({ vehicleId: "v1", card })} onClose={onClose} cardsStatus="ok" />);
    fireEvent.click(screen.getByLabelText("Close Q card"));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

const dot = { id: "v1", type: "fleet", priority: 5, batteryCapacity: 80, currentSoC: 64, targetSoC: 100, status: "charging",
  assignedStall: null, serviceQueue: [], currentServiceIndex: 0, serviceStartTime: null, serviceDuration: null, arrivalTime: 0,
  position: { x: 10, y: 10 }, targetPosition: null } as Vehicle;

describe("tapping a car in the 2D view", () => {
  it("opens that car's Q card", () => {
    const { container } = render(<svg><VehicleDot vehicle={dot} /></svg>);
    fireEvent.click(container.querySelector('[data-vid="v1"]')!);
    expect(useQCard.getState().openId).toBe("v1");
  });
});

// ── what its owner's agent set (otto-q-core 0608), on the real capture ─────────────────────────────────────────
describe("the Q card's owner's-agent block", () => {
  const live = board.live as unknown as DepotOwnerBoard;
  const RUN = live.run!.sim_run_id;
  const idOf = (name: string) => Object.entries(live.by_vehicle!).find(([, v]) => v.vehicle === name)![0];
  const KEY = agentLabel(live.agents!.find((a) => a.via === "key")!.agent, "key");
  const PASS = agentLabel(live.agents!.find((a) => a.via === "passcode")!.agent, "passcode");
  const q = buildQCard({ vehicleId: "v1", card });

  it("draws the chips, each agent with its confirmation codes, 'applies at the next tick', and the reset line", () => {
    render(<QCardBody card={q} onClose={() => {}} cardsStatus="ok" owner={carOwnerView(live, idOf("Tesla-RT-003"), RUN)} />);
    const block = screen.getByTestId("qcard-owner");
    expect(within(block).getByText("Set by its owner's agent")).toBeTruthy();
    expect(within(block).getAllByTestId("qcard-owner-chip").map((c) => c.textContent))
      .toEqual([`Max 90% · ${KEY}`, "Exterior wash · every return", "Held until 9:00 AM"]);
    expect(within(block).getAllByTestId("qcard-owner-code").map((c) => c.textContent)).toEqual(["OQ-392E-D895", "OQ-D2E7-DE9C", "OQ-85AB-4811"]);
    expect(block.textContent).toContain(PASS);
    expect(within(block).getByTestId("qcard-owner-waiting").textContent).toBe("applies at OTTO-Q's next tick");
    expect(within(block).getByText("Everything an agent sets lasts until the demo run ends.")).toBeTruthy();
    // a service ordered for this visit
    cleanup();
    render(<QCardBody card={q} onClose={() => {}} cardsStatus="ok" owner={carOwnerView(live, idOf("Tesla-AV-045"), RUN)} />);
    expect(screen.getAllByTestId("qcard-owner-chip").map((c) => c.textContent)).toContain("Mechanical PM · this visit");
  });

  it("once OTTO-Q's tick has applied everything, it no longer says it is waiting", () => {
    const applied = { ...live, in_force: live.in_force!.map((s) => ({ ...s, waiting_for_tick: false })) };
    render(<QCardBody card={q} onClose={() => {}} cardsStatus="ok" owner={carOwnerView(applied, idOf("Tesla-AV-001"), RUN)} />);
    expect(screen.getByTestId("qcard-owner")).toBeTruthy();
    expect(screen.queryByTestId("qcard-owner-waiting")).toBeNull();
  });

  it("draws nothing for a car with nothing set, or once the run has ended", () => {
    render(<QCardBody card={q} onClose={() => {}} cardsStatus="ok" owner={carOwnerView(live, "v1", RUN)} />);
    expect(screen.queryByTestId("qcard-owner")).toBeNull();
    cleanup();
    render(<QCardBody card={q} onClose={() => {}} cardsStatus="ok" owner={carOwnerView(board.ended as unknown as DepotOwnerBoard, idOf("Tesla-AV-001"), RUN)} />);
    expect(screen.queryByTestId("qcard-owner")).toBeNull();
  });
});

describe("the 2D map's owner's-agent mark", () => {
  it("outlines a car its owner's agent set something on, and only that car", () => {
    useOwnerBoardStore.setState({ marked: new Set(["v1"]) });
    const { container } = render(<svg><VehicleDot vehicle={dot} /><VehicleDot vehicle={{ ...dot, id: "v2" }} /></svg>);
    expect(container.querySelector('[data-vid="v1"] [data-owner-mark]')).not.toBeNull();
    expect(container.querySelector('[data-vid="v2"] [data-owner-mark]')).toBeNull();
  });

  it("draws no mark while nothing is set (or before 0608 answers)", () => {
    const { container } = render(<svg><VehicleDot vehicle={dot} /></svg>);
    expect(container.querySelector("[data-owner-mark]")).toBeNull();
  });
});
