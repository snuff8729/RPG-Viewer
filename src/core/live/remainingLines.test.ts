import { describe, expect, it } from "vitest";
import { buildIndex } from "../index/buildIndex";
import { locationKey } from "../index/locations";
import type { EventCommand, EventPage, GameData, Location, MapData, MapEvent, PageConditions } from "../types";
import { pickKey, seenKey } from "./coverage";
import { pageEntries } from "./interactable";
import { mapChecklist } from "./mapChecklist";
import { remainingLines } from "./remainingLines";
import type { Coverage, LiveSnapshot } from "./types";

const c = (code: number, parameters: any[] = [], indent = 0): EventCommand => ({ code, indent, parameters });
const noCond: PageConditions = {
  switch1Valid: false, switch1Id: 1, switch2Valid: false, switch2Id: 1,
  variableValid: false, variableId: 1, variableValue: 0,
  selfSwitchValid: false, selfSwitchCh: "A",
  itemValid: false, itemId: 1, actorValid: false, actorId: 1,
};
const IMG = { tileId: 0, characterName: "!Objects", characterIndex: 0, direction: 2, pattern: 1 };
const page = (list: EventCommand[]): EventPage => ({ conditions: noCond, trigger: 0, list: [...list, c(0)], image: IMG } as EventPage);
const msg = (text: string, indent: number) => [c(101, ["", 0, 0, 2], indent), c(401, [text], indent)];

/** 목욕(Bath)과 같은 모양: 변수 1020 ≥ 1 분기(A / else B), 선택지 X(C, 1146 ≥ 1 분기 D / else E, 1146 += 1) / Y(없음) */
const bath: EventCommand[] = [
  c(111, [1, 1020, 0, 1, 1]), ...msg("line A", 1), c(0, [], 1),   // 0..3
  c(411), ...msg("line B", 1), c(0, [], 1), c(412),               // 4..8
  c(102, [["X", "Y"], 1, 0, 2, 0]),                               // 9
  c(402, [0, "X"]), ...msg("line C", 1),                          // 10..12
  c(111, [1, 1146, 0, 1, 1], 1), ...msg("line D", 2), c(0, [], 2), // 13..16
  c(411, [], 1), ...msg("line E", 2), c(0, [], 2), c(412, [], 1),  // 17..21
  c(122, [1146, 1146, 1, 0, 1], 1), c(0, [], 1),                  // 22..23
  c(402, [1, "Y"]), c(0, [], 1), c(404),                          // 24..26
];
/** 스위치 5가 켜져야 보이는 대사 하나(이미 본 대사 하나 + 분기) */
const gated: EventCommand[] = [...msg("hello", 0), c(111, [0, 5, 0]), ...msg("secret", 1), c(0, [], 1), c(412)];
/** 스크립트 조건 뒤 대사 */
const scripted: EventCommand[] = [c(111, [12, "$gameFoo()"]), ...msg("script line", 1), c(0, [], 1), c(412)];

const ev = (id: number, name: string, list: EventCommand[]): MapEvent => ({ id, name, x: id, y: 1, pages: [page(list)] } as MapEvent);
const map: MapData = { displayName: "", width: 10, height: 10, events: [null, ev(1, "Bath", bath), ev(2, "Door", gated), ev(3, "Odd", scripted)] };
const data: GameData = {
  engine: "MZ", dataRoot: "data", imgRoot: "img",
  system: { gameTitle: "", currencyUnit: "G", switches: [], variables: [] },
  mapInfos: [null, { id: 1, name: "집", parentId: 0, order: 1 }],
  maps: new Map([[1, map]]),
  commonEvents: [null], troops: [null], actors: [null], items: [null], weapons: [null], armors: [null], errors: [],
} as unknown as GameData;
const index = buildIndex(data);
const at = (eventId: number): Location => ({ source: "map", mapId: 1, eventId, page: 0 });
const coverage = (seen: [number, number][], picks: [number, number, number[]][] = []): Coverage => ({
  seen: new Set(seen.map(([e, cmd]) => seenKey(at(e), cmd))),
  picks: new Map(picks.map(([e, cmd, ps]) => [pickKey(at(e), cmd), ps.map(p => ({ picked: p, run: 1, branch: 1, seq: 0, aftermath: [] }))])),
  uncertainSeqs: new Set(), changedSeqs: new Set(), touched: new Set([at(1), at(2), at(3)].map(locationKey)), pluginRan: new Set(),
});
const live = (over: Partial<LiveSnapshot> = {}): LiveSnapshot => ({
  v: 1, t: 0, pluginVersion: "", run: 1, branch: 1, seq: 0, mapId: 1, x: 0, y: 0, running: null,
  events: [], switches: [], variables: {}, selfSwitches: [], items: {}, weapons: {}, armors: {},
  gold: 0, party: [], choice: null, inBattle: false, ...over,
});
const entry = (id: number) => pageEntries(index).get(locationKey(at(id)))!;
const rem = (id: number, cov: Coverage, l: LiveSnapshot) => remainingLines(entry(id), cov, data, live(l), map.events[id]!, 1, 0);

