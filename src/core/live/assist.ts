import { locationKey } from "../index/locations";
import { walk } from "../interpret/interpret";
import type { GameIndex, PageEntry } from "../types";
import { pageNewCounts } from "./interactable";
import type { Coverage } from "./types";
import { cheatOpsForControl, type CheatOp } from "./cheat";

/**
 * 게임 보조 설정(뷰어 → 게임, rpg-viewer/control.json).
 * autoFast·autoSpeed: 모든 대사·선택지를 본 이벤트가 도는 동안의 자동 배속(전투는 자동 배속하지 않는다).
 */
export interface AssistSettings {
  speed: 1 | 2 | 4 | 8; skipSeen: boolean; autoFast: boolean; autoSpeed: 2 | 4 | 8; hotkeys: Hotkeys;
  /** 퀵 세이브·퀵 로드 칸(1~). null = 게임의 마지막 세이브 칸(플러그인 1.21.0) */
  quickSlot: number | null;
  /**
   * 적 만남(플러그인 1.24.0, 기본 끔). noRandomEncounter: 랜덤 전투가 일어나지 않는다.
   * skipBattles: 전투 화면 없이 바로 이기고 보상을 받는다(대화가 있는 전투 등은 그대로 싸운다).
   * skipKnownOnly: skipBattles일 때, 모든 적을 한 번이라도 이겨 본 전투만 건너뛴다.
   */
  noRandomEncounter: boolean; skipBattles: boolean; skipKnownOnly: boolean;
}
/**
 * 게임 창 단축키 동작. backup·restore(플러그인 1.21.0)는 뷰어가 처리한다(게임 → rpg-viewer/request.json).
 * quickSave·quickLoad·saveMenu·loadMenu(1.21.0)는 게임 안에서 처리한다.
 * autoSpeed(자동 배속 빠르기 ×2→×4→×8)·autoFast(본 이벤트 자동 배속 켜고 끄기)·escape(전투 도망)는 1.22.0.
 * enemyHpFull·enemyHpLow(전투 중 적 체력 100%·1%)는 1.23.0.
 */
export type HotkeyAction =
  | "speed" | "autoSpeed" | "skip" | "autoFast" | "win" | "lose" | "escape" | "enemyHpFull" | "enemyHpLow" | "hpFull" | "hpLow"
  | "quickSave" | "quickLoad" | "saveMenu" | "loadMenu" | "backup" | "restore";
/**
 * 동작별 단축키. null = 끔. 값 = DOM keyCode | Ctrl 256 | Shift 512 | Alt 1024(조합 키, 플러그인 1.22.0).
 * 1.22.0 전 플러그인은 255보다 큰 값을 잘못된 값으로 보고 그 동작의 예전 기본 키를 쓴다(뷰어는 어긋남을 안내한다).
 */
export type Hotkeys = Record<HotkeyAction, number | null>;
/** win·lose·escape: 전투 중만. hpFull·hpLow(플러그인 1.12.0): 파티 체력 100%(쓰러진 동료도 살림)·1%, 맵과 전투 모두. */
/** enemyHpFull·enemyHpLow(플러그인 1.23.0): 전투 중 살아 있는 적 전원의 체력 100%·1%(적어도 1, 쓰러뜨리지 않는다). */
/** cheat(플러그인 1.14.0): ops를 실은 치트 명령(core/live/cheat) */
/** saveMenu·loadMenu·quickSave·quickLoad(플러그인 1.21.0): 세이브 창·로드 창 열기, 퀵 세이브·퀵 로드(맵, 불러오기는 타이틀에서도) */
export type AssistCommandKind = "win" | "lose" | "escape" | "enemyHpFull" | "enemyHpLow" | "hpFull" | "hpLow" | "cheat" | "saveMenu" | "loadMenu" | "quickSave" | "quickLoad";
/** at = 사용자가 누른 시각(ms), ops: kind가 cheat일 때만 */
export interface AssistCommand { id: string; kind: AssistCommandKind; at: number; ops?: CheatOp[] }
export interface SeenSets { seenMessages: string[]; seenPages: string[] }

/** 조합 키 표시 비트 */
export const MOD_CTRL = 256;
export const MOD_SHIFT = 512;
export const MOD_ALT = 1024;
const MOD_MASK = MOD_CTRL | MOD_SHIFT | MOD_ALT;
/** 키 + 조합 키 → 단축키 값 */
export const hotkeyCode = (keyCode: number, mods: { ctrl?: boolean; shift?: boolean; alt?: boolean } = {}): number =>
  keyCode | (mods.ctrl ? MOD_CTRL : 0) | (mods.shift ? MOD_SHIFT : 0) | (mods.alt ? MOD_ALT : 0);
const ctrl = (k: number) => k | MOD_CTRL;
const ctrlShift = (k: number) => k | MOD_CTRL | MOD_SHIFT;

