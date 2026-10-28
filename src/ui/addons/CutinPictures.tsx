import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import { useGame } from "@/app/GameProvider";
import { DEFAULT_SCREEN, type ScreenShot } from "@/core/addons/screenPictures";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { HidePicturesMenu } from "./HidePicturesMenu";
import { PictureLoadNotes, ShotButton } from "./ScreenPictures";
import { standView, usePictureImages } from "./pictureImages";
import { isFlatImage } from "./imageStats";

/** `재생` 때 장면을 넘기는 간격(ms) */
const FRAME_MS = 120;

/**
 * 컷인(대사 사이에 잠깐 띄웠다 지운 그림): 가장 완전한 장면을 먼저 보이고, `◀ 1/7 ▶`로 장면을 넘기거나 `재생`으로 차례로 돌려 본다.
 * 이벤트 그림이 있는 컷인(화면을 덮는 것)은 화면 그대로, 아니면 모든 장면이 차지하는 부분으로 잘라(장면을 넘겨도 크기가 그대로).
 * 한 가지 색으로만 덮은 장면 하나뿐인 것(화면 전환용 검은·흰 그림)은 보이지 않는다.
 */
export function CutinPictures({ frames, best }: { frames: ScreenShot[]; best: number }) {
  const { data } = useGame();
  const guessed = data?.screenSize ?? DEFAULT_SCREEN;
  const names = useMemo(() => [...new Set(frames.flatMap((f) => f.pictures.map((p) => p.name)))], [frames]);
  const { images, status, retry } = usePictureImages(names);
  const [index, setIndex] = useState(() => Math.max(0, Math.min(best, frames.length - 1)));
  const [playing, setPlaying] = useState(false);
  const count = frames.length;
  useEffect(() => {
    if (!playing || count < 2) return;
    const h = window.setInterval(() => setIndex((i) => (i + 1) % count), FRAME_MS);
    return () => window.clearInterval(h);
  }, [playing, count]);
  // `그림 숨기기` 메뉴용: 모든 장면의 겹
  const all = useMemo<ScreenShot | null>(() => {
    if (count === 0) return null;
    const pictures = frames.flatMap((f) => f.pictures);
    const all: ScreenShot = frames[0].kind === "cg" ? { kind: "cg", pictures, cg: frames.flatMap((f) => f.cg ?? []) } : { kind: "stand", pictures };
    if (frames[0].screen) all.screen = frames[0].screen;
    return all;
  }, [frames, count]);
  if (count === 0 || !all) return null;
  const i = Math.min(index, count - 1);
  const shot = frames[i];
  const cg = shot.kind === "cg";
  // 1.18.2: 그때 게임의 실제 화면 크기(모르면 게임 설정에서 짐작한 크기)
  const size = shot.screen ?? all.screen ?? guessed;
  const only = count === 1 && shot.pictures.length === 1 ? images.get(shot.pictures[0].name) : undefined;
  if (only && isFlatImage(only)) return null;
  const view = cg ? { left: 0, top: 0, width: size.width, height: size.height } : standView(all.pictures, size, images);
  const step = (d: number) => { setPlaying(false); setIndex((n) => (Math.min(n, count - 1) + d + count) % count); };
  const frameNames = [...new Set(shot.pictures.map((p) => p.name))];
  return (
    <div className="space-y-1">
      <div className="flex items-start gap-1">
        <figure className="flex min-w-0 flex-1 flex-col gap-1">
          <ShotButton pictures={shot.pictures} view={view} images={images} stand={!cg} title="컷인" names={frameNames} />
          <figcaption className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            <span>컷인</span>
            {count > 1 && (
              <>
                <Button type="button" variant="ghost" size="icon-xs" aria-label="앞 장면" onClick={() => step(-1)}><ChevronLeft /></Button>
                <span className="tabular-nums" aria-live="polite">{i + 1}/{count}</span>
                <Button type="button" variant="ghost" size="icon-xs" aria-label="다음 장면" onClick={() => step(1)}><ChevronRight /></Button>
                <Toggle size="sm" variant="outline" pressed={playing} onPressedChange={setPlaying} aria-label="컷인 재생">
                  {playing ? <Pause data-icon="inline-start" /> : <Play data-icon="inline-start" />}재생
                </Toggle>
              </>
            )}
          </figcaption>
        </figure>
        <HidePicturesMenu shot={all} />
      </div>
      <PictureLoadNotes missing={names.filter((n) => status(n) === "missing")} failed={names.some((n) => status(n) === "failed")} retry={retry} />
    </div>
  );
}
