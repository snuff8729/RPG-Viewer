import { describe, expect, it } from "vitest";
import type { EventCommand, EventPage, GameData, MapEvent, PageConditions } from "../types";
import { REPEAT_CACHE_LIMIT, repeatCacheSize, repeatInfo } from "./repeat";
import type { LiveSnapshot } from "./types";

const conds = (over: Partial<PageConditions> = {}): PageConditions => ({
  switch1Valid: false, switch1Id: 1, switch2Valid: false, switch2Id: 1,
  variableValid: false, variableId: 1, variableValue: 0,
  selfSwitchValid: false, selfSwitchCh: "A",
  itemValid: false, itemId: 1, actorValid: false, actorId: 1,
  ...over,
});
const c = (code: number, indent: number, parameters: any[] = []): EventCommand => ({ code, indent, parameters });
const msg = (indent = 0): EventCommand[] => [c(101, indent, ["", 0, 0, 2]), c(401, indent, ["hi"])];
const page = (list: EventCommand[], over: Partial<PageConditions> = {}, trigger = 0): EventPage =>
  ({ conditions: conds(over), trigger, list: [...list, c(0, 0)] });
const event = (pages: EventPage[]): MapEvent => ({ id: 5, name: "EV", x: 1, y: 2, pages });

const data = {
  system: { gameTitle: "", currencyUnit: "G", switches: ["", "문 열림"], variables: ["", "호감도", "주사위"] },
  commonEvents: [null, { id: 1, name: "CE", trigger: 0, switchId: 1, list: [c(121, 0, [1, 1, 0]), c(0, 0)] }],
  maps: new Map(), mapInfos: [], troops: [], actors: [], items: [], weapons: [], armors: [], errors: [],
} as unknown as GameData;

const live = (over: Partial<LiveSnapshot> = {}): LiveSnapshot => ({
  v: 1, t: 0, pluginVersion: "", run: 1, branch: 1, seq: 0, mapId: 3, x: 0, y: 0, running: null,
  events: [], switches: [], variables: {}, selfSwitches: [], items: {}, weapons: {}, armors: {},
  gold: 0, party: [], choice: null, inBattle: false, ...over,
});

