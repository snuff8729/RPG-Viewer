import { describe, expect, it, vi } from "vitest";
import { MemoryFolder } from "../fs/folder";
import { LogTail, readLive } from "./tail";

const line = (seq: number, text?: string) =>
  JSON.stringify({ v: 1, seq, t: 0, run: 1, branch: 1, type: "message", text: text ?? "x" });

describe("LogTail", () => {
  it("reads only appended bytes", async () => {
    const f = new MemoryFolder({});
    await f.writeText("l", line(1) + "\n");
    const tail = new LogTail(f, "l");
    expect((await tail.poll()).records.map((r) => r.seq)).toEqual([1]);
    const spy = vi.spyOn(f, "readRange");
    f.appendText("l", line(2) + "\n");
    expect((await tail.poll()).records.map((r) => r.seq)).toEqual([2]);
    expect(spy).toHaveBeenCalledWith("l", expect.any(Number), expect.any(Number));
    expect(spy.mock.calls[0][1]).toBeGreaterThan(0);
    const r = await tail.poll();
    expect(r.changed).toBe(false);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("keeps partial lines and split UTF-8 for next poll", async () => {
    const f = new MemoryFolder({});
    const bytes = new TextEncoder().encode(line(1, "가나") + "\n");
    const cut = bytes.indexOf(0xea) + 1; // inside first "가"
    const dec = new TextDecoder("utf-8", { fatal: false });
    await f.writeText("l", "");
    const tail = new LogTail(f, "l");
    // write the raw bytes via a temporary override
    const store = new Uint8Array(bytes.slice(0, cut));
    let cur = store;
    vi.spyOn(f, "stat").mockImplementation(async () => ({ size: cur.length, lastModified: 1 }));
    vi.spyOn(f, "readRange").mockImplementation(async (_p, s, e) => cur.slice(s, e).buffer as ArrayBuffer);
    expect((await tail.poll()).records).toEqual([]);
    cur = bytes;
    const r = await tail.poll();
    expect(r.records).toHaveLength(1);
    expect((r.records[0] as { text: string }).text).toBe("가나");
    expect(dec.decode(bytes)).toContain("가나");
  });

  it("resets when file shrinks", async () => {
    const f = new MemoryFolder({});
    await f.writeText("l", line(1) + "\n" + line(2) + "\n");
    const tail = new LogTail(f, "l");
    await tail.poll();
    await f.writeText("l", line(7) + "\n");
    const r = await tail.poll();
    expect(r.reset).toBe(true);
    expect(r.records.map((x) => x.seq)).toEqual([7]);
  });

  it("returns no change when readRange yields null", async () => {
    const f = new MemoryFolder({});
    await f.writeText("l", line(1) + "\n");
    const tail = new LogTail(f, "l");
    const spy = vi.spyOn(f, "readRange").mockResolvedValueOnce(null);
    expect((await tail.poll()).changed).toBe(false);
    spy.mockRestore();
    expect((await tail.poll()).records.map((x) => x.seq)).toEqual([1]);
  });

  it("missing file is no change", async () => {
    const tail = new LogTail(new MemoryFolder({}), "nope");
    expect(await tail.poll()).toEqual({ records: [], badLines: 0, reset: false, changed: false });
  });
});

describe("readLive", () => {
  const snap = { v: 1, t: 0, pluginVersion: "1", run: 1, branch: 1, seq: 3, mapId: 1, x: 0, y: 0 };
  it("skips unchanged and tolerates bad json", async () => {
    const f = new MemoryFolder({});
    expect(await readLive(f, "s", null)).toEqual({ snapshot: null, modified: null, changed: false });
    await f.writeText("s", "{oops");
    const bad = await readLive(f, "s", null);
    expect(bad).toEqual({ snapshot: null, modified: null, changed: false });
    await f.writeText("s", JSON.stringify(snap));
    const ok = await readLive(f, "s", null);
    expect(ok.changed).toBe(true);
    expect(ok.snapshot?.seq).toBe(3);
    const spy = vi.spyOn(f, "readText");
    const again = await readLive(f, "s", ok.modified);
    expect(again.changed).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
});
