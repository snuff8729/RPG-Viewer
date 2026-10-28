import { describe, expect, it } from "vitest";
import { conditionIcon, liveHintsEnabled } from "./annotations";

describe("annotations", () => {
  it("liveHintsEnabled", () => {
    expect(liveHintsEnabled("noPlugin")).toBe(false);
    for (const c of ["waiting", "connected", "stale"] as const) expect(liveHintsEnabled(c)).toBe(true);
  });
  it("conditionIcon", () => {
    expect(conditionIcon("met")).toBe("✓");
    expect(conditionIcon("unmet")).toBe("✗");
    expect(conditionIcon("unknown")).toBe("?");
  });
});
