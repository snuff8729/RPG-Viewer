import fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createLauncherMiddleware, ERR_NO_EXE, ERR_NOT_FOUND, ERR_NOT_GAME, findExecutable, isAllowedRequest, launchResolved,
  normalizeInputPath, resolveGame, type SpawnedLike, type SpawnFn,
} from "../../scripts/launcher";

let tmp: string;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rpgv-launch-")); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

function touch(rel: string, content = ""): string {
  const p = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  return p;
}
const system = (title: string) => JSON.stringify({ gameTitle: title });

describe("normalizeInputPath", () => {
  it("strips whitespace and quotes", () => {
    expect(normalizeInputPath('  "C:\\Games\\My Game"  ')).toBe("C:\\Games\\My Game");
    expect(normalizeInputPath("'C:/x'")).toBe("C:/x");
    expect(normalizeInputPath("C:/x")).toBe("C:/x");
  });
});

describe("findExecutable", () => {
  it("prefers Game.exe, case-insensitively", () => {
    touch("nw.exe"); touch("game.EXE"); touch("Other.exe");
    expect(path.basename(findExecutable(tmp)!)).toBe("game.EXE");
  });
  it("falls back to nw.exe", () => {
    touch("nw.exe"); touch("Other.exe");
    expect(path.basename(findExecutable(tmp)!)).toBe("nw.exe");
  });
  it("uses the only other exe, ignoring uninstallers and helpers", () => {
    touch("MyGame.exe"); touch("unins000.exe"); touch("Uninstall.exe"); touch("notification_helper.exe");
    expect(path.basename(findExecutable(tmp)!)).toBe("MyGame.exe");
  });
  it("gives up when ambiguous or missing", () => {
    expect(findExecutable(tmp)).toBeNull();
    touch("A.exe"); touch("B.exe");
    expect(findExecutable(tmp)).toBeNull();
  });
  it("ignores directories named .exe", () => {
    fs.mkdirSync(path.join(tmp, "Game.exe"));
    expect(findExecutable(tmp)).toBeNull();
  });
});

describe("resolveGame", () => {
  it("finds an MV game from its root, its www folder, or its exe", () => {
    touch("www/data/System.json", "\uFEFF" + system("모험"));
    const exe = touch("Game.exe");
    const want = { ok: true, root: tmp, title: "모험", engine: "MV", exe };
    expect(resolveGame(tmp)).toEqual(want);
    expect(resolveGame(path.join(tmp, "www"))).toEqual(want);
    expect(resolveGame(`"${exe}"`)).toEqual(want);
  });

  it("finds an MZ game", () => {
    touch("data/System.json", system("MZ Game"));
    const exe = touch("Game.exe");
    expect(resolveGame(tmp)).toEqual({ ok: true, root: tmp, title: "MZ Game", engine: "MZ", exe });
  });

  it("reports missing folders, non-games and missing exes", () => {
    expect(resolveGame(path.join(tmp, "nope"))).toEqual({ ok: false, error: ERR_NOT_FOUND });
    expect(resolveGame("   ")).toEqual({ ok: false, error: ERR_NOT_FOUND });
    expect(resolveGame(tmp)).toEqual({ ok: false, error: ERR_NOT_GAME });
    touch("data/System.json", system("x"));
    expect(resolveGame(tmp)).toEqual({ ok: false, error: ERR_NO_EXE });
  });

  it("keeps an empty title when System.json is unreadable", () => {
    touch("data/System.json", "{not json");
    touch("Game.exe");
    const r = resolveGame(tmp);
    expect(r.ok && r.title).toBe("");
  });
});

