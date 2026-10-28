import { describe, it, expect } from "vitest";
import { parseRoute, formatRoute } from "./route";

describe("route", () => {
  it("parses map page", () => expect(parseRoute("#/map/12/event/3/page/2")).toEqual({ kind: "page", location: { source: "map", mapId: 12, eventId: 3, page: 1 } }));
  it("parses common", () => expect(parseRoute("#/common/5")).toEqual({ kind: "page", location: { source: "common", commonEventId: 5 } }));
  it("round-trips troop", () => { const h = "#/troop/2/page/1"; expect(formatRoute(parseRoute(h))).toBe(h); });
  it("round-trips history", () => { expect(parseRoute("#/history")).toEqual({ kind: "history" }); expect(formatRoute({ kind: "history" })).toBe("#/history"); });
  it("round-trips missing", () => { expect(parseRoute("#/missing")).toEqual({ kind: "missing" }); expect(formatRoute({ kind: "missing" })).toBe("#/missing"); });
  it("round-trips read", () => { expect(parseRoute("#/read")).toEqual({ kind: "read" }); expect(formatRoute({ kind: "read" })).toBe("#/read"); expect(parseRoute("#/read/")).toEqual({ kind: "read" }); expect(parseRoute("#/read/1")).toEqual({ kind: "home" }); });
  it("trailing slash parses history/missing", () => { expect(parseRoute("#/history/")).toEqual({ kind: "history" }); expect(parseRoute("#/missing/")).toEqual({ kind: "missing" }); });
  it("history with extra segments is home", () => expect(parseRoute("#/history/1")).toEqual({ kind: "home" }));
  it("unknown is home", () => { expect(parseRoute("")).toEqual({ kind: "home" }); expect(parseRoute("#/map/x")).toEqual({ kind: "home" }); });
});
