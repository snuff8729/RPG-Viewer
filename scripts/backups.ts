/**
 * 세이브 폴더 백업: 게임의 세이브 폴더(MV `www/save`, MZ `save`)를 통째로 복사해 둔다.
 * 공용 데이터(global.rpgsave·config.rpgsave)와 플러그인이 같은 폴더에 쓴 파일까지 함께 들어간다.
 *
 * 백업은 `<게임 루트>/rpg-viewer/backups/<id>/`에 `files/`(복사본)와 `meta.json`으로 둔다.
 * id는 시각으로 만들고 어디서든 BACKUP_ID_RE로 검사한다(경로 탈출 방지).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type BackupKind = "auto" | "manual" | "safety";

export interface BackupMeta {
  id: string;
  kind: BackupKind;
  reason: string;
  name?: string;
  createdAt: string;
  fileCount: number;
  bytes: number;
  hash: string;
}

export interface GameLocation {
  root: string;
  engine: "MV" | "MZ";
}

export type BackupResult<T> = ({ ok: true } & T) | { ok: false; error: string };

export const BACKUP_ROUTES = ["backups/list", "backups/create", "backups/restore", "backups/delete", "backups/state"] as const;
export type BackupRoute = (typeof BACKUP_ROUTES)[number];

/** `20261028-153012-045` 또는 같은 밀리초에 겹치면 `-1`, `-2` … */
export const BACKUP_ID_RE = /^\d{8}-\d{6}-\d{3}(?:-\d{1,3})?$/;

export const KEEP_AUTO = 30;
export const KEEP_SAFETY = 10;
export const SAFETY_REASON = "복원 전";
const MAX_TEXT = 200;

export const ERR_BAD_ID = "백업 이름이 올바르지 않아요";
export const ERR_NO_BACKUP = "백업을 찾을 수 없어요";
export const ERR_BAD_KIND = "백업 종류가 올바르지 않아요";

export function saveDirOf(game: GameLocation): string {
  return game.engine === "MV" ? path.join(game.root, "www", "save") : path.join(game.root, "save");
}

export function backupsDirOf(root: string): string {
  return path.join(root, "rpg-viewer", "backups");
}

export function isValidBackupId(id: unknown): id is string {
  return typeof id === "string" && BACKUP_ID_RE.test(id);
}

interface FileEntry { rel: string; abs: string; size: number; mtimeMs: number }

/** 폴더 안의 모든 파일(하위 폴더 포함, 링크 제외). 폴더가 없으면 빈 목록. 상대 경로는 `/`로 잇고 정렬한다. */
export function listFiles(dir: string): FileEntry[] {
  const out: FileEntry[] = [];
  const walk = (abs: string, rel: string) => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const a = path.join(abs, e.name);
      const r = rel === "" ? e.name : `${rel}/${e.name}`;
      if (e.isDirectory()) walk(a, r);
      else if (e.isFile()) {
        const st = fs.statSync(a);
        out.push({ rel: r, abs: a, size: st.size, mtimeMs: st.mtimeMs });
      }
    }
  };
  walk(dir, "");
  return out.sort((x, y) => (x.rel < y.rel ? -1 : x.rel > y.rel ? 1 : 0));
}

/** 바뀜 감지용 가벼운 서명: 이름·크기·수정 시각. */
export function saveSignature(game: GameLocation): string {
  const files = listFiles(saveDirOf(game));
  const h = crypto.createHash("sha1");
  for (const f of files) h.update(`${f.rel}\0${f.size}\0${Math.round(f.mtimeMs)}\n`);
  return `${files.length}:${h.digest("hex")}`;
}

/** 폴더 내용 해시: 상대 경로와 파일 내용. */
export function hashDir(dir: string): string {
  const h = crypto.createHash("sha256");
  for (const f of listFiles(dir)) {
    h.update(f.rel);
    h.update("\0");
    h.update(crypto.createHash("sha256").update(fs.readFileSync(f.abs)).digest());
  }
  return h.digest("hex");
}

/** 폴더를 통째로 복사한다(빈 하위 폴더 포함, 수정 시각 유지). 원본이 없으면 빈 폴더를 만든다. */
export function copyTree(src: string, dst: string): void {
  fs.mkdirSync(dst, { recursive: true });
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(src, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) copyTree(s, d);
    else if (e.isFile()) {
      fs.copyFileSync(s, d);
      const st = fs.statSync(s);
      fs.utimesSync(d, st.atime, st.mtime);
    }
  }
}

