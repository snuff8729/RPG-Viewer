// 갈래 정리 설정(이름·고정·숨기기) 저장: 게임 폴더의 rpg-viewer/branches.json(쓸 수 있을 때) + 게임별 localStorage.
// 읽을 땐 둘 중 더 최근(t) 것을 쓴다. 기록 파일(log.jsonl)은 건드리지 않는다. 예외를 던지지 않는다.
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useGame } from "@/app/GameProvider";
import { isWritableFolder, type GameFolder } from "@/core/fs/folder";
import { emptyPrefs, newerPrefs, parseBranchPrefs, serializeBranchPrefs, type BranchPrefs } from "@/core/live/branchTidy";
import { livePaths } from "@/core/live/installer";
import { gameKeyOf, type StoreLike } from "./readPosition";

export const prefsStoreKey = (gameKey: string): string => `rpgv.branches.${gameKey}`;
export const prefsFilePath = (dataRoot: string): string => `${livePaths(dataRoot).logDir}/branches.json`;

function defaultStore(): StoreLike | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

/** 폴더 파일과 localStorage 중 더 최근 설정. */
export async function loadBranchPrefs(
  folder: GameFolder | null | undefined, dataRoot: string, gameKey: string, store: StoreLike | null = defaultStore(),
): Promise<BranchPrefs> {
  let fromFile: BranchPrefs | null = null;
  try { fromFile = folder ? parseBranchPrefs(await folder.readText(prefsFilePath(dataRoot))) : null; } catch { fromFile = null; }
  let fromStore: BranchPrefs | null = null;
  try { fromStore = parseBranchPrefs(store?.getItem(prefsStoreKey(gameKey))); } catch { fromStore = null; }
  return newerPrefs(fromFile, fromStore);
}

/** localStorage에 쓰고, 폴더에 쓸 수 있으면 폴더에도 쓴다. 폴더에 썼는지 돌려준다. */
export async function saveBranchPrefs(
  prefs: BranchPrefs, folder: GameFolder | null | undefined, dataRoot: string, gameKey: string, store: StoreLike | null = defaultStore(),
): Promise<boolean> {
  const text = serializeBranchPrefs(prefs);
  try { store?.setItem(prefsStoreKey(gameKey), text); } catch { /* 저장소 사용 불가 */ }
  if (!folder || !isWritableFolder(folder)) return false;
  try {
    if (!(await folder.canWrite())) return false;
    return await folder.writeText(prefsFilePath(dataRoot), text);
  } catch { return false; }
}

// ── 화면 사이 공유 ─────────────────────────────────────────────
const listeners = new Set<() => void>();
const byGame = new Map<string, BranchPrefs>();
const loading = new Set<string>();
const EMPTY = emptyPrefs();
let writeChain: Promise<unknown> = Promise.resolve();

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
const notify = () => listeners.forEach(fn => fn());

/** 지금 게임의 갈래 정리 설정과 바꾸기(바꾼 즉시 화면에 반영, 저장은 뒤에서). */
export function useBranchPrefs(): [BranchPrefs, (update: (prev: BranchPrefs) => BranchPrefs) => void] {
  const { data, folder } = useGame();
  const gameKey = data ? gameKeyOf(data) : null;
  const dataRoot = data?.dataRoot ?? null;
  const prefs = useSyncExternalStore(subscribe, () => (gameKey === null ? EMPTY : byGame.get(gameKey) ?? EMPTY));

  useEffect(() => {
    if (gameKey === null || dataRoot === null || byGame.has(gameKey) || loading.has(gameKey)) return;
    loading.add(gameKey);
    void loadBranchPrefs(folder, dataRoot, gameKey).then(p => {
      loading.delete(gameKey);
      // 읽는 사이에 바꾼 설정이 있으면 그것이 더 최근이다
      const cur = byGame.get(gameKey);
      byGame.set(gameKey, cur ? newerPrefs(p, cur) : p);
      notify();
    });
  }, [gameKey, dataRoot, folder]);

  const update = useCallback((fn: (prev: BranchPrefs) => BranchPrefs) => {
    if (gameKey === null || dataRoot === null) return;
    const next = fn(byGame.get(gameKey) ?? EMPTY);
    byGame.set(gameKey, next);
    notify();
    writeChain = writeChain.then(() => saveBranchPrefs(next, folder, dataRoot, gameKey)).catch(() => false);
  }, [gameKey, dataRoot, folder]);

  return [prefs, update];
}
