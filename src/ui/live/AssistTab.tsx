import { ChevronRight, CircleAlert } from "lucide-react";
import { useAssist, useLive } from "@/app/LiveProvider";
import {
  ASSIST_MIN_VERSION, ENCOUNTER_MIN_VERSION, ENEMY_HP_COMMAND_MIN_VERSION, HP_COMMAND_MIN_VERSION, hotkeySummary, keyLabel, liveHotkeys,
  SAVE_COMMAND_MIN_VERSION, WALK_SPEED_MIN_VERSION,
} from "@/core/live/assist";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { terms } from "@/ui/terms";
import {
  ASSIST_FAVORITE_GRID, AutoFastControl, AutoSpeedControl, BattleControls, EncounterControl, EnemyHpControls, HotkeySettings, HpControls,
  QuickSlotInput, SaveControls, SkipSeenControl, SpeedControl, WalkSpeedControl,
} from "./AssistControls";
import { withObjectParticle, type AssistFavoriteSlot } from "./assistItems";
import { AssistPinToggle } from "./AssistPinToggle";
import { BackupNowButton, RestoreLatestButton, useBackupControls } from "./BackupControls";
import { NotConnectedEmpty } from "./NotConnectedEmpty";
import { ConnectionActionButton, useConnectionAction } from "./ConnectionAction";
import { useConnectionStatus } from "./useConnectionStatus";
import { useAssistGuards, useAssistSession, type AssistSession } from "./useAssistSession";

export interface AssistTabProps {
  /** 남는 상태(명령 응답 글·단축키 불일치). 탭을 바꿔도 남게 늘 그려진 곳에서 useAssistSession()으로 만들어 넘긴다. */
  session?: AssistSession;
  /** 보이는 동안 true(단축키 잡기) */
  active?: boolean;
  className?: string;
}

const pin: AssistFavoriteSlot = (id) => <AssistPinToggle id={id} />;
const note = "text-xs text-muted-foreground";

/** 플러그인이 낮아 못 쓰는 것들을 한 번에 알려요(줄마다 반복하지 않아요). */
/** 업데이트 알림의 버튼: 디스크의 플러그인이 예전 것이면 [업데이트], 이미 새 것이면 다시 실행하라고만 알려요. */
function UpdateAction() {
  const ctl = useConnectionAction();
  if (ctl.status.remote) return <p>{terms.pcOnly}</p>;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {ctl.status.state === "update" ? <ConnectionActionButton action="update" ctl={ctl} size="sm" /> : <p>새 플러그인이 설치돼 있어요. 게임을 다시 실행하면 적용돼요.</p>}
      <Button variant="link" size="sm" className="h-auto p-0" asChild><a href="#/manage/connection">자세히</a></Button>
      {ctl.dialog}
    </div>
  );
}

/** 보조 화면에 업데이트 알림이 보이는지(단축키 불일치 같은 다른 업데이트 안내는 겹쳐 보이지 않게) */
function useUpdateNoticeShown(): boolean {
  const g = useAssistGuards();
  const { state } = useConnectionStatus();
  return state === "update" || !g.supported || !g.hpSupported || !g.saveSupported || !g.enemyHpSupported || !g.encounterSupported || !g.walkSpeedSupported;
}

