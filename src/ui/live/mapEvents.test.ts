import { describe, expect, it } from "vitest";
import type { ChecklistEvent } from "@/core/live/mapChecklist";
import type { EventPage, MapData } from "@/core/types";
import { blockersFor, currentEvents, mapMarkers, pagesKey, spriteEffect, targetOf } from "./mapEvents";

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
  it("pagesKey", () => expect(pagesKey([{ eventId: 1, page: 0 }, { eventId: 2, page: -1 }])).toBe("1:0,2:-1"));
  it("targetOf uses the active page, else the first locked page", () => {
    const ev = { eventId: 3, x: 3, y: 3, activePage: 0, locked: [] } as unknown as ChecklistEvent;
    expect(targetOf(map, ev)).toEqual({ x: 3, y: 3, priorityType: 1, trigger: 2, through: false });
    const locked = { eventId: 1, x: 1, y: 1, activePage: -1, locked: [{ page: 1 }] } as unknown as ChecklistEvent;
    expect(targetOf(map, locked).priorityType).toBe(0);
  });
});

describe("mapMarkers", () => {
  const e = (eventId: number, section: ChecklistEvent["section"], story = false) => ({ eventId, section, story }) as ChecklistEvent;
  const listed = [e(1, "now"), e(2, "item"), e(3, "repeat"), e(4, "talk"), e(5, "locked"), e(6, "locked", true), e(7, "done")];
  it("draws actionable ones; locked only when asked; never story or done", () => {
    expect(mapMarkers(listed, false).map((x) => x.eventId)).toEqual([1, 2, 3, 4]);
    expect(mapMarkers(listed, true).map((x) => x.eventId)).toEqual([1, 2, 3, 4, 5]);
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
