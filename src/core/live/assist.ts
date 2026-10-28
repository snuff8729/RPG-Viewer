import { locationKey } from "../index/locations";
import type { GameIndex, PageEntry } from "../types";
import { pageNewCounts } from "./interactable";
import type { Coverage } from "./types";

/**
 * 게임 보조 설정(뷰어 → 게임, rpg-viewer/control.json).
 * autoFast·autoSpeed: 모든 대사·선택지를 본 이벤트가 도는 동안의 자동 배속(전투는 자동 배속하지 않는다).
 */
export interface AssistSettings { speed: 1 | 2 | 4 | 8; skipSeen: boolean; autoFast: boolean; autoSpeed: 2 | 4 | 8 }
export type AssistCommandKind = "win" | "lose" | "escape";
export interface AssistCommand { id: string; kind: AssistCommandKind }
export interface SeenSets { seenMessages: string[]; seenPages: string[] }

export const DEFAULT_ASSIST: AssistSettings = { speed: 1, skipSeen: true, autoFast: true, autoSpeed: 8 };
export const SPEEDS = [1, 2, 4, 8] as const;
export const AUTO_SPEEDS = [2, 4, 8] as const;
/** control.json 지원 플러그인 최소 버전 */
export const ASSIST_MIN_VERSION = "1.1.0";

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === "object";

export const isSpeed = (v: unknown): v is AssistSettings["speed"] => v === 1 || v === 2 || v === 4 || v === 8;
export const isAutoSpeed = (v: unknown): v is AssistSettings["autoSpeed"] => v === 2 || v === 4 || v === 8;

/** 저장된 값(무엇이든) → 올바른 설정. 이상한 필드는 기본값. 예외를 던지지 않는다. */
export function normalizeAssist(v: unknown): AssistSettings {
  const o = isObj(v) ? v : {};
  return {
    speed: isSpeed(o.speed) ? o.speed : DEFAULT_ASSIST.speed,
    skipSeen: typeof o.skipSeen === "boolean" ? o.skipSeen : DEFAULT_ASSIST.skipSeen,
    autoFast: typeof o.autoFast === "boolean" ? o.autoFast : DEFAULT_ASSIST.autoFast,
    autoSpeed: isAutoSpeed(o.autoSpeed) ? o.autoSpeed : DEFAULT_ASSIST.autoSpeed,
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
        if (unseen === 0 && unpicked === 0) pageSet.add(locationKey(p.location));
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

/** control.json 본문(계약 v1). 예외를 던지지 않는다. */
export function controlJson(s: AssistSettings, sets: SeenSets, command: AssistCommand | null, now: number): string {
  const n = normalizeAssist(s);
  const strs = (v: unknown) => arr<unknown>(v).filter((x): x is string => typeof x === "string");
  const cmd = isObj(command) && typeof command.id === "string" && (command.kind === "win" || command.kind === "lose" || command.kind === "escape")
    ? { id: command.id, kind: command.kind }
    : null;
  return JSON.stringify({
    v: 1, t: Number.isFinite(now) ? now : 0,
    speed: n.speed, skipSeen: n.skipSeen, autoFast: n.autoFast, autoSpeed: n.autoSpeed,
    seenMessages: strs(sets?.seenMessages), seenPages: strs(sets?.seenPages),
    command: cmd,
  });
}
