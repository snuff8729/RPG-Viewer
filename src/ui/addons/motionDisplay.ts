import { useCallback, useSyncExternalStore } from "react";
import { motionSetting } from "./playback";

/**
 * 읽기의 `그림 움직임`(그림 바꾸기·이동·컷인 장면을 저절로 움직여 보일지). 브라우저에 기억하고 화면 사이에 공유한다.
 * 한 번도 고르지 않았으면 기기의 `동작 줄이기`가 꺼져 있을 때 켬(처음 값만 정하고, 그다음은 이 설정이 정한다).
 */
const KEY = "rpgv.reader.pictureMotion";
const REDUCED = "(prefers-reduced-motion: reduce)";
const listeners = new Set<() => void>();
let on: boolean | null = null;

function load(): boolean {
  let stored: string | null = null;
  try { stored = localStorage.getItem(KEY); } catch { /* 저장소 사용 불가 */ }
  const reduced = typeof window !== "undefined" && !!window.matchMedia && window.matchMedia(REDUCED).matches;
  return motionSetting(stored, reduced);
}
function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
function get(): boolean {
  if (on === null) on = load();
  return on;
}

export function usePictureMotionOn(): [boolean, (on: boolean) => void] {
  const value = useSyncExternalStore(subscribe, get);
  const set = useCallback((v: boolean) => {
    on = v;
    try { localStorage.setItem(KEY, v ? "1" : "0"); } catch { /* 저장소 사용 불가 */ }
    listeners.forEach((fn) => fn());
  }, []);
  return [value, set];
}
