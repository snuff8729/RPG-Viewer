import { describe, expect, it } from "vitest";
import { motionSetting, onScreenNow, shouldAnimate, wantsPlay } from "./playback";

describe("wantsPlay", () => {
  it("follows the setting until the user picks", () => {
    expect(wantsPlay(true, null)).toBe(true);
    expect(wantsPlay(false, null)).toBe(false);
  });
  it("keeps the user's pause or play regardless of the setting", () => {
    expect(wantsPlay(true, "pause")).toBe(false);
    expect(wantsPlay(false, "play")).toBe(true);
  });
});

describe("onScreenNow", () => {
  it("needs both intersecting and a visible page", () => {
    expect(onScreenNow(true, true)).toBe(true);
    expect(onScreenNow(false, true)).toBe(false);
    expect(onScreenNow(true, false)).toBe(false);
  });
});

describe("shouldAnimate", () => {
  it("runs only when wanted, on screen and ready", () => {
    expect(shouldAnimate({ wants: true, onScreen: true })).toBe(true);
    expect(shouldAnimate({ wants: true, onScreen: true, ready: false })).toBe(false);
    expect(shouldAnimate({ wants: true, onScreen: false })).toBe(false);
    expect(shouldAnimate({ wants: false, onScreen: true })).toBe(false);
  });
});

describe("motionSetting", () => {
  it("keeps a stored value", () => {
    expect(motionSetting("0", false)).toBe(false);
    expect(motionSetting("1", true)).toBe(true);
  });
  it("defaults from the device reduced-motion only when never set", () => {
    expect(motionSetting(null, false)).toBe(true);
    expect(motionSetting(null, true)).toBe(false);
  });
});