/**
 * 1.22.0부터의 기본값. 진행: F6 배속, Ctrl+F6 자동 배속 빠르기, F7 본 대사 넘기기, Ctrl+F7 본 이벤트 자동 배속.
 * 전투: F10 이기기, F11 지기, Ctrl+F10 도망, Ctrl+Home 적 체력 100%, Ctrl+End 적 체력 1%(1.23.0). 체력: Home 100%, End 1%.
 * 세이브: Ctrl+S 퀵 세이브, Ctrl+L 퀵 로드(두 번), Ctrl+Shift+S 세이브 창, Ctrl+Shift+L 로드 창.
 * 백업: Ctrl+B 백업, Ctrl+Shift+B 마지막 백업으로 복원(두 번).
 */
export const DEFAULT_HOTKEYS: Hotkeys = {
  speed: 117, autoSpeed: ctrl(117), skip: 118, autoFast: ctrl(118),
  win: 121, lose: 122, escape: ctrl(121), enemyHpFull: ctrl(36), enemyHpLow: ctrl(35),
  hpFull: 36, hpLow: 35,
  quickSave: ctrl(83), quickLoad: ctrl(76), saveMenu: ctrlShift(83), loadMenu: ctrlShift(76),
  backup: ctrl(66), restore: ctrlShift(66),
};
/** 1.21.0의 기본값(판 표시 3까지의 묶음이 기본값을 그대로 둔 필드인지 가릴 때 쓴다) */
const V3_DEFAULT_HOTKEYS: Partial<Hotkeys> = {
  speed: 117, skip: 118, win: 121, lose: 122, hpFull: 36, hpLow: 35,
  backup: 112, restore: 192, quickSave: 219, quickLoad: 221, saveMenu: null, loadMenu: null,
};
/**
 * 1.20.0 전의 기본값(체력·세이브 단축키 없음). 단축키를 보고하지 않는 플러그인은 이것이 고정이고,
 * 어떤 동작을 보고하지 않는 플러그인에는 그 단축키가 없다.
 */
export const LEGACY_HOTKEYS: Hotkeys = {
  speed: 117, autoSpeed: null, skip: 118, autoFast: null, win: 121, lose: 122, escape: null, enemyHpFull: null, enemyHpLow: null, hpFull: null, hpLow: null,
  quickSave: null, quickLoad: null, saveMenu: null, loadMenu: null, backup: null, restore: null,
};
/**
 * 저장하는 단축키 묶음(localStorage·control.json)의 판 표시 `v`. 플러그인은 `v`를 무시한다.
 * - 표시가 없는 묶음(2 전)은 예전 뷰어가 쓴 것이라, 체력 단축키 둘 다 null이면 예전 기본값(끔)을 그대로 둔 것으로 보고 새 기본값을 준다.
 * - 3(1.21.0): 백업·복원·퀵 세이브·퀵 로드·세이브 창·로드 창. 예전 묶음에는 이 필드가 없어서 기본값을 받는다(겹치는 키는 끔).
 * - 4(1.22.0): 조합 키, 자동 배속 빠르기·자동 배속 켜고 끄기·도망. 4 전 묶음에서 그 판의 기본값을 그대로 둔 필드는 새 기본값으로
 *   옮기고, 사용자가 바꾼 필드는 그대로 둔다(새 기본값과 겹치면 바꾼 쪽을 끈다).
 * - 5(1.23.0): 적 체력 100%·1%. 4 묶음은 그대로 두고 없는 이 두 필드만 기본값(Ctrl+Home·Ctrl+End)을 받는다.
 *   사용자가 그 조합을 이미 다른 동작에 썼으면 새 필드를 끈다(쓰던 단축키는 건드리지 않는다).
 */
