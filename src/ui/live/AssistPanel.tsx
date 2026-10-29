import { useState } from "react";
import { Gauge } from "lucide-react";
import { useAssist, useLive } from "@/app/LiveProvider";
import { hotkeySummary, keyLabel, liveHotkeys } from "@/core/live/assist";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import {
  AutoFastControl, AutoSpeedControl, BattleControls, EnemyHpControls, HotkeySettings, HpControls, QuickSlotInput, SaveControls,
  SkipSeenControl, SpeedControl,
} from "./AssistControls";
import { withObjectParticle, type AssistFavoriteSlot } from "./assistItems";
import { useAssistGuards, useAssistSession, type AssistSession } from "./useAssistSession";


export interface AssistContentProps {
  /**
   * 남는 상태(명령 응답 글·단축키 불일치). 덮개처럼 닫히면 내용이 사라지는 곳은 바깥(늘 그려진 곳)에서 useAssistSession()으로
   * 만들어 넘긴다. 없으면 이 컴포넌트가 직접 가진다.
   */
  session?: AssistSession;
  /** 보이는 동안 true(false가 되면 단축키 잡기를 멈춘다). 기본 true */
  active?: boolean;
  /** 제목·안내 줄(기본 보임) */
  header?: boolean;
  /** 각 조작 옆에 둘 것(예: 즐겨찾기 ☆)을 id로 */
  favorite?: AssistFavoriteSlot;
}

/**
 * 게임 보조 내용(덮개 없이): 배속·본 대사 자동 넘기기·자동 배속·전투·체력·세이브·단축키.
 * 칸들을 Fragment로 내놓으므로 바깥에서 `flex flex-col gap-*`로 감싼다(PopoverContent는 이미 그렇다).
 */
export function AssistContent(props: AssistContentProps) {
  return props.session ? <AssistBody {...props} session={props.session} /> : <AssistContentOwn {...props} />;
}

function AssistContentOwn(props: AssistContentProps) {
  const session = useAssistSession();
  return <AssistBody {...props} session={session} />;
}

function AssistBody({ session, active = true, header = true, favorite }: AssistContentProps & { session: AssistSession }) {
  const { settings } = useAssist();
  const { live } = useLive();
  const { supported, inBattle, hpSupported, saveSupported, enemyHpSupported, canEscape, canLose } = useAssistGuards();
  const { statusText, hpSent, saveSent, showMismatch } = session;
  /** 게임이 알려 준 지금의 퀵 세이브 칸 */
  const liveSlot: unknown = live?.assist?.quickSlot;
  /** 게임 창에서 실제로 걸린 지기 단축키 */
  const loseKey = liveHotkeys(live?.assist).lose;

  return (
    <>
      {header && (
        <PopoverHeader>
          <PopoverTitle>게임 보조</PopoverTitle>
          {!supported && <PopoverDescription>플러그인을 1.1.0으로 업데이트하면 쓸 수 있어요</PopoverDescription>}
        </PopoverHeader>
      )}
      <div className="flex flex-col gap-2">
        <Label>배속</Label>
        <SpeedControl favorite={favorite?.("speed")} />
      </div>
      <div className="flex flex-col gap-1">
        <SkipSeenControl favorite={favorite?.("skipSeen")} />
        <p className="text-xs text-muted-foreground">이미 본 대사는 바로 넘겨요</p>
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-1">
          <AutoFastControl favorite={favorite?.("autoFast")} />
          <p className="text-xs text-muted-foreground">대사·선택지를 모두 본 이벤트는 아래 빠르기로 돌려요</p>
        </div>
        <Label className="text-xs text-muted-foreground">빠르기</Label>
        <AutoSpeedControl />
      </div>
      <Separator />
      <div className="flex flex-col gap-2">
        <Label>전투</Label>
        <BattleControls favorite={favorite} />
        <EnemyHpControls favorite={favorite} />
        {!inBattle && <p className="text-xs text-muted-foreground">전투 중에만 쓸 수 있어요</p>}
        {supported && !enemyHpSupported && (
          <p className="text-xs text-muted-foreground">적 체력은 플러그인을 1.23.0으로 업데이트하면 쓸 수 있어요</p>
        )}
        {inBattle && enemyHpSupported && <p className="text-xs text-muted-foreground">적 체력 1%는 적을 쓰러뜨리지 않아요</p>}
        {inBattle && canLose && <p className="text-xs text-muted-foreground">패배 장면이 있는 전투면 그 장면이 나와요</p>}
        {inBattle && !canEscape && <p className="text-xs text-muted-foreground">이 전투는 도망칠 수 없어요</p>}
        {inBattle && !canLose && loseKey !== null && (
          <p className="text-xs text-muted-foreground">지금 {withObjectParticle(keyLabel(loseKey))} 누르면 게임 오버가 돼요</p>
        )}
        {statusText !== null && !hpSent && !saveSent && <p className="text-xs text-muted-foreground">{statusText}</p>}
      </div>
      <Separator />
      <div className="flex flex-col gap-2">
        <Label>내 체력</Label>
        <HpControls favorite={favorite} />
        {supported && !hpSupported && <p className="text-xs text-muted-foreground">플러그인을 1.12.0으로 업데이트하면 쓸 수 있어요</p>}
        {hpSupported && <p className="text-xs text-muted-foreground">파티 전원에게 적용돼요. 100%는 쓰러진 동료도 살려요</p>}
        {statusText !== null && hpSent && <p className="text-xs text-muted-foreground">{statusText}</p>}
      </div>
      <Separator />
      <div className="flex flex-col gap-2">
        <Label>세이브</Label>
        <SaveControls favorite={favorite} />
        <QuickSlotInput />
        {supported && !saveSupported && <p className="text-xs text-muted-foreground">플러그인을 1.21.0으로 업데이트하면 쓸 수 있어요</p>}
        {saveSupported && (
          <p className="text-xs text-muted-foreground">
            맵에서 이벤트가 없을 때만 돼요(불러오기는 타이틀에서도).{typeof liveSlot === "number" ? ` 지금 퀵 세이브 칸: ${liveSlot}번` : ""}
          </p>
        )}
        {statusText !== null && saveSent && <p className="text-xs text-muted-foreground">{statusText}</p>}
      </div>
      <Separator />
      <HotkeySettings showMismatch={showMismatch} active={active} />
      <Separator />
      <p className="text-xs text-muted-foreground">{hotkeySummary(settings.hotkeys)}</p>
    </>
  );
}

/** 상단 `게임 보조` Popover. 내용은 AssistContent, 남는 상태(명령 응답·단축키 불일치)는 여기서 가진다. */
export function AssistPanel() {
  const session = useAssistSession();
  const [panelOpen, setPanelOpen] = useState(false);
  return (
    <Popover open={panelOpen} onOpenChange={setPanelOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm"><Gauge />게임 보조</Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 max-h-(--radix-popover-content-available-height) overflow-auto">
        <AssistContent session={session} active={panelOpen} />
      </PopoverContent>
    </Popover>
  );
}
