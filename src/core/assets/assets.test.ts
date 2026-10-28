import { beforeAll, describe, expect, it } from "vitest";
import type { GameData } from "@/core/types";
import { loadGame } from "@/core/loader/loadGame";
import { loadFixtureFolder } from "../../../tests/helpers/fixtureFolder";
import { MemoryFolder, type GameFolder } from "@/core/fs/folder";
import { AssetStore, RETRY_BACKOFF_MS } from "./assets";

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const head = async (b: Blob | null) => [...new Uint8Array(await b!.arrayBuffer()).slice(0, 8)];

async function open(name: "sample-mz" | "sample-mv") {
  const folder = loadFixtureFolder(name);
  const r = await loadGame(folder);
  if (!r.ok) throw new Error("load failed");
  return { folder, data: r.data as GameData };
}

describe("AssetStore", () => {
  let store: AssetStore;
  beforeAll(async () => {
    const { folder, data } = await open("sample-mz");
    store = new AssetStore(folder, data);
  });

  it("decrypts MZ face to a valid PNG", async () => {
    const blob = await store.load("faces", "People1");
    expect(blob!.type).toBe("image/png");
    expect(await head(blob)).toEqual(PNG_SIG);
  });
  it("finds plain file with different case", async () => expect(await store.load("faces", "Actor1")).not.toBeNull());
  it("decrypts MV .rpgmvp", async () => {
    const { folder, data } = await open("sample-mv");
    expect(await head(await new AssetStore(folder, data).load("faces", "Actor1"))).toEqual(PNG_SIG);
  });
  it("image() is null when missing or when createImageBitmap is unavailable", async () => {
    expect(await store.image("characters", "nope")).toBeNull();
    expect(await store.image("tilesets", "")).toBeNull();
  });
  it("returns null for missing", async () => expect(await store.load("pictures", "nope")).toBeNull());
  it("returns null for empty name", async () => expect(await store.load("faces", "")).toBeNull());
  it("decrypts an encrypted file even without a key (PNG header is fixed)", async () => {
    const { folder, data } = await open("sample-mz");
    const noKey = { ...data, system: { ...data.system, encryptionKey: undefined } } as GameData;
    expect(await head(await new AssetStore(folder, noKey).load("faces", "People1"))).toEqual(PNG_SIG);
  });
  it("caches", () => expect(store.fetch("faces", "People1")).toBe(store.fetch("faces", "People1")));
});

describe("AssetStore extension order", () => {
  async function reads(name: "sample-mz" | "sample-mv", patch: Partial<GameData["system"]> = {}) {
    const { folder, data } = await open(name);
    const paths: string[] = [];
    const spy = Object.assign(Object.create(folder), {
      readBinary: (p: string) => { paths.push(p); return folder.readBinary(p); },
    });
    await new AssetStore(spy, { ...data, system: { ...data.system, ...patch } }).load("faces", "People1");
    return paths;
  }
  it("MZ with encrypted images tries .png_ first", async () =>
    expect(await reads("sample-mz")).toEqual(["img/faces/People1.png_"]));
  it("MV with encrypted images tries .rpgmvp first", async () => {
    const p = await reads("sample-mv");
    expect(p[0]).toBe("www/img/faces/People1.rpgmvp");
  });
  it("tries the other encrypted extension, then .png", async () => {
    const { folder, data } = await open("sample-mz");
    const paths: string[] = [];
    const spy = Object.assign(Object.create(folder), {
      readBinary: (p: string) => { paths.push(p); return folder.readBinary(p); },
    });
    await new AssetStore(spy, data).load("faces", "nope");
    expect(paths).toEqual(["img/faces/nope.png_", "img/faces/nope.rpgmvp", "img/faces/nope.png"]);
  });
  it("without encrypted images tries .png first", async () =>
    expect((await reads("sample-mz", { hasEncryptedImages: false }))[0]).toBe("img/faces/People1.png"));
});

