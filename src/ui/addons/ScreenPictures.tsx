import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ImageOff, RotateCw } from "lucide-react";
import { useGame } from "@/app/GameProvider";
import {
  DEFAULT_SCREEN, standGroupLabel, standGroups, type ScreenPicture, type ScreenShot, type StandGroup,
} from "@/core/addons/screenPictures";
import { BUNDLED_ADAPTERS } from "@/app/adapterBundle";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { missingAssetText } from "../script/assetText";
import { HidePicturesMenu } from "./HidePicturesMenu";
import { drawPictures } from "./drawPictures";
import { MotionCanvas, ZOOM_CANVAS } from "./MotionCanvas";
import { usePictureMotionOn } from "./motionDisplay";
import { motionNames } from "@/core/addons/pictureMotion";
import { PictureViewport } from "./PictureViewport";
import { usePicturesNearViewport } from "./pictureViewportContext";
import { standView, usePictureImages, type View } from "./pictureImages";

/** 캔버스에 그림들을 번호 순으로 그린다(위치·기준점·크기·투명도·블렌드·색조·회전). view: 그릴 화면 부분. */
export function ScreenCanvas({ pictures, view, images, className }: {
  pictures: ScreenPicture[]; view: View; images: Map<string, ImageBitmap>; className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const active = usePicturesNearViewport();
  useLayoutEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    if (!active) { canvas.width = canvas.height = 0; return; }
    canvas.width = view.width; canvas.height = view.height;
    const ctx = canvas.getContext("2d");
    if (!canvas || !ctx) return;
    drawPictures(ctx, pictures, view, images);
    return () => { canvas.width = canvas.height = 0; };
  }, [active, pictures, images, view.left, view.top, view.width, view.height]);
  return <canvas ref={ref} width={0} height={0} className={className} />;
}


/** 스탠딩 묶음 이름·설명: 그림에 붙은 어댑터의 뷰어 도움 → 기본("아마네 스탠딩") */
function groupText(g: StandGroup): { label: string; title: string | null } {
  const adapterId = g.pictures.find((p) => p.tag?.adapter)?.tag?.adapter;
  const viewer = adapterId ? BUNDLED_ADAPTERS.find((a) => a.manifest.id === adapterId)?.viewer : null;
  let label: string | null = null, title: string | null = null;
  try { label = viewer?.standGroupLabel?.(g) ?? null; title = viewer?.standGroupTitle?.(g) ?? null; } catch { /* 기본 이름 */ }
  return { label: label ?? standGroupLabel(g), title };
}

/** 그림 한 장(누르면 크게 보기). zoom을 주면 큰 보기 안을 그것으로 바꾼다(컷인 장면 넘기기 등). */
export function ShotButton({ pictures, view: nextView, images, stand, title, names, caption, zoom, open, onOpenChange }: {
  pictures: ScreenPicture[]; view: View; images: Map<string, ImageBitmap>; stand: boolean; title: string; names: string[]; caption?: string;
  zoom?: (view: View) => ReactNode; open?: boolean; onOpenChange?: (open: boolean) => void;
}) {
  // Keep crop geometry while bitmap leases are released/reloaded.
  const [retained, setRetained] = useState(nextView);
  if (images.size > 0 && (nextView.left !== retained.left || nextView.top !== retained.top || nextView.width !== retained.width || nextView.height !== retained.height)) setRetained(nextView);
  const view = images.size > 0 ? nextView : retained;
  const label = `${title} ${pictures.length}개: ${names.join(", ")}`;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <button
          type="button"
          className={stand ? "block w-fit max-w-full cursor-zoom-in overflow-hidden rounded-md border bg-muted" : "block w-full cursor-zoom-in overflow-hidden rounded-md border bg-muted"}
          aria-label={`${label} — 크게 보기`} title={caption ?? names.join(", ")}
        >
          <ScreenCanvas pictures={pictures} view={view} images={images} className={stand ? "block h-auto max-h-64 w-auto max-w-full" : "block h-auto w-full"} />
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[min(90vw,1200px)]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="break-all">{caption ? `${caption} — ` : ""}{names.join(", ")}</DialogDescription>
        </DialogHeader>
        {zoom ? zoom(view) : <ScreenCanvas pictures={pictures} view={view} images={images} className={ZOOM_CANVAS} />}
      </DialogContent>
    </Dialog>
  );
}

