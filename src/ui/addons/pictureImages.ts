import { useEffect, useState } from "react";
import { useGame } from "@/app/GameProvider";
import { standViewOf, type PictureView, type ScreenPicture, type ScreenSize } from "@/core/addons/screenPictures";
import { imageAlphaStats } from "./imageStats";

/** 읽기 그림 그리기에 함께 쓰는 것: 그림 불러오기(usePictureImages)와 스탠딩·컷인을 잘라 그릴 화면 부분(standView). */

type Status = "loading" | "ok" | "missing" | "failed";
const NO_IMAGES = new Map<string, ImageBitmap>();

/** 그림들을 읽어 이름 → 이미지·상태. retry로 실패한 것을 다시 읽는다. */
export function usePictureImages(names: string[]) {
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

/** 캔버스에 그릴 화면 부분(게임 화면 좌표) */
export type View = PictureView;

/**
 * 스탠딩: 그림들의 보이는 부분(투명하지 않은 부분)을 합친 곳 — 그리는 것(ScreenCanvas의 pictureDraw)과 같은 크기 기준(core
 * standViewOf). 화면 크기의 투명한 겹으로 그린 스탠딩도 캐릭터 부분만 잘린다. 그림을 아직 못 읽었으면 화면 전체.
 */
export function standView(pictures: ScreenPicture[], size: ScreenSize, images: Map<string, ImageBitmap>): View {
  return standViewOf(pictures, size, (name) => {
    const img = images.get(name);
    return img ? { w: img.width, h: img.height } : null;
  }, (name) => {
    const img = images.get(name);
    return img ? imageAlphaStats(img) : null;
  });
}
