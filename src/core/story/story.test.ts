import { describe, expect, it } from "vitest";
import type { LiveSnapshot } from "../live/types";
import type { CommonEvent, EventCommand, EventPage, GameData, MapData, MapEvent, PageConditions } from "../types";
import { addonsJson, parseAddonFile } from "../addons/settings";
import { pathText, stepAction, stepTitle, storyMark } from "./format";
import { nextStory } from "./nextStep";
import { keyText, parseKeyText, storyCandidates, storyValue } from "./progress";
import { mapPath, transferGraph } from "./transfer";

// ---- 합성 데이터 도우미 ----
const c = (code: number, parameters: any[] = [], indent = 0): EventCommand => ({ code, indent, parameters });
const noCond: PageConditions = {
  switch1Valid: false, switch1Id: 1, switch2Valid: false, switch2Id: 1,
  variableValid: false, variableId: 1, variableValue: 0,
  selfSwitchValid: false, selfSwitchCh: "A",
  itemValid: false, itemId: 1, actorValid: false, actorId: 1,
};
const NPC = { tileId: 0, characterName: "Actor1", characterIndex: 0, direction: 2, pattern: 0 };
const page = (list: EventCommand[], cond: Partial<PageConditions> = {}, trigger = 0, npc = true): EventPage =>
  ({ conditions: { ...noCond, ...cond }, trigger, list: [...list, c(0)], ...(npc ? { image: NPC } : {}) });
const ev = (id: number, pages: EventPage[], name = `E${id}`): MapEvent => ({ id, name, x: id, y: 2, pages });
const map = (events: MapEvent[]): MapData => ({ displayName: "", width: 20, height: 20, events: [null, ...events] });
const say = (text: string, indent = 0) => [c(101, ["", 0, 0, 2], indent), c(401, [text], indent)];
const setVar = (id: number, v: number, indent = 0) => c(122, [id, id, 0, 0, v], indent);
const addVar = (id: number, v: number, indent = 0) => c(122, [id, id, 1, 0, v], indent);
const subVar = (id: number, v: number, indent = 0) => c(122, [id, id, 2, 0, v], indent);
const swOn = (id: number, indent = 0) => c(121, [id, id, 0], indent);
const go = (mapId: number) => c(201, [0, mapId, 1, 1, 2, 0]);
const pv = (v: number, id = 1): Partial<PageConditions> => ({ variableValid: true, variableId: id, variableValue: v });
const sw1 = (id: number): Partial<PageConditions> => ({ switch1Valid: true, switch1Id: id });

const MAP_NAMES = ["", "마을", "숲", "동굴", "성", "탑"];
function game(maps: [number, MapData][], opts: { variables?: string[]; switches?: string[]; commonEvents?: CommonEvent[] } = {}): GameData {
  return {
    engine: "MZ", dataRoot: "data", imgRoot: "img",
    system: {
      gameTitle: "", currencyUnit: "G",
      switches: opts.switches ?? ["", "S1", "S2", "S3", "S4", "S5"],
      variables: opts.variables ?? ["", "本編進行", "カウント", "temp"],
    },
    mapInfos: [null, ...MAP_NAMES.slice(1).map((name, i) => ({ id: i + 1, name, parentId: 0, order: i + 1 }))],
    maps: new Map(maps),
    commonEvents: [null, ...(opts.commonEvents ?? [])], troops: [null],
    actors: [null], items: [null], weapons: [null], armors: [null], errors: [],
  };
}
const live = (over: Partial<LiveSnapshot> = {}): LiveSnapshot => ({
  v: 1, t: 0, pluginVersion: "", run: 1, branch: 1, seq: 0, mapId: 1, x: 0, y: 0, running: null,
  events: [], switches: [], variables: {}, selfSwitches: [], items: {}, weapons: {}, armors: {},
  gold: 0, party: [], choice: null, inBattle: false, ...over,
});

