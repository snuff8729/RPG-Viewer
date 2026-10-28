import { describe, expect, it } from "vitest";
import { buildIndex } from "../index/buildIndex";
import type { MapTiles, TilesetInfo } from "../map/tiles";
import type { CommonEvent, EventCommand, EventPage, GameData, Location, MapData, MapEvent, PageConditions } from "../types";
import { seenKey } from "./coverage";
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
const page = (list: EventCommand[], o: Omit<Partial<EventPage>, "image"> & { sw?: number; image?: EventPage["image"] | null } = {}): EventPage => {
  const { sw, image, ...rest } = o;
  return {
    conditions: sw ? { ...noCond, switch1Valid: true, switch1Id: sw } : noCond, trigger: 0, priorityType: 1,
    list: [...list, c(0)], ...(image === null ? {} : { image: image ?? img("People1") }), ...rest,
  };
};
const ev = (id: number, name: string, pages: EventPage[], o: Partial<MapEvent> = {}): MapEvent => ({ id, name, x: id, y: 1, pages, ...o });
const transfer = (mapId: number, indent = 0) => c(201, [0, mapId, 3, 4, 2, 0], indent);

const house: MapData = {
  displayName: "", width: 16, height: 10,
  events: [
    null,
    // #1 사용자가 말한 출구: 지금 페이지는 "역시 피곤하다"(이동 안 함), 다른 페이지가 장소 이동
    ev(1, "Move", [
      page([c(117, [10]), c(356, ["TMng Search 역시 피곤하다. 외출은 하지 말자."]), c(117, [11])], { trigger: 1, image: img("!Arrow") }),
      page([c(117, [12]), transfer(2)], { trigger: 1, sw: 5, image: img("!Arrow") }),
    ]),
    // TemplateEvent: 템플릿 페이지가 원래 이벤트를 부르고 그 안에서 이동
    ev(2, "TE문", [page([c(356, ["TE固有イベント呼び出し"])], { trigger: 1, image: null })], {
      note: "<TE:Move→>", originalPages: [page([transfer(2)], { image: null })],
    }),
    ev(3, "공통 문", [page([c(117, [20])], { trigger: 1, image: null })]),             // CE 20 → CE 21 → 이동 (깊이 2)
    ev(4, "깊은 문", [page([...msg("멀다"), c(117, [22])], { image: null })]),           // CE 22 → 20 → 21: 깊이 3이라 출구 아님
    ev(5, "주민", [page(msg("안녕하세요"), { moveType: 1 })]),
    ev(6, "상자", [page(msg("상자다"), { image: img("!Chest") })]),
    ev(7, "Temp_PC", [page(msg("컴퓨터 화면"), { image: null, priorityType: 0 })]),       // 그림 없음 + 이름으로 불림
    ev(8, "호출자", [page([c(356, ["TE_CALL_MAP_EVENT 1 Temp_PC"])])]),
    ev(9, "책장", [page([c(356, ["TMng Search 낡은 책장."])], { image: null })]),        // 그림 없음, 아무도 안 부름
    ev(10, "숨은 것", [page(msg("숨은 말"), { image: null })]),                           // 스크립트 event(10)로 불림
    ev(11, "연출", [page([c(355, ["$gameMap.event(10).start();"])], { trigger: 3, image: null })]),
    ev(12, "갇힌 사람", [page(msg("여기서 못 나가"))], { x: 8, y: 8 }),
    // 대사·선택지 뒤에 이동하는 책: 출구가 아니라 다음에 할 이야기
    ev(13, "回忆书", [page([
      ...msg("오래된 책이다"), c(102, [["읽는다", "그만둔다"], 1, 0, 2, 0]), c(402, [0, "읽는다"]), transfer(2, 1), c(0, [], 1),
      c(402, [1, "그만둔다"]), c(0, [], 1), c(404),
    ], { image: img("!_clutter") })]),
    ev(14, "잡동사니", [page([...msg("시스템"), c(117, [10])])]),                          // 많이 불리는 공통 이벤트 안의 이동은 무시
    // TemplateEvent로 부른 원래 페이지에 대사가 있으면 출구가 아니다
    ev(15, "TE책", [page([c(356, ["TE固有イベント呼び出し"])], { image: img("!_clutter") })], {
      originalPages: [page([...msg("책 속으로"), transfer(2)], { image: null })],
    }),
  ],
};
const ce = (id: number, list: EventCommand[]): CommonEvent => ({ id, name: `CE${id}`, trigger: 0, switchId: 1, list: [...list, c(0)] });
const commonEvents: (CommonEvent | null)[] = [];
commonEvents[10] = ce(10, [transfer(2)]);
commonEvents[11] = ce(11, []);
commonEvents[12] = ce(12, []);
commonEvents[20] = ce(20, [c(117, [21])]);
commonEvents[21] = ce(21, [transfer(2)]);
commonEvents[22] = ce(22, [c(117, [20])]);
// CE 10을 MANY_CALLERS 곳 이상에서 부르는 공통 이벤트(시스템 처리기 흉내)
commonEvents[40] = ce(40, Array.from({ length: MANY_CALLERS }, () => c(117, [10])));

