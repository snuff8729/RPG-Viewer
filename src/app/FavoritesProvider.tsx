import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useGame } from "./GameProvider";
import { isWritableFolder, type WritableGameFolder } from "@/core/fs/folder";
import { livePaths } from "@/core/live/installer";
import { favoritesStorageKey, findFavorite, parseFavorites, type FavoriteKind, type Favorites } from "@/core/live/favorites";
import {
  applyFavoritesOps, compactFavoritesOps, favoritesNeedWrite, favoritesPendingKey, isAssistFavoriteId, mergeFavorites, nextFavoritesT,
  parseFavoritesFile, parseFavoritesOps, readFavoritesText, resolveFavorites, serializeFavoritesFile,
  type AssistFavoriteId, type FavoritesFile, type FavoritesOp,
} from "@/core/live/favoritesFile";
import { gameKeyOf } from "@/ui/live/readPosition";

/**
 * 보조·치트 즐겨찾기(게임 폴더의 rpg-viewer/favorites.json). PC·따로 띄운 창·휴대폰 보기가 같은 파일을 쓴다.
 * - 바꿀 때마다 바꿈(FavoritesOp)을 localStorage에 적고, 파일을 먼저 읽어 그 위에 바꿈만 얹어 쓴다(쓰기는 한 줄로).
 * - 다른 뷰어가 바꾼 것은 POLL_MS마다 파일을 다시 읽어 반영한다.
 * - 쓰기 권한이 아직 없거나(PC 폴더 권한) 쓸 수 있는 폴더가 아니면 바꿈은 localStorage에 남고, 권한이 생기면 파일로 옮긴다.
 * - 파일에 치트 칸이 없으면 예전 localStorage 치트 즐겨찾기(rpgv.cheatFavorites.<gameKey>)를 가져와 첫 파일을 만든다.
 */
export interface FavoritesValue {
  /** 맨 위 줄에 올린 보조 기능(순서대로). 파일에 없으면 기본 즐겨찾기. 전투 기능은 battleOnly()로 거른다. */
  assistFavorites: AssistFavoriteId[];
  isAssistFavorite(id: AssistFavoriteId): boolean;
  /** 클릭 핸들러 안에서 호출할 것(쓰기 권한 요청) */
  toggleAssistFavorite(id: AssistFavoriteId): void;
  /** 순서 바꾸기 등 목록 통째로 */
  setAssistFavorites(ids: AssistFavoriteId[]): void;
  /** 치트 스위치·변수 즐겨찾기 */
  cheatFavorites: Favorites;
  /** 바뀌었으면 true(번호가 잘못됐거나 이미 최대 개수면 false). 클릭 핸들러 안에서 호출할 것. */
  toggleCheatFavorite(kind: FavoriteKind, id: number): boolean;
  /** 별명 바꾸기(빈 글 = 지우기). 즐겨찾기가 아니면 넣으면서 붙인다. 바뀌었으면 true. */
  renameCheatFavorite(kind: FavoriteKind, id: number, nickname: string): boolean;
  /** 아직 파일에 쓰지 못한 바꿈이 있다(쓰기 권한 없음 등) */
  pending: boolean;
}

/** 다른 뷰어의 바꿈을 읽는 간격 */
const POLL_MS = 2500;

interface Session {
  gameKey: string;
  folder: WritableGameFolder | null;
  path: string | null;
  alive: boolean;
  disk: FavoritesFile | null;
  /** 마지막으로 읽은(또는 쓴) 파일 글. 한 번도 못 읽었으면 null */
  diskText: string | null;
  pending: FavoritesOp[];
  legacy: Favorites | null;
  chain: Promise<void>;
  queued: { perms: Promise<unknown>[] } | null;
}

interface View { gameKey: string | null; disk: FavoritesFile | null; pending: FavoritesOp[]; legacy: Favorites | null }

function loadLegacy(gameKey: string): Favorites | null {
  try {
    const raw = localStorage.getItem(favoritesStorageKey(gameKey));
    return raw === null ? null : parseFavorites(raw);
  } catch { return null; }
}
function loadPending(gameKey: string): FavoritesOp[] {
  try { return parseFavoritesOps(localStorage.getItem(favoritesPendingKey(gameKey))); } catch { return []; }
}
function savePending(gameKey: string, ops: readonly FavoritesOp[]): void {
  try {
    if (ops.length === 0) localStorage.removeItem(favoritesPendingKey(gameKey));
    else localStorage.setItem(favoritesPendingKey(gameKey), JSON.stringify(ops));
  } catch { /* 이번 세션만 */ }
}
const initialView = (gameKey: string | null): View =>
  ({ gameKey, disk: null, pending: gameKey ? loadPending(gameKey) : [], legacy: gameKey ? loadLegacy(gameKey) : null });

const FavoritesContext = createContext<FavoritesValue | null>(null);

