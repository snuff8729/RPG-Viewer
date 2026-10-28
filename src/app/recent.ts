const DB = "rpg-viewer";
const STORE = "recent";
const KEY = "last";

/** 최근 게임: 브라우저 폴더 핸들, 또는 뷰어 서버로 연 실제 경로. */
export type RecentEntry =
  | { kind: "handle"; handle: FileSystemDirectoryHandle; name: string }
  | { kind: "server"; path: string; name: string };

interface StoredServer { kind: "server"; path: string; name: string }

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function put(value: unknown): Promise<void> {
  try {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(value, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch { /* 무시 */ }
}

export function saveRecent(h: FileSystemDirectoryHandle): Promise<void> {
  return put(h);
}

export function saveRecentServer(path: string, name: string): Promise<void> {
  const v: StoredServer = { kind: "server", path, name };
  return put(v);
}

/** 저장된 값을 최근 항목으로(핸들은 kind === "directory"). */
export function toRecentEntry(v: unknown): RecentEntry | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as { kind?: unknown; path?: unknown; name?: unknown };
  if (o.kind === "server" && typeof o.path === "string" && o.path !== "") {
    return { kind: "server", path: o.path, name: typeof o.name === "string" ? o.name : o.path };
  }
  if (o.kind === "directory") {
    const h = v as FileSystemDirectoryHandle;
    return { kind: "handle", handle: h, name: h.name };
  }
  return null;
}

export async function loadRecent(): Promise<RecentEntry | null> {
  try {
    const db = await open();
    const v = await new Promise<unknown>((resolve, reject) => {
      const req = db.transaction(STORE).objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return toRecentEntry(v);
  } catch { return null; }
}
