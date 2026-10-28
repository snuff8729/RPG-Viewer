import { describe, expect, it } from "vitest";
import type { HistoryItem } from "@/core/live/types";
import { filterItems, itemKind, type Kind } from "./historyFilter";

const base = { v: 1 as const, seq: 1, t: 0, run: 1, branch: 1 };
const rec = (r: object): HistoryItem => ({ kind: "record", record: { ...base, ...r } as never, uncertain: false, changed: false });

describe("historyFilter", () => {
  it("maps items to kinds", () => {
    expect(itemKind(rec({ type: "message" }))).toBe("message");
    expect(itemKind(rec({ type: "scroll" }))).toBe("message");
    expect(itemKind(rec({ type: "choices" }))).toBe("choice");
    expect(itemKind(rec({ type: "choice" }))).toBe("choice");
    expect(itemKind(rec({ type: "picture" }))).toBe("picture");
    expect(itemKind(rec({ type: "transfer" }))).toBe("transfer");
    expect(itemKind(rec({ type: "battle" }))).toBe("battle");
    expect(itemKind(rec({ type: "state" }))).toBe("state");
    expect(itemKind(rec({ type: "save" }))).toBe("save");
    expect(itemKind(rec({ type: "load" }))).toBe("save");
    expect(itemKind(rec({ type: "branchStart" }))).toBeNull();
    expect(itemKind(rec({ type: "error" }))).toBeNull();
    expect(itemKind({ kind: "fork", atSeq: 1, branches: [] })).toBeNull();
    expect(itemKind({ kind: "repeat", record: { ...base, type: "message" } as never, count: 2 })).toBe("message");
    expect(itemKind({ kind: "stateGroup", records: [], count: 2 })).toBe("state");
  });
  it("filters, keeping always-shown items", () => {
    const items = [rec({ type: "message" }), rec({ type: "picture" }), rec({ type: "branchStart" }), rec({ type: "state" })];
    const out = filterItems(items, new Set<Kind>(["picture"]));
    expect(out).toEqual([items[1], items[2]]);
  });
});
