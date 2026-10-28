import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createFsMiddleware, createWindowsPicker, encodePowerShell, isInside, parsePickerOutput, pickerCommand, PICKER_SCRIPT,
  resolveInRoot, safeSegments, type ExecFileFn, type PickFolder,
} from "../../scripts/fsApi";
import { AssetStore } from "../../src/core/assets/assets";
import { loadGame } from "../../src/core/loader/loadGame";
import { ServerFolder, openFolderOnServer, pickFolderOnServer, type FetchFn } from "../../src/app/serverFolder";

let tmp: string;
let game: string;
beforeEach(() => {
  tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "rpgv-fs-")));
  game = path.join(tmp, "My Game");
  touch("My Game/www/data/System.json", JSON.stringify({ gameTitle: "모험" }));
  touch("My Game/www/img/pictures/Pic.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 255]));
  touch("My Game/Game.exe", "");
  touch("secret.txt", "outside");
});
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

function touch(rel: string, content: string | Buffer): string {
  const p = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  return p;
}

describe("path scoping", () => {
  it("accepts plain relative paths", () => {
    expect(safeSegments("www/data/System.json")).toEqual(["www", "data", "System.json"]);
    expect(safeSegments("./www//data/")).toEqual(["www", "data"]);
    expect(safeSegments("")).toEqual([]);
  });

  it("rejects traversal, absolute paths, drives, backslashes and dotty names", () => {
    for (const bad of ["../x", "www/../../x", "/etc/passwd", "C:/Windows", "C:", "www\\..\\x", "a/.../b", "a./b", "a /b", "x\0y", 42, null]) {
      expect(safeSegments(bad)).toBeNull();
    }
  });

  it("isInside compares whole segments", () => {
    expect(isInside(game, game)).toBe(true);
    expect(isInside(game, path.join(game, "www"))).toBe(true);
    expect(isInside(game, `${game}2`)).toBe(false);
    expect(isInside(game, tmp)).toBe(false);
  });

  it("resolves case-insensitively inside the root", () => {
    const r = resolveInRoot(game, "WWW/Data/system.json");
    expect(r.ok && r.exists).toBe(true);
  });

  it("rejects symlinks that escape the root", () => {
    try {
      fs.symlinkSync(tmp, path.join(game, "escape"), "junction");
    } catch {
      return; // 링크를 만들 수 없는 환경
    }
    expect(resolveInRoot(game, "escape/secret.txt")).toEqual({ ok: false });
    expect(resolveInRoot(game, "escape/new/file.txt")).toEqual({ ok: false });
  });
});

// ── 진짜 HTTP 서버 ──

interface Server { port: number; close(): Promise<void> }

