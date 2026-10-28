import type { GameFolder } from "@/core/fs/folder";
import type { GameData } from "@/core/types";
import { decryptImage } from "./decrypt";

export type AssetKind = "faces" | "pictures";

const EXTENSIONS = [".png", ".png_", ".rpgmvp"];

export class AssetStore {
  private cache = new Map<string, Promise<Blob | null>>();

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

  private async read(kind: AssetKind, name: string): Promise<Blob | null> {
    for (const ext of EXTENSIONS) {
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
