/** 읽기 탭 보기 방식. 저장소 오류로 예외를 던지지 않는다. */
export type ReaderMode = "full" | "flow";

const KEY = "rpgv.readerMode";

export interface ModeStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStore(): ModeStore | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

export function isReaderMode(v: unknown): v is ReaderMode {
  return v === "full" || v === "flow";
}

/** 저장된 보기 방식. 없거나 읽을 수 없으면 `full`(전체 읽기). */
export function loadReaderMode(store: ModeStore | null = defaultStore()): ReaderMode {
  try {
    const raw = store?.getItem(KEY);
    return isReaderMode(raw) ? raw : "full";
  } catch {
    return "full";
  }
}

export function saveReaderMode(mode: ReaderMode, store: ModeStore | null = defaultStore()): void {
  try { store?.setItem(KEY, mode); } catch { /* 저장소 사용 불가 */ }
}
