// activityFeedStore.test — the OTTO-Q decision stream's merge semantics.
//
// These exist because the store changed from "replace the array every poll" to
// "accumulate a stream", and every property below is one a snapshot store got
// wrong. The tick-collapse case in particular is the reason rowKey is a tuple
// and not a timestamp.
import { beforeEach, describe, expect, it } from "vitest";
import {
  STREAM_CAP,
  rowKey,
  useActivityFeedStore,
  type ActivityFeedRow,
} from "./activityFeedStore";

const row = (over: Partial<ActivityFeedRow> = {}): ActivityFeedRow => ({
  occurred_at: "2026-09-21T10:00:00Z",
  vehicle_id: "v1",
  display_name: "OTTO-001",
  action: "stall_assignment",
  engine: "otto_q",
  target: "S-12",
  outcome: "enacted",
  rationale: null,
  reason: null,
  ...over,
});

const reset = () =>
  useActivityFeedStore.setState({ rows: [], arrivedKeys: [], frozen: false, error: null });

beforeEach(reset);

describe("rowKey", () => {
  it("keeps two vehicles decided in the SAME tick distinct", () => {
    // The trap this key exists for. One tick decides many vehicles and they
    // share occurred_at exactly, so keying on the timestamp would collapse a
    // whole tick of decisions into a single stream row.
    const a = row({ vehicle_id: "v1" });
    const b = row({ vehicle_id: "v2" });
    expect(a.occurred_at).toBe(b.occurred_at);
    expect(rowKey(a)).not.toBe(rowKey(b));
  });

  it("keeps two actions on one vehicle at one instant distinct", () => {
    expect(rowKey(row({ action: "task_start" }))).not.toBe(
      rowKey(row({ action: "stall_assignment" })),
    );
  });

  it("treats the same decision re-delivered by a later poll as identical", () => {
    expect(rowKey(row())).toBe(rowKey(row()));
  });
});

describe("mergeRows", () => {
  it("accumulates across polls instead of replacing", () => {
    const { mergeRows } = useActivityFeedStore.getState();
    mergeRows([row({ occurred_at: "2026-09-21T10:00:00Z", vehicle_id: "v1" })]);
    mergeRows([row({ occurred_at: "2026-09-21T10:00:04Z", vehicle_id: "v2" })]);
    expect(useActivityFeedStore.getState().rows).toHaveLength(2);
  });

  it("orders newest first even when a poll page arrives out of order", () => {
    const { mergeRows } = useActivityFeedStore.getState();
    mergeRows([
      row({ occurred_at: "2026-09-21T10:00:00Z", vehicle_id: "old" }),
      row({ occurred_at: "2026-09-21T10:00:08Z", vehicle_id: "new" }),
      row({ occurred_at: "2026-09-21T10:00:04Z", vehicle_id: "mid" }),
    ]);
    expect(useActivityFeedStore.getState().rows.map((r) => r.vehicle_id)).toEqual([
      "new",
      "mid",
      "old",
    ]);
  });

  it("is idempotent: re-merging the same page adds nothing", () => {
    const { mergeRows } = useActivityFeedStore.getState();
    const page = [row({ vehicle_id: "v1" }), row({ vehicle_id: "v2" })];
    mergeRows(page);
    mergeRows(page);
    expect(useActivityFeedStore.getState().rows).toHaveLength(2);
  });

  it("keeps the SAME rows reference when a poll brings nothing new, so nothing re-renders", () => {
    const { mergeRows } = useActivityFeedStore.getState();
    const page = [row()];
    mergeRows(page);
    const before = useActivityFeedStore.getState().rows;
    mergeRows(page);
    expect(useActivityFeedStore.getState().rows).toBe(before);
  });

  it("reports only genuinely new keys as arrived", () => {
    const { mergeRows } = useActivityFeedStore.getState();
    mergeRows([row({ vehicle_id: "v1" })]);
    mergeRows([row({ vehicle_id: "v1" }), row({ vehicle_id: "v2" })]);
    const { arrivedKeys } = useActivityFeedStore.getState();
    expect(arrivedKeys).toHaveLength(1);
    expect(arrivedKeys[0]).toContain("v2");
  });

  it("clears arrivedKeys on a no-op merge so a highlight cannot stick", () => {
    const { mergeRows } = useActivityFeedStore.getState();
    const page = [row()];
    mergeRows(page);
    expect(useActivityFeedStore.getState().arrivedKeys).toHaveLength(1);
    mergeRows(page);
    expect(useActivityFeedStore.getState().arrivedKeys).toHaveLength(0);
  });

  it("caps the stream and drops the OLDEST, never the newest", () => {
    const { mergeRows } = useActivityFeedStore.getState();
    // STREAM_CAP + 10 rows, ascending in time.
    const many = Array.from({ length: STREAM_CAP + 10 }, (_, i) =>
      row({
        vehicle_id: `v${i}`,
        occurred_at: new Date(Date.UTC(2026, 8, 21, 10, 0, i)).toISOString(),
      }),
    );
    mergeRows(many);
    const rows = useActivityFeedStore.getState().rows;
    expect(rows).toHaveLength(STREAM_CAP);
    expect(rows[0].vehicle_id).toBe(`v${STREAM_CAP + 9}`); // newest survives
    expect(rows.some((r) => r.vehicle_id === "v0")).toBe(false); // oldest dropped
  });

  it("tolerates an empty page without clearing the stream", () => {
    const { mergeRows } = useActivityFeedStore.getState();
    mergeRows([row()]);
    mergeRows([]);
    expect(useActivityFeedStore.getState().rows).toHaveLength(1);
  });
});

