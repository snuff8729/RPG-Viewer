import { describe, expect, it } from "vitest";
import { buildDepGraph } from "../deps/graph";
import { buildIndex } from "../index/buildIndex";
import { locationKey, pageLocation } from "../index/locations";
import { seenSets } from "../live/assist";
import { computeCoverage, pageList, seenKey } from "../live/coverage";
import { pageNewCounts } from "../live/interactable";
import { mapChecklist } from "../live/mapChecklist";
import { computeMissing } from "../live/missing";
import { repeatInfo } from "../live/repeat";
import type { Coverage, LiveSnapshot, LogRecord } from "../live/types";
import { expandTemplateEvents } from "../loader/templateEvent";
import type { EventCommand, EventPage, GameData, Location, MapData, MapEvent, PageConditions, ScriptNode } from "../types";
import { findNodePathByCmd, interpret, nodesAt } from "./interpret";
import { flattenCalls, parseTeCall, resolveTeCall } from "./teCall";

const c = (code: number, parameters: any[] = [], indent = 0): EventCommand => ({ code, indent, parameters });
const noCond: PageConditions = {
  switch1Valid: false, switch1Id: 1, switch2Valid: false, switch2Id: 1,
  variableValid: false, variableId: 1, variableValue: 0,
  selfSwitchValid: false, selfSwitchCh: "A",
  itemValid: false, itemId: 1, actorValid: false, actorId: 1,
};
const IMG = { tileId: 0, characterName: "Chest", characterIndex: 0, direction: 2, pattern: 1 };
const page = (list: EventCommand[], cond: Partial<PageConditions> = {}): EventPage =>
  ({ conditions: { ...noCond, ...cond }, trigger: 0, list: [...list, c(0)], image: IMG });
const selfA: Partial<PageConditions> = { selfSwitchValid: true };
const msg = (text: string) => [c(101, ["", 0, 0, 2]), c(401, [text])];
const ORIGIN = c(356, ["TE固有イベント呼び出し"]);

// 템플릿 맵(2)의 아이템 상자: 원래 이벤트 호출 + 셀프 스위치 A ON / A면 빈 페이지
const tplChest = (): MapEvent => ({
  id: 1, name: "상자", x: 0, y: 0, pages: [page([ORIGIN, c(123, ["A", 0])]), page([], selfA)],
});
const tplOnlyCall = (): MapEvent => ({ id: 2, name: "호출만", x: 0, y: 0, pages: [page([ORIGIN]), page([], selfA)] });
const tplLoop = (): MapEvent => ({ id: 3, name: "되부름", x: 0, y: 0, pages: [page([c(356, ["TE_CALL_ORIGIN_EVENT"])])] });
const templateMap: MapData = { displayName: "", width: 5, height: 5, events: [null, tplChest(), tplOnlyCall(), tplLoop()] };

const town: MapData = {
  displayName: "", width: 20, height: 20,
  events: [
    null,
    // 1: 상자(<TE:상자>) — 원래 페이지에 대사·아이템·골드
    { id: 1, name: "보물", note: "<TE:상자>", x: 1, y: 1, pages: [page([...msg("포션을 찾았다"), c(126, [1, 0, 0, 1]), c(125, [0, 0, 50])])] },
    // 2: 점원 — 다른 맵 이벤트(이름) 호출
    { id: 2, name: "점원", x: 2, y: 2, pages: [page([c(356, ["TE_CALL_MAP_EVENT 1 상인"])])] },
    // 3: 상인
    { id: 3, name: "상인", x: 3, y: 3, pages: [page(msg("어서오세요"))] },
    // 4: 되부름(<TE:3>) — 원래 페이지가 자기 자신을 다시 부른다
    { id: 4, name: "고리", note: "<TE:3>", x: 4, y: 4, pages: [page([c(356, ["TE_CALL_ORIGIN_EVENT 1"]), ...msg("한 번만")])] },
    // 5: 호출만(<TE:2>) — 셀프 스위치는 원래 페이지에서 켠다, 선택지 갈래에서 스위치 3 ON
    {
      id: 5, name: "선택", note: "<TE:호출만>", x: 5, y: 5,
      pages: [page([
        c(102, [["예", "아니오"], 1, 0, 2, 0]),
        c(402, [0, "예"]), c(121, [3, 3, 0], 1), c(0, [], 1),
        c(402, [1, "아니오"]), c(0, [], 1),
        c(404, []),
        c(123, ["A", 0]),
      ])],
    },
    // 6: 이름으로 템플릿 이벤트(보물)를 부름 → $dataMap의 원래 페이지
    { id: 6, name: "이름호출", x: 6, y: 6, pages: [page([c(356, ["TE_CALL_MAP_EVENT 1 보물"])])] },
    // 7: 번호로 템플릿 이벤트(1)를 부름 → 템플릿 페이지(그 안의 원래 이벤트 호출·셀프 스위치는 대상 이벤트 기준)
    { id: 7, name: "번호호출", x: 7, y: 7, pages: [page([c(356, ["TEマップイベント呼び出し 1 1"])])] },
  ],
};

