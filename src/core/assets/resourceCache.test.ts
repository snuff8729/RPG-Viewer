import { describe, expect, it, vi } from "vitest";
import { ResourceCache } from "./resourceCache";

const resource = (bytes = 4) => ({ bytes, close: vi.fn() });
type Resource = ReturnType<typeof resource>;
const cache = (budget: number) => new ResourceCache<Resource>(budget, r => r.bytes, r => r.close());

describe("ResourceCache", () => {
  it("evicts least recently used idle values by bytes, touching cache hits", async () => {
    const c = cache(8), a = resource(), b = resource(), d = resource();
    const loadA = vi.fn(async () => a);
    const first = c.get("a", loadA);
    await first;
    await c.get("b", async () => b);
    expect(c.get("a", loadA)).toBe(first);
    await c.get("d", async () => d);
    expect(b.close).toHaveBeenCalledTimes(1);
    expect(a.close).not.toHaveBeenCalled();
    expect(c.bytes).toBe(8);
    expect(loadA).toHaveBeenCalledTimes(1);
  });

  it("shares concurrent loads and only closes after the last lease releases", async () => {
    const c = cache(0), value = resource();
    const load = vi.fn(async () => value);
    const a = c.acquire("a", load), b = c.acquire("a", load);
    expect(a.value).toBe(b.value);
    await a.value;
    a.release(); a.release();
    expect(value.close).not.toHaveBeenCalled();
    expect(c.bytes).toBe(4);
    b.release(); b.release();
    expect(value.close).toHaveBeenCalledTimes(1);
    expect(c.bytes).toBe(0);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("skips pinned older values when selecting an eviction victim", async () => {
    const c = cache(8), a = resource(), b = resource(), d = resource();
    const lease = c.acquire("a", async () => a);
    await lease.value;
    await c.get("b", async () => b);
    await c.get("d", async () => d);
    expect(b.close).toHaveBeenCalledOnce();
    expect(a.close).not.toHaveBeenCalled();
    lease.release();
  });

  it("releases a cancelled in-flight load as soon as it resolves", async () => {
    const c = cache(0), value = resource(100);
    let resolve!: (r: Resource) => void;
    const pending = new Promise<Resource>(r => { resolve = r; });
    const lease = c.acquire("a", () => pending);
    lease.release();
    resolve(value);
    await lease.value;
    expect(value.close).toHaveBeenCalledOnce();
    expect(c.size).toBe(0);
    expect(c.bytes).toBe(0);
  });

  it("recreates an evicted value on the next acquire", async () => {
    const c = cache(0), first = resource(), second = resource();
    const load = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const a = c.acquire("a", load);
    await a.value; a.release();
    const b = c.acquire("a", load);
    expect(await b.value).toBe(second);
    expect(second.close).not.toHaveBeenCalled();
    b.release();
    expect(first.close).toHaveBeenCalledOnce();
    expect(second.close).toHaveBeenCalledOnce();
  });

  it("does not retain rejected or non-cacheable results", async () => {
    const c = new ResourceCache<number>(10, () => 0, undefined, n => n > 0);
    await expect(c.get("a", async () => { throw Error("network"); })).rejects.toThrow("network");
    expect(await c.get("a", async () => 0)).toBe(0);
    expect(c.size).toBe(0);
    expect(await c.get("a", async () => 1)).toBe(1);
  });

  it("bounds zero-byte entries and immediately discards oversized idle values", async () => {
    const c = new ResourceCache<number>(4, n => n, undefined, undefined, 2);
    await c.get("a", async () => 0);
    await c.get("b", async () => 0);
    await c.get("c", async () => 0);
    expect(c.size).toBe(2);
    await c.get("large", async () => 100);
    expect(c.bytes).toBe(0);
    expect(c.size).toBe(0);
  });
});