function UpdateNotice() {
  const { live } = useLive();
  const g = useAssistGuards();
  const status = useConnectionStatus();
  if (!g.supported) {
    return (
      <Alert>
        <CircleAlert />
        <AlertTitle>기록 플러그인을 업데이트해 주세요</AlertTitle>
        <AlertDescription>
          <p>보조는 기록 플러그인 {ASSIST_MIN_VERSION} 이상에서 쓸 수 있어요{live?.pluginVersion ? ` (지금 ${live.pluginVersion})` : ""}.</p>
          <UpdateAction />
        </AlertDescription>
      </Alert>
    );
  }
  const missing: [string, string][] = [
    ...(!g.hpSupported ? [["내 체력", HP_COMMAND_MIN_VERSION] as [string, string]] : []),
    ...(!g.saveSupported ? [["세이브", SAVE_COMMAND_MIN_VERSION] as [string, string]] : []),
    ...(!g.enemyHpSupported ? [["적 체력", ENEMY_HP_COMMAND_MIN_VERSION] as [string, string]] : []),
    ...(!g.encounterSupported ? [["랜덤 전투 끄기·전투 건너뛰기", ENCOUNTER_MIN_VERSION] as [string, string]] : []),
    ...(!g.walkSpeedSupported ? [["이동 속도", WALK_SPEED_MIN_VERSION] as [string, string]] : []),
  ];
  if (missing.length === 0) {
    if (status.state !== "update") return null;
    return (
      <Alert>
        <CircleAlert />
        <AlertTitle>기록 플러그인을 업데이트해 주세요</AlertTitle>
        <AlertDescription>
          <UpdateAction />
        </AlertDescription>
      </Alert>
    );
  }
  const version = missing[missing.length - 1][1];
  return (
    <Alert>
      <CircleAlert />
      <AlertTitle>기록 플러그인을 {version}으로 업데이트하면 더 쓸 수 있어요</AlertTitle>
      <AlertDescription>
        <p>{missing.map(([name]) => name).join(" · ")}</p>
        <UpdateAction />
      </AlertDescription>
    </Alert>
  );
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">{children}</CardContent>
    </Card>
  );
}