describe("isAllowedRequest", () => {
  const post = { requireOrigin: true };
  it("accepts the server's own loopback origin", () => {
    expect(isAllowedRequest({ host: "localhost:5173", origin: "http://localhost:5173" }, post)).toBe(true);
    expect(isAllowedRequest({ host: "127.0.0.1:4173", origin: "http://127.0.0.1:4173" }, post)).toBe(true);
    expect(isAllowedRequest({ host: "[::1]:5173", origin: "http://[::1]:5173" }, post)).toBe(true);
  });
  it("rejects other origins, non-loopback hosts and missing headers", () => {
    expect(isAllowedRequest({ host: "localhost:5173", origin: "http://evil.example" }, post)).toBe(false);
    expect(isAllowedRequest({ host: "localhost:5173", origin: "http://localhost:9999" }, post)).toBe(false);
    expect(isAllowedRequest({ host: "evil.example:5173", origin: "http://evil.example:5173" }, post)).toBe(false);
    expect(isAllowedRequest({ host: "192.168.0.2:5173", origin: "http://192.168.0.2:5173" }, post)).toBe(false);
    expect(isAllowedRequest({ host: "localhost:5173" }, post)).toBe(false);
    expect(isAllowedRequest({ origin: "http://localhost:5173" }, post)).toBe(false);
  });
  it("allows a missing origin only when not required", () => {
    expect(isAllowedRequest({ host: "localhost:5173" }, { requireOrigin: false })).toBe(true);
  });
});

/** spawn을 흉내 낸다: 호출을 기록하고 spawn/error 이벤트를 바로 낸다. */
function fakeSpawn(outcome: "spawn" | Error) {
  const calls: { command: string; args: string[]; options: unknown; unref: boolean }[] = [];
  const spawn: SpawnFn = (command, args, options) => {
    const call = { command, args, options, unref: false };
    calls.push(call);
    const child: SpawnedLike = {
      once(event: string, cb: (err: Error) => void) {
        if (event === "spawn" && outcome === "spawn") queueMicrotask(() => cb(undefined as unknown as Error));
        if (event === "error" && outcome instanceof Error) queueMicrotask(() => cb(outcome));
        return child;
      },
      unref() { call.unref = true; },
    };
    return child;
  };
  return { spawn, calls };
}

describe("launchResolved", () => {
  it("spawns the exe detached in the game root without a shell", async () => {
    const { spawn, calls } = fakeSpawn("spawn");
    const game = { ok: true as const, root: tmp, title: "t", engine: "MZ" as const, exe: path.join(tmp, "Game.exe") };
    expect(await launchResolved(game, spawn)).toEqual({ ok: true });
    expect(calls).toEqual([{
      command: game.exe, args: [], unref: true,
      options: { cwd: tmp, detached: true, stdio: "ignore", windowsHide: false },
    }]);
  });
  it("reports spawn errors", async () => {
    const { spawn } = fakeSpawn(new Error("EACCES"));
    const game = { ok: true as const, root: tmp, title: "t", engine: "MZ" as const, exe: path.join(tmp, "Game.exe") };
    const r = await launchResolved(game, spawn);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("EACCES");
  });
});

interface Reply { status: number; body: Record<string, unknown> | null; next: boolean }

async function call(
  mw: ReturnType<typeof createLauncherMiddleware>,
  opts: { method: string; url: string; headers?: Record<string, string>; body?: string },
): Promise<Reply> {
  const req = Readable.from(opts.body === undefined ? [] : [Buffer.from(opts.body)]) as unknown as IncomingMessage;
  Object.assign(req, { method: opts.method, url: opts.url, headers: opts.headers ?? {} });
  let status = 0;
  let text = "";
  const res = {
    set statusCode(s: number) { status = s; },
    setHeader() {},
    end(t: string) { text = t; },
  } as unknown as ServerResponse;
  let nextCalled = false;
  await mw(req, res, () => { nextCalled = true; });
  return { status, body: text ? JSON.parse(text) : null, next: nextCalled };
}

