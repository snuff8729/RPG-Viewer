import { describe, expect, it } from "vitest";
import { choiceAppeared, countLines, isPlayTab, loadPlayTab, savePlayTab, unseenLines, type TabStore } from "./mobilePlay";

const mem = (): TabStore & { m: Map<string, string> } => {
  const m = new Map<string, string>();
  return { m, getItem: k => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); } };
};
const broken: TabStore = { getItem: () => { throw new Error("x"); }, setItem: () => { throw new Error("x"); } };

describe("mobile play tab", () => {
  it("defaults to read", () => {
    expect(loadPlayTab(mem())).toBe("read");
    expect(loadPlayTab(null)).toBe("read");
  });
  it("round-trips under rpgv.play.mobileTab", () => {
    const s = mem();
    savePlayTab("map", s);
    expect(s.m.get("rpgv.play.mobileTab")).toBe("map");
    expect(loadPlayTab(s)).toBe("map");
    savePlayTab("story", s);
    expect(loadPlayTab(s)).toBe("story");
  });
  it("ignores junk and broken storage", () => {
    const s = mem();
    s.setItem("rpgv.play.mobileTab", "weird");
    expect(loadPlayTab(s)).toBe("read");
    expect(loadPlayTab(broken)).toBe("read");
    expect(() => savePlayTab("map", broken)).not.toThrow();
    expect(isPlayTab("story")).toBe(true);
    expect(isPlayTab("")).toBe(false);
  });
});

describe("new line badge", () => {
  it("counts message and scroll records only", () => {
    expect(countLines([{ type: "message" }, { type: "transfer" }, { type: "scroll" }, { type: "choice" }])).toBe(2);
    expect(countLines([])).toBe(0);
  });
  it("counts lines added since last seen, never negative", () => {
    expect(unseenLines(3, 7)).toBe(4);
    expect(unseenLines(7, 7)).toBe(0);
    expect(unseenLines(9, 2)).toBe(0);
  });
});

describe("choiceAppeared", () => {
  it("fires when a choice shows up or changes", () => {
    expect(choiceAppeared(null, "a")).toBe(true);
    expect(choiceAppeared("a", "b")).toBe(true);
    expect(choiceAppeared("a", "a")).toBe(false);
    expect(choiceAppeared("a", null)).toBe(false);
    expect(choiceAppeared(null, null)).toBe(false);
  });
});
