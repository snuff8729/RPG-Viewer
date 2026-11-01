import { pictureDraw, type ScreenPicture } from "@/core/addons/screenPictures";
import type { View } from "./pictureImages";

/** 그림 블렌드 모드 → 캔버스 합성(0 보통, 1 더하기, 2 곱하기, 3 스크린) */
const COMPOSITE: GlobalCompositeOperation[] = ["source-over", "lighter", "multiply", "screen"];

export function tonedCopy(img: ImageBitmap, tone: [number, number, number, number]): HTMLCanvasElement | ImageBitmap {
  try {
    const c = document.createElement("canvas");
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (!ctx) return img;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height);
    const px = d.data;
    const [r, g, b] = tone;
    const gray = Math.max(0, Math.min(255, tone[3])) / 255;
    for (let i = 0; i < px.length; i += 4) {
      let R = px[i], G = px[i + 1], B = px[i + 2];
      if (gray > 0) {
        const l = 0.299 * R + 0.587 * G + 0.114 * B;
        R += (l - R) * gray; G += (l - G) * gray; B += (l - B) * gray;
      }
      px[i] = R + r; px[i + 1] = G + g; px[i + 2] = B + b; // Uint8ClampedArray가 0~255로 자른다
    }
    ctx.putImageData(d, 0, 0);
    return c;
  } catch {
    return img;
  }
}

/**
 * 색조를 입힌 그림 사본 보관(움직이는 그림은 같은 색조를 장면마다 다시 만들지 않는다). 색조가 바뀌는 중이면 8 단위로 맞춰 수를 줄인다.
 * 꽉 차면 비운다.
 */
export class TonedCache {
  private map = new Map<string, HTMLCanvasElement | ImageBitmap>();
  get(name: string, img: ImageBitmap, tone: [number, number, number, number]): CanvasImageSource {
    const t = tone.map((v) => Math.round(v / 8) * 8) as [number, number, number, number];
    const key = `${name}|${t.join(",")}`;
    let c = this.map.get(key);
    if (!c) {
      if (this.map.size >= 24) this.clear();
      c = tonedCopy(img, t);
      this.map.set(key, c);
    }
    return c;
  }
  clear() {
    for (const c of this.map.values()) if (c instanceof HTMLCanvasElement) c.width = c.height = 0;
    this.map.clear();
  }
}

/**
 * 캔버스에 그림들을 번호 순으로 그린다(위치·기준점·크기·투명도·블렌드·색조·회전). view: 그릴 화면 부분.
 * toned: 색조 사본 보관(없으면 그릴 때마다 만들고 버린다).
 */
export function drawPictures(
  ctx: CanvasRenderingContext2D, pictures: ScreenPicture[], view: View, images: Map<string, ImageBitmap>, toned?: TonedCache | null,
): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  for (const p of pictures) {
    const img = images.get(p.name);
    if (!img || p.opacity <= 0) continue;
    try {
      ctx.save();
      ctx.globalAlpha = Math.min(1, p.opacity / 255);
      ctx.globalCompositeOperation = COMPOSITE[p.blendMode] ?? "source-over";
      ctx.translate(p.x - view.left, p.y - view.top);
      if (p.angle) ctx.rotate((p.angle * Math.PI) / 180);
      ctx.scale(p.scaleX / 100, p.scaleY / 100);
      // 화면 사각형(standView의 standViewOf)과 같은 크기 기준: 기록의 크기(없으면 그림 파일 크기)에 crop 부분 또는 그림 전체
      const d = pictureDraw(p, { w: img.width, h: img.height });
      if (!d) continue;
      const src = p.tone ? (toned ? toned.get(p.name, img, p.tone) : tonedCopy(img, p.tone)) : img;
      try { ctx.drawImage(src, d.sx, d.sy, d.sw, d.sh, d.dx, d.dy, d.dw, d.dh); }
      finally { if (!toned && src instanceof HTMLCanvasElement) src.width = src.height = 0; }
    } catch { /* 그 그림만 건너뛴다 */ } finally {
      ctx.restore();
    }
  }
}
