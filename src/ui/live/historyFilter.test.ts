import { afterEach, describe, expect, it, vi } from "vitest";
import type { HistoryItem } from "@/core/live/types";
import { ALL_KINDS, filterItems, itemKind, loadKinds, saveKinds, type Kind } from "./historyFilter";

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

describe("loadKinds/saveKinds", () => {
  afterEach(() => vi.unstubAllGlobals());
  const store = (impl: object) => vi.stubGlobal("localStorage", impl);

  it("defaults to all kinds when empty or malformed", () => {
    store({ getItem: () => null });
    expect(loadKinds().size).toBe(ALL_KINDS.length);
    store({ getItem: () => "{not json" });
    expect(loadKinds().size).toBe(ALL_KINDS.length);
  });
  it("defaults to all kinds when storage throws or is missing", () => {
    store({ getItem: () => { throw new Error("denied"); } });
    expect(loadKinds().size).toBe(ALL_KINDS.length);
    vi.stubGlobal("localStorage", undefined);
    expect(loadKinds().size).toBe(ALL_KINDS.length);
  });
  it("round-trips and ignores unknown kinds; save does not throw", () => {
    let saved = "";
    store({ getItem: () => '["picture","bogus"]', setItem: (_k: string, v: string) => { saved = v; } });
    expect([...loadKinds()]).toEqual(["picture"]);
    saveKinds(new Set<Kind>(["message"]));
    expect(saved).toBe('["message"]');
    store({ setItem: () => { throw new Error("quota"); } });
    expect(() => saveKinds(new Set<Kind>(["message"]))).not.toThrow();
  });
});