export const HOTKEYS_VERSION = 5;
/** 조합 키 기본값(1.22.0)이 들어온 판: 이 판부터의 묶음은 없는 필드만 채운다 */
const COMBO_KEYS_VERSION = 4;
/** 체력 단축키 옮기기는 이 판 전의 묶음에만 */
const HP_KEYS_VERSION = 2;
export const DEFAULT_ASSIST: AssistSettings = {
  speed: 1, skipSeen: true, autoFast: true, autoSpeed: 8, hotkeys: DEFAULT_HOTKEYS, quickSlot: null,
  noRandomEncounter: false, skipBattles: false, skipKnownOnly: false,
};
export type HotkeyGroup = "진행" | "전투" | "체력" | "세이브" | "백업";
export const HOTKEY_GROUPS: readonly HotkeyGroup[] = ["진행", "전투", "체력", "세이브", "백업"];
/** 단축키 동작(표시 순서·묶음)과 이름. short는 하단 안내 줄에 쓴다. */
export const HOTKEY_ACTIONS: readonly { action: HotkeyAction; group: HotkeyGroup; label: string; short: string }[] = [
  { action: "speed", group: "진행", label: "배속 바꾸기", short: "배속" },
  { action: "autoSpeed", group: "진행", label: "자동 배속 빠르기 바꾸기", short: "자동 배속 빠르기" },
  { action: "skip", group: "진행", label: "본 대사 넘기기 켜고 끄기", short: "본 대사 넘기기" },
  { action: "autoFast", group: "진행", label: "본 이벤트 자동 배속 켜고 끄기", short: "자동 배속" },
  { action: "win", group: "전투", label: "전투 이기기", short: "이기기" },
  { action: "lose", group: "전투", label: "전투 지기", short: "지기" },
  { action: "escape", group: "전투", label: "전투 도망", short: "도망" },
  { action: "enemyHpFull", group: "전투", label: "적 체력 100%", short: "적 체력 100%" },
  { action: "enemyHpLow", group: "전투", label: "적 체력 1%", short: "적 체력 1%" },
  { action: "hpFull", group: "체력", label: "내 체력 100%", short: "100%" },
  { action: "hpLow", group: "체력", label: "내 체력 1%", short: "1%" },
  { action: "quickSave", group: "세이브", label: "퀵 세이브", short: "퀵 세이브" },
  { action: "quickLoad", group: "세이브", label: "퀵 로드(두 번)", short: "퀵 로드(두 번)" },
  { action: "saveMenu", group: "세이브", label: "세이브 창 열기", short: "세이브 창" },
  { action: "loadMenu", group: "세이브", label: "로드 창 열기", short: "로드 창" },
  { action: "backup", group: "백업", label: "세이브 백업", short: "백업" },
  { action: "restore", group: "백업", label: "마지막 백업으로 복원(두 번)", short: "복원(두 번)" },
];
/** 게임이 이미 쓰는 keyCode(Tab·Enter·Shift·Ctrl·Alt·Esc·Space·PgUp/Dn·방향키·Ins·Q·W·X·Z·숫자패드 방향·F2~F5·F8·F9). 조합 없는 키에만 적용한다. */
export const RESERVED_KEYCODES: ReadonlySet<number> = new Set([
  9, 13, 16, 17, 18, 27, 32, 33, 34, 37, 38, 39, 40, 45, 81, 87, 88, 90, 96, 98, 100, 102, 104, 113, 114, 115, 116, 119, 120,
]);
/**
 * 조합 키로도 쓸 수 없는 키: 이동·결정·취소·메뉴(Tab·Enter·Esc·Space·PgUp/Dn·방향키·Ins·숫자패드 방향). 플러그인이 조합 키를
 * 먹어서 게임에 넘기지 않으므로, 이 키들에 조합을 걸면 Ctrl·Shift를 누른 채 움직이거나 고를 수 없게 된다.
 */
const NAV_KEYCODES: ReadonlySet<number> = new Set([9, 13, 27, 32, 33, 34, 37, 38, 39, 40, 45, 96, 98, 100, 102, 104]);
/**
 * 게임 창(NW.js·크롬)이나 Windows가 먼저 가져가는 조합: Ctrl+R(새로고침)·Ctrl+W·Ctrl+Q·Ctrl+N·Ctrl+T(창), Ctrl+Shift+I·J·C(개발자 도구),
 * Ctrl+P(인쇄), Ctrl+F4·Alt+F4(창 닫기), Shift+F10(오른쪽 클릭 메뉴), Ctrl+=·-·0(확대), Ctrl+Shift+Delete.
 */
const RESERVED_COMBOS: ReadonlySet<number> = new Set([
  ctrl(82), ctrlShift(82), ctrl(87), ctrlShift(87), ctrl(81), ctrlShift(81), ctrl(78), ctrlShift(78), ctrl(84), ctrlShift(84),
  ctrlShift(73), ctrlShift(74), ctrlShift(67), ctrl(80), ctrlShift(80),
  ctrl(115), 115 | MOD_ALT, 121 | MOD_SHIFT,
  ctrl(187), ctrl(189), ctrl(48), ctrl(107), ctrl(109), ctrlShift(187), ctrlShift(189), ctrlShift(48),
  ctrlShift(46),
]);
export const SPEEDS = [1, 2, 4, 8] as const;
export const AUTO_SPEEDS = [2, 4, 8] as const;
/** control.json 지원 플러그인 최소 버전 */
export const ASSIST_MIN_VERSION = "1.1.0";
/** 체력 명령(hpFull·hpLow) 지원 플러그인 최소 버전 */
export const HP_COMMAND_MIN_VERSION = "1.12.0";
/** 세이브·로드 명령(saveMenu·loadMenu·quickSave·quickLoad)과 그 단축키, 백업·복원 단축키를 지원하는 플러그인 최소 버전 */
export const SAVE_COMMAND_MIN_VERSION = "1.21.0";
/** 적 체력 명령(enemyHpFull·enemyHpLow)과 그 단축키를 지원하는 플러그인 최소 버전 */
export const ENEMY_HP_COMMAND_MIN_VERSION = "1.23.0";
/** 랜덤 전투 끄기·전투 건너뛰기·잡아 본 적만(noRandomEncounter·skipBattles·skipKnownOnly)을 지원하는 플러그인 최소 버전 */
export const ENCOUNTER_MIN_VERSION = "1.24.0";
const COMMAND_KINDS: ReadonlySet<unknown> = new Set<AssistCommandKind>([
  "win", "lose", "escape", "enemyHpFull", "enemyHpLow", "hpFull", "hpLow", "cheat", "saveMenu", "loadMenu", "quickSave", "quickLoad",
]);
/** 세이브·로드 명령인가 */
export const isSaveCommand = (kind: unknown): boolean => kind === "saveMenu" || kind === "loadMenu" || kind === "quickSave" || kind === "quickLoad";
/** 퀵 세이브 칸으로 받을 수 있는 수(플러그인도 1~999만 받고, 게임의 칸 수보다 크면 마지막 칸을 쓴다) */
export const isQuickSlot = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 999;
/** 파티 체력 명령인가(맵·전투 모두에서 쓴다) */
export const isHpCommand = (kind: unknown): boolean => kind === "hpFull" || kind === "hpLow";
/** 적 체력 명령인가(전투 중만) */
export const isEnemyHpCommand = (kind: unknown): boolean => kind === "enemyHpFull" || kind === "enemyHpLow";

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === "object";

