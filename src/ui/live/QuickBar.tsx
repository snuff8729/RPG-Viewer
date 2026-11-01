import type { ReactNode } from "react";
import { Swords } from "lucide-react";
import { useFavorites } from "@/app/FavoritesProvider";
import { useLive } from "@/app/LiveProvider";
import { isRemoteView } from "@/app/share";
import { keyLabel, liveHotkeys } from "@/core/live/assist";
import type { AssistFavoriteId } from "@/core/live/favoritesFile";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { AssistCommandButton, AssistToggle, AutoSpeedControl, SpeedControl, WalkSpeedControl } from "./AssistControls";
import { assistItemLabel, battleBarLabel, BATTLE_BAR_ITEMS, quickBarItems, withObjectParticle } from "./assistItems";
import { BackupNowButton, RestoreLatestButton } from "./BackupControls";
import { useAssistGuards } from "./useAssistSession";

/** 이름이 보이는 고르기 묶음(배속 등): 작은 이름 + ToggleGroup */
function Labeled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </span>
  );
}

function QuickItem({ id }: { id: AssistFavoriteId }): ReactNode {
  switch (id) {
    case "speed": return <Labeled label={assistItemLabel("speed")}><SpeedControl short /></Labeled>;
    case "walkSpeed": return <Labeled label={assistItemLabel("walkSpeed")}><WalkSpeedControl short /></Labeled>;
    case "skipSeen": case "noRandomEncounter": case "skipBattles": case "skipKnownOnly": return <AssistToggle item={id} />;
    case "autoFast":
      return (
        <span className="inline-flex items-center gap-1">
          <AssistToggle item="autoFast" />
          <AutoSpeedControl short />
        </span>
      );
    case "backup": return <BackupNowButton short />;
    case "restore": return <RestoreLatestButton short />;
    case "win": case "lose": case "escape": case "enemyHpFull": case "enemyHpLow": return null;
    default: return <AssistCommandButton id={id} short />;
  }
}

/** 지기: 게임 오버 전투에서 게임 창 지기 단축키가 걸려 있으면 Tooltip으로 알려요. */
function LoseButton() {
  const { live } = useLive();
  const { inBattle, canLose } = useAssistGuards();
  const loseKey = liveHotkeys(live?.assist).lose;
  const button = <AssistCommandButton id="lose" variant="outline" />;
  if (!inBattle || canLose || loseKey === null) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild><span className="inline-flex">{button}</span></TooltipTrigger>
      <TooltipContent>이 전투는 지면 게임 오버예요. 게임 창에서 {withObjectParticle(keyLabel(loseKey))} 눌러도 게임 오버가 돼요</TooltipContent>
    </Tooltip>
  );
}

const ROW = "flex min-h-11 shrink-0 items-center gap-2 overflow-x-auto border-b px-3 py-1.5 whitespace-nowrap [scrollbar-width:thin] [&>*]:shrink-0";

/** 전투 막대: 전투 중이면 위쪽 막대 전체가 이것으로 바뀌어요(고정과 상관없이). 오른쪽 끝에 배속. */
function BattleBar() {
  return (
    <div role="toolbar" aria-label="전투" className={cn(ROW, "bg-destructive/10")}>
      <Badge variant="destructive"><Swords />전투 중</Badge>
      {BATTLE_BAR_ITEMS.map((id) => id === "lose"
        ? <LoseButton key={id} />
        : <AssistCommandButton key={id} id={id} label={battleBarLabel(id)} variant={id === "win" ? "default" : "outline"} />)}
      <span className="ml-auto pl-2"><SpeedControl short /></span>
    </div>
  );
}

/**
 * 플레이 화면 둘째 줄(게임과 연결됐을 때만): 평소엔 위쪽 막대에 고정한 보조 기능, 전투 중엔 전투 막대.
 * 한 줄로만 보이고 넘치면 가로로 스크롤해요. 확인 절차(지기·퀵 로드·복원)는 보조 모듈과 같아요.
 */
export function QuickBar() {
  const { connection, live } = useLive();
  const { assistFavorites } = useFavorites();
  if (connection !== "connected") return null;
  if (live?.inBattle === true) return <BattleBar />;
  // 휴대폰 보기는 백업·복원을 하지 않아요(PC에서)
  const ids = quickBarItems(assistFavorites, { hidden: isRemoteView() ? ["backup", "restore"] : [] });
  return (
    <div role="toolbar" aria-label="위쪽 막대(고정한 보조 기능)" className={ROW}>
      {ids.length === 0
        ? <span className="text-xs text-muted-foreground">보조에서 핀을 누르면 여기에 고정돼요</span>
        : ids.map((id) => <QuickItem key={id} id={id} />)}
    </div>
  );
}
