import { describe, expect, it } from "vitest";
import type { CommonEvent, EventCommand, EventPage, GameData, MapData, MapEvent, PageConditions, Troop } from "../types";
import { atomKey, buildDepGraph, type Atom } from "./graph";

// ---- 합성 데이터 도우미 ----
const c = (code: number, parameters: any[] = [], indent = 0): EventCommand => ({ code, indent, parameters });
const END = c(0);
const noCond: PageConditions = {
  switch1Valid: false, switch1Id: 1, switch2Valid: false, switch2Id: 1,
  variableValid: false, variableId: 1, variableValue: 0,
  selfSwitchValid: false, selfSwitchCh: "A",
  itemValid: false, itemId: 1, actorValid: false, actorId: 1,
};
const page = (list: EventCommand[], cond: Partial<PageConditions> = {}, trigger = 0): EventPage =>
  ({ conditions: { ...noCond, ...cond }, trigger, list: [...list, END] });
const ev = (id: number, pages: EventPage[], x = 0, y = 0): MapEvent => ({ id, name: `E${id}`, x, y, pages });
const map = (events: (MapEvent | null)[]): MapData => ({ displayName: "", width: 10, height: 10, events: [null, ...events] });
const ce = (id: number, list: EventCommand[], trigger = 0, switchId = 0): CommonEvent =>
  ({ id, name: `C${id}`, trigger, switchId, list: [...list, END] });

function game(maps: [number, MapData][], commonEvents: CommonEvent[] = [], troops: Troop[] = [], extra: Partial<GameData> = {}): GameData {
  return {
    engine: "MZ", dataRoot: "data", imgRoot: "img",
    system: { gameTitle: "", currencyUnit: "G", switches: [], variables: [] },
    mapInfos: [null, ...maps.map(([id]) => ({ id, name: `M${id}`, parentId: 0, order: id }))],
    maps: new Map(maps),
    commonEvents: [null, ...commonEvents], troops: [null, ...troops],
    actors: [null], items: [null], weapons: [null], armors: [null], errors: [],
    ...extra,
  };
}

const sw = (id: number): Atom => ({ kind: "switch", id });
const vr = (id: number): Atom => ({ kind: "variable", id });
const msg = c(101, ["", 0, 0, 2, ""]);
const swOn = (id: number, indent = 0) => c(121, [id, id, 0], indent);

