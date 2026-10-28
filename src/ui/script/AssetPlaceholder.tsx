import { ImageOff, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AssetView } from "./useAssetUrl";

/**
 * 그림이 없거나 못 읽었을 때 자리. missing은 게임 폴더에 없는 그림, failed는 다시 시도 버튼.
 * compact는 얼굴처럼 작은 칸: 아이콘만 보이고 글은 툴팁·스크린리더로.
 */
export function AssetPlaceholder({ view, name, className, compact = false }: {
  view: Extract<AssetView, { status: "missing" | "failed" }>;
  name: string;
  className?: string;
  compact?: boolean;
}) {
  const box = cn(
    "flex shrink-0 items-center justify-center gap-1 rounded-md border border-dashed bg-muted/40 text-muted-foreground",
    compact ? "p-0" : "flex-col p-2 text-center text-xs break-all",
    className,
  );
  if (view.status === "missing") {
    const text = `게임 폴더에 없는 그림: ${name}`;
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
