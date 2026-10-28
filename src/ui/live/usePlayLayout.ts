import { useEffect, useState, type RefObject } from "react";
import { playLayout, type PlayLayout } from "./playLayout";

/** 요소 너비로 정한 플레이 화면 배치(컨테이너 쿼리). 처음엔 창 너비로 짐작한다. */
export function usePlayLayout(ref: RefObject<HTMLElement | null>): PlayLayout {
  const [width, setWidth] = useState(() => (typeof window === "undefined" ? 0 : window.innerWidth));
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return playLayout(width);
}