function makeData(keep = false): GameData {
  const maps = new Map<number, MapData>([
    [1, structuredClone(town)],
    [2, structuredClone(templateMap)],
  ]);
  const errors = expandTemplateEvents(maps, maps.get(2)!, 2, id => `Map${id}.json`);
  if (errors.length) throw new Error(JSON.stringify(errors));
  return {
    engine: "MV", dataRoot: "www/data", imgRoot: "www/img",
    system: { gameTitle: "", currencyUnit: "G", switches: ["", "", "", "문"], variables: [] },
    mapInfos: [null, { id: 1, name: "마을", parentId: 0, order: 1 }, { id: 2, name: "템플릿", parentId: 0, order: 2 }],
    maps, commonEvents: [null], troops: [null], actors: [null],
    items: [null, { id: 1, name: "포션" }], weapons: [null], armors: [null], errors: [],
    templateMapId: 2,
    ...(keep ? { templateKeepEventId: true } : {}),
  };
}
const data = makeData();
const index = buildIndex(data);
const at = (eventId: number, pg: number): Location => ({ source: "map", mapId: 1, eventId, page: pg });
const origin = (eventId: number, pg: number, o: number): Location => ({ source: "map", mapId: 1, eventId, page: pg, origin: o });
const entryOf = (loc: Location) => index.pages.find(p => locationKey(p.location) === locationKey(loc))!;
const emptyCov = (): Coverage => ({ seen: new Set(), picks: new Map(), uncertainSeqs: new Set(), changedSeqs: new Set() });
const live = (over: Partial<LiveSnapshot> = {}): LiveSnapshot => ({
  v: 1, t: 0, pluginVersion: "1.2.0", run: 1, branch: 1, seq: 0, mapId: 1, x: 0, y: 0, running: null,
  events: [], switches: [], variables: {}, selfSwitches: [], items: {}, weapons: {}, armors: {},
  gold: 0, party: [], choice: null, inBattle: false, ...over,
});
const ev = (id: number) => data.maps.get(1)!.events[id]!;

describe("parseTeCall", () => {
  it("recognises MV call-origin / call-map-event commands", () => {
    expect(parseTeCall(c(356, ["TE固有イベント呼び出し"]))).toEqual({ kind: "origin", page: null });
    expect(parseTeCall(c(356, ["TE固有イベント呼び出し 2"]))).toEqual({ kind: "origin", page: 2 });
    expect(parseTeCall(c(356, ["te_call_origin_event　3"]))).toEqual({ kind: "origin", page: 3 });
    expect(parseTeCall(c(356, ["TEマップイベント呼び出し 2 7"]))).toEqual({ kind: "map", page: 2, target: 7 });
    expect(parseTeCall(c(356, ["TE_CALL_MAP_EVENT 1 상인"]))).toEqual({ kind: "map", page: 1, target: "상인" });
    expect(parseTeCall(c(356, ["TE_CALL_MAP_EVENT \\v[1]"]))).toEqual({ kind: "map", page: null, target: null });
  });
  it("recognises MZ TemplateEvent commands and ignores everything else", () => {
    expect(parseTeCall(c(357, ["TemplateEvent", "CALL_ORIGIN_EVENT", "", { pageIndex: "2" }]))).toEqual({ kind: "origin", page: 2 });
    expect(parseTeCall(c(357, ["TemplateEvent", "CALL_MAP_EVENT", "", { pageIndex: "0", eventId: "4" }])))
      .toEqual({ kind: "map", page: 0, target: 4 });
    expect(parseTeCall(c(357, ["Other", "CALL_ORIGIN_EVENT", "", {}]))).toBeNull();
    expect(parseTeCall(c(356, ["TMng Search"]))).toBeNull();
    expect(parseTeCall(c(101, ["TE固有イベント呼び出し"]))).toBeNull();
    expect(parseTeCall(null)).toBeNull();
    expect(parseTeCall({ code: 356, parameters: "x" })).toBeNull();
  });
});

