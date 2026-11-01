import { describe, it, expect } from "vitest";
import { parseRoute, formatRoute, MANAGE_SECTIONS } from "./route";

describe("route", () => {
  it.each(["#/play", "#/play/map", "#/play/assist", "#/play/cheat", "#/play/read", "#/read", "#/read/history", "#/browse/events", "#/browse/missing", "#/manage", "#/more", ...MANAGE_SECTIONS.map(s => `#/manage/${s}`)])("round-trips %s", hash => {
    expect(formatRoute(parseRoute(hash))).toBe(hash);
    expect(parseRoute(`${hash}/`)).toEqual(parseRoute(hash));
  });
  it.each([
    ["#/here", "#/play/map"], ["#/history", "#/read/history"], ["#/read/story", "#/read"],
    ["#/play/read/story", "#/read"], ["#/play/read/history", "#/read/history"],
    ["#/missing", "#/browse/missing"], ["#/diagnose", "#/manage/diagnose"],
  ])("redirects legacy %s to %s", (old, canonical) => {
    expect(formatRoute(parseRoute(old))).toBe(canonical);
    expect(formatRoute(parseRoute(`${old}/`))).toBe(canonical);
  });
  it("preserves the all-records mode", () => expect(parseRoute("#/history")).toEqual({ kind: "read", mode: "history" }));
  it("reads as its own page", () => expect(parseRoute("#/read")).toEqual({ kind: "read" }));
  it("keeps existing event URLs", () => {
    expect(parseRoute("#/map/12/event/3/page/2")).toEqual({ kind: "page", location: { source: "map", mapId: 12, eventId: 3, page: 1 } });
    expect(parseRoute("#/common/5")).toEqual({ kind: "page", location: { source: "common", commonEventId: 5 } });
    for (const hash of ["#/map/12/event/3/page/2", "#/common/5", "#/troop/2/page/1"]) expect(formatRoute(parseRoute(hash))).toBe(hash);
  });
  it.each(["", "#", "#/", "#/nonsense", "#/history/1", "#/here/1", "#/manage/nope", "#/play/read/nope", "#/read/nope", "#/play/cheat/history", "#/map/1/event/2/page/0", "#/common/x"])("lands on play for %s", hash => expect(parseRoute(hash)).toEqual({ kind: "play" }));
});