const data: GameData = {
  engine: "MZ", dataRoot: "data", imgRoot: "img",
  system: { gameTitle: "", currencyUnit: "G", switches: [], variables: [] },
  mapInfos: [null, { id: 1, name: "집", parentId: 0, order: 1 }, { id: 2, name: "밖", parentId: 0, order: 2 }],
  maps: new Map([[1, house], [2, { displayName: "", width: 5, height: 5, events: [] }]]),
  commonEvents, troops: [null], actors: [null], items: [null], weapons: [null], armors: [null], errors: [],
};
const index = buildIndex(data);
const at = (eventId: number, pg = 0): Location => ({ source: "map", mapId: 1, eventId, page: pg });
const coverage = (seen: Location[] = []): Coverage => ({
  seen: new Set(seen.map(l => seenKey(l, 0))), picks: new Map(), uncertainSeqs: new Set(), changedSeqs: new Set(),
  touched: new Set(), pluginRan: new Set(),
});
const live = (over: Partial<LiveSnapshot> = {}): LiveSnapshot => ({
  v: 1, t: 0, pluginVersion: "1.4.0", run: 1, branch: 1, seq: 0, mapId: 1, x: 0, y: 0, running: null,
  events: [], switches: [], variables: {}, selfSwitches: [], items: {}, weapons: {}, armors: {},
  gold: 0, party: [], choice: null, inBattle: false, ...over,
});
const find = (evs: ChecklistEvent[], id: number) => evs.find(e => e.eventId === id)!;

/** 16×10, 모두 통과. (7..15, 7)과 (7, 7..9)는 벽 → (8..15, 8..9)는 갇힌 곳 */
function passage(): { map: MapTiles; tileset: TilesetInfo } {
  const w = 16, h = 10;
  const tiles = new Array(w * h * 6).fill(0);
  // 벽은 맨 위 층(3)에: 위층부터 보므로 거기서 막힌다
  const z3 = 3 * w * h;
  for (let i = 7; i < w; i++) tiles[z3 + 7 * w + i] = 1;
  for (let i = 7; i < h; i++) tiles[z3 + i * w + 7] = 1;
  return { map: { mapId: 1, width: w, height: h, tilesetId: 1, data: tiles }, tileset: { id: 1, mode: 1, names: [], flags: [0, 0x0f] } };
}

describe("mapChecklist exits", () => {
  const m = mapChecklist(data, index, coverage(), live())!;

  it("an event whose other page transfers is an exit, never untried, not counted", () => {
    const move = find(m.events, 1);
    expect(move).toMatchObject({ section: "exit", exit: { mapId: 2, mapName: "밖", now: false } });
    expect(move.untried).toBeUndefined();
    expect(move.describe).toBe("출구 · 지금은 이동 안 됨 · “역시 피곤하다. 외출은 하지 말자.”");
    const open = find(mapChecklist(data, index, coverage(), live({ switches: [5] }))!.events, 1);
    expect(open.exit).toEqual({ mapId: 2, mapName: "밖", now: true });
    expect(open.describe).toBe("출구 · 밟으면 시작");
  });

  it("finds transfers through TemplateEvent calls and common events up to depth 2", () => {
    expect(find(m.events, 2)).toMatchObject({ section: "exit", exit: { mapId: 2, now: true } });
    expect(find(m.events, 3)).toMatchObject({ section: "exit", exit: { mapId: 2, now: true } });
    expect(find(m.events, 4).section).not.toBe("exit");
    expect(find(m.events, 4).exit).toBeUndefined();
  });

  it("skips common events called from many places (system handlers)", () => {
    expect(find(m.events, 14).section).not.toBe("exit");
  });

  it("pages with dialogue or choices that transfer are not exits; describe says where it can take you", () => {
    const book = find(m.events, 13);
    expect(book).toMatchObject({ section: "now", unseen: 1, unpicked: 2 });
    expect(book.exit).toBeUndefined();
    expect(book.describe).toBe("물건 · 말 걸기·조사 · “오래된 책이다” · → 밖로 이동할 수 있음");
    const teBook = find(m.events, 15);
    expect(teBook.section).toBe("now");
    expect(teBook.exit).toBeUndefined();
    expect(teBook.describe).toContain("→ 밖로 이동할 수 있음");
  });
});

