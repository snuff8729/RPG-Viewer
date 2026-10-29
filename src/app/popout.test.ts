import { describe, expect, it } from "vitest";
import {
  clampGeometry, defaultGeometry, HEARTBEAT_MS, isPoppedOut, moduleWindowName, moduleWindowUrl, OPENING_GRACE_MS, parseGeometry,
  parseModuleWindow, parsePopoutMessage, POPOUT_MODULES, presenceExpire, presenceOpening, presenceReduce, PRESENCE_TTL_MS,
  serializeGeometry, windowFeatures, type Presence,
} from "./popout";

const screen = { left: 0, top: 0, width: 1920, height: 1040 };

describe("module window url", () => {
  it("round-trips module and game key", () => {
    const url = moduleWindowUrl("/app/", "cheat", "server:c:/games/a b|x");
    expect(url.startsWith("/app/?")).toBe(true);
    expect(url.endsWith("#/play")).toBe(true);
    const search = url.slice(url.indexOf("?"), url.indexOf("#"));
    expect(parseModuleWindow(search)).toEqual({ module: "cheat", game: "server:c:/games/a b|x" });
  });
  it("is not a module window without a known module", () => {
    expect(parseModuleWindow("")).toBeNull();
    expect(parseModuleWindow("?popup=x")).toBeNull();
    expect(parseModuleWindow("?module=foo&game=x")).toBeNull();
    expect(parseModuleWindow("?module=map")).toEqual({ module: "map", game: "" });
    expect(new URL(`http://x${moduleWindowUrl("/", "reader", undefined)}`).searchParams.get("game")).toBe("");
  });
  it("names one window per module", () => {
    expect(new Set(POPOUT_MODULES.map(moduleWindowName)).size).toBe(POPOUT_MODULES.length);
  });
});

describe("geometry", () => {
  it("parses saved geometry and ignores broken values", () => {
    expect(parseGeometry(serializeGeometry({ x: 10, y: -5, w: 500, h: 600 }))).toEqual({ x: 10, y: -5, w: 500, h: 600 });
    expect(parseGeometry(null)).toBeNull();
    expect(parseGeometry("")).toBeNull();
    expect(parseGeometry("{")).toBeNull();
    expect(parseGeometry("[]")).toBeNull();
    expect(parseGeometry(JSON.stringify({ x: 1, y: 2, w: 0, h: 5 }))).toBeNull();
    expect(parseGeometry(JSON.stringify({ x: "1", y: 2, w: 3, h: 5 }))).toBeNull();
  });
  it("keeps geometry that fits", () => {
    expect(clampGeometry({ x: 100, y: 50, w: 600, h: 800 }, screen)).toEqual({ x: 100, y: 50, w: 600, h: 800 });
  });
  it("moves off-screen windows back on screen and shrinks oversized ones", () => {
    expect(clampGeometry({ x: 3000, y: 2000, w: 600, h: 800 }, screen)).toEqual({ x: 1320, y: 240, w: 600, h: 800 });
    expect(clampGeometry({ x: -500, y: -40, w: 600, h: 800 }, screen)).toEqual({ x: 0, y: 0, w: 600, h: 800 });
    expect(clampGeometry({ x: 0, y: 0, w: 5000, h: 5000 }, screen)).toEqual({ x: 0, y: 0, w: 1920, h: 1040 });
    expect(clampGeometry({ x: 10, y: 10, w: 50, h: 50 }, screen)).toEqual({ x: 10, y: 10, w: 320, h: 240 });
  });
  it("respects a screen that does not start at 0", () => {
    const second = { left: 1920, top: 0, width: 1280, height: 1000 };
    expect(clampGeometry({ x: 100, y: 100, w: 500, h: 500 }, second)).toEqual({ x: 1920, y: 100, w: 500, h: 500 });
  });
  it("only enforces the minimum size when the screen is unknown", () => {
    expect(clampGeometry({ x: -9, y: 9, w: 100, h: 900 }, { left: 0, top: 0, width: 0, height: 0 })).toEqual({ x: -9, y: 9, w: 320, h: 900 });
  });
  it("gives each module a default that fits the screen", () => {
    for (const m of POPOUT_MODULES) {
      const g = defaultGeometry(m, { left: 0, top: 0, width: 800, height: 600 });
      expect(g.x + g.w).toBeLessThanOrEqual(800);
      expect(g.y + g.h).toBeLessThanOrEqual(600);
    }
  });
  it("builds window.open features", () => {
    expect(windowFeatures({ x: 1, y: 2, w: 300, h: 400 })).toBe("popup,left=1,top=2,width=300,height=400");
  });
});

describe("presence", () => {
  it("parses only well-formed messages", () => {
    expect(parsePopoutMessage({ type: "ping" })).toEqual({ type: "ping" });
    expect(parsePopoutMessage({ type: "here", module: "map", game: "g" })).toEqual({ type: "here", module: "map", game: "g" });
    expect(parsePopoutMessage({ type: "here", module: "nope", game: "g" })).toBeNull();
    expect(parsePopoutMessage({ type: "gone", module: "map" })).toBeNull();
    expect(parsePopoutMessage(null)).toBeNull();
    expect(parsePopoutMessage("ping")).toBeNull();
  });
  it("a heartbeat keeps a module popped out until it goes quiet", () => {
    let p: Presence = {};
    p = presenceReduce(p, { type: "here", module: "cheat", game: "g" }, 1000);
    expect(isPoppedOut(p, "cheat", "g", 1000 + HEARTBEAT_MS)).toBe(true);
    expect(isPoppedOut(p, "cheat", "other", 1000)).toBe(false);
    expect(isPoppedOut(p, "map", "g", 1000)).toBe(false);
    expect(isPoppedOut(p, "cheat", "g", 1000 + PRESENCE_TTL_MS)).toBe(false);
    expect(presenceExpire(p, 1000 + PRESENCE_TTL_MS)).toEqual({});
    expect(presenceExpire(p, 1000)).toBe(p);
  });
  it("gone and reclaim end it at once", () => {
    const p = presenceReduce({}, { type: "here", module: "map", game: "g" }, 0);
    expect(isPoppedOut(presenceReduce(p, { type: "gone", module: "map", game: "g" }, 1), "map", "g", 1)).toBe(false);
    expect(isPoppedOut(presenceReduce(p, { type: "reclaim", module: "map", game: "g" }, 1), "map", "g", 1)).toBe(false);
    expect(presenceReduce(p, { type: "gone", module: "cheat", game: "g" }, 1)).toBe(p);
    expect(presenceReduce(p, { type: "ping" }, 1)).toBe(p);
  });
  it("a just-opened window counts as popped out during the grace period", () => {
    const p = presenceOpening({}, "reader", "g", 0);
    expect(isPoppedOut(p, "reader", "g", OPENING_GRACE_MS - 1)).toBe(true);
    expect(isPoppedOut(p, "reader", "g", OPENING_GRACE_MS)).toBe(false);
    // 첫 알림이 와도 기한을 줄이지 않는다
    expect(presenceOpening(presenceReduce(p, { type: "here", module: "reader", game: "g" }, 10), "reader", "g", 10)["g|reader"]).toBe(10 + OPENING_GRACE_MS);
  });
});
