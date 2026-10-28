import { ImageOff, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AssetKind } from "@/core/assets/assets";
import { textPictureLabel } from "@/core/text/textPicture";
import type { AssetView } from "./useAssetUrl";
import { missingAssetText } from "./assetText";

/** 파일 이름 없는 그림(글자 그림·플러그인 그림). 없는 파일로 보지 않고 흐린 글로 적는다. */
export function TextPictureNote({ caption, className }: { caption?: string; className?: string }) {
  return (
    <p className={cn("text-sm break-words text-muted-foreground", className)}>
      {textPictureLabel(caption)}
    </p>
  );
}

/**
 * 그림이 없거나 못 읽었을 때 자리. missing은 게임 폴더에 없는 그림, failed는 다시 시도 버튼.
 * compact는 얼굴처럼 작은 칸: 아이콘만 보이고 글은 툴팁·스크린리더로.
 */
export function AssetPlaceholder({ view, kind, name, pictureId, className, compact = false }: {
  view: Extract<AssetView, { status: "missing" | "failed" }>;
  kind: AssetKind;
  name: string;
  /** 그림 표시(231)의 그림 번호 */
  pictureId?: number;
  className?: string;
  compact?: boolean;
}) {
  const box = cn(
    "flex shrink-0 items-center justify-center gap-1 rounded-md border border-dashed bg-muted/40 text-muted-foreground",
    compact ? "p-0" : "flex-col p-2 text-center text-xs break-all",
    className,
  );
  if (view.status === "missing") {
    const text = missingAssetText(kind, name, pictureId);
    return (
      <div className={box} title={text} role="img" aria-label={text}>
        <ImageOff className="size-4 shrink-0" aria-hidden />
        {!compact && <span>{text}</span>}
      </div>
    );
  }
  const text = "불러오지 못함 — 다시 시도";
  return (
    <div className={box} title={`${name}: ${text}`}>
      {compact ? (
        <Button type="button" variant="ghost" size="icon-xs" onClick={view.retry} aria-label={`${name}: ${text}`}>
          <RotateCw />
        </Button>
      ) : (
        <Button type="button" variant="outline" size="xs" onClick={view.retry}>
          <RotateCw data-icon="inline-start" />
          {text}
        </Button>
      )}
    </div>
  );
}
