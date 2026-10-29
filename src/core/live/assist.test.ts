import { describe, expect, it } from "vitest";
import type { GameIndex, Location, PageEntry, ScriptNode } from "../types";
import {
  adoptLiveAssist, commandStatus, commandStatusText, controlJson, controlMismatch, DEFAULT_ASSIST, DEFAULT_HOTKEYS, hotkeySummary, keyLabel, LEGACY_HOTKEYS, liveHotkeys,
  HOTKEY_ACTIONS, HOTKEY_GROUPS, hotkeyCode, isHpCommand, isSaveCommand, normalizeAssist, sameHotkeys, normalizeHotkeys, resyncDue, seenSets, validateHotkey, versionAtLeast,
  carryCommand, changedAssistKeys, mergeAssist, migrateSavedAssist, parseControlFile,
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
/** 체력 단축키 기본값(Home·End) */
const HP = { hpFull: 36, hpLow: 35 };
/** 체력 단축키 끔 */
const HP_OFF = { hpFull: null, hpLow: null };
const CTRL = 256, SHIFT = 512, ALT = 1024;
/** 1.22.0 조합 기본 단축키(Ctrl+F6·Ctrl+F7·Ctrl+F10, Ctrl+S·Ctrl+L·Ctrl+Shift+S·Ctrl+Shift+L, Ctrl+B·Ctrl+Shift+B) */
const SAVE = {
  autoSpeed: 117 | CTRL, autoFast: 118 | CTRL, escape: 121 | CTRL,
  quickSave: 83 | CTRL, quickLoad: 76 | CTRL, saveMenu: 83 | CTRL | SHIFT, loadMenu: 76 | CTRL | SHIFT, backup: 66 | CTRL, restore: 66 | CTRL | SHIFT,
};
/** 그 단축키 끔(예전 플러그인) */
const SAVE_OFF = {
  autoSpeed: null, autoFast: null, escape: null, quickSave: null, quickLoad: null, saveMenu: null, loadMenu: null, backup: null, restore: null,
};

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
      hotkeys: { speed: 117, skip: 118, win: 121, lose: 122, ...HP, ...SAVE, v: 4 }, quickSlot: null,
      seenMessages: ["a#1"], seenPages: ["common:7"], command: { id: "c-1", kind: "win", at: 100 },
    });
  });
  it("sanitizes bad settings/commands", () => {
    const j = JSON.parse(controlJson({ speed: 3, autoSpeed: 1 } as never, null as never, { id: "x", kind: "boom" } as never, NaN));
    expect(j).toMatchObject({ t: 0, speed: 1, autoSpeed: 8, seenMessages: [], command: null });
  });
  it("writes the party HP commands", () => {
    for (const kind of ["hpFull", "hpLow"] as const) {
      const j = JSON.parse(controlJson(DEFAULT_ASSIST, { seenMessages: [], seenPages: [] }, { id: "h-1", kind, at: 5 }, 1));
      expect(j.command).toEqual({ id: "h-1", kind, at: 5 });
    }
  });
  it("writes the save / load commands and the quick slot (1.21.0)", () => {
    for (const kind of ["saveMenu", "loadMenu", "quickSave", "quickLoad"] as const) {
      const j = JSON.parse(controlJson({ ...DEFAULT_ASSIST, quickSlot: 7 }, { seenMessages: [], seenPages: [] }, { id: "s-1", kind, at: 5 }, 1));
      expect(j.command).toEqual({ id: "s-1", kind, at: 5 });
      expect(j.quickSlot).toBe(7);
      expect(isSaveCommand(kind)).toBe(true);
      expect(parseControlFile(JSON.stringify(j))?.command?.kind).toBe(kind);
      expect(parseControlFile(JSON.stringify(j))?.settings.quickSlot).toBe(7);
      expect(parseControlFile(JSON.stringify(j))?.flags).toEqual({});
    }
    expect(isSaveCommand("hpFull")).toBe(false);
    expect(commandStatusText("ignored", "quickSave")).toMatch(/게임 화면의 안내/);
  });
});

