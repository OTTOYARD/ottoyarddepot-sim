import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { QCardBody } from "./VehicleQCard";
import { VehicleDot } from "./VehicleDot";
import { useQCard } from "@/store/qCardStore";
import { buildQCard, type QDepotCard } from "@/lib/vehicleQCard";
import type { Vehicle } from "@/engine/types";

afterEach(() => { cleanup(); useQCard.getState().close(); });

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

describe("tapping a car in the 2D view", () => {
  it("opens that car's Q card", () => {
    const v = { id: "v1", type: "fleet", priority: 5, batteryCapacity: 80, currentSoC: 64, targetSoC: 100, status: "charging",
      assignedStall: null, serviceQueue: [], currentServiceIndex: 0, serviceStartTime: null, serviceDuration: null, arrivalTime: 0,
      position: { x: 10, y: 10 }, targetPosition: null } as Vehicle;
    const { container } = render(<svg><VehicleDot vehicle={v} /></svg>);
    fireEvent.click(container.querySelector('[data-vid="v1"]')!);
    expect(useQCard.getState().openId).toBe("v1");
  });
});
