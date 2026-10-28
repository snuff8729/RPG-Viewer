/** 읽기 탭의 읽은 위치(갈래별 마지막으로 읽은 기록 seq). 저장소 오류로 예외를 던지지 않는다. */
export interface StoreLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  /** 아래 셋은 지우기(clearReadPositions)에만 쓴다. 없으면 지우지 않는다. */
  removeItem?(key: string): void;
  readonly length?: number;
  key?(index: number): string | null;
}

function defaultStore(): StoreLike | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

/** 읽은 위치 저장 키의 게임 부분(게임 제목 + 데이터 폴더). */
export function gameKeyOf(data: { system: { gameTitle: string }; dataRoot: string }): string {
  return `${data.system.gameTitle}|${data.dataRoot}`;
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
 * 기록을 끝까지 읽은 뒤(LiveProvider caughtUp)에만 부른다. 그래서 경로 끝보다 큰 저장값은 기록이 초기화된 뒤의
 * 낡은 값이다 — 버린다(초기화 때 clearReadPositions로 지우지만, 그 직후 이전 기록 기준으로 다시 저장되는 경우 대비).
 */
export function initialReadSeq(gameKey: string, branch: number, path: { seq: number; branch: number }[], store: StoreLike | null = defaultStore()): number {
  let best = loadReadSeq(gameKey, branch, store);
  const lastOf = new Map<number, number>();
  let maxSeq = -1;
  for (const r of Array.isArray(path) ? path : []) {
    if (!r || typeof r.seq !== "number") continue;
    maxSeq = Math.max(maxSeq, r.seq);
    if (r.branch !== branch) lastOf.set(r.branch, Math.max(lastOf.get(r.branch) ?? -1, r.seq));
  }
  if (best > maxSeq) best = -1;
  for (const [b, last] of lastOf) best = Math.max(best, Math.min(loadReadSeq(gameKey, b, store), last));
  return best;
}

/** 게임의 모든 갈래 읽은 위치(rpgv.read.{gameKey}.{갈래})를 지운다 — 기록 파일이 초기화됐을 때. */
export function clearReadPositions(gameKey: string, store: StoreLike | null = defaultStore()): void {
  if (!store || typeof store.key !== "function" || typeof store.removeItem !== "function") return;
  try {
    const prefix = `rpgv.read.${gameKey}.`;
    const doomed: string[] = [];
    const n = store.length ?? 0;
    for (let i = 0; i < n; i++) {
      const k = store.key(i);
      if (k !== null && k.startsWith(prefix) && /^\d+$/.test(k.slice(prefix.length))) doomed.push(k);
    }
    for (const k of doomed) store.removeItem(k);
  } catch { /* 저장소 사용 불가 */ }
}
