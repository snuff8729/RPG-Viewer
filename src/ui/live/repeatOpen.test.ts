import { describe, expect, it } from "vitest";
import { isRepeatOpen, setRepeatOpen } from "./repeatOpen";

describe("repeat fold open state", () => {
  it("is remembered by item key across re-renders", () => {
    expect(isRepeatOpen("r4")).toBe(false);
    setRepeatOpen("r4", true);
    expect(isRepeatOpen("r4")).toBe(true);
    expect(isRepeatOpen("r5")).toBe(false);
    setRepeatOpen("r4", false);
    expect(isRepeatOpen("r4")).toBe(false);
  });
});
