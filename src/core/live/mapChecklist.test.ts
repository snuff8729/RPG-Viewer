import { describe, expect, it } from "vitest";
import { howTo } from "../deps/howTo";
import { buildIndex } from "../index/buildIndex";
import type { EventCommand, EventPage, GameData, Location, MapData, MapEvent, PageConditions } from "../types";
import { locationKey } from "../index/locations";
import { computeCoverage, seenKey } from "./coverage";
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
const IMG = { tileId: 0, characterName: "People1", characterIndex: 0, direction: 2, pattern: 1 };
const page = (list: EventCommand[], cond: Partial<PageConditions> = {}, trigger = 0, image = true): EventPage =>
  ({ conditions: { ...noCond, ...cond }, trigger, list: [...list, c(0)], ...(image ? { image: IMG } : {}) });
const ev = (id: number, name: string, pages: EventPage[]): MapEvent => ({ id, name, x: id, y: id + 1, pages });
const sw1 = (id: number): Partial<PageConditions> => ({ switch1Valid: true, switch1Id: id });
const selfA: Partial<PageConditions> = { selfSwitchValid: true };

const town: MapData = {
  displayName: "", width: 20, height: 15,
  events: [
    null,
    ev(1, "상인", [page(MSG)]),                                             // now
    ev(2, "아이", [page([...MSG, c(123, ["A", 0])]), page(MSG, selfA)]),     // repeat
    ev(3, "문지기", [page(MSG), page(MSG, sw1(2))]),                         // talk + 잠긴 내용
    ev(4, "표지판", [page(MSG)]),                                            // talk(다 봄)
    ev(5, "스위치", [page([c(121, [9, 9, 0])])]),                            // talk(볼거리는 없지만 지금 누를 수 있음)
    ev(6, "연출", [page(MSG, {}, 3)]),                                       // 자동 실행 → 이야기 진행 조건
    ev(7, "그림", [page([c(231, [1, "pic", 0, 0, 0, 0, 100, 100, 255, 0])])]), // talk
    ev(8, "상자", [page([
      c(126, [1, 0, 0, 2]), c(125, [0, 0, 50]), c(127, [1, 0, 1, 3]), c(126, [1, 1, 0, 1]), c(123, ["A", 0]),
    ]), page([], selfA)]),                                                   // item(주우면 빈 페이지)
    ev(9, "조사", [page([c(356, ["TMng Search 종이 상자."])], {}, 0, false)]), // talk(플러그인 조사 지점)
    ev(10, "트리거", [page(MSG, sw1(5), 3)]),                                // 이야기 진행 조건(자동 실행 페이지)
    ev(11, "문", [page(MSG, sw1(2))]),                                       // locked
    ev(12, "빈칸", [page([])]),                                              // 명령·볼거리 없음 → 빠짐
    ev(13, "숨은 말", [page(MSG, sw1(2), 0, false)]),                        // 그래픽 없음 → 이야기 진행 조건
    ev(14, "긴 조사", [page([c(357, ["Plugin", "cmd", "", { text: "가".repeat(70) }])])]), // talk(긴 플러그인 글)
  ],
};
const forest: MapData = { displayName: "", width: 10, height: 10, events: [null, ev(1, "노인", [page([c(121, [2, 2, 0])])])] };

const data: GameData = {
  engine: "MZ", dataRoot: "data", imgRoot: "img",
  system: { gameTitle: "", currencyUnit: "G", switches: ["", "", "문 열림"], variables: [] },
  mapInfos: [null, { id: 1, name: "마을", parentId: 0, order: 1 }, { id: 2, name: "숲", parentId: 0, order: 2 }],
  maps: new Map([[1, town], [2, forest]]),
  commonEvents: [null], troops: [null], actors: [null],
  items: [null, { id: 1, name: "포션" }], weapons: [null, { id: 1, name: "검" }], armors: [null], errors: [],
};
const index = buildIndex(data);
const at = (eventId: number, pg: number): Location => ({ source: "map", mapId: 1, eventId, page: pg });
/** touched: 실행된 페이지(기본: 본 페이지 + 플러그인 조사 지점 9·14 — 이미 해 봄) */
const coverage = (seen: Location[], touched: Location[] = [...seen, at(9, 0), at(14, 0)]): Coverage => ({
  seen: new Set(seen.map(l => seenKey(l, 0))), picks: new Map(), uncertainSeqs: new Set(), changedSeqs: new Set(),
  touched: new Set(touched.map(locationKey)), pluginRan: new Set(),
});
const cov = coverage([at(2, 0), at(2, 1), at(3, 0), at(4, 0)]);
const live = (over: Partial<LiveSnapshot> = {}): LiveSnapshot => ({
  v: 1, t: 0, pluginVersion: "", run: 1, branch: 1, seq: 0, mapId: 1, x: 3, y: 4, running: null,
  events: [], switches: [], variables: {}, selfSwitches: [], items: {}, weapons: {}, armors: {},
  gold: 0, party: [], choice: null, inBattle: false, ...over,
});

