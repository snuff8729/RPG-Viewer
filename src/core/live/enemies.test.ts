import { describe, expect, it } from "vitest";
import { buildIndex } from "../index/buildIndex";
import { routeAvoiding, standTiles } from "../map/route";
import type { MapTiles, TilesetInfo } from "../map/tiles";
import type { CommonEvent, EventCommand, EventPage, GameData, MapData, MapEvent, PageConditions, Troop } from "../types";
import { seenKey } from "./coverage";
import { battleTroop, describeEnemy, enemyOf, enemyTiles, findBattles, mapEncounters, regionCells } from "./enemies";
import { mapChecklist, type ChecklistEvent } from "./mapChecklist";
import { MANY_CALLERS } from "./mapScan";
import type { Coverage, LiveSnapshot } from "./types";

const c = (code: number, parameters: any[] = [], indent = 0): EventCommand => ({ code, indent, parameters });
const noCond: PageConditions = {
  switch1Valid: false, switch1Id: 1, switch2Valid: false, switch2Id: 1,
  variableValid: false, variableId: 1, variableValue: 0,
  selfSwitchValid: false, selfSwitchCh: "A",
  itemValid: false, itemId: 1, actorValid: false, actorId: 1,
};
const msg = (text: string) => [c(101, ["", 0, 0, 2]), c(401, [text])];
const img = (characterName: string) => ({ tileId: 0, characterName, characterIndex: 0, direction: 2, pattern: 1 });
const page = (list: EventCommand[], o: Partial<EventPage> & { sw?: number } = {}): EventPage => {
  const { sw, ...rest } = o;
  return {
    conditions: sw ? { ...noCond, switch1Valid: true, switch1Id: sw } : noCond, trigger: 0, priorityType: 1,
    list: [...list, c(0)], image: img("Monster"), ...rest,
  };
};
const ev = (id: number, name: string, pages: EventPage[], o: Partial<MapEvent> = {}): MapEvent => ({ id, name, x: id, y: 1, pages, ...o });
/** 전투 처리: kind 0 직접, 1 변수, 2 랜덤 */
const battle = (kind: number, id: number, canEscape = false, canLose = false) => c(301, [kind, id, canEscape, canLose]);

const field: MapData = {
  displayName: "", width: 16, height: 10,
  encounterList: [
    { troopId: 1, weight: 5, regionSet: [] },
    { troopId: 2, weight: 5, regionSet: [] },
    { troopId: 3, weight: 10, regionSet: [2, 1] },
    { troopId: 0, weight: 3, regionSet: [] }, // 적 그룹 없음 → 뺀다
  ],
  encounterStep: 25,
  events: [
    null,
    ev(1, "슬라임", [page([battle(0, 1, true)], { trigger: 2, moveType: 2 })]),                // 부딪히면 · 다가옴 · 도망 가능
    ev(2, "보스", [page([...msg("덤벼라"), battle(1, 5, false, true)])]),                       // 말 걸면 · 변수 · 져도 계속 · 대사
    ev(3, "TE적", [page([c(356, ["TE固有イベント呼び出し"])], { trigger: 1 })], {
      originalPages: [page([battle(2, 0)])],
    }),
    ev(4, "공통 적", [page([c(117, [20])], { trigger: 1 })]),                                  // CE 20 → 21 → 전투(깊이 2)
    ev(5, "깊은 적", [page([c(117, [22])], { trigger: 1 })]),                                  // CE 22 → 20 → 21: 깊이 3
    ev(6, "플러그인 적", [page([c(356, ["StartBattle 3"])], { trigger: 1 })], { note: "<chase:5>" }),
    ev(7, "시스템", [page([c(117, [10])], { trigger: 1 })]),                                    // 많이 불리는 CE 안의 전투는 무시
    // 페이지 1: 마을 사람, 페이지 2(스위치 5): 적
    ev(8, "변하는 사람", [page(msg("안녕")), page([battle(0, 2)], { sw: 5, trigger: 1 })]),
    ev(9, "쓰러진 적", [page([battle(0, 1)], { trigger: 1 })]),                                 // live에서 page -1
    ev(10, "주민", [page(msg("평범"))]),
  ],
};
const ce = (id: number, list: EventCommand[]): CommonEvent => ({ id, name: `CE${id}`, trigger: 0, switchId: 1, list: [...list, c(0)] });
const commonEvents: (CommonEvent | null)[] = [];
commonEvents[10] = ce(10, [battle(0, 4)]);
commonEvents[20] = ce(20, [c(117, [21])]);
commonEvents[21] = ce(21, [battle(0, 3)]);
commonEvents[22] = ce(22, [c(117, [20])]);
commonEvents[40] = ce(40, Array.from({ length: MANY_CALLERS }, () => c(117, [10])));
const troop = (id: number, name: string): Troop => ({ id, name, pages: [] });

