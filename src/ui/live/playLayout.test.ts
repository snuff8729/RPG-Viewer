import { describe, expect, it } from "vitest";
import {
  loadBelowTab, loadToolTab, safeStore, saveBelowTab, saveToolTab,
  type KeyValueStore,
} from "./playLayout";

const memory = (): KeyValueStore => {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); } };
};
const broken: KeyValueStore = {
  getItem: () => { throw new Error("denied"); },
  setItem: () => { throw new Error("denied"); },
};

describe("remembered tabs", () => {
  it("tool tab defaults to assist, remembers, ignores junk and broken storage", () => {
    const s = memory();
    expect(loadToolTab(s)).toBe("assist");
    saveToolTab("cheat", s);
    expect(loadToolTab(s)).toBe("cheat");
    s.setItem("rpgv.play.toolTab", "nope");
    expect(loadToolTab(s)).toBe("assist");
    expect(loadToolTab(safeStore(broken))).toBe("assist");
    expect(() => saveToolTab("read", safeStore(broken))).not.toThrow();
  });

  it("below tab is unset until chosen, remembers, ignores junk and broken storage", () => {
    const s = memory();
    expect(loadBelowTab(s)).toBeNull();
    saveBelowTab("todo", s);
    expect(loadBelowTab(s)).toBe("todo");
    s.setItem("rpgv.play.belowTab", "nope");
    expect(loadBelowTab(s)).toBeNull();
    expect(loadBelowTab(safeStore(broken))).toBeNull();
    expect(() => saveBelowTab("story", safeStore(broken))).not.toThrow();
  });
});
