/** 휴대폰 너비 플레이 화면: 아래 탭(보조·치트·맵·읽기) 기억과 새 대사 수. 저장소 오류로 예외를 던지지 않는다. */
import type { LogRecord } from "@/core/live/types";

export type PlayTab = "assist" | "cheat" | "map" | "read";

/** 탭 순서(아래 탭 줄) */
export const PLAY_TABS: readonly PlayTab[] = ["assist", "cheat", "map", "read"];

/** 지금 탭 기억(보조·치트가 탭이 된 뒤) */
const KEY = "rpgv.play.mobileTab2";
/** 예전 탭 기억(읽기·맵·스토리) — 새 기억이 없을 때 한 번 옮긴다 */
const OLD_KEY = "rpgv.play.mobileTab";

const DEFAULT_TAB: PlayTab = "assist";

export interface TabStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStore(): TabStore | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

export function isPlayTab(v: unknown): v is PlayTab {
  return v === "assist" || v === "cheat" || v === "map" || v === "read";
}

/**
 * 예전 탭 값을 새 탭으로: 맵·스토리(스토리는 이제 맵 탭 아래 목록에)는 맵으로.
 * 읽기는 예전 기본값이라 일부러 고른 것인지 알 수 없어 새 기본값(보조)으로 시작한다.
 */
export function migrateOldTab(old: string | null | undefined): PlayTab {
  return old === "map" || old === "story" ? "map" : DEFAULT_TAB;
}

/** 저장된 탭. 없으면 예전 기억을 옮기고, 그것도 없거나 읽을 수 없으면 `assist`(보조). */
export function loadPlayTab(store: TabStore | null = defaultStore()): PlayTab {
  try {
    const raw = store?.getItem(KEY);
    if (isPlayTab(raw)) return raw;
    return migrateOldTab(store?.getItem(OLD_KEY));
  } catch {
    return DEFAULT_TAB;
  }
}

export function savePlayTab(tab: PlayTab, store: TabStore | null = defaultStore()): void {
  try { store?.setItem(KEY, tab); } catch { /* 저장소 사용 불가 */ }
}

/** 기록에서 대사(메시지·스크롤 글) 수 */
export function countLines(records: readonly Pick<LogRecord, "type">[]): number {
  let n = 0;
  for (const r of records) if (r.type === "message" || r.type === "scroll") n++;
  return n;
}

/** 다른 탭을 보는 동안 늘어난 대사 수. 기록이 처음부터 다시 읽혀 줄었으면 0. */
export function unseenLines(seen: number, now: number): number {
  return now > seen ? now - seen : 0;
}

/** 새 선택지가 떴는가(없던 선택지가 생기거나 다른 선택지로 바뀜) — 읽기 탭으로 넘길 때 */
export function choiceAppeared(prev: string | null, next: string | null): boolean {
  return next !== null && next !== prev;
}
