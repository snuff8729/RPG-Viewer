import { describe, it, expect } from "vitest";
import { MemoryFolder, isWritableFolder, resolveCaseInsensitive } from "./folder";

describe("folder", () => {
  it("reads files case-insensitively", async () => {
    const f = new MemoryFolder({ "img/faces/actor1.png": new Uint8Array([1, 2]) });
    expect(new Uint8Array((await f.readBinary("img/faces/Actor1.png"))!)).toEqual(new Uint8Array([1, 2]));
  });
  it("returns null for missing files", async () => {
    expect(await new MemoryFolder({}).readText("data/System.json")).toBeNull();
  });
  it("lists direct children only", async () => {
    const f = new MemoryFolder({ "data/a.json": "{}", "data/sub/b.json": "{}" });
    expect((await f.list("data")).sort()).toEqual(["a.json", "sub"]);
  });
  it("resolveCaseInsensitive prefers exact match", () => {
    expect(resolveCaseInsensitive(["Actor1.png", "actor1.png"], "actor1.png")).toBe("actor1.png");
    expect(resolveCaseInsensitive(["Actor1.png"], "ACTOR1.PNG")).toBe("Actor1.png");
    expect(resolveCaseInsensitive(["x.png"], "y.png")).toBeNull();
  });

  it("memory folder write/stat/readRange/remove", async () => {
    const f = new MemoryFolder({});
    expect(await f.writeText("rpg-viewer/a.txt", "가나")).toBe(true);
    expect(await f.stat("rpg-viewer/a.txt")).toMatchObject({ size: 6 });
    f.appendText("rpg-viewer/a.txt", "다");
    expect(new TextDecoder().decode((await f.readRange("rpg-viewer/a.txt", 6, 9))!)).toBe("다");
    expect((await f.readRange("rpg-viewer/a.txt", 6, 999))!.byteLength).toBe(3);
    expect(await f.list("rpg-viewer")).toEqual(["a.txt"]);
    expect(await f.remove("rpg-viewer/a.txt")).toBe(true);
    expect(await f.stat("rpg-viewer/a.txt")).toBeNull();
    expect(await f.remove("rpg-viewer/a.txt")).toBe(false);
  });
  it("lastModified increases on write", async () => {
    const f = new MemoryFolder({});
    await f.writeText("a", "1");
    const a = (await f.stat("a"))!.lastModified;
    await f.writeText("a", "2");
    expect((await f.stat("a"))!.lastModified).toBeGreaterThan(a);
  });
  it("isWritableFolder", async () => {
    const f = new MemoryFolder({});
    expect(isWritableFolder(f)).toBe(true);
    expect(await f.canWrite()).toBe(true);
    expect(await f.requestWrite()).toBe(true);
  });
});
