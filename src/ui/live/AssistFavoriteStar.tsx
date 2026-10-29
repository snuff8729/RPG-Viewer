import { Star } from "lucide-react";
import { useFavorites } from "@/app/FavoritesProvider";
import type { AssistFavoriteId } from "@/core/live/favoritesFile";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { assistFavoriteLabel } from "./assistItems";

/** 보조 조작 옆 ☆: 누르면 맨 위 줄(보조 즐겨찾기)에 올리고 내린다. 즐겨찾기면 채운 별. */
export function AssistFavoriteStar({ id, className }: { id: AssistFavoriteId; className?: string }) {
  const { isAssistFavorite, toggleAssistFavorite } = useFavorites();
  const on = isAssistFavorite(id);
  const label = `${assistFavoriteLabel(id)} ${on ? "맨 위 줄에서 내리기" : "맨 위 줄에 올리기"}`;
  return (
    <Button
      variant="ghost" size="icon-xs" aria-label={label} title={label} aria-pressed={on}
      className={cn(on ? "text-foreground" : "text-muted-foreground", className)}
      onClick={() => toggleAssistFavorite(id)}
    >
      <Star className={cn(on && "fill-current")} />
    </Button>
  );
}
