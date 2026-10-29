import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useGame } from "./GameProvider";
import { isWritableFolder, type WritableGameFolder } from "@/core/fs/folder";
import { livePaths } from "@/core/live/installer";
import { readFavoritesText } from "@/core/live/favoritesFile";
import {
  applyReaderOps, cleanBookmarkName, compactReaderOps, legacyHideRules, mergeReaderFile, nextReaderT, parseReaderFile, parseReaderOps,
  readerNeedsWrite, readerPendingKey, resolveReader, serializeReaderFile,
  type Bookmark, type HideRule, type HideRuleInput, type ReaderFile, type ReaderOp,
} from "@/core/live/readerFile";
import { gameKeyOf } from "@/ui/live/readPosition";
import { loadOverrides, loadShowAll } from "@/ui/live/pluginDisplay";
import { loadBattlesShown } from "@/ui/live/battleDisplay";
import { loadHiddenNoticeKinds, loadNoticesShown } from "@/ui/live/noticeDisplay";

/**
 * 읽기 화면의 북마크·숨김 규칙·챕터 변수(게임 폴더의 rpg-viewer/reader.json). PC·따로 띄운 창·휴대폰 보기가 같은 파일을 쓴다.
 * FavoritesProvider와 같은 방식: 바꿈(ReaderOp)을 localStorage에 적고, 파일을 먼저 읽어 그 위에 바꿈만 얹어 쓴다.
 * 읽기에 실패하면(없음과 구분) 쓰지 않는다. 다른 뷰어가 바꾼 것은 POLL_MS마다 다시 읽는다.
 * 파일에 숨김 규칙 칸이 없으면 예전 보기 설정(스위치)을 바꾼 규칙을 쓰고, 처음 파일을 쓸 때 함께 적는다.
 */
export interface ReaderFileValue {
  bookmarks: Bookmark[];
  hideRules: HideRule[];
  /** 고른 날짜·진행 변수(null = 자동, 플레이 시간) */
  chapterVar: number | null;
  addBookmark(b: { branch: number; seq: number; name: string }): void;
  removeBookmark(id: string): void;
  renameBookmark(id: string, name: string): void;
  addHideRule(rule: HideRuleInput): void;
  removeHideRule(id: string): void;
  setChapterVar(id: number | null): void;
  /** 아직 파일에 쓰지 못한 바꿈이 있다(쓰기 권한 없음 등) */
  pending: boolean;
}

const POLL_MS = 2500;

interface Session {
  gameKey: string;
  folder: WritableGameFolder | null;
  path: string | null;
  alive: boolean;
  disk: ReaderFile | null;
  diskText: string | null;
  pending: ReaderOp[];
  legacy: HideRule[];
  chain: Promise<void>;
  queued: { perms: Promise<unknown>[] } | null;
}

interface View { gameKey: string | null; disk: ReaderFile | null; pending: ReaderOp[]; legacy: HideRule[] }

/** 예전 읽기 보기 설정(브라우저에 기억한 스위치) → 숨김 규칙 */
function loadLegacy(gameKey: string): HideRule[] {
  try {
    const overrides = loadOverrides(gameKey);
    return legacyHideRules({
      showAllPlugins: loadShowAll(),
      battlesShown: loadBattlesShown(),
      noticesShown: loadNoticesShown(),
      hiddenNoticeKinds: [...loadHiddenNoticeKinds()],
      hiddenPlugins: Object.keys(overrides).filter((k) => overrides[k] === "hide"),
    });
  } catch { return legacyHideRules(null); }
}
function loadPending(gameKey: string): ReaderOp[] {
  try { return parseReaderOps(localStorage.getItem(readerPendingKey(gameKey))); } catch { return []; }
}
function savePending(gameKey: string, ops: readonly ReaderOp[]): void {
  try {
    if (ops.length === 0) localStorage.removeItem(readerPendingKey(gameKey));
    else localStorage.setItem(readerPendingKey(gameKey), JSON.stringify(ops));
  } catch { /* 이번 세션만 */ }
}
const initialView = (gameKey: string | null): View =>
  ({ gameKey, disk: null, pending: gameKey ? loadPending(gameKey) : [], legacy: gameKey ? loadLegacy(gameKey) : legacyHideRules(null) });

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const ReaderFileContext = createContext<ReaderFileValue | null>(null);

