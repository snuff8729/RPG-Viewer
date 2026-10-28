import { describe, expect, it } from "vitest";
import type { GameIndex, Location, PageEntry, ScriptNode } from "../types";
import {
  adoptLiveAssist, commandStatus, controlJson, controlMismatch, DEFAULT_ASSIST, DEFAULT_HOTKEYS, hotkeySummary, keyLabel, liveHotkeys,
  normalizeAssist, normalizeHotkeys, resyncDue, seenSets, validateHotkey, versionAtLeast,
} from "./assist";
import { pageNewCounts } from "./interactable";
import type { Coverage, PickInfo } from "./types";

const page = (location: Location, nodes: ScriptNode[]): PageEntry =>
  ({ location, path: "", title: "", nodes, conditions: [], hasDialogue: true });
const msg = (cmd: number): ScriptNode => ({ kind: "message", cmd, lines: ["x"] });
const pick = (picked: number): PickInfo => ({ picked, run: 1, branch: 1, seq: 1, aftermath: [] });
const cov = (seen: string[], picks: [string, number[]][] = []): Coverage => ({
  seen: new Set(seen), picks: new Map(picks.map(([k, ps]) => [k, ps.map(pick)])),
  uncertainSeqs: new Set(), changedSeqs: new Set(), touched: new Set(), pluginRan: new Set(),
});
const idx = (pages: PageEntry[]) => ({ pages }) as unknown as GameIndex;

const M: Location = { source: "map", mapId: 3, eventId: 5, page: 0 };
const C: Location = { source: "common", commonEventId: 7 };
const T2: Location = { source: "troop", troopId: 2, page: 0 };
const T2b: Location = { source: "troop", troopId: 2, page: 1 };
const choicePage = page(M, [
  msg(1),
  { kind: "choices", cmd: 2, branches: [{ label: "a", body: [msg(3)] }, { label: "b", body: [] }], cancelBranch: [msg(5)] },
]);

describe("pageNewCounts", () => {
  it("default ignores unseen lines inside choice branches; inChoices counts them", () => {
    const c = cov(["map:3:5:0#1"], [["map:3:5:0#2", [0, 1, -2]]]);
    expect(pageNewCounts(choicePage, c)).toEqual({ unseen: 0, unpicked: 0, dialogue: 4 });
    expect(pageNewCounts(choicePage, c, { inChoices: true })).toEqual({ unseen: 2, unpicked: 0, dialogue: 4 });
  });
  it("odd input never throws", () => {
    expect(pageNewCounts(null as unknown as PageEntry, cov([]))).toEqual({ unseen: 0, unpicked: 0, dialogue: 0 });
    expect(pageNewCounts(choicePage, null as unknown as Coverage).dialogue).toBe(0);
  });
});

describe("seenSets", () => {
  it("seenMessages = coverage.seen sorted", () => {
    expect(seenSets(cov(["b#1", "a#2"]), idx([])).seenMessages).toEqual(["a#2", "b#1"]);
  });
  it("page is fully seen only with every line (incl. in branches) seen and every option (incl. cancel) picked", () => {
    const all = ["map:3:5:0#1", "map:3:5:0#3", "map:3:5:0#5"];
    expect(seenSets(cov(all, [["map:3:5:0#2", [0, 1, -2]]]), idx([choicePage])).seenPages).toEqual(["map:3:5:0"]);
    expect(seenSets(cov(all, [["map:3:5:0#2", [0, 1]]]), idx([choicePage])).seenPages).toEqual([]);
    expect(seenSets(cov(all.slice(0, 2), [["map:3:5:0#2", [0, 1, -2]]]), idx([choicePage])).seenPages).toEqual([]);
  });
  it("pages without messages/choices are never listed", () => {
    const empty = page(C, [{ kind: "picture", cmd: 1, pictureId: 1, name: "p" }]);
    expect(seenSets(cov([]), idx([empty])).seenPages).toEqual([]);
    const common = page(C, [msg(4)]);
    expect(seenSets(cov(["common:7#4"]), idx([common])).seenPages).toEqual(["common:7"]);
  });
  it("troop pages are listed like any other page (no troop list: battles are never auto-sped)", () => {
    const pages = [page(T2, [msg(1)]), page(T2b, [msg(2)])];
    const r = seenSets(cov(["troop:2:0#1"]), idx(pages));
    expect(r.seenPages).toEqual(["troop:2:0"]);
    expect(Object.keys(r)).toEqual(["seenMessages", "seenPages"]);
  });
  it("never throws on odd input", () => {
    const bad = seenSets(null as unknown as Coverage, null as unknown as GameIndex);
    expect(bad).toEqual({ seenMessages: [], seenPages: [] });
    const odd = idx([null as unknown as PageEntry, { location: null } as unknown as PageEntry, page(M, null as unknown as ScriptNode[])]);
    expect(seenSets(cov([]), odd).seenPages).toEqual([]);
  });
});

