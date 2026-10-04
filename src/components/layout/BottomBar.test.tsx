import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import capture from "@/components/tabs/__fixtures__/depotOwnerBoard.0608.json";
import { useOwnerBoardStore } from "@/store/ownerBoardStore";
import type { DepotOwnerBoard } from "@/lib/ownerBoard";
import { BottomBar } from "./BottomBar";

afterEach(() => { cleanup(); useOwnerBoardStore.getState().reset(null); });

const read = (b: unknown) => {
  useOwnerBoardStore.getState().reset("run");
  useOwnerBoardStore.getState().receive("run", b as DepotOwnerBoard);
};

describe("the bottom bar's owners' agents", () => {
  it("counts the agents connected to the depot (otto-q-core 0608), and names them on hover", () => {
    read(capture.live);
    render(<BottomBar />);
    const chip = screen.getByTestId("agents-connected");
    expect(chip.textContent).toBe("2 agents connected");
    expect(chip.getAttribute("title")).toMatch(/\(passcode\), .*\(key\)/);
    // the run stopped: the passcode session ended with it, the key stays connected
    act(() => read(capture.ended));
    expect(screen.getByTestId("agents-connected").textContent).toBe("1 agent connected");
  });

  it("says nothing before the board answers, before 0608 is applied, or when no agent is connected", () => {
    render(<BottomBar />);
    expect(screen.queryByTestId("agents-connected")).toBeNull();
    act(() => {
      useOwnerBoardStore.getState().reset("run");
      useOwnerBoardStore.getState().fail("run", "not_enabled", "Could not find the function");
    });
    expect(screen.queryByTestId("agents-connected")).toBeNull();
    act(() => read({ ...capture.ended, agents: [], counts: { ...capture.ended.counts, agents_connected: 0 } }));
    expect(screen.queryByTestId("agents-connected")).toBeNull();
  });
});
