import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { frameIndexAt, frameMoves, motionAt, type PictureMotion } from "@/core/addons/pictureMotion";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { drawPictures, TonedCache } from "./drawPictures";
import { loopTime } from "./motionClock";
import { usePictureMotionOn } from "./motionDisplay";
import { shouldAnimate, wantsPlay, type PlayChoice } from "./playback";
import type { View } from "./pictureImages";
import { usePicturesNearViewport } from "./pictureViewportContext";
import { useOnScreen } from "./useOnScreen";

/** 큰 보기의 캔버스 모양(그림 크게 보기와 같다) */
export const ZOOM_CANVAS = "mx-auto block h-auto max-h-[75vh] w-auto max-w-full rounded-md border bg-muted";

/**
 * 그림 움직임 재생(GIF처럼): 화면에 보이면 처음부터 끝(대사 때 모습)까지 움직이고 잠깐 멈췄다가 되풀이한다.
 * 보기 설정 `그림 움직임`이 켜져 있으면 저절로 움직인다. 오른쪽 아래 단추로 멈추고 이어 간다(직접 멈춘 것은 스크롤로 나갔다 와도 그대로).
 * 그림을 누르면 크게 본다(큰 보기는 열려 있는 동안 따로 움직이고, 닫으면 큰 캔버스를 비운다).
 * 그림을 다 읽기 전(ready가 아님)과 화면에 실제로 보이지 않을 때(스크롤 밖·숨긴 탭·숨긴 창)는 rAF를 아예 돌리지 않는다.
 */
export function MotionCanvas({ motion, view, images, ready, stand, label, className }: {
  motion: PictureMotion; view: View; images: Map<string, ImageBitmap>; ready: boolean; stand: boolean; label: string; className?: string;
}) {
  const [motionOn] = usePictureMotionOn();
  // null = 직접 고르지 않음(보기 설정 `그림 움직임`을 따른다). 화면 밖에 나갔다 와도 그대로 둔다.
  const [choice, setChoice] = useState<PlayChoice>(null);
  const playing = wantsPlay(motionOn, choice);
  const [observe, onScreen] = useOnScreen<HTMLDivElement>();
  // 큰 보기가 열려 있는 동안 작은 것은 쉰다(가려져 있으므로)
  const [zoomed, setZoomed] = useState(false);
  return (
    <Dialog open={zoomed} onOpenChange={setZoomed}>
      <div ref={observe} className={cn("relative", stand ? "w-fit max-w-full" : "w-full")}>
        <DialogTrigger asChild>
          <button type="button" className="block w-full cursor-zoom-in overflow-hidden rounded-md border bg-muted" aria-label={`${label} — 크게 보기`} title="눌러서 크게 보기">
            <MotionSurface
              motion={motion} view={view} images={images} run={shouldAnimate({ wants: playing, onScreen: onScreen && !zoomed, ready })}
              className={className ?? (stand ? "block h-auto max-h-64 w-auto max-w-full" : "block h-auto w-full")}
            />
          </button>
        </DialogTrigger>
        <PlayButton playing={playing} label={label} onChange={(p) => setChoice(p ? "play" : "pause")} className="absolute right-1 bottom-1" />
      </div>
      <DialogContent className="sm:max-w-[min(90vw,1200px)]">
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
          <DialogDescription>움직이는 그림이에요.</DialogDescription>
        </DialogHeader>
        <MotionZoom motion={motion} view={view} images={images} ready={ready} label={label} />
      </DialogContent>
    </Dialog>
  );
}

/** 큰 보기: 열려 있는 동안 따로 재생(처음에는 재생), 닫으면 사라지며 캔버스를 비운다 */
function MotionZoom({ motion, view, images, ready, label }: { motion: PictureMotion; view: View; images: Map<string, ImageBitmap>; ready: boolean; label: string }) {
  const [playing, setPlaying] = useState(true);
  const [observe, onScreen] = useOnScreen<HTMLDivElement>();
  return (
    <div ref={observe} className="flex flex-col items-center gap-2">
      <MotionSurface motion={motion} view={view} images={images} run={shouldAnimate({ wants: playing, onScreen, ready })} className={ZOOM_CANVAS} />
      <PlayButton playing={playing} label={label} onChange={setPlaying} />
    </div>
  );
}

/** 재생·멈춤 단추 */
export function PlayButton({ playing, label, onChange, className }: { playing: boolean; label: string; onChange: (playing: boolean) => void; className?: string }) {
  return (
    <Button
      type="button" variant="secondary" size="icon-sm" className={className}
      aria-pressed={playing} aria-label={`${label} — ${playing ? "움직임 멈추기" : "움직임 재생"}`} title={playing ? "멈추기" : "재생"}
      onClick={() => onChange(!playing)}
    >
      {playing ? <Pause /> : <Play />}
    </Button>
  );
}

/** 움직임을 그리는 캔버스: run일 때만 rAF를 돌리고, 아니면 지금 모습 그대로 둔다(다시 run이면 멈춘 곳에서 이어 간다). */
function MotionSurface({ motion, view, images, run, className }: {
  motion: PictureMotion; view: View; images: Map<string, ImageBitmap>; run: boolean; className: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const near = usePicturesNearViewport();
  // 재생한 시간(ms). null = 아직 재생 전(끝 모습을 보인다)
  const elapsed = useRef<number | null>(null);
  const [toned] = useState(() => new TonedCache());
  const { left, top, width, height } = view;

  useEffect(() => () => {
    toned.clear();
    const canvas = ref.current;
    if (canvas) canvas.width = canvas.height = 0;
  }, [toned]);

  useLayoutEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    if (!near) { canvas.width = canvas.height = 0; toned.clear(); return; }
    const area = { left, top, width, height };
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const draw = (t: number) => drawPictures(ctx, motionAt(motion, t), area, images, toned);
    // 화면 밖·숨긴 창·멈춤: 루프를 아예 돌리지 않고 지금 모습 그대로
    if (!run) {
      draw(elapsed.current === null ? motion.end : loopTime(elapsed.current, motion.end));
      return;
    }
    if (elapsed.current === null) elapsed.current = 0;
    let t = loopTime(elapsed.current, motion.end);
    draw(t);
    let lastT = t, lastIdx = frameIndexAt(motion, t), last = performance.now(), raf = 0;
    const tick = (now: number) => {
      elapsed.current = (elapsed.current ?? 0) + Math.max(0, now - last);
      last = now;
      t = loopTime(elapsed.current, motion.end);
      const i = frameIndexAt(motion, t);
      // 장면이 바뀌었거나 움직이는 중이거나 끝에 닿았을 때만 다시 그린다
      if (t !== lastT && (i !== lastIdx || t >= motion.end || frameMoves(motion.frames[i]))) {
        draw(t);
        lastIdx = i;
      }
      lastT = t;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [near, run, motion, images, toned, left, top, width, height]);

  return <canvas ref={ref} width={0} height={0} className={className} />;
}