export const isSpeed = (v: unknown): v is AssistSettings["speed"] => v === 1 || v === 2 || v === 4 || v === 8;
export const isAutoSpeed = (v: unknown): v is AssistSettings["autoSpeed"] => v === 2 || v === 4 || v === 8;

/** 플러그인과 같은 범위: keyCode 8~255에 조합 비트(256·512·1024)만 */
const isKeyCode = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && (v & ~(255 | MOD_MASK)) === 0 && (v & 255) >= 8;
/** 단축키로 쓸 수 없는 잠금·조합·Windows 키(NumLock·ScrollLock·CapsLock·Shift·Ctrl·Alt·Win·메뉴) — 플러그인도 거절한다 */
const LOCK_KEYCODES: ReadonlySet<number> = new Set([144, 145, 20, 16, 17, 18, 91, 92, 93]);

/** 문장 부호 키(US·한국어 배열) */
const PUNCT_LABELS: Readonly<Record<number, string>> = {
  186: ";", 187: "=", 188: ",", 189: "-", 190: ".", 191: "/", 192: "`(숫자 1 왼쪽)", 219: "[", 220: "\\", 221: "]", 222: "'",
};

function baseLabel(code: number): string {
  if (code >= 112 && code <= 123) return `F${code - 111}`;
  if ((code >= 65 && code <= 90) || (code >= 48 && code <= 57)) return String.fromCharCode(code);
  if (code >= 96 && code <= 105) return `Num ${code - 96}`;
  if (code === 36) return "Home";
  if (code === 35) return "End";
  if (code === 46) return "Delete";
  const punct = PUNCT_LABELS[code];
  if (punct !== undefined) return punct;
  return `키 ${code}`;
}

/** 단축키 → 사람이 읽는 이름(Ctrl+Shift+S, F1~F12, 글자, 숫자, Num 0~9, 그 밖에는 `키 {code}`). */
export function keyLabel(code: number): string {
  const mods = (code & MOD_CTRL ? "Ctrl+" : "") + (code & MOD_SHIFT ? "Shift+" : "") + (code & MOD_ALT ? "Alt+" : "");
  return mods + baseLabel(code & 255);
}

/** 이 키를 이 동작에 쓸 수 있으면 null, 아니면 이유(한국어). null(끄기)은 언제나 된다. 예외를 던지지 않는다. */
export function validateHotkey(code: number | null, action: HotkeyAction, hotkeys: Hotkeys): string | null {
  if (code === null) return null;
  if (!isKeyCode(code)) return "쓸 수 없는 키예요";
  const name = keyLabel(code);
  const base = code & 255, mods = code & MOD_MASK;
  if (base === 16 || base === 17 || base === 18) return "Ctrl·Shift·Alt만으로는 단축키로 쓸 수 없어요";
  if (LOCK_KEYCODES.has(base)) return `${name}은(는) 단축키로 쓸 수 없어요`;
  if (mods === 0) {
    if (RESERVED_KEYCODES.has(code)) return `${name}은(는) 게임이 이미 쓰는 키예요`;
  } else {
    if ((mods & MOD_CTRL) && (mods & MOD_ALT)) return "Ctrl과 Alt를 함께 누르는 조합은 쓸 수 없어요";
    if (NAV_KEYCODES.has(base)) return `${name}은(는) 쓸 수 없어요 — 이동·결정·취소 키에는 조합을 걸 수 없어요`;
    // Shift는 게임의 대시: Shift만 더한 게임 키(Shift+Z 등)는 대시하며 누르는 키라 쓸 수 없다
    if (mods === MOD_SHIFT && RESERVED_KEYCODES.has(base)) return `${name}은(는) 게임이 이미 쓰는 키예요`;
    if (RESERVED_COMBOS.has(code)) return `${name}은(는) 게임 창이나 Windows가 쓰는 키예요`;
  }
  for (const a of HOTKEY_ACTIONS) {
    if (a.action !== action && isObj(hotkeys) && hotkeys[a.action] === code) return `${name}은(는) 이미 '${a.label}'에 쓰고 있어요`;
  }
  return null;
}