describe("mapChecklist describe", () => {
  const m = mapChecklist(data, index, coverage(), live())!;
  it("kind, how it starts, moving, and a preview line", () => {
    expect(find(m.events, 5)).toMatchObject({ moves: true, describe: "사람·NPC · 말 걸기·조사 · 돌아다님 · “안녕하세요”" });
    expect(find(m.events, 6)).toMatchObject({ moves: false, describe: "물건 · 말 걸기·조사 · “상자다”" });
    expect(find(m.events, 9).describe).toBe("보이지 않는 이벤트 — 표시된 칸에서 확인 버튼 · “낡은 책장.”");
  });
  it("prefers the first unseen line", () => {
    const two: MapData = { ...house, events: [null, ev(1, "둘", [page([...msg("첫 줄"), ...msg("둘째 줄")])])] };
    const d2: GameData = { ...data, maps: new Map([[1, two]]) };
    const cov: Coverage = { ...coverage(), seen: new Set([seenKey(at(1), 0)]) };
    expect(mapChecklist(d2, buildIndex(d2), cov, live())!.events[0].describe).toBe("사람·NPC · 말 걸기·조사 · “둘째 줄”");
  });
});

describe("mapChecklist background events", () => {
  it("invisible events called by others go to story with who calls them", () => {
    const m = mapChecklist(data, index, coverage(), live())!;
    expect(find(m.events, 7)).toMatchObject({
      story: true, background: "called", calledBy: "호출자",
      describe: "직접 갈 수 없는 곳 — 다른 이벤트가 실행시켜요 · 호출자이(가) 불러요",
    });
    expect(find(m.events, 7).number).toBeUndefined();
    expect(find(m.events, 10)).toMatchObject({ story: true, background: "called", calledBy: "연출" });
    // 아무도 안 부르는 보이지 않는 조사 지점은 그대로
    expect(find(m.events, 9).background).toBeUndefined();
    expect(find(m.events, 9).story).toBe(false);
  });

  it("unreachable events (needs map tiles) go to story and are not counted", () => {
    const without = mapChecklist(data, index, coverage(), live())!;
    expect(find(without.events, 12).background).toBeUndefined();
    const withTiles = mapChecklist(data, index, coverage(), live(), passage())!;
    expect(find(withTiles.events, 12)).toMatchObject({
      story: true, background: "unreachable", describe: "직접 갈 수 없는 곳 — 다른 이벤트가 실행시켜요",
    });
    expect(find(withTiles.events, 12).number).toBeUndefined();
    expect(withTiles.remaining).toBe(without.remaining - 1);
    // 갇힌 곳 안에서 시작하면(플레이어 위치) 갈 수 있다
    const inside = mapChecklist(data, index, coverage(), live({ x: 9, y: 9 }), passage())!;
    expect(find(inside.events, 12).background).toBeUndefined();
    // 다른 맵의 타일이면 무시
    const other = passage();
    other.map.mapId = 2;
    expect(find(mapChecklist(data, index, coverage(), live(), other)!.events, 12).background).toBeUndefined();
  });
});

describe("mapChecklist numbers", () => {
  const numbers = (m: ReturnType<typeof mapChecklist>) => new Map(m!.events.filter(e => e.number != null).map(e => [e.eventId, e.number] as const).sort((a, b) => a[0] - b[0]));
  it("fixed by map data in event id order; story events leave a gap", () => {
    const m = mapChecklist(data, index, coverage(), live())!;
    // 7·10(다른 이벤트가 부름)은 번호 7·10을 갖지만 안 보인다. 11은 자동 실행뿐이라 번호 없음
    expect([...numbers(m)]).toEqual([[1, 1], [2, 2], [3, 3], [4, 4], [5, 5], [6, 6], [8, 8], [9, 9], [12, 11], [13, 12], [14, 13], [15, 14]]);
  });
  it("are identical with and without map tiles", () => {
    const without = numbers(mapChecklist(data, index, coverage(), live()));
    const withTiles = numbers(mapChecklist(data, index, coverage(), live(), passage()));
    expect(withTiles.has(12)).toBe(false); // 갈 수 없어 이야기·자동 진행 — 번호만 안 보임
    without.delete(12);
    expect(withTiles).toEqual(without);
  });
  it("do not change when sections change", () => {
    const before = mapChecklist(data, index, coverage(), live())!;
    const after = mapChecklist(data, index, coverage([at(5), at(6), at(4), at(14), at(12)]), live({ switches: [5] }))!;
    expect(find(before.events, 5).section).toBe("now");
    expect(find(after.events, 5).section).toBe("talk");
    expect(numbers(after)).toEqual(numbers(before));
  });
});
