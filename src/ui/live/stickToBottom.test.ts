import { describe, expect, it } from "vitest";
import { isNearBottom, stillAtBottom } from "./stickToBottom";

describe("isNearBottom", () => {
  it("is true within 80px of the end", () => {
    expect(isNearBottom({ scrollTop: 1000, scrollHeight: 2000, clientHeight: 1000 })).toBe(true);
    expect(isNearBottom({ scrollTop: 920, scrollHeight: 2000, clientHeight: 1000 })).toBe(true);
    expect(isNearBottom({ scrollTop: 919, scrollHeight: 2000, clientHeight: 1000 })).toBe(false);
  });
  it("is true for an empty or hidden (0-height) area", () => {
    expect(isNearBottom({ scrollTop: 0, scrollHeight: 0, clientHeight: 0 })).toBe(true);
  });
});

describe("stillAtBottom (after a scroll event)", () => {
  it("stays at the bottom when content grew under a programmatic stick (the event reports the old position)", () => {
    // stuck at 1000 of 2000 (view 1000); a picture/card added 200px before the scroll event was delivered
    expect(stillAtBottom(true, 1000, { scrollTop: 1000, scrollHeight: 2200, clientHeight: 1000 })).toBe(true);
  });
  it("stays at the bottom when the view got shorter without the user moving", () => {
    expect(stillAtBottom(true, 1000, { scrollTop: 1000, scrollHeight: 2000, clientHeight: 700 })).toBe(true);
  });
  it("leaves the bottom when the user scrolled up past the threshold", () => {
    expect(stillAtBottom(true, 1000, { scrollTop: 800, scrollHeight: 2000, clientHeight: 1000 })).toBe(false);
  });
  it("stays at the bottom for a small upward nudge within the threshold", () => {
    expect(stillAtBottom(true, 1000, { scrollTop: 950, scrollHeight: 2000, clientHeight: 1000 })).toBe(true);
  });
  it("resumes when the user scrolls back down to the bottom", () => {
    expect(stillAtBottom(false, 500, { scrollTop: 990, scrollHeight: 2000, clientHeight: 1000 })).toBe(true);
  });
  it("does not resume by scrolling down while still far from the bottom", () => {
    expect(stillAtBottom(false, 500, { scrollTop: 700, scrollHeight: 2000, clientHeight: 1000 })).toBe(false);
  });
  it("is at the bottom while hidden (0 height) even if the old position was further down", () => {
    expect(stillAtBottom(true, 1000, { scrollTop: 0, scrollHeight: 0, clientHeight: 0 })).toBe(true);
  });
});