describe("resolveTeCall", () => {
  const pg = (n: number) => page([c(355, [`p${n}`])]);
  const e: MapEvent = { id: 9, name: "e", x: 0, y: 0, pages: [pg(10), pg(11), pg(12)], originalPages: [pg(0), pg(1), pg(2)] };
  const ctx = { data, mapId: 1, event: e, page: 2 };
  const idx = (n: number | null) => (resolveTeCall({ kind: "origin", page: n }, ctx)!.location as { origin: number }).origin;
  it("follows the engine rule pages[n - 1 || interpreter._pageIndex(undefined)] || pages[0]", () => {
    expect(idx(null)).toBe(0);   // 없음 → 첫 페이지
    expect(idx(1)).toBe(0);
    expect(idx(0)).toBe(0);
    expect(idx(2)).toBe(1);
    expect(idx(3)).toBe(2);
    expect(idx(9)).toBe(0);      // 범위 밖 → 첫 페이지
    expect(idx(-1)).toBe(0);
    const r = resolveTeCall({ kind: "origin", page: 2 }, ctx)!;
    expect(r.location).toEqual({ source: "map", mapId: 1, eventId: 9, page: 2, origin: 1 });
    expect(r.label).toBe("원래 이벤트 p2 실행");
    expect(r.list).toBe(e.originalPages![1].list);
  });
  it("calls its own pages when the event is not a template event", () => {
    const plain: MapEvent = { ...e, originalPages: undefined };
    expect(resolveTeCall({ kind: "origin", page: 2 }, { ...ctx, event: plain })!.location).toEqual(at(9, 1));
  });
  it("resolves map events by id or name, and fails softly", () => {
    const r = resolveTeCall({ kind: "map", page: 1, target: "상인" }, { data, mapId: 1, event: ev(2), page: 0 })!;
    expect(r.location).toEqual(at(3, 0));
    expect(r.label).toBe("이벤트 상인 p1 실행");
    expect(resolveTeCall({ kind: "map", page: 1, target: 3 }, { data, mapId: 1, event: ev(2), page: 0 })!.location).toEqual(at(3, 0));
    expect(resolveTeCall({ kind: "map", page: 1, target: "없음" }, { data, mapId: 1, event: ev(2), page: 0 })).toBeNull();
    expect(resolveTeCall({ kind: "origin", page: 1 }, { data, mapId: 1, event: null as unknown as MapEvent, page: 0 })).toBeNull();
  });
  it("map-event call by name uses the raw (original) pages, by id the template pages", () => {
    const byName = resolveTeCall({ kind: "map", page: 1, target: "보물" }, { data, mapId: 1, event: ev(6), page: 0 })!;
    expect(byName.location).toEqual(origin(1, 0, 0));
    expect(byName.list).toBe(ev(1).originalPages![0].list);
    const byId = resolveTeCall({ kind: "map", page: 1, target: 1 }, { data, mapId: 1, event: ev(7), page: 0 })!;
    expect(byId.location).toEqual(at(1, 0));
    expect(byId.list).toBe(ev(1).pages[0].list);
    // KeepEventId 꺼짐(기본): 자식은 대상 이벤트로 / 켜짐: 부른 이벤트로
    expect(byId.ctx.event.id).toBe(1);
    const keep = { ...data, templateKeepEventId: true };
    expect(resolveTeCall({ kind: "map", page: 1, target: 1 }, { data: keep, mapId: 1, event: ev(7), page: 0 })!.ctx.event.id).toBe(7);
    // 원래 이벤트 호출은 언제나 같은 이벤트
    expect(resolveTeCall({ kind: "origin", page: null }, { data: keep, mapId: 1, event: ev(1), page: 0 })!.ctx.event.id).toBe(1);
  });

  it("nested calls and self switches follow the child interpreter's event", () => {
    // 7 → 1의 템플릿 페이지 → (1 기준) 원래 이벤트 호출
    const nodes = entryOf(at(7, 0)).nodes[0] as Extract<ScriptNode, { kind: "call" }>;
    expect(nodes.location).toEqual(at(1, 0));
    expect(nodes.nodes[0]).toMatchObject({ kind: "call", location: origin(1, 0, 0) });
    const g = buildDepGraph(data);
    const selfA1 = g.writersOf({ kind: "selfSwitch", mapId: 1, eventId: 1, ch: "A" }).map(w => w.ctx);
    expect(selfA1).toContain("M1:7:0");
    expect(g.writersOf({ kind: "selfSwitch", mapId: 1, eventId: 7, ch: "A" })).toEqual([]);
    const keepData = makeData(true);
    const gk = buildDepGraph(keepData);
    expect(gk.writersOf({ kind: "selfSwitch", mapId: 1, eventId: 7, ch: "A" }).map(w => w.ctx)).toEqual(["M1:7:0"]);
    expect(gk.writersOf({ kind: "selfSwitch", mapId: 1, eventId: 1, ch: "A" }).map(w => w.ctx)).not.toContain("M1:7:0");
  });

  it("flattenCalls splices called lists and stops on recursion", () => {
    const codes = flattenCalls(ev(1).pages[0].list, { data, mapId: 1, event: ev(1), page: 0 }).map(x => x.code);
    expect(codes).toEqual([101, 401, 126, 125, 0, 123, 0]);
    const loop = flattenCalls(ev(4).pages[0].list, { data, mapId: 1, event: ev(4), page: 0 }).map(x => x.code);
    expect(loop).toEqual([356, 101, 401, 0, 0]);
    expect(flattenCalls(ev(1).pages[0].list, null).map(x => x.code)).toEqual([356, 123, 0]);
  });
});

