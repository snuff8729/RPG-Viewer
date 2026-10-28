/**
 * 최근·고정 게임 저장. 목록은 localStorage(`rpgv.recentGames`), 브라우저 폴더 핸들은 IndexedDB(항목 key로).
 * 예전 버전이 IndexedDB `last`에 남긴 한 개는 처음 읽을 때 목록으로 옮긴다.
 */
import { useEffect, useState } from "react";
import {
  parseRecent, pruneRecent, recentKey, removeRecent, setPinned, touchRecent, type RecentInput, type RecentItem,
} from "./recentList";

const DB = "rpg-viewer";
const STORE = "recent";
const LEGACY_KEY = "last";
export const RECENT_STORAGE_KEY = "rpgv.recentGames";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idb<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest | null): Promise<T | null> {
  try {
    const db = await openDb();
    try {
      return await new Promise<T | null>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(req ? (req.result as T) : null);
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

const putHandle = (key: string, h: FileSystemDirectoryHandle) => idb<unknown>("readwrite", (s) => s.put(h, key));
const deleteHandle = (key: string) => idb<unknown>("readwrite", (s) => s.delete(key));

/** 브라우저로 연 최근 게임의 폴더 핸들. */
export async function loadHandle(key: string): Promise<FileSystemDirectoryHandle | null> {
  const v = await idb<unknown>("readonly", (s) => s.get(key));
  return v && typeof v === "object" && (v as { kind?: unknown }).kind === "directory" ? (v as FileSystemDirectoryHandle) : null;
}

function readList(): RecentItem[] {
  try { return parseRecent(localStorage.getItem(RECENT_STORAGE_KEY)); } catch { return []; }
}

const listeners = new Set<() => void>();

function writeList(list: RecentItem[]): void {
  try { localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(list)); } catch { /* 이번 세션만 */ }
  for (const cb of [...listeners]) cb();
}

/** 목록을 바꾸고 넘친 항목의 핸들을 지운다. */
function update(fn: (list: RecentItem[]) => RecentItem[]): RecentItem[] {
  const before = readList();
  const { kept } = pruneRecent(fn(before));
  writeList(kept);
  const keep = new Set(kept.map((it) => it.key));
  for (const it of before) if (it.kind === "handle" && !keep.has(it.key)) void deleteHandle(it.key);
  return kept;
}

let migrated: Promise<void> | null = null;

/** 예전 `last` 한 개를 목록으로 옮긴다(한 번). */
function migrateLegacy(): Promise<void> {
  migrated ??= (async () => {
    const v = await idb<unknown>("readonly", (s) => s.get(LEGACY_KEY));
    if (!v || typeof v !== "object") return;
    const o = v as { kind?: unknown; path?: unknown; name?: unknown };
    if (readList().length === 0) {
      if (o.kind === "directory") {
        const h = v as FileSystemDirectoryHandle;
        const input: RecentInput = { kind: "handle", name: h.name, title: "", gameKey: "" };
        await putHandle(recentKey(input), h);
        update((l) => touchRecent(l, input, 0));
      } else if (o.kind === "server" && typeof o.path === "string") {
        const name = typeof o.name === "string" ? o.name : o.path;
        update((l) => touchRecent(l, { kind: "server", path: o.path as string, name, title: "", gameKey: "" }, 0));
      }
    }
    await deleteHandle(LEGACY_KEY);
  })();
  return migrated;
}

/** 연 게임을 기억한다. 브라우저로 연 게임은 핸들도 저장. 항목 key를 돌려준다. */
export async function rememberGame(input: RecentInput, handle?: FileSystemDirectoryHandle): Promise<string> {
  await migrateLegacy();
  const key = recentKey(input);
  if (input.kind === "handle" && handle) await putHandle(key, handle);
  update((l) => touchRecent(l, input, Date.now()));
  return key;
}

export function forgetGame(key: string): void {
  update((l) => removeRecent(l, key));
  void deleteHandle(key);
}

export function pinGame(key: string, pinned: boolean): void {
  update((l) => setPinned(l, key, pinned));
}

/** 최근·고정 게임 목록(바뀌면 따라간다). */
export function useRecentGames(): RecentItem[] {
  const [list, setList] = useState<RecentItem[]>(readList);
  useEffect(() => {
    const cb = () => setList(readList());
    listeners.add(cb);
    void migrateLegacy().then(cb);
    return () => { listeners.delete(cb); };
  }, []);
  return list;
}