describe("storyCandidates", () => {
  it("scores the progress-named, widely-gated, increasing variable first", () => {
    const data = game([
      [1, map([
        ev(1, [page([...say("시작하자"), ...say("두 번째"), ...say("세 번째"), setVar(1, 1)])]),
        ev(2, [page(say("1장"), pv(1)), page([...say("a"), ...say("b"), ...say("c"), setVar(1, 2)], pv(1))]),
        ev(3, [page([addVar(2, 1)]), page(say("세었다"), pv(3, 2))]),
      ])],
      [2, map([ev(1, [page([...say("x"), ...say("y"), ...say("z"), setVar(1, 3)], pv(2))]), ev(2, [page([subVar(2, 1)], pv(1, 2))])])],
      [3, map([ev(1, [page(say("끝"), pv(3))])])],
    ]);
    const cands = storyCandidates(data);
    expect(cands[0].key).toEqual({ kind: "variable", id: 1 });
    expect(cands[0].reasons.join(" ")).toContain("출현 조건");
    const count = cands.find(x => x.key.kind === "variable" && x.key.id === 2);
    if (count) expect(count.score).toBeLessThan(cands[0].score);
    expect(cands.some(x => x.key.kind === "variable" && x.key.id === 3)).toBe(false);
  });

  it("falls back to a group of clear switches", () => {
    const data = game([
      [1, map([
        ev(1, [page([swOn(1)]), page(say("1장 끝"), sw1(1))]),
        ev(2, [page([swOn(2)], sw1(1)), page(say("2장 끝"), sw1(2))]),
      ])],
    ], { switches: ["", "1章クリア", "2章クリア", "扉"], variables: [""] });
    const cands = storyCandidates(data);
    expect(cands[0].key).toEqual({ kind: "switches", ids: [1, 2] });
    expect(storyValue(cands[0].key, live({ switches: [1] }))).toBe(1);
  });

  // 맵마다 이벤트를 차례로 쌓는 도우미
  const builder = () => {
    const evs = new Map<number, MapEvent[]>();
    const put = (mapId: number, pages: EventPage[]) => {
      const list = evs.get(mapId) ?? [];
      list.push(ev(list.length + 1, pages));
      evs.set(mapId, list);
    };
    const maps = (): [number, MapData][] => [...evs].map(([id, list]) => [id, map(list)]);
    return { put, maps };
  };
  const talk3 = [...say("가"), ...say("나"), ...say("다")];
  const ce = (id: number, list: EventCommand[]): CommonEvent => ({ id, name: `CE${id}`, trigger: 0, switchId: 1, list: [...list, c(0)] });

  it("neutral names: the variable set 1..12 across 12 maps beats a counter bumped by a widely called common event", () => {
    const b = builder();
    for (let k = 1; k <= 12; k++) b.put(k, [page([...talk3, setVar(1, k)], k > 1 ? pv(k - 1, 1) : {})]);
    for (let i = 0; i < 40; i++) b.put((i % 12) + 1, [page([...say("또"), c(117, [1])])]);
    for (let i = 0; i < 20; i++) b.put((i % 10) + 1, [page(say("세었다"), pv(i + 1, 2))]);
    const data = game(b.maps(), { variables: ["", "T_043798", "T_043799"], commonEvents: [ce(1, [addVar(2, 1)])] });
    const cands = storyCandidates(data);
    expect(cands[0].key).toEqual({ kind: "variable", id: 1 });
    const counter = cands.find(x => x.key.kind === "variable" && x.key.id === 2);
    if (counter) expect(counter.score).toBeLessThan(cands[0].score - 20);
  });

  // 실제 게임의 다섯 이름을 그럴듯한 쓰임새로 재현한다(1 淫乱レベル, 2 チャプター, 3 進行中ミッション, 4 捕獲起動イベント種別, 5 痴漢調査進行度)
  const realGame = (names: string[]) => {
    const b = builder();
    // 1 淫乱レベル: 넓게 조건으로 쓰이고, 널리 불리는 공통 이벤트에서 더하며, 가끔 내려간다
    for (let i = 0; i < 45; i++) b.put((i % 15) + 1, [page(say("음"), pv((i % 5) + 1, 1))]);
    for (let i = 0; i < 30; i++) b.put((i % 15) + 1, [page([...say("H"), c(117, [1])])]);
    for (let k = 1; k <= 5; k++) b.put(k + 2, [page([...talk3, setVar(1, k)], pv(k - 1, 1))]);
    for (let i = 0; i < 3; i++) b.put(i + 1, [page([...say("벌"), subVar(1, 1)])]);
    // 2 チャプター: 1..8을 여러 맵의 대사 이벤트에서 차례로 정한다
    for (let k = 1; k <= 8; k++) b.put(k, [page([...talk3, setVar(2, k)], k > 1 ? pv(k - 1, 2) : {})]);
    for (let i = 0; i < 10; i++) b.put((i % 8) + 1, [page(say("장"), pv((i % 8) + 1, 2))]);
    // 3 進行中ミッション: 임무 번호를 정했다가 끝나면 0으로 되돌린다
    for (let k = 1; k <= 6; k++) {
      b.put(k, [page([...talk3, setVar(3, k)])]);
      b.put(k + 1, [page([...say("완료"), setVar(3, 0)], pv(k, 3))]);
    }
    for (let i = 0; i < 12; i++) b.put((i % 8) + 1, [page(say("임무"), pv((i % 6) + 1, 3))]);
    // 4 捕獲起動イベント種別: 공통 이벤트가 종류 번호를 정하고 분기로 나눈다
    for (let i = 0; i < 10; i++) b.put((i % 5) + 1, [page([...say("잡혔다"), c(117, [2])])]);
    for (let i = 0; i < 8; i++) b.put((i % 4) + 1, [page(say("종류"), pv((i % 8) + 1, 4))]);
    // 5 痴漢調査進行度: 몇 맵에서 조사를 진행한다
    for (let k = 1; k <= 5; k++) b.put((k % 3) + 1, [page([...talk3, setVar(5, k)], k > 1 ? pv(k - 1, 5) : {})]);
    for (let i = 0; i < 6; i++) b.put((i % 3) + 1, [page(say("조사"), pv((i % 5) + 1, 5))]);
    const kinds: EventCommand[] = [];
    for (let k = 1; k <= 10; k++) kinds.push(setVar(4, k), c(111, [1, 4, 0, k, 0]));
    return game(b.maps(), { variables: ["", ...names], commonEvents: [ce(1, [addVar(1, 1)]), ce(2, kinds)] });
  };

  it("real names: チャプター beats 淫乱レベル, 進行中ミッション, 捕獲起動イベント種別, 痴漢調査進行度", () => {
    const cands = storyCandidates(realGame(["淫乱レベル", "チャプター", "進行中ミッション", "捕獲起動イベント種別", "痴漢調査進行度"]));
    expect(cands[0].key).toEqual({ kind: "variable", id: 2 });
    const score = (id: number) => cands.find(x => x.key.kind === "variable" && x.key.id === id)?.score ?? -Infinity;
    for (const id of [1, 3, 4, 5]) expect(score(id)).toBeLessThan(score(2));
    // 같은 쓰임새에 이름을 지워도 チャプター 자리가 이긴다
    const neutral = storyCandidates(realGame(["T_1", "T_2", "T_3", "T_4", "T_5"]));
    expect(neutral[0].key).toEqual({ kind: "variable", id: 2 });
  });

  it("key text round-trips", () => {
    expect(parseKeyText(keyText({ kind: "variable", id: 12 }))).toEqual({ kind: "variable", id: 12 });
    expect(parseKeyText(keyText({ kind: "switches", ids: [3, 4] }))).toEqual({ kind: "switches", ids: [3, 4] });
    expect(parseKeyText("x")).toBeNull();
    expect(parseKeyText(5)).toBeNull();
  });
});

