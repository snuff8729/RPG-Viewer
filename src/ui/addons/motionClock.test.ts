import { describe, expect, it } from "vitest";
import { loopTime, MOTION_HOLD_MS } from "./motionClock";

describe("loopTime", () => {
  it("plays to the end, holds the end, then loops", () => {
    expect(loopTime(0, 1000)).toBe(0);
    expect(loopTime(400, 1000)).toBe(400);
    expect(loopTime(1000 + MOTION_HOLD_MS / 2, 1000)).toBe(1000);
    expect(loopTime(1000 + MOTION_HOLD_MS + 250, 1000)).toBe(250);
  });
  it("bad input shows the end", () => {
    expect(loopTime(Number.NaN, 500)).toBe(500);
    expect(loopTime(100, 0)).toBe(0);
  });
});
