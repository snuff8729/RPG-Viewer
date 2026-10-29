import { describe, expect, it } from "vitest";
import { detectRemote, fetchSharedSession, REMOTE_KEY, startShare, untilText } from "./share";
import { isRemoteFolder, remoteWritable, ServerFolder, type FetchFn } from "./serverFolder";

function memStore() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, m };
}

const reply = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("detectRemote", () => {
  it("remembers remote=1 for later reloads of the same tab", () => {
    const s = memStore();
    expect(detectRemote("?popup=x", s)).toBe(false);
    expect(detectRemote("?remote=1", s)).toBe(true);
    expect(s.m.get(REMOTE_KEY)).toBe("1");
    expect(detectRemote("", s)).toBe(true);
    expect(detectRemote("", null)).toBe(false);
  });
});

describe("fetchSharedSession", () => {
  it("returns the shared session without a PC path", async () => {
    const f: FetchFn = async () => reply({ ok: true, id: "abc", title: "모험", engine: "MV", name: "My Game" });
    expect(await fetchSharedSession(f)).toEqual({ ok: true, session: { id: "abc", root: "", title: "모험", engine: "MV", name: "My Game" } });
  });
  it("passes the server's message when blocked", async () => {
    const f: FetchFn = async () => reply({ ok: false, error: "허용 기간이 끝났어요." }, 403);
    expect(await fetchSharedSession(f)).toEqual({ ok: false, error: "허용 기간이 끝났어요." });
    const down: FetchFn = async () => { throw new Error("offline"); };
    expect((await fetchSharedSession(down)).ok).toBe(false);
  });
});

describe("share control", () => {
  it("posts days and game path", async () => {
    const calls: { url: string; body: unknown }[] = [];
    const f: FetchFn = async (url, init) => {
      calls.push({ url, body: JSON.parse(String(init?.body)) });
      return reply({ ok: true, on: true, expired: false, expiresAt: 5, days: 7, gamePath: "C:/G", title: "모험", urls: ["http://a"] });
    };
    const r = await startShare(7, "C:/G", f);
    expect(calls).toEqual([{ url: "/api/share/start", body: { days: 7, gamePath: "C:/G" } }]);
    expect(r).toMatchObject({ ok: true, on: true, urls: ["http://a"] });
  });
  it("formats the expiry date", () => {
    expect(untilText(new Date(2026, 4, 3, 12).getTime())).toBe("5월 3일까지 허용");
  });
});

describe("remote (phone) ServerFolder", () => {
  it("writes only control.json and addons.json, never removes", async () => {
    const calls: { url: string; path: unknown }[] = [];
    const f: FetchFn = async (url, init) => { calls.push({ url, path: JSON.parse(String(init?.body)).path }); return reply({ ok: true }); };
    const folder = new ServerFolder({ id: "s", root: "", title: "", engine: "MV", name: "" }, f, { remote: true });
    expect(isRemoteFolder(folder)).toBe(true);
    expect(await folder.writeText("www/rpg-viewer/control.json", "{}")).toBe(true);
    expect(await folder.writeText("www/rpg-viewer/addons.json", "{}")).toBe(true);
    for (const p of ["a.txt", "www/rpg-viewer/live.json", "www/js/plugins.js", "rpg-viewer/control.json", "www/rpg-viewer/../rpg-viewer/control.json"]) {
      await expect(folder.writeText(p, "x")).rejects.toThrow();
    }
    await expect(folder.remove("www/rpg-viewer/control.json")).rejects.toThrow();
    expect(await folder.canWrite()).toBe(true);
    expect(await folder.requestWrite()).toBe(true);
    expect(calls).toEqual([
      { url: "/api/fs/write", path: "www/rpg-viewer/control.json" },
      { url: "/api/fs/write", path: "www/rpg-viewer/addons.json" },
    ]);
    expect(isRemoteFolder(new ServerFolder({ id: "s", root: "", title: "", engine: "MV", name: "" }, f))).toBe(false);
  });
  it("knows the allowed files per engine", () => {
    expect(remoteWritable("MZ", "rpg-viewer/control.json")).toBe(true);
    expect(remoteWritable("MZ", "rpg-viewer/addons.json")).toBe(true);
    expect(remoteWritable("MZ", "www/rpg-viewer/control.json")).toBe(false);
    expect(remoteWritable("MV", "rpg-viewer/addons.json")).toBe(false);
    expect(remoteWritable("", "rpg-viewer/control.json")).toBe(false);
  });
  it("does not try to reopen a lost session", async () => {
    const urls: string[] = [];
    const f: FetchFn = async (url) => { urls.push(url); return new Response(null, { status: 410 }); };
    const folder = new ServerFolder({ id: "s", root: "", title: "", engine: "", name: "" }, f, { remote: true });
    expect(await folder.readText("x")).toBeNull();
    expect(urls).toEqual(["/api/fs/read"]);
  });
});
