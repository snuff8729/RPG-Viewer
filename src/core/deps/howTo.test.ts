import { describe, expect, it } from "vitest";
import type { LiveSnapshot } from "../live/types";
import type { CommonEvent, EventCommand, EventPage, GameData, MapData, MapEvent, PageConditions, Troop } from "../types";
import { buildDepGraph, type Req } from "./graph";
import { howTo } from "./howTo";

// ---- 합성 데이터 도우미 ----
const c = (code: number, parameters: any[] = [], indent = 0): EventCommand => ({ code, indent, parameters });
const noCond: PageConditions = {
  switch1Valid: false, switch1Id: 1, switch2Valid: false, switch2Id: 1,
  variableValid: false, variableId: 1, variableValue: 0,
  selfSwitchValid: false, selfSwitchCh: "A",
  itemValid: false, itemId: 1, actorValid: false, actorId: 1,
};
const page = (list: EventCommand[], cond: Partial<PageConditions> = {}, trigger = 0): EventPage =>
  ({ conditions: { ...noCond, ...cond }, trigger, list: [...list, c(0)] });
const ev = (id: number, pages: EventPage[], name = `E${id}`): MapEvent => ({ id, name, x: id, y: 0, pages });
const map = (events: MapEvent[]): MapData => ({ displayName: "", width: 10, height: 10, events: [null, ...events] });
const ce = (id: number, list: EventCommand[], trigger = 0, switchId = 0): CommonEvent =>
  ({ id, name: `공통${id}`, trigger, switchId, list: [...list, c(0)] });
const swOn = (id: number, indent = 0) => c(121, [id, id, 0], indent);
const sw1 = (id: number): Partial<PageConditions> => ({ switch1Valid: true, switch1Id: id });

function game(maps: [number, MapData][], commonEvents: CommonEvent[] = [], troops: Troop[] = []): GameData {
  return {
    engine: "MZ", dataRoot: "data", imgRoot: "img",
    system: { gameTitle: "", currencyUnit: "G", switches: ["", "S1", "S2", "S3", "S4", "S5"], variables: ["", "호감도"] },
    mapInfos: [null, { id: 1, name: "마을", parentId: 0, order: 1 }, { id: 2, name: "숲", parentId: 0, order: 2 }],
    maps: new Map(maps),
    commonEvents: [null, ...commonEvents], troops: [null, ...troops],
    actors: [null], items: [null, { id: 1, name: "열쇠" }], weapons: [null], armors: [null], errors: [],
  };
}
const live = (over: Partial<LiveSnapshot> = {}): LiveSnapshot => ({
  v: 1, t: 0, pluginVersion: "", run: 1, branch: 1, seq: 0, mapId: 1, x: 0, y: 0, running: null,
  events: [], switches: [], variables: {}, selfSwitches: [], items: {}, weapons: {}, armors: {},
  gold: 0, party: [], choice: null, inBattle: false, ...over,
});
const swReq = (id: number): Req => ({ atom: { kind: "switch", id }, test: { kind: "switch", id, on: true } });

