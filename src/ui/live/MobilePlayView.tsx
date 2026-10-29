import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, Ellipsis, ExternalLink, ListChecks, Map as MapIcon, Radio, Star, Wrench } from "lucide-react";
import { useGame } from "@/app/GameProvider";
import { useLive } from "@/app/LiveProvider";
import { PLAY_WINDOW_FEATURES, PLAY_WINDOW_NAME, playPopupUrl } from "@/app/popup";
import { isRemoteView } from "@/app/share";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { GameSettingsSheet } from "../addons/GameSettingsSheet";
import { AssistPanel } from "./AssistPanel";
import { BackupButton } from "./BackupButton";
import { CheatSheet } from "./cheat/CheatSheet";
import { useConnectionStatus } from "./useConnectionStatus";
import { HereNotConnected } from "./HereNotConnected";
import { InstallDialog } from "./InstallDialog";
import { LaunchButton } from "./LaunchButton";
import { choiceAppeared, countLines, isPlayTab, loadPlayTab, savePlayTab, unseenLines, type PlayTab } from "./mobilePlay";
import { NextStoryCard } from "./NextStoryCard";
import { PlayMap } from "./PlayMap";
import { ReaderView } from "./ReaderView";
import { ShareButton } from "./ShareButton";
import { useMapChecklist } from "./useMapChecklist";

/** 휴대폰 위쪽 한 줄: 사이드바·연결 점·지금 맵, 나머지는 모두 `더보기` 메뉴에. */
function MobileTopBar({ onTab }: { onTab: (t: PlayTab) => void }) {
  const { data, recentKey } = useGame();
  const { live, connection } = useLive();
  const status = useConnectionStatus();
  // 메뉴에는 앞의 ●/○ 없이(아이콘이 대신한다)
  const statusText = status.text.replace(/^[●○] /, "");
  const checklist = useMapChecklist();
  const remote = isRemoteView();
  const [installOpen, setInstallOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
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
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="더보기"><Ellipsis /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
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
          </DropdownMenuGroup>
          {/* 휴대폰 보기는 읽기만: 실행·공유·백업·보조·치트·설정을 숨긴다 */}
          {!remote && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem onSelect={() => setToolsOpen(true)}><Wrench />게임 도구</DropdownMenuItem>
                <DropdownMenuItem onSelect={openWindow}><ExternalLink />새 창으로 열기</DropdownMenuItem>
              </DropdownMenuGroup>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {!remote && (
        <>
          <InstallDialog open={installOpen} onOpenChange={setInstallOpen} />
          <Sheet open={toolsOpen} onOpenChange={setToolsOpen}>
            <SheetContent side="bottom">
              <SheetHeader>
                <SheetTitle>게임 도구</SheetTitle>
                <SheetDescription>실행·휴대폰으로 보기·백업·게임 보조·치트·게임 설정</SheetDescription>
              </SheetHeader>
              <div className="flex flex-wrap items-center gap-2 px-4 pb-6">
                <LaunchButton />
                <ShareButton />
                <BackupButton />
                <AssistPanel />
                <CheatSheet />
                <GameSettingsSheet />
              </div>
            </SheetContent>
          </Sheet>
        </>
      )}
    </header>
  );
}

/** 지금 선택지를 알아보는 키(없으면 null) */
function useChoiceKey(): string | null {
  const { live } = useLive();
  const c = live?.choice;
  return c ? JSON.stringify([c.src, c.cmd, c.options]) : null;
}

/**
 * 휴대폰 너비 플레이 화면: 위 한 줄 + 한 번에 한 패널(읽기·맵·스토리) + 아래 탭.
 * 읽기는 다른 탭에서도 살려 둬(읽은 위치·따라가기 유지) 새 대사 수를 탭에 보여 준다. 새 선택지가 뜨면 읽기로 넘긴다.
 */
export function MobilePlayView() {
  const { records, live, connection } = useLive();
  const [tab, setTabState] = useState<PlayTab>(loadPlayTab);
  const setTab = (t: PlayTab) => { setTabState(t); savePlayTab(t); };

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

  const connected = connection === "connected" && !!live;
  return (
    <div className="flex h-svh min-h-0 flex-col">
      <MobileTopBar onTab={setTab} />
      <Tabs value={tab} onValueChange={(v) => { if (isPlayTab(v)) setTab(v); }} className="min-h-0 flex-1 gap-0">
        {/* 읽기는 늘 살려 두고 숨기기만 한다 */}
        <TabsContent value="read" forceMount className="min-h-0 px-2 data-[state=inactive]:hidden">
          <ReaderView mobile />
        </TabsContent>
        <TabsContent value="map" className="min-h-0">
          <PlayMap story={false} />
        </TabsContent>
        <TabsContent value="story" className="min-h-0 overflow-y-auto p-3">
          {connected ? <NextStoryCard /> : <HereNotConnected />}
        </TabsContent>
        <TabsList className="h-14 w-full shrink-0 rounded-none border-t group-data-horizontal/tabs:h-14">
          <TabsTrigger value="read" className="flex-col gap-0.5 text-xs">
            <BookOpen />읽기
            {unseen > 0 && (
              <Badge className="absolute top-0.5 left-1/2 ml-2 h-4 min-w-4 rounded-full px-1 tabular-nums" aria-label={`새 대사 ${unseen}`}>
                {unseen > 99 ? "99+" : unseen}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="map" className="flex-col gap-0.5 text-xs"><MapIcon />맵</TabsTrigger>
          <TabsTrigger value="story" className="flex-col gap-0.5 text-xs"><Star />스토리</TabsTrigger>
        </TabsList>
      </Tabs>
    </div>
  );
}