describe("controlJson", () => {
  it("writes the v1 contract", () => {
    const j = JSON.parse(controlJson(DEFAULT_ASSIST, { seenMessages: ["a#1"], seenPages: ["common:7"] }, { id: "c-1", kind: "win", at: 100 }, 123));
    expect(j).toEqual({
      v: 1, t: 123, speed: 1, skipSeen: true, autoFast: true, autoSpeed: 8,
      hotkeys: { speed: 117, skip: 118, win: 121, lose: 122 },
      seenMessages: ["a#1"], seenPages: ["common:7"], command: { id: "c-1", kind: "win", at: 100 },
    });
  });
  it("sanitizes bad settings/commands", () => {
    const j = JSON.parse(controlJson({ speed: 3, autoSpeed: 1 } as never, null as never, { id: "x", kind: "boom" } as never, NaN));
    expect(j).toMatchObject({ t: 0, speed: 1, autoSpeed: 8, seenMessages: [], command: null });
  });
});

describe("normalizeAssist / versionAtLeast", () => {
  it("normalizes stored values", () => {
    expect(normalizeAssist(null)).toEqual(DEFAULT_ASSIST);
    expect(normalizeAssist({ speed: 4, skipSeen: false, autoFast: false, autoSpeed: 2 }))
      .toEqual({ speed: 4, skipSeen: false, autoFast: false, autoSpeed: 2, hotkeys: DEFAULT_HOTKEYS });
    const hk = { speed: 65, skip: null, win: 121, lose: 122 };
    expect(normalizeAssist({ ...DEFAULT_ASSIST, hotkeys: hk }).hotkeys).toEqual(hk);
    expect(normalizeAssist({ speed: "4", autoSpeed: 16 })).toEqual(DEFAULT_ASSIST);
  });
  it("compares versions", () => {
    expect(versionAtLeast("1.1.0", "1.1.0")).toBe(true);
    expect(versionAtLeast("1.10.0", "1.9.0")).toBe(true);
    expect(versionAtLeast("1.0.5", "1.1.0")).toBe(false);
    expect(versionAtLeast("2", "1.1.0")).toBe(true);
    expect(versionAtLeast(null, "1.1.0")).toBe(false);
    expect(versionAtLeast("1.1.0-beta", "1.1.0")).toBe(false);
  });
});