describe("freeze and replace", () => {
  it("setRows REPLACES, because a new run's decisions must not append to the last run's", () => {
    const { mergeRows, setRows } = useActivityFeedStore.getState();
    mergeRows([row({ vehicle_id: "old_run" })]);
    setRows([]);
    expect(useActivityFeedStore.getState().rows).toHaveLength(0);
  });

  it("freezing does NOT discard the scrollback it was paused to read", () => {
    const { mergeRows, setFrozen } = useActivityFeedStore.getState();
    mergeRows([row({ vehicle_id: "v1" }), row({ vehicle_id: "v2" })]);
    setFrozen(true);
    const s = useActivityFeedStore.getState();
    expect(s.frozen).toBe(true);
    expect(s.rows).toHaveLength(2);
  });
});

// 0452: changes-only rows carry a real identity and a hold that grows while the verdict stands.
describe("changes-only rows", () => {
  it("keys on the decision's own sequence number when the feed provides it", () => {
    expect(rowKey(row({ decision_seq: 42 }))).toBe("d42");
    expect(rowKey(row({ decision_seq: 42, target: "other" }))).toBe("d42");
  });

  it("updates a standing verdict in place as its hold grows, without calling it new", () => {
    const { mergeRows } = useActivityFeedStore.getState();
    mergeRows([row({ decision_seq: 7, held_ticks: 3, standing: true, last_at: "2026-09-21T10:01:00Z" })]);
    mergeRows([row({ decision_seq: 7, held_ticks: 9, standing: true, last_at: "2026-09-21T10:04:00Z" })]);
    const s = useActivityFeedStore.getState();
    expect(s.rows).toHaveLength(1);
    expect(s.rows[0].held_ticks).toBe(9);
    expect(s.arrivedKeys).toHaveLength(0);
  });

  it("keeps the same rows reference when a standing verdict has not moved", () => {
    const { mergeRows } = useActivityFeedStore.getState();
    const page = [row({ decision_seq: 7, held_ticks: 3, standing: true, last_at: "2026-09-21T10:01:00Z" })];
    mergeRows(page);
    const before = useActivityFeedStore.getState().rows;
    mergeRows([{ ...page[0] }]);
    expect(useActivityFeedStore.getState().rows).toBe(before);
  });
});
