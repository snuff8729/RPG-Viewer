import { useEffect, useRef, useState } from "react";
import { ImageOff, RotateCw } from "lucide-react";
import { useGame } from "@/app/GameProvider";
import { DEFAULT_SCREEN, type ScreenPicture, type ScreenSize } from "@/core/addons/screenPictures";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { missingAssetText } from "../script/assetText";

type Status = "loading" | "ok" | "missing" | "failed";
const NO_IMAGES = new Map<string, ImageBitmap>();

/** 그림 블렌드 모드 → 캔버스 합성(0 보통, 1 더하기, 2 곱하기, 3 스크린) */
const COMPOSITE: GlobalCompositeOperation[] = ["source-over", "lighter", "multiply", "screen"];

const tonedCache = new WeakMap<ImageBitmap, Map<string, CanvasImageSource>>();

/** 색조 [r, g, b, gray]를 입힌 사본(엔진처럼 회색만큼 채도를 빼고 r·g·b를 더한다, 그림·색조별 캐시). 그릴 수 없으면 원본. */
function toned(img: ImageBitmap, tone: [number, number, number, number]): CanvasImageSource {
  const k = tone.join(",");
  let byTone = tonedCache.get(img);
  if (!byTone) { byTone = new Map(); tonedCache.set(img, byTone); }
  const hit = byTone.get(k);
  if (hit) return hit;
  const out = tonedCopy(img, tone);
  if (byTone.size > 8) byTone.clear();
  byTone.set(k, out);
  return out;
}

function tonedCopy(img: ImageBitmap, tone: [number, number, number, number]): CanvasImageSource {
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

/** 그림들을 읽어 이름 → 이미지·상태. retry로 실패한 것을 다시 읽는다. */
function usePictureImages(names: string[]) {
  const { assets } = useGame();
  const key = names.join("\n");
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ key: string; images: Map<string, ImageBitmap>; status: Map<string, Status> }>(
    () => ({ key: "", images: new Map(), status: new Map() }),
  );
  useEffect(() => {
    if (!assets) return;
    let cancelled = false;
    const list = key ? key.split("\n") : [];
    for (const name of list) {
      assets.fetch("pictures", name).then(async (r) => {
        const img = r.status === "ok" ? await assets.image("pictures", name) : null;
        if (cancelled) return;
        const st: Status = r.status === "ok" ? (img ? "ok" : "missing") : r.status;
        setState((prev) => {
          const base = prev.key === `${key}#${attempt}` ? prev : { key: `${key}#${attempt}`, images: new Map(), status: new Map() };
          const images = new Map(base.images), status = new Map(base.status);
          if (img) images.set(name, img);
          status.set(name, st);
          return { key: base.key, images, status };
        });
      }, () => {
        if (!cancelled) setState((prev) => ({ ...prev, status: new Map(prev.status).set(name, "failed") }));
      });
    }
    return () => { cancelled = true; };
  }, [assets, key, attempt]);
  const current = state.key === `${key}#${attempt}` ? state : null;
  return {
    images: current?.images ?? NO_IMAGES,
    status: (name: string): Status => current?.status.get(name) ?? "loading",
    retry: () => setAttempt((n) => n + 1),
  };
}

/** 화면 크기의 캔버스에 그림들을 번호 순으로 그린다(위치·원점·크기·투명도·블렌드·색조·회전). */
function ScreenCanvas({ pictures, size, images, className }: {
  pictures: ScreenPicture[]; size: ScreenSize; images: Map<string, ImageBitmap>; className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const p of pictures) {
      const img = images.get(p.name);
      if (!img || p.opacity <= 0) continue;
      try {
        ctx.save();
        ctx.globalAlpha = p.opacity / 255;
        ctx.globalCompositeOperation = COMPOSITE[p.blendMode] ?? "source-over";
        ctx.translate(p.x, p.y);
        if (p.angle) ctx.rotate((p.angle * Math.PI) / 180);
        ctx.scale(p.scaleX / 100, p.scaleY / 100);
        const src = p.tone ? toned(img, p.tone) : img;
        ctx.drawImage(src, p.origin === 1 ? -img.width / 2 : 0, p.origin === 1 ? -img.height / 2 : 0);
      } catch { /* 그 그림만 건너뛴다 */ } finally {
        ctx.restore();
      }
    }
  }, [pictures, images, size.width, size.height]);
  return <canvas ref={ref} width={size.width} height={size.height} className={className} />;
}

/**
 * 화면 그림 따라 그리기: 대사가 나올 때 게임 화면에 떠 있던 그림(스탠딩 이미지 등)을 게임 화면 비율의 상자에 그린다.
 * 누르면 크게 본다. 게임 폴더에 없는 그림은 아래에 이름을 적는다.
 */
export function ScreenPictures({ pictures }: { pictures: ScreenPicture[] }) {
  const { data } = useGame();
  const size = data?.screenSize ?? DEFAULT_SCREEN;
  const names = [...new Set(pictures.map((p) => p.name))];
  const { images, status, retry } = usePictureImages(names);
  const missing = names.filter((n) => status(n) === "missing");
  const failed = names.some((n) => status(n) === "failed");
  const label = `화면 그림 ${pictures.length}개: ${names.join(", ")}`;
  return (
    <div className="space-y-1">
      <Dialog>
        <DialogTrigger asChild>
          <button type="button" className="block w-full cursor-zoom-in overflow-hidden rounded-md border bg-muted" aria-label={`${label} — 크게 보기`} title={names.join(", ")}>
            <ScreenCanvas pictures={pictures} size={size} images={images} className="block h-auto w-full" />
          </button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-[min(90vw,1200px)]">
          <DialogHeader>
            <DialogTitle>화면 그림</DialogTitle>
            <DialogDescription className="break-all">{names.join(", ")}</DialogDescription>
          </DialogHeader>
          <ScreenCanvas pictures={pictures} size={size} images={images} className="mx-auto block h-auto max-h-[75vh] w-auto max-w-full rounded-md border bg-muted" />
        </DialogContent>
      </Dialog>
      {(missing.length > 0 || failed) && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {missing.map((n) => (
            <span key={n} className="flex items-center gap-1 break-all"><ImageOff className="size-3.5 shrink-0" aria-hidden />{missingAssetText("pictures", n)}</span>
          ))}
          {failed && (
            <Button type="button" variant="outline" size="xs" onClick={retry}><RotateCw data-icon="inline-start" />불러오지 못한 그림 다시 시도</Button>
          )}
        </div>
      )}
    </div>
  );
}