/**
 * 화면 그림 따라 그리기: 대사가 나올 때 게임 화면에 보이던 그림을 그린다.
 * - 이벤트 그림(cg): 게임 화면 비율 그대로(그 위에 보이던 스탠딩 포함).
 * - 스탠딩(stand): 스탠딩 겹만, 차지하는 부분으로 잘라 작게. 게임 전용 확장이 배우를 붙인 스탠딩(1.13.0)은
 *   배우마다, 플러그인이 띄운 컷인은 스탠딩과 따로, 떨어진 스탠딩 덩어리도 따로 잘라 나란히("아마네 스탠딩"·"컷인"·"스탠딩").
 * 누르면 크게 본다. 게임 폴더에 없는 그림은 아래에 이름을 적는다.
 */
export function ScreenPictures({ shot }: { shot: ScreenShot }) {
  return <PictureViewport><ScreenPicturesBody shot={shot} /></PictureViewport>;
}

function ScreenPicturesBody({ shot }: { shot: ScreenShot }) {
  const { data } = useGame();
  // 1.18.2: 그때 게임의 실제 화면 크기(모르면 게임 설정에서 짐작한 크기)
  const size = shot.screen ?? data?.screenSize ?? DEFAULT_SCREEN;
  const { pictures } = shot;
  // 그림 움직임(보기 설정 `그림 움직임`): 움직임에 나오는 그림도 미리 읽는다
  const [motionOn] = usePictureMotionOn();
  const motion = motionOn ? shot.motion : undefined;
  const names = [...new Set([...pictures.map((p) => p.name), ...motionNames(motion)])];
  const { images, status, retry } = usePictureImages(names);
  const missing = names.filter((n) => status(n) === "missing");
  const failed = names.some((n) => status(n) === "failed");
  const stand = shot.kind === "stand";
  const groups = stand ? standGroups(pictures) : [];
  // 배우별·컷인·떨어진 스탠딩이 있으면 묶음마다 따로 잘라 나란히(좁으면 줄바꿈)
  const separate = groups.length > 1 || groups.some((g) => typeof g.actorId === "number" || g.kind === "cutin");
  const full = { left: 0, top: 0, width: size.width, height: size.height };
  const body = motion ? (
    <MotionCanvas
      motion={motion} images={images} stand={stand} label={stand ? "스탠딩" : "이벤트 그림"}
      ready={names.every((n) => status(n) !== "loading")}
      view={stand ? standView(motion.frames.flatMap((f) => f.pictures), size, images) : full}
    />
  ) : separate ? (
    <div className="flex flex-wrap items-end gap-2">
      {groups.map((g) => {
        const { label, title } = groupText(g);
        const gNames = [...new Set(g.pictures.map((p) => p.name))];
        return (
          <figure key={g.key} className="flex min-w-0 max-w-full flex-col gap-1">
            <ShotButton pictures={g.pictures} view={standView(g.pictures, size, images)} images={images} stand title={label} names={gNames} caption={title ?? undefined} />
            <figcaption className="text-xs text-muted-foreground">{label}</figcaption>
          </figure>
        );
      })}
    </div>
  ) : (
    <ShotButton
      pictures={pictures} images={images} stand={stand} title={stand ? "스탠딩" : "이벤트 그림"} names={names}
      view={stand ? standView(pictures, size, images) : full}
    />
  );
  return (
    <div className="space-y-1">
      {/* 그림 옆 `그림 숨기기`: 이 항목의 겹을 읽기에서 숨긴다 */}
      <div className="flex items-start gap-1">
        <div className="min-w-0 flex-1">{body}</div>
        <HidePicturesMenu shot={shot} />
      </div>
      <PictureLoadNotes missing={missing} failed={failed} retry={retry} />
    </div>
  );
}

/** 게임 폴더에 없는 그림 이름과 `불러오지 못한 그림 다시 시도` */
export function PictureLoadNotes({ missing, failed, retry }: { missing: string[]; failed: boolean; retry: () => void }) {
  if (missing.length === 0 && !failed) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      {missing.map((n) => (
        <span key={n} className="flex items-center gap-1 break-all"><ImageOff className="size-3.5 shrink-0" aria-hidden />{missingAssetText("pictures", n)}</span>
      ))}
      {failed && (
        <Button type="button" variant="outline" size="xs" onClick={retry}><RotateCw data-icon="inline-start" />불러오지 못한 그림 다시 시도</Button>
      )}
    </div>
  );
}