const data: GameData = {
  engine: "MZ", dataRoot: "data", imgRoot: "img",
  system: { gameTitle: "", currencyUnit: "G", switches: [], variables: [] },
  mapInfos: [null, { id: 1, name: "들판", parentId: 0, order: 1 }],
  maps: new Map([[1, field]]),
  commonEvents, troops: [null, troop(1, "슬라임*2"), troop(2, "박쥐"), troop(3, "늑대"), troop(4, "")],
  actors: [null], items: [null], weapons: [null], armors: [null], errors: [],
};
const index = buildIndex(data);
const coverage = (): Coverage => ({
  seen: new Set(), picks: new Map(), uncertainSeqs: new Set(), changedSeqs: new Set(), touched: new Set(), pluginRan: new Set(),
});
const live = (over: Partial<LiveSnapshot> = {}): LiveSnapshot => ({
  v: 1, t: 0, pluginVersion: "1.4.0", run: 1, branch: 1, seq: 0, mapId: 1, x: 0, y: 0, running: null,
  events: [], switches: [], variables: {}, selfSwitches: [], items: {}, weapons: {}, armors: {},
  gold: 0, party: [], choice: null, inBattle: false, ...over,
});
const find = (evs: ChecklistEvent[], id: number) => evs.find(e => e.eventId === id);
const evOf = (id: number) => field.events[id]!;

describe("enemy detection", () => {
  it("finds Battle Processing directly with troop, escape and lose flags", () => {
    expect(enemyOf(evOf(1), 1, data, 0)).toEqual({
      troops: ["슬라임*2"], now: true, touch: true, chase: true, canEscape: true, canLose: false, maybe: false,
    });
    expect(enemyOf(evOf(2), 1, data, 0)).toMatchObject({ troops: ["변수로 정해짐"], touch: false, chase: false, canEscape: false, canLose: true });
  });

  it("follows TemplateEvent calls and common events up to depth 2, skipping widely-shared ones", () => {
    expect(enemyOf(evOf(3), 1, data, 0)?.troops).toEqual(["맵 랜덤 적"]);
    expect(enemyOf(evOf(4), 1, data, 0)?.troops).toEqual(["늑대"]);
    expect(enemyOf(evOf(5), 1, data, 0)).toBeNull();
    expect(enemyOf(evOf(7), 1, data, 0)).toBeNull();
    expect(enemyOf(evOf(10), 1, data, 0)).toBeNull();
  });

  it("plugin commands that look like battles are a maybe; chase notes count", () => {
    expect(enemyOf(evOf(6), 1, data, 0)).toMatchObject({ maybe: true, troops: [], chase: true, touch: true });
    expect(findBattles([c(356, ["ShowPicture 1"])], null, data)).toEqual([]);
    expect(findBattles([c(356, ["エンカウント 開始"])], null, data)).toEqual([{ troop: null, canEscape: false, canLose: false, maybe: true }]);
  });

  it("marks whether the current page is the battle page", () => {
    expect(enemyOf(evOf(8), 1, data, 0)).toMatchObject({ now: false, troops: ["박쥐"] });
    expect(enemyOf(evOf(8), 1, data, 1)).toMatchObject({ now: true, touch: true });
  });

  it("resolves troop names", () => {
    expect(battleTroop(data, [0, 2])).toBe("박쥐");
    expect(battleTroop(data, [0, 4])).toBe("적 그룹 4");
    expect(battleTroop(data, [0, 99])).toBe("적 그룹 99");
    expect(battleTroop(data, [1, 3])).toBe("변수로 정해짐");
    expect(battleTroop(data, [2, 0])).toBe("맵 랜덤 적");
  });

  it("describes an enemy", () => {
    expect(describeEnemy(enemyOf(evOf(1), 1, data, 0)!)).toBe("적 · 슬라임*2 · 부딪히면 전투 · 쫓아옴 · 도망 가능");
    expect(describeEnemy(enemyOf(evOf(2), 1, data, 0)!)).toBe("적 · 변수로 정해짐 · 말 걸면 전투 · 도망 못 감 · 져도 계속");
    expect(describeEnemy(enemyOf(evOf(6), 1, data, 0)!)).toBe("적일 수 있음 · 플러그인으로 전투 · 부딪히면 전투 · 쫓아옴");
  });
});

