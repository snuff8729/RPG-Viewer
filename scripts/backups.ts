/**
 * 세이브 폴더 백업: 게임의 세이브 폴더를 통째로 복사해 둔다.
 * 세이브 폴더는 resolveSaveDir로 찾는다(기본 MV `www/save`, MZ `save`, 세이브 위치를 옮기는 플러그인도 따른다).
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
  /** 게임 루트 기준 세이브 폴더(`/`로 이음). 예전 백업에는 없다. */
  saveDir?: string;
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
export const ERR_BAD_SAVE_DIR = "백업의 세이브 폴더 위치가 올바르지 않아요";

/** 엔진 기본 세이브 폴더(게임 루트 기준). */
export function defaultSaveRel(engine: GameLocation["engine"]): string {
  return engine === "MV" ? "www/save" : "save";
}

const SAVE_FILE_RE = /\.(rpgsave|rmmzsave)$/i;
const SAVE_PARAM_RE = /save.*(path|dir|folder)|RelatedName/i;

interface PluginEntry { name: string; status: boolean; parameters: Record<string, unknown> }

/** `js/plugins.js`(MV는 `www/js/plugins.js`)의 `$plugins` 목록. 읽지 못하면 빈 목록. */
export function readPlugins(root: string, engine: GameLocation["engine"]): PluginEntry[] {
  const file = path.join(root, ...(engine === "MV" ? ["www", "js", "plugins.js"] : ["js", "plugins.js"]));
  let text: string;
  try { text = fs.readFileSync(file, "utf8"); } catch { return []; }
  const at = text.indexOf("$plugins");
  const start = at < 0 ? -1 : text.indexOf("[", at);
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  try {
    const list = JSON.parse(text.slice(start, end + 1)) as unknown;
    if (!Array.isArray(list)) return [];
    return list.flatMap((p: unknown): PluginEntry[] => {
      if (!p || typeof p !== "object") return [];
      const o = p as Record<string, unknown>;
      if (typeof o.name !== "string") return [];
      const params = o.parameters && typeof o.parameters === "object" ? (o.parameters as Record<string, unknown>) : {};
      return [{ name: o.name, status: o.status === true, parameters: params }];
    });
  } catch {
    return [];
  }
}

/**
 * `base` 기준 `rel`을 게임 루트 기준 상대 경로(`/`로 이음)로 바꾼다.
 * 절대 경로, 루트 밖(`..`), 루트·MV `www` 자체, 뷰어 폴더(`rpg-viewer`)는 거부(null).
 */
export function safeSaveRel(root: string, base: string, rel: string): string | null {
  const t = rel.trim();
  if (t === "" || path.isAbsolute(t) || /^[\\/]/.test(t) || /^[a-z]:/i.test(t)) return null;
  const r = path.relative(path.resolve(root), path.resolve(base, t));
  if (r === "" || path.isAbsolute(r)) return null;
  const parts = r.split(/[\\/]+/);
  if (parts.some((x) => x === "..")) return null;
  const lower = parts.map((x) => x.toLowerCase());
  if (lower.length === 1 && lower[0] === "www") return null;
  if (lower[0] === "rpg-viewer") return null;
  return parts.join("/");
}

function absOf(root: string, rel: string): string {
  return path.join(root, ...rel.split("/"));
}

/** 폴더 바로 아래에 세이브 파일(*.rpgsave, *.rmmzsave)이 있는지. */
export function hasSaveFiles(dir: string): boolean {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).some((e) => e.isFile() && SAVE_FILE_RE.test(e.name));
  } catch {
    return false;
  }
}

/**
 * 켜진 플러그인이 정한 세이브 폴더 후보(게임 루트 기준).
 * `primary`는 SavePathRelocation이 정한 것(확실), `guessed`는 이름이 세이브 경로처럼 보이는 매개변수(세이브 파일이 있을 때만 씀).
 */
export function pluginSaveRels(root: string, engine: GameLocation["engine"]): { primary: string[]; guessed: string[] } {
  const primary: string[] = [];
  const guessed: string[] = [];
  // SavePathRelocation 설명대로 배포된 Game.exe에서도 BaseAt www는 www 폴더 기준이다. MZ는 www가 곧 게임 폴더.
  const wwwBase = engine === "MV" ? path.join(root, "www") : root;
  const push = (list: string[], v: string | null) => { if (v !== null && !list.includes(v)) list.push(v); };
  for (const p of readPlugins(root, engine)) {
    if (!p.status) continue;
    if (p.name === "SavePathRelocation") {
      const baseAt = String(p.parameters.BaseAt ?? "exe").trim().toLowerCase();
      const relRaw = p.parameters.RelatedName;
      const rel = typeof relRaw === "string" && relRaw.trim() !== "" ? relRaw : "save";
      push(primary, safeSaveRel(root, baseAt === "www" ? wwwBase : root, rel));
      continue;
    }
    for (const [k, v] of Object.entries(p.parameters)) {
      if (!SAVE_PARAM_RE.test(k) || typeof v !== "string") continue;
      push(guessed, safeSaveRel(root, root, v));
      if (engine === "MV") push(guessed, safeSaveRel(root, wwwBase, v));
    }
  }
  return { primary, guessed };
}