describe("remainingLines", () => {
  // A·C·E는 봤고 변수 1020 = 1
  const bathCov = coverage([[1, 1], [1, 11], [1, 18]], [[1, 9, [0, 1]]]);

  it("lists unseen lines with the path: choices, conditions, else; gated else goes to later", () => {
    const r = rem(1, bathCov, live({ variables: { 1020: 1 } }));
    expect(r.nowCount).toBe(1);
    expect(r.now).toEqual([{ text: "line D", how: ["선택지 「X」 고르기", "한 번 더 하면 — 조건: 변수: #1146 ≥ 1"] }]);
    expect(r.laterCount).toBe(1);
    expect(r.later[0]).toMatchObject({ text: "line B", how: ["조건이 아닐 때: 변수: #1020 ≥ 1"] });
    expect(r.later[0].needs).toEqual([{ text: "조건이 아닐 때: 변수: #1020 ≥ 1", req: { atom: { kind: "variable", id: 1020 }, test: { kind: "variable", id: 1020, op: "<", value: 1 } } }]);
  });

  it("met condition path: plain 조건 text; repeat self-increment is reachable", () => {
    // 아무것도 안 봤고 1020 = 0: A는 나중에, B는 지금(조건이 아닐 때), D는 한 번 더 하면
    const r = rem(1, coverage([]), live());
    expect(r.now.map(l => l.text)).toEqual(["line B", "line C", "line D"]);
    expect(r.nowCount).toBe(4);   // + line E
    expect(r.now[0].how).toEqual(["조건이 아닐 때: 변수: #1020 ≥ 1"]);
    expect(r.now[1].how).toEqual(["선택지 「X」 고르기"]);
    expect(r.now[2].how[1]).toBe("한 번 더 하면 — 조건: 변수: #1146 ≥ 1");
    expect(r.later.map(l => l.text)).toEqual(["line A"]);
    // 1146이 이미 1이면 D는 그냥 조건, E는 나중에(1146을 줄이는 명령이 없다)
    const r2 = rem(1, bathCov, live({ variables: { 1020: 1, 1146: 1 } }));
    expect(r2.now).toEqual([{ text: "line D", how: ["선택지 「X」 고르기", "조건: 변수: #1146 ≥ 1"] }]);
  });

  it("unknown (script) conditions count as reachable", () => {
    const r = rem(3, coverage([]), live());
    expect(r.now).toEqual([{ text: "script line", how: ["조건: 스크립트: $gameFoo() (조건 확인 불가)"] }]);
  });

  it("caps at 3 lines and keeps the count", () => {
    const many: EventCommand[] = [1, 2, 3, 4, 5].flatMap(i => msg(`m${i}`, 0));
    const e = entry(1);
    const fake = { ...e, nodes: buildIndex({ ...data, maps: new Map([[1, { ...map, events: [null, ev(1, "Many", many)] }]]) } as GameData).pages[0].nodes };
    const r = remainingLines(fake, coverage([]), data, live(), ev(1, "Many", many), 1, 0);
    expect([r.now.length, r.nowCount]).toEqual([3, 5]);
  });
});

describe("mapChecklist with remaining lines", () => {
  it("a line behind a currently false condition does not make the event 'now'", () => {
    const cov = coverage([[1, 1], [1, 11], [1, 18], [2, 0], [3, 0]], [[1, 9, [0, 1]]]);
    const off = mapChecklist(data, index, cov, live())!.events.find(e => e.eventId === 2)!;
    expect([off.section, off.unseen, off.later]).toEqual(["talk", 0, 1]);
    expect(off.laterLines[0]).toMatchObject({ text: "secret", how: ["조건: 스위치: #5 ON"] });
    expect(off.laterLines[0].needs?.[0].req).toEqual({ atom: { kind: "switch", id: 5 }, test: { kind: "switch", id: 5, on: true } });
    const on = mapChecklist(data, index, cov, live({ switches: [5] }))!.events.find(e => e.eventId === 2)!;
    expect([on.section, on.unseen, on.later]).toEqual(["now", 1, 0]);
    expect(on.remainingLines).toEqual([{ text: "secret", how: ["조건: 스위치: #5 ON"] }]);
  });

  it("Bath: the repeat-reachable line keeps it in now; only the else line is later", () => {
    const cov = coverage([[1, 1], [1, 11], [1, 18]], [[1, 9, [0, 1]]]);
    const bathEv = mapChecklist(data, index, cov, live({ variables: { 1020: 1 } }))!.events.find(e => e.eventId === 1)!;
    expect([bathEv.section, bathEv.unseen, bathEv.unpicked, bathEv.later]).toEqual(["now", 1, 0, 1]);
    expect(bathEv.remainingLines[0].how).toContain("선택지 「X」 고르기");
  });
});
