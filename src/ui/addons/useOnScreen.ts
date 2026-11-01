import { useEffect, useState, useSyncExternalStore } from "react";
import { onScreenNow } from "./playback";

function subscribePage(fn: () => void): () => void {
  if (typeof document === "undefined") return () => {};
  document.addEventListener("visibilitychange", fn);
  return () => document.removeEventListener("visibilitychange", fn);
}
const pageVisible = () => typeof document === "undefined" || document.visibilityState !== "hidden";

/**
 * 지금 화면에 실제로 보이는가(그림 움직임 재생용). 돌려준 ref를 요소에 붙인다.
 * IntersectionObserver의 root를 비워 두면(기본) 요소를 감싼 모든 스크롤 칸(읽기·모든 기록·찾아보기 등)으로 잘라 본 뒤
 * 창 안에 남는지를 본다 — 칸 밖으로 스크롤됐거나, 칸 자체가 창 밖이거나, 숨긴 탭(display:none) 안이면 보이지 않음.
 * (여유 거리 rootMargin을 쓰지 않으므로 root를 스크롤 칸으로 정할 필요가 없다.) 창(브라우저 탭)이 숨겨지거나 최소화돼도 보이지 않음.
 */
export function useOnScreen<T extends Element>(): [(el: T | null) => void, boolean] {
  const [el, setEl] = useState<T | null>(null);
  const [intersecting, setIntersecting] = useState(typeof IntersectionObserver === "undefined");
  useEffect(() => {
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => setIntersecting(entries[entries.length - 1].isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, [el]);
  const visible = useSyncExternalStore(subscribePage, pageVisible, () => true);
  return [setEl, onScreenNow(intersecting, visible)];
}