describe("nextStory", () => {
  const P = { kind: "variable", id: 1 } as const;

  it("picks the writer available now that raises P from exactly v", () => {
    const data = game([
      [1, map([
        ev(1, [page([...say("가자, 숲으로!"), setVar(1, 3)], pv(2))], "촌장"),
        ev(2, [page([...say("나중 일"), setVar(1, 4)], pv(3))], "병사"),
        ev(3, [page([...say("디버그"), setVar(1, 9)])], "デバッグ"),
      ])],
    ]);
    const r = nextStory(data, live({ variables: { "1": 2 } }), P)!;
    expect(r.value).toBe(2);
    expect(r.label).toBe("本編進行");
    const s = r.steps[0];
    expect([s.mapId, s.eventId, s.kind, s.confidence, s.availableNow]).toEqual([1, 1, "talk", "high", true]);
    expect(s.preview).toBe("가자, 숲으로!");
    expect(s.effect).toBe("本編進行 2 → 3");
    expect(s.path?.maps).toEqual([1]);
    expect(r.steps.some(x => x.eventName === "デバッグ")).toBe(false);
    expect(r.steps.some(x => x.eventName === "병사")).toBe(false);
    expect(stepTitle(s)).toBe("마을 · 촌장에게 말 걸기 — “가자, 숲으로!”");
    expect(pathText(s.path)).toBe("이 맵에 있어요");
  });

  it("autorun on another map: enter that map, with the exit to take on this map", () => {
    const data = game([
      [1, map([ev(5, [page([go(2)], {}, 1, false)], "숲 입구")])],
      [2, map([ev(1, [page([...say("숲에 들어서자 바람이…"), setVar(1, 4)], pv(3), 3, false)], "숲 이벤트")])],
    ]);
    const r = nextStory(data, live({ variables: { "1": 3 } }), P)!;
    const s = r.steps[0];
    expect([s.mapId, s.kind, s.availableNow]).toEqual([2, "enter", true]);
    expect(stepAction(s)).toBe("숲에 들어가기");
    expect(s.path?.maps).toEqual([1, 2]);
    expect(s.path?.firstExit?.eventId).toBe(5);
    expect(pathText(s.path)).toBe("이 맵 → 숲");
  });

  it("an event already finished on another map (self switch → later page) is not available", () => {
    const data = game([
      [1, map([])],
      [2, map([
        ev(1, [page([...say("고마워"), addVar(1, 1), c(123, ["A", 0])]), page(say("또 왔네"), { selfSwitchValid: true, selfSwitchCh: "A" })], "소녀"),
        ev(2, [page([...say("부탁이 있어"), addVar(1, 1)], pv(4))], "소년"),
      ])],
    ]);
    const r = nextStory(data, live({ variables: { "1": 4 }, selfSwitches: ["2,1,A"] }), P)!;
    expect(r.steps[0].eventName).toBe("소년");
    expect(r.steps.find(s => s.eventName === "소녀")?.availableNow ?? false).toBe(false);
  });

  it("autorun page that opens at v without writing P", () => {
    const data = game([
      [1, map([])],
      [3, map([ev(2, [page(say("동굴이 울린다"), pv(5), 3, false)], "울림")])],
    ]);
    const r = nextStory(data, live({ variables: { "1": 5 } }), P)!;
    expect(r.steps[0].mapId).toBe(3);
    expect(r.steps[0].effect).toBe("이야기가 이어져요");
    expect(r.steps[0].path).toBeNull();   // 이어지는 출구가 없다
  });

  it("writer under a choice branch reports the choice to pick", () => {
    const data = game([[1, map([
      ev(1, [page([
        ...say("같이 갈래?"),
        c(102, [["간다", "안 간다"], 1]), c(402, [0, "간다"]), setVar(1, 2, 1), c(0, [], 1),
        c(402, [1, "안 간다"]), c(0, [], 1), c(404),
      ], pv(1))], "동료"),
    ])]]);
    const s = nextStory(data, live({ variables: { "1": 1 } }), P)!.steps[0];
    expect(s.choice).toBe("간다");
    expect(s.eventName).toBe("동료");
  });

  it("not available now: prerequisite steps from howTo and path to the first one", () => {
    const data = game([
      [1, map([ev(1, [page([go(4)], {}, 1, false)], "성문")])],
      [2, map([ev(1, [page([...say("열쇠를 가져왔군"), setVar(1, 7)], { ...pv(6), ...sw1(5) })], "문지기")])],
      [4, map([ev(3, [page([...say("이걸 가져가"), swOn(5)])], "노인")])],
    ]);
    const r = nextStory(data, live({ variables: { "1": 6 } }), P)!;
    const s = r.steps[0];
    expect(s.availableNow).toBe(false);
    expect(s.eventName).toBe("문지기");
    expect(s.prereqs[0].action).toBe("스위치 [S5] 켜기");
    expect(s.prereqs[0].where).toContain("성 › 노인");
    expect(s.confidence).toBe("mid");
    expect(s.path?.maps).toEqual([1, 4]);
  });

  it("switch group: next off switch's writer", () => {
    const data = game([[1, map([
      ev(1, [page([...say("1장 끝"), swOn(1)])], "왕"),
      ev(2, [page([...say("2장 끝"), swOn(2)], sw1(1))], "여왕"),
    ])]], { switches: ["", "1章クリア", "2章クリア"], variables: [""] });
    const r = nextStory(data, live({ switches: [1] }), { kind: "switches", ids: [1, 2] })!;
    expect(r.value).toBe(1);
    expect(r.steps[0].eventName).toBe("여왕");
    expect(r.steps[0].confidence).toBe("high");
    expect(r.steps[0].effect).toBe("스위치 [2章クリア] 켜짐");
  });

  it("common event writer is placed at its calling map event", () => {
    const data = game([[1, map([ev(4, [page([...say("보고하자"), c(117, [1])], pv(1))], "기사")])]],
      { commonEvents: [{ id: 1, name: "보고", trigger: 0, switchId: 0, list: [setVar(1, 2), c(0)] }] });
    const s = nextStory(data, live({ variables: { "1": 1 } }), P)!.steps[0];
    expect([s.mapId, s.eventId, s.eventName, s.availableNow]).toEqual([1, 4, "기사", true]);
  });

  it("nothing found → empty steps; bad input → null", () => {
    const data = game([[1, map([])]]);
    expect(nextStory(data, live(), P)?.steps).toEqual([]);
    expect(nextStory(data, live(), null)).toBeNull();
    expect(nextStory(null as unknown as GameData, live(), P)).toBeNull();
  });
});

