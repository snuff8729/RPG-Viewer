/**
 * 게임 폴더를 뷰어 서버(같은 Node 프로세스)로 연다: 실제 경로를 알게 되므로 실행·백업이 같은 경로를 쓴다.
 *
 * - GET  /api/fs/ping → { ok, pick } (pick: 이 OS에서 기본 폴더 선택 창을 띄울 수 있는지)
 * - POST /api/fs/pick → 기본 폴더 선택 창 → { ok, id, root, title, engine, name } | { ok, cancelled } | { ok: false, error, pickerFailed? }
 * - POST /api/fs/open { path } → 같은 응답(최근 게임 다시 열기·테스트용)
 * - POST /api/fs/{read,range,list,stat,write,remove} { id, path, … } → 열린 게임 루트 안에서만
 *
 * 세션 id는 서버 메모리 안의 루트 경로를 가리키는 불투명 값이고, URL에는 아무것도 싣지 않는다.
 * 세션 목록(FsSessions)은 휴대폰 보기(scripts/lanShare.ts)와 함께 쓴다.
 * 휴대폰 보기로 들어온 요청은 공유한 게임 하나의 read·range·list·stat만 받는다.
 * 경로는 `/` 구분 상대 경로만 받고 `..`·절대 경로·드라이브·역슬래시를 거부하며,
 * 실제 경로(realpath)가 루트 밖이면(심볼릭 링크 탈출) 거부한다.
 */
