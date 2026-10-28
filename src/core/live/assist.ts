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
export interface AssistSettings { speed: 1 | 2 | 4 | 8; skipSeen: boolean; autoFast: boolean; autoSpeed: 2 | 4 | 8; hotkeys: Hotkeys }
/** 게임 창 단축키 동작 */
export type HotkeyAction = "speed" | "skip" | "win" | "lose" | "hpFull" | "hpLow";
/** 동작별 DOM keyCode. null = 끔. */
export type Hotkeys = Record<HotkeyAction, number | null>;
/** win·lose·escape: 전투 중만. hpFull·hpLow(플러그인 1.12.0): 파티 체력 100%(쓰러진 동료도 살림)·1%, 맵과 전투 모두. */
/** cheat(플러그인 1.14.0): ops를 실은 치트 명령(core/live/cheat) */
export type AssistCommandKind = "win" | "lose" | "escape" | "hpFull" | "hpLow" | "cheat";
/** at = 사용자가 누른 시각(ms), ops: kind가 cheat일 때만 */
export interface AssistCommand { id: string; kind: AssistCommandKind; at: number; ops?: CheatOp[] }
export interface SeenSets { seenMessages: string[]; seenPages: string[] }

export const DEFAULT_HOTKEYS: Hotkeys = { speed: 117, skip: 118, win: 121, lose: 122, hpFull: null, hpLow: null };
export const DEFAULT_ASSIST: AssistSettings = { speed: 1, skipSeen: true, autoFast: true, autoSpeed: 8, hotkeys: DEFAULT_HOTKEYS };
/** 단축키 동작(표시 순서)과 이름. short는 하단 안내 줄에 쓴다. */
export const HOTKEY_ACTIONS: readonly { action: HotkeyAction; label: string; short: string }[] = [
  { action: "speed", label: "배속 바꾸기", short: "배속" },
  { action: "skip", label: "본 대사 넘기기 켜고 끄기", short: "본 대사 넘기기" },
  { action: "win", label: "전투 이기기", short: "전투 중 이기기" },
  { action: "lose", label: "전투 지기", short: "전투 중 지기" },
  { action: "hpFull", label: "내 체력 100%", short: "체력 100%" },
  { action: "hpLow", label: "내 체력 1%", short: "체력 1%" },
];
/** 게임이 이미 쓰는 keyCode(Tab·Enter·Shift·Ctrl·Alt·Esc·Space·PgUp/Dn·방향키·Ins·Q·W·X·Z·숫자패드 방향·F2~F5·F8·F9) */
export const RESERVED_KEYCODES: ReadonlySet<number> = new Set([
  9, 13, 16, 17, 18, 27, 32, 33, 34, 37, 38, 39, 40, 45, 81, 87, 88, 90, 96, 98, 100, 102, 104, 113, 114, 115, 116, 119, 120,
]);
export const SPEEDS = [1, 2, 4, 8] as const;
export const AUTO_SPEEDS = [2, 4, 8] as const;
/** control.json 지원 플러그인 최소 버전 */
export const ASSIST_MIN_VERSION = "1.1.0";
/** 체력 명령(hpFull·hpLow) 지원 플러그인 최소 버전 */
export const HP_COMMAND_MIN_VERSION = "1.12.0";
const COMMAND_KINDS: ReadonlySet<unknown> = new Set<AssistCommandKind>(["win", "lose", "escape", "hpFull", "hpLow", "cheat"]);
/** 파티 체력 명령인가(맵·전투 모두에서 쓴다) */
export const isHpCommand = (kind: unknown): boolean => kind === "hpFull" || kind === "hpLow";

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === "object";

export const isSpeed = (v: unknown): v is AssistSettings["speed"] => v === 1 || v === 2 || v === 4 || v === 8;
export const isAutoSpeed = (v: unknown): v is AssistSettings["autoSpeed"] => v === 2 || v === 4 || v === 8;

/** 플러그인과 같은 범위: 정수 8~255 */
const isKeyCode = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 8 && v <= 255;
/** 단축키로 쓸 수 없는 잠금 키(NumLock·ScrollLock) — 플러그인도 거절한다 */
const LOCK_KEYCODES: ReadonlySet<number> = new Set([144, 145]);

