import type { ReactNode } from "react";
import { useFavorites } from "@/app/FavoritesProvider";
import { useLive } from "@/app/LiveProvider";
import { isRemoteView } from "@/app/share";
import { keyLabel, liveHotkeys } from "@/core/live/assist";
import type { AssistFavoriteId } from "@/core/live/favoritesFile";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  AssistCommandButton, AutoFastControl, AutoSpeedControl, EncounterControl, SkipSeenControl, SpeedControl, WalkSpeedControl, type AssistControlSize,
} from "./AssistControls";
import { visibleAssistFavorites, withObjectParticle } from "./assistItems";
import { BackupNowButton, RestoreLatestButton } from "./BackupControls";
import { useAssistGuards } from "./useAssistSession";

export interface AssistFavoritesBarProps {
  /** sm = PC 맨 위 줄(작게, 줄 바꿈), lg = 휴대폰(크게). 어느 쪽이든 짧은 이름(긴 이름은 툴팁). */
  size?: AssistControlSize;
  /** 전투 중이면 전투 기능을 맨 앞으로(휴대폰) */
  battleFirst?: boolean;
  /** 스위치 id 앞에 붙일 것: 같은 화면에 보조 탭(기본 id)과 함께 있을 때 id가 겹치지 않게. 기본 "fav-bar" */
  idPrefix?: string;
  /** 바깥 칸 모양(기본: 줄 바꿈하는 가로 줄) */
  className?: string;
}

/** 지기: 게임 오버 전투에서 게임 창 지기 단축키가 걸려 있으면 툴팁으로 알린다(보조 탭 안내 글과 같은 조건). */
function LoseButton({ size }: { size: AssistControlSize }) {
  const { live } = useLive();
  const { inBattle, canLose } = useAssistGuards();
  const loseKey = liveHotkeys(live?.assist).lose;
  const button = <AssistCommandButton id="lose" size={size} short />;
  if (!inBattle || canLose || loseKey === null) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild><span className="inline-flex">{button}</span></TooltipTrigger>
      <TooltipContent>이 전투는 지면 게임 오버예요. 게임 창에서 {withObjectParticle(keyLabel(loseKey))} 눌러도 게임 오버가 돼요</TooltipContent>
    </Tooltip>
  );
}

function FavoriteControl({ id, size, idPrefix }: { id: AssistFavoriteId; size: AssistControlSize; idPrefix: string }): ReactNode {
  switch (id) {
    case "speed": return <SpeedControl size={size} short />;
    case "walkSpeed": return <WalkSpeedControl size={size} short />;
    case "skipSeen": return <SkipSeenControl id={`${idPrefix}-skip-seen`} short />;
    case "autoFast":
      return (
        <span className="inline-flex items-center gap-1.5">
          <AutoFastControl id={`${idPrefix}-auto-fast`} short />
          <AutoSpeedControl size={size} short />
        </span>
      );
    case "noRandomEncounter": case "skipBattles": case "skipKnownOnly":
      return <EncounterControl item={id} id={`${idPrefix}-${id}`} short />;
    case "lose": return <LoseButton size={size} />;
    case "backup": return <BackupNowButton size={size} short />;
    case "restore": return <RestoreLatestButton size={size} short />;
    default: return <AssistCommandButton id={id} size={size} short />;
  }
}

/**
 * 맨 위 줄: 사용자가 ☆로 올린 보조 기능을 순서대로(useFavorites().assistFavorites). 전투 기능은 전투 중에만 보인다.
 * 확인 절차(지기·퀵 로드·복원)는 보조 탭과 같다. 비었으면 "보조 탭에서 ☆로 추가" 안내.
 */
export function AssistFavoritesBar({ size = "sm", battleFirst = false, idPrefix = "fav-bar", className }: AssistFavoritesBarProps) {
  const { assistFavorites } = useFavorites();
  const { live } = useLive();
  // 휴대폰 보기는 백업·복원을 하지 않는다(PC에서)
  const hidden: AssistFavoriteId[] = isRemoteView() ? ["backup", "restore"] : [];
  const ids = visibleAssistFavorites(assistFavorites, live?.inBattle === true, { battleFirst, hidden });
  if (assistFavorites.length === 0) {
    return <p className={cn("text-xs text-muted-foreground", className)}>보조 탭에서 ☆로 추가</p>;
  }
  if (ids.length === 0) return null;
  return (
    <div
      role="group" aria-label="보조 즐겨찾기"
      className={cn("flex flex-wrap items-center", size === "sm" ? "gap-x-3 gap-y-1.5" : "gap-x-3 gap-y-2.5", className)}
    >
      {ids.map((id) => <FavoriteControl key={id} id={id} size={size} idPrefix={idPrefix} />)}
    </div>
  );
}