/**
 * 디스크·localStorage에서 읽은 보조 설정(무엇이든)을 지금 판으로 옮긴다(normalizeAssist 전에). 예외를 던지지 않는다.
 * - 판 표시(`hotkeys.v`)가 없는 예전 묶음에서 체력 단축키가 둘 다 null이면 예전 기본값(끔)을 그대로 둔 것이므로 새 기본값을 준다.
 *   새 판에서 사용자가 둘 다 끈 것은 판 표시가 있으므로 그대로 둔다.
 * - 4 전 묶음: 1.21.0 기본값과 같은(또는 없는) 필드는 새 기본값으로, 바꾼 필드는 그대로 두되 새 기본값과 겹치면 끈다.
 * - 4 묶음: 그대로 두고, 없는 필드만 기본값을 준다(다른 필드가 이미 그 키를 쓰면 끈다).
 */
export function migrateSavedAssist(v: unknown): unknown {
  if (!isObj(v) || !isObj(v.hotkeys)) return v;
  let h: Record<string, unknown> = v.hotkeys;
  const ver = typeof h.v === "number" ? h.v : 0;
  if (ver >= HOTKEYS_VERSION) return v;
  if (ver >= COMBO_KEYS_VERSION) {
    const filled: Record<string, unknown> = { ...h };
    for (const { action } of HOTKEY_ACTIONS) {
      if (filled[action] !== undefined) continue;
      const def = DEFAULT_HOTKEYS[action];
      filled[action] = HOTKEY_ACTIONS.some((a) => a.action !== action && filled[a.action] === def) ? null : def;
    }
    return { ...v, hotkeys: { ...filled, v: HOTKEYS_VERSION } };
  }
  if (ver < HP_KEYS_VERSION && h.hpFull === null && h.hpLow === null) {
    const { hpFull: _f, hpLow: _l, ...rest } = h;
    h = rest;
  }
  const out: Record<string, number | null> = {};
  const custom: HotkeyAction[] = [];
  for (const { action } of HOTKEY_ACTIONS) {
    const raw = h[action];
    const old = V3_DEFAULT_HOTKEYS[action];
    if (raw === undefined || (old !== undefined && raw === old)) out[action] = DEFAULT_HOTKEYS[action];
    else if (raw === null || isKeyCode(raw)) { out[action] = raw; custom.push(action); }
    else out[action] = DEFAULT_HOTKEYS[action];
  }
  // 바꾼 필드가 새 기본값으로 옮긴 필드와 겹치면 바꾼 쪽을 끈다
  for (const a of custom) {
    const c = out[a];
    if (c !== null && HOTKEY_ACTIONS.some(({ action }) => action !== a && !custom.includes(action) && out[action] === c)) out[a] = null;
  }
  return { ...v, hotkeys: { ...out, v: HOTKEYS_VERSION } };
}

/** 저장된 단축키(무엇이든) → 올바른 단축키. 없는 필드는 기본값, 잘못됐거나 겹치는 키는 기본값(그것도 겹치면 끔). */
export function normalizeHotkeys(v: unknown): Hotkeys {
  const o = isObj(v) ? v : {};
  const out: Hotkeys = { ...LEGACY_HOTKEYS };
  for (const { action } of HOTKEY_ACTIONS) out[action] = null;
  for (const { action } of HOTKEY_ACTIONS) {
    const raw: unknown = o[action];
    const want = raw === null ? null : isKeyCode(raw) ? raw : DEFAULT_HOTKEYS[action];
    if (validateHotkey(want, action, out) === null) out[action] = want;
    else if (DEFAULT_HOTKEYS[action] !== null && validateHotkey(DEFAULT_HOTKEYS[action], action, out) === null) out[action] = DEFAULT_HOTKEYS[action];
  }
  return out;
}

/** 저장할 단축키 묶음: 판 표시(`v`)를 붙인다(localStorage·control.json). */
export const hotkeysForSave = (h: Hotkeys): Hotkeys & { v: number } => ({ ...h, v: HOTKEYS_VERSION });

/**
 * live.json `assist`(무엇이든)에서 게임에 실제로 걸린 단축키. `hotkeys`를 보고하지 않는 플러그인은
 * 예전 기본 단축키가 고정이므로 예전 기본값(체력 단축키 없음). 필드별로 null이면 끔, 단축키 값이면 그 키,
 * 그 밖에는 예전 기본값(어떤 필드를 보고하지 않는 예전 플러그인에는 그 단축키가 없다).
 */
export function liveHotkeys(assist: unknown): Hotkeys {
  const h = isObj(assist) && isObj(assist.hotkeys) ? assist.hotkeys : null;
  if (!h) return LEGACY_HOTKEYS;
  const pick = (a: HotkeyAction): number | null => (h[a] === null ? null : isKeyCode(h[a]) ? h[a] : LEGACY_HOTKEYS[a]);
  const out: Hotkeys = { ...LEGACY_HOTKEYS };
  for (const { action } of HOTKEY_ACTIONS) out[action] = pick(action);
  return out;
}

