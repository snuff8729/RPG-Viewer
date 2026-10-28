/** "자동으로 맨 아래로" 설정(읽기·기록 탭 공용). 저장소 오류로 예외를 던지지 않는다. */
const KEY = "rpgv.autoFollow";

export interface FollowStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStore(): FollowStore | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

/** 저장된 값. 없거나 읽을 수 없으면 켜짐. */
export function loadAutoFollow(store: FollowStore | null = defaultStore()): boolean {
  try {
    return store?.getItem(KEY) !== "0";
  } catch {
    return true;
  }
}

export function saveAutoFollow(on: boolean, store: FollowStore | null = defaultStore()): void {
  try { store?.setItem(KEY, on ? "1" : "0"); } catch { /* 저장소 사용 불가 */ }
}
