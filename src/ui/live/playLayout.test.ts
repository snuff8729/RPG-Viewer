import { describe, expect, it } from "vitest";
import { loadPlaySidebar, PLAY_BREAKPOINT, playLayout, safeStore, savePlaySidebar, type KeyValueStore } from "./playLayout";

const memory = (): KeyValueStore => {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); } };
};
const broken: KeyValueStore = {
  getItem: () => { throw new Error("denied"); },
  setItem: () => { throw new Error("denied"); },
};

describe("playLayout", () => {
  it("stacks below the breakpoint and goes side by side at or above it", () => {
    expect(playLayout(PLAY_BREAKPOINT - 1)).toBe("stacked");
    expect(playLayout(PLAY_BREAKPOINT)).toBe("side");
    expect(playLayout(1600)).toBe("side");
    expect(playLayout(400)).toBe("stacked");
    expect(playLayout(700, 600)).toBe("side");
  });
  it("treats an unknown (0) width as side by side", () => {
    expect(playLayout(0)).toBe("side");
  });
});

describe("play sidebar flag", () => {
  it("defaults to hidden and remembers", () => {
    const s = memory();
    expect(loadPlaySidebar(s)).toBe(false);
    savePlaySidebar(true, s);
    expect(loadPlaySidebar(s)).toBe(true);
    savePlaySidebar(false, s);
    expect(loadPlaySidebar(s)).toBe(false);
  });
  it("never throws when storage fails", () => {
    const s = safeStore(broken);
    expect(() => savePlaySidebar(true, s)).not.toThrow();
    expect(loadPlaySidebar(s)).toBe(false);
    expect(safeStore(null).getItem("x")).toBeNull();
  });
});