describe("mapChecklist", () => {
  it("header and sections: by what you can do now", () => {
    const m = mapChecklist(data, index, cov, live())!;
    expect(m).toMatchObject({ mapId: 1, mapName: "마을", width: 20, height: 15, player: { x: 3, y: 4 } });
    expect(m.events.map(e => [e.eventId, e.section, e.story])).toEqual([
      [1, "now", false], [8, "item", false], [2, "repeat", false],
      [3, "talk", false], [4, "talk", false], [5, "talk", false], [7, "talk", false], [9, "talk", false], [14, "talk", false],
      [11, "locked", false],
      [6, "locked", true], [10, "locked", true], [13, "locked", true],
    ]);
    const merchant = m.events[0];
    expect(merchant).toMatchObject({ name: "상인", title: "상인", x: 1, y: 2, activePage: 0, unseen: 1, unpicked: 0, location: at(1, 0), interactable: true });
    expect(m.events.find(e => e.eventId === 2)!.repeat.map(r => r.kind)).toEqual(["nextPage"]);
    expect(m.events.find(e => e.eventId === 6)).toMatchObject({ auto: true, interactable: false, unseen: 1 });
  });

  it("remaining counts now, item, repeat and non-story locked", () => {
    expect(mapChecklist(data, index, cov, live())!.remaining).toBe(4);
  });

  it("item: lists what the current page gains (increase only)", () => {
    const chest = mapChecklist(data, index, cov, live())!.events.find(e => e.eventId === 8)!;
    expect(chest.gains).toEqual(["아이템 [포션] ×2", "골드 +50", "무기 [검] ×(변수 [#3])"]);
    // 주운 뒤 빈 페이지가 되면 할 것도 볼 것도 없다
    const after = mapChecklist(data, index, cov, live({ selfSwitches: ["1,8,A"] }))!;
    expect(after.events.find(e => e.eventId === 8)).toBeUndefined();
  });

  it("talk: interactable now, with a plugin hint when the page uses plugin commands", () => {
    const m = mapChecklist(data, index, cov, live())!;
    const spot = m.events.find(e => e.eventId === 9)!;
    expect([spot.section, spot.interactable, spot.pluginHint, spot.gains]).toEqual(["talk", true, "종이 상자.", []]);
    expect(m.events.find(e => e.eventId === 14)!.pluginHint).toBe(`${"가".repeat(60)}…`);
    expect(m.events.find(e => e.eventId === 4)!.pluginHint).toBeUndefined();
    expect(m.events.find(e => e.eventId === 12)).toBeUndefined();
  });

  it("plugin hint: only text-like commands, and the per-command override wins", () => {
    const hidden = mapChecklist(data, index, cov, live(), null, { TMng: "hide" })!;
    expect(hidden.events.find(e => e.eventId === 9)!.pluginHint).toBeUndefined();
    expect(hidden.events.find(e => e.eventId === 14)!.pluginHint).toBe(`${"가".repeat(60)}…`);
    const off = mapChecklist(data, index, cov, live(), null, { "Plugin/cmd": "hide" })!;
    expect(off.events.find(e => e.eventId === 14)!.pluginHint).toBeUndefined();
  });

  it("untried: a plugin examine spot never run is in now until a record touches its page", () => {
    const fresh = coverage([at(2, 0), at(2, 1), at(3, 0), at(4, 0)], [at(2, 0), at(2, 1), at(3, 0), at(4, 0)]);
    const m = mapChecklist(data, index, fresh, live())!;
    const spot = m.events.find(e => e.eventId === 9)!;
    expect([spot.section, spot.untried, spot.pluginHint]).toEqual(["now", true, "종이 상자."]);
    expect(m.events.find(e => e.eventId === 14)).toMatchObject({ section: "now", untried: true });
    // 플러그인 명령이 없는 페이지(스위치만·그림만)는 기록 여부와 상관없이 그대로
    expect(m.events.find(e => e.eventId === 5)).toMatchObject({ section: "talk" });
    expect(m.events.find(e => e.eventId === 5)!.untried).toBeUndefined();
    expect(m.events.filter(e => e.section === "now").map(e => e.eventId)).toEqual([1, 9, 14]);
    expect(m.remaining).toBe(6);
    // 해 본 뒤(플러그인 기록이 그 페이지를 가리킴) → talk
    const rec = { v: 1, seq: 1, t: 0, run: 1, branch: 1, type: "plugin", src: at(9, 0), cmd: 0, code: 356, text: "TMng Search 종이 상자." } as const;
    const ran = computeCoverage([rec], data);
    expect(ran.touched.has("map:1:9:0")).toBe(true);
    const after = mapChecklist(data, index, { ...fresh, touched: ran.touched }, live())!;
    const spot2 = after.events.find(e => e.eventId === 9)!;
    expect([spot2.section, spot2.untried]).toEqual(["talk", undefined]);
    expect(after.remaining).toBe(5);
  });

  it("untried is not decided without a touched set (older coverage)", () => {
    const old = { ...coverage([at(2, 0)]), touched: undefined } as unknown as Coverage;
    expect(mapChecklist(data, index, old, live())!.events.find(e => e.eventId === 9)!.section).toBe("talk");
  });

  it("interactable events keep their locked pages", () => {
    const guard = mapChecklist(data, index, cov, live())!.events.find(e => e.eventId === 3)!;
    expect([guard.section, guard.locked.map(l => l.page)]).toEqual(["talk", [1]]);
  });

  it("story: autorun/parallel locked pages or no graphic", () => {
    const m = mapChecklist(data, index, cov, live())!;
    expect(m.events.filter(e => e.story).map(e => e.eventId)).toEqual([6, 10, 13]);
    // 같은 조건이 풀리면 그래픽 없는 이벤트도 지금 할 수 있는 것
    const on = mapChecklist(data, index, cov, live({ switches: [2] }))!;
    expect(on.events.find(e => e.eventId === 13)).toMatchObject({ section: "now", story: false });
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
    expect([kid.section, kid.activePage, kid.repeat]).toEqual(["talk", 1, []]);
  });

  it("no active page → no location, locked (not story when it has a graphic and a normal trigger)", () => {
    const m = mapChecklist(data, index, cov, live({ events: [{ eventId: 1, page: -1 }] }))!;
    const merchant = m.events.find(e => e.eventId === 1)!;
    expect([merchant.activePage, merchant.location, merchant.section, merchant.story, merchant.interactable, merchant.locked.map(l => l.page)])
      .toEqual([-1, null, "locked", false, false, [0]]);
  });

  it("met page shadowed by a later active page is marked shadowed", () => {
    // 문지기 p1(조건 없음)은 안 봤고 p2가 활성. 조건은 다 됐지만 가려진 것.
    const m = mapChecklist(data, index, coverage([at(2, 0), at(2, 1), at(3, 1), at(4, 0)]), live({ switches: [2] }))!;
    const guard = m.events.find(e => e.eventId === 3)!;
    expect(guard.activePage).toBe(1);
    expect(guard.section).toBe("talk");
    expect(guard.locked).toEqual([{ page: 0, location: at(3, 0), unseen: 1, unpicked: 0, conditions: [], shadowed: true }]);
    // now: 상인·문·숨은 말, item: 상자, repeat: 아이
    expect(m.remaining).toBe(5);
    // 조건이 안 된 잠긴 페이지는 shadowed가 아니다
    const locked = mapChecklist(data, index, cov, live())!.events.find(e => e.eventId === 3)!.locked[0];
    expect(locked.shadowed).toBeUndefined();
  });

  it("null when not connected or the map is not loaded; never throws", () => {
    expect(mapChecklist(data, index, cov, null as unknown as LiveSnapshot)).toBeNull();
    expect(mapChecklist(data, index, cov, live({ mapId: 99 }))).toBeNull();
    expect(mapChecklist(null as unknown as GameData, index, cov, live())).toBeNull();
    expect(() => mapChecklist(data, null as unknown as typeof index, cov, live())).not.toThrow();
  });
});
