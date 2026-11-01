import { useRoute } from "@/app/route";
import { ReadModule } from "./ReadModule";
import { NotConnectedEmpty } from "./NotConnectedEmpty";
import { MapDetailsButton } from "./MapDetailsButton";
import { useEffect, useMemo, useState } from "react";
import { ChevronUp, ListChecks } from "lucide-react";
import { LiveFreeze, useLive } from "@/app/LiveProvider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AssistFavoritesBar } from "./AssistFavoritesBar";
import { AssistTab } from "./AssistTab";
import { CheatContent, onOpenCheatRequest } from "./cheat/CheatContent";
import { useCheatSession } from "./cheat/useCheatSession";
import { isPlayTab, loadPlayTab, savePlayTab, type PlayTab } from "./mobilePlay";
import { isMapBelowTab, loadMapBelowTab, saveMapBelowTab, type MapBelowTab } from "./playLayout";
import { MapPicture, NextStory, PlayMapProvider, TodoList } from "./PlayMap";
import { useAssistSession } from "./useAssistSession";
import { usePlayMap } from "./usePlayMapState";

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
            <div className="flex justify-end"><MapDetailsButton /></div>
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

/** 공통 머리줄과 아래 탭 사이에 기존 모듈 내용을 보여줘요. 읽기는 숨겨도 위치를 유지해요. */
export function MobilePlayView() {
  const { connection } = useLive();
  const [route] = useRoute();
  const [savedTab, setTabState] = useState<PlayTab>(loadPlayTab);
  const tab = route.kind === "play" ? route.module ?? savedTab : savedTab;
  const setTab = (t: PlayTab) => { setTabState(t); savePlayTab(t); window.location.hash = `#/play/${t}`; };
  const cheatSession = useCheatSession("switches");
  const assistSession = useAssistSession();

  // 다른 곳에서 치트를 열어 달라고 하면 치트 탭으로
  useEffect(() => onOpenCheatRequest(() => { setTabState("cheat"); savePlayTab("cheat"); window.location.hash = "#/play/cheat"; }), []);

  const reader = useMemo(() => <ReadModule mobile />, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
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
            {connection === "connected" ? <MobileMapTab /> : <NotConnectedEmpty />}
          </PlayMapProvider>
        </TabsContent>
        {/* 읽기는 늘 살려 두고 숨기기만 한다. 숨긴 동안은 기록·게임 상태를 멈춰 두어 다시 그리지 않는다(긴 기록에서 휴대폰이 버벅이지 않게) */}
        <TabsContent value="read" forceMount className="min-h-0 px-2 data-[state=inactive]:hidden">
          <LiveFreeze active={tab === "read"}>{reader}</LiveFreeze>
        </TabsContent>

      </Tabs>
    </div>
  );
}
