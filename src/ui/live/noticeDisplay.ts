import { useCallback, useSyncExternalStore } from "react";

/** 읽기·기록의 `알림 문구 보기`(알림 문구 기록 애드온의 문구를 보일지). 기본 켬, 브라우저에 기억한다. 화면 사이에 공유한다. */
const KEY = "rpgv.reader.notices";
const listeners = new Set<() => void>();
let shown: boolean | null = null;

function load(): boolean {
  try { return localStorage.getItem(KEY) !== "0"; } catch { return true; }
}
function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
function get(): boolean {
  if (shown === null) shown = load();
  return shown;
}

export function useNoticesShown(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(subscribe, get);
  const set = useCallback((v: boolean) => {
    shown = v;
    try { localStorage.setItem(KEY, v ? "1" : "0"); } catch { /* 저장소 사용 불가 */ }
    listeners.forEach((fn) => fn());
  }, []);
  return [on, set];
}
