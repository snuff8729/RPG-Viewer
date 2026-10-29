import { AppWindow, PictureInPicture2 } from "lucide-react";
import { useGame } from "@/app/GameProvider";
import { POPOUT_LABEL, type PopoutModule } from "@/app/popout";
import { isRemoteView } from "@/app/share";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { focusPopout, popOut, reclaim, usePoppedOut } from "./popouts";

/** 이 모듈이 지금 떼어져 있는지(지금 연 게임에서) */
// eslint-disable-next-line react-refresh/only-export-components
export function useModulePoppedOut(module: PopoutModule): boolean {
  const { recentKey } = useGame();
  return usePoppedOut(module, recentKey);
}

/** `새 창으로 떼기` 아이콘 버튼. 휴대폰 보기에서는 그리지 않는다(PC만). 이미 떼어져 있으면 그 창을 앞으로. */
export function PopoutButton({ module, className }: { module: PopoutModule; className?: string }) {
  const { recentKey } = useGame();
  if (isRemoteView()) return null;
  const label = `${POPOUT_LABEL[module]} 새 창으로 떼기`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost" size="icon-sm" aria-label={label} className={className}
          onClick={() => { if (!focusPopout(module)) popOut(module, recentKey); }}
        >
          <PictureInPicture2 />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * 떼어 낸 모듈 자리: "따로 창에서 보는 중" + 창 보기(이 창이 연 창일 때) · 다시 가져오기.
 * variant="panel"은 칸 가운데에, "strip"은 한 줄로(맵을 떼어 도구 칸이 넓어졌을 때 위에).
 */
export function PoppedOutNotice({ module, variant = "panel", className }: {
  module: PopoutModule; variant?: "panel" | "strip"; className?: string;
}) {
  const { recentKey } = useGame();
  const text = `${POPOUT_LABEL[module]}: 따로 창에서 보는 중`;
  const buttons = (
    <div className="flex gap-2">
      <Button variant="outline" size="sm" onClick={() => { if (!focusPopout(module)) popOut(module, recentKey); }}>
        <AppWindow />창 보기
      </Button>
      <Button size="sm" onClick={() => reclaim(module, recentKey)}>다시 가져오기</Button>
    </div>
  );
  if (variant === "strip") {
    return (
      <div className={cn("flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-1.5", className)}>
        <PictureInPicture2 className="size-4 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">{text}</span>
        <div className="ml-auto">{buttons}</div>
      </div>
    );
  }
  return (
    <div className={cn("flex h-full min-h-40 flex-col items-center justify-center gap-3 p-6 text-center", className)}>
      <PictureInPicture2 className="size-6 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">{text}</p>
      {buttons}
    </div>
  );
}
