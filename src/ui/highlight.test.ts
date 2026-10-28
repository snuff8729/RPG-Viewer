import { describe, expect, it } from "vitest";
import { forcedSignal, forcedOpenKeys, nodeSelector, pathKey } from "./highlight";

describe("highlight", () => {
  it("builds selectors", () => {
    expect(pathKey([2, -1, 0])).toBe("2.-1.0");
    expect(nodeSelector("map:2:1:0", [1, 0, 3])).toBe('[data-page-key="map:2:1:0"] [data-node-path="1.0.3"]');
    expect(nodeSelector("common:4", [0])).toBe('[data-page-key="common:4"] [data-node-path="0"]');
  });
  it("signals per navigation via nonce", () => {
    const keys = new Set(["1.0"]);
    expect(forcedSignal({ nonce: 3, keys }, "1.0")).toBe(3);
    expect(forcedSignal({ nonce: 4, keys }, "1.0")).toBe(4);
    expect(forcedSignal({ nonce: 4, keys }, "2.0")).toBe(0);
    expect(forcedSignal({ nonce: 4, keys: new Set() }, "1.0")).toBe(0);
  });
  it("forces every enclosing branch open", () => {
    expect([...forcedOpenKeys([4])]).toEqual([]);
    expect([...forcedOpenKeys([1, 0, 2])]).toEqual(["1.0"]);
    expect([...forcedOpenKeys([1, 0, 2, -1, 0])]).toEqual(["1.0", "1.0.2", "1.0.2.-1"]);
  });
});
