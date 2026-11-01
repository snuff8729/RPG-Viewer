import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { shouldAnimate, wantsPlay, type PlayChoice } from "./playback";
import { useOnScreen } from "./useOnScreen";
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import { useReaderItemState } from "../live/readerItemState";
import { useGame } from "@/app/GameProvider";
import { DEFAULT_SCREEN, type ScreenShot } from "@/core/addons/screenPictures";
import { motionNames, type PictureMotion } from "@/core/addons/pictureMotion";
import { MotionCanvas, ZOOM_CANVAS } from "./MotionCanvas";
import { usePictureMotionOn } from "./motionDisplay";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { HidePicturesMenu } from "./HidePicturesMenu";
import { PictureLoadNotes, ScreenCanvas, ShotButton } from "./ScreenPictures";
import type { View } from "./pictureImages";
import { standView, usePictureImages } from "./pictureImages";
import { PictureViewport } from "./PictureViewport";
import { usePicturesNearViewport } from "./pictureViewportContext";
import { isFlatImage } from "./imageStats";

/** `재생` 때 장면을 넘기는 간격(ms) */
const FRAME_MS = 120;

/**
 * 컷인(대사 사이에 잠깐 띄웠다 지운 그림): 가장 완전한 장면을 먼저 보이고, `◀ 1/7 ▶`로 장면을 넘기거나 `재생`으로 차례로 돌려 본다.
 * 이벤트 그림이 있는 컷인(화면을 덮는 것)은 화면 그대로, 아니면 모든 장면이 차지하는 부분으로 잘라(장면을 넘겨도 크기가 그대로).
 * 한 가지 색으로만 덮은 장면 하나뿐인 것(화면 전환용 검은·흰 그림)은 보이지 않는다.
 */
export function CutinPictures({ frames, best, stateKey, motion }: { frames: ScreenShot[]; best: number; stateKey: string; motion?: PictureMotion }) {
  return <PictureViewport><CutinPicturesBody frames={frames} best={best} stateKey={stateKey} motion={motion} /></PictureViewport>;
}

/** motion(기록 시각대로의 움직임)이 있고 `그림 움직임`이 켜져 있으면 장면 넘기기 대신 그대로 움직여 보인다. */
function CutinPicturesBody({ frames, best, stateKey, motion: recorded }: { frames: ScreenShot[]; best: number; stateKey: string; motion?: PictureMotion }) {
  const active = usePicturesNearViewport();
  const { data } = useGame();
  const guessed = data?.screenSize ?? DEFAULT_SCREEN;
  const [motionOn] = usePictureMotionOn();
  const motion = motionOn ? recorded : undefined;
  const names = useMemo(() => [...new Set([...frames.flatMap((f) => f.pictures.map((p) => p.name)), ...motionNames(motion)])], [frames, motion]);
  const { images, status, retry } = usePictureImages(names);
  const [index, setIndex] = useReaderItemState("cutin:" + stateKey, Math.max(0, Math.min(best, frames.length - 1)));
  // 장면 넘기기: `그림 움직임`이 켜져 있으면 저절로 재생, 직접 멈추면(스크롤로 나갔다 와도) 그대로
  const [choice, setChoice] = useState<PlayChoice>(null);
  const playing = wantsPlay(motionOn, choice);
  const [observe, onScreen] = useOnScreen<HTMLElement>();
  const [zoomed, setZoomed] = useState(false);
  const count = frames.length;
  useFrameTicker(shouldAnimate({ wants: playing, onScreen: onScreen && active && !zoomed }), count, setIndex);
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
  const missing = names.filter((n) => status(n) === "missing");
  const failed = names.some((n) => status(n) === "failed");
  if (motion) {
    return (
      <div className="space-y-1">
        <div className="flex items-start gap-1">
          <figure className="flex min-w-0 flex-1 flex-col gap-1">
            <MotionCanvas
              motion={motion} images={images} stand={!cg} label="컷인" ready={names.every((n) => status(n) !== "loading")}
              view={cg ? view : standView(motion.frames.flatMap((f) => f.pictures), size, images)}
            />
            <figcaption className="text-xs text-muted-foreground">컷인</figcaption>
          </figure>
          <HidePicturesMenu shot={all} />
        </div>
        <PictureLoadNotes missing={missing} failed={failed} retry={retry} />
      </div>
    );
  }
  const step = (d: number) => { setChoice("pause"); setIndex((n) => (Math.min(n, count - 1) + d + count) % count); };
  const frameNames = [...new Set(shot.pictures.map((p) => p.name))];
  return (
    <div className="space-y-1">
      <div className="flex items-start gap-1">
        <figure ref={observe} className="flex min-w-0 flex-1 flex-col gap-1">
          <ShotButton
            pictures={shot.pictures} view={view} images={images} stand={!cg} title="컷인" names={frameNames}
            open={zoomed} onOpenChange={setZoomed}
            zoom={count > 1 ? (v) => <CutinZoom frames={frames} start={i} view={v} images={images} /> : undefined}
          />
          <figcaption className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            <span>컷인</span>
            {count > 1 && <FrameControls index={i} count={count} onStep={step} playing={playing} onPlaying={(p) => setChoice(p ? "play" : "pause")} />}
          </figcaption>
        </figure>
        <HidePicturesMenu shot={all} />
      </div>
      <PictureLoadNotes missing={missing} failed={failed} retry={retry} />
    </div>
  );
}

