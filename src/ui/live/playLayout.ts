/** 플레이 화면 배치와 저장(사이드바 접힘·패널 크기). 저장소 오류로 예외를 던지지 않는다. */

/** 이보다 좁으면 공통 휴대폰 탭 배치를 쓴다(px) */
export const PLAY_BREAKPOINT = 900;

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStore(): KeyValueStore | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

/** 읽기·쓰기에서 예외가 나도 조용히 넘어가는 저장소(Resizable의 useDefaultLayout용) */
export function safeStore(store: KeyValueStore | null = defaultStore()): KeyValueStore {
  return {
    getItem(key) { try { return store?.getItem(key) ?? null; } catch { return null; } },
    setItem(key, value) { try { store?.setItem(key, value); } catch { /* 저장소 사용 불가 */ } },
  };
}

/** PC 플레이 화면 도구 칸의 탭 */
export const TOOL_TABS = ["assist", "cheat", "read"] as const;
export type ToolTab = (typeof TOOL_TABS)[number];
export const isToolTab = (v: unknown): v is ToolTab => (TOOL_TABS as readonly unknown[]).includes(v);

const TOOL_TAB_KEY = "rpgv.play.toolTab";

/** 마지막으로 본 도구 탭. 없거나 모르면 보조 */
export function loadToolTab(store: KeyValueStore = safeStore()): ToolTab {
  const v = store.getItem(TOOL_TAB_KEY);
  return isToolTab(v) ? v : "assist";
}

export function saveToolTab(tab: ToolTab, store: KeyValueStore = safeStore()): void {
  store.setItem(TOOL_TAB_KEY, tab);
}

/** 맵 칸 아래 목록의 탭(다음 스토리 / 해 볼 것) */
export type BelowTab = "story" | "todo";
export const isBelowTab = (v: unknown): v is BelowTab => v === "story" || v === "todo";

const BELOW_TAB_KEY = "rpgv.play.belowTab";

/** 마지막으로 고른 아래 목록 탭. 고른 적이 없거나 모르면 null(그때는 다음 스토리를 찾았는지로 정해요) */
export function loadBelowTab(store: KeyValueStore = safeStore()): BelowTab | null {
  const v = store.getItem(BELOW_TAB_KEY);
  return isBelowTab(v) ? v : null;
}

export function saveBelowTab(tab: BelowTab, store: KeyValueStore = safeStore()): void {
  store.setItem(BELOW_TAB_KEY, tab);
}