/** keyCode → 사람이 읽는 이름(F1~F12, 글자, 숫자, Num 0~9, 그 밖에는 `키 {code}`). */
export function keyLabel(code: number): string {
  if (code >= 112 && code <= 123) return `F${code - 111}`;
  if ((code >= 65 && code <= 90) || (code >= 48 && code <= 57)) return String.fromCharCode(code);
  if (code >= 96 && code <= 105) return `Num ${code - 96}`;
  return `키 ${code}`;
}

/** 이 키를 이 동작에 쓸 수 있으면 null, 아니면 이유(한국어). null(끄기)은 언제나 된다. 예외를 던지지 않는다. */
export function validateHotkey(code: number | null, action: HotkeyAction, hotkeys: Hotkeys): string | null {
  if (code === null) return null;
  if (!isKeyCode(code)) return "쓸 수 없는 키예요";
  const name = keyLabel(code);
  if (RESERVED_KEYCODES.has(code)) return `${name}은(는) 게임이 이미 쓰는 키예요`;
  if (LOCK_KEYCODES.has(code)) return `${name}은(는) 단축키로 쓸 수 없어요`;
  for (const a of HOTKEY_ACTIONS) {
    if (a.action !== action && isObj(hotkeys) && hotkeys[a.action] === code) return `${name}은(는) 이미 '${a.label}'에 쓰고 있어요`;
  }
  return null;
}

/** 저장된 단축키(무엇이든) → 올바른 단축키. 없는 필드는 기본값, 잘못됐거나 겹치는 키는 기본값(그것도 겹치면 끔). */
export function normalizeHotkeys(v: unknown): Hotkeys {
  const o = isObj(v) ? v : {};
  const out: Hotkeys = { speed: null, skip: null, win: null, lose: null, hpFull: null, hpLow: null };
  for (const { action } of HOTKEY_ACTIONS) {
    const raw: unknown = o[action];
    const want = raw === null ? null : isKeyCode(raw) ? raw : DEFAULT_HOTKEYS[action];
    if (validateHotkey(want, action, out) === null) out[action] = want;
    else if (DEFAULT_HOTKEYS[action] !== null && validateHotkey(DEFAULT_HOTKEYS[action], action, out) === null) out[action] = DEFAULT_HOTKEYS[action];
  }
  return out;
}

/**
 * live.json `assist`(무엇이든)에서 게임에 실제로 걸린 단축키. `hotkeys`를 보고하지 않는 플러그인은
 * 기본 단축키가 고정이므로 기본값. 필드별로 null이면 끔, keyCode면 그 키, 그 밖에는 기본값.
 */
export function liveHotkeys(assist: unknown): Hotkeys {
  const h = isObj(assist) && isObj(assist.hotkeys) ? assist.hotkeys : null;
  if (!h) return DEFAULT_HOTKEYS;
  const pick = (a: HotkeyAction): number | null => (h[a] === null ? null : isKeyCode(h[a]) ? h[a] : DEFAULT_HOTKEYS[a]);
  return { speed: pick("speed"), skip: pick("skip"), win: pick("win"), lose: pick("lose"), hpFull: pick("hpFull"), hpLow: pick("hpLow") };
}

/** 하단 안내 줄: "게임 창 단축키: F6 배속, F7 본 대사 넘기기, …". 모두 끄면 그렇게 말한다. */
export function hotkeySummary(hotkeys: Hotkeys): string {
  const parts = HOTKEY_ACTIONS.flatMap(({ action, short }) => {
    const c = hotkeys[action];
    return c === null ? [] : [`${keyLabel(c)} ${short}`];
  });
  return parts.length === 0 ? "게임 창 단축키를 모두 껐어요" : `게임 창 단축키: ${parts.join(", ")}`;
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
    speed: n.speed, skipSeen: n.skipSeen, autoFast: n.autoFast, autoSpeed: n.autoSpeed, hotkeys: n.hotkeys,
    seenMessages: strs(sets?.seenMessages), seenPages: strs(sets?.seenPages),
    command: cmd,
  });
}

/** 마지막으로 성공한 control.json 쓰기 */
export interface WrittenControl { t: number; settings: AssistSettings }
export type AdoptPatch = Partial<Pick<AssistSettings, "speed" | "skipSeen">>;

/**
 * live.json `assist`의 배속·본 대사 넘기기 중 게임 창 단축키로 바뀐 값(받아들일 것). 없으면 null.
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
