import { describe, expect, it } from "vitest";
import { DirectoryHandleFolder, FileListFolder } from "./browserFolders";
import { isWritableFolder } from "./folder";

/** 대소문자를 구분하는 최소 FileSystemDirectoryHandle 흉내. keys() 호출 수를 센다. */
type Tree = { [name: string]: Tree | string };
function fakeDir(tree: Tree, counter: { lists: number }): FileSystemDirectoryHandle {
  const notFound = () => Object.assign(new Error("NotFoundError"), { name: "NotFoundError" });
  return {
    kind: "directory",
    async getDirectoryHandle(name: string, opts?: { create?: boolean }) {
      let v = tree[name];
      if (v === undefined && opts?.create) tree[name] = v = {};
      if (v === undefined || typeof v === "string") throw notFound();
      return fakeDir(v, counter);
    },
    async getFileHandle(name: string, opts?: { create?: boolean }) {
      if (tree[name] === undefined && opts?.create) tree[name] = "";
      if (typeof tree[name] !== "string") throw notFound();
      return {
        kind: "file",
        getFile: async () => {
          const b = new Blob([tree[name] as string]);
          return Object.assign(b, { lastModified: 123 }) as unknown as File;
        },
        createWritable: async () => ({
          async write(t: string) {
            tree[name] = t;
          },
          async close() {},
        }),
      };
    },
    async removeEntry(name: string) {
      if (tree[name] === undefined) throw notFound();
      delete tree[name];
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

  it("writeText creates missing subfolders and is found case-insensitively afterwards", async () => {
    const c = { lists: 0 };
    const tree: Tree = { js: {} };
    const f = new DirectoryHandleFolder(fakeDir(tree, c));
    expect(await f.writeText("js/plugins/RPG-Viewer.js", "abc")).toBe(true);
    expect(await f.readText("JS/Plugins/rpg-viewer.JS")).toBe("abc");
    expect(await f.writeText("js/plugins/rpg-viewer.js", "def")).toBe(true);
    expect(((tree.js as Tree).plugins as Tree)["RPG-Viewer.js"]).toBe("def");
    expect(Object.keys((tree.js as Tree).plugins as Tree)).toEqual(["RPG-Viewer.js"]);
  });
  it("finds a directory created externally after a failed lookup (no negative cache)", async () => {
    const c = { lists: 0 };
    const tree: Tree = { www: {} };
    const f = new DirectoryHandleFolder(fakeDir(tree, c));
    expect(await f.readText("www/rpg-viewer/live.json")).toBeNull();
    expect(await f.list("www/rpg-viewer")).toEqual([]);
    (tree.www as Tree)["rpg-viewer"] = { "live.json": "{}" }; // the game creates it
    expect(await f.readText("www/rpg-viewer/live.json")).toBe("{}");
    expect(await f.list("www/rpg-viewer")).toEqual(["live.json"]);
  });
  it("name table learns new file after listing", async () => {
    const c = { lists: 0 };
    const f = new DirectoryHandleFolder(fakeDir({ d: { "A.txt": "1" } }, c));
    expect(await f.readText("d/a.txt")).toBe("1");
    await f.writeText("d/New.txt", "n");
    expect(await f.stat("D/new.TXT")).toMatchObject({ size: 1 });
  });
  it("stat / readRange / remove", async () => {
    const c = { lists: 0 };
    const f = new DirectoryHandleFolder(fakeDir({ d: { "Log.txt": "hello" } }, c));
    expect(await f.stat("d/log.txt")).toEqual({ size: 5, lastModified: 123 });
    expect(await f.stat("d/none.txt")).toBeNull();
    expect(new TextDecoder().decode((await f.readRange("d/log.txt", 1, 3))!)).toBe("el");
    expect(await f.readRange("d/none.txt", 0, 1)).toBeNull();
    expect(await f.remove("d/LOG.txt")).toBe(true);
    expect(await f.stat("d/log.txt")).toBeNull();
    expect(await f.remove("d/log.txt")).toBe(false);
  });
  it("canWrite / requestWrite use permission API", async () => {
    const base = fakeDir({}, { lists: 0 }) as unknown as Record<string, unknown>;
    expect(await new DirectoryHandleFolder(base as unknown as FileSystemDirectoryHandle).canWrite()).toBe(false);
    const h = {
      ...base,
      queryPermission: async () => "prompt",
      requestPermission: async () => "granted",
    } as unknown as FileSystemDirectoryHandle;
    const f = new DirectoryHandleFolder(h);
    expect(await f.canWrite()).toBe(false);
    expect(await f.requestWrite()).toBe(true);
  });
  it("writeText aborts the writable and returns false when write throws", async () => {
    let aborted = false;
    const fh = {
      kind: "file",
      getFile: async () => new Blob([""]),
      createWritable: async () => ({
        async write() {
          throw new Error("disk full");
        },
        async close() {},
        async abort() {
          aborted = true;
        },
      }),
    };
    const root = {
      kind: "directory",
      getFileHandle: async () => fh,
      async *keys() {},
    } as unknown as FileSystemDirectoryHandle;
    expect(await new DirectoryHandleFolder(root).writeText("a.txt", "x")).toBe(false);
    expect(aborted).toBe(true);
  });
  it("reads resolve null when the file read rejects; negative range is normalized", async () => {
    const bad = {
      size: 1,
      lastModified: 1,
      text: async () => Promise.reject(new Error("NotReadableError")),
      arrayBuffer: async () => Promise.reject(new Error("NotReadableError")),
      slice: () => ({ arrayBuffer: async () => Promise.reject(new Error("NotReadableError")) }),
    };
    const root = {
      kind: "directory",
      getFileHandle: async () => ({ kind: "file", getFile: async () => bad }),
      async *keys() {},
    } as unknown as FileSystemDirectoryHandle;
    const f = new DirectoryHandleFolder(root);
    expect(await f.readRange("a", 0, 5)).toBeNull();
    expect(await f.readText("a")).toBeNull();
    expect(await f.readBinary("a")).toBeNull();
    const g = new DirectoryHandleFolder(fakeDir({ "l.txt": "hello" }, { lists: 0 }));
    expect(new TextDecoder().decode((await g.readRange("l.txt", -3, 2))!)).toBe("he");
    expect((await g.readRange("l.txt", 4, 1))!.byteLength).toBe(0);
  });
  it("FileListFolder is not writable", () => {
    expect(isWritableFolder(new FileListFolder([] as unknown as FileList))).toBe(false);
  });
});
