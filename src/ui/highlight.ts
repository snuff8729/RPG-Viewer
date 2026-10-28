import { useSyncExternalStore } from "react";

/** data-node-path 속성값과 동일한 키 (예: [2,-1,0] → "2.-1.0") */
export function pathKey(path: number[]): string {
  return path.join(".");
}

export function nodeSelector(path: number[]): string {
  return `[data-node-path="${pathKey(path)}"]`;
}

/** 대상 노드를 보이게 하려면 열려 있어야 하는 분기 경로 키들 (길이 2 이상의 모든 접두) */
export function forcedOpenKeys(path: number[]): Set<string> {
  const keys = new Set<string>();
  for (let k = 2; k < path.length; k++) keys.add(pathKey(path.slice(0, k)));
  return keys;
}

// forceOpenPaths: 구독형 외부 저장소. Branch가 자기 경로를 구독한다.
let forced = new Set<string>();
const listeners = new Set<() => void>();
function setForced(next: Set<string>) {
  forced = next;
  listeners.forEach((l) => l());
}

export function useForcedOpen(branchPath: number[]): boolean {
  const key = pathKey(branchPath);
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    () => forced.has(key),
  );
}

const HIGHLIGHT = ["ring-2", "ring-primary"];
let clearTimer: ReturnType<typeof setTimeout> | undefined;
let lastEl: Element | null = null;

export function highlightNode(nodePath: number[]): void {
  setForced(forcedOpenKeys(nodePath));
  const sel = nodeSelector(nodePath);
  let tries = 0;
  const attempt = () => {
    const el = document.querySelector(sel);
    if (!el) {
      if (++tries < 30) requestAnimationFrame(attempt);
      return;
    }
    if (lastEl) lastEl.classList.remove(...HIGHLIGHT);
    clearTimeout(clearTimer);
    el.scrollIntoView({ block: "center" });
    el.classList.add(...HIGHLIGHT);
    lastEl = el;
    clearTimer = setTimeout(() => {
      el.classList.remove(...HIGHLIGHT);
      if (lastEl === el) lastEl = null;
    }, 2000);
  };
  requestAnimationFrame(attempt);
}