describe("storyMark and settings", () => {
  it("star on this map, exit toward another map", () => {
    const data = game([
      [1, map([ev(5, [page([go(2)], {}, 1, false)], "숲 입구"), ev(2, [page([...say("여기"), setVar(1, 2)], pv(1))], "촌장")])],
      [2, map([ev(1, [page([...say("숲"), setVar(1, 3)], pv(2))], "사냥꾼")])],
    ]);
    const here = nextStory(data, live({ variables: { "1": 1 } }), { kind: "variable", id: 1 })!.steps[0];
    expect(storyMark(here, 1)).toEqual({ kind: "star", eventId: 2, x: 2, y: 2 });
    const away = nextStory(data, live({ variables: { "1": 2 } }), { kind: "variable", id: 1 })!.steps[0];
    expect(storyMark(away, 1)).toEqual({ kind: "exit", eventId: 5, x: 5, y: 2 });
    expect(storyMark(away, 3)).toBeNull();
    expect(storyMark(undefined, 1)).toBeNull();
  });

  it("storyProgress is saved in addons.json and cleaned", () => {
    expect(parseAddonFile(addonsJson({}, null, null, null, null, "v:12"))?.storyProgress).toBe("v:12");
    expect(parseAddonFile(addonsJson({}, null, null, null, null, "bad"))).not.toHaveProperty("storyProgress");
    expect(JSON.parse(addonsJson({}, null, null, null, null, "s:3,4")).storyProgress).toBe("s:3,4");
  });

  it("addons.json round-trips adapters together with storyProgress and the other settings", () => {
    const file = parseAddonFile(addonsJson(
      { screenPictures: true, notices: true }, { 60: "cg" }, ["My.fn"], { "organ/": "hidden" },
      { "character-picture-manager": true }, "s:3,4",
    ));
    expect(file).toEqual({
      state: { screenPictures: true, notices: true },
      pictureRoles: { 60: "cg" },
      noticeHooks: ["My.fn"],
      spriteRoles: { "organ/": "hidden" },
      adapters: { "character-picture-manager": true },
      storyProgress: "s:3,4",
    });
  });
});