export interface SaveDirInfo {
  /** 게임 루트 기준(`/`로 이음) */
  rel: string;
  abs: string;
  /** 세이브 파일(*.rpgsave, *.rmmzsave)이 있는지 */
  hasSaves: boolean;
}

/**
 * 세이브 폴더 찾기. 후보: 플러그인이 정한 폴더 → `save` → `www/save`.
 * 세이브 파일이 있는 첫 후보를 쓰고, 어디에도 없으면 SavePathRelocation 폴더나 엔진 기본 폴더(복원 때 만든다).
 */
export function resolveSaveDir(root: string, engine: GameLocation["engine"]): SaveDirInfo {
  const { primary, guessed } = pluginSaveRels(root, engine);
  const candidates: string[] = [];
  for (const r of [...primary, ...guessed, "save", "www/save"]) if (!candidates.includes(r)) candidates.push(r);
  for (const rel of candidates) {
    const abs = absOf(root, rel);
    if (hasSaveFiles(abs)) return { rel, abs, hasSaves: true };
  }
  const rel = primary[0] ?? defaultSaveRel(engine);
  return { rel, abs: absOf(root, rel), hasSaves: false };
}

export function saveDirOf(game: GameLocation): string {
  return resolveSaveDir(game.root, game.engine).abs;
}

/** 세이브 파일이 어디에도 없는 NW.js 게임(세이브가 파일이 아닌 localStorage에 있을 수 있음)이면 참. */
export function saveFilesMissing(game: GameLocation, info: SaveDirInfo = resolveSaveDir(game.root, game.engine)): boolean {
  if (info.hasSaves) return false;
  return fs.existsSync(path.join(game.root, "package.json")) || fs.existsSync(path.join(game.root, "www", "package.json"));
}

/** 백업을 되돌릴 세이브 폴더. 기록이 없는 예전 백업은 그때 쓰던 엔진 기본 폴더. 잘못된 값이면 null. */
export function backupSaveRel(game: GameLocation, meta: Pick<BackupMeta, "saveDir">): string | null {
  if (meta.saveDir === undefined) return defaultSaveRel(game.engine);
  return safeSaveRel(game.root, game.root, meta.saveDir) === meta.saveDir ? meta.saveDir : null;
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
      ...(typeof m.saveDir === "string" ? { saveDir: m.saveDir } : {}),
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
  /** 이 세이브 폴더(게임 루트 기준)를 백업한다. 없으면 resolveSaveDir로 찾는다. */
  saveRel?: string;
}

export function createBackup(game: GameLocation, opts: CreateOptions): BackupResult<{ skipped?: true; backup?: BackupMeta }> {
  try {
    const info: SaveDirInfo = opts.saveRel !== undefined
      ? { rel: opts.saveRel, abs: absOf(game.root, opts.saveRel), hasSaves: hasSaveFiles(absOf(game.root, opts.saveRel)) }
      : resolveSaveDir(game.root, game.engine);
    const saveDir = info.abs;
    const hash = hashDir(saveDir);
    if (opts.kind === "auto") {
      // 세이브할 것이 하나도 없으면 빈 폴더를 몰래 백업하지 않는다(창에서 따로 알린다).
      if (!info.hasSaves && listFiles(saveDir).length === 0) return { ok: true, skipped: true };
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
        saveDir: info.rel,
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
  const meta = readMeta(src, id);
  if (!meta) return { ok: false, error: ERR_NO_BACKUP };
  // 백업한 바로 그 폴더로 되돌린다.
  const saveRel = backupSaveRel(game, meta);
  if (saveRel === null) return { ok: false, error: ERR_BAD_SAVE_DIR };

  const safety = createBackup(game, { kind: "safety", reason: SAFETY_REASON, keep: [id], saveRel });
  if (!safety.ok) return { ok: false, error: `복원 전 백업을 만들지 못해 복원하지 않았어요: ${safety.error}` };

  const saveDir = absOf(game.root, saveRel);
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
      case "backups/list": {
        const info = resolveSaveDir(game.root, game.engine);
        return { ok: true, backups: listBackups(game.root), saveDir: info.rel, saveFilesMissing: saveFilesMissing(game, info) };
      }
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