describe("launcher middleware", () => {
  const own = { host: "localhost:5173", origin: "http://localhost:5173" };

  it("passes through unrelated requests", async () => {
    const mw = createLauncherMiddleware(fakeSpawn("spawn"));
    expect((await call(mw, { method: "GET", url: "/src/main.tsx" })).next).toBe(true);
  });

  it("answers ping", async () => {
    const mw = createLauncherMiddleware(fakeSpawn("spawn"));
    expect(await call(mw, { method: "GET", url: "/api/game/ping", headers: { host: "localhost:5173" } }))
      .toEqual({ status: 200, body: { ok: true }, next: false });
    expect((await call(mw, { method: "POST", url: "/api/game/ping", headers: own })).status).toBe(405);
  });

  it("checks a game folder", async () => {
    touch("www/data/System.json", system("모험"));
    const exe = touch("Game.exe");
    const mw = createLauncherMiddleware(fakeSpawn("spawn"));
    const r = await call(mw, { method: "POST", url: "/api/game/check", headers: own, body: JSON.stringify({ path: tmp }) });
    expect(r).toEqual({ status: 200, body: { ok: true, title: "모험", engine: "MV", exe }, next: false });
  });

  it("launches only after the checks pass", async () => {
    const fake = fakeSpawn("spawn");
    const mw = createLauncherMiddleware(fake);
    const bad = await call(mw, { method: "POST", url: "/api/game/launch", headers: own, body: JSON.stringify({ path: tmp }) });
    expect(bad.body).toEqual({ ok: false, error: ERR_NOT_GAME });
    expect(fake.calls).toHaveLength(0);

    touch("data/System.json", system("x"));
    const exe = touch("Game.exe");
    const ok = await call(mw, { method: "POST", url: "/api/game/launch", headers: own, body: JSON.stringify({ path: tmp }) });
    expect(ok.body).toEqual({ ok: true });
    expect(fake.calls.map((c) => c.command)).toEqual([exe]);
  });

  it("rejects foreign origins, wrong methods, bad bodies and big bodies", async () => {
    touch("data/System.json", system("x"));
    touch("Game.exe");
    const fake = fakeSpawn("spawn");
    const mw = createLauncherMiddleware(fake);
    const body = JSON.stringify({ path: tmp });
    expect((await call(mw, { method: "POST", url: "/api/game/launch", headers: { host: "localhost:5173", origin: "http://evil.example" }, body })).status).toBe(403);
    expect((await call(mw, { method: "POST", url: "/api/game/launch", headers: { host: "localhost:5173" }, body })).status).toBe(403);
    expect((await call(mw, { method: "GET", url: "/api/game/launch", headers: own })).status).toBe(405);
    expect((await call(mw, { method: "POST", url: "/api/game/launch", headers: own, body: "{" })).status).toBe(400);
    expect((await call(mw, { method: "POST", url: "/api/game/launch", headers: own, body: "{}" })).status).toBe(400);
    expect((await call(mw, { method: "POST", url: "/api/game/launch", headers: own, body: JSON.stringify({ path: "x".repeat(5000) }) })).status).toBe(413);
    expect((await call(mw, { method: "POST", url: "/api/game/other", headers: own, body })).status).toBe(404);
    expect((await call(mw, { method: "POST", url: "/api/game/backups/list", headers: { host: "localhost:5173", origin: "http://evil.example" }, body })).status).toBe(403);
    expect(fake.calls).toHaveLength(0);
  });

  it("serves backups and reports running games through the injected process lookup", async () => {
    touch("data/System.json", system("x"));
    const exe = touch("Game.exe");
    touch("save/global.rpgsave", "G");
    const procs = {
      findByExe: async (e: string) => (e === exe ? [77] : []),
      killTree: async () => {},
      isAlive: () => false,
      sleep: async () => {},
    };
    const mw = createLauncherMiddleware({ ...fakeSpawn("spawn"), procs });
    const post = (url: string, extra: Record<string, unknown> = {}) =>
      call(mw, { method: "POST", url, headers: own, body: JSON.stringify({ path: tmp, ...extra }) });
    expect((await post("/api/game/running")).body).toEqual({ ok: true, running: true });
    const created = await post("/api/game/backups/create", { kind: "manual", name: "n" });
    expect(created.body).toMatchObject({ ok: true, backup: { kind: "manual", name: "n", fileCount: 1 } });
    const list = await post("/api/game/backups/list");
    expect((list.body as { backups: unknown[] }).backups).toHaveLength(1);
    expect((await post("/api/game/backups/restore", { id: "../.." })).body).toMatchObject({ ok: false });
    expect((await post("/api/game/backups/list", { path: path.join(tmp, "nope") })).body).toEqual({ ok: false, error: ERR_NOT_FOUND });
  });
});
