import type { GameFolder } from "@/core/fs/folder";
import type { GameData } from "@/core/types";
import { decodeAudio, decodeImage } from "./decrypt";
import { classifiedName } from "./pictureFolders";
import { ResourceCache, type ResourceLease } from "./resourceCache";

export type AssetKind = "faces" | "pictures" | "tilesets" | "characters" | "system";

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

/**
 * 기록 플러그인(1.31.0)이 복사해 둔 그림의 경로: <게임 바탕>/rpg-viewer/pictures/<이름>.png(평문 PNG).
 * 이름이 폴더 밖으로 나갈 수 있으면(.. · 절대 경로 · 드라이브) null.
 */
export function pictureCopyPath(dataRoot: string, name: string): string | null {
  if (typeof name !== "string" || name === "" || /[\0:]/.test(name)) return null;
  const segs = name.replace(/\\/g, "/").split("/");
  if (segs.some((s) => s === "" || s === "." || s === "..")) return null;
  const base = dataRoot.split("/").filter((s) => s !== "" && s !== ".").slice(0, -1).join("/");
  return `${base ? `${base}/` : ""}rpg-viewer/pictures/${segs.join("/")}.png`;
}

export interface AssetStoreOptions {
  now?: () => number;
  /** Decoded bytes (width * height * 4); active leases may temporarily exceed this. */
  imageBudget?: number;
  /** Compressed image Blob bytes retained between requests. */
  blobBudget?: number;
  /** 백오프 대기. 테스트에서 바꿔 끼운다. */
  wait?: (ms: number) => Promise<void>;
}

export class AssetStore {
  private cache: ResourceCache<AssetResult>;
  private images: ResourceCache<ImageBitmap | null>;
  private failures = new Map<string, number>();
  private audioClips = new Map<string, Promise<Blob | null>>();

  private folder: GameFolder;
  private data: GameData;
  private now: () => number;
  private wait: (ms: number) => Promise<void>;

  constructor(folder: GameFolder, data: GameData, opts: AssetStoreOptions = {}) {
    this.cache = new ResourceCache(opts.blobBudget ?? 128 * 1024 * 1024,
      r => r.status === "ok" ? r.blob.size : 0, undefined, r => r.status !== "failed");
    this.images = new ResourceCache(opts.imageBudget ?? 256 * 1024 * 1024,
      img => img ? img.width * img.height * 4 : 0, img => img?.close(), img => img !== null);
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
    return this.cache.get(key, async () => {
      const failedAt = this.failures.get(key);
      const delay = failedAt === undefined ? 0 : failedAt + RETRY_BACKOFF_MS - this.now();
      if (delay > 0) await this.wait(delay);
      const result = await this.read(kind, name).catch((): AssetResult => ({ status: "failed" }));
      this.failures.delete(key);
      if (result.status === "failed") {
        this.failures.set(key, this.now());
        if (this.failures.size > 2048) this.failures.delete(this.failures.keys().next().value!);
      }
      return result;
    });
  }

  /** 그림 Blob. 없거나 읽기 실패면 null. */
  load(kind: AssetKind, name: string): Promise<Blob | null> {
    return this.fetch(kind, name).then((r) => (r.status === "ok" ? r.blob : null));
  }

