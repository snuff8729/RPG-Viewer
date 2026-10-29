/**
 * 휴대폰 보기: 같은 와이파이의 휴대폰·태블릿이 PC 뷰어의 플레이 화면을 본다.
 * 휴대폰이 쓸 수 있는 것은 게임 보조·치트·게임 설정 파일 둘뿐이다(scripts/fsApi.ts REMOTE_WRITE_FILES).
 *
 * 서버는 모든 네트워크에서 듣지만(vite `host: true`), 이 PC(루프백)가 아닌 요청은 맨 앞 미들웨어가 모두 막는다.
 * 다음을 다 만족할 때만 통과한다.
 * - 보낸 쪽(소켓 주소)이 공유기 안쪽 주소(10/8, 172.16/12, 192.168/16, 169.254/16, fc00::/7, fe80::/10)
 * - 휴대폰 보기가 켜져 있고 허용 기간이 남았다
 * - 지금 토큰을 가졌다: QR 주소의 `?share=<토큰>`을 처음 열면 HttpOnly 쿠키로 바꿔 주고(남은 기간만큼), 그 뒤엔 쿠키로 본다
 * 통과한 요청도 화면·자원과 `/api/fs/{read,range,list,stat,write}`(공유한 게임 하나, write는 정해 둔 파일만),
 * `/api/share/current`만 쓸 수 있다.
 *
 * 켜짐·토큰·만료 시각·공유 게임 경로는 `~/.rpg-viewer/share.json`에 남겨, 뷰어 서버를 다시 켜도 그대로다.
 * 끄면 토큰을 바로 버린다(다시 켜면 새 QR). 켜져 있는 동안 다시 켜면 같은 토큰을 그대로 쓴다.
 *
 * - POST /api/share/start { days, gamePath? } → 상태(이 PC에서만)
 * - POST /api/share/stop · /api/share/rotate → 상태(이 PC에서만)
 * - POST /api/share/game { gamePath } → 켜져 있으면 공유 게임을 바꾼다(이 PC에서만)
 * - GET  /api/share/status → 상태(이 PC에서만)
 * - GET  /api/share/current → { ok, id, title, engine, name } (휴대폰)
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import os from "node:os";
import path from "node:path";
import type { Plugin } from "vite";
import type { FsSessions, RemoteAccess } from "./fsApi.ts";
import { isAllowedRequest } from "./launcher.ts";
import { clientIp, isLoopbackIp, isPrivateIp } from "./netAddress.ts";

export const SHARE_COOKIE = "rpgv_share";
export const SHARE_DAYS = [1, 7, 30] as const;
export const DEFAULT_SHARE_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_BODY = 8 * 1024;

export const MSG_NOT_LAN = "같은 와이파이(로컬 네트워크)에 있는 기기에서만 볼 수 있어요.";
export const MSG_OFF = "휴대폰 보기가 꺼져 있어요. PC에서 휴대폰 보기를 다시 켜고 QR을 다시 찍어 주세요.";
export const MSG_EXPIRED = "허용 기간이 끝났어요. PC에서 휴대폰 보기를 다시 켜고 QR을 찍어 주세요.";
export const MSG_STALE = "연결 정보가 바뀌었어요. PC에서 휴대폰 보기를 다시 켜고 QR을 다시 찍어 주세요.";
export const MSG_READ_ONLY = "휴대폰에서는 쓸 수 없는 기능이에요.";
export const ERR_NEED_GAME = "공유할 게임 폴더 위치가 필요해요";

// ── 저장 ──

export interface ShareFile {
  on: boolean;
  token: string | null;
  /** 허용이 끝나는 시각(ms) */
  expiresAt: number | null;
  /** 고른 허용 기간(일) */
  days: number;
  /** 마지막으로 공유한 게임 폴더 */
  gamePath: string | null;
}

export interface ShareStore {
  load(): Partial<ShareFile> | null;
  save(f: ShareFile): void;
}

/** 사용자 홈의 `.rpg-viewer/share.json`(저장소 밖, 커밋되지 않는다). */
export function defaultShareFile(): string {
  return path.join(os.homedir(), ".rpg-viewer", "share.json");
}

