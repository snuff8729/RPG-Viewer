import { describe, expect, it } from "vitest";
import type { ChecklistEvent, MapChecklist } from "@/core/live/mapChecklist";
import type { MissingEventGroup, MissingGroup } from "@/core/live/missingGroups";
import { actionableItems, isActionable, nowItems, placesToGo } from "./sidebarItems";

const ev = (eventId: number, section: ChecklistEvent["section"], hasLoc = true): ChecklistEvent => ({
  eventId, name: `E${eventId}`, title: `T${eventId}`, x: 0, y: 0, section, activePage: 0,
  location: hasLoc ? { source: "map", mapId: 1, eventId, page: 0 } : null,
  auto: false, unseen: 0, unpicked: 0, remainingLines: [], laterLines: [], later: 0, repeat: [], locked: [], interactable: true, gains: [], story: false, describe: "", moves: false,
});
const checklist = (events: ChecklistEvent[]): MapChecklist =>
  ({ mapId: 1, mapName: "M", width: 1, height: 1, player: { x: 0, y: 0 }, events, remaining: events.length });

let n = 0;
const eg = (reachable: boolean): MissingEventGroup =>
  ({ key: String(n++), entry: {} as MissingEventGroup["entry"], active: true, items: [], choiceCount: 0, pageCount: 1, reachable });
const group = (mapId: number | undefined, kind: MissingGroup["kind"], current: boolean, events: MissingEventGroup[]): MissingGroup =>
  ({ key: `${kind}:${mapId}`, kind, mapId, name: `맵${mapId}`, current, events, choiceCount: 0, pageCount: 0, reachableEvents: 0 });

describe("nowItems", () => {
  it("takes now, item then repeat, only openable, up to limit", () => {
    const c = checklist([ev(1, "repeat"), ev(2, "now"), ev(3, "now", false), ev(4, "locked"), ev(5, "done"), ev(6, "now"), ev(7, "talk"), ev(8, "item")]);
    expect(nowItems(c).map((e) => e.eventId)).toEqual([2, 6, 8, 1]);
    expect(nowItems(c, 2).map((e) => e.eventId)).toEqual([2, 6]);
    expect(nowItems(null)).toEqual([]);
  });
  it("skips story/background events; exits only with unseen dialogue", () => {
    const hidden = { ...ev(1, "now"), story: true };
    const exitNew = { ...ev(2, "exit"), unseen: 2 };
    const c = checklist([hidden, exitNew, ev(3, "exit"), ev(4, "now")]);
    expect(nowItems(c).map((e) => e.eventId)).toEqual([4, 2]);
  });
});

describe("actionableItems", () => {
  it("keeps now/item/repeat and exits with something unseen, in that order, without a limit or location", () => {
    const exitNew = { ...ev(9, "exit"), unpicked: 1 };
    const evs = [ev(1, "repeat"), ev(2, "exit"), exitNew, ev(3, "talk"), ev(4, "now", false), ev(5, "locked"), ev(6, "item"), ev(7, "done"), ev(8, "now")];
    expect(actionableItems(evs).map((e) => e.eventId)).toEqual([4, 8, 6, 1, 9]);
  });
  it("drops story events", () => {
    const story = { ...ev(1, "now"), story: true };
    expect(isActionable(story)).toBe(false);
    expect(actionableItems([story, ev(2, "item")]).map((e) => e.eventId)).toEqual([2]);
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