describe("normalizeAssist / versionAtLeast", () => {
  it("normalizes stored values", () => {
    expect(normalizeAssist(null)).toEqual(DEFAULT_ASSIST);
    expect(normalizeAssist({ speed: 4, skipSeen: false, autoFast: false, autoSpeed: 2 }))
      .toEqual({ speed: 4, skipSeen: false, autoFast: false, autoSpeed: 2, hotkeys: DEFAULT_HOTKEYS, quickSlot: null });
    const hk = { speed: 65, skip: null, win: 121, lose: 122, hpFull: 72, hpLow: 76, ...SAVE };
    expect(normalizeAssist({ ...DEFAULT_ASSIST, hotkeys: hk }).hotkeys).toEqual(hk);
    expect(normalizeAssist({ speed: "4", autoSpeed: 16 })).toEqual(DEFAULT_ASSIST);
    // 퀵 세이브 칸: 1~999 정수만, 그 밖에는 null(마지막 칸)
    expect(normalizeAssist({ quickSlot: 3 }).quickSlot).toBe(3);
    for (const bad of [0, -1, 1.5, 1000, "3", null]) expect(normalizeAssist({ quickSlot: bad }).quickSlot).toBeNull();
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
  it("keyLabel names F keys, letters, digits, numpad, combos, else the code", () => {
    expect(keyLabel(117)).toBe("F6");
    expect(keyLabel(123)).toBe("F12");
    expect(keyLabel(112)).toBe("F1");
    expect(keyLabel(65)).toBe("A");
    expect(keyLabel(48)).toBe("0");
    expect(keyLabel(96)).toBe("Num 0");
    expect(keyLabel(105)).toBe("Num 9");
    expect(keyLabel(36)).toBe("Home");
    expect(keyLabel(35)).toBe("End");
    expect(keyLabel(192)).toBe("`(숫자 1 왼쪽)");
    expect(keyLabel(219)).toBe("[");
    expect(keyLabel(221)).toBe("]");
    expect(keyLabel(186)).toBe(";");
    expect(keyLabel(230)).toBe("키 230");
    expect(keyLabel(83 | CTRL)).toBe("Ctrl+S");
    expect(keyLabel(83 | CTRL | SHIFT)).toBe("Ctrl+Shift+S");
    expect(keyLabel(118 | ALT | SHIFT)).toBe("Shift+Alt+F7");
    expect(hotkeyCode(83, { ctrl: true, shift: true })).toBe(83 | CTRL | SHIFT);
    expect(hotkeyCode(83)).toBe(83);
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
    expect(validateHotkey(2048 | 65, "speed", DEFAULT_HOTKEYS)).toBe("쓸 수 없는 키예요");
    expect(validateHotkey(7, "speed", DEFAULT_HOTKEYS)).toBe("쓸 수 없는 키예요");
    expect(validateHotkey(CTRL | 5, "speed", DEFAULT_HOTKEYS)).toBe("쓸 수 없는 키예요");
    expect(validateHotkey(8, "speed", DEFAULT_HOTKEYS)).toBeNull();
    expect(validateHotkey(255, "speed", DEFAULT_HOTKEYS)).toBeNull();
    expect(validateHotkey(144, "speed", DEFAULT_HOTKEYS)).toBe("키 144은(는) 단축키로 쓸 수 없어요");
    expect(validateHotkey(145, "speed", DEFAULT_HOTKEYS)).toMatch(/단축키로 쓸 수 없어요/);
    expect(normalizeHotkeys({ speed: 144, skip: 5 })).toEqual(DEFAULT_HOTKEYS);
  });
  it("validateHotkey: combos (1.22.0) — exact duplicates, modifier alone, game / window keys", () => {
    // Ctrl은 글자에도 된다(게임 키 Z·X·Q·W도), 같은 키라도 조합이 다르면 다른 단축키
    expect(validateHotkey(90 | CTRL, "speed", DEFAULT_HOTKEYS)).toBeNull();
    expect(validateHotkey(88 | CTRL | SHIFT, "speed", DEFAULT_HOTKEYS)).toBeNull();
    expect(validateHotkey(116 | CTRL, "speed", DEFAULT_HOTKEYS)).toBeNull(); // Ctrl+F5: 게임은 Ctrl 없는 F5만 쓴다
    expect(validateHotkey(118 | SHIFT, "speed", DEFAULT_HOTKEYS)).toBeNull(); // Shift+F7 ≠ F7 ≠ Ctrl+F7
    expect(validateHotkey(118 | CTRL, "speed", DEFAULT_HOTKEYS)).toBe("Ctrl+F7은(는) 이미 '본 이벤트 자동 배속 켜고 끄기'에 쓰고 있어요");
    expect(validateHotkey(83 | CTRL, "backup", DEFAULT_HOTKEYS)).toMatch(/이미 '퀵 세이브'/);
    // 조합 키만
    for (const c of [16, 17, 18, 17 | CTRL, 16 | SHIFT, 18 | ALT, 17 | CTRL | SHIFT]) {
      expect(validateHotkey(c, "speed", DEFAULT_HOTKEYS)).toBe("Ctrl·Shift·Alt만으로는 단축키로 쓸 수 없어요");
    }
    // 이동·결정·취소 키에는 조합을 걸 수 없다
    for (const base of [37, 38, 39, 40, 13, 32, 27, 9, 33, 45, 98]) {
      expect(validateHotkey(base | CTRL, "speed", DEFAULT_HOTKEYS)).toMatch(/이동·결정·취소/);
    }
    // Shift만 더한 게임 키(대시하며 누르는 키)
    expect(validateHotkey(90 | SHIFT, "speed", DEFAULT_HOTKEYS)).toBe("Shift+Z은(는) 게임이 이미 쓰는 키예요");
    expect(validateHotkey(116 | SHIFT, "speed", DEFAULT_HOTKEYS)).toMatch(/게임이 이미 쓰는/);
    // 게임 창(NW.js·크롬)·Windows가 쓰는 조합
    for (const c of [82 | CTRL, 82 | CTRL | SHIFT, 87 | CTRL, 81 | CTRL, 78 | CTRL, 84 | CTRL, 73 | CTRL | SHIFT, 74 | CTRL | SHIFT,
      67 | CTRL | SHIFT, 80 | CTRL, 115 | CTRL, 115 | ALT, 121 | SHIFT, 187 | CTRL, 189 | CTRL, 48 | CTRL]) {
      expect(validateHotkey(c, "speed", DEFAULT_HOTKEYS)).toMatch(/게임 창이나 Windows가 쓰는 키/);
    }
    expect(validateHotkey(73 | CTRL, "speed", DEFAULT_HOTKEYS)).toBeNull(); // Ctrl+I는 된다(Ctrl+Shift+I만 개발자 도구)
    // Ctrl+Alt(일부 키보드의 AltGr)
    expect(validateHotkey(83 | CTRL | ALT, "speed", DEFAULT_HOTKEYS)).toMatch(/Ctrl과 Alt/);
    expect(validateHotkey(83 | ALT, "speed", DEFAULT_HOTKEYS)).toBeNull();
    // Win·메뉴 키
    expect(validateHotkey(91 | CTRL, "speed", DEFAULT_HOTKEYS)).toMatch(/단축키로 쓸 수 없어요/);
  });
  it("every action ships with a default key, all different and valid", () => {
    const codes = HOTKEY_ACTIONS.map(({ action }) => DEFAULT_HOTKEYS[action]);
    expect(codes.every((c) => c !== null)).toBe(true);
    expect(new Set(codes).size).toBe(codes.length);
    for (const { action } of HOTKEY_ACTIONS) expect(validateHotkey(DEFAULT_HOTKEYS[action], action, DEFAULT_HOTKEYS)).toBeNull();
    expect(normalizeHotkeys(DEFAULT_HOTKEYS)).toEqual(DEFAULT_HOTKEYS);
    expect(HOTKEY_ACTIONS.map((a) => keyLabel(DEFAULT_HOTKEYS[a.action]!))).toEqual([
      "F6", "Ctrl+F6", "F7", "Ctrl+F7", "F10", "F11", "Ctrl+F10", "Home", "End",
      "Ctrl+S", "Ctrl+L", "Ctrl+Shift+S", "Ctrl+Shift+L", "Ctrl+B", "Ctrl+Shift+B",
    ]);
    expect(HOTKEY_GROUPS.every((g) => HOTKEY_ACTIONS.some((a) => a.group === g))).toBe(true);
  });
  it("normalizeHotkeys: old settings get defaults, bad/duplicate keys fall back", () => {
    expect(normalizeHotkeys(undefined)).toEqual(DEFAULT_HOTKEYS);
    expect(normalizeHotkeys({ speed: 116, skip: "x" })).toEqual(DEFAULT_HOTKEYS);
    expect(normalizeHotkeys({ speed: null, skip: 65, win: 66, lose: 67 })).toEqual({ speed: null, skip: 65, win: 66, lose: 67, ...HP, ...SAVE });
    // skip이 speed와 겹치면 기본값 F7
    expect(normalizeHotkeys({ speed: 65, skip: 65 })).toEqual({ speed: 65, skip: 118, win: 121, lose: 122, ...HP, ...SAVE });
    // 기본값도 이미 쓰이면 끔
    expect(normalizeHotkeys({ speed: 118, skip: 118 })).toEqual({ speed: 118, skip: null, win: 121, lose: 122, ...HP, ...SAVE });
    // 새 키: 예전 묶음에는 없으므로 기본값, 예전 묶음이 그 키를 이미 쓰면 끔
    expect(normalizeHotkeys({ speed: 83 | CTRL })).toEqual({ ...DEFAULT_HOTKEYS, speed: 83 | CTRL, quickSave: null });
    expect(normalizeHotkeys({ saveMenu: 80, loadMenu: 79 })).toEqual({ ...DEFAULT_HOTKEYS, saveMenu: 80, loadMenu: 79 });
    // 체력 키: 기본은 Home·End, 겹치면 기본값(그것도 겹치면 끔), null은 끔
    expect(normalizeHotkeys({ hpFull: 72, hpLow: 76 })).toEqual({ ...DEFAULT_HOTKEYS, hpFull: 72, hpLow: 76 });
    expect(normalizeHotkeys({ hpFull: 72, hpLow: 72 })).toEqual({ ...DEFAULT_HOTKEYS, hpFull: 72, hpLow: 35 });
    expect(normalizeHotkeys({ hpFull: 35 })).toEqual({ ...DEFAULT_HOTKEYS, hpFull: 35, hpLow: null });
    expect(normalizeHotkeys({ hpFull: 117 })).toEqual(DEFAULT_HOTKEYS);
    expect(normalizeHotkeys({ hpFull: 116, hpLow: "x" })).toEqual(DEFAULT_HOTKEYS);
    expect(normalizeHotkeys({ hpFull: null, hpLow: null })).toEqual({ ...DEFAULT_HOTKEYS, ...HP_OFF });
    expect(DEFAULT_HOTKEYS).toMatchObject(HP);
    for (const code of [36, 35]) expect(validateHotkey(code, "speed", LEGACY_HOTKEYS)).toBeNull();
    expect(validateHotkey(121, "hpFull", DEFAULT_HOTKEYS)).toBe("F10은(는) 이미 '전투 이기기'에 쓰고 있어요");
    expect(validateHotkey(36, "speed", DEFAULT_HOTKEYS)).toBe("Home은(는) 이미 '내 체력 100%'에 쓰고 있어요");
    expect(validateHotkey(72, "speed", { ...DEFAULT_HOTKEYS, hpLow: 72 })).toBe("H은(는) 이미 '내 체력 1%'에 쓰고 있어요");
    expect(normalizeAssist({ speed: 2 }).hotkeys).toEqual(DEFAULT_HOTKEYS);
  });
  it("liveHotkeys reads the echo; missing echo = old fixed defaults (no HP keys)", () => {
    expect(liveHotkeys(undefined)).toEqual(LEGACY_HOTKEYS);
    expect(liveHotkeys({ speed: 1 })).toEqual(LEGACY_HOTKEYS);
    expect(LEGACY_HOTKEYS).toEqual({ speed: 117, skip: 118, win: 121, lose: 122, ...HP_OFF, ...SAVE_OFF });
    // 체력 필드를 보고하지 않는 예전 플러그인(1.12.0 전)에는 체력 단축키가 없다
    expect(liveHotkeys({ hotkeys: { speed: 65, skip: null, win: "x" } })).toEqual({ speed: 65, skip: null, win: 121, lose: 122, ...HP_OFF, ...SAVE_OFF });
    // 1.20.0 플러그인(백업·세이브 필드 없음)에는 그 단축키가 없다
    expect(liveHotkeys({ hotkeys: { speed: 117, skip: 118, win: 121, lose: 122, ...HP } })).toEqual({ ...DEFAULT_HOTKEYS, ...SAVE_OFF });
    // 1.21.0 플러그인: 조합 키를 받지 못해 예전 기본 키를 보고하고, 새 동작(자동 배속 빠르기·자동 배속·도망)은 없다
    const v121 = { speed: 117, skip: 118, win: 121, lose: 122, ...HP, backup: 112, restore: 192, quickSave: 219, quickLoad: 221, saveMenu: null, loadMenu: null };
    const eff = liveHotkeys({ hotkeys: v121 });
    expect(eff).toEqual({ ...v121, autoSpeed: null, autoFast: null, escape: null });
    expect(sameHotkeys(eff, DEFAULT_HOTKEYS)).toBe(false); // → 플러그인 업데이트 안내
    expect(liveHotkeys({ hotkeys: DEFAULT_HOTKEYS })).toEqual(DEFAULT_HOTKEYS);
    expect(liveHotkeys({ hotkeys: { ...DEFAULT_HOTKEYS, hpFull: 72, hpLow: null } })).toEqual({ ...DEFAULT_HOTKEYS, hpFull: 72, hpLow: null });
  });
  it("hotkeySummary lists bound keys by group", () => {
    expect(hotkeySummary(DEFAULT_HOTKEYS)).toBe(
      "게임 창 단축키 — 진행: F6 배속, Ctrl+F6 자동 배속 빠르기, F7 본 대사 넘기기, Ctrl+F7 자동 배속"
      + " · 전투: F10 이기기, F11 지기, Ctrl+F10 도망 · 체력: Home 100%, End 1%"
      + " · 세이브: Ctrl+S 퀵 세이브, Ctrl+L 퀵 로드(두 번), Ctrl+Shift+S 세이브 창, Ctrl+Shift+L 로드 창"
      + " · 백업: Ctrl+B 백업, Ctrl+Shift+B 복원(두 번)",
    );
    expect(hotkeySummary(LEGACY_HOTKEYS)).toBe("게임 창 단축키 — 진행: F6 배속, F7 본 대사 넘기기 · 전투: F10 이기기, F11 지기");
    expect(hotkeySummary({ ...LEGACY_HOTKEYS, speed: 65, skip: null, win: null, lose: null })).toBe("게임 창 단축키 — 진행: A 배속");
    expect(hotkeySummary({ ...DEFAULT_HOTKEYS, hpFull: 72, hpLow: 76 })).toMatch(/ · 체력: H 100%, L 1% · /);
    expect(hotkeySummary({ ...LEGACY_HOTKEYS, speed: null, skip: null, win: null, lose: null })).toBe("게임 창 단축키를 모두 껐어요");
  });
  it("controlJson writes custom hotkeys", () => {
    const hotkeys = { ...DEFAULT_HOTKEYS, speed: 65, skip: null, hpFull: 72, hpLow: null, restore: null };
    expect(JSON.parse(controlJson({ ...DEFAULT_ASSIST, hotkeys }, { seenMessages: [], seenPages: [] }, null, 1)).hotkeys).toEqual({ ...hotkeys, v: 4 });
  });
  it("migrateSavedAssist: old untouched HP default (both null, no v) gets the new keys; v2 or set keys stay", () => {
    const old = { ...DEFAULT_ASSIST, speed: 4 as const, hotkeys: { speed: 65, skip: 118, win: 121, lose: 122, ...HP_OFF } };
    expect(normalizeAssist(migrateSavedAssist(old))).toEqual({ ...old, hotkeys: { ...old.hotkeys, ...HP, ...SAVE } });
    // 새 판(v2)에서 사용자가 끈 것: 체력은 끈 채로, 새 키는 새 기본값
    const off = { ...old, hotkeys: { ...old.hotkeys, v: 2 } };
    expect(normalizeAssist(migrateSavedAssist(off)).hotkeys).toEqual({ ...old.hotkeys, ...SAVE });
    // 예전 판에서도 하나라도 정했으면 그대로
    const set = { ...old, hotkeys: { ...old.hotkeys, hpFull: 72 } };
    expect(normalizeAssist(migrateSavedAssist(set)).hotkeys).toEqual({ ...old.hotkeys, hpFull: 72, ...SAVE });
    expect(migrateSavedAssist(null)).toBeNull();
    expect(migrateSavedAssist({ speed: 2 })).toEqual({ speed: 2 });
    // 디스크 control.json(예전 뷰어가 쓴 것)도 옮긴다; 새 판으로 쓴 것은 끈 채로 읽힌다
    const oldFile = JSON.stringify({ v: 1, t: 9, hotkeys: { speed: 117, skip: 118, win: 121, lose: 122, ...HP_OFF } });
    expect(parseControlFile(oldFile)?.settings.hotkeys).toEqual(DEFAULT_HOTKEYS);
    const newFile = controlJson({ ...DEFAULT_ASSIST, hotkeys: LEGACY_HOTKEYS }, { seenMessages: [], seenPages: [] }, null, 9);
    expect(parseControlFile(newFile)?.settings.hotkeys).toEqual(LEGACY_HOTKEYS);
  });
  it("migrateSavedAssist v3 → v4: untouched 1.21.0 defaults move to the new keys, customized keys stay (off when they collide)", () => {
    const V3 = { speed: 117, skip: 118, win: 121, lose: 122, ...HP, backup: 112, restore: 192, quickSave: 219, quickLoad: 221, saveMenu: null, loadMenu: null };
    // 모두 기본값 그대로 → 새 기본값(세이브 창·로드 창도 Ctrl+Shift+S·L)
    expect(normalizeAssist(migrateSavedAssist({ ...DEFAULT_ASSIST, hotkeys: { ...V3, v: 3 } })).hotkeys).toEqual(DEFAULT_HOTKEYS);
    // 바꾼 것은 그대로: 퀵 세이브 F1(예전 백업 키), 지기 끔, 세이브 창 P
    const custom = { ...V3, quickSave: 112, lose: null, saveMenu: 80, v: 3 };
    expect(normalizeAssist(migrateSavedAssist({ ...DEFAULT_ASSIST, hotkeys: custom })).hotkeys)
      .toEqual({ ...DEFAULT_HOTKEYS, quickSave: 112, lose: null, saveMenu: 80 });
    // 바꾼 키가 새 기본값으로 옮긴 키와 겹치면 바꾼 쪽을 끈다: 퀵 로드를 Home으로(체력 100%는 기본값 그대로 Home) → 퀵 로드 끔
    const clash = { ...V3, quickLoad: 36, v: 3 };
    expect(normalizeAssist(migrateSavedAssist({ ...DEFAULT_ASSIST, hotkeys: clash })).hotkeys).toEqual({ ...DEFAULT_HOTKEYS, quickLoad: null });
    // 판 표시 4는 그대로(사용자가 끈 세이브 창은 끈 채로)
    const v4 = { ...DEFAULT_HOTKEYS, saveMenu: null, v: 4 };
    expect(normalizeAssist(migrateSavedAssist({ ...DEFAULT_ASSIST, hotkeys: v4 })).hotkeys).toEqual({ ...DEFAULT_HOTKEYS, saveMenu: null });
    // 한 번 옮긴 것은 다시 옮겨도 같다
    const once = migrateSavedAssist({ ...DEFAULT_ASSIST, hotkeys: custom });
    expect(migrateSavedAssist(once)).toEqual(once);
    // 디스크 control.json(1.21.0 뷰어가 쓴 v3)도
    expect(parseControlFile(JSON.stringify({ v: 1, t: 9, hotkeys: { ...V3, v: 3 } }))?.settings.hotkeys).toEqual(DEFAULT_HOTKEYS);
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
  it("adoptLiveAssist also adopts 본 이벤트 자동 배속 and its speed changed by Ctrl+F7 / Ctrl+F6 (1.22.0)", () => {
    // written: autoFast true, autoSpeed 8 (DEFAULT_ASSIST)
    expect(adoptLiveAssist({ controlT: 500, speed: 2, skipSeen: true, autoFast: false, autoSpeed: 8 }, written, cur, false)).toEqual({ autoFast: false });
    expect(adoptLiveAssist({ controlT: 500, speed: 2, skipSeen: true, autoFast: true, autoSpeed: 2 }, written, cur, false)).toEqual({ autoSpeed: 2 });
    expect(adoptLiveAssist({ controlT: 400, autoFast: false }, written, cur, false)).toBeNull();
    expect(adoptLiveAssist({ controlT: 500, autoFast: false }, written, { ...cur, autoFast: false }, false)).toBeNull();
    expect(adoptLiveAssist({ controlT: 500, autoSpeed: 1 }, written, cur, false)).toBeNull(); // 자동 배속 빠르기가 아니다
    // 1.21.0 플러그인(필드 없음)
    expect(adoptLiveAssist({ controlT: 500, speed: 2, skipSeen: true }, written, cur, false)).toBeNull();
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
  it("commandStatusText: HP commands are ignored only without a party", () => {
    expect(isHpCommand("hpFull")).toBe(true);
    expect(isHpCommand("hpLow")).toBe(true);
    expect(isHpCommand("win")).toBe(false);
    expect(commandStatusText("ignored", "hpFull")).toBe("게임에서 무시했어요 (파티가 없어요)");
    expect(commandStatusText("ignored", "win")).toMatch(/전투 중이 아니거나/);
    expect(commandStatusText("applied", "hpLow")).toBe("적용됐어요");
    expect(commandStatusText("failed", "hpFull")).toBe("실행하지 못했어요");
  });
});

describe("shared control.json (PC and phone viewers)", () => {
  const sets = { seenMessages: ["a"], seenPages: ["p"] };
  it("parses a written file back to the same body", () => {
    const s = normalizeAssist({ speed: 4, skipSeen: false });
    const cmd = { id: "x-1", kind: "cheat" as const, at: 90, ops: [{ op: "gold", value: 5 }] as never };
    const text = controlJson(s, sets, cmd, 123, { capturePictures: true, liveActors: true });
    const f = parseControlFile(text);
    expect(f).not.toBeNull();
    expect(f?.t).toBe(123);
    expect(f?.settings).toEqual(s);
    expect(f?.sets).toEqual(sets);
    expect(f?.flags).toEqual({ capturePictures: true, liveActors: true });
    expect(f?.body).toBe(controlJson(s, sets, f?.command ?? null, 0, { capturePictures: true, liveActors: true }));
  });
  it("rejects files that are not contract v1 with a t", () => {
    for (const t of [null, "", "{bad", "[]", JSON.stringify({ v: 2, t: 1 }), JSON.stringify({ v: 1 })]) expect(parseControlFile(t)).toBeNull();
  });
  it("merges only the keys this viewer changed onto the other viewer's settings", () => {
    const disk = normalizeAssist({ speed: 8, skipSeen: false, autoFast: true, autoSpeed: 2 });
    const local = normalizeAssist({ speed: 1, skipSeen: true, autoFast: false, autoSpeed: 4 });
    expect(mergeAssist(disk, local, [])).toEqual(disk);
    expect(mergeAssist(disk, local, ["skipSeen"])).toEqual({ ...disk, skipSeen: true });
    expect(changedAssistKeys(disk, local).sort()).toEqual(["autoFast", "autoSpeed", "skipSeen", "speed"]);
    expect(changedAssistKeys(disk, disk)).toEqual([]);
  });
  it("carries the other viewer's fresh command when this viewer has none", () => {
    const disk = parseControlFile(controlJson(DEFAULT_ASSIST, sets, { id: "c-1", kind: "win", at: 1000 }, 1000));
    expect(disk?.command).toEqual({ id: "c-1", kind: "win", at: 1000 });
    expect(carryCommand(disk, null, 5000, 10000)).toMatchObject({ id: "c-1" });
    expect(carryCommand(disk, null, 12000, 10000)).toBeNull();
    const ours = { id: "c-2", kind: "lose" as const, at: 4000 };
    expect(carryCommand(disk, ours, 5000, 10000)).toBe(ours);
    expect(carryCommand(null, null, 5000, 10000)).toBeNull();
  });
});