function readMeta(dir: string, id: string): BackupMeta | null {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(dir, "meta.json"), "utf8")) as Partial<BackupMeta>;
    if (m.id !== id || (m.kind !== "auto" && m.kind !== "manual" && m.kind !== "safety")) return null;
    if (typeof m.createdAt !== "string" || typeof m.hash !== "string") return null;
    if (!fs.statSync(path.join(dir, "files")).isDirectory()) return null;
    return {
      id, kind: m.kind, reason: typeof m.reason === "string" ? m.reason : "",
      ...(typeof m.name === "string" && m.name !== "" ? { name: m.name } : {}),
      createdAt: m.createdAt, fileCount: Number(m.fileCount) || 0, bytes: Number(m.bytes) || 0, hash: m.hash,
    };
  } catch {
    return null;
  }
}

/** 백업 목록, 새것부터. 망가진 항목은 건너뛴다. */
export function listBackups(root: string): BackupMeta[] {
  const base = backupsDirOf(root);
  let names: string[];
  try { names = fs.readdirSync(base); } catch { return []; }
  const out: BackupMeta[] = [];
  for (const id of names) {
    if (!isValidBackupId(id)) continue;
    const m = readMeta(path.join(base, id), id);
    if (m) out.push(m);
  }
  return out.sort((a, b) => (a.createdAt !== b.createdAt ? (a.createdAt < b.createdAt ? 1 : -1) : a.id < b.id ? 1 : -1));
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

export function backupIdFor(now: Date): string {
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-`
    + `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}-${pad(now.getMilliseconds(), 3)}`;
}

function freshId(base: string, now: Date): string {
  const first = backupIdFor(now);
  if (!fs.existsSync(path.join(base, first))) return first;
  for (let i = 1; i < 1000; i++) {
    const id = `${first}-${i}`;
    if (!fs.existsSync(path.join(base, id))) return id;
  }
  throw new Error("too many backups at once");
}

/** 오래된 자동·안전 백업 정리. 수동 백업은 지우지 않는다. */
export function pruneBackups(root: string, keep: readonly string[] = []): string[] {
  const removed: string[] = [];
  const counts: Record<BackupKind, number> = { auto: 0, safety: 0, manual: 0 };
  for (const m of listBackups(root)) {
    counts[m.kind]++;
    const limit = m.kind === "auto" ? KEEP_AUTO : m.kind === "safety" ? KEEP_SAFETY : Infinity;
    if (counts[m.kind] > limit && !keep.includes(m.id)) {
      fs.rmSync(path.join(backupsDirOf(root), m.id), { recursive: true, force: true });
      removed.push(m.id);
    }
  }
  return removed;
}

function cleanText(v: unknown): string {
  return typeof v === "string" ? v.trim().slice(0, MAX_TEXT) : "";
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export interface CreateOptions {
  kind: BackupKind;
  reason?: string;
  name?: string;
  now?: Date;
  /** 정리할 때 지우지 않을 백업 */
  keep?: readonly string[];
}

export function createBackup(game: GameLocation, opts: CreateOptions): BackupResult<{ skipped?: true; backup?: BackupMeta }> {
  try {
    const saveDir = saveDirOf(game);
    const hash = hashDir(saveDir);
    if (opts.kind === "auto") {
      const newest = listBackups(game.root)[0];
      if (newest && newest.hash === hash) return { ok: true, skipped: true };
    }
    const base = backupsDirOf(game.root);
    fs.mkdirSync(base, { recursive: true });
    const now = opts.now ?? new Date();
    const id = freshId(base, now);
    const tmp = path.join(base, `.tmp-${id}`);
    fs.rmSync(tmp, { recursive: true, force: true });
    try {
      copyTree(saveDir, path.join(tmp, "files"));
      const files = listFiles(path.join(tmp, "files"));
      const name = cleanText(opts.name);
      const meta: BackupMeta = {
        id, kind: opts.kind, reason: cleanText(opts.reason),
        ...(name !== "" ? { name } : {}),
        createdAt: now.toISOString(),
        fileCount: files.length,
        bytes: files.reduce((s, f) => s + f.size, 0),
        hash,
      };
      fs.writeFileSync(path.join(tmp, "meta.json"), JSON.stringify(meta, null, 2));
      fs.renameSync(tmp, path.join(base, id));
      pruneBackups(game.root, [id, ...(opts.keep ?? [])]);
      return { ok: true, backup: meta };
    } catch (e) {
      fs.rmSync(tmp, { recursive: true, force: true });
      throw e;
    }
  } catch (e) {
    return { ok: false, error: `백업하지 못했어요: ${errText(e)}` };
  }
}

export function deleteBackup(game: GameLocation, id: unknown): BackupResult<object> {
  if (!isValidBackupId(id)) return { ok: false, error: ERR_BAD_ID };
  const dir = path.join(backupsDirOf(game.root), id);
  if (!fs.existsSync(dir)) return { ok: false, error: ERR_NO_BACKUP };
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `지우지 못했어요: ${errText(e)}` };
  }
}

/**
 * 백업으로 되돌린다. 먼저 지금 세이브 폴더를 `복원 전` 백업으로 남기고,
 * 세이브 폴더를 백업과 똑같이 만든다(백업에 없는 파일은 사라진다).
 * 새 폴더를 옆에 만든 뒤 이름을 바꿔 끼우고, 실패하면 원래 폴더를 되살린다.
 */
export function restoreBackup(game: GameLocation, id: unknown): BackupResult<{ safety?: BackupMeta }> {
  if (!isValidBackupId(id)) return { ok: false, error: ERR_BAD_ID };
  const src = path.join(backupsDirOf(game.root), id);
  if (!readMeta(src, id)) return { ok: false, error: ERR_NO_BACKUP };

  const safety = createBackup(game, { kind: "safety", reason: SAFETY_REASON, keep: [id] });
  if (!safety.ok) return { ok: false, error: `복원 전 백업을 만들지 못해 복원하지 않았어요: ${safety.error}` };

  const saveDir = saveDirOf(game);
  const parent = path.dirname(saveDir);
  const stamp = `${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
  const tmpNew = path.join(parent, `.rpgv-restore-new-${stamp}`);
  const tmpOld = path.join(parent, `.rpgv-restore-old-${stamp}`);
  let movedOld = false;
  try {
    fs.mkdirSync(parent, { recursive: true });
    copyTree(path.join(src, "files"), tmpNew);
    if (fs.existsSync(saveDir)) {
      fs.renameSync(saveDir, tmpOld);
      movedOld = true;
    }
    fs.renameSync(tmpNew, saveDir);
  } catch (e) {
    try {
      if (movedOld && !fs.existsSync(saveDir)) fs.renameSync(tmpOld, saveDir);
    } catch { /* 아래 문구로 알린다 */ }
    fs.rmSync(tmpNew, { recursive: true, force: true });
    const lost = movedOld && !fs.existsSync(saveDir);
    return {
      ok: false,
      error: lost
        ? `복원하지 못했어요(원래 세이브는 ${tmpOld}에 있어요): ${errText(e)}`
        : `복원하지 못했어요(세이브는 그대로예요): ${errText(e)}`,
    };
  }
  if (movedOld) {
    try { fs.rmSync(tmpOld, { recursive: true, force: true }); } catch { /* 남은 임시 폴더는 무해하다 */ }
  }
  return { ok: true, ...(safety.backup ? { safety: safety.backup } : {}) };
}

const KINDS: readonly BackupKind[] = ["auto", "manual", "safety"];

/** /api/game/backups/* 처리. 던지지 않는다. */
export function handleBackupRoute(route: string, game: GameLocation, input: Record<string, unknown>): unknown {
  try {
    switch (route as BackupRoute) {
      case "backups/list": return { ok: true, backups: listBackups(game.root) };
      case "backups/state": return { ok: true, signature: saveSignature(game) };
      case "backups/create": {
        const kind = input.kind as BackupKind;
        if (!KINDS.includes(kind)) return { ok: false, error: ERR_BAD_KIND };
        return createBackup(game, { kind, reason: cleanText(input.reason), name: cleanText(input.name) });
      }
      case "backups/restore": return restoreBackup(game, input.id);
      case "backups/delete": return deleteBackup(game, input.id);
      default: return { ok: false, error: "not found" };
    }
  } catch (e) {
    return { ok: false, error: `처리하지 못했어요: ${errText(e)}` };
  }
}
