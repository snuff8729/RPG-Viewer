import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryFolder } from "@/core/fs/folder";
import type { GameData } from "@/core/types";
import { AssetStore } from "./assets";

// Synthetic bytes and mocked decoding: no game folder or browser is required.
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
const data = { imgRoot: "img", system: { hasEncryptedImages: false } } as GameData;
const bitmap = () => ({ width: 1, height: 1, close: vi.fn() }) as unknown as ImageBitmap;
const setup = (opts: { imageBudget?: number; blobBudget?: number } = {}) => {
  const folder = new MemoryFolder({ "img/pictures/a.png": png, "img/pictures/b.png": png });
  const read = vi.spyOn(folder, "readBinary");
  return { store: new AssetStore(folder, data, opts), read };
};
afterEach(() => vi.unstubAllGlobals());

describe("AssetStore memory budgets", () => {
  it("shares bitmap leases and re-decodes an evicted bitmap from the cached blob", async () => {
    const first = bitmap(), second = bitmap(), decodedAgain = bitmap();
    const decode = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second).mockResolvedValueOnce(decodedAgain);
    vi.stubGlobal("createImageBitmap", decode);
    const { store, read } = setup({ imageBudget: 4 });
    const a = store.acquireImage("pictures", "a"), shared = store.acquireImage("pictures", "a");
    expect(await a.value).toBe(first);
    expect(await shared.value).toBe(first);
    a.release();
    const b = store.acquireImage("pictures", "b");
    await b.value;
    expect(first.close).not.toHaveBeenCalled();
    expect(second.close).not.toHaveBeenCalled();
    shared.release();
    expect(first.close).toHaveBeenCalledOnce();
    b.release();
    const again = store.acquireImage("pictures", "a");
    expect(await again.value).toBe(decodedAgain);
    expect(second.close).toHaveBeenCalledOnce();
    expect(decode).toHaveBeenCalledTimes(3);
    expect(read).toHaveBeenCalledTimes(2);
    again.release();
  });

  it("evicts blobs by bytes and touches them on a cache hit", async () => {
    const { store, read } = setup({ blobBudget: 4 });
    const a = await store.fetch("pictures", "a");
    expect(await store.fetch("pictures", "a")).toBe(a);
    await store.fetch("pictures", "b");
    await store.fetch("pictures", "a");
    expect(read).toHaveBeenCalledTimes(3);
    // The caller can still use a blob after its cache entry has been removed.
    expect(a.status === "ok" && a.blob.size).toBe(4);
  });

  it("bounds a decode cancelled before completion and retries decoding errors", async () => {
    const image = bitmap();
    const decode = vi.fn().mockRejectedValueOnce(Error("decode")).mockResolvedValueOnce(image);
    vi.stubGlobal("createImageBitmap", decode);
    const { store } = setup({ imageBudget: 0 });
    const first = store.acquireImage("pictures", "a");
    expect(await first.value).toBeNull();
    first.release();
    const cancelled = store.acquireImage("pictures", "a");
    cancelled.release();
    await cancelled.value;
    expect(image.close).toHaveBeenCalledOnce();
    expect(decode).toHaveBeenCalledTimes(2);
  });
});
