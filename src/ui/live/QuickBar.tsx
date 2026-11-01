import { Fragment, type ReactNode } from "react";
import { Swords } from "lucide-react";
import { useFavorites } from "@/app/FavoritesProvider";
import { useLive } from "@/app/LiveProvider";
import { isRemoteView } from "@/app/share";
import { keyLabel, liveHotkeys } from "@/core/live/assist";
import type { AssistFavoriteId } from "@/core/live/favoritesFile";
import { Badge } from "@/components/ui/badge";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
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
        <span className="inline-flex items-center gap-2">
          <AssistToggle item="autoFast" />
          <Labeled label="자동 배속 빠르기"><AutoSpeedControl short /></Labeled>
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

/**
 * 한 줄 막대: 넘치면 가로로 밀어 봐요. 휴대폰에서 굵은 기본 스크롤바가 보이지 않게
 * shadcn ScrollArea의 얇은 가로 막대(내용 위에 겹쳐 보임)를 써요.
 */
function BarRow({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <ScrollArea className={cn("w-full shrink-0 border-b", className)}>
      <div role="toolbar" aria-label={label} className="flex min-h-11 w-max min-w-full items-center gap-2 px-3 py-1.5 whitespace-nowrap [&>*]:shrink-0">
        {children}
      </div>
      <ScrollBar orientation="horizontal" className="data-horizontal:h-1.5" />
    </ScrollArea>
  );
}

/** 칸 사이 세로 구분선: 이웃한 묶음이 한 덩어리로 읽히지 않게 */
function ItemSeparator() {
  return <Separator orientation="vertical" className="data-vertical:h-5 data-vertical:self-center" />;
}

/** 전투 막대: 전투 중이면 위쪽 막대 전체가 이것으로 바뀌어요(고정과 상관없이). 오른쪽 끝에 배속. */
function BattleBar() {
  return (
    <BarRow label="전투" className="bg-destructive/10">
      <Badge variant="destructive"><Swords />전투 중</Badge>
      {BATTLE_BAR_ITEMS.map((id) => id === "lose"
        ? <LoseButton key={id} />
        : <AssistCommandButton key={id} id={id} label={battleBarLabel(id)} variant={id === "win" ? "default" : "outline"} />)}
      <span className="ml-auto inline-flex items-center gap-2 pl-2">
        <ItemSeparator />
        <Labeled label={assistItemLabel("speed")}><SpeedControl short /></Labeled>
      </span>
    </BarRow>
  );
}

/**
 * 플레이 화면 둘째 줄(게임과 연결됐을 때만): 평소엔 위쪽 막대에 고정한 보조 기능, 전투 중엔 전투 막대.
 * 한 줄로만 보이고 넘치면 가로로 밀어 봐요. 칸마다 세로 구분선과 이름이 붙어 따로 읽혀요.
 * 확인 절차(지기·퀵 로드·복원)는 보조 모듈과 같아요.
 */
export function QuickBar() {
  const { connection, live } = useLive();
  const { assistFavorites } = useFavorites();
  if (connection !== "connected") return null;
  if (live?.inBattle === true) return <BattleBar />;
  // 휴대폰 보기는 백업·복원을 하지 않아요(PC에서)
  const ids = quickBarItems(assistFavorites, { hidden: isRemoteView() ? ["backup", "restore"] : [] });
  return (
    <BarRow label="위쪽 막대(고정한 보조 기능)">
      {ids.length === 0
        ? <span className="text-xs text-muted-foreground">보조에서 핀을 누르면 여기에 고정돼요</span>
        : ids.map((id, i) => (
          <Fragment key={id}>
            {i > 0 && <ItemSeparator />}
            <QuickItem id={id} />
          </Fragment>
        ))}
    </BarRow>
  );
}
