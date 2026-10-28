/** 읽기 탭의 읽은 위치(갈래별 마지막으로 읽은 기록 seq). 저장소 오류로 예외를 던지지 않는다. */
export interface StoreLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStore(): StoreLike | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

export function readKey(gameKey: string, branch: number): string {
  return `rpgv.read.${gameKey}.${branch}`;
}

/** 읽은 마지막 seq. 저장된 게 없거나 읽을 수 없으면 -1. */
export function loadReadSeq(gameKey: string, branch: number, store: StoreLike | null = defaultStore()): number {
  try {
    const raw = store?.getItem(readKey(gameKey, branch));
    if (raw == null || !/^\d+$/.test(raw)) return -1;
    return Number(raw);
  } catch {
    return -1;
  }
}

/** 저장된 값보다 클 때만 저장한다(단조 증가). */
export function saveReadSeq(gameKey: string, branch: number, seq: number, store: StoreLike | null = defaultStore()): void {
  if (!Number.isInteger(seq) || seq < 0 || !store) return;
  try {
    if (seq <= loadReadSeq(gameKey, branch, store)) return;
    store.setItem(readKey(gameKey, branch), String(seq));
  } catch { /* 저장소 사용 불가 */ }
}

/**
 * 갈래의 시작 읽은 위치. 갈래 경로에는 조상 갈래 기록이 앞에 붙어 있으므로,
 * 조상 갈래에서 읽은 위치(그 갈래 몫의 마지막 seq까지)도 이어받는다.
 */
export function initialReadSeq(gameKey: string, branch: number, path: { seq: number; branch: number }[], store: StoreLike | null = defaultStore()): number {
  let best = loadReadSeq(gameKey, branch, store);
  const lastOf = new Map<number, number>();
  for (const r of Array.isArray(path) ? path : []) {
    if (r && typeof r.seq === "number" && r.branch !== branch) lastOf.set(r.branch, Math.max(lastOf.get(r.branch) ?? -1, r.seq));
  }
  for (const [b, last] of lastOf) best = Math.max(best, Math.min(loadReadSeq(gameKey, b, store), last));
  return best;
}
