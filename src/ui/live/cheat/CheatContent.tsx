import { NotConnectedEmpty } from "../NotConnectedEmpty";
import { useEffect } from "react";
import { useAssist, useLive, useLiveData } from "@/app/LiveProvider";
import { CHEAT_MIN_VERSION, CHEAT_STATUS_TEXT, type CheatStatus } from "@/core/live/cheat";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { ActorsTab } from "./ActorsTab";
import { ItemsTab } from "./ItemsTab";
import { SwitchesTab } from "./SwitchesTab";
import { useCheatSession, type CheatSession } from "./useCheatSession";

const OPEN_EVENT = "rpgv:open-cheat";
/** 다른 곳(게임 보조 창)에서 치트 창을 연다 */
// eslint-disable-next-line react-refresh/only-export-components
export function openCheatSheet(): void {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

/** 치트를 열어 달라는 요청을 듣는다(PC 플레이 화면은 치트 탭으로 바꾼다). 그만 듣는 함수를 돌려준다. */
// eslint-disable-next-line react-refresh/only-export-components
export function onOpenCheatRequest(cb: () => void): () => void {
  window.addEventListener(OPEN_EVENT, cb);
  return () => window.removeEventListener(OPEN_EVENT, cb);
}

/** 기록 하나의 상태: 묶음들 중 가장 나쁜 것 */
function entryStatus(keys: string[], results: ReadonlyMap<string, CheatStatus>): CheatStatus {
  const all = keys.map((k) => results.get(k) ?? "queued");
  for (const s of ["failed", "noResponse", "ignored", "notApplied", "queued", "sent"] as const) if (all.includes(s)) return s;
  return "applied";
}

const STATUS_VARIANT: Record<CheatStatus, "default" | "secondary" | "destructive" | "outline"> = {
  queued: "outline", sent: "outline", applied: "secondary", ignored: "outline", failed: "destructive", notApplied: "outline", noResponse: "destructive",
};

export interface CheatContentProps {
  /**
   * 남는 상태(기록·탭·변수 찾기). 덮개처럼 닫히면 내용이 사라지는 곳은 바깥(늘 그려진 곳)에서 useCheatSession()으로 만들어 넘긴다.
   * 없으면 이 컴포넌트가 직접 가진다(늘 그려진 칸에 둘 때).
   */
  session?: CheatSession;
  /** 보이는 동안 true: 그동안 게임이 캐릭터 정보를 보낸다(기본 true) */
  active?: boolean;
  /** 탭을 바깥에서 정할 때(items · actors · switches). 없으면 session의 탭 */
  tab?: string;
  onTabChange?: (tab: string) => void;
  /** 바깥 칸 여백(기본: 덮개 안 여백 "px-4 pb-4") */
  className?: string;
  /** 변수(스위치·변수 탭)를 맨 앞 탭으로(휴대폰). 처음 보일 탭은 session(useCheatSession("switches"))이 정한다. */
  variablesFirst?: boolean;
}

/** 치트 내용(덮개 없이 칸에 바로 둘 수 있다): 아이템·돈, 캐릭터, 스위치·변수, 바꾼 것. 바꾼 것은 실행 중인 게임에 바로 적용된다. */
export function CheatContent(props: CheatContentProps) {
  return props.session ? <CheatBody {...props} session={props.session} /> : <CheatContentOwn {...props} />;
}

function CheatContentOwn(props: CheatContentProps) {
  const session = useCheatSession();
  return <CheatBody {...props} session={session} />;
}

function CheatBody({ session, active = true, tab, onTabChange, className, variablesFirst }: CheatContentProps & { session: CheatSession }) {
  const data = useLiveData();
  const { live, connection } = useLive();
  const { cheatSupported, cheatResults, holdLiveActors } = useAssist();
  const { history, apply, undo, finder } = session;

  // 보이는 동안 게임이 캐릭터 정보를 보낸다
  // 여러 곳(탭·덮개)에 있어도 LiveProvider가 세어서 하나라도 보이면 켜 둔다
  useEffect(() => {
    if (!active || !cheatSupported) return;
    return holdLiveActors();
  }, [active, cheatSupported, holdLiveActors]);

  if (!data) return null;
  if (connection !== "connected") return <NotConnectedEmpty />;
  const disabled = !cheatSupported;
  const connected = connection === "connected" && live !== null;
  const props = { data, live, disabled, apply };

  return (
    <div className={cn("flex flex-col gap-4", className ?? "px-4 pb-4")}>
      {disabled && (
        <Alert>
          <AlertDescription>
            게임이 연결되어 있어야 해요.
            {connected && ` 게임의 기록 플러그인(${live?.pluginVersion || "?"})을 ${CHEAT_MIN_VERSION}으로 업데이트하고 게임을 다시 실행해 주세요.`}
          </AlertDescription>
        </Alert>
      )}
      <Tabs value={tab ?? session.tab} onValueChange={onTabChange ?? session.setTab}>
        {/* 자주 쓰는 아이템·변수가 앞, 캐릭터는 뒤. 휴대폰은 변수부터 */}
        <TabsList className="w-full">
          {variablesFirst ? (
            <>
              <TabsTrigger value="switches">변수·스위치</TabsTrigger>
              <TabsTrigger value="items">아이템</TabsTrigger>
            </>
          ) : (
            <>
              <TabsTrigger value="items">아이템</TabsTrigger>
              <TabsTrigger value="switches">변수·스위치 (고급)</TabsTrigger>
            </>
          )}
          <TabsTrigger value="actors">캐릭터</TabsTrigger>
        </TabsList>
        <TabsContent value="items" className="pt-2"><ItemsTab {...props} /></TabsContent>
        <TabsContent value="actors" className="pt-2"><ActorsTab {...props} /></TabsContent>
        <TabsContent value="switches" className="flex flex-col gap-4 pt-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm text-destructive">이야기 진행이 꼬일 수 있어요. 먼저 백업해 두세요.</p>
            <Button variant="link" size="sm" asChild><a href="#/manage/backups">관리 › 세이브 백업에서 백업할 수 있어요</a></Button>
          </div>
          <SwitchesTab {...props} finder={finder} />
        </TabsContent>
      </Tabs>
      {history.length > 0 && (
        <>
          <Separator />
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">바꾼 것</p>
            <ItemGroup className="gap-1">
              {history.map((e) => {
                const status = entryStatus(e.keys, cheatResults);
                return (
                  <Item key={e.n} variant="muted" size="xs">
                    <ItemContent className="min-w-40">
                      <ItemTitle>{e.label}</ItemTitle>
                      {!e.inverse && <ItemDescription>되돌릴 수 없어요</ItemDescription>}
                    </ItemContent>
                    <ItemActions>
                      <Badge variant={STATUS_VARIANT[status]}>{CHEAT_STATUS_TEXT[status]}</Badge>
                      {e.inverse && (
                        <Button variant="ghost" size="xs" disabled={disabled || e.undone || status !== "applied"} onClick={() => undo(e)}>
                          {e.undone ? "되돌림" : "되돌리기"}
                        </Button>
                      )}
                    </ItemActions>
                  </Item>
                );
              })}
            </ItemGroup>
          </div>
        </>
      )}
    </div>
  );
}

