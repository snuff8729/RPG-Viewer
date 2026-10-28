import type { GameFolder } from "@/core/fs/folder";
import type { GameData } from "@/core/types";
import { decodeImage } from "./decrypt";

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

  /**
   * 확장자 후보를 차례로 읽어 처음으로 그릴 수 있는 것을 쓴다. 암호화 여부는 확장자가 아니라 내용(머리)으로
   * 판단하므로, 키가 없거나 파일마다 키가 달라도, 평문/암호문이 확장자와 어긋나도 보인다.
   * 빈 파일이나 이미지가 아닌 파일은 건너뛰고 다음 후보를 본다.
   */
  private async read(kind: AssetKind, name: string): Promise<Blob | null> {
    for (const ext of extensionsFor(this.data)) {
      const buf = await this.folder.readBinary(`${this.data.imgRoot}/${kind}/${name}${ext}`);
      if (!buf) continue;
      const img = decodeImage(buf, this.data.system?.encryptionKey);
      if (img) return new Blob([img.bytes], { type: img.type });
    }
    return null;
  }
}
