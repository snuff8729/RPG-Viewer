import { useSyncExternalStore } from "react";

/** data-node-path 속성값과 동일한 키 (예: [2,-1,0] → "2.-1.0") */
export function pathKey(path: number[]): string {
  return path.join(".");
}

/** 해당 페이지(data-page-key) 안의 노드만 고른다. 이전 페이지의 같은 경로 노드와 섞이지 않게 한다. */
export function nodeSelector(pageKey: string, path: number[]): string {
  return `[data-page-key="${pageKey}"] [data-node-path="${pathKey(path)}"]`;
}

/** 대상 노드를 보이게 하려면 열려 있어야 하는 분기 경로 키들 (길이 2 이상의 모든 접두) */
export function forcedOpenKeys(path: number[]): Set<string> {
  const keys = new Set<string>();
  for (let k = 2; k < path.length; k++) keys.add(pathKey(path.slice(0, k)));
  return keys;
}

// forceOpenPaths: 구독형 외부 저장소. 이동마다 nonce가 증가해 같은 분기도 다시 열린다.
export interface ForcedState { nonce: number; keys: Set<string> }
let forced: ForcedState = { nonce: 0, keys: new Set() };
const listeners = new Set<() => void>();
function setForced(next: ForcedState) {
  forced = next;
  listeners.forEach((l) => l());
}

/** 해당 분기가 강제로 열려야 하면 이동 nonce(>0), 아니면 0 */
export function forcedSignal(state: ForcedState, key: string): number {
  return state.keys.has(key) ? state.nonce : 0;
}

export function useForcedOpen(branchPath: number[]): number {
  const key = pathKey(branchPath);
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    () => forcedSignal(forced, key),
  );
}

const HIGHLIGHT = ["ring-2", "ring-primary"];
let clearTimer: ReturnType<typeof setTimeout> | undefined;
let lastEl: Element | null = null;
let token = 0;
let nonceCounter = 0;

/** pageKey는 locationKey(대상 위치). 그 페이지가 렌더된 뒤의 노드만 강조한다. */
export function highlightNode(pageKey: string, nodePath: number[]): void {
  const my = ++token;
  clearTimeout(clearTimer);
  if (lastEl) { lastEl.classList.remove(...HIGHLIGHT); lastEl = null; }
  setForced({ nonce: ++nonceCounter, keys: forcedOpenKeys(nodePath) });
  const release = () => {
    if (token === my) setForced({ nonce: forced.nonce, keys: new Set() });
  };
  const sel = nodeSelector(pageKey, nodePath);
  let tries = 0;
  const attempt = () => {
    if (token !== my) return;
    const el = document.querySelector(sel);
    if (!el) {
      if (++tries < 30) requestAnimationFrame(attempt);
      else release();
      return;
    }
    el.scrollIntoView({ block: "center" });
    el.classList.add(...HIGHLIGHT);
    lastEl = el;
    clearTimer = setTimeout(() => {
      el.classList.remove(...HIGHLIGHT);
      if (lastEl === el) lastEl = null;
      release();
    }, 2000);
  };
  requestAnimationFrame(attempt);
}
