import { describe, expect, it } from "vitest";
import type { MissingItem, EvalStatus } from "@/core/live/types";
import { filterReachable, splitMissing, pageSlice, PAGE_SIZE } from "./missingItems";

const mk = (kind: "choice" | "page", ...st: EvalStatus[]): MissingItem => ({
  kind, entry: {} as MissingItem["entry"], nodePath: [0], label: kind,
  requirements: st.map((status) => ({ text: "x", status })), onCurrentMap: false, allMet: false,
});

describe("missingItems", () => {
  it("filterReachable drops items with an unmet requirement", () => {
    const items = [mk("choice", "met"), mk("choice", "unmet"), mk("page"), mk("page", "unknown", "met")];
    expect(filterReachable(items)).toHaveLength(3);
    expect(filterReachable(items, false)).toHaveLength(4);
  });
  it("splitMissing separates by kind keeping order", () => {
    const a = mk("choice"), b = mk("page"), c = mk("choice");
    expect(splitMissing([a, b, c])).toEqual({ choices: [a, c], pages: [b] });
  });
  it("pageSlice caps at 100 per step", () => {
    const xs = Array.from({ length: 250 }, (_, i) => i);
    expect(PAGE_SIZE).toBe(100);
    expect(pageSlice(xs, 1)).toHaveLength(100);
    expect(pageSlice(xs, 3)).toHaveLength(250);
  });
});
