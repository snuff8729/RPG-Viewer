/** 플레이 화면 배치와 저장(사이드바 접힘·패널 크기). 저장소 오류로 예외를 던지지 않는다. */

/** 이보다 좁으면 맵을 위, 읽기를 아래로 쌓는다(px) */
export const PLAY_BREAKPOINT = 900;

export type PlayLayout = "side" | "stacked";

/** 화면 너비 → 배치. 너비를 아직 모르면(0) 나란히. */
export function playLayout(width: number, breakpoint = PLAY_BREAKPOINT): PlayLayout {
  return width > 0 && width < breakpoint ? "stacked" : "side";
}

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

/** 플레이 화면에서 사이드바를 펼쳐 둘지 */
const SIDEBAR_KEY = "rpgv.play.sidebar";

/** 저장된 값. 없거나 읽을 수 없으면 접힘(게임 옆에 좁게 두는 화면이라) */
export function loadPlaySidebar(store: KeyValueStore = safeStore()): boolean {
  return store.getItem(SIDEBAR_KEY) === "1";
}

export function savePlaySidebar(open: boolean, store: KeyValueStore = safeStore()): void {
  store.setItem(SIDEBAR_KEY, open ? "1" : "0");
}

/** PC 플레이 화면 도구 칸의 탭 */
export const TOOL_TABS = ["cheat", "assist", "read"] as const;
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

/** 맵 칸 아래 탭: 해 볼 것 | 다음 스토리 */
export const MAP_BELOW_TABS = ["todo", "story"] as const;
export type MapBelowTab = (typeof MAP_BELOW_TABS)[number];
export const isMapBelowTab = (v: unknown): v is MapBelowTab => (MAP_BELOW_TABS as readonly unknown[]).includes(v);

const MAP_BELOW_KEY = "rpgv.play.mapBelowTab";

/** 마지막으로 본 맵 칸 아래 탭. 없거나 모르면 해 볼 것 */
export function loadMapBelowTab(store: KeyValueStore = safeStore()): MapBelowTab {
  const v = store.getItem(MAP_BELOW_KEY);
  return isMapBelowTab(v) ? v : "todo";
}

export function saveMapBelowTab(tab: MapBelowTab, store: KeyValueStore = safeStore()): void {
  store.setItem(MAP_BELOW_KEY, tab);
}