export function FavoritesProvider({ children }: { children: ReactNode }) {
  const { status, data, folder } = useGame();
  const ready = status === "ready" && !!data && !!folder;
  const gameKey = ready && data ? gameKeyOf(data) : null;
  const wfolder: WritableGameFolder | null = ready && folder && isWritableFolder(folder) ? folder : null;
  const path = wfolder && data ? livePaths(data.dataRoot).favoritesFile : null;

  const [view, setView] = useState<View>(() => initialView(gameKey));
  const sess = useRef<Session | null>(null);
  // 게임이 바뀐 뒤 세션 효과가 돌기 전에도 그 게임 값(localStorage)을 보인다
  const fallback = useMemo(() => initialView(gameKey), [gameKey]);
  const shown = view.gameKey === gameKey ? view : fallback;

  const publish = useCallback((s: Session) => {
    if (s.alive) setView({ gameKey: s.gameKey, disk: s.disk, pending: s.pending, legacy: s.legacy });
  }, []);

  /** 읽고-고쳐-쓰기 한 번. 파일을 읽어 다른 뷰어의 값을 받아들이고, 써야 하면(바꿈·이전) 권한이 있을 때만 쓴다. */
  const sync = useCallback(async (s: Session, perms: Promise<unknown>[]) => {
    if (perms.length > 0) await Promise.all(perms);
    if (!s.alive || !s.folder || !s.path) return;
    // 없음과 읽기 실패(네트워크 등)를 나눈다: 실패면 쓰지 않고 다음 폴링에 다시 — 다른 뷰어가 만든 파일을 덮지 않게
    const read = await readFavoritesText(s.folder, s.path);
    if (!s.alive || read.state === "failed") return;
    const text = read.state === "ok" ? read.text : null;
    const disk = parseFavoritesFile(text);
    if (text !== s.diskText) { s.disk = disk; s.diskText = text; publish(s); }
    const n = s.pending.length;
    const ops = s.pending.slice(0, n);
    if (!favoritesNeedWrite(disk, ops, s.legacy)) {
      if (n > 0) { s.pending = s.pending.slice(n); savePending(s.gameKey, s.pending); publish(s); }
      return;
    }
    let can = false;
    try { can = await s.folder.canWrite(); } catch { can = false; }
    if (!can || !s.alive) return;
    const merged = mergeFavorites(disk, ops, s.legacy);
    const t = nextFavoritesT(disk, Date.now());
    const out = serializeFavoritesFile(merged, t);
    let ok = false;
    try { ok = await s.folder.writeText(s.path, out); } catch { ok = false; }
    if (!ok || !s.alive) return;
    s.disk = { ...merged, t };
    s.diskText = out;
    s.pending = s.pending.slice(n);
    savePending(s.gameKey, s.pending);
    publish(s);
  }, [publish]);

  /** sync를 사슬에 건다(한 번에 하나). 이미 기다리는 것이 있으면 거기에 합친다. */
  const schedule = useCallback((s: Session, perm: Promise<unknown> | null) => {
    if (s.queued) { if (perm) s.queued.perms.push(perm); return; }
    const q = { perms: perm ? [perm] : [] };
    s.queued = q;
    s.chain = s.chain.then(async () => {
      if (s.queued === q) s.queued = null;
      await sync(s, q.perms);
    }).catch(() => { /* 조용히 */ });
  }, [sync]);

  useEffect(() => {
    if (gameKey === null) { sess.current = null; return; }
    const s: Session = {
      gameKey, folder: wfolder, path, alive: true, disk: null, diskText: null,
      pending: loadPending(gameKey), legacy: loadLegacy(gameKey), chain: Promise.resolve(), queued: null,
    };
    sess.current = s;
    // 같은 게임을 다른 폴더로 다시 열었을 때 이전 폴더 값이 남지 않게 새 세션 값으로 바꾼다
    void Promise.resolve().then(() => publish(s));
    if (!wfolder || !path) return () => { s.alive = false; };
    schedule(s, null);
    const tick = () => { if (typeof document === "undefined" || !document.hidden) schedule(s, null); };
    const timer = setInterval(tick, POLL_MS);
    const onVisible = () => { if (!document.hidden) schedule(s, null); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      s.alive = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      if (sess.current === s) sess.current = null;
    };
  }, [gameKey, wfolder, path, publish, schedule]);

  const state = useMemo(() => applyFavoritesOps(resolveFavorites(shown.disk, shown.legacy), shown.pending), [shown]);

  /** 바꿈 하나를 적고(localStorage) 파일 쓰기를 건다. 클릭 핸들러 안이면 쓰기 권한을 요청한다. */
  const addOp = useCallback((op: FavoritesOp) => {
    const s = sess.current;
    if (!s || s.gameKey !== gameKey) return;
    const next = [...s.pending, op];
    s.pending = compactFavoritesOps(next, applyFavoritesOps(resolveFavorites(s.disk, s.legacy), next));
    savePending(s.gameKey, s.pending);
    publish(s);
    if (!s.folder || !s.path) return;
    schedule(s, s.folder.requestWrite().catch(() => false));
  }, [gameKey, publish, schedule]);

  const value = useMemo<FavoritesValue>(() => {
    const cheatChanged = (op: FavoritesOp) => {
      const after = applyFavoritesOps(state, [op]);
      if (after.cheat === state.cheat || JSON.stringify(after.cheat) === JSON.stringify(state.cheat)) return false;
      addOp(op);
      return true;
    };
    return {
      assistFavorites: state.assist,
      isAssistFavorite: (id) => state.assist.includes(id),
      toggleAssistFavorite: (id) => addOp({ op: "assist", id, on: !state.assist.includes(id) }),
      setAssistFavorites: (ids) => addOp({ op: "assistOrder", items: [...new Set(ids)].filter(isAssistFavoriteId) }),
      cheatFavorites: state.cheat,
      toggleCheatFavorite: (kind, id) => cheatChanged({ op: "cheat", kind, id, on: findFavorite(state.cheat, kind, id) === undefined }),
      renameCheatFavorite: (kind, id, nickname) => cheatChanged({ op: "nick", kind, id, nick: nickname }),
      pending: shown.pending.length > 0,
    };
  }, [state, shown.pending, addOp]);

  return <FavoritesContext.Provider value={value}>{children}</FavoritesContext.Provider>;
}

/** 보조·치트 즐겨찾기(게임 폴더별 favorites.json). */
// eslint-disable-next-line react-refresh/only-export-components
export function useFavorites(): FavoritesValue {
  const v = useContext(FavoritesContext);
  if (!v) throw new Error("useFavorites must be used within FavoritesProvider");
  return v;
}