/** 하단 안내 줄: "게임 창 단축키 — 진행: F6 배속, … · 전투: …". 모두 끄면 그렇게 말한다. */
export function hotkeySummary(hotkeys: Hotkeys): string {
  const groups = HOTKEY_GROUPS.flatMap((g) => {
    const parts = HOTKEY_ACTIONS.filter((a) => a.group === g).flatMap(({ action, short }) => {
      const c = hotkeys[action];
      return c === null ? [] : [`${keyLabel(c)} ${short}`];
    });
    return parts.length === 0 ? [] : [`${g}: ${parts.join(", ")}`];
  });
  return groups.length === 0 ? "게임 창 단축키를 모두 껐어요" : `게임 창 단축키 — ${groups.join(" · ")}`;
}

/** 두 단축키 묶음이 같은지 */
export const sameHotkeys = (a: Hotkeys, b: Hotkeys): boolean => HOTKEY_ACTIONS.every(({ action }) => a[action] === b[action]);

/** 저장된 값(무엇이든) → 올바른 설정. 이상한 필드는 기본값. 예외를 던지지 않는다. */
export function normalizeAssist(v: unknown): AssistSettings {
  const o = isObj(v) ? v : {};
  return {
    speed: isSpeed(o.speed) ? o.speed : DEFAULT_ASSIST.speed,
    skipSeen: typeof o.skipSeen === "boolean" ? o.skipSeen : DEFAULT_ASSIST.skipSeen,
    autoFast: typeof o.autoFast === "boolean" ? o.autoFast : DEFAULT_ASSIST.autoFast,
    autoSpeed: isAutoSpeed(o.autoSpeed) ? o.autoSpeed : DEFAULT_ASSIST.autoSpeed,
    hotkeys: normalizeHotkeys(o.hotkeys),
    quickSlot: isQuickSlot(o.quickSlot) ? o.quickSlot : null,
    noRandomEncounter: o.noRandomEncounter === true,
    skipBattles: o.skipBattles === true,
    skipKnownOnly: o.skipKnownOnly === true,
  };
}

/** "1.10.0" ≥ "1.9.3" 같은 점 구분 숫자 비교. 버전이 아니면 false. 예외를 던지지 않는다. */
export function versionAtLeast(version: unknown, min: string): boolean {
  if (typeof version !== "string" || !/^\d+(\.\d+)*$/.test(version.trim())) return false;
  const a = version.trim().split(".").map(Number);
  const b = min.split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0, y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}

/**
 * 본 것 묶음.
 * - seenMessages: 본 대사·스크롤 키(seenKey) 전부.
 * - seenPages: 대사·선택지가 하나라도 있고, 선택지 갈래 안까지 모든 대사를 봤고 모든 선택지 항목(취소 포함)을 고른 페이지의 locationKey.
 * 정렬된 배열. 예외를 던지지 않는다.
 */
export function seenSets(coverage: Coverage, index: GameIndex): SeenSets {
  const seenMessages: string[] = [];
  const seenPages: string[] = [];
  try {
    if (isObj(coverage) && coverage.seen instanceof Set) {
      for (const k of coverage.seen) if (typeof k === "string") seenMessages.push(k);
    }
    seenMessages.sort();

    const pageSet = new Set<string>();
    for (const p of arr<PageEntry | null>(index?.pages)) {
      try {
        if (!isObj(p) || !isObj(p.location)) continue;
        const { unseen, unpicked, dialogue } = pageNewCounts(p, coverage, { inChoices: true });
        if (dialogue === 0) continue;
        if (unseen === 0 && unpicked === 0) {
          pageSet.add(locationKey(p.location));
          // TemplateEvent 호출로 불린 목록(원래 이벤트 페이지 등)도 그 안을 다 봤으므로 함께 넣는다(게임의 가장 안쪽 실행 위치).
          walk(arr(p.nodes), [], n => { if (n.kind === "call" && isObj(n.location)) pageSet.add(locationKey(n.location)); });
        }
      } catch {
        /* 이상한 페이지는 건너뛴다 */
      }
    }
    seenPages.push(...pageSet);
    seenPages.sort();
  } catch {
    /* 지금까지 모은 것 */
  }
  return { seenMessages, seenPages };
}

/**
 * control.json 본문(계약 v1). 예외를 던지지 않는다.
 * flags: 켜진 애드온이 싣는 값(예: capturePictures). 기본 필드를 덮어쓰지는 못한다.
 */