describe("enemy section in the map checklist", () => {
  const livePages = [1, 2, 3, 4, 5, 6, 7, 8, 10].map(id => ({ eventId: id, page: 0 })).concat([{ eventId: 9, page: -1 }]);
  const m = mapChecklist(data, index, coverage(), live({ events: livePages }))!;

  it("puts current enemies in the enemy section with their describe line", () => {
    expect(find(m.events, 1)).toMatchObject({ section: "enemy", describe: "적 · 슬라임*2 · 부딪히면 전투 · 쫓아옴 · 도망 가능" });
    expect(find(m.events, 3)?.section).toBe("enemy");
    expect(find(m.events, 4)?.section).toBe("enemy");
    expect(find(m.events, 6)?.section).toBe("enemy");
    expect(find(m.events, 2)).toMatchObject({ section: "enemy", unseen: 1 });
    expect(find(m.events, 2)?.describe).toBe("적 · 변수로 정해짐 · 말 걸면 전투 · 도망 못 감 · 져도 계속 · “덤벼라”");
  });

  it("leaves non-enemies and not-yet enemies alone; disappeared enemies are not listed", () => {
    expect(find(m.events, 10)?.section).toBe("now");
    expect(find(m.events, 8)).toMatchObject({ section: "now", enemy: { now: false } });
    expect(find(m.events, 9)).toBeUndefined();
    const turned = mapChecklist(data, index, coverage(), live({ switches: [5] }))!;
    expect(find(turned.events, 8)?.section).toBe("enemy");
  });

  it("counts enemies in remaining only when they hold unseen dialogue", () => {
    // 2(보스: 안 본 대사) + 8·10(안 본 대사) — 다른 적은 안 센다
    expect(m.remaining).toBe(3);
    const cov = coverage();
    cov.seen.add(seenKey({ source: "map", mapId: 1, eventId: 2, page: 0 }, 0));
    expect(mapChecklist(data, index, cov, live({ events: livePages }))!.remaining).toBe(2);
  });

  it("orders enemies after exits and before talk", () => {
    const sections = m.events.filter(e => !e.story).map(e => e.section);
    expect(sections.indexOf("enemy")).toBeGreaterThan(sections.lastIndexOf("now"));
  });
});

/** w×h 모두 통과 */
function open(w: number, h: number): { map: MapTiles; tileset: TilesetInfo } {
  return { map: { mapId: 1, width: w, height: h, tilesetId: 1, data: new Array(w * h * 6).fill(0) }, tileset: { id: 1, mode: 1, names: [], flags: [0] } };
}