describe("interpret / index", () => {
  it("expands the original page inline under a call node", () => {
    const entry = entryOf(at(1, 0));
    const call = entry.nodes[0] as Extract<ScriptNode, { kind: "call" }>;
    expect(call).toMatchObject({ kind: "call", cmd: 0, label: "원래 이벤트 p1 실행", location: origin(1, 0, 0) });
    expect(call.nodes.map(n => n.kind)).toEqual(["message", "stateChange", "stateChange"]);
    expect(entry.nodes[1]).toMatchObject({ kind: "stateChange", target: "selfSwitch" });
    expect(entry.hasDialogue).toBe(true);
    expect(index.search("포션을")[0]).toMatchObject({ entry, nodePath: [0, 0, 0] });
    expect(index.xref({ type: "item", id: 1 }).writes).toContain(entry);
  });
  it("expands another map event's page and guards recursion", () => {
    expect(entryOf(at(2, 0)).nodes[0]).toMatchObject({ kind: "call", label: "이벤트 상인 p1 실행", location: at(3, 0) });
    const loop = entryOf(at(4, 0)).nodes[0] as Extract<ScriptNode, { kind: "call" }>;
    expect(loop.kind).toBe("call");
    expect(loop.nodes.map(n => n.kind)).toEqual(["other", "message"]);   // 자기 자신을 다시 부르는 곳은 펼치지 않는다
  });
  it("leaves plugin commands alone without a map context", () => {
    expect(interpret([ORIGIN], data)).toEqual([{ kind: "other", commands: [ORIGIN] }]);
  });
  it("finds nodes by cmd within the right list", () => {
    const entry = entryOf(at(1, 0));
    expect(findNodePathByCmd(entry.nodes, 0)).toEqual([0]);          // 템플릿 페이지 자신의 0번(호출 명령)
    expect(findNodePathByCmd(entry.nodes, 0, { base: entry.location, target: origin(1, 0, 0) })).toEqual([0, 0, 0]);
    expect(findNodePathByCmd(entry.nodes, 0, { base: entry.location, target: entry.location })).toEqual([0]);
    expect(findNodePathByCmd(entry.nodes, 1, { base: entry.location, target: origin(1, 0, 0) })).toBeNull();
    expect(nodesAt(entry.nodes, entry.location, origin(1, 0, 0))).toBe((entry.nodes[0] as { nodes: ScriptNode[] }).nodes);
    expect(nodesAt(entry.nodes, entry.location, entry.location)).toBe(entry.nodes);
    expect(nodesAt(entry.nodes, entry.location, origin(1, 0, 5))).toBeNull();
  });
  it("origin locations get their own key and map back to the template page", () => {
    expect(locationKey(origin(1, 0, 2))).toBe("map:1:1:0:o2");
    expect(pageLocation(origin(1, 0, 2))).toEqual(at(1, 0));
    expect(pageList(data, origin(1, 0, 0))).toBe(ev(1).originalPages![0].list);
    expect(pageList(data, origin(3, 0, 0))).toBeNull();   // 템플릿 이벤트가 아님
  });
});

