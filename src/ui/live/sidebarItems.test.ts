import { describe, expect, it } from "vitest";
import type { ChecklistEvent, MapChecklist } from "@/core/live/mapChecklist";
import type { MissingEventGroup, MissingGroup } from "@/core/live/missingGroups";
import { nowItems, placesToGo } from "./sidebarItems";

const ev = (eventId: number, section: ChecklistEvent["section"], hasLoc = true): ChecklistEvent => ({
  eventId, name: `E${eventId}`, title: `T${eventId}`, x: 0, y: 0, section, activePage: 0,
  location: hasLoc ? { source: "map", mapId: 1, eventId, page: 0 } : null,
  auto: false, unseen: 0, unpicked: 0, repeat: [], locked: [],
});
const checklist = (events: ChecklistEvent[]): MapChecklist =>
  ({ mapId: 1, mapName: "M", width: 1, height: 1, player: { x: 0, y: 0 }, events, remaining: events.length });

let n = 0;
const eg = (reachable: boolean): MissingEventGroup =>
  ({ key: String(n++), entry: {} as MissingEventGroup["entry"], active: true, items: [], choiceCount: 0, pageCount: 1, reachable });
const group = (mapId: number | undefined, kind: MissingGroup["kind"], current: boolean, events: MissingEventGroup[]): MissingGroup =>
  ({ key: `${kind}:${mapId}`, kind, mapId, name: `맵${mapId}`, current, events, choiceCount: 0, pageCount: 0, reachableEvents: 0 });

describe("nowItems", () => {
  it("takes now then repeat, only openable, up to limit", () => {
    const c = checklist([ev(1, "repeat"), ev(2, "now"), ev(3, "now", false), ev(4, "locked"), ev(5, "done"), ev(6, "now")]);
    expect(nowItems(c).map((e) => e.eventId)).toEqual([2, 6, 1]);
    expect(nowItems(c, 2).map((e) => e.eventId)).toEqual([2, 6]);
    expect(nowItems(null)).toEqual([]);
  });
});

describe("placesToGo", () => {
  it("lists other maps with reachable events, counting only reachable ones", () => {
    const gs = [
      group(1, "map", true, [eg(true)]),
      group(2, "map", false, [eg(true), eg(false), eg(true)]),
      group(3, "map", false, [eg(false)]),
      group(4, "map", false, [eg(true)]),
      group(undefined, "common", false, [eg(true)]),
    ];
    expect(placesToGo(gs)).toEqual([{ mapId: 2, name: "맵2", count: 2 }, { mapId: 4, name: "맵4", count: 1 }]);
    expect(placesToGo(gs, 1)).toHaveLength(1);
  });
});
