import { describe, it, expect } from "vitest";
import { MemoryFolder, resolveCaseInsensitive } from "./folder";

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
});
