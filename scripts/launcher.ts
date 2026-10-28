/**
 * 뷰어에서 게임 실행: Vite 개발/미리보기 서버(같은 Node 프로세스)에 붙는 작은 API.
 *
 * - GET  /api/game/ping   → { ok: true }
 * - POST /api/game/check  { path } → { ok, title?, engine?, exe?, error? }
 * - POST /api/game/launch { path } → { ok, error? }
 *
 * 셸을 쓰지 않고, 찾은 게임 폴더 안의 실행 파일 하나만 실행한다.
 * 요청은 자기 localhost 출처에서 온 것만 받는다.
 */
import { spawn as nodeSpawn } from "node:child_process";
import fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import type { Plugin } from "vite";

export const ERR_NOT_FOUND = "폴더를 찾을 수 없어요";
export const ERR_NOT_GAME = "RPG Maker 게임 폴더가 아니에요";
export const ERR_NO_EXE = "실행 파일(Game.exe)을 찾을 수 없어요";

const MAX_BODY = 4 * 1024;

export type GameCheck =
  | { ok: true; root: string; title: string; engine: "MV" | "MZ"; exe: string }
  | { ok: false; error: string };

/** 붙여 넣은 경로 정리: 앞뒤 공백·따옴표 제거. */
export function normalizeInputPath(raw: string): string {
  let p = raw.trim();
  while (p.length >= 2 && ((p.startsWith('"') && p.endsWith('"')) || (p.startsWith("'") && p.endsWith("'")))) {
    p = p.slice(1, -1).trim();
  }
  return p;
}

function isFile(p: string): boolean {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}