/** 장면 넘기기 타이머: run일 때만 돈다(화면 밖·숨긴 창·멈춤이면 타이머 없음). 다시 돌면 지금 장면에서 이어 간다. */
function useFrameTicker(run: boolean, count: number, setIndex: Dispatch<SetStateAction<number>>) {
  useEffect(() => {
    if (!run || count < 2) return;
    const h = window.setInterval(() => setIndex((i) => (i + 1) % count), FRAME_MS);
    return () => window.clearInterval(h);
  }, [run, count, setIndex]);
}

/** `◀ 1/7 ▶ 재생` */
function FrameControls({ index, count, onStep, playing, onPlaying }: {
  index: number; count: number; onStep: (d: number) => void; playing: boolean; onPlaying: (playing: boolean) => void;
}) {
  return (
    <>
      <Button type="button" variant="ghost" size="icon-xs" aria-label="앞 장면" onClick={() => onStep(-1)}><ChevronLeft /></Button>
      <span className="tabular-nums" aria-live={playing ? "off" : "polite"}>{index + 1}/{count}</span>
      <Button type="button" variant="ghost" size="icon-xs" aria-label="다음 장면" onClick={() => onStep(1)}><ChevronRight /></Button>
      <Toggle size="sm" variant="outline" pressed={playing} onPressedChange={onPlaying} aria-label="컷인 재생">
        {playing ? <Pause data-icon="inline-start" /> : <Play data-icon="inline-start" />}재생
      </Toggle>
    </>
  );
}

/** 컷인 크게 보기: 열려 있는 동안 따로 장면을 넘긴다(처음에는 재생). 닫으면 사라지며 큰 캔버스를 비운다. */
function CutinZoom({ frames, start, view, images }: { frames: ScreenShot[]; start: number; view: View; images: Map<string, ImageBitmap> }) {
  const count = frames.length;
  const [index, setIndex] = useState(start);
  const [playing, setPlaying] = useState(true);
  const [observe, onScreen] = useOnScreen<HTMLDivElement>();
  useFrameTicker(shouldAnimate({ wants: playing, onScreen }), count, setIndex);
  const i = Math.min(index, count - 1);
  const step = (d: number) => { setPlaying(false); setIndex((n) => (Math.min(n, count - 1) + d + count) % count); };
  return (
    <div ref={observe} className="flex flex-col items-center gap-2">
      <ScreenCanvas pictures={frames[i].pictures} view={view} images={images} className={ZOOM_CANVAS} />
      <div className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
        <FrameControls index={i} count={count} onStep={step} playing={playing} onPlaying={setPlaying} />
      </div>
    </div>
  );
}
