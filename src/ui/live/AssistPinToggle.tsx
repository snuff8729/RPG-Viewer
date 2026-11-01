import { Pin } from "lucide-react";
import { useFavorites } from "@/app/FavoritesProvider";
import type { AssistFavoriteId } from "@/core/live/favoritesFile";
import { Toggle } from "@/components/ui/toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { terms } from "@/ui/terms";
import { assistFavoriteLabel, pinnable } from "./assistItems";

/** 보조 조작 옆 고정 핀: 누르면 위쪽 막대에 고정하거나 풀어요(favorites.json의 보조 칸). 전투 기능은 고정하지 않아요. */
export function AssistPinToggle({ id, className }: { id: AssistFavoriteId; className?: string }) {
  const { isAssistFavorite, toggleAssistFavorite } = useFavorites();
  if (!pinnable(id)) return null;
  const on = isAssistFavorite(id);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Toggle
          size="sm" pressed={on} onPressedChange={() => toggleAssistFavorite(id)}
          aria-label={`${assistFavoriteLabel(id)} ${terms.pinAssist}`}
          // 켜져도 칸을 채우지 않고 아이콘만 채워요(보조 카드에서 핀이 조작보다 튀지 않게)
          className={cn("text-muted-foreground aria-pressed:bg-transparent aria-pressed:text-foreground data-[state=on]:bg-transparent data-[state=on]:text-foreground hover:aria-pressed:bg-muted", className)}
        >
          <Pin className={cn(on && "fill-current")} />
        </Toggle>
      </TooltipTrigger>
      <TooltipContent>{on ? "위쪽 막대에서 풀기" : terms.pinAssist}</TooltipContent>
    </Tooltip>
  );
}
