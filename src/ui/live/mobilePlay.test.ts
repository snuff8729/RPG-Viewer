import { describe, expect, it } from "vitest";
import {
  choiceAppeared, countLines, isPlayTab, loadPlayTab, migrateOldTab, PLAY_TABS, savePlayTab, unseenLines, type TabStore,
} from "./mobilePlay";

const mem = (): TabStore & { m: Map<string, string> } => {
  const m = new Map<string, string>();
  return { m, getItem: k => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); } };
};
const broken: TabStore = { getItem: () => { throw new Error("x"); }, setItem: () => { throw new Error("x"); } };

describe("mobile play tab", () => {
  it("defaults to assist", () => {
    expect(loadPlayTab(mem())).toBe("assist");
    expect(loadPlayTab(null)).toBe("assist");
  });
  it("tab order is assist, cheat, map, read", () => {
    expect(PLAY_TABS).toEqual(["assist", "cheat", "map", "read"]);
  });
  it("round-trips under rpgv.play.mobileTab2", () => {
    const s = mem();
    savePlayTab("map", s);
    expect(s.m.get("rpgv.play.mobileTab2")).toBe("map");
    expect(loadPlayTab(s)).toBe("map");
    savePlayTab("cheat", s);
    expect(loadPlayTab(s)).toBe("cheat");
  });
  it("migrates the old tab once: map/story -> map, read -> assist", () => {
    const old = (v: string) => { const s = mem(); s.setItem("rpgv.play.mobileTab", v); return s; };
    expect(loadPlayTab(old("map"))).toBe("map");
    expect(loadPlayTab(old("story"))).toBe("map");
    expect(loadPlayTab(old("read"))).toBe("assist");
    const s = old("story");
    savePlayTab("read", s);
    expect(loadPlayTab(s)).toBe("read");
    expect(migrateOldTab(null)).toBe("assist");
  });
  it("ignores junk and broken storage", () => {
    const s = mem();
    s.setItem("rpgv.play.mobileTab2", "weird");
    expect(loadPlayTab(s)).toBe("assist");
    expect(loadPlayTab(broken)).toBe("assist");
    expect(() => savePlayTab("map", broken)).not.toThrow();
    expect(isPlayTab("cheat")).toBe(true);
    expect(isPlayTab("story")).toBe(false);
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