describe("live analyses follow the call", () => {
  const rec = (over: Partial<LogRecord>): LogRecord =>
    ({ v: 1, seq: 1, t: 0, run: 1, branch: 1, type: "message", src: origin(1, 0, 0), cmd: 0, face: "", faceIndex: 0, speaker: "", text: "포션을 찾았다", ...over }) as LogRecord;

  it("coverage links records from the original page by origin location", () => {
    const cov = computeCoverage([rec({})], data);
    expect([...cov.seen]).toEqual([seenKey(origin(1, 0, 0), 0)]);
    expect(cov.uncertainSeqs.size).toBe(0);
    // 템플릿 페이지 위치로 온(구버전) 기록은 구조가 달라 불확실
    const old = computeCoverage([rec({ src: at(1, 0) })], data);
    expect(old.seen.size).toBe(0);
    expect(old.uncertainSeqs.has(1)).toBe(true);
  });

  it("counts unseen dialogue inside the call with the called list's key", () => {
    const entry = entryOf(at(1, 0));
    expect(pageNewCounts(entry, emptyCov())).toMatchObject({ unseen: 1, dialogue: 1 });
    expect(pageNewCounts(entry, computeCoverage([rec({})], data))).toMatchObject({ unseen: 0, dialogue: 1 });
  });

  it("seen pages for the game include the called list of a fully seen page", () => {
    const { seenPages, seenMessages } = seenSets(computeCoverage([rec({})], data), index);
    expect(seenMessages).toEqual(["map:1:1:0:o0#0"]);
    expect(seenPages).toEqual(expect.arrayContaining(["map:1:1:0", "map:1:1:0:o0"]));
    expect(seenSets(emptyCov(), index).seenPages).not.toContain("map:1:1:0:o0");
  });

  it("missing finds the unseen line inside the call", () => {
    const items = computeMissing(index, data, emptyCov(), null).filter(i => locationKey(i.entry.location) === locationKey(at(1, 0)));
    expect(items).toEqual([expect.objectContaining({ kind: "page", nodePath: [0, 0, 0], label: "포션을 찾았다" })]);
  });

  it("map checklist sees gains and dialogue of the original page", () => {
    const now = mapChecklist(data, index, emptyCov(), live())!.events.find(e => e.eventId === 1)!;
    expect(now).toMatchObject({ section: "now", unseen: 1, gains: ["아이템 [포션] ×1", "골드 +50"] });
    expect(now.pluginHint).toBeUndefined();
    const seen = mapChecklist(data, index, computeCoverage([rec({})], data), live())!.events.find(e => e.eventId === 1)!;
    expect(seen.section).toBe("item");
  });

  it("repeat simulation runs the original page as a child (self switches on the same event)", () => {
    expect(repeatInfo(ev(1), 1, data, live())).toEqual([
      { kind: "nextPage", text: "말을 걸면 셀프 스위치 A가 켜져 다음엔 2페이지가 나와요", after: 1, estimated: false },
    ]);
    // 셀프 스위치를 원래 페이지에서 켜고, 선택지 갈래에서 스위치를 쓴다
    const r5 = repeatInfo(ev(5), 1, data, live());
    expect(r5.map(r => r.kind).sort()).toEqual(["choiceDependent", "nextPage"]);
    expect(r5.every(r => !r.estimated)).toBe(true);
  });

  it("dependency graph attributes writes in the original page to the template page context", () => {
    const g = buildDepGraph(data);
    const items = g.writersOf({ kind: "item", id: 1 });
    expect(items.map(w => w.ctx)).toEqual(["M1:1:0", "M1:6:0", "M1:7:0"]);   // 템플릿 페이지·이름 호출·번호 호출
    expect(items[0]).toMatchObject({ ctx: "M1:1:0", cmd: 2, at: origin(1, 0, 0) });
    expect(g.writersOf({ kind: "selfSwitch", mapId: 1, eventId: 5, ch: "A" }))
      .toEqual([expect.objectContaining({ ctx: "M1:5:0", at: origin(5, 0, 0) })]);
    expect(g.writersOf({ kind: "switch", id: 3 })).toEqual([
      expect.objectContaining({ ctx: "M1:5:0", choice: expect.objectContaining({ branch: 0, label: "예" }) }),
    ]);
    expect(g.ctxs.get("M1:1:0")!.opaque.plugin).toBe(0);
    expect(g.ctxs.get("M1:2:0")!.opaque.plugin).toBe(0);
    expect(g.level({ kind: "selfSwitch", mapId: 1, eventId: 5, ch: "A" })).toBe(1);
  });
});
