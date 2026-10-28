import { describe, expect, it } from "vitest";
import { forcedOpenKeys, nodeSelector, pathKey } from "./highlight";

describe("highlight", () => {
  it("builds selectors", () => {
    expect(pathKey([2, -1, 0])).toBe("2.-1.0");
    expect(nodeSelector([1, 0, 3])).toBe('[data-node-path="1.0.3"]');
  });
  it("forces every enclosing branch open", () => {
    expect([...forcedOpenKeys([4])]).toEqual([]);
    expect([...forcedOpenKeys([1, 0, 2])]).toEqual(["1.0"]);
    expect([...forcedOpenKeys([1, 0, 2, -1, 0])]).toEqual(["1.0", "1.0.2", "1.0.2.-1"]);
  });
});
