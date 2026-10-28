import { describe, expect, it } from "vitest";
import type { GameData } from "@/core/types";
import { loadGame } from "@/core/loader/loadGame";
import { MemoryFolder } from "@/core/fs/folder";
import { AssetStore } from "@/core/assets/assets";
import { pngSize } from "@/core/addons/screenPictures";
import { loadFixtureFolder } from "../../../tests/helpers/fixtureFolder";
import { pictureInfo } from "./imageStats";

const KEY = "0123456789abcdef0123456789abcdef";
const RPGMV_HEAD = [0x52, 0x50, 0x47, 0x4d, 0x56, 0, 0, 0, 0, 3, 1, 0, 0, 0, 0, 0];

/** PNG 시그니처 + IHDR(w×h)만 있는 머리(크기 읽기용) */
function pngHead(w: number, h: number): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52], 0);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  b.set([8, 6, 0, 0, 0], 24);
  return b;
}

/** RPG Maker MV/MZ 암호화: "RPGMV" 머리 16바이트 + 앞 16바이트를 키와 XOR */
function encrypt(plain: Uint8Array, keyHex: string): Uint8Array {
  const out = new Uint8Array(16 + plain.length);
  out.set(RPGMV_HEAD, 0);
  out.set(plain, 16);
  for (let i = 0; i < 16 && i < plain.length; i++) out[16 + i] ^= parseInt(keyHex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function store(files: Record<string, Uint8Array>) {
  const r = await loadGame(loadFixtureFolder("sample-mz"));
  if (!r.ok) throw new Error("load failed");
  const data = r.data as GameData;
  return new AssetStore(new MemoryFolder(files), { ...data, system: { ...data.system, hasEncryptedImages: true, encryptionKey: KEY } });
}

// T_043302: 스탠딩 겹이 모두 암호화된 816×624 투명 PNG(img/pictures/*.png_)
describe("pictureInfo reads encrypted pictures through the asset store", () => {
  it("reads the size of an encrypted .png_ layer (raw bytes have no PNG header)", async () => {
    const enc = encrypt(pngHead(816, 624), KEY);
    expect(pngSize(enc.slice(0, 24))).toBeNull(); // 암호문 그대로는 크기를 모른다
    const assets = await store({ "img/pictures/Reiri_Base(Cloth).png_": enc });
    expect(await pictureInfo(assets, "Reiri_Base(Cloth)")).toEqual({ size: { w: 816, h: 624 }, stats: null });
  });

  it("reads .rpgmvp too, and keeps a known size", async () => {
    const assets = await store({ "img/pictures/Body.rpgmvp": encrypt(pngHead(400, 600), KEY) });
    expect((await pictureInfo(assets, "Body"))?.size).toEqual({ w: 400, h: 600 });
    expect((await pictureInfo(assets, "Body", { w: 10, h: 20 }))?.size).toEqual({ w: 10, h: 20 });
  });

  it("is null when the picture is missing", async () => {
    expect(await pictureInfo(await store({}), "Nope")).toBeNull();
  });
});
