import { alphaStatsOf, pngSize, type AlphaStats, type PicSize } from "@/core/addons/screenPictures";

/** 투명도 통계를 읽을 때 줄이는 최대 폭(px) */
const SCAN_WIDTH = 256;

function scanSize(w: number, h: number): { w: number; h: number } {
  const k = Math.min(1, SCAN_WIDTH / Math.max(1, w));
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

/** 이미지를 줄여 그려 투명도 통계를 읽는다. 읽을 수 없으면 null. */
function scan(img: CanvasImageSource, w: number, h: number): AlphaStats | null {
  try {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, h);
    return alphaStatsOf(ctx.getImageData(0, 0, w, h).data, w, h);
  } catch {
    return null;
  }
}

const byImage = new WeakMap<ImageBitmap, AlphaStats | null>();

/** 불러온 이미지의 투명도 통계(이미지별 캐시) */
export function imageAlphaStats(img: ImageBitmap): AlphaStats | null {
  if (byImage.has(img)) return byImage.get(img) ?? null;
  const s = scanSize(img.width, img.height);
  const st = scan(img, s.w, s.h);
  byImage.set(img, st);
  return st;
}

const flatByImage = new WeakMap<ImageBitmap, boolean>();

/**
 * 한 가지 색으로만 칠한 그림인가(화면을 검게·하얗게 덮는 전환용 그림): 8×8로 줄여 읽은 색·투명도 차이가 거의 없다(이미지별 캐시).
 * 읽을 수 없으면 false.
 */
export function isFlatImage(img: ImageBitmap): boolean {
  const hit = flatByImage.get(img);
  if (hit !== undefined) return hit;
  let flat = false;
  try {
    const c = document.createElement("canvas");
    c.width = 8; c.height = 8;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (ctx) {
      ctx.drawImage(img, 0, 0, 8, 8);
      const px = ctx.getImageData(0, 0, 8, 8).data;
      const lo = [255, 255, 255, 255], hi = [0, 0, 0, 0];
      for (let i = 0; i < px.length; i += 4) {
        for (let k = 0; k < 4; k++) {
          lo[k] = Math.min(lo[k], px[i + k]);
          hi[k] = Math.max(hi[k], px[i + k]);
        }
      }
      flat = hi.every((v, k) => v - lo[k] <= 12);
    }
  } catch { /* 모름 */ }
  flatByImage.set(img, flat);
  return flat;
}

/** 그림 저장소(AssetStore): 암호화된 그림(.png_·.rpgmvp)도 내용으로 풀어 이미지 Blob으로 돌려준다 */
export interface PictureSource { load(kind: "pictures", name: string): Promise<Blob | null> }

/**
 * 그림 하나의 크기·투명도 통계. 반드시 그림 저장소(복호화한 Blob)에서 읽는다 — 암호화된 파일의 바이트를 그대로 읽으면
 * PNG 머리도 디코드도 실패해 크기·통계를 모르게 되고, 화면 크기의 투명한 스탠딩 겹이 모두 이벤트 그림으로 보인다.
 * knownSize: 이미 아는 크기(있으면 머리를 다시 읽지 않는다). 그림이 없으면 null. 읽기 실패는 예외로 던진다(다시 읽게).
 */
export async function pictureInfo(
  source: PictureSource, name: string, knownSize?: PicSize | null,
): Promise<{ size: PicSize | null; stats: AlphaStats | null } | null> {
  const blob = await source.load("pictures", name);
  if (!blob) return null;
  const head = knownSize !== undefined ? knownSize : pngSize(new Uint8Array(await blob.slice(0, 24).arrayBuffer()));
  // 머리에서 크기를 못 읽으면 디코드한 원래 크기를 쓴다
  const r = await blobAlphaStats(blob, head);
  return { size: head ?? r.size, stats: r.stats };
}

/**
 * 그림 파일(Blob)의 투명도 통계: 줄인 크기로 디코드해 읽고 바로 놓는다(그림을 붙잡아 두지 않는다).
 * size = 그림 크기(PNG 머리에서 읽은 것, 모르면 원래 크기로 디코드하고 그 크기를 돌려준다). 읽을 수 없으면 stats null.
 */
export async function blobAlphaStats(blob: Blob, size: PicSize | null): Promise<{ stats: AlphaStats | null; size: PicSize | null }> {
  if (typeof createImageBitmap !== "function") return { stats: null, size };
  let bmp: ImageBitmap | null = null;
  try {
    if (size) {
      const s = scanSize(size.w, size.h);
      bmp = await createImageBitmap(blob, { resizeWidth: s.w, resizeHeight: s.h, resizeQuality: "low" });
      return { stats: scan(bmp, s.w, s.h), size };
    }
    bmp = await createImageBitmap(blob);
    const natural = bmp.width > 0 && bmp.height > 0 ? { w: bmp.width, h: bmp.height } : null;
    const s = scanSize(bmp.width, bmp.height);
    return { stats: scan(bmp, s.w, s.h), size: natural };
  } catch {
    return { stats: null, size };
  } finally {
    try { bmp?.close(); } catch { /* 이미 놓음 */ }
  }
}
