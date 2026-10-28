import { Package, Swords } from "lucide-react";
import { battleActionLabel, type BattleAction } from "@/core/live/battleLine";
import { Badge } from "@/components/ui/badge";

/** 전투 로그의 기술·아이템 사용 줄: `{쓴 쪽}: {이름}` 배지(아군 secondary · 적 outline · 모름 ghost) + 대상 */
export function BattleActionLine({ action }: { action: BattleAction }) {
  const Icon = action.itemKind === "item" ? Package : Swords;
  const variant = !action.by ? "ghost" : action.enemy ? "outline" : "secondary";
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <Badge variant={variant} className="max-w-full">
        <Icon data-icon="inline-start" />
        <span className="truncate">{battleActionLabel(action)}</span>
      </Badge>
      {action.targets.length > 0 && <span className="text-xs text-muted-foreground">→ {action.targets.join(", ")}</span>}
    </div>
  );
}