function AssistCards({ session, active }: { session: AssistSession; active: boolean }) {
  const { settings } = useAssist();
  const { live } = useLive();
  const { inBattle, enemyHpSupported, hpSupported, saveSupported, canEscape, canLose } = useAssistGuards();
  const backup = useBackupControls();
  /** 게임이 기억하는 이겨 본 적 종류 수(플러그인 1.24.0) */
  const knownEnemies: unknown = live?.assist?.knownEnemies;
  const { statusText, hpSent, saveSent } = session;
  // 위에 업데이트 알림이 있으면 단축키 칸의 업데이트 안내는 겹쳐 보이지 않아요
  const updateShown = useUpdateNoticeShown();
  const showMismatch = session.showMismatch && !updateShown;
  /** 게임이 알려 준 지금의 퀵 세이브 칸 */
  const liveSlot: unknown = live?.assist?.quickSlot;
  /** 게임 창에서 실제로 걸린 지기 단축키 */
  const loseKey = liveHotkeys(live?.assist).lose;

  return (
    <>
      <Section title="진행 속도">
        <div className="flex flex-col gap-2">
          <Label>배속</Label>
          <SpeedControl favorite={pin("speed")} />
        </div>
        <div className="flex flex-col gap-2">
          <Label>이동 속도</Label>
          <WalkSpeedControl favorite={pin("walkSpeed")} />
          <p className={note}>맵에서 플레이어와 동료의 이동만 빨라져요. 탈것에도 적용돼요</p>
        </div>
      </Section>

      <Section title="대사·이벤트">
        <div className="flex flex-col gap-1">
          <SkipSeenControl favorite={pin("skipSeen")} />
          <p className={note}>이미 본 대사는 바로 넘겨요</p>
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-1">
            <AutoFastControl favorite={pin("autoFast")} />
            <p className={note}>대사·선택지를 모두 본 이벤트는 아래 빠르기로 돌려요</p>
          </div>
          <div className="flex items-center gap-2 pl-6">
            <Label className={note}>빠르기</Label>
            <AutoSpeedControl />
          </div>
        </div>
      </Section>

      <Section title="전투">
        <div className="flex flex-col gap-1">
          <EncounterControl item="noRandomEncounter" favorite={pin("noRandomEncounter")} />
          <p className={note}>걸어 다녀도 랜덤 전투가 일어나지 않아요</p>
        </div>
        <div className="flex flex-col gap-1">
          <EncounterControl item="skipBattles" favorite={pin("skipBattles")} />
          <p className={note}>전투 화면 없이 바로 이기고 경험치·골드·아이템을 받아요. 대화가 있는 전투는 그대로 싸워요</p>
        </div>
        {settings.skipBattles && (
          <div className="flex flex-col gap-1 pl-6">
            <EncounterControl item="skipKnownOnly" favorite={pin("skipKnownOnly")} />
            <p className={note}>
              모든 적을 한 번이라도 이겨 본 전투만 건너뛰어요{typeof knownEnemies === "number" ? ` (이겨 본 적 ${knownEnemies}종)` : ""}
            </p>
          </div>
        )}
        <Separator />
        <div className="flex flex-col gap-2">
          <BattleControls />
          <EnemyHpControls />
          {!inBattle && <p className={note}>전투 중에만 쓸 수 있어요</p>}
          {inBattle && enemyHpSupported && <p className={note}>적 체력 1%는 적을 쓰러뜨리지 않아요</p>}
          {inBattle && canLose && <p className={note}>패배 장면이 있는 전투면 그 장면이 나와요</p>}
          {inBattle && !canEscape && <p className={note}>이 전투는 도망칠 수 없어요</p>}
          {inBattle && !canLose && loseKey !== null && (
            <p className={note}>지금 {withObjectParticle(keyLabel(loseKey))} 누르면 게임 오버가 돼요</p>
          )}
          {statusText !== null && !hpSent && !saveSent && <p className={note}>{statusText}</p>}
        </div>
        <div className="flex flex-col gap-2">
          <Label>내 체력</Label>
          <HpControls favorite={pin} />
          {hpSupported && <p className={note}>파티 전원에게 적용돼요. 100%는 쓰러진 동료도 살려요</p>}
          {statusText !== null && hpSent && <p className={note}>{statusText}</p>}
        </div>
      </Section>

      <Section title="세이브·백업">
        <SaveControls favorite={pin} />
        <QuickSlotInput />
        {saveSupported && (
          <p className={note}>
            맵에서 이벤트가 없을 때만 돼요(불러오기는 타이틀에서도).{typeof liveSlot === "number" ? ` 지금 퀵 세이브 칸: ${liveSlot}번` : ""}
          </p>
        )}
        {statusText !== null && saveSent && <p className={note}>{statusText}</p>}
        {backup && (
          <>
            <Separator />
            <div className={ASSIST_FAVORITE_GRID}>
              <BackupNowButton favorite={<AssistPinToggle id="backup" />} />
              <RestoreLatestButton favorite={<AssistPinToggle id="restore" />} />
            </div>
            <p className={note}>
              {backup.path ? "복원은 가장 최근의 직접·자동 백업으로 되돌리고 게임을 다시 켜요(게임 창 단축키 복원과 같아요)" : "관리의 연결·실행에서 게임 폴더 위치를 먼저 정해 주세요"}
            </p>
          </>
        )}
      </Section>

      <Collapsible className="rounded-xl ring-1 ring-foreground/10">
        <CollapsibleTrigger className="group flex w-full items-center gap-2 px-3 py-3 text-sm font-medium">
          <ChevronRight className="size-4 transition-transform group-data-[state=open]:rotate-90" />
          단축키
        </CollapsibleTrigger>
        <CollapsibleContent className="flex flex-col gap-3 px-3 pb-3">
          <HotkeySettings showMismatch={showMismatch} active={active} />
          <p className={note}>{hotkeySummary(settings.hotkeys)}</p>
        </CollapsibleContent>
      </Collapsible>
    </>
  );
}

function AssistOwnSession({ active }: { active: boolean }) {
  const session = useAssistSession();
  return <AssistCards session={session} active={active} />;
}

/**
 * 보조 모듈(PC 도구 칸·따로 창·휴대폰 보조 탭이 같이 써요): 진행 속도 · 대사·이벤트 · 전투 · 세이브·백업 · 단축키 Card 묶음.
 * 조작마다 고정 핀(위쪽 막대에 고정). 연결이 없으면 하나의 안내만 보여요.
 */
export function AssistTab({ session, active = true, className }: AssistTabProps) {
  const { connection } = useLive();
  if (connection !== "connected") return <NotConnectedEmpty />;
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <UpdateNotice />
      {session ? <AssistCards session={session} active={active} /> : <AssistOwnSession active={active} />}
    </div>
  );
}
