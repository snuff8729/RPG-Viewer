import { describe, expect, it } from "vitest";
import type { ChecklistEvent } from "@/core/live/mapChecklist";
import type { EventPage, MapData } from "@/core/types";
import { blockersFor, currentEvents, pagesKey, targetOf } from "./mapEvents";

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