describe("hotkeys", () => {
  it("keyLabel names F keys, letters, digits, numpad, else the code", () => {
    expect(keyLabel(117)).toBe("F6");
    expect(keyLabel(123)).toBe("F12");
    expect(keyLabel(112)).toBe("F1");
    expect(keyLabel(65)).toBe("A");
    expect(keyLabel(48)).toBe("0");
    expect(keyLabel(96)).toBe("Num 0");
    expect(keyLabel(105)).toBe("Num 9");
    expect(keyLabel(186)).toBe("키 186");
  });
  it("validateHotkey rejects reserved keys and duplicates", () => {
    expect(validateHotkey(null, "speed", DEFAULT_HOTKEYS)).toBeNull();
    expect(validateHotkey(117, "speed", DEFAULT_HOTKEYS)).toBeNull();
    expect(validateHotkey(65, "speed", DEFAULT_HOTKEYS)).toBeNull();
    expect(validateHotkey(116, "speed", DEFAULT_HOTKEYS)).toBe("F5은(는) 게임이 이미 쓰는 키예요");
    expect(validateHotkey(90, "win", DEFAULT_HOTKEYS)).toMatch(/게임이 이미 쓰는/);
    expect(validateHotkey(13, "win", DEFAULT_HOTKEYS)).toMatch(/게임이 이미 쓰는/);
    expect(validateHotkey(118, "speed", DEFAULT_HOTKEYS)).toBe("F7은(는) 이미 '본 대사 넘기기 켜고 끄기'에 쓰고 있어요");
    expect(validateHotkey(1.5, "speed", DEFAULT_HOTKEYS)).toBe("쓸 수 없는 키예요");
    expect(validateHotkey(300, "speed", DEFAULT_HOTKEYS)).toBe("쓸 수 없는 키예요");
    expect(validateHotkey(7, "speed", DEFAULT_HOTKEYS)).toBe("쓸 수 없는 키예요");
    expect(validateHotkey(8, "speed", DEFAULT_HOTKEYS)).toBeNull();
    expect(validateHotkey(255, "speed", DEFAULT_HOTKEYS)).toBeNull();
    expect(validateHotkey(144, "speed", DEFAULT_HOTKEYS)).toBe("키 144은(는) 단축키로 쓸 수 없어요");
    expect(validateHotkey(145, "speed", DEFAULT_HOTKEYS)).toMatch(/단축키로 쓸 수 없어요/);
    expect(normalizeHotkeys({ speed: 144, skip: 5 })).toEqual(DEFAULT_HOTKEYS);
  });
  it("normalizeHotkeys: old settings get defaults, bad/duplicate keys fall back", () => {
    expect(normalizeHotkeys(undefined)).toEqual(DEFAULT_HOTKEYS);
    expect(normalizeHotkeys({ speed: 116, skip: "x" })).toEqual(DEFAULT_HOTKEYS);
    expect(normalizeHotkeys({ speed: null, skip: 65, win: 66, lose: 67 })).toEqual({ speed: null, skip: 65, win: 66, lose: 67 });
    // skip이 speed와 겹치면 기본값 F7
    expect(normalizeHotkeys({ speed: 65, skip: 65 })).toEqual({ speed: 65, skip: 118, win: 121, lose: 122 });
    // 기본값도 이미 쓰이면 끔
    expect(normalizeHotkeys({ speed: 118, skip: 118 })).toEqual({ speed: 118, skip: null, win: 121, lose: 122 });
    expect(normalizeAssist({ speed: 2 }).hotkeys).toEqual(DEFAULT_HOTKEYS);
  });
  it("liveHotkeys reads the echo; missing echo = fixed defaults", () => {
    expect(liveHotkeys(undefined)).toEqual(DEFAULT_HOTKEYS);
    expect(liveHotkeys({ speed: 1 })).toEqual(DEFAULT_HOTKEYS);
    expect(liveHotkeys({ hotkeys: { speed: 65, skip: null, win: "x" } })).toEqual({ speed: 65, skip: null, win: 121, lose: 122 });
  });
  it("hotkeySummary lists bound keys only", () => {
    expect(hotkeySummary(DEFAULT_HOTKEYS)).toBe("게임 창 단축키: F6 배속, F7 본 대사 넘기기, F10 전투 중 이기기, F11 전투 중 지기");
    expect(hotkeySummary({ speed: 65, skip: null, win: null, lose: null })).toBe("게임 창 단축키: A 배속");
    expect(hotkeySummary({ speed: null, skip: null, win: null, lose: null })).toBe("게임 창 단축키를 모두 껐어요");
  });
  it("controlJson writes custom hotkeys", () => {
    const hotkeys = { speed: 65, skip: null, win: 121, lose: 122 };
    expect(JSON.parse(controlJson({ ...DEFAULT_ASSIST, hotkeys }, { seenMessages: [], seenPages: [] }, null, 1)).hotkeys).toEqual(hotkeys);
  });
});

