import { describe, it, expect } from "vitest";
import { parseRoute, formatRoute } from "./route";

describe("route", () => {
  it("parses map page", () => expect(parseRoute("#/map/12/event/3/page/2")).toEqual({ kind: "page", location: { source: "map", mapId: 12, eventId: 3, page: 1 } }));
  it("parses common", () => expect(parseRoute("#/common/5")).toEqual({ kind: "page", location: { source: "common", commonEventId: 5 } }));
  it("round-trips troop", () => { const h = "#/troop/2/page/1"; expect(formatRoute(parseRoute(h))).toBe(h); });
  it("unknown is home", () => { expect(parseRoute("")).toEqual({ kind: "home" }); expect(parseRoute("#/map/x")).toEqual({ kind: "home" }); });
});
