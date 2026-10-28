import { Pin, PinOff } from "lucide-react";
import { useGame } from "@/app/GameProvider";
import { pinGame, useRecentGames } from "@/app/recent";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** 상단: 지금 연 게임을 시작 화면의 고정 목록에 넣고 빼는 버튼. 다시 열 수 있게 연 게임만. */
export function PinGameButton() {
  const { recentKey } = useGame();
  const items = useRecentGames();
  const item = recentKey ? items.find((it) => it.key === recentKey) : undefined;
  if (!item) return null;
  const label = item.pinned ? "고정 해제" : "시작 화면에 고정";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={label} aria-pressed={item.pinned} onClick={() => pinGame(item.key, !item.pinned)}>
          {item.pinned ? <PinOff /> : <Pin />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