export function fileShareStore(file: string = defaultShareFile()): ShareStore {
  return {
    load() {
      try {
        const v = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
        return typeof v === "object" && v !== null ? (v as Partial<ShareFile>) : null;
      } catch { return null; }
    },
    save(f) {
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const tmp = `${file}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(f, null, 2), { encoding: "utf8", mode: 0o600 });
        fs.renameSync(tmp, file);
      } catch { /* 저장하지 못해도 이번 실행 동안은 동작한다 */ }
    },
  };
}

export function memoryShareStore(initial: Partial<ShareFile> | null = null): ShareStore & { saved: ShareFile | null } {
  const s = {
    saved: null as ShareFile | null,
    load: () => (s.saved ?? initial),
    save: (f: ShareFile) => { s.saved = { ...f }; },
  };
  return s;
}

const newToken = () => randomBytes(24).toString("base64url");

function sameToken(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export interface SharedGame { id: string; title: string; engine: string; name: string; root: string }

export interface ShareDeps {
  sessions: FsSessions;
  store: ShareStore;
  now?: () => number;
  token?: () => string;
}

/** 휴대폰 보기 상태(디스크에 남는다)와 확인을 마친 휴대폰 요청 표시. */
export class ShareState implements RemoteAccess {
  private deps: ShareDeps;
  private file: ShareFile | null = null;
  private game: SharedGame | null = null;
  private remotes = new WeakSet<object>();

  constructor(deps: ShareDeps) {
    this.deps = deps;
    deps.sessions.keep = () => this.game?.id ?? null;
  }

  now(): number { return (this.deps.now ?? Date.now)(); }

  /** 처음 쓸 때 읽는다(설정 파일을 읽는 것만으로 홈 폴더를 건드리지 않게). */
  private get state(): ShareFile {
    if (this.file === null) {
      const v = this.deps.store.load() ?? {};
      const days = SHARE_DAYS.includes(v.days as never) ? (v.days as number) : DEFAULT_SHARE_DAYS;
      this.file = {
        on: v.on === true && typeof v.token === "string" && v.token.length >= 16 && typeof v.expiresAt === "number",
        token: typeof v.token === "string" ? v.token : null,
        expiresAt: typeof v.expiresAt === "number" ? v.expiresAt : null,
        days,
        gamePath: typeof v.gamePath === "string" && v.gamePath !== "" ? v.gamePath : null,
      };
      if (!this.file.on) { this.file.token = null; this.file.expiresAt = null; }
    }
    return this.file;
  }

  private save(): void { this.deps.store.save({ ...this.state }); }

  /** 켜져 있고 허용 기간이 남았는지 */
  active(): boolean {
    const s = this.state;
    return s.on && s.token !== null && s.expiresAt !== null && this.now() < s.expiresAt;
  }

  /** 켜 두었지만 기간이 끝났는지 */
  expired(): boolean {
    const s = this.state;
    return s.on && s.expiresAt !== null && this.now() >= s.expiresAt;
  }

  token(): string | null { return this.active() ? this.state.token : null; }
  expiresAt(): number | null { return this.state.on ? this.state.expiresAt : null; }
  days(): number { return this.state.days; }
  gamePath(): string | null { return this.state.gamePath; }

  /** 남은 허용 시간(초, 쿠키 Max-Age) */
  remainingSeconds(): number {
    const at = this.state.expiresAt;
    return this.active() && at !== null ? Math.max(0, Math.floor((at - this.now()) / 1000)) : 0;
  }

  tokenMatches(t: string | undefined | null): boolean {
    const cur = this.token();
    return typeof t === "string" && cur !== null && sameToken(t, cur);
  }

  /** 공유할 게임을 정한다(실제 폴더인지 확인). 실패하면 이전 게임을 그대로 둔다. */
  setGame(gamePath: string): { ok: true } | { ok: false; error: string } {
    const r = this.deps.sessions.open(gamePath, { reuse: true });
    if (!r.ok) return r;
    this.game = { id: r.id, title: r.title, engine: r.engine, name: r.name, root: r.root };
    this.state.gamePath = gamePath;
    this.save();
    return { ok: true };
  }

  /**
   * 켠다. 이미 켜져 있고 기간이 남았으면 같은 토큰을 그대로 쓰고(다시 찍지 않아도 된다) 기간만 새로 정한다.
   * 게임 경로를 주면 그 게임으로, 아니면 마지막으로 공유한 게임으로.
   */
  start(days: number, gamePath?: string | null): { ok: true } | { ok: false; error: string } {
    const want = gamePath ?? this.state.gamePath;
    if (!want) return { ok: false, error: ERR_NEED_GAME };
    const g = this.setGame(want);
    if (!g.ok) return g;
    const s = this.state;
    const d = SHARE_DAYS.includes(days as never) ? days : DEFAULT_SHARE_DAYS;
    if (!this.active()) s.token = (this.deps.token ?? newToken)();
    s.on = true;
    s.days = d;
    s.expiresAt = this.now() + d * DAY_MS;
    this.save();
    return { ok: true };
  }

  /** 끈다: 토큰을 바로 버린다. */
  stop(): void {
    const s = this.state;
    s.on = false;
    s.token = null;
    s.expiresAt = null;
    this.save();
  }

  /** 새 QR: 토큰만 바꾼다(지금까지 연결한 휴대폰은 끊긴다). 꺼져 있으면 아무것도 하지 않는다. */
  rotate(): boolean {
    if (!this.active()) return false;
    this.state.token = (this.deps.token ?? newToken)();
    this.save();
    return true;
  }

  /** 공유 중인 게임. 서버를 다시 켜 세션이 없으면 저장한 경로로 다시 연다. */
  shared(): SharedGame | null {
    if (!this.active()) return null;
    if (this.game && this.deps.sessions.get(this.game.id) !== undefined) return this.game;
    const p = this.state.gamePath;
    if (!p) return null;
    return this.setGame(p).ok ? this.game : null;
  }

  sharedId(): string | null { return this.shared()?.id ?? null; }
  sharedEngine(): string | null { return this.shared()?.engine ?? null; }

  markRemote(req: object): void { this.remotes.add(req); }
  isRemote(req: IncomingMessage): boolean { return this.remotes.has(req); }
}

// ── 판정 ──

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    if (k && !(k in out)) out[k] = part.slice(eq + 1).trim();
  }
  return out;
}

export function shareCookie(token: string, maxAgeSeconds: number): string {
  return `${SHARE_COOKIE}=${token}; Max-Age=${maxAgeSeconds}; Path=/; HttpOnly; SameSite=Lax`;
}

const REMOTE_API = new Set(["/api/fs/read", "/api/fs/range", "/api/fs/list", "/api/fs/stat", "/api/fs/write", "/api/share/current"]);

/**
 * 휴대폰 보기에서 열 수 있는 경로: 화면·자원 전부, API는 읽기 몇 개와 write(어느 파일인지는 폴더 API가 다시 본다).
 * 편집기 열기(dev)는 막는다.
 */
export function remoteRouteAllowed(pathname: string): boolean {
  if (pathname.startsWith("/api/")) return REMOTE_API.has(pathname);
  if (pathname.startsWith("/__open-in-editor")) return false;
  return true;
}

export type Gate =
  | { kind: "local" }
  | { kind: "remote"; setCookie?: string; redirect?: string }
  | { kind: "deny"; message: string };

/** 요청 하나를 판정한다. ip는 소켓 주소(정규화 전이어도 된다). */
export function gateRequest(
  r: { ip: string; method?: string; url: string; cookie?: string },
  share: ShareState,
): Gate {
  if (isLoopbackIp(r.ip)) return { kind: "local" };
  if (!isPrivateIp(r.ip)) return { kind: "deny", message: MSG_NOT_LAN };
  if (!share.active()) return { kind: "deny", message: share.expired() ? MSG_EXPIRED : MSG_OFF };

  let url: URL;
  try { url = new URL(r.url, "http://x"); } catch { return { kind: "deny", message: MSG_STALE }; }
  const fromQuery = url.searchParams.get("share");
  const fromCookie = parseCookies(r.cookie)[SHARE_COOKIE];
  const token = fromQuery ?? fromCookie;
  if (!share.tokenMatches(token)) return { kind: "deny", message: token ? MSG_STALE : MSG_OFF };
  if (!remoteRouteAllowed(url.pathname)) return { kind: "deny", message: MSG_READ_ONLY };

  const cookie = shareCookie(share.token() as string, share.remainingSeconds());
  if (fromQuery !== null) {
    // 토큰은 쿠키로 옮기고 주소창에서 지운다(#/play 같은 해시는 브라우저가 그대로 둔다).
    url.searchParams.delete("share");
    const isPage = (r.method ?? "GET") === "GET" && !url.pathname.startsWith("/api/");
    return isPage ? { kind: "remote", setCookie: cookie, redirect: url.pathname + url.search } : { kind: "remote", setCookie: cookie };
  }
  // 첫 화면을 열 때마다 쿠키 기간을 남은 허용 기간으로 맞춘다(PC에서 기간을 늘렸을 때).
  if (url.pathname === "/" || url.pathname === "/index.html") return { kind: "remote", setCookie: cookie };
  return { kind: "remote" };
}

// ── 주소 ──

/** 가상 어댑터(WSL·Hyper-V·VirtualBox 등)는 뒤로 */
const VIRTUAL_NIC = /vethernet|wsl|hyper-v|virtualbox|vmware|vbox|docker|loopback|bluetooth|tailscale|zerotier/i;

/** 휴대폰이 열 주소들(PC의 공유기 안쪽 IPv4마다 하나). */
export function shareUrls(
  nets: NodeJS.Dict<os.NetworkInterfaceInfo[]>,
  port: number,
  token: string,
): string[] {
  const found: { ip: string; rank: number }[] = [];
  for (const [name, list] of Object.entries(nets)) {
    for (const n of list ?? []) {
      if (n.internal || n.family !== "IPv4" || !isPrivateIp(n.address)) continue;
      const linkLocal = n.address.startsWith("169.254.");
      const rank = (VIRTUAL_NIC.test(name) ? 2 : 0) + (linkLocal ? 4 : 0) + (n.address.startsWith("192.168.") ? 0 : 1);
      if (!found.some((f) => f.ip === n.address)) found.push({ ip: n.address, rank });
    }
  }
  found.sort((a, b) => a.rank - b.rank);
  const q = new URLSearchParams({ share: token, remote: "1" }).toString();
  return found.map((f) => `http://${f.ip}:${port}/?${q}#/play`);
}

// ── HTTP ──

type Next = (err?: unknown) => void;

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
}

function sendDenied(req: IncomingMessage, res: ServerResponse, message: string): void {
  const pathname = (req.url ?? "").split("?")[0];
  if (pathname.startsWith("/api/")) { sendJson(res, 403, { ok: false, error: message }); return; }
  res.statusCode = 403;
  res.setHeader("Cache-Control", "no-store");
  if (String(req.headers.accept ?? "").includes("text/html")) {
    // 휴대폰에서 읽기 좋은 크기로(글자만)
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>RPG Viewer</title><p style="font:17px/1.5 system-ui,sans-serif;padding:24px">${escapeHtml(message)}</p>`);
    return;
  }
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end(message);
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    req.on("data", (c: Buffer) => {
      if (done) return;
      size += c.length;
      if (size > MAX_BODY) { done = true; resolve(null); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      if (done) return;
      done = true;
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        const v: unknown = raw === "" ? {} : JSON.parse(raw);
        resolve(typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null);
      } catch { resolve(null); }
    });
    req.on("error", () => { if (!done) { done = true; resolve(null); } });
  });
}

/** PC 화면에 보여 줄 상태 */
export function shareStatus(share: ShareState, port: number, nets: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces()) {
  const token = share.token();
  const game = token ? share.shared() : null;
  return {
    ok: true,
    on: token !== null,
    expired: share.expired(),
    expiresAt: token ? share.expiresAt() : null,
    days: share.days(),
    gamePath: share.gamePath(),
    title: game?.title ?? null,
    urls: token ? shareUrls(nets, port, token) : [],
  };
}

/** 맨 앞 문지기: 이 PC가 아닌 요청을 판정하고, 통과한 요청에 휴대폰 표시를 붙인다. */
export function createGateMiddleware(share: ShareState) {
  return (req: IncomingMessage, res: ServerResponse, next: Next): void => {
    const g = gateRequest({ ip: clientIp(req), method: req.method, url: req.url ?? "/", cookie: req.headers.cookie }, share);
    if (g.kind === "local") { next(); return; }
    if (g.kind === "deny") { sendDenied(req, res, g.message); return; }
    share.markRemote(req);
    if (g.setCookie) res.setHeader("Set-Cookie", g.setCookie);
    if (g.redirect) {
      res.statusCode = 302;
      res.setHeader("Location", g.redirect);
      res.setHeader("Cache-Control", "no-store");
      res.end();
      return;
    }
    next();
  };
}

/** /api/share/* */
export function createShareMiddleware(share: ShareState, nets: () => NodeJS.Dict<os.NetworkInterfaceInfo[]> = () => os.networkInterfaces()) {
  async function handle(req: IncomingMessage, res: ServerResponse, next: Next): Promise<void> {
    const url = (req.url ?? "").split("?")[0];
    if (!url.startsWith("/api/share/")) { next(); return; }
    const route = url.slice("/api/share/".length);
    const remote = share.isRemote(req);
    const headers = { host: req.headers.host, origin: req.headers.origin };

    if (route === "current") {
      if (req.method !== "GET") { sendJson(res, 405, { ok: false, error: "GET only" }); return; }
      if (!remote && !isLoopbackIp(clientIp(req))) { sendJson(res, 403, { ok: false, error: "forbidden" }); return; }
      if (!isAllowedRequest(headers, { requireOrigin: false, allowIpHost: remote })) { sendJson(res, 403, { ok: false, error: "forbidden" }); return; }
      const g = share.shared();
      if (!g) { sendJson(res, 200, { ok: false, error: share.expired() ? MSG_EXPIRED : MSG_OFF }); return; }
      // 휴대폰에는 PC의 폴더 경로를 알려 주지 않는다.
      sendJson(res, 200, { ok: true, id: g.id, title: g.title, engine: g.engine, name: g.name });
      return;
    }

    // 나머지는 이 PC에서만
    if (remote || !isLoopbackIp(clientIp(req))) { sendJson(res, 403, { ok: false, error: "forbidden" }); return; }
    const port = req.socket?.localPort ?? 0;
    if (route === "status") {
      if (req.method !== "GET") { sendJson(res, 405, { ok: false, error: "GET only" }); return; }
      if (!isAllowedRequest(headers, { requireOrigin: false })) { sendJson(res, 403, { ok: false, error: "forbidden" }); return; }
      sendJson(res, 200, shareStatus(share, port, nets()));
      return;
    }
    if (!["start", "stop", "rotate", "game"].includes(route)) { sendJson(res, 404, { ok: false, error: "not found" }); return; }
    if (req.method !== "POST") { sendJson(res, 405, { ok: false, error: "POST only" }); return; }
    if (!isAllowedRequest(headers, { requireOrigin: true })) { sendJson(res, 403, { ok: false, error: "forbidden" }); return; }
    const input = await readBody(req);
    if (input === null) { sendJson(res, 400, { ok: false, error: "bad json" }); return; }
    const gamePath = typeof input.gamePath === "string" && input.gamePath.trim() !== "" ? input.gamePath : null;

    if (route === "start") {
      const r = share.start(Number(input.days), gamePath);
      if (!r.ok) { sendJson(res, 200, r); return; }
    } else if (route === "stop") {
      share.stop();
    } else if (route === "rotate") {
      share.rotate();
    } else if (route === "game") {
      if (gamePath === null) { sendJson(res, 400, { ok: false, error: "gamePath required" }); return; }
      // 꺼져 있으면 바꾸지 않는다(켤 때 PC가 연 게임을 다시 보낸다).
      if (share.active()) {
        const r = share.setGame(gamePath);
        if (!r.ok) { sendJson(res, 200, r); return; }
      }
    }
    sendJson(res, 200, shareStatus(share, port, nets()));
  }

  return async (req: IncomingMessage, res: ServerResponse, next: Next): Promise<void> => {
    try {
      await handle(req, res, next);
    } catch (e) {
      sendJson(res, 500, { ok: false, error: `처리하지 못했어요: ${(e as Error).message}` });
    }
  };
}

interface HttpServerLike {
  prependListener(event: "upgrade", cb: (req: IncomingMessage, socket: Duplex) => void): unknown;
}

/** HMR 웹소켓(upgrade)은 미들웨어를 지나지 않는다 — 같은 판정으로 먼저 끊는다. */
export function guardUpgrades(httpServer: HttpServerLike | null | undefined, share: ShareState): void {
  httpServer?.prependListener("upgrade", (req, socket) => {
    const g = gateRequest({ ip: clientIp(req), method: req.method, url: req.url ?? "/", cookie: req.headers.cookie }, share);
    if (g.kind === "deny") socket.destroy();
  });
}

/** vite.config.ts에서 맨 앞에 등록한다. */
export function lanSharePlugin(share: ShareState): Plugin {
  const gate = createGateMiddleware(share);
  const api = createShareMiddleware(share);
  const install = (server: { middlewares: { use(fn: (req: IncomingMessage, res: ServerResponse, next: Next) => void): unknown }; httpServer: unknown }) => {
    server.middlewares.use(gate);
    server.middlewares.use((req, res, next) => { void api(req, res, next); });
    guardUpgrades(server.httpServer as HttpServerLike | null, share);
  };
  return {
    name: "rpg-viewer-lan-share",
    enforce: "pre",
    configureServer(server) { install(server); },
    configurePreviewServer(server) { install(server); },
  };
}
