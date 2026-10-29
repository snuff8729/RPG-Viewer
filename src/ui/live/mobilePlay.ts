/** 휴대폰 너비 플레이 화면: 아래 탭(읽기·맵·스토리) 기억과 새 대사 수. 저장소 오류로 예외를 던지지 않는다. */
import type { LogRecord } from "@/core/live/types";

export type PlayTab = "read" | "map" | "story";

const KEY = "rpgv.play.mobileTab";

export interface TabStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStore(): TabStore | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

export function isPlayTab(v: unknown): v is PlayTab {
  return v === "read" || v === "map" || v === "story";
}

/** 저장된 탭. 없거나 읽을 수 없으면 `read`(읽기). */
export function loadPlayTab(store: TabStore | null = defaultStore()): PlayTab {
  try {
    const raw = store?.getItem(KEY);
    return isPlayTab(raw) ? raw : "read";
  } catch {
    return "read";
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
