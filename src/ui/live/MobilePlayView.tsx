import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, ChevronUp, ExternalLink, Gauge, ListChecks, Map as MapIcon, Radio, WandSparkles } from "lucide-react";
import { useGame } from "@/app/GameProvider";
import { useLive } from "@/app/LiveProvider";
import { PLAY_WINDOW_FEATURES, PLAY_WINDOW_NAME, playPopupUrl } from "@/app/popup";
import { isRemoteView } from "@/app/share";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuShortcut,
} from "@/components/ui/dropdown-menu";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { AssistFavoritesBar } from "./AssistFavoritesBar";
import { AssistTab } from "./AssistTab";
import { CheatContent, onOpenCheatRequest } from "./cheat/CheatSheet";
import { useCheatSession } from "./cheat/useCheatSession";
import { useConnectionStatus } from "./useConnectionStatus";
import { InstallDialog } from "./InstallDialog";
import { choiceAppeared, countLines, isPlayTab, loadPlayTab, savePlayTab, unseenLines, type PlayTab } from "./mobilePlay";
import { isMapBelowTab, loadMapBelowTab, saveMapBelowTab, type MapBelowTab } from "./playLayout";
import { MapPicture, NextStory, PlayMapProvider, TodoList } from "./PlayMap";
import { PlayMenu } from "./PlayMenu";
import { ReaderView } from "./ReaderView";
import { useAssistSession } from "./useAssistSession";
import { useMapChecklist } from "./useMapChecklist";
import { usePlayMap } from "./usePlayMapState";

/**
 * 휴대폰 위쪽 한 줄: 사이드바·연결 점·지금 맵, 나머지는 모두 `⋯` 메뉴에
 * (지금: 연결·맵·남은 것 / 새 창으로 열기 / 실행·휴대폰으로 보기·백업·게임 설정 — PlayMenu와 같다).
 * 게임 보조·치트는 아래 탭이다.
 */
function MobileTopBar({ onTab }: { onTab: (t: PlayTab) => void }) {
  const { data, recentKey } = useGame();
  const { live, connection } = useLive();
  const status = useConnectionStatus();
  // 메뉴에는 앞의 ●/○ 없이(아이콘이 대신한다)
  const statusText = status.text.replace(/^[●○] /, "");
  const checklist = useMapChecklist();
  const remote = isRemoteView();
  const [installOpen, setInstallOpen] = useState(false);
  const mapName = connection === "connected" && live && data ? (data.mapInfos[live.mapId]?.name || `#${live.mapId}`) : null;
  const openWindow = () => {
    window.open(playPopupUrl(window.location.pathname, recentKey), PLAY_WINDOW_NAME, PLAY_WINDOW_FEATURES)?.focus();
  };
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b px-2">
      <SidebarTrigger />
      <span
        aria-hidden
        className={cn("size-2 shrink-0 rounded-full", status.connected ? "bg-primary" : "bg-muted-foreground/40")}
      />
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{mapName ?? statusText}</span>
      <PlayMenu triggerSize="icon" contentClassName="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel>지금</DropdownMenuLabel>
          {/* 휴대폰 보기에서는 플러그인을 설치·제거하지 않는다 */}
          {remote ? (
            <DropdownMenuLabel className="flex items-center gap-2 font-normal text-foreground">
              <Radio className="size-4 text-muted-foreground" />{statusText}
            </DropdownMenuLabel>
          ) : (
            <DropdownMenuItem onSelect={() => setInstallOpen(true)}><Radio />{statusText}</DropdownMenuItem>
          )}
          {mapName && <DropdownMenuItem onSelect={() => onTab("map")}><MapIcon /><span className="truncate">{mapName}</span></DropdownMenuItem>}
          {checklist && (
            <DropdownMenuItem onSelect={() => onTab("map")}>
              <ListChecks />남은 것
              <DropdownMenuShortcut>{checklist.remaining}</DropdownMenuShortcut>
            </DropdownMenuItem>
          )}
          {!remote && <DropdownMenuItem onSelect={openWindow}><ExternalLink />새 창으로 열기</DropdownMenuItem>}
        </DropdownMenuGroup>
      </PlayMenu>
      {!remote && <InstallDialog open={installOpen} onOpenChange={setInstallOpen} />}
    </header>
  );
}

/** 지금 선택지를 알아보는 키(없으면 null) */
function useChoiceKey(): string | null {
  const { live } = useLive();
  const c = live?.choice;
  return c ? JSON.stringify([c.src, c.cmd, c.options]) : null;
}

function NotConnectedNote() {
  return <p className="text-sm text-muted-foreground">게임이 연결되면 보여요</p>;
}

/**
 * 맵 탭: 맵 그림이 화면을 채우고, 아래 손잡이 버튼(`해 볼 것 N · 다음 스토리`)을 누르거나 끌어 올리면 Drawer로 목록이 열린다.
 * 해 볼 것 줄을 누르면 Drawer를 닫고 맵이 그 점으로 간다.
 */