async function startServer(pick: PickFolder | null = null): Promise<Server> {
  const mw = createFsMiddleware({ pick });
  const srv = http.createServer((req, res) => {
    void mw(req, res, () => { res.statusCode = 404; res.end("next"); });
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
  const port = (srv.address() as AddressInfo).port;
  return { port, close: () => new Promise((r) => srv.close(() => r())) };
}

interface Reply { status: number; type: string; body: Buffer }

function request(port: number, method: string, url: string, body?: string, headers: Record<string, string> = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const host = `localhost:${port}`;
    const req = http.request({
      host: "127.0.0.1", port, method, path: url,
      headers: { host, origin: `http://${host}`, "content-type": "application/json", ...headers },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, type: String(res.headers["content-type"] ?? ""), body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

/** 브라우저 fetch 흉내: 상대 URL을 테스트 서버로 보낸다(같은 출처 헤더). */
function fetchVia(port: number, log?: string[]): FetchFn {
  return async (input, init) => {
    log?.push(input);
    const r = await request(port, init?.method ?? "GET", input, init?.body as string | undefined);
    return new Response(r.status === 204 ? null : new Uint8Array(r.body), { status: r.status, headers: { "content-type": r.type } });
  };
}

const json = (r: Reply) => JSON.parse(r.body.toString("utf8")) as Record<string, unknown>;

describe("fs endpoints", () => {
  let srv: Server;
  afterEach(async () => { await srv.close(); });

  async function open(p = game): Promise<string> {
    const r = json(await request(srv.port, "POST", "/api/fs/open", JSON.stringify({ path: p })));
    expect(r.ok).toBe(true);
    return r.id as string;
  }

  it("opens a game from its root or www folder and reports title", async () => {
    srv = await startServer();
    const r = json(await request(srv.port, "POST", "/api/fs/open", JSON.stringify({ path: path.join(game, "www") })));
    expect(r).toMatchObject({ ok: true, root: game, title: "모험", engine: "MV", name: "My Game" });
    const bad = json(await request(srv.port, "POST", "/api/fs/open", JSON.stringify({ path: tmp })));
    expect(bad.ok).toBe(false);
  });

  it("reads bytes, lists, stats, writes and removes inside the root", async () => {
    srv = await startServer();
    const id = await open();
    const call = (route: string, body: object) => request(srv.port, "POST", `/api/fs/${route}`, JSON.stringify({ id, ...body }));

    const png = await call("read", { path: "www/img/pictures/pic.png" });
    expect(png.status).toBe(200);
    expect(png.type).toBe("application/octet-stream");
    expect([...png.body]).toEqual([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 255]);

    expect((await call("read", { path: "www/nope.txt" })).status).toBe(404);
    expect(json(await call("list", { path: "www" })).names).toEqual(expect.arrayContaining(["data", "img"]));
    expect(json(await call("list", { path: "missing" })).names).toEqual([]);
    expect(json(await call("stat", { path: "www/img/pictures/Pic.png" })).stat).toMatchObject({ size: 8 });
    expect(json(await call("stat", { path: "www" })).stat).toBeNull();

    const range = await call("range", { path: "www/img/pictures/Pic.png", start: 2, end: 100 });
    expect([...range.body]).toEqual([0x4e, 0x47, 0, 1, 2, 255]);

    expect(json(await call("write", { path: "www/rpg-viewer/control.json", text: "{\"a\":\"한글\"}" })).ok).toBe(true);
    expect(fs.readFileSync(path.join(game, "www/rpg-viewer/control.json"), "utf8")).toBe("{\"a\":\"한글\"}");
    expect(json(await call("write", { path: "www/rpg-viewer/control.json", text: "2" })).ok).toBe(true);
    expect(fs.readFileSync(path.join(game, "www/rpg-viewer/control.json"), "utf8")).toBe("2");
    expect(fs.readdirSync(path.join(game, "www/rpg-viewer"))).toEqual(["control.json"]);

    expect(json(await call("remove", { path: "www/rpg-viewer/control.json" })).ok).toBe(true);
    expect(fs.existsSync(path.join(game, "www/rpg-viewer/control.json"))).toBe(false);
    expect(json(await call("remove", { path: "www" })).ok).toBe(false);
  });

  it("rejects escapes, unknown sessions and foreign origins", async () => {
    srv = await startServer();
    const id = await open();
    for (const p of ["../secret.txt", "www/../../secret.txt", path.join(tmp, "secret.txt"), "C:/Windows/win.ini"]) {
      const r = await request(srv.port, "POST", "/api/fs/read", JSON.stringify({ id, path: p }));
      expect(r.status).toBe(400);
      const w = await request(srv.port, "POST", "/api/fs/write", JSON.stringify({ id, path: p, text: "x" }));
      expect(w.status).toBe(400);
    }
    expect(fs.readFileSync(path.join(tmp, "secret.txt"), "utf8")).toBe("outside");
    expect((await request(srv.port, "POST", "/api/fs/read", JSON.stringify({ id: "nope", path: "www/data/System.json" }))).status).toBe(410);
    const evil = await request(srv.port, "POST", "/api/fs/read", JSON.stringify({ id, path: "www/data/System.json" }), { origin: "http://evil.example" });
    expect(evil.status).toBe(403);
    expect((await request(srv.port, "GET", "/api/fs/read")).status).toBe(405);
  });

  it("pick: opens the chosen folder, passes cancel and picker failure through", async () => {
    let next: Awaited<ReturnType<PickFolder>> = { path: path.join(game, "www") };
    srv = await startServer(async () => next);
    expect(json(await request(srv.port, "GET", "/api/fs/ping"))).toEqual({ ok: true, pick: true });
    const fetchFn = fetchVia(srv.port);
    const r = await pickFolderOnServer(fetchFn);
    expect(r.ok && "session" in r && r.session.root).toBe(game);
    next = { cancelled: true };
    expect(await pickFolderOnServer(fetchFn)).toEqual({ ok: true, cancelled: true });
    next = { error: "boom" };
    expect(await pickFolderOnServer(fetchFn)).toEqual({ ok: false, error: "boom", pickerFailed: true });
  });

  it("ServerFolder reads, writes and re-opens a lost session", async () => {
    srv = await startServer();
    const log: string[] = [];
    const fetchFn = fetchVia(srv.port, log);
    const opened = await openFolderOnServer(game, fetchFn);
    if (!opened.ok || !("session" in opened)) throw new Error("open failed");
    const folder = new ServerFolder(opened.session, fetchFn);
    expect(await folder.readText("www/data/System.json")).toContain("모험");
    expect(new Uint8Array((await folder.readBinary("www/img/pictures/Pic.png"))!)[7]).toBe(255);
    expect(await folder.readText("www/none.json")).toBeNull();
    expect(await folder.list("www/img")).toEqual(["pictures"]);
    expect(await folder.writeText("www/js/plugins/X.js", "// x")).toBe(true);
    expect((await folder.stat("www/js/plugins/X.js"))?.size).toBe(4);
    expect(new TextDecoder().decode((await folder.readRange("www/js/plugins/X.js", 3, 4))!)).toBe("x");
    expect(await folder.remove("www/js/plugins/X.js")).toBe(true);
    expect(await folder.readText("../secret.txt")).toBeNull();
    expect(await folder.canWrite()).toBe(true);

    // 서버 재시작: 세션이 사라져도 같은 경로로 다시 열고 이어 간다.
    await srv.close();
    srv = await startServer();
    const again = new ServerFolder(opened.session, fetchVia(srv.port, log));
    log.length = 0;
    expect(await again.readText("www/data/System.json")).toContain("모험");
    expect(log).toEqual(["/api/fs/read", "/api/fs/open", "/api/fs/read"]);
  });
});

describe("loading a game through the server", () => {
  it("loads the MV fixture via ServerFolder", async () => {
    const dest = path.join(tmp, "fixture-mv");
    fs.cpSync(path.resolve(__dirname, "../fixtures/sample-mv"), dest, { recursive: true });
    const srv = await startServer();
    try {
      const fetchFn = fetchVia(srv.port);
      const opened = await openFolderOnServer(dest, fetchFn);
      if (!opened.ok || !("session" in opened)) throw new Error("open failed");
      const r = await loadGame(new ServerFolder(opened.session, fetchFn));
      expect(r.ok).toBe(true);
    } finally {
      await srv.close();
    }
  });
});

describe("image previews through the server", () => {
  it("loads pictures and faces with awkward names, mixed encryption and NFD names", async () => {
    const dest = path.join(tmp, "fixture-mz");
    fs.cpSync(path.resolve(__dirname, "../fixtures/sample-mz"), dest, { recursive: true });
    const png = fs.readFileSync(path.join(dest, "img/faces/actor1.png"));
    const enc = fs.readFileSync(path.join(dest, "img/faces/People1.png_"));
    const names = ["!Door", "$Big", "日本語の絵", "한글 그림", "ＦＵＬＬ", "a#b", "50%", "a+b", "a&b", "[x]", "(y)", "sp ace", "sub/inner", "Sub2/深い/x", "dot.name", "x'y"];
    for (const n of names) touch(`fixture-mz/img/pictures/${n}.png`, png);
    touch("fixture-mz/img/pictures/EncAsPng.png", enc); // 암호문인데 .png
    touch("fixture-mz/img/pictures/Late.rpgmvp", enc); // 다른 암호 확장자
    touch(`fixture-mz/img/pictures/${"가방".normalize("NFD")}.png`, png); // macOS에서 온 이름
    touch("fixture-mz/img/pictures/Big.png", Buffer.concat([png, Buffer.alloc(8 * 1024 * 1024)]));

    const srv = await startServer();
    try {
      const fetchFn = fetchVia(srv.port);
      const opened = await openFolderOnServer(dest, fetchFn);
      if (!opened.ok || !("session" in opened)) throw new Error("open failed");
      const folder = new ServerFolder(opened.session, fetchFn);
      const r = await loadGame(folder);
      if (!r.ok) throw new Error("load failed");
      const store = new AssetStore(folder, r.data);
      const sig = async (kind: "faces" | "pictures", n: string) => {
        const b = await store.load(kind, n);
        return b ? [...new Uint8Array(await b.arrayBuffer()).slice(0, 4)] : null;
      };
      const PNG = [0x89, 0x50, 0x4e, 0x47];
      const all = [...names, "EncAsPng", "Late", "가방", "Big", "SUB/INNER"];
      const got = await Promise.all(all.map((n) => sig("pictures", n)));
      expect(Object.fromEntries(all.map((n, i) => [n, got[i]]))).toEqual(Object.fromEntries(all.map((n) => [n, PNG])));
      expect(await sig("faces", "People1")).toEqual(PNG);
      expect(await sig("faces", "Actor1")).toEqual(PNG);
      expect(await sig("pictures", "village_map")).toEqual(PNG);
      expect(await sig("pictures", "nope")).toBeNull();
    } finally {
      await srv.close();
    }
  });
});

describe("ServerFolder with a fake fetch", () => {
  it("returns null/[]/false on network errors instead of throwing", async () => {
    const fetchFn: FetchFn = async () => { throw new Error("offline"); };
    const f = new ServerFolder({ id: "x", root: "C:/g", title: "", engine: "MV", name: "g" }, fetchFn);
    expect(await f.readText("a")).toBeNull();
    expect(await f.readBinary("a")).toBeNull();
    expect(await f.list("")).toEqual([]);
    expect(await f.stat("a")).toBeNull();
    expect(await f.writeText("a", "b")).toBe(false);
    expect(await f.remove("a")).toBe(false);
  });

  it("sends the session id and path in a POST body, never in the URL", async () => {
    const seen: { url: string; body: unknown }[] = [];
    const fetchFn: FetchFn = async (url, init) => {
      seen.push({ url, body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ ok: true, names: ["a"] }), { status: 200 });
    };
    const f = new ServerFolder({ id: "sid", root: "C:/g", title: "", engine: "MV", name: "g" }, fetchFn);
    expect(await f.list("www")).toEqual(["a"]);
    expect(seen).toEqual([{ url: "/api/fs/list", body: { path: "www", id: "sid" } }]);
  });
});

describe("native picker command", () => {
  it("runs a fixed encoded script with no user input", async () => {
    const calls: { file: string; args: string[] }[] = [];
    const exec: ExecFileFn = async (file, args) => {
      calls.push({ file, args });
      return { stdout: "\uFEFFnoise\r\nRPGV-PICK:C:\\Games\\내 게임\r\n" };
    };
    const pick = createWindowsPicker(exec);
    expect(await pick()).toEqual({ path: "C:\\Games\\내 게임" });
    expect(await pick()).toEqual({ path: "C:\\Games\\내 게임" });
    expect(calls[0]).toEqual(pickerCommand());
    expect(calls[0]).toEqual(calls[1]);
    expect(calls[0].file).toBe("powershell.exe");
    expect(calls[0].args).toContain("-STA");
    const encoded = calls[0].args[calls[0].args.length - 1];
    expect(encoded).toBe(encodePowerShell(PICKER_SCRIPT));
    expect(Buffer.from(encoded, "base64").toString("utf16le")).toBe(PICKER_SCRIPT);
  });

  it("parses cancel and failure", async () => {
    expect(parsePickerOutput("RPGV-CANCEL")).toEqual({ cancelled: true });
    expect(parsePickerOutput("")).toEqual({ error: expect.any(String) });
    const failing = createWindowsPicker(async () => { throw new Error("no powershell"); });
    expect(await failing()).toEqual({ error: expect.any(String) });
  });
});