describe("routes around enemies", () => {
  const target = { x: 6, y: 1, priorityType: 0, trigger: 0, through: false };

  it("avoids enemy tiles and chasing enemies' neighbours", () => {
    const { map, tileset } = open(8, 3);
    const stands = standTiles(target, map, tileset);
    const avoid = enemyTiles([{ eventId: 1, x: 3, y: 1, chase: false }], 2);
    const r = routeAvoiding(map, tileset, { x: 0, y: 1 }, stands, new Set(), avoid);
    expect(r.throughAvoid).toBe(false);
    expect(r.route?.steps.some(s => s.x === 3 && s.y === 1)).toBe(false);
    expect(enemyTiles([{ eventId: 1, x: 3, y: 1, chase: true }], 2)).toEqual(new Set(["3,1", "3,2", "3,0", "4,1", "2,1"]));
    expect(enemyTiles([{ eventId: 1, x: 3, y: 1, chase: true }], 1).size).toBe(0);
  });

  it("falls back to enemy tiles only, then to the normal route through enemies", () => {
    const { map, tileset } = open(8, 3);
    const stands = standTiles(target, map, tileset);
    const chaser = [{ eventId: 1, x: 3, y: 1, chase: true }];
    // 쫓아오는 적의 이웃까지 막으면 3칸 높이 맵을 못 지나가지만, 적 칸만 피하면 갈 수 있다
    const soft = routeAvoiding(map, tileset, { x: 0, y: 1 }, stands, new Set(), enemyTiles(chaser, 2), enemyTiles(chaser, 2, false));
    expect(soft.throughAvoid).toBe(false);
    expect(soft.route?.steps.some(s => s.x === 3 && s.y === 1)).toBe(false);
    // 1칸 높이 복도: 적을 지나가야 한다
    const narrow = open(8, 1);
    const st2 = standTiles({ ...target, y: 0 }, narrow.map, narrow.tileset);
    const wall = enemyTiles([{ eventId: 1, x: 3, y: 0, chase: false }], 2);
    const r = routeAvoiding(narrow.map, narrow.tileset, { x: 0, y: 0 }, st2, new Set(), wall);
    expect(r.throughAvoid).toBe(true);
    expect(r.route?.steps.at(-1)).toEqual({ x: 6, y: 0 });
  });
});

describe("random encounters", () => {
  it("lists troops with chance and regions", () => {
    const enc = mapEncounters(data, 1)!;
    expect(enc.step).toBe(25);
    expect(enc.regions).toEqual([1, 2]);
    expect(enc.entries).toEqual([
      { troopId: 1, name: "슬라임*2", weight: 5, chance: 50, regions: [] },
      { troopId: 2, name: "박쥐", weight: 5, chance: 50, regions: [] },
      { troopId: 3, name: "늑대", weight: 10, chance: 50, regions: [1, 2] },
    ]);
  });

  it("rounds chances and returns null without encounters", () => {
    const three: MapData = { ...field, encounterList: [1, 2, 3].map(t => ({ troopId: t, weight: 1, regionSet: [] })) };
    const d2: GameData = { ...data, maps: new Map([[1, three], [2, { ...field, encounterList: [] }]]) };
    expect(mapEncounters(d2, 1)!.entries.map(e => e.chance)).toEqual([33.3, 33.3, 33.3]);
    expect(mapEncounters(d2, 2)).toBeNull();
    expect(mapEncounters(d2, 99)).toBeNull();
  });

  it("extracts region cells from tile layer 5", () => {
    const { map } = open(3, 2);
    const z5 = 5 * 3 * 2;
    map.data[z5 + 0] = 1;          // (0,0)
    map.data[z5 + 1 * 3 + 2] = 2;  // (2,1)
    map.data[z5 + 4] = 7;          // (1,1) 다른 구역
    expect(regionCells(map, [1, 2])).toEqual([{ x: 0, y: 0, region: 1 }, { x: 2, y: 1, region: 2 }]);
    expect(regionCells(map, [])).toEqual([]);
  });
});