describe("repeatInfo", () => {
  it("self switch A set → nextPage after 1", () => {
    const ev = event([page([...msg(), c(123, 0, ["A", 0])]), page(msg(), { selfSwitchValid: true })]);
    const r = repeatInfo(ev, 3, data, live());
    expect(r).toEqual([{ kind: "nextPage", text: "말을 걸면 셀프 스위치 A가 켜져 다음엔 2페이지가 나와요", after: 1, estimated: false }]);
  });

  it("counter variable +1 with >= 3 branch → counter from the 3rd", () => {
    const ev = event([page([
      c(122, 0, [1, 1, 1, 0, 1]),
      c(111, 0, [1, 1, 0, 3, 1]), ...msg(1), c(0, 1),
      c(411, 0), ...msg(1), c(0, 1),
      c(412, 0),
    ])]);
    const r = repeatInfo(ev, 3, data, live());
    expect(r).toEqual([{ kind: "counter", text: "3번째부터 다른 대사가 나와요 (변수 [호감도]를 셈)", after: 3, estimated: false }]);
  });

  it("switch from a common event → nextPage after 1", () => {
    const ev = event([page([...msg(), c(117, 0, [1])]), page(msg(), { switch1Valid: true, switch1Id: 1 })]);
    const r = repeatInfo(ev, 3, data, live());
    expect(r.map(x => [x.kind, x.after])).toEqual([["nextPage", 1]]);
    expect(r[0].text).toContain("2페이지");
  });

  it("random variable tested by a branch → random", () => {
    const ev = event([page([
      c(122, 0, [2, 2, 0, 2, 1, 3]),
      c(111, 0, [1, 2, 0, 2, 0]), ...msg(1), c(0, 1),
      c(412, 0),
    ])]);
    const r = repeatInfo(ev, 3, data, live());
    expect(r).toEqual([{ kind: "random", text: "무작위로 다른 대사가 나와요", after: 0, estimated: false }]);
  });

  it("write inside a choice branch → choiceDependent", () => {
    const ev = event([page([
      c(102, 0, [["예", "아니오"], 1, 0, 2, 0]),
      c(402, 0, [0, "예"]), c(121, 1, [1, 1, 0]), c(0, 1),
      c(402, 0, [1, "아니오"]), c(0, 1),
      c(404, 0),
    ])]);
    const r = repeatInfo(ev, 3, data, live());
    expect(r).toEqual([{ kind: "choiceDependent", text: "고르는 선택지에 따라 다음 내용이 달라져요", after: 0, estimated: false }]);
  });

  it("plain page → []", () => {
    expect(repeatInfo(event([page(msg())]), 3, data, live())).toEqual([]);
  });

  it("plugin command flags estimated", () => {
    const ev = event([page([...msg(), c(356, 0, ["Foo bar"]), c(123, 0, ["A", 0])]), page(msg(), { selfSwitchValid: true })]);
    const r = repeatInfo(ev, 3, data, live());
    expect(r.map(x => [x.kind, x.estimated])).toEqual([["nextPage", true]]);
  });

  it("does not mutate the live snapshot", () => {
    const ev = event([page([...msg(), c(123, 0, ["A", 0]), c(122, 0, [1, 1, 1, 0, 1]), c(126, 0, [1, 0, 0, 1])]),
      page(msg(), { selfSwitchValid: true })]);
    const l = live({ variables: { 1: 2 } });
    const before = JSON.stringify(l);
    repeatInfo(ev, 3, data, l);
    expect(JSON.stringify(l)).toBe(before);
  });

  it("startPage overrides the computed active page", () => {
    const ev = event([page([...msg(), c(123, 0, ["A", 0])]), page(msg(), { selfSwitchValid: true })]);
    // 실제로는 이미 2페이지(계산은 1페이지) → 2페이지는 매번 같다
    expect(repeatInfo(ev, 3, data, live(), 1)).toEqual([]);
    // 계산상 활성 페이지가 없지만 실제로는 1페이지
    const gated = event([page([...msg(), c(123, 0, ["A", 0])], { switch1Valid: true }), page(msg(), { selfSwitchValid: true })]);
    expect(repeatInfo(gated, 3, data, live())).toEqual([]);
    expect(repeatInfo(gated, 3, data, live(), 0).map(r => [r.kind, r.after])).toEqual([["nextPage", 1]]);
  });

  it("no active page → []", () => {
    expect(repeatInfo(event([page(msg(), { switch1Valid: true })]), 3, data, live())).toEqual([]);
  });

  it("cache keys only on state the simulation reads", () => {
    const d = { ...data } as GameData;
    const counter = event([page([
      c(122, 0, [1, 1, 1, 0, 1]),
      c(111, 0, [1, 1, 0, 3, 1]), ...msg(1), c(0, 1),
      c(412, 0),
    ])]);
    const a = repeatInfo(counter, 3, d, live({ variables: { 1: 0 } }));
    expect(repeatCacheSize(d)).toBe(1);
    // 시뮬레이션이 읽지 않는 스위치·변수·아이템이 달라도 같은 항목을 쓴다
    const b = repeatInfo(counter, 3, d, live({ variables: { 1: 0, 7: 99 }, switches: [4, 8], items: { 2: 1 }, gold: 500 }));
    expect(b).toEqual(a);
    expect(repeatCacheSize(d)).toBe(1);
    // 읽는 변수가 달라지면 새로 계산한다
    expect(repeatInfo(counter, 3, d, live({ variables: { 1: 5 } }))).toEqual([]);
    expect(repeatCacheSize(d)).toBe(2);
  });

  it("cache is bounded (LRU)", () => {
    const d = { ...data } as GameData;
    const ev = event([page([...msg(), c(111, 0, [1, 1, 0, 3, 1]), ...msg(1), c(0, 1), c(412, 0)])]);
    for (let i = 0; i < REPEAT_CACHE_LIMIT + 300; i++) repeatInfo(ev, 3, d, live({ variables: { 1: i } }));
    expect(repeatCacheSize(d)).toBe(REPEAT_CACHE_LIMIT);
  });

  it("never throws on garbage", () => {
    expect(repeatInfo(null as unknown as MapEvent, 3, data, live())).toEqual([]);
    expect(repeatInfo(event([page(msg())]), 3, null as unknown as GameData, null as unknown as LiveSnapshot)).toEqual([]);
    const bad = { id: 5, name: "", x: 0, y: 0, pages: [{ conditions: conds(), trigger: 0, list: [null, 7, { code: 111, parameters: null }] }] };
    expect(() => repeatInfo(bad as unknown as MapEvent, 3, data, live())).not.toThrow();
  });
});
