import { describe, expect, it } from "vitest";
import { loadOverrides, loadShowAll, overridesKey, saveOverride, saveShowAll, type DisplayStore } from "./pluginDisplay";

const memStore = (): DisplayStore & { map: Map<string, string> } => {
  const map = new Map<string, string>();
  return { map, getItem: k => map.get(k) ?? null, setItem: (k, v) => { map.set(k, v); } };
};
const broken: DisplayStore = { getItem: () => { throw new Error("x"); }, setItem: () => { throw new Error("x"); } };

describe("pluginDisplay storage", () => {
  it("show-all flag defaults off and persists", () => {
    const s = memStore();
    expect(loadShowAll(s)).toBe(false);
    saveShowAll(true, s);
    expect(loadShowAll(s)).toBe(true);
    expect(loadShowAll(broken)).toBe(false);
    expect(() => saveShowAll(true, broken)).not.toThrow();
  });

  it("overrides are per game and null resets to auto", () => {
    const s = memStore();
    expect(saveOverride("g1", "TMng", "hide", s)).toEqual({ TMng: "hide" });
    saveOverride("g1", "PlaySEId", "show", s);
    expect(loadOverrides("g1", s)).toEqual({ TMng: "hide", PlaySEId: "show" });
    expect(loadOverrides("g2", s)).toEqual({});
    expect(saveOverride("g1", "TMng", null, s)).toEqual({ PlaySEId: "show" });
    s.map.set(overridesKey("g3"), JSON.stringify({ a: "show", b: "maybe", c: 1 }));
    expect(loadOverrides("g3", s)).toEqual({ a: "show" });
    s.map.set(overridesKey("g4"), "{bad");
    expect(loadOverrides("g4", s)).toEqual({});
    expect(loadOverrides("g1", broken)).toEqual({});
    expect(saveOverride("g1", "x", "show", broken)).toEqual({ x: "show" });
  });
});