describe("game sync", () => {
  const written = { t: 500, settings: { ...DEFAULT_ASSIST, speed: 2 as const, skipSeen: true } };
  const cur = written.settings;
  it("adoptLiveAssist adopts hotkey changes only after the game applied our latest write", () => {
    // 게임이 우리 파일(t 500)을 적용한 뒤 단축키로 4배속·넘기기 끔
    expect(adoptLiveAssist({ controlT: 500, speed: 4, skipSeen: false }, written, cur, false)).toEqual({ speed: 4, skipSeen: false });
    // 예전 파일의 메아리
    expect(adoptLiveAssist({ controlT: 400, speed: 4, skipSeen: false }, written, cur, false)).toBeNull();
    expect(adoptLiveAssist({ controlT: null, speed: 4 }, written, cur, false)).toBeNull();
    // 구버전(controlT 없음)
    expect(adoptLiveAssist({ speed: 4 }, written, cur, false)).toBeNull();
    // 쓰는 중이면 받지 않는다
    expect(adoptLiveAssist({ controlT: 500, speed: 4 }, written, cur, true)).toBeNull();
    // 아직 못 썼으면 받지 않는다
    expect(adoptLiveAssist({ controlT: 500, speed: 4 }, null, cur, false)).toBeNull();
    // 쓴 값과 같으면 바뀐 게 없다
    expect(adoptLiveAssist({ controlT: 500, speed: 2, skipSeen: true }, written, cur, false)).toBeNull();
    // 이미 받아들인 값(현재 설정과 같음)은 다시 받지 않는다
    expect(adoptLiveAssist({ controlT: 500, speed: 4 }, written, { ...cur, speed: 4 }, false)).toBeNull();
    expect(adoptLiveAssist({ controlT: 500, speed: 3 }, written, cur, false)).toBeNull();
    expect(adoptLiveAssist(null, written, cur, false)).toBeNull();
  });
  it("controlMismatch compares the applied t with our latest write", () => {
    expect(controlMismatch({ controlT: 500 }, 500)).toBe(false);
    expect(controlMismatch({ controlT: 400 }, 500)).toBe(true);
    expect(controlMismatch({ controlT: null }, 500)).toBe(true);
    expect(controlMismatch({ controlT: null }, null)).toBe(true);
    expect(controlMismatch({ controlT: 500 }, null)).toBe(true);
    expect(controlMismatch({ speed: 1 }, 500)).toBe(false);
    expect(controlMismatch({ controlT: "x" }, 500)).toBe(false);
    expect(controlMismatch(undefined, 500)).toBe(false);
  });
  it("resyncDue waits 3 s of mismatch and throttles to 5 s", () => {
    expect(resyncDue(null, null, 10_000)).toBe(false);
    expect(resyncDue(7_000, null, 10_000)).toBe(false);
    expect(resyncDue(6_999, null, 10_000)).toBe(true);
    expect(resyncDue(1_000, 6_000, 10_000)).toBe(false);
    expect(resyncDue(1_000, 5_000, 10_000)).toBe(true);
  });
  it("commandStatus follows the game's echo", () => {
    const sent = { id: "c-1" };
    expect(commandStatus(null, "c-1", false)).toBeNull();
    expect(commandStatus(sent, null, false)).toBe("sent");
    expect(commandStatus(sent, "c-0", true)).toBe("noResponse");
    expect(commandStatus(sent, "c-1", true)).toBe("applied");
    expect(commandStatus(sent, "c-1:ignored", false)).toBe("ignored");
    expect(commandStatus(sent, "c-1:failed", false)).toBe("failed");
  });
});