export function ReaderFileProvider({ children }: { children: ReactNode }) {
  const { status, data, folder } = useGame();
  const ready = status === "ready" && !!data && !!folder;
  const gameKey = ready && data ? gameKeyOf(data) : null;
  const wfolder: WritableGameFolder | null = ready && folder && isWritableFolder(folder) ? folder : null;
  const path = wfolder && data ? livePaths(data.dataRoot).readerFile : null;

  const [view, setView] = useState<View>(() => initialView(gameKey));
  const sess = useRef<Session | null>(null);
  const fallback = useMemo(() => initialView(gameKey), [gameKey]);
  const shown = view.gameKey === gameKey ? view : fallback;

  const publish = useCallback((s: Session) => {
    if (s.alive) setView({ gameKey: s.gameKey, disk: s.disk, pending: s.pending, legacy: s.legacy });
  }, []);

  /** 읽고-고쳐-쓰기 한 번 */
  const sync = useCallback(async (s: Session, perms: Promise<unknown>[]) => {
    if (perms.length > 0) await Promise.all(perms);
    if (!s.alive || !s.folder || !s.path) return;
    // 읽기 실패(네트워크 등)면 쓰지 않고 다음 폴링에 다시 — 다른 뷰어가 만든 파일을 덮지 않게
    const read = await readFavoritesText(s.folder, s.path);
    if (!s.alive || read.state === "failed") return;
    const text = read.state === "ok" ? read.text : null;
    // 깨진 파일(JSON 아님 등)은 덮지 않는다
    const disk = parseReaderFile(text);
    if (text !== null && disk === null) return;
    if (text !== s.diskText) { s.disk = disk; s.diskText = text; publish(s); }
    const n = s.pending.length;
    const ops = s.pending.slice(0, n);
    if (!readerNeedsWrite(disk, ops, s.legacy)) {
      if (n > 0) { s.pending = s.pending.slice(n); savePending(s.gameKey, s.pending); publish(s); }
      return;
    }
    let can = false;
    try { can = await s.folder.canWrite(); } catch { can = false; }
    if (!can || !s.alive) return;
    const merged = mergeReaderFile(disk, ops, s.legacy);
    const t = nextReaderT(disk, Date.now());
    const out = serializeReaderFile(merged, t);
    let ok = false;
    try { ok = await s.folder.writeText(s.path, out); } catch { ok = false; }
    if (!ok || !s.alive) return;
    s.disk = { ...merged, t };
    s.diskText = out;
    s.pending = s.pending.slice(n);
    savePending(s.gameKey, s.pending);
    publish(s);
  }, [publish]);

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

  const state = useMemo(() => applyReaderOps(resolveReader(shown.disk, shown.legacy), shown.pending), [shown]);

  /** 바꿈 하나를 적고(localStorage) 파일 쓰기를 건다. 클릭 핸들러 안이면 쓰기 권한을 요청한다. */
  const addOp = useCallback((op: ReaderOp) => {
    const s = sess.current;
    if (!s || s.gameKey !== gameKey) return;
    const next = [...s.pending, op];
    s.pending = compactReaderOps(next, applyReaderOps(resolveReader(s.disk, s.legacy), next));
    savePending(s.gameKey, s.pending);
    publish(s);
    if (!s.folder || !s.path) return;
    schedule(s, s.folder.requestWrite().catch(() => false));
  }, [gameKey, publish, schedule]);

  const value = useMemo<ReaderFileValue>(() => ({
    bookmarks: state.bookmarks,
    hideRules: state.hide,
    chapterVar: state.chapterVar,
    addBookmark: (b) => addOp({ op: "bookmark", bookmark: { id: newId(), branch: b.branch, seq: b.seq, name: cleanBookmarkName(b.name) || "북마크", t: Date.now() } }),
    removeBookmark: (id) => addOp({ op: "unbookmark", id }),
    renameBookmark: (id, name) => addOp({ op: "rename", id, name }),
    addHideRule: (rule) => addOp({ op: "hide", rule: { ...rule, id: newId(), t: Date.now() } as HideRule }),
    removeHideRule: (id) => addOp({ op: "unhide", id }),
    setChapterVar: (id) => addOp({ op: "chapterVar", id }),
    pending: shown.pending.length > 0,
  }), [state, shown.pending, addOp]);

  return <ReaderFileContext.Provider value={value}>{children}</ReaderFileContext.Provider>;
}

/** 읽기 화면의 북마크·숨김 규칙·챕터 변수(게임 폴더별 reader.json). */
// eslint-disable-next-line react-refresh/only-export-components
export function useReaderFile(): ReaderFileValue {
  const v = useContext(ReaderFileContext);
  if (!v) throw new Error("useReaderFile must be used within ReaderFileProvider");
  return v;
}
