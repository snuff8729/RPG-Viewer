import { useCallback, useSyncExternalStore } from "react";

/** 읽기의 `전투 기록 보기`(전투 묶음을 보일지). 기본 켬, 브라우저에 기억한다. 화면 사이에 공유한다. */
const KEY = "rpgv.reader.battles";
const listeners = new Set<() => void>();
let shown: boolean | null = null;

/** 저장된 `전투 기록 보기`(읽기 숨김 규칙으로 옮길 때도 읽는다) */
export function loadBattlesShown(): boolean {
  try { return localStorage.getItem(KEY) !== "0"; } catch { return true; }
}
const load = loadBattlesShown;
function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
function get(): boolean {
  if (shown === null) shown = load();
  return shown;
}

export function useBattlesShown(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(subscribe, get);
  const set = useCallback((v: boolean) => {
    shown = v;
    try { localStorage.setItem(KEY, v ? "1" : "0"); } catch { /* 저장소 사용 불가 */ }
    listeners.forEach((fn) => fn());
  }, []);
  return [on, set];
}

/** 전투 결과 표시 글 */
export const BATTLE_RESULT_LABEL = { win: "승리", lose: "패배", escape: "도주", abort: "중단" } as const;
