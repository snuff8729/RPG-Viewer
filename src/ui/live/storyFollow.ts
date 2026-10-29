import { useCallback, useSyncExternalStore } from "react";

/** 게임별로 따라갈 서브 미션(keyText). 없으면 본편. 이번 세션에만 기억하고 설정 파일에 쓰지 않는다. */
const byGame = new Map<string, string>();
const listeners = new Set<() => void>();

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** [따라갈 서브 미션 keyText(null = 본편), 바꾸기]. 게임이 바뀌면 그 게임의 값을 쓴다. */
export function useStoryFollow(gameKey: string | null): [string | null, (t: string | null) => void] {
  const target = useSyncExternalStore(subscribe, () => (gameKey === null ? null : byGame.get(gameKey) ?? null));
  const set = useCallback((t: string | null) => {
    if (gameKey === null) return;
    if (t === null) byGame.delete(gameKey); else byGame.set(gameKey, t);
    listeners.forEach((fn) => fn());
  }, [gameKey]);
  return [target, set];
}