  /** 로컬·LAN·원격 모두 GameFolder의 바이너리 읽기를 쓴다. 오디오 캐시는 최근 24개만. */
  audio(folder: string, name: string): Promise<Blob | null> {
    // 기록에 들어 있는 경로도 게임 루트 밖으로 나가지 않게 한다(브라우저 폴더 포함).
    const safe = (s: string) => s.length > 0 && !/[\\\0:]/.test(s) && s.split("/").every(p => p !== "" && p !== "." && p !== "..");
    if (!safe(folder) || !safe(name)) return Promise.resolve(null);
    const key = `${folder}/${name}`;
    const cached = this.audioClips.get(key);
    if (cached) {
      this.audioClips.delete(key);
      this.audioClips.set(key, cached);
      return cached;
    }
    let failed = false;
    const promise = (async () => {
      const root = this.data.dataRoot.replace(/(^|\/)data\/?$/i, "$1");
      for (const ext of [".ogg", ".m4a", ".rpgmvo", ".ogg_", ".m4a_", ".rpgmvm"]) {
        try {
          const path = `${root}audio/${folder}/${name}${ext}`;
          const buf = this.folder.readBinaryStrict ? await this.folder.readBinaryStrict(path) : await this.folder.readBinary(path);
          if (!buf) continue;
          const audio = decodeAudio(buf, this.data.system?.encryptionKey);
          if (audio) return new Blob([audio.bytes], { type: audio.type });
        } catch { failed = true; }
      }
      return null;
    })().then(blob => {
      if (!blob && failed && this.audioClips.get(key) === promise) this.audioClips.delete(key);
      return blob;
    });
    this.audioClips.set(key, promise);
    if (this.audioClips.size > 24) this.audioClips.delete(this.audioClips.keys().next().value!);
    return promise;
  }

  /** Pin a shared bitmap, including its in-flight decode. Release when the consumer leaves. */
  acquireImage(kind: AssetKind, name: string): ResourceLease<ImageBitmap | null> {
    return this.images.acquire(kind + "/" + name, async () => {
      if (!name) return null;
      const r = await this.fetch(kind, name);
      if (r.status !== "ok" || typeof createImageBitmap !== "function") return null;
      try { return await createImageBitmap(r.blob); } catch { return null; }
    });
  }

  /**
   * 확장자 후보를 차례로 읽어 처음으로 그릴 수 있는 것을 쓴다. 암호화 여부는 확장자가 아니라 내용(머리)으로
   * 판단하므로, 키가 없거나 파일마다 키가 달라도, 평문/암호문이 확장자와 어긋나도 보인다.
   * 빈 파일이나 이미지가 아닌 파일은 건너뛰고 다음 후보를 본다.
   * 그릴 수 있는 것을 못 찾았는데 어느 후보의 읽기 자체가 실패했으면 failed(없다고 단정하지 않는다).
   */
  private async read(kind: AssetKind, name: string): Promise<AssetResult> {
    // 그림 하위 폴더 플러그인(BY_PictureClassify): 게임은 옮긴 경로에서 읽는다. 거기 없으면 이름 그대로도 본다.
    const moved = kind === "system" ? null : classifiedName(name, this.data.pictureFolders);
    let failed = false;
    const names = moved !== null ? [moved, name] : [name];
    for (const n of names) {
      const r = await this.readAt(kind, n);
      if (r.status === "ok") return r;
      if (r.status === "failed") failed = true;
    }
    // 게임 폴더에 없는 그림(게임 실행 파일 안에 묶인 그림 등): 기록 플러그인(1.31.0)이 게임에서 보일 때 복사해 둔 PNG
    if (kind === "pictures") {
      for (const n of names) {
        const r = await this.readFile(pictureCopyPath(this.data.dataRoot, n));
        if (r.status === "ok") return r;
        if (r.status === "failed") failed = true;
      }
    }
    return failed ? { status: "failed" } : { status: "missing" };
  }

  private async readFile(path: string | null): Promise<AssetResult> {
    if (path === null) return { status: "missing" };
    let buf: ArrayBuffer | null;
    try {
      buf = this.folder.readBinaryStrict ? await this.folder.readBinaryStrict(path) : await this.folder.readBinary(path);
    } catch {
      return { status: "failed" };
    }
    const img = buf ? decodeImage(buf, this.data.system?.encryptionKey) : null;
    return img ? { status: "ok", blob: new Blob([img.bytes], { type: img.type }) } : { status: "missing" };
  }

  private async readAt(kind: AssetKind, name: string): Promise<AssetResult> {
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