import { execFile as nodeExecFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import type { Plugin } from "vite";
import { ERR_NOT_FOUND, findGameRoot, isAllowedRequest } from "./launcher.ts";
import { clientIp, isLoopbackIp } from "./netAddress.ts";

const MAX_BODY = 64 * 1024;
const MAX_WRITE_BODY = 32 * 1024 * 1024;
const MAX_SESSIONS = 32;

export const ERR_SESSION = "session";
export const ERR_BAD_PATH = "bad path";
export const ERR_PICK_BUSY = "이미 폴더 선택 창이 열려 있어요";
export const ERR_PICK_FAILED = "폴더 선택 창을 열지 못했어요";

// ── 경로 범위 ──

/** 상대 경로를 안전한 세그먼트로. 거부하면 null. */
export function safeSegments(rel: unknown): string[] | null {
  if (typeof rel !== "string" || rel.length > 2048) return null;
  if (/[\0\\:*?"<>|]/.test(rel)) return null;
  if (rel.startsWith("/")) return null;
  const segs = rel.split("/").filter((s) => s !== "" && s !== ".");
  for (const s of segs) {
    // `..`, `...`(Windows가 점을 떼어 내는 이름), 끝이 점·공백인 이름은 받지 않는다.
    if (/^\.+$/.test(s) || s.endsWith(".") || s.endsWith(" ")) return null;
  }
  return segs;
}

/** p가 root 안(같아도 됨)인지. 둘 다 정규화된 실제 경로여야 한다. */
export function isInside(root: string, p: string): boolean {
  const rel = path.relative(root, p);
  if (rel === "") return true;
  if (path.isAbsolute(rel)) return false;
  return rel.split(path.sep)[0] !== "..";
}

function realpath(p: string): string | null {
  try { return fs.realpathSync.native(p); } catch { return null; }
}

/** 디렉터리 안 이름을 대소문자·유니코드 정규화 무시로 찾는다(정확히 있으면 그것). */
function childName(dir: string, name: string): string | null {
  try {
    fs.lstatSync(path.join(dir, name));
    return name;
  } catch { /* 아래에서 대소문자 무시 */ }
  let names: string[];
  try { names = fs.readdirSync(dir); } catch { return null; }
  // 유니코드 정규화(NFC/NFD: macOS에서 만든 파일 등)도 맞춘다.
  const key = (s: string) => s.normalize("NFC").toLowerCase();
  const lw = key(name);
  return names.find((n) => key(n) === lw) ?? null;
}

export type Resolved =
  | { ok: true; full: string; exists: true }
  | { ok: true; full: string; exists: false; /** 있는 가장 깊은 상위 폴더 */ base: string; rest: string[] }
  | { ok: false };

/** 루트 기준 상대 경로를 실제 경로로. 있는 부분은 대소문자 무시로 맞추고, 루트 밖이면 거부. */
export function resolveInRoot(root: string, rel: unknown): Resolved {
  const segs = safeSegments(rel);
  if (segs === null) return { ok: false };
  let cur = root;
  for (let i = 0; i < segs.length; i++) {
    const name = childName(cur, segs[i]);
    if (name === null) {
      const real = realpath(cur);
      if (real === null || !isInside(root, real)) return { ok: false };
      return { ok: true, full: path.join(real, ...segs.slice(i)), exists: false, base: real, rest: segs.slice(i) };
    }
    cur = path.join(cur, name);
  }
  const real = realpath(cur);
  if (real === null || !isInside(root, real)) return { ok: false };
  return { ok: true, full: real, exists: true };
}

// ── 파일 작업(테스트에서 직접 부른다) ──

export function readFileIn(root: string, rel: unknown): Buffer | null | "bad" {
  const r = resolveInRoot(root, rel);
  if (!r.ok) return "bad";
  if (!r.exists) return null;
  try {
    if (!fs.statSync(r.full).isFile()) return null;
    return fs.readFileSync(r.full);
  } catch { return null; }
}

export function readRangeIn(root: string, rel: unknown, start: number, end: number): Buffer | null | "bad" {
  const r = resolveInRoot(root, rel);
  if (!r.ok) return "bad";
  if (!r.exists) return null;
  let fd: number | null = null;
  try {
    const st = fs.statSync(r.full);
    if (!st.isFile()) return null;
    const s = Math.max(0, Math.min(Math.floor(start), st.size));
    const e = Math.max(s, Math.min(Math.floor(end), st.size));
    const buf = Buffer.alloc(e - s);
    fd = fs.openSync(r.full, "r");
    let off = 0;
    while (off < buf.length) {
      const n = fs.readSync(fd, buf, off, buf.length - off, s + off);
      if (n === 0) break;
      off += n;
    }
    return buf.subarray(0, off);
  } catch {
    return null;
  } finally {
    if (fd !== null) try { fs.closeSync(fd); } catch { /* ignore */ }
  }
}

export function listIn(root: string, rel: unknown): string[] | "bad" {
  const r = resolveInRoot(root, rel);
  if (!r.ok) return "bad";
  if (!r.exists) return [];
  try { return fs.readdirSync(r.full); } catch { return []; }
}

export function statIn(root: string, rel: unknown): { size: number; lastModified: number } | null | "bad" {
  const r = resolveInRoot(root, rel);
  if (!r.ok) return "bad";
  if (!r.exists) return null;
  try {
    const st = fs.statSync(r.full);
    return st.isFile() ? { size: st.size, lastModified: Math.floor(st.mtimeMs) } : null;
  } catch { return null; }
}

export function writeTextIn(root: string, rel: unknown, text: string): boolean | "bad" {
  const r = resolveInRoot(root, rel);
  if (!r.ok) return "bad";
  if (safeSegments(rel)?.length === 0) return "bad";
  try {
    let target: string;
    if (r.exists) {
      if (!fs.statSync(r.full).isFile()) return false;
      target = r.full;
    } else {
      // 없는 상위 폴더를 하나씩 만들며, 만든 뒤에도 루트 안인지 확인한다.
      let dir = r.base;
      for (const seg of r.rest.slice(0, -1)) {
        dir = path.join(dir, seg);
        try { fs.mkdirSync(dir); } catch (e) { if ((e as { code?: string }).code !== "EEXIST") throw e; }
        const real = realpath(dir);
        if (real === null || !isInside(root, real)) return "bad";
      }
      target = path.join(dir, r.rest[r.rest.length - 1]);
    }
    const tmp = `${target}.rpgv-${process.pid}-${Date.now()}.tmp`;
    try {
      fs.writeFileSync(tmp, text, "utf8");
      fs.renameSync(tmp, target);
    } catch {
      try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ }
      fs.writeFileSync(target, text, "utf8");
    }
    return true;
  } catch {
    return false;
  }
}

export function removeIn(root: string, rel: unknown): boolean | "bad" {
  const r = resolveInRoot(root, rel);
  if (!r.ok) return "bad";
  if (!r.exists || r.full === root) return false;
  try {
    if (!fs.lstatSync(r.full).isFile()) return false;
    fs.rmSync(r.full);
    return true;
  } catch { return false; }
}

// ── 기본 폴더 선택 창(Windows) ──

export type PickResult = { path: string } | { cancelled: true } | { error: string };
export type PickFolder = () => Promise<PickResult>;
export type ExecFileFn = (
  file: string,
  args: string[],
  options: { windowsHide: true; encoding: "utf8"; maxBuffer: number },
) => Promise<{ stdout: string }>;

const PICK_MARK = "RPGV-PICK:";
const CANCEL_MARK = "RPGV-CANCEL";

/**
 * 고정된 PowerShell 스크립트. 사용자 입력은 하나도 들어가지 않는다.
 * 새 탐색기식 선택 창(IFileOpenDialog, 폴더 모드)을 맨 위 숨은 창 위에 띄우고,
 * 그게 안 되면 FolderBrowserDialog로 대신한다.
 */
export const PICKER_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$src = @'
using System;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Windows.Forms;
public static class RpgvFolderPicker {
  [ComImport, Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")] class FileOpenDialogCo {}
  [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IShellItem {
    void BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppv);
    void GetParent(out IShellItem ppsi);
    void GetDisplayName(uint sigdnName, out IntPtr ppszName);
    void GetAttributes(uint sfgaoMask, out uint psfgaoAttribs);
    void Compare(IShellItem psi, uint hint, out int piOrder);
  }
  [ComImport, Guid("d57c7288-d4ad-4768-be02-9d969532d960"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IFileOpenDialog {
    [PreserveSig] int Show(IntPtr hwndOwner);
    void SetFileTypes(uint cFileTypes, IntPtr rgFilterSpec);
    void SetFileTypeIndex(uint iFileType);
    void GetFileTypeIndex(out uint piFileType);
    void Advise(IntPtr pfde, out uint pdwCookie);
    void Unadvise(uint dwCookie);
    void SetOptions(uint fos);
    void GetOptions(out uint pfos);
    void SetDefaultFolder(IShellItem psi);
    void SetFolder(IShellItem psi);
    void GetFolder(out IShellItem ppsi);
    void GetCurrentSelection(out IShellItem ppsi);
    void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string pszName);
    void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string pszName);
    void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string pszTitle);
    void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string pszText);
    void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string pszLabel);
    void GetResult(out IShellItem ppsi);
  }
  static Form Owner() {
    Form f = new Form();
    f.TopMost = true;
    f.ShowInTaskbar = false;
    f.FormBorderStyle = FormBorderStyle.None;
    f.StartPosition = FormStartPosition.CenterScreen;
    f.Size = new Size(1, 1);
    f.Opacity = 0;
    f.Show();
    f.Activate();
    return f;
  }
  public static string PickModern(string title) {
    Form owner = Owner();
    try {
      IFileOpenDialog dlg = (IFileOpenDialog)new FileOpenDialogCo();
      uint opts;
      dlg.GetOptions(out opts);
      dlg.SetOptions(opts | 0x20u | 0x40u | 0x800u);
      dlg.SetTitle(title);
      int hr = dlg.Show(owner.Handle);
      if (hr == unchecked((int)0x800704C7)) return null;
      if (hr != 0) Marshal.ThrowExceptionForHR(hr);
      IShellItem item;
      dlg.GetResult(out item);
      IntPtr p;
      item.GetDisplayName(0x80058000u, out p);
      try { return Marshal.PtrToStringUni(p); } finally { Marshal.FreeCoTaskMem(p); }
    } finally {
      owner.Close();
    }
  }
  public static string PickClassic(string title) {
    Form owner = Owner();
    try {
      FolderBrowserDialog d = new FolderBrowserDialog();
      d.Description = title;
      d.ShowNewFolderButton = false;
      return d.ShowDialog(owner) == DialogResult.OK ? d.SelectedPath : null;
    } finally {
      owner.Close();
    }
  }
}
'@
Add-Type -TypeDefinition $src -ReferencedAssemblies System.Windows.Forms, System.Drawing
$title = 'RPG Maker ' + [char]0xAC8C + [char]0xC784 + ' ' + [char]0xD3F4 + [char]0xB354
try { $r = [RpgvFolderPicker]::PickModern($title) } catch { $r = [RpgvFolderPicker]::PickClassic($title) }
if ($r) { [Console]::Out.Write('${PICK_MARK}' + $r) } else { [Console]::Out.Write('${CANCEL_MARK}') }
`;

/** PowerShell -EncodedCommand 값(UTF-16LE base64). */
export function encodePowerShell(script: string): string {
  return Buffer.from(script, "utf16le").toString("base64");
}

/** execFile 인자. 고정 문자열뿐이다. */
export function pickerCommand(): { file: string; args: string[] } {
  return {
    file: "powershell.exe",
    args: ["-NoProfile", "-NonInteractive", "-STA", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encodePowerShell(PICKER_SCRIPT)],
  };
}

export function parsePickerOutput(stdout: string): PickResult {
  const out = stdout.replace(/^﻿/, "").trim();
  const at = out.lastIndexOf(PICK_MARK);
  if (at >= 0) {
    const p = out.slice(at + PICK_MARK.length).trim();
    return p ? { path: p } : { cancelled: true };
  }
  if (out.includes(CANCEL_MARK)) return { cancelled: true };
  return { error: ERR_PICK_FAILED };
}

export function createWindowsPicker(exec: ExecFileFn): PickFolder {
  return async () => {
    const { file, args } = pickerCommand();
    try {
      const { stdout } = await exec(file, args, { windowsHide: true, encoding: "utf8", maxBuffer: 1024 * 1024 });
      return parsePickerOutput(stdout);
    } catch {
      return { error: ERR_PICK_FAILED };
    }
  };
}

const nodeExec: ExecFileFn = (file, args, options) =>
  new Promise((resolve, reject) => {
    nodeExecFile(file, args, options, (err, stdout) => {
      if (err) reject(err);
      else resolve({ stdout: String(stdout) });
    });
  });

// ── HTTP ──

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function sendBytes(res: ServerResponse, buf: Buffer): void {
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Length", String(buf.length));
  res.end(buf);
}

function readBody(req: IncomingMessage, max: number): Promise<string | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    req.on("data", (c: Buffer) => {
      if (done) return;
      size += c.length;
      if (size > max) { done = true; resolve(null); return; }
      chunks.push(c);
    });
    req.on("end", () => { if (!done) { done = true; resolve(Buffer.concat(chunks).toString("utf8")); } });
    req.on("error", () => { if (!done) { done = true; resolve(null); } });
  });
}

const FILE_ROUTES = ["read", "range", "list", "stat", "write", "remove"] as const;
type FileRoute = (typeof FILE_ROUTES)[number];
/** 휴대폰 보기에서 쓸 수 있는 파일 작업(읽기만) */
export const REMOTE_FILE_ROUTES = ["read", "range", "list", "stat"] as const;

type Next = (err?: unknown) => void;

export type OpenedSession =
  | { ok: true; id: string; root: string; title: string; engine: "MV" | "MZ"; name: string }
  | { ok: false; error: string };

/** 열린 게임 폴더 세션(id → 실제 루트 경로). 폴더 API와 휴대폰 보기가 같은 것을 쓴다. */
export class FsSessions {
  private map = new Map<string, string>();
  /** 오래돼도 지우지 않을 세션(휴대폰에 공유 중인 게임) */
  keep: () => string | null = () => null;

  /** 게임 루트를 찾아 새 세션을 연다. reuse면 같은 루트의 세션이 있을 때 그 id를 그대로 돌려준다. */
  open(raw: string, opts: { reuse?: boolean } = {}): OpenedSession {
    const game = findGameRoot(raw);
    if (!game.ok) return game;
    const real = realpath(game.root);
    if (real === null) return { ok: false, error: ERR_NOT_FOUND };
    const info = { root: game.root, title: game.title, engine: game.engine, name: path.basename(game.root) };
    if (opts.reuse) {
      for (const [id, r] of this.map) if (r === real) return { ok: true, id, ...info };
    }
    if (this.map.size >= MAX_SESSIONS) {
      const kept = this.keep();
      const old = [...this.map.keys()].find((k) => k !== kept);
      if (old !== undefined) this.map.delete(old);
    }
    const id = randomUUID();
    this.map.set(id, real);
    return { ok: true, id, ...info };
  }

  get(id: unknown): string | undefined {
    return typeof id === "string" ? this.map.get(id) : undefined;
  }
}

/** 휴대폰 보기(scripts/lanShare.ts)가 알려 주는 것. */
export interface RemoteAccess {
  /** 휴대폰 보기로 들어와 확인을 마친 요청인지 */
  isRemote(req: IncomingMessage): boolean;
  /** 휴대폰에 공유 중인 세션 id(없으면 null) */
  sharedId(): string | null;
}

export interface FsApiDeps {
  /** 없으면 기본 폴더 선택 창을 쓰지 않는다(ping의 pick=false). */
  pick?: PickFolder | null;
  /** 세션 목록(휴대폰 보기와 함께 쓴다). 없으면 새로 만든다. */
  sessions?: FsSessions;
  /** 없으면 휴대폰 보기 요청을 하나도 받지 않는다. */
  remote?: RemoteAccess;
}

export function createFsMiddleware(deps: FsApiDeps = {}) {
  const sessions = deps.sessions ?? new FsSessions();
  let picking = false;
  const pick = deps.pick ?? null;
  const openSession = (raw: string) => sessions.open(raw);

  async function handle(req: IncomingMessage, res: ServerResponse, next: Next): Promise<void> {
    const url = (req.url ?? "").split("?")[0];
    if (!url.startsWith("/api/fs/")) { next(); return; }
    const route = url.slice("/api/fs/".length);
    const headers = { host: req.headers.host, origin: req.headers.origin };
    // 누가 보냈는지는 소켓 주소로 본다: 이 PC이거나, 휴대폰 보기 확인을 마친 요청만.
    const remote = deps.remote?.isRemote(req) === true;
    if (!remote && !isLoopbackIp(clientIp(req))) { sendJson(res, 403, { ok: false, error: "forbidden" }); return; }
    if (remote && !(REMOTE_FILE_ROUTES as readonly string[]).includes(route)) { sendJson(res, 403, { ok: false, error: "forbidden" }); return; }

    if (route === "ping") {
      if (req.method !== "GET") { sendJson(res, 405, { ok: false, error: "GET only" }); return; }
      if (!isAllowedRequest(headers, { requireOrigin: false })) { sendJson(res, 403, { ok: false, error: "forbidden" }); return; }
      sendJson(res, 200, { ok: true, pick: pick !== null });
      return;
    }
    const isFile = (FILE_ROUTES as readonly string[]).includes(route);
    if (!isFile && route !== "pick" && route !== "open") { sendJson(res, 404, { ok: false, error: "not found" }); return; }
    if (req.method !== "POST") { sendJson(res, 405, { ok: false, error: "POST only" }); return; }
    if (!isAllowedRequest(headers, { requireOrigin: true, allowIpHost: remote })) { sendJson(res, 403, { ok: false, error: "forbidden" }); return; }

    const raw = await readBody(req, route === "write" ? MAX_WRITE_BODY : MAX_BODY);
    if (raw === null) { sendJson(res, 413, { ok: false, error: "too large" }); return; }
    let input: Record<string, unknown>;
    try {
      const v: unknown = raw === "" ? {} : JSON.parse(raw);
      if (typeof v !== "object" || v === null) throw new Error();
      input = v as Record<string, unknown>;
    } catch { sendJson(res, 400, { ok: false, error: "bad json" }); return; }

    if (route === "pick") {
      if (pick === null) { sendJson(res, 200, { ok: false, error: ERR_PICK_FAILED, pickerFailed: true }); return; }
      if (picking) { sendJson(res, 200, { ok: false, error: ERR_PICK_BUSY }); return; }
      picking = true;
      let r: PickResult;
      try { r = await pick(); } finally { picking = false; }
      if ("cancelled" in r) { sendJson(res, 200, { ok: true, cancelled: true }); return; }
      if ("error" in r) { sendJson(res, 200, { ok: false, error: r.error, pickerFailed: true }); return; }
      sendJson(res, 200, openSession(r.path));
      return;
    }
    if (route === "open") {
      if (typeof input.path !== "string") { sendJson(res, 400, { ok: false, error: "path required" }); return; }
      sendJson(res, 200, openSession(input.path));
      return;
    }

    // 휴대폰은 공유한 게임 하나만 읽는다.
    if (remote && (typeof input.id !== "string" || input.id !== deps.remote?.sharedId())) {
      sendJson(res, 403, { ok: false, error: "forbidden" });
      return;
    }
    const root = sessions.get(input.id);
    if (root === undefined) { sendJson(res, 410, { ok: false, error: ERR_SESSION }); return; }
    handleFile(route as FileRoute, root, input, res);
  }

  function handleFile(route: FileRoute, root: string, input: Record<string, unknown>, res: ServerResponse): void {
    const rel = input.path;
    const bad = () => sendJson(res, 400, { ok: false, error: ERR_BAD_PATH });
    const missing = () => sendJson(res, 404, { ok: false, error: "not found" });
    switch (route) {
      case "read": {
        const b = readFileIn(root, rel);
        if (b === "bad") bad(); else if (b === null) missing(); else sendBytes(res, b);
        return;
      }
      case "range": {
        const start = Number(input.start);
        const end = Number(input.end);
        if (!Number.isFinite(start) || !Number.isFinite(end)) { sendJson(res, 400, { ok: false, error: "bad range" }); return; }
        const b = readRangeIn(root, rel, start, end);
        if (b === "bad") bad(); else if (b === null) missing(); else sendBytes(res, b);
        return;
      }
      case "list": {
        const names = listIn(root, rel);
        if (names === "bad") bad(); else sendJson(res, 200, { ok: true, names });
        return;
      }
      case "stat": {
        const st = statIn(root, rel);
        if (st === "bad") bad(); else sendJson(res, 200, { ok: true, stat: st });
        return;
      }
      case "write": {
        if (typeof input.text !== "string") { sendJson(res, 400, { ok: false, error: "text required" }); return; }
        const r = writeTextIn(root, rel, input.text);
        if (r === "bad") bad(); else sendJson(res, 200, { ok: r });
        return;
      }
      case "remove": {
        const r = removeIn(root, rel);
        if (r === "bad") bad(); else sendJson(res, 200, { ok: r });
        return;
      }
    }
  }

  return async (req: IncomingMessage, res: ServerResponse, next: Next): Promise<void> => {
    try {
      await handle(req, res, next);
    } catch (e) {
      sendJson(res, 500, { ok: false, error: `처리하지 못했어요: ${(e as Error).message}` });
    }
  };
}

/** vite.config.ts에 등록. Windows에서만 기본 폴더 선택 창을 쓴다. */
export function fsApiPlugin(deps: FsApiDeps = {}): Plugin {
  const pick = deps.pick !== undefined ? deps.pick : process.platform === "win32" ? createWindowsPicker(nodeExec) : null;
  const middleware = createFsMiddleware({ ...deps, pick });
  return {
    name: "rpg-viewer-fs",
    configureServer(server) { server.middlewares.use((req, res, next) => { void middleware(req, res, next); }); },
    configurePreviewServer(server) { server.middlewares.use((req, res, next) => { void middleware(req, res, next); }); },
  };
}
