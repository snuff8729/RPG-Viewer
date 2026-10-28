import { describe, expect, it } from "vitest";
import { DirectoryHandleFolder } from "./browserFolders";

/** 대소문자를 구분하는 최소 FileSystemDirectoryHandle 흉내. keys() 호출 수를 센다. */
type Tree = { [name: string]: Tree | string };
function fakeDir(tree: Tree, counter: { lists: number }): FileSystemDirectoryHandle {
  const notFound = () => Object.assign(new Error("NotFoundError"), { name: "NotFoundError" });
  return {
    kind: "directory",
    async getDirectoryHandle(name: string) {
      const v = tree[name];
      if (v === undefined || typeof v === "string") throw notFound();
      return fakeDir(v, counter);
    },
    async getFileHandle(name: string) {
      const v = tree[name];
      if (typeof v !== "string") throw notFound();
      return { kind: "file", getFile: async () => new Blob([v]) as unknown as File };
    },
    async *keys() {
      counter.lists++;
      for (const k of Object.keys(tree)) yield k;
    },
  } as unknown as FileSystemDirectoryHandle;
}

describe("DirectoryHandleFolder", () => {
  it("resolves names case-insensitively", async () => {
    const c = { lists: 0 };
    const f = new DirectoryHandleFolder(fakeDir({ Img: { Faces: { "Actor1.png": "x" } } }, c));
    expect(await f.readText("img/faces/actor1.png")).toBe("x");
    expect(await f.readText("img/faces/nope.png")).toBeNull();
  });
  it("lists each directory at most once across misses", async () => {
    const c = { lists: 0 };
    const root = fakeDir({ img: { faces: { "Actor1.png": "a", "Actor2.png": "b" } } }, c);
    const f = new DirectoryHandleFolder(root);
    for (let i = 0; i < 5; i++) {
      expect(await f.readText(`img/faces/missing${i}.png`)).toBeNull();
      expect(await f.readText("img/faces/actor1.png")).toBe("a");
    }
    expect(await f.readText("img/faces/ACTOR2.PNG")).toBe("b");
    expect(c.lists).toBe(1);
  });
});