export function controlJson(s: AssistSettings, sets: SeenSets, command: AssistCommand | null, now: number, flags: Record<string, unknown> = {}): string {
  const n = normalizeAssist(s);
  const strs = (v: unknown) => arr<unknown>(v).filter((x): x is string => typeof x === "string");
  // 치트 명령은 ops가 올바를 때만 싣는다
  const ok = isObj(command) && typeof command.id === "string" && COMMAND_KINDS.has(command.kind);
  const ops = ok && command.kind === "cheat" ? cheatOpsForControl(command.ops) : null;
  const cmd = ok && (command.kind !== "cheat" || ops !== null)
    ? { id: command.id, kind: command.kind, at: Number.isFinite(command.at) ? command.at : 0, ...(ops ? { ops } : {}) }
    : null;
  return JSON.stringify({
    ...(isObj(flags) ? flags : {}),
    v: 1, t: Number.isFinite(now) ? now : 0,
    speed: n.speed, skipSeen: n.skipSeen, autoFast: n.autoFast, autoSpeed: n.autoSpeed, hotkeys: hotkeysForSave(n.hotkeys),
    quickSlot: n.quickSlot,
    noRandomEncounter: n.noRandomEncounter, skipBattles: n.skipBattles, skipKnownOnly: n.skipKnownOnly,
    seenMessages: strs(sets?.seenMessages), seenPages: strs(sets?.seenPages),
    command: cmd,
  });
}

const CONTROL_KEYS = new Set([
  "v", "t", "speed", "skipSeen", "autoFast", "autoSpeed", "hotkeys", "quickSlot", "noRandomEncounter", "skipBattles", "skipKnownOnly",
  "seenMessages", "seenPages", "command",
]);

/**
 * 디스크의 control.json(다른 뷰어가 썼을 수도 있다: PC와 휴대폰이 같은 파일을 쓴다).
 * body = 같은 내용을 controlJson으로 t 없이 다시 만든 것(우리 본문과 같은지 비교용), flags = 기본 필드 밖의 값.
 */
export interface ControlFile {
  t: number; settings: AssistSettings; sets: SeenSets; flags: Record<string, unknown>; command: AssistCommand | null; body: string;
}

/** control.json 글 → ControlFile. v1이 아니거나 t가 없거나 깨졌으면 null. 예외를 던지지 않는다. */
export function parseControlFile(text: string | null | undefined): ControlFile | null {
  if (typeof text !== "string") return null;
  let c: unknown;
  try { c = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text); } catch { return null; }
  if (!isObj(c) || c.v !== 1 || typeof c.t !== "number" || !Number.isFinite(c.t)) return null;
  const settings = normalizeAssist(migrateSavedAssist(c));
  const strs = (v: unknown) => arr<unknown>(v).filter((x): x is string => typeof x === "string");
  const sets: SeenSets = { seenMessages: strs(c.seenMessages), seenPages: strs(c.seenPages) };
  const flags: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(c)) if (!CONTROL_KEYS.has(k)) flags[k] = v;
  const m = c.command;
  const command: AssistCommand | null = isObj(m) && typeof m.id === "string" && COMMAND_KINDS.has(m.kind)
    ? { id: m.id, kind: m.kind, at: typeof m.at === "number" && Number.isFinite(m.at) ? m.at : c.t, ...(Array.isArray(m.ops) ? { ops: m.ops as CheatOp[] } : {}) }
    : null;
  return { t: c.t, settings, sets, flags, command, body: controlJson(settings, sets, command, 0, flags) };
}

/** 설정 하나하나(배속·본 대사 넘기기·자동 배속·자동 배속 값·단축키·퀵 세이브 칸·적 만남) */
export type AssistKey = keyof AssistSettings;
export const ASSIST_KEYS: readonly AssistKey[] = [
  "speed", "skipSeen", "autoFast", "autoSpeed", "hotkeys", "quickSlot", "noRandomEncounter", "skipBattles", "skipKnownOnly",
];

/** a와 b에서 값이 다른 설정 키들 */
export function changedAssistKeys(a: AssistSettings, b: AssistSettings): AssistKey[] {
  return ASSIST_KEYS.filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
}

/**
 * 읽고-고쳐-쓰기: 디스크(다른 뷰어가 쓴 것)의 설정에, 이 뷰어에서 아직 쓰지 못한 채 바꾼 키(dirty)만 얹는다.
 * 그래서 휴대폰에서 배속을, PC에서 단축키를 바꿔도 서로 덮어쓰지 않는다.
 */
export function mergeAssist(disk: AssistSettings, local: AssistSettings, dirty: Iterable<AssistKey>): AssistSettings {
  const out: AssistSettings = { ...disk };
  for (const k of dirty) if (ASSIST_KEYS.includes(k)) (out as unknown as Record<string, unknown>)[k] = local[k];
  return normalizeAssist(out);
}

/** 다른 뷰어가 남긴 명령을 이번 쓰기에 그대로 실을까: 아직 TTL 안이고, 우리가 보낼 명령이 따로 없을 때만(게임은 같은 id를 한 번만 쓴다). */
export function carryCommand(disk: ControlFile | null, ours: AssistCommand | null, now: number, ttlMs: number): AssistCommand | null {
  if (ours) return ours;
  const c = disk?.command ?? null;
  return c && now - c.at < ttlMs && now - c.at >= -ttlMs ? c : null;
}

/** 마지막으로 성공한 control.json 쓰기 */
export interface WrittenControl { t: number; settings: AssistSettings }
export type AdoptPatch = Partial<Pick<AssistSettings, "speed" | "skipSeen" | "autoFast" | "autoSpeed">>;

