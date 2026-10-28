import { describe, expect, it } from "vitest";
import { howTo } from "../deps/howTo";
import { buildIndex } from "../index/buildIndex";
import type { EventCommand, EventPage, GameData, Location, MapData, MapEvent, PageConditions } from "../types";
import { seenKey } from "./coverage";
import { mapChecklist } from "./mapChecklist";
import type { Coverage, LiveSnapshot } from "./types";

const c = (code: number, parameters: any[] = [], indent = 0): EventCommand => ({ code, indent, parameters });
const noCond: PageConditions = {
  switch1Valid: false, switch1Id: 1, switch2Valid: false, switch2Id: 1,
  variableValid: false, variableId: 1, variableValue: 0,
  selfSwitchValid: false, selfSwitchCh: "A",
  itemValid: false, itemId: 1, actorValid: false, actorId: 1,
};
const MSG = [c(101, ["", 0, 0, 2]), c(401, ["안녕"])];
const page = (list: EventCommand[], cond: Partial<PageConditions> = {}, trigger = 0): EventPage =>
  ({ conditions: { ...noCond, ...cond }, trigger, list: [...list, c(0)] });
const ev = (id: number, name: string, pages: EventPage[]): MapEvent => ({ id, name, x: id, y: id + 1, pages });
const sw1 = (id: number): Partial<PageConditions> => ({ switch1Valid: true, switch1Id: id });

const town: MapData = {
  displayName: "", width: 20, height: 15,
  events: [
    null,
    ev(1, "상인", [page(MSG)]),                                                         // now
    ev(2, "아이", [page([...MSG, c(123, ["A", 0])]), page(MSG, { selfSwitchValid: true })]), // repeat
    ev(3, "문지기", [page(MSG), page(MSG, sw1(2))]),                                     // locked
    ev(4, "표지판", [page(MSG)]),                                                        // done
    ev(5, "스위치", [page([c(121, [9, 9, 0])])]),                                        // 볼거리 없음 → 빠짐
    ev(6, "연출", [page(MSG, {}, 3)]),                                                   // now + 자동
    ev(7, "그림", [page([c(231, [1, "pic", 0, 0, 0, 0, 100, 100, 255, 0])])]),           // done (그림만)
  ],
};
const forest: MapData = { displayName: "", width: 10, height: 10, events: [null, ev(1, "노인", [page([c(121, [2, 2, 0])])])] };

const data: GameData = {
  engine: "MZ", dataRoot: "data", imgRoot: "img",
  system: { gameTitle: "", currencyUnit: "G", switches: ["", "", "문 열림"], variables: [] },
  mapInfos: [null, { id: 1, name: "마을", parentId: 0, order: 1 }, { id: 2, name: "숲", parentId: 0, order: 2 }],
  maps: new Map([[1, town], [2, forest]]),
  commonEvents: [null], troops: [null], actors: [null], items: [null], weapons: [null], armors: [null], errors: [],
};
const index = buildIndex(data);
const at = (eventId: number, pg: number): Location => ({ source: "map", mapId: 1, eventId, page: pg });
const coverage = (seen: Location[]): Coverage => ({
  seen: new Set(seen.map(l => seenKey(l, 0))), picks: new Map(), uncertainSeqs: new Set(), changedSeqs: new Set(),
});
const cov = coverage([at(2, 0), at(2, 1), at(3, 0), at(4, 0)]);
const live = (over: Partial<LiveSnapshot> = {}): LiveSnapshot => ({
  v: 1, t: 0, pluginVersion: "", run: 1, branch: 1, seq: 0, mapId: 1, x: 3, y: 4, running: null,
  events: [], switches: [], variables: {}, selfSwitches: [], items: {}, weapons: {}, armors: {},
  gold: 0, party: [], choice: null, inBattle: false, ...over,
});

describe("mapChecklist", () => {
  it("header and sections", () => {
    const m = mapChecklist(data, index, cov, live())!;
    expect(m).toMatchObject({ mapId: 1, mapName: "마을", width: 20, height: 15, player: { x: 3, y: 4 }, remaining: 4 });
    expect(m.events.map(e => [e.eventId, e.section, e.auto])).toEqual([
      [1, "now", false], [6, "now", true], [2, "repeat", false], [3, "locked", false], [4, "done", false], [7, "done", false],
    ]);
    const merchant = m.events[0];
    expect(merchant).toMatchObject({ name: "상인", title: "상인", x: 1, y: 2, activePage: 0, unseen: 1, unpicked: 0, location: at(1, 0) });
    expect(m.events.find(e => e.eventId === 2)!.repeat.map(r => r.kind)).toEqual(["nextPage"]);
  });

  it("locked page lists conditions with met flags and a req usable by howTo", () => {
    const m = mapChecklist(data, index, cov, live())!;
    const guard = m.events.find(e => e.eventId === 3)!;
    expect(guard.locked).toEqual([{
      page: 1, location: at(3, 1), unseen: 1, unpicked: 0,
      conditions: [{ text: "스위치: 문 열림 ON", met: false, req: { atom: { kind: "switch", id: 2 }, test: { kind: "switch", id: 2, on: true } } }],
    }]);
    const path = howTo(guard.locked[0].conditions[0].req!, data, live());
    expect(path.steps.map(s => [s.where, s.action, s.availableNow])).toEqual([["숲 › 노인 › p1", "스위치 [문 열림] 켜기", true]]);
    expect(path.end).toEqual({ kind: "done" });
  });

  it("live.events decides the active page on the current map", () => {
    const m = mapChecklist(data, index, cov, live({ events: [{ eventId: 3, page: 1 }, { eventId: 2, page: 1 }] }))!;
    const guard = m.events.find(e => e.eventId === 3)!;
    expect([guard.section, guard.activePage, guard.unseen, guard.locked.length]).toEqual(["now", 1, 1, 0]);
    const kid = m.events.find(e => e.eventId === 2)!;
    expect([kid.section, kid.activePage, kid.repeat]).toEqual(["done", 1, []]);
  });

  it("no active page → no location, can still be locked", () => {
    const m = mapChecklist(data, index, cov, live({ events: [{ eventId: 1, page: -1 }] }))!;
    const merchant = m.events.find(e => e.eventId === 1)!;
    expect([merchant.activePage, merchant.location, merchant.section, merchant.locked.map(l => l.page)]).toEqual([-1, null, "locked", [0]]);
  });

  it("null when not connected or the map is not loaded; never throws", () => {
    expect(mapChecklist(data, index, cov, null as unknown as LiveSnapshot)).toBeNull();
    expect(mapChecklist(data, index, cov, live({ mapId: 99 }))).toBeNull();
    expect(mapChecklist(null as unknown as GameData, index, cov, live())).toBeNull();
    expect(() => mapChecklist(data, null as unknown as typeof index, cov, live())).not.toThrow();
  });
});
