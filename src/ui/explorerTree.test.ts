import { describe, expect, it } from "vitest";
import type { Location, MapInfo, PageEntry } from "@/core/types";
import { buildExplorerTree, filterExplorerTree, firstPage, groupBy } from "./explorerTree";

const page = (location: Location, title: string, hasDialogue = true): PageEntry =>
  ({ location, title, path: title, nodes: [], conditions: [], hasDialogue });
const mp = (mapId: number, eventId: number, p: number, title: string, d = true) =>
  page({ source: "map", mapId, eventId, page: p }, title, d);

const infos: (MapInfo | null)[] = [
  null,
  { id: 1, name: "마을", parentId: 0, order: 2 },
  { id: 2, name: "촌장의 집", parentId: 1, order: 3 },
  { id: 3, name: "숲", parentId: 0, order: 1 },
  { id: 4, name: "빈 맵", parentId: 0, order: 4 },
];
const pages: PageEntry[] = [
  mp(2, 1, 0, "촌장"), mp(2, 1, 1, "촌장"),
  mp(2, 2, 0, "상자", false),
  mp(3, 1, 0, "나무꾼"),
  page({ source: "common", commonEventId: 1 }, "공통 대사"),
  page({ source: "common", commonEventId: 2 }, "빈 공통", false),
  page({ source: "troop", troopId: 1, page: 0 }, "슬라임"),
];

describe("explorerTree", () => {
  it("groups pages by event", () => {
    const g = groupBy(pages, (l) => (l.source === "map" ? `${l.mapId}:${l.eventId}` : null));
    expect(g.map((x) => [x.key, x.pages.length])).toEqual([["2:1", 2], ["2:2", 1], ["3:1", 1]]);
  });
  it("first page of an event", () => {
    expect(firstPage({ source: "map", mapId: 1, eventId: 2, page: 3 })).toEqual({ source: "map", mapId: 1, eventId: 2, page: 0 });
    expect(firstPage({ source: "common", commonEventId: 4 })).toEqual({ source: "common", commonEventId: 4 });
  });
  it("flattens maps in tree order with parents, hiding empty events", () => {
    const t = buildExplorerTree(pages, infos, [], false);
    expect(t.maps.map((m) => [m.info.name, m.parents, m.events.map((e) => e.title)])).toEqual([
      ["숲", [], ["나무꾼"]],
      ["촌장의 집", ["마을"], ["촌장"]],
    ]);
    expect(t.common.map((e) => e.title)).toEqual(["공통 대사"]);
    expect(t.troops.map((e) => e.title)).toEqual(["슬라임"]);
  });
  it("shows empty events and maps with errors", () => {
    const t = buildExplorerTree(pages, infos, [{ file: "Map004.json", message: "깨짐", mapId: 4 }], true);
    expect(t.maps.map((m) => m.info.name)).toEqual(["숲", "촌장의 집", "빈 맵"]);
    expect(t.maps[1].events.map((e) => e.title)).toEqual(["촌장", "상자"]);
    expect(t.maps[2].errors).toEqual(["Map004.json: 깨짐"]);
    expect(t.common).toHaveLength(2);
  });
  it("survives parent cycles", () => {
    const cyc: MapInfo[] = [{ id: 1, name: "A", parentId: 2, order: 1 }, { id: 2, name: "B", parentId: 1, order: 2 }];
    expect(buildExplorerTree([mp(1, 1, 0, "x")], [null, ...cyc], [], false).maps).toEqual([]);
  });
  it("filters by event or page title, keeping whole map on map-name match", () => {
    const t = buildExplorerTree(pages, infos, [], true);
    const byEvent = filterExplorerTree(t, " 상자 ");
    expect(byEvent.maps.map((m) => [m.info.name, m.events.map((e) => e.title)])).toEqual([["촌장의 집", ["상자"]]]);
    expect(byEvent.common).toEqual([]);
    expect(filterExplorerTree(t, "촌장의").maps[0].events).toHaveLength(2);
    expect(filterExplorerTree(t, "공통").common.map((e) => e.title)).toEqual(["공통 대사", "빈 공통"]);
    expect(filterExplorerTree(t, "")).toBe(t);
  });
});