/** 일부 그림만 안 보이던 경우들: 파일마다 키·확장자·내용이 어긋난다. */
describe("AssetStore decodes by content, not by extension or key", () => {
  const KEY = "0123456789abcdef0123456789abcdef";
  const OTHER_KEY = "fedcba9876543210fedcba9876543210";
  const RPGMV_HEAD = [0x52, 0x50, 0x47, 0x4d, 0x56, 0, 0, 0, 0, 3, 1, 0, 0, 0, 0, 0];

  function encrypt(plain: Uint8Array, keyHex: string): Uint8Array {
    const out = new Uint8Array(16 + plain.length);
    out.set(RPGMV_HEAD, 0);
    out.set(plain, 16);
    for (let i = 0; i < 16 && i < plain.length; i++) out[16 + i] ^= parseInt(keyHex.slice(i * 2, i * 2 + 2), 16);
    return out;
  }

  async function setup(files: (png: Uint8Array) => Record<string, Uint8Array>, system: Partial<GameData["system"]>) {
    const { folder, data } = await open("sample-mz");
    const png = new Uint8Array((await folder.readBinary("img/faces/actor1.png"))!);
    const store = new AssetStore(new MemoryFolder(files(png)), { ...data, system: { ...data.system, ...system } });
    return { store, png };
  }

  it("handles other keys, swapped extensions, JPEGs, empty placeholders and junk", async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0]);
    const { store, png } = await setup((png) => ({
      "img/pictures/OtherKey.png_": encrypt(png, OTHER_KEY), // 다른 키로 암호화된 파일
      "img/pictures/EncAsPng.png": encrypt(png, KEY), // 암호문인데 확장자가 .png
      "img/pictures/PlainAsEnc.png_": png, // 평문인데 확장자가 .png_
      "img/pictures/Photo.png": jpeg, // .png 이름의 JPEG
      "img/pictures/Empty.png_": new Uint8Array(0), // 빈 자리표시 파일 + 진짜 .png
      "img/pictures/Empty.png": png,
      "img/pictures/Junk.png": new Uint8Array([1, 2, 3]),
    }), { hasEncryptedImages: true, encryptionKey: KEY });

    expect(new Uint8Array(await (await store.load("pictures", "OtherKey"))!.arrayBuffer())).toEqual(png);
    expect(new Uint8Array(await (await store.load("pictures", "EncAsPng"))!.arrayBuffer())).toEqual(png);
    expect(await head(await store.load("pictures", "PlainAsEnc"))).toEqual(PNG_SIG);
    expect(await head(await store.load("pictures", "Empty"))).toEqual(PNG_SIG);
    expect((await store.load("pictures", "Photo"))?.type).toBe("image/jpeg");
    expect(await store.load("pictures", "Junk")).toBeNull();
  });

  it("decrypts .rpgmvp even when System.json has no key or says images are plain", async () => {
    const { store, png } = await setup((png) => ({
      "img/pictures/Late.rpgmvp": encrypt(png, KEY),
      "img/pictures/Stub.rpgmvp": encrypt(new Uint8Array(0), KEY),
    }), { hasEncryptedImages: false, encryptionKey: undefined });
    expect(new Uint8Array(await (await store.load("pictures", "Late"))!.arrayBuffer())).toEqual(png);
    expect(await store.load("pictures", "Stub")).toBeNull();
  });
});

/** 없는 그림(캐시)과 읽기 실패(캐시 안 함, 5초 백오프 후 다시 읽음)를 구분한다. */
describe("AssetStore missing vs failed", () => {
  async function setup(strict: (folder: GameFolder, p: string) => Promise<ArrayBuffer | null>) {
    const { folder, data } = await open("sample-mz");
    let t = 0;
    let calls = 0;
    const waits: number[] = [];
    const spy: GameFolder = {
      readText: (p) => folder.readText(p),
      readBinary: (p) => folder.readBinary(p),
      list: (d) => folder.list(d),
      readBinaryStrict: (p) => { calls++; return strict(folder, p); },
    };
    const store = new AssetStore(spy, data, {
      now: () => t,
      wait: async (ms) => { waits.push(ms); t += ms; },
    });
    return { store, waits, calls: () => calls, advance: (ms: number) => { t += ms; } };
  }

  /** fail()이 true인 동안 읽기 오류를 던지는 폴더. */
  const flaky = (fail: () => boolean) => async (folder: GameFolder, p: string) => {
    if (fail()) throw new Error("500");
    return folder.readBinary(p);
  };

  it("caches missing (every extension absent) and does not read again", async () => {
    const s = await setup(async () => null);
    expect(await s.store.fetch("pictures", "nope")).toEqual({ status: "missing" });
    expect(s.calls()).toBe(3);
    expect(await s.store.fetch("pictures", "nope")).toEqual({ status: "missing" });
    expect(s.calls()).toBe(3);
  });

  it("does not cache read failures; reads again on the next request after the backoff", async () => {
    let fail = true;
    const s = await setup(flaky(() => fail));
    expect(await s.store.fetch("faces", "People1")).toEqual({ status: "failed" });
    fail = false;
    s.advance(RETRY_BACKOFF_MS);
    expect((await s.store.fetch("faces", "People1")).status).toBe("ok");
    expect(s.waits).toEqual([]); // 백오프가 지났으니 기다리지 않고 바로 읽는다
  });

  it("waits out the rest of the 5 s backoff before reading the same file again", async () => {
    let fail = true;
    const s = await setup(flaky(() => fail));
    expect((await s.store.fetch("faces", "People1")).status).toBe("failed");
    const afterFail = s.calls();
    fail = false;
    s.advance(1000);
    expect((await s.store.fetch("faces", "People1")).status).toBe("ok");
    expect(s.waits).toEqual([RETRY_BACKOFF_MS - 1000]);
    expect(s.calls()).toBeGreaterThan(afterFail);
  });

  it("concurrent requests after a failure share one re-read", async () => {
    let fail = true;
    const s = await setup(flaky(() => fail));
    await s.store.fetch("faces", "People1");
    fail = false;
    const a = s.store.fetch("faces", "People1");
    expect(s.store.fetch("faces", "People1")).toBe(a);
    expect((await a).status).toBe("ok");
  });

  it("a failure on one extension is not reported as missing", async () => {
    const s = await setup(async (_f, p) => {
      if (p.endsWith(".png_")) throw new Error("network");
      return null;
    });
    expect(await s.store.fetch("pictures", "x")).toEqual({ status: "failed" });
  });

  it("image() does not cache a read failure", async () => {
    let fail = true;
    const s = await setup(flaky(() => fail));
    const first = s.store.image("faces", "People1");
    expect(await first).toBeNull();
    fail = false;
    s.advance(RETRY_BACKOFF_MS);
    expect(s.store.image("faces", "People1")).not.toBe(first);
  });
});