describe("transfer graph", () => {
  it("BFS prefers open exits and falls back to locked ones", () => {
    const data = game([
      [1, map([ev(1, [page([go(2)], {}, 1, false)]), ev(2, [page([go(3)], sw1(1), 1, false)])])],
      [2, map([ev(1, [page([go(3)], {}, 1, false)])])],
      [3, map([ev(1, [page([go(4)], sw1(2), 1, false)])])],
      [4, map([])],
    ]);
    expect(transferGraph(data).edges.get(1)?.map(e => e.to)).toEqual([2, 3]);
    const p = mapPath(data, live(), 1, 3)!;
    expect(p.maps).toEqual([1, 2, 3]);
    expect(p.firstExit?.eventId).toBe(1);
    expect(p.locked).toBe(false);
    expect(mapPath(data, live({ switches: [1] }), 1, 3)!.maps).toEqual([1, 3]);
    const q = mapPath(data, live(), 1, 4)!;
    expect(q.locked).toBe(true);
    expect(pathText(q)).toBe("이 맵 → 숲 → 동굴 → 성 (지금은 닫힌 출구를 지나요)");
    expect(mapPath(data, live(), 4, 1)).toBeNull();
  });

  it("uses the live active page on the current map", () => {
    const data = game([[1, map([ev(1, [page([go(2)], {}, 1, false), page([], sw1(1), 1, false)])])], [2, map([])]]);
    expect(mapPath(data, live({ events: [{ eventId: 1, page: 1 }] }), 1, 2)!.locked).toBe(true);
    expect(mapPath(data, live({ events: [{ eventId: 1, page: 0 }] }), 1, 2)!.locked).toBe(false);
  });
});