function isDir(p: string): boolean {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

/** 게임 루트의 실행 파일: Game.exe → nw.exe → 하나뿐인 *.exe(제거 프로그램 등 제외). */
export function findExecutable(root: string): string | null {
  let names: string[];
  try {
    names = fs.readdirSync(root).filter((n) => n.toLowerCase().endsWith(".exe") && isFile(path.join(root, n)));
  } catch {
    return null;
  }
  const byName = (want: string) => names.find((n) => n.toLowerCase() === want);
  const pick = byName("game.exe") ?? byName("nw.exe");
  if (pick) return path.join(root, pick);
  const rest = names.filter((n) => {
    const l = n.toLowerCase();
    // *uninst*, Inno Setup의 unins000.exe, NW.js 알림 도우미는 게임이 아니다.
    return !l.includes("uninst") && !l.startsWith("unins") && l !== "notification_helper.exe";
  });
  return rest.length === 1 ? path.join(root, rest[0]) : null;
}

function readTitle(systemJson: string): string {
  try {
    const text = fs.readFileSync(systemJson, "utf8").replace(/^﻿/, "");
    const sys = JSON.parse(text) as { gameTitle?: unknown };
    return typeof sys.gameTitle === "string" ? sys.gameTitle : "";
  } catch {
    return "";
  }
}

/** 폴더 또는 .exe 경로에서 게임 루트·제목·엔진·실행 파일을 찾는다. */
export function resolveGame(raw: string): GameCheck {
  const input = normalizeInputPath(raw);
  if (input === "") return { ok: false, error: ERR_NOT_FOUND };
  const abs = path.resolve(input);
  let dir: string;
  if (isDir(abs)) dir = abs;
  else if (isFile(abs)) dir = path.dirname(abs);
  else return { ok: false, error: ERR_NOT_FOUND };

  // www 폴더를 가리켰으면 상위 폴더(MV 루트)를 먼저 본다.
  const candidates = path.basename(dir).toLowerCase() === "www" ? [path.dirname(dir), dir] : [dir];
  for (const root of candidates) {
    for (const [engine, rel] of [["MV", "www/data/System.json"], ["MZ", "data/System.json"]] as const) {
      const sys = path.join(root, rel);
      if (!isFile(sys)) continue;
      const exe = findExecutable(root);
      if (exe === null) return { ok: false, error: ERR_NO_EXE };
      return { ok: true, root, title: readTitle(sys), engine, exe };
    }
  }
  return { ok: false, error: ERR_NOT_GAME };
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Host가 루프백이고, Origin이 있으면(POST는 필수) 바로 그 Host의 http 출처인지. */
export function isAllowedRequest(
  headers: { host?: string; origin?: string },
  opts: { requireOrigin: boolean },
): boolean {
  const host = headers.host;
  if (!host) return false;
  let hostname: string;
  try {
    hostname = new URL(`http://${host}`).hostname;
  } catch {
    return false;
  }
  if (!LOOPBACK_HOSTS.has(hostname)) return false;
  const origin = headers.origin;
  if (origin === undefined) return !opts.requireOrigin;
  return origin === `http://${host}`;
}

/** 테스트에서 바꿔 끼울 수 있는 spawn의 최소 모양. */
export interface SpawnedLike {
  once(event: "spawn", cb: () => void): unknown;
  once(event: "error", cb: (err: Error) => void): unknown;
  unref(): void;
}
export type SpawnFn = (
  command: string,
  args: string[],
  options: { cwd: string; detached: true; stdio: "ignore"; windowsHide: false },
) => SpawnedLike;

/** 찾은 실행 파일을 게임 루트에서 분리 실행한다(셸 없음). */
export async function launchResolved(game: Extract<GameCheck, { ok: true }>, spawn: SpawnFn): Promise<{ ok: true } | { ok: false; error: string }> {
  let child: SpawnedLike;
  try {
    child = spawn(game.exe, [], { cwd: game.root, detached: true, stdio: "ignore", windowsHide: false });
  } catch (e) {
    return { ok: false, error: `실행하지 못했어요: ${(e as Error).message}` };
  }
  return new Promise((resolve) => {
    child.once("spawn", () => { child.unref(); resolve({ ok: true }); });
    child.once("error", (err) => resolve({ ok: false, error: `실행하지 못했어요: ${err.message}` }));
  });
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string | null> {
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
    req.on("end", () => { if (!done) { done = true; resolve(Buffer.concat(chunks).toString("utf8")); } });
    req.on("error", () => { if (!done) { done = true; resolve(null); } });
  });
}

type Next = (err?: unknown) => void;

/** connect 미들웨어. /api/game/* 외의 요청은 그대로 넘긴다. */
export function createLauncherMiddleware(deps: { spawn: SpawnFn }) {
  return async (req: IncomingMessage, res: ServerResponse, next: Next): Promise<void> => {
    const url = (req.url ?? "").split("?")[0];
    if (!url.startsWith("/api/game/")) { next(); return; }
    const route = url.slice("/api/game/".length);
    const headers = { host: req.headers.host, origin: req.headers.origin };

    if (route === "ping") {
      if (req.method !== "GET") { send(res, 405, { ok: false, error: "GET only" }); return; }
      if (!isAllowedRequest(headers, { requireOrigin: false })) { send(res, 403, { ok: false, error: "forbidden" }); return; }
      send(res, 200, { ok: true });
      return;
    }
    if (route !== "check" && route !== "launch") { send(res, 404, { ok: false, error: "not found" }); return; }
    if (req.method !== "POST") { send(res, 405, { ok: false, error: "POST only" }); return; }
    if (!isAllowedRequest(headers, { requireOrigin: true })) { send(res, 403, { ok: false, error: "forbidden" }); return; }

    const raw = await readBody(req);
    if (raw === null) { send(res, 413, { ok: false, error: "too large" }); return; }
    let input: unknown;
    try { input = JSON.parse(raw); } catch { send(res, 400, { ok: false, error: "bad json" }); return; }
    const p = (input as { path?: unknown } | null)?.path;
    if (typeof p !== "string") { send(res, 400, { ok: false, error: "path required" }); return; }

    const game = resolveGame(p);
    if (!game.ok) { send(res, 200, game); return; }
    if (route === "check") {
      send(res, 200, { ok: true, title: game.title, engine: game.engine, exe: game.exe });
      return;
    }
    send(res, 200, await launchResolved(game, deps.spawn));
  };
}

/** vite.config.ts에 등록: dev·preview 서버 모두에 API를 붙인다. */
export function launcherPlugin(deps: { spawn?: SpawnFn } = {}): Plugin {
  const middleware = createLauncherMiddleware({ spawn: deps.spawn ?? (nodeSpawn as unknown as SpawnFn) });
  return {
    name: "rpg-viewer-launcher",
    configureServer(server) { server.middlewares.use((req, res, next) => { void middleware(req, res, next); }); },
    configurePreviewServer(server) { server.middlewares.use((req, res, next) => { void middleware(req, res, next); }); },
  };
}
