import { useCallback, useSyncExternalStore } from "react";

/** 읽기의 `그림 움직임`(그림 바꾸기·이동을 움직여 보일지). 기본 켬, 브라우저에 기억한다. 화면 사이에 공유한다. */
const KEY = "rpgv.reader.pictureMotion";
const listeners = new Set<() => void>();
let on: boolean | null = null;

function load(): boolean {
  try { return localStorage.getItem(KEY) !== "0"; } catch { return true; }
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

const REDUCED = "(prefers-reduced-motion: reduce)";
function subscribeReduced(fn: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const m = window.matchMedia(REDUCED);
  m.addEventListener("change", fn);
  return () => m.removeEventListener("change", fn);
}
/** 기기 설정의 `동작 줄이기`가 켜졌는가(켜졌으면 저절로 움직이지 않고 재생 단추를 보인다) */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReduced, () => (typeof window !== "undefined" && !!window.matchMedia && window.matchMedia(REDUCED).matches), () => false);
}