function MobileMapTab() {
  const { here, rows } = usePlayMap();
  const connected = !!here.live && !!here.checklist;
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<MapBelowTab>(loadMapBelowTab);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 p-2">
        <MapPicture />
      </div>
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerTrigger asChild>
          <Button variant="outline" className="mx-2 mb-2 h-10 shrink-0 justify-between" aria-label="해 볼 것·다음 스토리 열기">
            <span className="flex items-center gap-2">
              <ListChecks />해 볼 것
              {connected && <Badge variant="secondary" className="h-5 min-w-5 px-1 tabular-nums">{rows.length}</Badge>}
              <span className="text-muted-foreground">· 다음 스토리</span>
            </span>
            <ChevronUp />
          </Button>
        </DrawerTrigger>
        <DrawerContent>
          <DrawerHeader className="sr-only">
            <DrawerTitle>해 볼 것 · 다음 스토리</DrawerTitle>
            <DrawerDescription>이 맵에서 해 볼 것과 다음 스토리</DrawerDescription>
          </DrawerHeader>
          <Tabs
            value={tab}
            onValueChange={(v) => { if (isMapBelowTab(v)) { setTab(v); saveMapBelowTab(v); } }}
            className="min-h-0 flex-1 gap-2 px-3 pt-3 pb-4"
          >
            <TabsList className="w-full shrink-0">
              <TabsTrigger value="todo">
                해 볼 것{connected && <Badge variant="secondary" className="h-4 min-w-4 px-1 tabular-nums">{rows.length}</Badge>}
              </TabsTrigger>
              <TabsTrigger value="story">다음 스토리</TabsTrigger>
            </TabsList>
            <TabsContent value="todo" className="flex min-h-0 flex-col">
              {connected ? <TodoList header={false} className="min-h-0 flex-1" onChoose={() => setOpen(false)} /> : <NotConnectedNote />}
            </TabsContent>
            <TabsContent value="story" className="min-h-0 overflow-y-auto">
              {connected ? <NextStory /> : <NotConnectedNote />}
            </TabsContent>
          </Tabs>
        </DrawerContent>
      </Drawer>
    </div>
  );
}

/**
 * 휴대폰 너비 플레이 화면: 위 한 줄 + 한 번에 한 패널 + 아래 탭 `보조 | 치트 | 맵 | 읽기`(처음엔 보조, 마지막 탭 기억).
 * 보조 탭은 즐겨찾기를 큰 버튼으로 맨 위에(전투 중이면 전투 버튼이 맨 앞), 그 아래 나머지 보조. 치트 탭은 변수부터.
 * 읽기는 다른 탭에서도 살려 둬(읽은 위치·따라가기 유지) 새 대사 수를 탭에 보여 준다. 새 선택지가 뜨면 읽기로 넘긴다.
 * 탭을 바꿔도 남아야 하는 것(치트 기록·보조 응답 글)은 여기서 가진다.
 */
export function MobilePlayView() {
  const { records } = useLive();
  const [tab, setTabState] = useState<PlayTab>(loadPlayTab);
  const setTab = (t: PlayTab) => { setTabState(t); savePlayTab(t); };
  const cheatSession = useCheatSession("switches");
  const assistSession = useAssistSession();

  // 다른 곳에서 치트를 열어 달라고 하면 치트 탭으로
  useEffect(() => onOpenCheatRequest(() => { setTabState("cheat"); savePlayTab("cheat"); }), []);

  // 읽기 탭을 마지막으로 봤을 때의 대사 수(읽기 탭을 보는 동안은 계속 맞춘다)
  const lines = useMemo(() => countLines(records), [records]);
  const [seen, setSeen] = useState(lines);
  if (tab === "read" && seen !== lines) setSeen(lines);
  const unseen = tab === "read" ? 0 : unseenLines(seen, lines);

  const choiceKey = useChoiceKey();
  const prevChoice = useRef(choiceKey);
  useEffect(() => {
    if (choiceAppeared(prevChoice.current, choiceKey)) { setTabState("read"); savePlayTab("read"); }
    prevChoice.current = choiceKey;
  }, [choiceKey]);

  return (
    <div className="flex h-svh min-h-0 flex-col overflow-hidden">
      <MobileTopBar onTab={setTab} />
      <Tabs value={tab} onValueChange={(v) => { if (isPlayTab(v)) setTab(v); }} className="min-h-0 flex-1 gap-0">
        <TabsContent value="assist" className="relative min-h-0 overflow-y-auto">
          <div className="flex flex-col gap-4 p-3">
            <AssistFavoritesBar size="lg" battleFirst idPrefix="m-fav" />
            <Separator />
            <AssistTab session={assistSession} active={tab === "assist"} />
          </div>
        </TabsContent>
        <TabsContent value="cheat" className="relative min-h-0 overflow-y-auto">
          <CheatContent session={cheatSession} active={tab === "cheat"} variablesFirst className="p-3" />
        </TabsContent>
        <TabsContent value="map" className="min-h-0">
          <PlayMapProvider>
            <MobileMapTab />
          </PlayMapProvider>
        </TabsContent>
        {/* 읽기는 늘 살려 두고 숨기기만 한다 */}
        <TabsContent value="read" forceMount className="min-h-0 px-2 data-[state=inactive]:hidden">
          <ReaderView mobile />
        </TabsContent>
        <TabsList className="h-14 w-full shrink-0 rounded-none border-t group-data-horizontal/tabs:h-14">
          <TabsTrigger value="assist" className="flex-col gap-0.5 text-xs"><Gauge />보조</TabsTrigger>
          <TabsTrigger value="cheat" className="flex-col gap-0.5 text-xs"><WandSparkles />치트</TabsTrigger>
          <TabsTrigger value="map" className="flex-col gap-0.5 text-xs"><MapIcon />맵</TabsTrigger>
          <TabsTrigger value="read" className="flex-col gap-0.5 text-xs">
            <BookOpen />읽기
            {unseen > 0 && (
              <Badge className="absolute top-0.5 left-1/2 ml-2 h-4 min-w-4 rounded-full px-1 tabular-nums" aria-label={`새 대사 ${unseen}`}>
                {unseen > 99 ? "99+" : unseen}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>
      </Tabs>
    </div>
  );
}