/**
 * live.json `assist`의 배속·본 대사 넘기기·본 이벤트 자동 배속·자동 배속 빠르기(1.22.0) 중 게임 창 단축키로 바뀐 값(받아들일 것). 없으면 null.
 * 게임이 우리가 마지막으로 쓴 파일을 적용한 뒤(controlT === written.t) 스스로 바꾼 값만 받는다 —
 * 쓰는 중이거나(pending) controlT가 다르면 예전 파일의 메아리일 수 있으므로 무시한다. 예외를 던지지 않는다.
 */
export function adoptLiveAssist(assist: unknown, written: WrittenControl | null, current: AssistSettings, pending: boolean): AdoptPatch | null {
  if (pending || !written || !isObj(assist)) return null;
  if (typeof assist.controlT !== "number" || assist.controlT !== written.t) return null;
  const patch: AdoptPatch = {};
  if (isSpeed(assist.speed) && assist.speed !== written.settings.speed && assist.speed !== current.speed) patch.speed = assist.speed;
  if (typeof assist.skipSeen === "boolean" && assist.skipSeen !== written.settings.skipSeen && assist.skipSeen !== current.skipSeen) {
    patch.skipSeen = assist.skipSeen;
  }
  if (typeof assist.autoFast === "boolean" && assist.autoFast !== written.settings.autoFast && assist.autoFast !== current.autoFast) {
    patch.autoFast = assist.autoFast;
  }
  if (isAutoSpeed(assist.autoSpeed) && assist.autoSpeed !== written.settings.autoSpeed && assist.autoSpeed !== current.autoSpeed) {
    patch.autoSpeed = assist.autoSpeed;
  }
  return Object.keys(patch).length === 0 ? null : patch;
}

/** 게임이 적용한 control.json이 우리가 마지막으로 쓴 것과 이만큼 오래 다르면 다시 쓴다. */
export const RESYNC_AFTER_MS = 3000;
/** 다시 쓰기는 이 간격보다 자주 하지 않는다. */
export const RESYNC_MIN_INTERVAL_MS = 5000;

/**
 * 게임이 적용한 control.json(controlT)이 마지막으로 쓴 것(writtenT)과 다른가. controlT를 보고하지 않는 플러그인(필드 없음)은
 * 판단할 수 없으므로 false. controlT가 null(아직 적용 안 함)이거나 아직 한 번도 못 썼으면(writtenT null) 다르다.
 */
export function controlMismatch(assist: unknown, writtenT: number | null): boolean {
  if (!isObj(assist) || !("controlT" in assist)) return false;
  const c: unknown = assist.controlT;
  if (c !== null && typeof c !== "number") return false;
  return writtenT === null || c !== writtenT;
}

/** 다시 쓸 때인가: 어긋난 지(mismatchSince) 3초를 넘었고 마지막 다시 쓰기에서 5초가 지났다. */
export function resyncDue(mismatchSince: number | null, lastResyncAt: number | null, now: number): boolean {
  if (mismatchSince === null || now - mismatchSince <= RESYNC_AFTER_MS) return false;
  return lastResyncAt === null || now - lastResyncAt >= RESYNC_MIN_INTERVAL_MS;
}

/** 전투 명령 응답이 이 시간 안에 오지 않으면 게임이 응답하지 않는 것으로 본다. */
export const COMMAND_RESPONSE_MS = 5000;
export type CommandStatus = "sent" | "applied" | "ignored" | "failed" | "noResponse";
export const COMMAND_STATUS_TEXT: Record<CommandStatus, string> = {
  sent: "보냄…",
  applied: "적용됐어요",
  ignored: "게임에서 무시했어요 (전투 중이 아니거나 이미 끝나는 중)",
  failed: "실행하지 못했어요",
  noResponse: "게임이 응답하지 않아요",
};

/** 명령 종류에 맞춘 상태 문구: 체력 명령의 무시는 전투와 상관없다. */
export function commandStatusText(status: CommandStatus, kind: unknown): string {
  if (status === "ignored" && isHpCommand(kind)) return "게임에서 무시했어요 (파티가 없어요)";
  if (status === "ignored" && isSaveCommand(kind)) return "지금은 할 수 없어요 (게임 화면의 안내를 보세요)";
  return COMMAND_STATUS_TEXT[status];
}

/**
 * 보낸 명령(sent)의 상태: live.json `assist.lastCommand`가 id·`id:ignored`·`id:failed`인지 보고,
 * 아직 응답이 없으면 timedOut(보낸 지 COMMAND_RESPONSE_MS가 지났나)에 따라 noResponse·sent.
 */
export function commandStatus(sent: { id: string } | null, lastCommand: unknown, timedOut: boolean): CommandStatus | null {
  if (!sent) return null;
  if (lastCommand === sent.id) return "applied";
  if (lastCommand === `${sent.id}:ignored`) return "ignored";
  if (lastCommand === `${sent.id}:failed`) return "failed";
  return timedOut ? "noResponse" : "sent";
}