describe("howTo", () => {
  it("already met → done with no steps", () => {
    const data = game([[1, map([])]]);
    expect(howTo(swReq(1), data, live({ switches: [1] }))).toEqual({ steps: [], end: { kind: "done" } });
  });

  it("linear chain across another map: step 1 is what to do first", () => {
    const data = game([
      [1, map([ev(1, [page([c(101)])], "문지기")])],
      [2, map([ev(1, [page([swOn(1)])], "노인"), ev(2, [page([swOn(2)], sw1(1))], "사냥꾼")])],
    ]);
    const r = howTo(swReq(2), data, live());
    expect(r.end).toEqual({ kind: "done" });
    expect(r.steps.map(s => [s.where, s.action, s.availableNow])).toEqual([
      ["숲 › 노인 › p1", "스위치 [S1] 켜기", true],
      ["숲 › 사냥꾼 › p1", "스위치 [S2] 켜기", false],
    ]);
    expect(r.steps[0].location).toEqual({ source: "map", mapId: 2, eventId: 1, page: 0 });
  });

  it("fork: auto-picks the only writer available now", () => {
    const data = game([[2, map([
      ev(1, [page([swOn(5)], sw1(1))]), ev(2, [page([swOn(5)])]), ev(3, [page([swOn(5)], sw1(2))]),
    ])]]);
    const r = howTo(swReq(5), data, live());
    expect(r.end).toEqual({ kind: "done" });
    expect(r.steps).toHaveLength(1);
    expect(r.steps[0].where).toBe("숲 › E2 › p1");
    expect(r.steps[0].availableNow).toBe(true);
  });

  it("fork with none available: candidates sorted by level, capped at 5", () => {
    const events = [
      ev(1, [page([swOn(1)], sw1(4))]),          // S4: 쓰는 곳 없음 → 레벨 ∞
      ev(2, [page([swOn(5)], sw1(1))]),          // S1 필요 → 레벨 2
      ev(3, [page([swOn(5)], sw1(2))]),          // S2 필요 → 레벨 1
      ev(4, [page([swOn(2)], { selfSwitchValid: true })]),  // 셀프 스위치 A 쓰는 곳 없음
      ev(5, [page([swOn(2)])]),                  // S2는 바로 켤 수 있음 → S2 레벨 1
    ];
    const data = game([[2, map(events)]]);
    const r = howTo(swReq(5), data, live({ switches: [] }));
    // E5가 S2를 지금 켤 수 있지만 S5 쓰는 곳(E2·E3)은 둘 다 지금은 못 함 → 갈림길
    expect(r.end.kind).toBe("fork");
    if (r.end.kind !== "fork") return;
    expect(r.end.candidates.map(s => s.where)).toEqual(["숲 › E3 › p1", "숲 › E2 › p1"]);
    expect(r.end.more).toBe(0);
    expect(r.end.req.atom).toEqual({ kind: "switch", id: 5 });   // 깊은 갈림길도 그 지점의 요구를 알려 준다

    const many = game([[2, map(Array.from({ length: 7 }, (_, i) => ev(i + 1, [page([swOn(5)], sw1(1))])))]]);
    const m = howTo(swReq(5), many, live());
    expect(m.end.kind === "fork" && [m.end.candidates.length, m.end.more]).toEqual([5, 2]);
  });

  it("fork candidate expands via opts.from", () => {
    const data = game([[2, map([
      ev(1, [page([swOn(1)])]), ev(2, [page([swOn(5)], sw1(1))]), ev(3, [page([swOn(5)], sw1(2))]),
    ])]]);
    const fork = howTo(swReq(5), data, live({ mapId: 1 }));
    // E2·E3 둘 다 지금은 못 함 → 갈림길
    expect(fork.end.kind).toBe("fork");
    const from = buildDepGraph(data).writersOf({ kind: "switch", id: 5 }).find(w => w.ctx === "M2:2:0")!;
    const r = howTo(swReq(5), data, live({ mapId: 1 }), { from });
    expect(r.end).toEqual({ kind: "done" });
    expect(r.steps.map(s => s.where)).toEqual(["숲 › E1 › p1", "숲 › E2 › p1"]);
  });

  it("opaque ends: no writer, script-only, off-only", () => {
    const data = game([[2, map([
      ev(1, [page([c(355, ["$gameSwitches.setValue(3, true)"])])]),
      ev(2, [page([c(121, [4, 4, 1])])]),
    ])]]);
    expect(howTo(swReq(1), data, live()).end).toEqual({ kind: "opaque", reason: "noWriter" });
    expect(howTo(swReq(3), data, live()).end).toEqual({ kind: "opaque", reason: "script" });
    expect(howTo(swReq(4), data, live()).end).toEqual({ kind: "opaque", reason: "noWriter" });
  });

  it("chain stops at an opaque requirement but keeps the steps found", () => {
    const data = game([[2, map([ev(1, [page([swOn(2)], sw1(1))])])]]);
    const r = howTo(swReq(2), data, live());
    expect(r.steps.map(s => s.action)).toEqual(["스위치 [S2] 켜기"]);
    expect(r.end).toEqual({ kind: "opaque", reason: "noWriter" });
  });

  it("cycle terminates", () => {
    const data = game([[2, map([ev(1, [page([swOn(1)], sw1(2))]), ev(2, [page([swOn(2)], sw1(1))])])]]);
    const r = howTo(swReq(1), data, live());
    expect(r.end).toEqual({ kind: "cycle" });
    expect(r.steps).toHaveLength(2);
  });

  it("depth limit on very long chains", () => {
    const events = Array.from({ length: 30 }, (_, i) => ev(i + 1, [page([swOn(i + 1)], i > 0 ? sw1(i) : {})]));
    const r = howTo(swReq(30), game([[2, map(events)]]), live());
    expect(r.end).toEqual({ kind: "depthLimit" });
    expect(r.steps).toHaveLength(20);
  });

  it("current map: writer page must be the live active page", () => {
    const data = game([[1, map([ev(1, [page([swOn(5)]), page([c(101)])])])]]);
    expect(howTo(swReq(5), data, live({ events: [{ eventId: 1, page: 0 }] })).steps[0].availableNow).toBe(true);
    expect(howTo(swReq(5), data, live({ events: [{ eventId: 1, page: 1 }] })).steps[0].availableNow).toBe(false);
    // live.events가 없으면 activePageIndex(조건 없는 마지막 페이지 = p2)
    expect(howTo(swReq(5), data, live()).steps[0].availableNow).toBe(false);
    const gated = game([[1, map([ev(1, [page([swOn(5)]), page([c(101)], sw1(3))])])]]);
    expect(howTo(swReq(5), gated, live()).steps[0].availableNow).toBe(true);
  });

  it("common event writer: available through a caller; where names the callers", () => {
    const data = game([[2, map([ev(1, [page([c(117, [1])])], "노인"), ev(2, [page([c(117, [1])], sw1(3))])])]],
      [ce(1, [swOn(5)])]);
    const r = howTo(swReq(5), data, live());
    expect(r.steps.map(s => [s.where, s.availableNow])).toEqual([["공통 이벤트 공통1 (호출: 숲 › 노인 › p1 외 1곳)", true]]);
  });

  it("common event with a single blocked caller follows the caller's requirements", () => {
    const data = game([[2, map([ev(1, [page([swOn(3)])]), ev(2, [page([c(117, [1])], sw1(3))], "노인")])]],
      [ce(1, [swOn(5)])]);
    const r = howTo(swReq(5), data, live());
    expect(r.steps.map(s => s.action)).toEqual(["스위치 [S3] 켜기", "스위치 [S5] 켜기"]);
    expect(r.steps[1].availableNow).toBe(false);
  });

  it("variable threshold needing several adds; choice label; troop; shop", () => {
    const data = game([[2, map([ev(1, [page([
      c(102, [["예", "아니오"], 1]), c(402, [0, "예"]), c(122, [1, 1, 1, 0, 1], 1), c(0, [], 1), c(404),
    ])])])]], [], [{ id: 1, name: "슬라임", pages: [{ conditions: { switchValid: false } as any, span: 0, list: [c(126, [1, 0, 0, 1]), c(0)] }] }]);
    const v: Req = { atom: { kind: "variable", id: 1 }, test: { kind: "variable", id: 1, op: ">=", value: 3 } };
    const r = howTo(v, data, live({ variables: { 1: 1 } }));
    expect(r.steps[0]).toMatchObject({ action: "변수 [호감도] += 1", choiceLabel: "예", repeatNeeded: true });
    expect(howTo(v, data, live({ variables: { 1: 2 } })).steps[0].repeatNeeded).toBe(false);

    const item: Req = { atom: { kind: "item", id: 1 }, test: { kind: "item", id: 1 } };
    expect(howTo(item, data, live()).steps.map(s => [s.where, s.action])).toEqual([["전투 슬라임", "아이템 [열쇠] 얻기"]]);

    const shop = game([[2, map([ev(1, [page([c(302, [0, 1, 0, 0, false])])])])]]);
    expect(howTo(item, shop, live()).steps[0].action).toBe("상점에서 [열쇠] 사기");
  });

  it("self switch requirement is evaluated for its own event", () => {
    const data = game([[2, map([ev(4, [page([c(123, ["A", 0])])])])]]);
    const req: Req = { atom: { kind: "selfSwitch", mapId: 2, eventId: 4, ch: "A" }, test: { kind: "selfSwitch", letter: "A", on: true } };
    expect(howTo(req, data, live({ selfSwitches: ["2,4,A"] })).end).toEqual({ kind: "done" });
    expect(howTo(req, data, live()).steps.map(s => s.action)).toEqual(["셀프 스위치 A 켜기"]);
  });

  it("never throws on garbage", () => {
    expect(() => howTo(null as unknown as Req, null as unknown as GameData, null as unknown as LiveSnapshot)).not.toThrow();
    expect(howTo(swReq(1), {} as GameData, live()).end.kind).toBe("opaque");
  });
});
