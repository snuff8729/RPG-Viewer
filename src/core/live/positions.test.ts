import { describe, expect, it } from "vitest";
import { livePositions, withLivePositions } from "./positions";

describe("livePositions", () => {
  it("reads x, y and direction; skips entries without a valid position", () => {
    const pos = livePositions([
      { eventId: 1, page: 0, x: 3, y: 4, d: 6 },
      { eventId: 2, page: 0 },                       // 구버전 플러그인
      { eventId: 3, page: 0, x: 1.5, y: 2 },
      { eventId: 4, page: 0, x: -1, y: 2 },
      { eventId: 5, page: 0, x: 0, y: 0, d: 7 },
      null, "x", { page: 0, x: 1, y: 1 },
    ]);
    expect([...pos]).toEqual([[1, { x: 3, y: 4, d: 6 }], [5, { x: 0, y: 0 }]]);
  });
  it("tolerates garbage", () => {
    expect(livePositions(undefined).size).toBe(0);
    expect(livePositions({}).size).toBe(0);
  });
  it("withLivePositions replaces only moved items", () => {
    const items = [{ eventId: 1, x: 1, y: 1 }, { eventId: 2, x: 2, y: 2 }, { eventId: 3, x: 3, y: 3 }];
    const out = withLivePositions(items, livePositions([{ eventId: 1, page: 0, x: 5, y: 6 }, { eventId: 2, page: 0, x: 2, y: 2 }]));
    expect(out).toEqual([{ eventId: 1, x: 5, y: 6 }, { eventId: 2, x: 2, y: 2 }, { eventId: 3, x: 3, y: 3 }]);
    expect(out[1]).toBe(items[1]);
    expect(out[0]).not.toBe(items[0]);
  });
});
