import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRef } from "react";
import { render, cleanup, screen } from "@testing-library/react";
import { VehicleTooltip } from "./VehicleTooltip";
import { useVehicleStore } from "@/store/vehicleStore";
import { useTwinStore } from "@/store/twinStore";
import type { Vehicle } from "@/engine/types";
import type { TwinSnapshot, TwinVehicle, TwinVisitCard } from "@/lib/ottoTwin";

// ---------------------------------------------------------------------------
// Real wire shapes, captured from ottoq_twin_snapshot on gxdrcyphqjzjsuhxuqtg
// (run 53660b86-4359-4473-898b-77e3df95d3a3, 2026-08-11). The point of this
// file is that the CARD renders these, not that a hand-drawn mock renders.
// ---------------------------------------------------------------------------
const MID_WORKFLOW: TwinVisitCard = {
  visit_id: "ea632e4b-ead6-49ab-9e7a-0d37e86625bc",
  visit_status: "in_progress",
  archetype: "std_mixed",
  urgency: "standard",
  arrived_at: "2026-08-11T17:55:28.962438+00:00",
  target_soc: 89,
  soc_at_arrival: 42,
  est_charge_min: 81,
  atoms: [
    { svc: "charge", status: "in_progress", must_do: true, est_min: 81 },
    { svc: "readiness_check", status: "pending", must_do: true, est_min: 3 },
    { svc: "interior_inspection", status: "done", must_do: true, est_min: 3 },
  ],
};

const ALL_DONE: TwinVisitCard = {
  visit_id: "d34a942e-216d-4c3f-a0e5-d5ffac662691",
  visit_status: "in_progress",
  archetype: "C_overnight",
  urgency: "overnight_hold",
  arrived_at: "2026-08-11T08:01:44.817765+00:00",
  target_soc: 80,
  soc_at_arrival: 97,
  est_charge_min: null,
  atoms: [
    { svc: "readiness_check", status: "done", must_do: true, est_min: 3 },
    { svc: "interior_inspection", status: "done", must_do: true, est_min: 4 },
    { svc: "perimeter_walkaround", status: "done", must_do: true, est_min: 13 },
  ],
};

function twinVehicle(id: string, visit?: TwinVisitCard | null): TwinVehicle {
  return {
    id,
    av_id: `AV-${id}`,
    make: "Waymo",
    platform: "waymo",
    state: "CHARGING",
    soc: 61,
    stall_id: null,
    ...(visit === undefined ? {} : { visit }),
  };
}

function snapshotWith(vehicles: TwinVehicle[]): TwinSnapshot {
  return {
    run: {
      sim_run_id: "53660b86-4359-4473-898b-77e3df95d3a3",
      scenario: "twin_demo",
      status: "running",
      sim_clock: "2026-08-11T18:00:00+00:00",
      tick_count: 12,
      time_scale: 60,
      seed: 424242,
    },
    fleet: { counts: {}, total: vehicles.length, vehicles },
    stalls_status: [],
    energy: null,
    bess: null,
    weather: null,
    grid: null,
    counters: {},
    recent_events: [],
    variability: {},
  };
}

function renderVehicle(id: string): Vehicle {
  return {
    id,
    label: `twin-sim-026 · Waymo`,
    type: "fleet",
    priority: 5,
    batteryCapacity: 100,
    currentSoC: 61,
    targetSoC: 90,
    status: "charging",
    assignedStall: null,
    serviceQueue: [],
    currentServiceIndex: 0,
    serviceStartTime: null,
    serviceDuration: null,
    arrivalTime: 0,
    position: { x: 100, y: 200 },
    oem: "waymo",
    targetPosition: null,
    waypoints: [],
  };
}

/**
 * jsdom implements no SVG geometry, so the two calls the tooltip makes to place
 * itself are stubbed. Nothing about the workflow rendering depends on them.
 */
function svgRefStub() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  Object.assign(svg, {
    createSVGPoint: () => ({
      x: 0,
      y: 0,
      matrixTransform: () => ({ x: 300, y: 400 }),
    }),
    getScreenCTM: () => ({}),
  });
  svg.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 800, height: 600 }) as DOMRect;
  const ref = createRef<SVGSVGElement>();
  (ref as { current: SVGSVGElement }).current = svg as unknown as SVGSVGElement;
  return ref;
}

function mount(id: string, snapshot: TwinSnapshot | null) {
  useVehicleStore.setState({ vehicles: [renderVehicle(id)], hoveredVehicleId: id });
  useTwinStore.setState({ snapshot });
  return render(<VehicleTooltip svgRef={svgRefStub()} />);
}

beforeEach(() => {
  useVehicleStore.getState().reset();
  useTwinStore.getState().reset();
});
afterEach(cleanup);

