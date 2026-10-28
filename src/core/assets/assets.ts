import type { GameFolder } from "@/core/fs/folder";
import type { GameData } from "@/core/types";
import { decryptImage } from "./decrypt";

export type AssetKind = "faces" | "pictures" | "tilesets" | "characters";

/** 가능성이 높은 확장자부터: 암호화 게임이면 엔진의 암호화 확장자 → 다른 암호화 확장자 → .png. */
function extensionsFor(data: GameData): string[] {
  if (!data.system?.hasEncryptedImages) return [".png", ".png_", ".rpgmvp"];
  return data.engine === "MZ" ? [".png_", ".rpgmvp", ".png"] : [".rpgmvp", ".png_", ".png"];
}

export class AssetStore {
  private cache = new Map<string, Promise<Blob | null>>();
  private images = new Map<string, Promise<ImageBitmap | null>>();

  private folder: GameFolder;
  private data: GameData;

  constructor(folder: GameFolder, data: GameData) {
    this.folder = folder;
    this.data = data;
  }

  load(kind: AssetKind, name: string): Promise<Blob | null> {
    if (name === "") return Promise.resolve(null);
    const key = `${kind}/${name}`;
    let p = this.cache.get(key);
    if (!p) {
      p = this.read(kind, name).catch(() => null);
      this.cache.set(key, p);
    }
    return p;
  }

  /** 캔버스에 그릴 이미지(이름별 캐시). 읽기·디코드 실패나 createImageBitmap이 없는 환경이면 null. */
  image(kind: AssetKind, name: string): Promise<ImageBitmap | null> {
    if (name === "") return Promise.resolve(null);
    const key = `${kind}/${name}`;
    let p = this.images.get(key);
    if (!p) {
      p = this.load(kind, name)
        .then((blob) => (blob && typeof createImageBitmap === "function" ? createImageBitmap(blob) : null))
        .catch(() => null);
      this.images.set(key, p);
    }
    return p;
  }

  private async read(kind: AssetKind, name: string): Promise<Blob | null> {
    for (const ext of extensionsFor(this.data)) {
      const buf = await this.folder.readBinary(`${this.data.imgRoot}/${kind}/${name}${ext}`);
      if (!buf) continue;
      if (ext === ".png") return new Blob([buf], { type: "image/png" });
      const keyHex = this.data.system.encryptionKey;
      if (!keyHex) return null;
      return new Blob([decryptImage(buf, keyHex)], { type: "image/png" });
    }
    return null;
  }
}
