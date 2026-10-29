/**
 * 뷰어에서 "AI에게 맡기기": 열린 게임(폴더 API 세션)으로 가린 사본을 만들고, AI 답변 속 토큰을 원래 글로 풀어 준다.
 *
 * - POST /api/mask/export  { id, note } → { ok, path, files, tokens, replaced, hits } | { ok: false, error }
 *   출력: `<사용자 폴더>/Documents/RPG-Viewer-Masked/<가린 게임 폴더 이름>-YYYYMMDD-HHMMSS`
 * - POST /api/mask/unmask  { id, text } → { ok, text, replaced, unknown }
 *
 * 이 PC(루프백)의 자기 출처에서 온 요청만 받는다. 휴대폰 보기로 들어온 요청은 받지 않는다.
 * 게임은 읽기만 한다. 글(문제 설명·풀 글)은 서버 기록에 남기지 않는다.
 * 실제 일(scripts/maskWork.ts)은 처음 요청 때 불러온다 — src/core를 끌어오므로 vite 설정 묶음에 넣지 않는다.
 */
import fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Plugin } from "vite";
import { isInside, type FsSessions, type RemoteAccess } from "./fsApi.ts";
import { isAllowedRequest } from "./launcher.ts";
import { clientIp, isLoopbackIp } from "./netAddress.ts";

const MAX_BODY = 1024 * 1024;
const DICT_TTL_MS = 5 * 60 * 1000;
export const ERR_BUSY = "다른 사본을 만드는 중이에요";
export const ERR_SESSION = "게임 폴더를 다시 열어 주세요";
export const ERR_INSIDE_GAME = "사본을 둘 곳이 게임 폴더 안이에요.";

export type MaskExport =
  | { ok: true; path: string; files: number; tokens: number; replaced: number; hits: number }
  | { ok: false; error: string };

/** 가린 사본 일(scripts/maskWork.ts) */
export interface MaskWork {
  maskedFolderName(gameRoot: string, now: Date): string;
  exportMirror(root: string, out: string, note: string | null): Promise<MaskExport>;
  dictionary(root: string): Promise<Map<string, string>>;
  unmask(text: string, dict: ReadonlyMap<string, string>): { text: string; replaced: number; unknown: number };
}

/** 기본 출력 위치: 사용자 문서 폴더 아래 RPG-Viewer-Masked */
export function defaultMaskedRoot(): string {
  return path.join(os.homedir(), "Documents", "RPG-Viewer-Masked");
}

let loaded: Promise<MaskWork> | null = null;
/** Node에서 src/의 TypeScript를 바로 읽도록 해석 훅(`@/` 등)을 걸고 maskWork.ts를 불러온다 */
export function loadMaskWork(): Promise<MaskWork> {
  loaded ??= (async () => {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const url = (f: string) => pathToFileURL(path.join(dir, f)).href;
    await import(/* @vite-ignore */ url("ts-alias-hooks.mjs"));
    const m = (await import(/* @vite-ignore */ url("maskWork.ts"))) as { work: MaskWork };
    return m.work;
  })();
  loaded.catch(() => { loaded = null; });
  return loaded;
}

export interface MaskApiDeps {
  sessions: FsSessions;
  /** 없으면 휴대폰 보기 요청을 구분하지 못하므로 루프백만 본다 */
  remote?: RemoteAccess;
  /** 출력 위치(테스트·시험 실행에서 바꾼다) */
  outRoot?: () => string;
  now?: () => Date;
  work?: () => Promise<MaskWork>;
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
    let size = 0, done = false;
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

export function createMaskMiddleware(deps: MaskApiDeps) {
  const outRoot = deps.outRoot ?? defaultMaskedRoot;
  const now = deps.now ?? (() => new Date());
  const getWork = deps.work ?? loadMaskWork;
  let exporting = false;
  /** 같은 게임을 잇달아 풀 때 다시 읽지 않게 사전을 잠깐 기억한다 */
  let cache: { root: string; at: number; dict: Map<string, string> } | null = null;

  async function handle(req: IncomingMessage, res: ServerResponse, next: Next): Promise<void> {
    const url = (req.url ?? "").split("?")[0];
    if (!url.startsWith("/api/mask/")) { next(); return; }
    const route = url.slice("/api/mask/".length);
    // 이 PC에서만(Host 헤더는 꾸밀 수 있으니 소켓 주소로 본다). 휴대폰 보기 요청은 받지 않는다.
    if (deps.remote?.isRemote(req) === true || !isLoopbackIp(clientIp(req))) { send(res, 403, { ok: false, error: "forbidden" }); return; }
    if (route !== "export" && route !== "unmask") { send(res, 404, { ok: false, error: "not found" }); return; }
    if (req.method !== "POST") { send(res, 405, { ok: false, error: "POST only" }); return; }
    if (!isAllowedRequest({ host: req.headers.host, origin: req.headers.origin }, { requireOrigin: true })) {
      send(res, 403, { ok: false, error: "forbidden" });
      return;
    }
    const raw = await readBody(req);
    if (raw === null) { send(res, 413, { ok: false, error: "too large" }); return; }
    let input: Record<string, unknown>;
    try {
      const v: unknown = JSON.parse(raw);
      if (typeof v !== "object" || v === null) throw new Error();
      input = v as Record<string, unknown>;
    } catch { send(res, 400, { ok: false, error: "bad json" }); return; }
    const root = deps.sessions.get(input.id);
    if (root === undefined) { send(res, 410, { ok: false, error: ERR_SESSION }); return; }
    const work = await getWork();

    if (route === "unmask") {
      if (typeof input.text !== "string") { send(res, 400, { ok: false, error: "text required" }); return; }
      if (!cache || cache.root !== root || Date.now() - cache.at > DICT_TTL_MS) cache = { root, at: Date.now(), dict: await work.dictionary(root) };
      send(res, 200, { ok: true, ...work.unmask(input.text, cache.dict) });
      return;
    }

    const note = typeof input.note === "string" ? input.note.slice(0, 20000) : null;
    if (exporting) { send(res, 200, { ok: false, error: ERR_BUSY }); return; }
    exporting = true;
    try {
      const base = path.resolve(outRoot());
      if (isInside(root, base)) { send(res, 200, { ok: false, error: ERR_INSIDE_GAME }); return; }
      const name = work.maskedFolderName(root, now());
      let out = path.join(base, name);
      for (let i = 2; fs.existsSync(out) && i < 100; i++) out = path.join(base, `${name}-${i}`);
      send(res, 200, await work.exportMirror(root, out, note));
    } finally {
      exporting = false;
    }
  }

  return async (req: IncomingMessage, res: ServerResponse, next: Next): Promise<void> => {
    try {
      await handle(req, res, next);
    } catch {
      // 오류 문구에도 글이 섞일 수 있어 그대로 돌려주지 않는다
      send(res, 500, { ok: false, error: "처리하지 못했어요" });
    }
  };
}

/** vite.config.ts에 등록 */
export function maskApiPlugin(deps: MaskApiDeps): Plugin {
  const middleware = createMaskMiddleware(deps);
  return {
    name: "rpg-viewer-mask",
    configureServer(server) { server.middlewares.use((req, res, next) => { void middleware(req, res, next); }); },
    configurePreviewServer(server) { server.middlewares.use((req, res, next) => { void middleware(req, res, next); }); },
  };
}
