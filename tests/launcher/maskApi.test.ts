import fs from "node:fs";
import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatPluginsJs } from "@/core/live/installer";
import { tokenOf } from "@/core/mask";
import { MASK_VOCABULARY } from "@/core/mask/keywords";
import { FsSessions, type RemoteAccess } from "../../scripts/fsApi";
import { createMaskMiddleware, ERR_INSIDE_GAME, type MaskApiDeps } from "../../scripts/maskApi";
import { maskedFolderName } from "../../scripts/maskWork";

const KW = MASK_VOCABULARY.find((w) => /^[a-z]{4,}$/.test(w))!;
const work = () => import("../../scripts/maskWork").then((m) => m.work);
const NOW = new Date(2026, 9, 29, 8, 5, 3);

let tmp: string, game: string, outRoot: string;
beforeEach(() => {
  tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "rpgv-maskapi-")));
  game = path.join(tmp, `アリス ${KW} Game`);
  outRoot = path.join(tmp, "Masked");
  const put = (rel: string, text: string) => {
    const p = path.join(game, ...rel.split("/"));
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text, "utf8");
  };
  put("data/System.json", JSON.stringify({ gameTitle: "アリスの冒険", switches: [], variables: [] }));
  put("data/MapInfos.json", '[null,{"id":1,"name":"アリスの部屋","parentId":0}]');
  put("data/Map001.json", JSON.stringify({ width: 1, height: 1, data: [], events: [] }));
  put("js/plugins.js", formatPluginsJs([{ name: "アリス_Core", status: true, description: "", parameters: {} }]));
  put("js/plugins/アリス_Core.js", "var who = 'ボブ';\n");
});
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

interface Server { port: number; sessions: FsSessions; close(): Promise<void> }

async function start(extra: Partial<MaskApiDeps> = {}): Promise<Server> {
  const sessions = new FsSessions();
  const mw = createMaskMiddleware({ sessions, outRoot: () => outRoot, now: () => NOW, work, ...extra });
  const srv = http.createServer((req, res) => { void mw(req, res, () => { res.statusCode = 404; res.end("next"); }); });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
  return { port: (srv.address() as AddressInfo).port, sessions, close: () => new Promise((r) => srv.close(() => r())) };
}

function post(port: number, route: string, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; json: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const host = `localhost:${port}`;
    const req = http.request({
      host: "127.0.0.1", port, method: "POST", path: `/api/mask/${route}`,
      headers: { host, origin: `http://${host}`, "content-type": "application/json", ...headers },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, json: JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown> }));
    });
    req.on("error", reject);
    req.end(JSON.stringify(body));
  });
}

const sessionId = (s: Server) => {
  const r = s.sessions.open(game);
  if (!r.ok) throw new Error(r.error);
  return r.id;
};

describe("maskedFolderName", () => {
  it("masks the game folder name and appends a timestamp", () => {
    const name = maskedFolderName(game, NOW);
    expect(name).toBe(`${tokenOf(`アリス ${KW}`)} Game-20261029-080503`);
    expect(name).not.toMatch(/[぀-ヿ一-鿿]/);
    expect(name.toLowerCase()).not.toContain(KW);
    expect(maskedFolderName(path.join(tmp, "..."), NOW)).toMatch(/^game-/);
  });
});

describe("/api/mask", () => {
  let srv: Server;
  afterEach(async () => { await srv.close(); });

  it("exports a masked mirror under the output root without leaking the folder name or touching the game", async () => {
    srv = await start();
    const before = fs.readdirSync(game, { recursive: true }).length;
    const r = await post(srv.port, "export", { id: sessionId(srv), note: "アリスの部屋 에서 멈춰요" });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, hits: 0 });
    const out = r.json.path as string;
    expect(path.dirname(out)).toBe(outRoot);
    expect(path.basename(out)).toBe(maskedFolderName(game, NOW));
    expect(out.slice(tmp.length)).not.toMatch(/[぀-ヿ一-鿿]/);
    expect(r.json.files).toBeGreaterThan(0);
    expect(r.json.replaced).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(out, "AI-README.md"))).toBe(true);
    expect(fs.readFileSync(path.join(out, "REPORT.md"), "utf8")).toContain(tokenOf("アリスの部屋"));
    expect(fs.readdirSync(game, { recursive: true }).length).toBe(before);
    // 같은 시각이면 새 폴더(-2)
    const again = await post(srv.port, "export", { id: sessionId(srv), note: "" });
    expect(again.json.path).toBe(`${out}-2`);
  });

  it("restores tokens with the open game and counts unknown ones", async () => {
    srv = await start();
    const id = sessionId(srv);
    const r = await post(srv.port, "unmask", { id, text: `${tokenOf("ボブ")} / ${tokenOf("アリスの部屋")} / T_00000000000000` });
    expect(r.json).toEqual({ ok: true, text: "ボブ / アリスの部屋 / T_00000000000000", replaced: 2, unknown: 1 });
  });

  it("refuses an output root inside the game folder", async () => {
    outRoot = path.join(game, "masked");
    srv = await start();
    const r = await post(srv.port, "export", { id: sessionId(srv), note: "" });
    expect(r.json).toEqual({ ok: false, error: ERR_INSIDE_GAME });
    expect(fs.existsSync(outRoot)).toBe(false);
  });

  it("rejects unknown sessions, foreign origins and phone (remote) requests", async () => {
    srv = await start();
    expect((await post(srv.port, "export", { id: "nope" })).status).toBe(410);
    const id = sessionId(srv);
    expect((await post(srv.port, "unmask", { id, text: "x" }, { origin: "http://evil.example" })).status).toBe(403);
    expect((await post(srv.port, "unmask", { id, text: "x" }, { host: "evil.example" })).status).toBe(403);
    await srv.close();
    const remote: RemoteAccess = { isRemote: () => true, sharedId: () => id };
    srv = await start({ remote });
    expect((await post(srv.port, "export", { id: sessionId(srv) })).status).toBe(403);
    expect(fs.existsSync(outRoot)).toBe(false);
  });

  it("rejects requests from other machines by socket address", async () => {
    const sessions = new FsSessions();
    const mw = createMaskMiddleware({ sessions, outRoot: () => outRoot, work });
    const r = sessions.open(game);
    let status = 0;
    const req = { url: "/api/mask/export", method: "POST", headers: { host: "localhost:5173", origin: "http://localhost:5173" }, socket: { remoteAddress: "192.168.0.20" } };
    const res = { statusCode: 0, setHeader() {}, end() { status = this.statusCode; } };
    await mw(req as unknown as IncomingMessage, res as unknown as ServerResponse, () => {});
    expect(r.ok).toBe(true);
    expect(status).toBe(403);
    expect(fs.existsSync(outRoot)).toBe(false);
  });
});
