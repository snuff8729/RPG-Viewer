import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Play } from "lucide-react";
import { frameIndexAt, frameMoves, motionAt, type PictureMotion } from "@/core/addons/pictureMotion";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { drawPictures, TonedCache } from "./drawPictures";
import { loopTime } from "./motionClock";
import { usePrefersReducedMotion } from "./motionDisplay";
import type { View } from "./pictureImages";
import { usePicturesNearViewport } from "./pictureViewportContext";

/**
 * 그림 움직임 재생(GIF처럼): 화면에 보이면 처음부터 끝(대사 때 모습)까지 움직이고 잠깐 멈췄다가 되풀이한다.
 * 누르면 멈추고 다시 누르면 이어 간다. 기기의 `동작 줄이기`가 켜져 있으면 저절로 움직이지 않고(끝 모습) 재생 표시를 보인다.
 * 그림을 다 읽기 전(ready가 아님)과 화면 밖에서는 움직이지 않는다. 이동·색조는 장면 사이에도 고르게, 그림 바꾸기는 장면마다 그린다.
 */
export function MotionCanvas({ motion, view, images, ready, stand, label, className }: {
  motion: PictureMotion; view: View; images: Map<string, ImageBitmap>; ready: boolean; stand: boolean; label: string; className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const near = usePicturesNearViewport();
  const reduced = usePrefersReducedMotion();
  // null = 기본(동작 줄이기면 멈춤, 아니면 재생)
  const [paused, setPaused] = useState<boolean | null>(null);
  const playing = paused === null ? !reduced : !paused;
  const [visible, setVisible] = useState(typeof IntersectionObserver === "undefined");
  // 재생한 시간(ms). null = 아직 재생 전(끝 모습을 보인다)
  const elapsed = useRef<number | null>(null);
  const [toned] = useState(() => new TonedCache());
  const { left, top, width, height } = view;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || typeof IntersectionObserver === "undefined") return;
    const root = canvas.closest<HTMLElement>("[data-reader-scroll]");
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { root });
    io.observe(canvas);
    return () => io.disconnect();
  }, []);

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
    if (!(playing && visible && ready)) {
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
  }, [near, playing, visible, ready, motion, images, toned, left, top, width, height]);

  return (
    <button
      type="button"
      className={cn(
        "relative block overflow-hidden rounded-md border bg-muted",
        stand ? "w-fit max-w-full" : "w-full",
      )}
      aria-pressed={playing}
      aria-label={`${label} — ${playing ? "움직임 멈추기" : "움직임 재생"}`}
      title={playing ? "눌러서 멈추기" : "눌러서 재생"}
      onClick={() => setPaused(playing)}
    >
      <canvas ref={ref} width={0} height={0} className={className ?? (stand ? "block h-auto max-h-64 w-auto max-w-full" : "block h-auto w-full")} />
      {!playing && (
        <Badge variant="secondary" className="pointer-events-none absolute right-1 bottom-1">
          <Play data-icon="inline-start" />재생
        </Badge>
      )}
    </button>
  );
}
