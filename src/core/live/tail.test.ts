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
    const failed = await tail.poll();
    expect(failed.changed).toBe(false);
    expect(failed.more).toBe(false);
    expect(failed.eof).toBe(false); // 읽기 실패는 끝까지 읽은 게 아니다
    spy.mockRestore();
    const ok = await tail.poll();
    expect(ok.records.map((x) => x.seq)).toEqual([1]);
    expect(ok.eof).toBe(true);
    expect((await tail.poll()).eof).toBe(true); // 바뀐 것 없음 = 끝
  });

  it("throwing stat is not eof", async () => {
    const f = new MemoryFolder({});
    vi.spyOn(f, "stat").mockRejectedValueOnce(new Error("x"));
    expect((await new LogTail(f, "l").poll()).eof).toBe(false);
  });

  it("missing file is no change", async () => {
    const tail = new LogTail(new MemoryFolder({}), "nope");
    expect(await tail.poll()).toEqual({ records: [], badLines: 0, reset: false, changed: false, more: false, eof: true });
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
describe("LogTail fixes", () => {
  it("overlapping polls share one read", async () => {
    const f = new MemoryFolder({});
    await f.writeText("l", line(1) + "\n");
    const tail = new LogTail(f, "l");
    const orig = f.readRange.bind(f);
    const spy = vi.spyOn(f, "readRange").mockImplementation(async (p, a, b) => {
      await new Promise((r) => setTimeout(r, 10));
      return orig(p, a, b);
    });
    const [a, b] = await Promise.all([tail.poll(), tail.poll()]);
    expect(a).toBe(b);
    expect(a.records.map((r) => r.seq)).toEqual([1]);
    expect(spy).toHaveBeenCalledTimes(1);
    expect((await tail.poll()).reset).toBe(false);
  });

  it("failed read after shrink keeps reset for next success", async () => {
    const f = new MemoryFolder({});
    await f.writeText("l", line(1) + "\n" + line(2) + "\n");
    const tail = new LogTail(f, "l");
    await tail.poll();
    await f.writeText("l", line(9) + "\n");
    const spy = vi.spyOn(f, "readRange").mockResolvedValueOnce(null);
    expect((await tail.poll()).changed).toBe(false);
    spy.mockRestore();
    const r = await tail.poll();
    expect(r.reset).toBe(true);
    expect(r.records.map((x) => x.seq)).toEqual([9]);
  });

  it("chunks large backlogs and reports more", async () => {
    const f = new MemoryFolder({});
    const n = line(1).length + 1;
    await f.writeText("l", [1, 2, 3].map((i) => line(i)).join("\n") + "\n");
    const tail = new LogTail(f, "l", { chunkBytes: n + 3 });
    const seqs: number[] = [];
    let more = true, guard = 0, firstMore: boolean | null = null;
    while (more && guard++ < 20) {
      const r = await tail.poll();
      if (firstMore === null) firstMore = r.more;
      seqs.push(...r.records.map((x) => x.seq));
      more = r.more;
    }
    expect(firstMore).toBe(true);
    expect(seqs).toEqual([1, 2, 3]);
    expect(more).toBe(false);
  });

  it("handles CRLF lines", async () => {
    const f = new MemoryFolder({});
    await f.writeText("l", line(1) + "\r\n" + line(2) + "\r\n");
    const r = await new LogTail(f, "l").poll();
    expect(r.records.map((x) => x.seq)).toEqual([1, 2]);
    expect(r.badLines).toBe(0);
  });

  it("shrink drops pending carry; empty reset is changed", async () => {
    const f = new MemoryFolder({});
    await f.writeText("l", line(1) + "\n" + '{"v":1,"seq":2');
    const tail = new LogTail(f, "l");
    expect((await tail.poll()).records).toHaveLength(1);
    await f.writeText("l", "");
    expect(await tail.poll()).toMatchObject({ reset: true, changed: true, records: [] });
    await f.writeText("l", line(5) + "\n");
    const r = await tail.poll();
    expect(r.records.map((x) => x.seq)).toEqual([5]);
    expect(r.badLines).toBe(0);
  });
});

describe("readLive shape", () => {
  it("rejects wrong-shape snapshots", async () => {
    const f = new MemoryFolder({});
    for (const bad of ["[]", "null", "{}", '{"v":2,"t":0,"mapId":1}', '{"v":1,"t":"x","mapId":1}', '{"v":1,"t":0}']) {
      await f.writeText("s", bad);
      expect(await readLive(f, "s", 5)).toEqual({ snapshot: null, modified: 5, changed: false });
    }
  });
});