describe("VehicleTooltip — a car mid-workflow", () => {
  beforeEach(() => {
    mount("veh-mid", snapshotWith([twinVehicle("veh-mid", MID_WORKFLOW)]));
  });

  it("lists every assigned service, in OTTO-Q's order", () => {
    const rows = screen.getAllByTestId("workflow-row");
    expect(rows.map((r) => r.getAttribute("data-svc"))).toEqual([
      "charge",
      "readiness_check",
      "interior_inspection",
    ]);
    expect(screen.getByText("Charge")).toBeInTheDocument();
    expect(screen.getByText("Readiness check")).toBeInTheDocument();
    expect(screen.getByText("Interior inspection")).toBeInTheDocument();
  });

  it("greenlights only the completed service and highlights the running one", () => {
    const rows = screen.getAllByTestId("workflow-row");
    expect(rows.map((r) => r.getAttribute("data-state"))).toEqual([
      "active",
      "pending",
      "done",
    ]);
    expect(screen.getByText("in progress")).toBeInTheDocument();
  });

  it("shows SoC on entry, OTTO-Q's target, and its charge estimate", () => {
    expect(screen.getByTestId("soc-on-entry")).toHaveTextContent("in 42%");
    expect(screen.getByTestId("soc-target")).toHaveTextContent("target 89%");
    expect(screen.getByTestId("est-charge-min")).toHaveTextContent("~81m charge");
    expect(screen.getByTestId("soc-target-mark")).toBeInTheDocument();
  });

  it("reports progress and does NOT claim dispatch readiness", () => {
    expect(screen.getByTestId("workflow-progress")).toHaveTextContent("1 of 3 cleared");
    expect(screen.queryByTestId("workflow-ready")).toBeNull();
  });
});

describe("VehicleTooltip — a car with everything done", () => {
  beforeEach(() => {
    mount("veh-done", snapshotWith([twinVehicle("veh-done", ALL_DONE)]));
  });

  it("checks off every service", () => {
    const rows = screen.getAllByTestId("workflow-row");
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.getAttribute("data-state") === "done")).toBe(true);
  });

  it("shows the ready-for-dispatch state and drops the progress counter", () => {
    expect(screen.getByTestId("workflow-ready")).toHaveTextContent(
      /all services complete/i,
    );
    expect(screen.queryByTestId("workflow-progress")).toBeNull();
  });

  it("omits the charge estimate for a visit with no charge planned", () => {
    expect(screen.queryByTestId("est-charge-min")).toBeNull();
    expect(screen.getByTestId("soc-on-entry")).toHaveTextContent("in 97%");
  });
});

describe("VehicleTooltip — absence is rendered as absence", () => {
  it("a car with NO open visit says so, and shows no checklist", () => {
    mount("veh-idle", snapshotWith([twinVehicle("veh-idle", null)]));
    expect(screen.getByTestId("workflow-no-visit")).toHaveTextContent(
      /no open depot visit/i,
    );
    expect(screen.queryAllByTestId("workflow-row")).toHaveLength(0);
    expect(screen.queryByTestId("workflow-ready")).toBeNull();
    // Nothing was published about entry SoC or target, so nothing is shown.
    expect(screen.queryByTestId("soc-on-entry")).toBeNull();
    expect(screen.queryByTestId("soc-target")).toBeNull();
  });

  it("an OLDER BACKEND that omits `visit` reads as unpublished, not as 'nothing needed'", () => {
    mount("veh-legacy", snapshotWith([twinVehicle("veh-legacy", undefined)]));
    expect(screen.getByTestId("workflow-unpublished")).toHaveTextContent(
      /no workflow published/i,
    );
    expect(screen.queryByTestId("workflow-no-visit")).toBeNull();
    expect(screen.queryAllByTestId("workflow-row")).toHaveLength(0);
  });

  it("no twin snapshot at all still renders the card, unpublished", () => {
    mount("veh-mid", null);
    expect(screen.getByTestId("vehicle-tooltip")).toBeInTheDocument();
    expect(screen.getByTestId("workflow-unpublished")).toBeInTheDocument();
  });

  it("an OPEN visit with an empty manifest is its own state", () => {
    mount(
      "veh-empty",
      snapshotWith([twinVehicle("veh-empty", { ...MID_WORKFLOW, atoms: [] })]),
    );
    expect(screen.getByTestId("workflow-empty")).toHaveTextContent(
      /no services assigned/i,
    );
    expect(screen.queryByTestId("workflow-ready")).toBeNull();
  });
});

describe("VehicleTooltip — hover gate", () => {
  it("renders nothing when no car is hovered", () => {
    useVehicleStore.setState({
      vehicles: [renderVehicle("veh-mid")],
      hoveredVehicleId: null,
    });
    useTwinStore.setState({ snapshot: snapshotWith([twinVehicle("veh-mid", MID_WORKFLOW)]) });
    const { container } = render(<VehicleTooltip svgRef={svgRefStub()} />);
    expect(container.firstChild).toBeNull();
  });
});