describe("atomKey", () => {
  it("is distinct per atom", () => {
    const keys = [sw(1), vr(1), { kind: "item", id: 1 } as Atom, { kind: "actor", id: 1 } as Atom,
      { kind: "selfSwitch", mapId: 1, eventId: 2, ch: "A" } as Atom, { kind: "selfSwitch", mapId: 1, eventId: 2, ch: "B" } as Atom].map(atomKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(atomKey(sw(3))).toBe(atomKey({ kind: "switch", id: 3 }));
  });
});

describe("buildDepGraph", () => {
  it("linear chain S1 → S2 → page", () => {
    const data = game([[1, map([
      ev(1, [page([swOn(1)])]),                              // 아무 조건 없이 S1 켜기
      ev(2, [page([swOn(2)], { switch1Valid: true, switch1Id: 1 })]),
      ev(3, [page([msg], { switch1Valid: true, switch1Id: 2 })]),
    ])]]);
    const g = buildDepGraph(data);
    expect(g.ctxs.size).toBe(3);
    const w1 = g.writersOf(sw(1));
    expect(w1).toHaveLength(1);
    expect(w1[0]).toMatchObject({ ctx: "M1:1:0", cmd: 0, write: { atom: sw(1), op: "on" }, reqs: [] });
    expect(g.writersOf(sw(2))[0].reqs).toEqual([{ atom: sw(1), test: { kind: "switch", id: 1, on: true } }]);
    expect(g.level(sw(1))).toBe(1);
    expect(g.level(sw(2))).toBe(2);
    expect(g.ctxLevel("M1:1:0")).toBe(0);
    expect(g.ctxLevel("M1:2:0")).toBe(1);
    expect(g.ctxLevel("M1:3:0")).toBe(2);
    const info = g.ctxs.get("M1:3:0")!;
    expect(info.location).toEqual({ source: "map", mapId: 1, eventId: 3, page: 0 });
    expect(info.trigger).toBe(0);
    expect(info.reqs).toEqual([{ atom: sw(2), test: { kind: "switch", id: 2, on: true } }]);
  });

  it("writer inside then-branch inherits the condition; else-branch adds none", () => {
    const data = game([[1, map([ev(1, [page([
      c(111, [1, 5, 0, 3, 1]),          // 변수 5 >= 3
      swOn(10, 1),
      c(411, [], 0),
      swOn(11, 1),
      c(412, [], 0),
      swOn(12, 0),
    ], { switch1Valid: true, switch1Id: 7 })])])]]);
    const g = buildDepGraph(data);
    const pageReq = { atom: sw(7), test: { kind: "switch", id: 7, on: true } };
    expect(g.writersOf(sw(10))[0].reqs).toEqual([pageReq, { atom: vr(5), test: { kind: "variable", id: 5, op: ">=", value: 3 } }]);
    expect(g.writersOf(sw(11))[0].reqs).toEqual([pageReq]);
    expect(g.writersOf(sw(12))[0].reqs).toEqual([pageReq]);
    expect(g.level(sw(10))).toBe(Infinity); // 변수 5·스위치 7을 바꾸는 곳 없음
  });

  it("initially-true tests need nothing", () => {
    const data = game([[1, map([ev(1, [page([
      c(111, [0, 3, 1]), swOn(20, 1), c(412, []),       // 스위치 3 OFF
      c(111, [1, 4, 0, 0, 0]), swOn(21, 1), c(412, []), // 변수 4 == 0
      c(111, [1, 4, 0, 1, 1]), swOn(22, 1), c(412, []), // 변수 4 >= 1
    ])])])]]);
    const g = buildDepGraph(data);
    expect(g.level(sw(20))).toBe(1);
    expect(g.level(sw(21))).toBe(1);
    expect(g.level(sw(22))).toBe(Infinity);
  });

  it("records the choice branch label", () => {
    const data = game([[1, map([ev(1, [page([
      c(102, [["예", "아니오"], 1, 0, 2, 0]),
      c(402, [0, "예"], 0),
      swOn(30, 1),
      c(402, [1, "아니오"], 0),
      c(122, [6, 6, 1, 0, 2], 1),
      c(404, [], 0),
      swOn(31, 0),
    ])])])]]);
    const g = buildDepGraph(data);
    expect(g.writersOf(sw(30))[0].choice).toEqual({ cmd: 0, branch: 0, label: "예" });
    const w = g.writersOf(vr(6))[0];
    expect(w.choice).toEqual({ cmd: 0, branch: 1, label: "아니오" });
    expect(w.write).toEqual({ atom: vr(6), op: "add", value: 2 });
    expect(g.writersOf(sw(31))[0].choice).toBeUndefined();
  });

  it("common event via 117: callers, level = min caller level", () => {
    const data = game([[1, map([
      ev(1, [page([c(117, [1])], { switch1Valid: true, switch1Id: 2 })]),  // 레벨 Inf (스위치 2 없음)
      ev(2, [page([swOn(3)])]),
      ev(3, [page([c(117, [1])], { switch1Valid: true, switch1Id: 3 })]),  // 레벨 1
    ])]], [
      ce(1, [swOn(40), c(123, ["A", 0])]),
      ce(2, [swOn(41)], 2, 40),   // 병렬, 스위치 40
      ce(3, [swOn(42)]),           // 호출하는 곳 없음
    ]);
    const g = buildDepGraph(data);
    const info = g.ctxs.get("C1")!;
    expect(info.location).toEqual({ source: "common", commonEventId: 1 });
    expect(info.callers.sort()).toEqual(["M1:1:0", "M1:3:0"]);
    expect(g.ctxLevel("C1")).toBe(1);
    expect(g.writersOf(sw(40))).toHaveLength(1);
    expect(g.level(sw(40))).toBe(2);
    // 공통 이벤트 안의 셀프 스위치는 건너뜀
    expect(g.writersOf({ kind: "selfSwitch", mapId: 1, eventId: 1, ch: "A" })).toHaveLength(0);
    expect(g.ctxs.get("C2")!.reqs).toEqual([{ atom: sw(40), test: { kind: "switch", id: 40, on: true } }]);
    expect(g.ctxs.get("C2")!.trigger).toBe(2);
    expect(g.level(sw(41))).toBe(3);
    expect(g.level(sw(42))).toBe(Infinity);
  });

  it("self switch writer and page requirement", () => {
    const data = game([[2, map([ev(5, [
      page([msg, c(123, ["A", 0])]),
      page([msg], { selfSwitchValid: true, selfSwitchCh: "A" }),
    ])])]]);
    const g = buildDepGraph(data);
    const a: Atom = { kind: "selfSwitch", mapId: 2, eventId: 5, ch: "A" };
    expect(g.writersOf(a)).toEqual([expect.objectContaining({ ctx: "M2:5:0", cmd: 1, write: { atom: a, op: "on" } })]);
    expect(g.ctxs.get("M2:5:1")!.reqs).toEqual([{ atom: a, test: { kind: "selfSwitch", letter: "A", on: true } }]);
    expect(g.level(a)).toBe(1);
    expect(g.ctxLevel("M2:5:1")).toBe(1);
  });

  it("script writers are recorded but opaque for level; plugin/script counted", () => {
    const data = game([[1, map([ev(1, [page([
      c(355, ["$gameSwitches.setValue(50, true);"]),
      c(655, ["$gameVariables.setValue( 51, 3)"]),
      c(356, ["Foo bar"]),
      c(357, ["Plug", "cmd", "", {}]),
      c(122, [52, 52, 0, 4, "Math.random()"]),
      c(111, [12, "true"]), c(412, []),
    ])])])]]);
    const g = buildDepGraph(data);
    expect(g.writersOf(sw(50))).toEqual([expect.objectContaining({ cmd: 0, write: { atom: sw(50), op: "script" } })]);
    expect(g.writersOf(vr(51))).toEqual([expect.objectContaining({ cmd: 1, write: { atom: vr(51), op: "script" } })]);
    expect(g.writersOf(vr(52))[0].write.op).toBe("script");
    expect(g.level(sw(50))).toBe(Infinity);
    expect(g.ctxs.get("M1:1:0")!.opaque).toEqual({ plugin: 2, script: 3 });
  });

  it("items, shop, party, variable ops, switch ranges", () => {
    const data = game([[1, map([ev(1, [page([
      c(126, [1, 0, 0, 3]),
      c(127, [2, 1, 0, 1]),       // 잃기
      c(129, [4, 0, false]),
      c(302, [2, 7, 0, 0, false]),
      c(605, [0, 8, 0, 0]),
      c(121, [60, 62, 0]),
      c(121, [63, 63, 1]),        // OFF
      c(122, [70, 70, 0, 0, 5]),
      c(122, [71, 71, 2, 2, 1, 3]),
      c(122, [72, 72, 3, 0, 2]),
    ])])])]]);
    const g = buildDepGraph(data);
    expect(g.writersOf({ kind: "item", id: 1 })[0].write).toEqual({ atom: { kind: "item", id: 1 }, op: "gain", value: 3 });
    expect(g.writersOf({ kind: "weapon", id: 2 })[0].write.op).toBe("other");
    expect(g.writersOf({ kind: "actor", id: 4 })[0].write.op).toBe("gain");
    expect(g.writersOf({ kind: "armor", id: 7 })[0].write.op).toBe("shop");
    expect(g.writersOf({ kind: "item", id: 8 })[0].write.op).toBe("shop");
    expect([60, 61, 62].map(i => g.level(sw(i)))).toEqual([1, 1, 1]);
    expect(g.writersOf(sw(63))[0].write.op).toBe("other");
    expect(g.level(sw(63))).toBe(Infinity); // 끄기만 하는 곳은 켜는 방법이 아님
    expect(g.writersOf(vr(70))[0].write).toEqual({ atom: vr(70), op: "set", value: 5 });
    expect(g.writersOf(vr(71))[0].write).toEqual({ atom: vr(71), op: "sub" });
    expect(g.writersOf(vr(72))[0].write.op).toBe("other");
    expect(g.level({ kind: "item", id: 1 })).toBe(1);
  });

  it("troop pages are contexts", () => {
    const troop: Troop = { id: 3, name: "T", pages: [{ conditions: {
      turnEnding: false, turnValid: false, enemyValid: false, actorValid: false, switchValid: true,
      turnA: 0, turnB: 0, enemyIndex: 0, enemyHp: 0, actorId: 1, actorHp: 0, switchId: 9,
    }, span: 0, list: [swOn(80), END] }] };
    const g = buildDepGraph(game([[1, map([ev(1, [page([swOn(9)])])])]], [], [troop]));
    const info = g.ctxs.get("T3:0")!;
    expect(info.location).toEqual({ source: "troop", troopId: 3, page: 0 });
    expect(info.reqs).toEqual([{ atom: sw(9), test: { kind: "switch", id: 9, on: true } }]);
    expect(g.level(sw(80))).toBe(2);
  });

  it("no writer → Infinity; unknown ctx → Infinity", () => {
    const g = buildDepGraph(game([[1, map([ev(1, [page([msg], { switch1Valid: true, switch1Id: 99 })])])]]));
    expect(g.writersOf(sw(99))).toEqual([]);
    expect(g.level(sw(99))).toBe(Infinity);
    expect(g.ctxLevel("M1:1:0")).toBe(Infinity);
    expect(g.ctxLevel("nope")).toBe(Infinity);
  });

  it("cycle terminates and stays untraceable", () => {
    const data = game([[1, map([
      ev(1, [page([swOn(2)], { switch1Valid: true, switch1Id: 1 })]),
      ev(2, [page([swOn(1)], { switch1Valid: true, switch1Id: 2 })]),
    ])]], [ce(1, [c(117, [2])]), ce(2, [c(117, [1]), swOn(3)])]);
    const g = buildDepGraph(data);
    expect(g.level(sw(1))).toBe(Infinity);
    expect(g.level(sw(2))).toBe(Infinity);
    expect(g.level(sw(3))).toBe(Infinity);
    expect(g.ctxs.get("C1")!.callers).toEqual(["C2"]);
  });

  it("cycle with an escape gets a finite level", () => {
    const data = game([[1, map([
      ev(1, [page([swOn(2)], { switch1Valid: true, switch1Id: 1 })]),
      ev(2, [page([swOn(1)], { switch1Valid: true, switch1Id: 2 })]),
      ev(3, [page([swOn(1)])]),
    ])]]);
    const g = buildDepGraph(data);
    expect(g.level(sw(1))).toBe(1);
    expect(g.level(sw(2))).toBe(2);
  });

  it("picks the shallowest writer and handles long chains in reverse order", () => {
    // 스위치 k는 스위치 k-1이 켜져 있어야 켤 수 있다. 데이터 순서는 거꾸로.
    const N = 3000;
    const events: MapEvent[] = [];
    for (let k = N; k >= 1; k--) {
      events.push(ev(N - k + 1, [page([swOn(k)], k > 1 ? { switch1Valid: true, switch1Id: k - 1 } : {})]));
    }
    // 지름길: 조건 없이 스위치 2000을 켜는 곳
    events.push(ev(N + 1, [page([swOn(2000)])]));
    const t0 = performance.now();
    const g = buildDepGraph(game([[1, map(events)]]));
    const ms = performance.now() - t0;
    expect(g.level(sw(1))).toBe(1);
    expect(g.level(sw(1999))).toBe(1999);
    expect(g.level(sw(2000))).toBe(1);
    expect(g.level(sw(2001))).toBe(2);
    expect(g.level(sw(N))).toBe(N - 2000 + 1);
    expect(ms).toBeLessThan(500);
  });

  it("excludes the template map", () => {
    const data = game([[1, map([ev(1, [page([swOn(1)])])])], [9, map([ev(1, [page([swOn(2)])])])]], [], [], { templateMapId: 9 });
    const g = buildDepGraph(data);
    expect(g.writersOf(sw(2))).toEqual([]);
    expect([...g.ctxs.keys()]).toEqual(["M1:1:0"]);
  });

  it("is cached per data and never throws on garbage", () => {
    const data = game([[1, map([ev(1, [page([swOn(1)])])])]]);
    expect(buildDepGraph(data)).toBe(buildDepGraph(data));
    const bad = game([[1, { displayName: "", width: 0, height: 0, events: [null, { id: 1 } as any, { id: 2, pages: [null, { list: "x" }, { conditions: null, list: [null, { code: 121, parameters: null }] }] } as any] }]],
      [null as any, { id: 5, list: null } as any]);
    (bad as any).troops = "nope";
    expect(() => buildDepGraph(bad)).not.toThrow();
    expect(() => buildDepGraph(null as any)).not.toThrow();
    expect(buildDepGraph(null as any).level(sw(1))).toBe(Infinity);
  });

  it("scales to a large synthetic game", () => {
    // 맵 500개 × 이벤트 28개 = 14,000 페이지, 공통 이벤트 1,000개, 명령 약 20만 개
    const maps: [number, MapData][] = [];
    let s = 0;
    for (let m = 1; m <= 500; m++) {
      const events: MapEvent[] = [];
      for (let e = 1; e <= 28; e++) {
        s++;
        const list: EventCommand[] = [];
        for (let k = 0; k < 6; k++) list.push(msg);
        list.push(c(111, [0, (s % 3000) + 1, 0]), swOn(((s * 7) % 3000) + 1, 1), c(122, [(s % 500) + 1, (s % 500) + 1, 1, 0, 1], 1), c(412, []));
        list.push(c(117, [(s % 1000) + 1]), c(123, ["A", 0]));
        list.push(c(102, [["a", "b"], 1, 0, 2, 0]), c(402, [0, "a"]), swOn(((s * 13) % 3000) + 1, 1), c(402, [1, "b"]), c(404, []));
        events.push(ev(e, [page(list, { switch1Valid: s % 4 === 0, switch1Id: ((s * 11) % 3000) + 1, variableValid: s % 5 === 0, variableId: (s % 500) + 1, variableValue: 3 })]));
      }
      maps.push([m, map(events)]);
    }
    const ces: CommonEvent[] = [];
    for (let i = 1; i <= 1000; i++) {
      const list: EventCommand[] = [];
      for (let k = 0; k < 20; k++) list.push(c(111, [0, ((i * k) % 3000) + 1, 0]), swOn(((i * 17 + k) % 3000) + 1, 1), c(412, []));
      list.push(c(117, [((i * 3) % 1000) + 1]));
      ces.push(ce(i, list, i % 10 === 0 ? 2 : 0, (i % 3000) + 1));
    }
    const data = game(maps, ces);
    const t0 = performance.now();
    const g = buildDepGraph(data);
    let finite = 0;
    for (let i = 1; i <= 3000; i++) if (Number.isFinite(g.level(sw(i)))) finite++;
    const ms = performance.now() - t0;
    console.log(`buildDepGraph: ${g.ctxs.size} ctxs, ${finite} finite switches, ${ms.toFixed(1)} ms`);
    expect(g.ctxs.size).toBe(15000);
    expect(ms).toBeLessThan(2000);
  });
});