describe("performance", () => {
  it("400-map game: candidates + next step stay fast", () => {
    const maps: [number, MapData][] = [];
    for (let m = 1; m <= 400; m++) {
      const events: MapEvent[] = [];
      for (let e = 1; e <= 12; e++) {
        events.push(ev(e, [
          page([...say(`맵${m} 이벤트${e}`), ...say("둘째 줄"), ...say("셋째 줄")]),
          page([...say("진행"), setVar(1, m + 1)], pv(m)),
          page([...say("잡담"), addVar(2, 1)], pv(m, 1)),
        ]));
      }
      events.push(ev(13, [page([go(m + 1)], {}, 1, false)]), ev(14, [page([go(Math.max(1, m - 1))], {}, 1, false)]));
      maps.push([m, map(events)]);
    }
    const data = game(maps);
    const t0 = performance.now();
    const cands = storyCandidates(data);
    const first = nextStory(data, live({ variables: { "1": 200 } }), cands[0].key);
    const cold = performance.now() - t0;
    expect(cands[0].key).toEqual({ kind: "variable", id: 1 });
    expect(first?.steps[0].mapId).toBe(200);
    const t1 = performance.now();
    const r = nextStory(data, live({ mapId: 1, variables: { "1": 350 } }), cands[0].key);
    const warm = performance.now() - t1;
    expect(r?.steps[0].mapId).toBe(350);
    expect(r?.steps[0].path?.maps.length).toBe(350);
    expect(warm).toBeLessThan(50);
    expect(cold).toBeLessThan(3000);
  });
});
