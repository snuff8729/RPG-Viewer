import { describe, expect, it } from "vitest";
import {
  loadToolTab, safeStore, saveToolTab,
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
});
