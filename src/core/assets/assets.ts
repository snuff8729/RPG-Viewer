import type { GameFolder } from "@/core/fs/folder";
import type { GameData } from "@/core/types";
import { decodeImage } from "./decrypt";

export type AssetKind = "faces" | "pictures" | "tilesets" | "characters";

/**
 * ok: 그릴 수 있는 그림. missing: 게임 폴더에 없음(모든 확장자 후보가 없거나 그림이 아님) — 캐시된다.
 * failed: 읽기 자체가 실패(네트워크·서버 오류 등) — 캐시하지 않고 다음 요청 때 다시 읽는다.
 */
export type AssetResult =
  | { status: "ok"; blob: Blob }
  | { status: "missing" }
  | { status: "failed" };

/** 같은 파일 읽기 실패 후 다시 읽기까지 최소 간격(ms). */
export const RETRY_BACKOFF_MS = 5000;

/** 가능성이 높은 확장자부터: 암호화 게임이면 엔진의 암호화 확장자 → 다른 암호화 확장자 → .png. */
function extensionsFor(data: GameData): string[] {
  if (!data.system?.hasEncryptedImages) return [".png", ".png_", ".rpgmvp"];
  return data.engine === "MZ" ? [".png_", ".rpgmvp", ".png"] : [".rpgmvp", ".png_", ".png"];
}

interface Entry {
  promise: Promise<AssetResult>;
  /** 읽기 실패로 끝난 시각(실패한 경우만). */
  failedAt?: number;
}

export interface AssetStoreOptions {
  now?: () => number;
  /** 백오프 대기. 테스트에서 바꿔 끼운다. */
  wait?: (ms: number) => Promise<void>;
}

export class AssetStore {
  private cache = new Map<string, Entry>();
  private images = new Map<string, Promise<ImageBitmap | null>>();

  private folder: GameFolder;
  private data: GameData;
  private now: () => number;
  private wait: (ms: number) => Promise<void>;

  constructor(folder: GameFolder, data: GameData, opts: AssetStoreOptions = {}) {
    this.folder = folder;
    this.data = data;
    this.now = opts.now ?? (() => Date.now());
    this.wait = opts.wait ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /**
   * 그림을 읽은 결과. ok/missing은 캐시하고, failed는 다음 요청 때 다시 읽는다.
   * 단 같은 파일을 RETRY_BACKOFF_MS 안에 다시 읽지는 않는다(남은 시간만큼 기다렸다 읽는다).
   */
  fetch(kind: AssetKind, name: string): Promise<AssetResult> {
    if (name === "") return Promise.resolve({ status: "missing" });
    const key = `${kind}/${name}`;
    const entry = this.cache.get(key);
    if (entry && entry.failedAt === undefined) return entry.promise;
    const delay = entry?.failedAt !== undefined ? entry.failedAt + RETRY_BACKOFF_MS - this.now() : 0;
    const next: Entry = { promise: Promise.resolve({ status: "missing" }) };
    next.promise = (delay > 0 ? this.wait(delay) : Promise.resolve())
      .then(() => this.read(kind, name))
      .catch((): AssetResult => ({ status: "failed" }))
      .then((r) => {
        // 실패는 결과로 남기지 않는다: 다음 요청이 (백오프를 지켜) 새로 읽는다.
        if (r.status === "failed" && this.cache.get(key) === next) next.failedAt = this.now();
        return r;
      });
    this.cache.set(key, next);
    return next.promise;
  }

  /** 그림 Blob. 없거나 읽기 실패면 null. */
  load(kind: AssetKind, name: string): Promise<Blob | null> {
    return this.fetch(kind, name).then((r) => (r.status === "ok" ? r.blob : null));
  }

  /** 캔버스에 그릴 이미지(이름별 캐시). 없음·디코드 실패나 createImageBitmap이 없는 환경이면 null. 읽기 실패는 캐시하지 않는다. */
  image(kind: AssetKind, name: string): Promise<ImageBitmap | null> {
    if (name === "") return Promise.resolve(null);
    const key = `${kind}/${name}`;
    const cached = this.images.get(key);
    if (cached) return cached;
    const p: Promise<ImageBitmap | null> = this.fetch(kind, name)
      .then((r) => {
        if (r.status === "failed") {
          if (this.images.get(key) === p) this.images.delete(key);
          return null;
        }
        return r.status === "ok" && typeof createImageBitmap === "function" ? createImageBitmap(r.blob) : null;
      })
      .catch(() => null);
    this.images.set(key, p);
    return p;
  }

  /**
   * 확장자 후보를 차례로 읽어 처음으로 그릴 수 있는 것을 쓴다. 암호화 여부는 확장자가 아니라 내용(머리)으로
   * 판단하므로, 키가 없거나 파일마다 키가 달라도, 평문/암호문이 확장자와 어긋나도 보인다.
   * 빈 파일이나 이미지가 아닌 파일은 건너뛰고 다음 후보를 본다.
   * 그릴 수 있는 것을 못 찾았는데 어느 후보의 읽기 자체가 실패했으면 failed(없다고 단정하지 않는다).
   */
  private async read(kind: AssetKind, name: string): Promise<AssetResult> {
    let failed = false;
    for (const ext of extensionsFor(this.data)) {
      const path = `${this.data.imgRoot}/${kind}/${name}${ext}`;
      let buf: ArrayBuffer | null;
      try {
        buf = this.folder.readBinaryStrict
          ? await this.folder.readBinaryStrict(path)
          : await this.folder.readBinary(path);
      } catch {
        failed = true;
        continue;
      }
      if (!buf) continue;
      const img = decodeImage(buf, this.data.system?.encryptionKey);
      if (img) return { status: "ok", blob: new Blob([img.bytes], { type: img.type }) };
    }
    return failed ? { status: "failed" } : { status: "missing" };
  }
}
