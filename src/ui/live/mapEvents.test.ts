import { describe, expect, it } from "vitest";
import type { ChecklistEvent } from "@/core/live/mapChecklist";
import { livePositions, withLivePositions } from "@/core/live/positions";
import { routeTo, standTiles } from "@/core/map/route";
import type { MapTiles, TilesetInfo } from "@/core/map/tiles";
import type { EventPage, MapData } from "@/core/types";
import { blockersFor, currentEvents, mapMarkers, mapNumbers, pagesKey, spriteEffect, staticKey, targetOf } from "./mapEvents";

const page = (o: Partial<EventPage> = {}): EventPage => ({ conditions: {} as EventPage["conditions"], trigger: 0, list: [], ...o });
const map: MapData = {
  displayName: "", width: 5, height: 5,
  events: [
    null,
    { id: 1, name: "a", x: 1, y: 1, pages: [page({ priorityType: 1 }), page({ priorityType: 0 })] },
    { id: 2, name: "b", x: 2, y: 2, pages: [page({ priorityType: 1, through: true })] },
    { id: 3, name: "c", x: 3, y: 3, pages: [page({ priorityType: 1, trigger: 2 })] },
  ],
};

describe("mapEvents", () => {
  it("currentEvents keeps events with an active page", () => {
    const evs = currentEvents(map, [{ eventId: 1, page: 1 }, { eventId: 2, page: 0 }, { eventId: 3, page: -1 }, { eventId: 9, page: 0 }]);
    expect(evs.map((e) => [e.id, e.page.priorityType])).toEqual([[1, 0], [2, 1]]);
    expect(currentEvents(undefined, [{ eventId: 1, page: 0 }])).toEqual([]);
  });
  it("blockersFor: same-as-characters, not through, not the target", () => {
    const evs = currentEvents(map, [{ eventId: 1, page: 0 }, { eventId: 2, page: 0 }, { eventId: 3, page: 0 }]);
    expect([...blockersFor(evs, 3)]).toEqual(["1,1"]);
    expect([...blockersFor(evs, 1)]).toEqual(["3,3"]);
  });
  it("pagesKey", () => {
    expect(pagesKey([{ eventId: 1, page: 0 }, { eventId: 2, page: -1 }])).toBe("1:0,2:-1");
    expect(pagesKey([{ eventId: 1, page: 0, x: 4, y: 2, d: 6 }])).toBe("1:0@4,2,6");
  });
  it("currentEvents uses live positions; moving or moved events are mobile", () => {
    const m: MapData = { ...map, events: [...map.events, { id: 4, name: "npc", x: 4, y: 4, pages: [page({ moveType: 1 })] }] };
    const evs = currentEvents(m, [{ eventId: 1, page: 0, x: 0, y: 2, d: 4 }, { eventId: 2, page: 0, x: 2, y: 2 }, { eventId: 3, page: 0 }, { eventId: 4, page: 0 }]);
    expect(evs.map((e) => [e.id, e.x, e.y, e.d, e.mobile])).toEqual([[1, 0, 2, 4, true], [2, 2, 2, undefined, false], [3, 3, 3, undefined, false], [4, 4, 4, undefined, true]]);
    // 움직이는 이벤트의 위치는 바탕 그림 키에 들어가지 않는다
    const moved = currentEvents(m, [{ eventId: 1, page: 0, x: 1, y: 2 }, { eventId: 2, page: 0, x: 2, y: 2 }, { eventId: 3, page: 0 }, { eventId: 4, page: 0, x: 3, y: 4 }]);
    expect(staticKey(moved)).toBe(staticKey(evs));
    expect([...blockersFor(moved, 3)]).toEqual(["1,2", "3,4"]);
  });
  it("routing targets and blockers follow live positions", () => {
    const tiles: MapTiles = { mapId: 1, width: 5, height: 5, tilesetId: 1, data: new Array(5 * 5 * 6).fill(0) };
    const tileset: TilesetInfo = { id: 1, mode: 1, names: [], flags: [0] };
    const listed = [{ eventId: 3, x: 3, y: 3, activePage: 0, locked: [] } as unknown as ChecklistEvent];
    const [moved] = withLivePositions(listed, livePositions([{ eventId: 3, page: 0, x: 0, y: 4, d: 2 }, { eventId: 9, page: 0 }]));
    expect(targetOf(map, moved)).toMatchObject({ x: 0, y: 4 });
    const route = routeTo(tiles, tileset, { x: 0, y: 0 }, standTiles(targetOf(map, moved), tiles, tileset), new Set());
    expect(route?.stand).toMatchObject({ x: 0, y: 3, face: 2 });
  });

  it("targetOf uses the active page, else the first locked page", () => {
    const ev = { eventId: 3, x: 3, y: 3, activePage: 0, locked: [] } as unknown as ChecklistEvent;
    expect(targetOf(map, ev)).toEqual({ x: 3, y: 3, priorityType: 1, trigger: 2, through: false });
    const locked = { eventId: 1, x: 1, y: 1, activePage: -1, locked: [{ page: 1 }] } as unknown as ChecklistEvent;
    expect(targetOf(map, locked).priorityType).toBe(0);
  });
});

describe("mapMarkers", () => {
  const e = (eventId: number, section: ChecklistEvent["section"], story = false, number?: number) => ({ eventId, section, story, number }) as ChecklistEvent;
  const listed = [e(1, "now", false, 1), e(2, "item"), e(3, "repeat"), e(4, "talk"), e(5, "locked"), e(6, "locked", true, 9), e(7, "done", false, 3), e(8, "exit", false, 4)];
  it("draws everything but story; locked only when asked", () => {
    expect(mapMarkers(listed, false).map((x) => x.eventId)).toEqual([1, 2, 3, 4, 7, 8]);
    expect(mapMarkers(listed, true).map((x) => x.eventId)).toEqual([1, 2, 3, 4, 5, 7, 8]);
  });
  it("mapNumbers uses the fixed numbers from core, never for story", () => {
    expect([...mapNumbers(listed)]).toEqual([[1, 1], [7, 3], [8, 4]]);
  });
});

describe("spriteEffect", () => {
  const route = (...list: [number, number][]) => ({ list: [...list.map(([code, v]) => ({ code, indent: 0, parameters: [v] })), { code: 0, indent: 0, parameters: [] }] });
  const cmd = (code: number, parameters: unknown[]) => ({ code, indent: 0, parameters });
  it("defaults", () => expect(spriteEffect(page(), 1)).toEqual({ opacity: 255, blendMode: 0 }));
  it("reads the page move route", () => {
    expect(spriteEffect(page({ moveRoute: route([42, 128], [43, 1]) }), 1)).toEqual({ opacity: 128, blendMode: 1 });
  });
  it("reads set-move-route on this event, later wins; ignores the player and other events", () => {
    const list = [
      cmd(205, [0, route([43, 3])]),
      cmd(205, [-1, route([42, 10])]),
      cmd(205, [2, route([42, 20])]),
      cmd(205, [1, route([42, 200], [43, 2])]),
    ];
    expect(spriteEffect(page({ moveRoute: route([43, 1]), list }), 1)).toEqual({ opacity: 200, blendMode: 2 });
    expect(spriteEffect(page({ list: [cmd(205, [0, route([43, 3])])] }), 1)).toEqual({ opacity: 255, blendMode: 3 });
  });
});
