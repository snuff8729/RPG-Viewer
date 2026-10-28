import { alphaStatsOf, type AlphaStats, type PicSize } from "@/core/addons/screenPictures";

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
