// A Q card that fails to draw must not take the depot view with it. Before the card had its own boundary, a throw in
// the card's render reached the 3D view's boundary, and the cockpit said "The 3D view is not available in this
// browser" for a card fault. The card's data hook is stubbed: "bad" throws in render as the real failure did.
import { describe, it, expect, afterEach, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { buildQCard } from "@/lib/vehicleQCard";

vi.mock("@/hooks/useVehicleQCard", () => ({
  useVehicleQCard: (id: string | null) => {
    if (id === "bad") throw new TypeError("rows is not iterable");
    return { card: id ? buildQCard({ vehicleId: id }) : null, cardsStatus: "ok", error: null };
  },
}));

import { AnchoredQCard, QCardSheet } from "./VehicleQCard";
import { useQCard } from "@/store/qCardStore";
import { useVehicleStore } from "@/store/vehicleStore";
import type { Vehicle } from "@/engine/types";

const car = (id: string) => ({ id, type: "fleet", priority: 5, batteryCapacity: 80, currentSoC: 64, targetSoC: 100,
  status: "charging", assignedStall: null, serviceQueue: [], currentServiceIndex: 0, serviceStartTime: null,
  serviceDuration: null, arrivalTime: 0, position: { x: 10, y: 10 }, targetPosition: null }) as Vehicle;

/** React reports a caught render error on console.error; keep the run's output to what the test asserts. */
function quiet<T>(fn: () => T): T {
  const previous = console.error;
  console.error = vi.fn();
  try { return fn(); } finally { console.error = previous; }
}

afterEach(() => { cleanup(); useQCard.getState().close(); useVehicleStore.setState({ vehicles: [] }); });

describe("a card that fails to draw", () => {
  it("says so in its place and closes; the view around it stays, and the next car's card draws", () => {
    useVehicleStore.setState({ vehicles: [car("bad"), car("good")] });
    render(<div data-testid="view"><AnchoredQCard getAnchor={() => null} /></div>);

    quiet(() => act(() => useQCard.getState().open("bad")));
    expect(screen.getByRole("alert").textContent).toContain("The card for this car is not available.");
    expect(screen.getByTestId("view")).toBeTruthy();

    // a tap on another car draws its card afresh, without a close first
    act(() => useQCard.getState().open("good"));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByLabelText("Close Q card")).toBeTruthy();

    quiet(() => act(() => useQCard.getState().open("bad")));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(useQCard.getState().openId).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("does the same on the phone's sheet", () => {
    useVehicleStore.setState({ vehicles: [car("bad")] });
    render(<div data-testid="cockpit"><QCardSheet /></div>);
    quiet(() => act(() => useQCard.getState().open("bad")));
    expect(screen.getByRole("alert").textContent).toContain("The card for this car is not available.");
    expect(screen.getByTestId("cockpit")).toBeTruthy();
  });
});
