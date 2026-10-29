import fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFsMiddleware, FsSessions } from "../../scripts/fsApi";
import {
  createGateMiddleware, createShareMiddleware, fileShareStore, gateRequest, memoryShareStore, MSG_EXPIRED, MSG_NOT_LAN, MSG_OFF,
  MSG_READ_ONLY, MSG_STALE, parseCookies, remoteRouteAllowed, SHARE_COOKIE, shareCookie, shareUrls, ShareState, type ShareStore,
} from "../../scripts/lanShare";
import { isLoopbackIp, isPrivateIp, normalizeIp } from "../../scripts/netAddress";

const DAY = 24 * 60 * 60 * 1000;

let tmp: string;
let game: string;
let other: string;
beforeEach(() => {
  tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "rpgv-share-")));
  game = path.join(tmp, "My Game");
  other = path.join(tmp, "Other");
  touch("My Game/www/data/System.json", JSON.stringify({ gameTitle: "모험" }));
  touch("My Game/www/rpg-viewer/live.json", "{\"t\":1}");
  touch("Other/data/System.json", JSON.stringify({ gameTitle: "다른 게임" }));
});
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

function touch(rel: string, content: string): void {
  const p = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

/** 시계·토큰을 바꿔 끼운 상태 */
function makeShare(store: ShareStore = memoryShareStore(), sessions = new FsSessions()) {
  const clock = { t: 1_000_000 };
  let n = 0;
  const share = new ShareState({ sessions, store, now: () => clock.t, token: () => `token-${String(++n).padStart(16, "0")}` });
  return { share, clock, sessions, store };
}

describe("IP classification", () => {
  it("normalizes IPv4-mapped and zoned addresses", () => {
    expect(normalizeIp("::ffff:192.168.0.5")).toBe("192.168.0.5");
    expect(normalizeIp("FE80::1%eth0")).toBe("fe80::1");
    expect(normalizeIp(undefined)).toBe("");
  });
  it("knows loopback", () => {
    for (const ip of ["127.0.0.1", "127.8.9.10", "::1", "::ffff:127.0.0.1"]) expect(isLoopbackIp(ip)).toBe(true);
    for (const ip of ["192.168.0.2", "::", "", "localhost"]) expect(isLoopbackIp(ip)).toBe(false);
  });
  it("accepts only LAN ranges as private", () => {
    for (const ip of ["10.0.0.1", "172.16.0.1", "172.31.255.255", "192.168.1.20", "169.254.3.4", "fc00::1", "fd12:3456::1", "fe80::1", "::ffff:10.1.2.3"]) {
      expect(isPrivateIp(ip)).toBe(true);
    }
    for (const ip of ["8.8.8.8", "172.15.0.1", "172.32.0.1", "192.169.0.1", "127.0.0.1", "::1", "2001:db8::1", "fec0::1", "", "nope"]) {
      expect(isPrivateIp(ip)).toBe(false);
    }
  });
});

describe("cookies and routes", () => {
  it("parses cookies and writes an HttpOnly Lax cookie with Max-Age", () => {
    expect(parseCookies("a=1; rpgv_share=abc; b=2")).toEqual({ a: "1", rpgv_share: "abc", b: "2" });
    expect(parseCookies(undefined)).toEqual({});
    expect(shareCookie("tok", 60)).toBe("rpgv_share=tok; Max-Age=60; Path=/; HttpOnly; SameSite=Lax");
  });
  it("lets remote clients use pages and read APIs only", () => {
    for (const p of ["/", "/src/main.tsx", "/@vite/client", "/assets/x.js", "/api/fs/read", "/api/fs/range", "/api/fs/list", "/api/fs/stat", "/api/share/current"]) {
      expect(remoteRouteAllowed(p)).toBe(true);
    }
    for (const p of ["/api/fs/write", "/api/fs/remove", "/api/fs/open", "/api/fs/pick", "/api/fs/ping", "/api/game/launch", "/api/game/backups/list", "/api/share/start", "/api/share/stop", "/__open-in-editor"]) {
      expect(remoteRouteAllowed(p)).toBe(false);
    }
  });
});

describe("ShareState", () => {
  it("needs a game, then turns on with a token that expires after the chosen days", () => {
    const { share, clock } = makeShare();
    expect(share.start(7)).toEqual({ ok: false, error: expect.any(String) });
    expect(share.active()).toBe(false);
    expect(share.start(1, game)).toEqual({ ok: true });
    expect(share.token()).toBe("token-0000000000000001");
    expect(share.remainingSeconds()).toBe(DAY / 1000);
    expect(share.shared()).toMatchObject({ title: "모험", engine: "MV", name: "My Game" });
    clock.t += DAY;
    expect(share.active()).toBe(false);
    expect(share.expired()).toBe(true);
    expect(share.token()).toBeNull();
    expect(share.shared()).toBeNull();
  });

  it("reuses the token when turned on again while valid; new token after stop or expiry", () => {
    const { share, clock } = makeShare();
    share.start(7, game);
    const first = share.token();
    clock.t += DAY;
    share.start(30);
    expect(share.token()).toBe(first);
    expect(share.days()).toBe(30);
    expect(share.remainingSeconds()).toBe(30 * DAY / 1000);
    share.stop();
    expect(share.token()).toBeNull();
    expect(share.tokenMatches(first)).toBe(false);
    share.start(7);
    expect(share.token()).not.toBe(first);
    const second = share.token();
    clock.t += 8 * DAY;
    share.start(7);
    expect(share.token()).not.toBe(second);
  });

  it("rotate gives a new token and keeps the expiry; does nothing while off", () => {
    const { share } = makeShare();
    expect(share.rotate()).toBe(false);
    share.start(7, game);
    const before = { token: share.token(), at: share.expiresAt() };
    expect(share.rotate()).toBe(true);
    expect(share.token()).not.toBe(before.token);
    expect(share.expiresAt()).toBe(before.at);
    expect(share.tokenMatches(before.token)).toBe(false);
  });

  it("persists on/token/expiry/game across a server restart and reopens the game session", () => {
    const store = memoryShareStore();
    const a = makeShare(store);
    a.share.start(7, game);
    const token = a.share.token();
    expect(store.saved).toMatchObject({ on: true, token, days: 7, gamePath: game, expiresAt: 1_000_000 + 7 * DAY });

    const b = makeShare(store, new FsSessions());
    expect(b.share.token()).toBe(token);
    expect(b.share.gamePath()).toBe(game);
    const g = b.share.shared();
    expect(g).toMatchObject({ title: "모험" });
    expect(b.sessions.get(g?.id)).toBe(game);
    // 끄면 저장된 토큰도 사라진다
    b.share.stop();
    expect(store.saved).toMatchObject({ on: false, token: null, expiresAt: null, gamePath: game });
    expect(makeShare(store).share.token()).toBeNull();
  });

  it("ignores a broken or tampered file", () => {
    expect(makeShare(memoryShareStore({ on: true, token: "short", expiresAt: 9e15 })).share.active()).toBe(false);
    expect(makeShare(memoryShareStore({ on: true, token: "x".repeat(32) })).share.active()).toBe(false);
    expect(makeShare(memoryShareStore({ on: "yes" as unknown as boolean })).share.active()).toBe(false);
  });

  it("switches the shared game and keeps the previous one when the new path is bad", () => {
    const { share } = makeShare();
    share.start(7, game);
    const id1 = share.sharedId();
    expect(share.setGame(other)).toEqual({ ok: true });
    expect(share.shared()).toMatchObject({ title: "다른 게임" });
    expect(share.sharedId()).not.toBe(id1);
    expect(share.setGame(path.join(tmp, "nope")).ok).toBe(false);
    expect(share.shared()).toMatchObject({ title: "다른 게임" });
  });

  it("fileShareStore writes JSON under the given path and reads it back", () => {
    const file = path.join(tmp, "home", ".rpg-viewer", "share.json");
    const store = fileShareStore(file);
    expect(store.load()).toBeNull();
    const { share } = makeShare(store);
    share.start(7, game);
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toMatchObject({ on: true, gamePath: game });
    expect(makeShare(fileShareStore(file)).share.token()).toBe(share.token());
  });
});

describe("gateRequest", () => {
  const lan = "::ffff:192.168.0.20";

  it("passes loopback untouched and refuses non-LAN addresses", () => {
    const { share } = makeShare();
    share.start(7, game);
    expect(gateRequest({ ip: "127.0.0.1", url: "/api/game/launch" }, share)).toEqual({ kind: "local" });
    expect(gateRequest({ ip: "::1", url: "/" }, share)).toEqual({ kind: "local" });
    const tok = share.token() as string;
    expect(gateRequest({ ip: "8.8.8.8", url: `/?share=${tok}` }, share)).toEqual({ kind: "deny", message: MSG_NOT_LAN });
  });

  it("refuses LAN clients while off, without or with a wrong token", () => {
    const { share } = makeShare();
    expect(gateRequest({ ip: lan, url: "/" }, share)).toEqual({ kind: "deny", message: MSG_OFF });
    share.start(7, game);
    expect(gateRequest({ ip: lan, url: "/" }, share)).toEqual({ kind: "deny", message: MSG_OFF });
    expect(gateRequest({ ip: lan, url: "/?share=wrong" }, share)).toEqual({ kind: "deny", message: MSG_STALE });
    expect(gateRequest({ ip: lan, url: "/", cookie: `${SHARE_COOKIE}=wrong` }, share)).toEqual({ kind: "deny", message: MSG_STALE });
  });

  it("turns the QR token into a cookie with the remaining time and strips it from the address", () => {
    const { share, clock } = makeShare();
    share.start(7, game);
    clock.t += DAY;
    const tok = share.token() as string;
    const g = gateRequest({ ip: lan, method: "GET", url: `/?share=${tok}&remote=1` }, share);
    expect(g).toEqual({ kind: "remote", setCookie: shareCookie(tok, 6 * DAY / 1000), redirect: "/?remote=1" });
    // 쿠키로 오는 이후 요청
    expect(gateRequest({ ip: lan, url: "/src/main.tsx", cookie: `a=b; ${SHARE_COOKIE}=${tok}` }, share)).toEqual({ kind: "remote" });
    // 첫 화면은 쿠키 기간을 다시 맞춘다
    expect(gateRequest({ ip: lan, url: "/?remote=1", cookie: `${SHARE_COOKIE}=${tok}` }, share))
      .toEqual({ kind: "remote", setCookie: shareCookie(tok, 6 * DAY / 1000) });
  });

  it("refuses write and launcher routes even with a valid token", () => {
    const { share } = makeShare();
    share.start(7, game);
    const cookie = `${SHARE_COOKIE}=${share.token()}`;
    for (const url of ["/api/fs/write", "/api/fs/open", "/api/game/launch", "/api/share/start", "/__open-in-editor?file=x"]) {
      expect(gateRequest({ ip: lan, method: "POST", url, cookie }, share)).toEqual({ kind: "deny", message: MSG_READ_ONLY });
    }
    expect(gateRequest({ ip: lan, method: "POST", url: "/api/fs/read", cookie }, share)).toEqual({ kind: "remote" });
  });

  it("says the permission ran out after expiry, and the old token stops working after rotate", () => {
    const { share, clock } = makeShare();
    share.start(1, game);
    const tok = share.token() as string;
    share.rotate();
    expect(gateRequest({ ip: lan, url: "/", cookie: `${SHARE_COOKIE}=${tok}` }, share)).toEqual({ kind: "deny", message: MSG_STALE });
    clock.t += DAY;
    expect(gateRequest({ ip: lan, url: "/", cookie: `${SHARE_COOKIE}=${share.token()}` }, share)).toEqual({ kind: "deny", message: MSG_EXPIRED });
  });
});

describe("shareUrls", () => {
  it("lists the PC's LAN IPv4 addresses, real adapters first", () => {
    const nets = {
      "vEthernet (WSL)": [{ address: "172.20.0.1", family: "IPv4", internal: false }],
      "Loopback": [{ address: "127.0.0.1", family: "IPv4", internal: true }],
      "Wi-Fi": [
        { address: "fe80::1", family: "IPv6", internal: false },
        { address: "192.168.0.10", family: "IPv4", internal: false },
      ],
      "Public": [{ address: "8.8.8.8", family: "IPv4", internal: false }],
    } as unknown as NodeJS.Dict<os.NetworkInterfaceInfo[]>;
    expect(shareUrls(nets, 5173, "tok")).toEqual([
      "http://192.168.0.10:5173/?share=tok&remote=1#/play",
      "http://172.20.0.1:5173/?share=tok&remote=1#/play",
    ]);
  });
});

// ── 미들웨어 묶음(문지기 → 공유 API → 폴더 API)을 가짜 요청으로 ──

interface Reply { status: number; headers: Record<string, string>; body: string; next: boolean }

function chain(share: ShareState, sessions: FsSessions) {
  const gate = createGateMiddleware(share);
  const api = createShareMiddleware(share, () => ({ "Wi-Fi": [{ address: "192.168.0.10", family: "IPv4", internal: false } as os.NetworkInterfaceInfo] }));
  const fsMw = createFsMiddleware({ sessions, remote: share });
  return async (opts: { ip: string; method: string; url: string; host: string; origin?: string; cookie?: string; body?: unknown }): Promise<Reply> => {
    const req = Readable.from(opts.body === undefined ? [] : [Buffer.from(JSON.stringify(opts.body))]) as unknown as IncomingMessage;
    const headers: Record<string, string> = { host: opts.host };
    if (opts.origin) headers.origin = opts.origin;
    if (opts.cookie) headers.cookie = opts.cookie;
    Object.assign(req, { method: opts.method, url: opts.url, headers, socket: { remoteAddress: opts.ip, localPort: 5173 } });
    const out: Reply = { status: 200, headers: {}, body: "", next: false };
    const res = {
      set statusCode(s: number) { out.status = s; },
      get statusCode() { return out.status; },
      setHeader(k: string, v: string) { out.headers[k.toLowerCase()] = v; },
      end(t?: string | Buffer) { out.body = t === undefined ? "" : t.toString(); },
    } as unknown as ServerResponse;
    let step = 0;
    const steps = [
      (n: () => void) => gate(req, res, n),
      (n: () => void) => api(req, res, n),
      (n: () => void) => fsMw(req, res, n),
    ];
    const run = async (): Promise<void> => {
      if (step >= steps.length) { out.next = true; return; }
      let called = false;
      await steps[step++](() => { called = true; });
      if (called) await run();
    };
    await run();
    return out;
  };
}

describe("share API and remote file access", () => {
  const pc = { ip: "127.0.0.1", host: "localhost:5173", origin: "http://localhost:5173" };
  const phone = { ip: "192.168.0.20", host: "192.168.0.10:5173", origin: "http://192.168.0.10:5173" };

  it("start/status/current/stop, and phones read only the shared game", async () => {
    const sessions = new FsSessions();
    const { share } = makeShare(memoryShareStore(), sessions);
    const call = chain(share, sessions);

    // 꺼져 있으면 휴대폰은 첫 화면부터 막힌다
    const off = await call({ ...phone, method: "GET", url: "/?remote=1" });
    expect(off.status).toBe(403);
    expect(off.body).toBe(MSG_OFF);

    const started = JSON.parse((await call({ ...pc, method: "POST", url: "/api/share/start", body: { days: 7, gamePath: game } })).body);
    expect(started).toMatchObject({ ok: true, on: true, days: 7, title: "모험" });
    expect(started.urls).toEqual([`http://192.168.0.10:5173/?share=${share.token()}&remote=1#/play`]);
    expect(JSON.parse((await call({ ...pc, method: "GET", url: "/api/share/status" })).body)).toMatchObject({ on: true });

    // 휴대폰이 공유 API를 켜고 끌 수는 없다(토큰이 있어도)
    const cookie = `${SHARE_COOKIE}=${share.token()}`;
    expect((await call({ ...phone, cookie, method: "POST", url: "/api/share/stop", body: {} })).status).toBe(403);

    // QR 주소 → 쿠키 + 주소 정리
    const first = await call({ ...phone, method: "GET", url: `/?share=${share.token()}&remote=1` });
    expect(first.status).toBe(302);
    expect(first.headers.location).toBe("/?remote=1");
    expect(first.headers["set-cookie"]).toContain("HttpOnly");
    const page = await call({ ...phone, cookie, method: "GET", url: "/?remote=1" });
    expect(page.next).toBe(true);

    const cur = JSON.parse((await call({ ...phone, cookie, method: "GET", url: "/api/share/current" })).body);
    expect(cur).toEqual({ ok: true, id: share.sharedId(), title: "모험", engine: "MV", name: "My Game" });

    const read = await call({ ...phone, cookie, method: "POST", url: "/api/fs/read", body: { id: cur.id, path: "www/rpg-viewer/live.json" } });
    expect(read.status).toBe(200);
    expect(read.body).toBe("{\"t\":1}");

    // 쓰기·열기·실행은 막힌다
    for (const [url, body] of [
      ["/api/fs/write", { id: cur.id, path: "www/rpg-viewer/x.json", text: "1" }],
      ["/api/fs/remove", { id: cur.id, path: "www/rpg-viewer/live.json" }],
      ["/api/fs/open", { path: other }],
      ["/api/game/launch", { path: game }],
    ] as const) {
      expect((await call({ ...phone, cookie, method: "POST", url, body })).status).toBe(403);
    }
    expect(fs.existsSync(path.join(game, "www/rpg-viewer/x.json"))).toBe(false);
    expect(fs.existsSync(path.join(game, "www/rpg-viewer/live.json"))).toBe(true);

    // 다른 세션(PC가 연 다른 게임)은 못 읽는다
    const otherId = sessions.open(other);
    expect(otherId.ok && (await call({ ...phone, cookie, method: "POST", url: "/api/fs/read", body: { id: otherId.id, path: "data/System.json" } })).status).toBe(403);

    // Host를 localhost로 꾸며도 소켓 주소로 판정한다
    const spoof = await call({ ...phone, host: "localhost:5173", origin: "http://localhost:5173", cookie, method: "POST", url: "/api/fs/write", body: { id: cur.id, path: "a.txt", text: "x" } });
    expect(spoof.status).toBe(403);

    // PC는 그대로 쓸 수 있다
    const pcWrite = await call({ ...pc, method: "POST", url: "/api/fs/write", body: { id: cur.id, path: "www/rpg-viewer/pc.json", text: "1" } });
    expect(JSON.parse(pcWrite.body)).toEqual({ ok: true });

    // 끄면 바로 막힌다
    await call({ ...pc, method: "POST", url: "/api/share/stop", body: {} });
    const after = await call({ ...phone, cookie, method: "POST", url: "/api/fs/read", body: { id: cur.id, path: "www/rpg-viewer/live.json" } });
    expect(after.status).toBe(403);
    expect(JSON.parse(after.body).error).toBe(MSG_OFF);
  });

  it("game follows the PC only while on", async () => {
    const sessions = new FsSessions();
    const { share } = makeShare(memoryShareStore(), sessions);
    const call = chain(share, sessions);
    await call({ ...pc, method: "POST", url: "/api/share/game", body: { gamePath: other } });
    expect(share.gamePath()).toBeNull();
    await call({ ...pc, method: "POST", url: "/api/share/start", body: { days: 1, gamePath: game } });
    const r = JSON.parse((await call({ ...pc, method: "POST", url: "/api/share/game", body: { gamePath: other } })).body);
    expect(r).toMatchObject({ ok: true, on: true, title: "다른 게임" });
    const bad = JSON.parse((await call({ ...pc, method: "POST", url: "/api/share/game", body: { gamePath: path.join(tmp, "nope") } })).body);
    expect(bad.ok).toBe(false);
    expect(share.shared()).toMatchObject({ title: "다른 게임" });
  });

  it("share control needs this PC's own origin", async () => {
    const sessions = new FsSessions();
    const { share } = makeShare(memoryShareStore(), sessions);
    const call = chain(share, sessions);
    const evil = await call({ ...pc, origin: "http://evil.example", method: "POST", url: "/api/share/start", body: { days: 7, gamePath: game } });
    expect(evil.status).toBe(403);
    expect(share.active()).toBe(false);
  });
});
