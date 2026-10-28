import { beforeAll, describe, expect, it } from "vitest";
import type { GameData } from "@/core/types";
import { loadGame } from "@/core/loader/loadGame";
import { loadFixtureFolder } from "../../../tests/helpers/fixtureFolder";
import { MemoryFolder } from "@/core/fs/folder";
import { AssetStore } from "./assets";

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
  it("caches", () => expect(store.load("faces", "People1")).toBe(store.load("faces", "People1")));
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
