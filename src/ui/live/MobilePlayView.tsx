import { useEffect, useState } from "react";
import { ChevronUp } from "lucide-react";
import { useRoute } from "@/app/route";
import { useLive } from "@/app/LiveProvider";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { terms } from "@/ui/terms";
import { AssistTab } from "./AssistTab";
import { CheatContent, onOpenCheatRequest } from "./cheat/CheatContent";
import { useCheatSession } from "./cheat/useCheatSession";
import { isPlayTab, loadPlayTab, savePlayTab, type PlayTab } from "./mobilePlay";
import { NotConnectedEmpty } from "./NotConnectedEmpty";
import { MapBelowTabs } from "./MapBelowTabs";
import { MapChips, MapPicture, PlayMapProvider } from "./PlayMap";
import { useAssistSession } from "./useAssistSession";
import { usePlayMap } from "./usePlayMapState";

/**
 * 맵 탭: 위에 구역 칩 줄, 맵 그림이 화면을 채우고, 아래 손잡이(`해 볼 것 N · 다음 스토리`)를 누르거나 끌어 올리면
 * Drawer로 탭 목록(다음 스토리 | 해 볼 것 N).
 * 해 볼 것 줄을 누르면 Drawer를 닫고 맵이 그 점으로 가요.
 */
function MobileMapTab() {
  const { here } = usePlayMap();
  const [open, setOpen] = useState(false);
  if (!here.live || !here.checklist) return <NotConnectedEmpty />;
  const handle = `${terms.todo(here.checklist.remaining)} · 다음 스토리`;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <MapChips className="border-b px-2 py-1.5" />
      <div className="min-h-0 flex-1 p-2">
        <MapPicture />
      </div>
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerTrigger asChild>
          <Button variant="outline" className="mx-2 mb-2 h-10 shrink-0 justify-between" aria-label={`${handle} 열기`}>
            {handle}
            <ChevronUp />
          </Button>
        </DrawerTrigger>
        <DrawerContent className="h-[85svh] max-h-[85svh]">
          <DrawerHeader className="sr-only">
            <DrawerTitle>{handle}</DrawerTitle>
            <DrawerDescription>다음 스토리와 이 맵에서 해 볼 것</DrawerDescription>
          </DrawerHeader>
          <MapBelowTabs className="flex-1 pt-1" contentClassName="px-3 pt-2 pb-6" onChoose={() => setOpen(false)} />
        </DrawerContent>
      </Drawer>
    </div>
  );
}

/** 휴대폰(900px 미만): 공통 머리줄·위쪽 막대와 아래 탭 사이에 지금 탭 내용. 읽기는 아래 탭의 따로 화면(#/read)이에요. */
export function MobilePlayView() {
  const { connection } = useLive();
  const [route] = useRoute();
  const [savedTab, setTabState] = useState<PlayTab>(loadPlayTab);
  const asked = route.kind === "play" ? route.module : undefined;
  const tab: PlayTab = isPlayTab(asked) ? asked : savedTab;
  const setTab = (t: PlayTab) => { setTabState(t); savePlayTab(t); window.location.hash = `#/play/${t}`; };
  const cheatSession = useCheatSession();
  const assistSession = useAssistSession();

  // 다른 곳에서 치트를 열어 달라고 하면 치트 탭으로
  useEffect(() => onOpenCheatRequest(() => { setTabState("cheat"); savePlayTab("cheat"); window.location.hash = "#/play/cheat"; }), []);
  // 주소로 들어온 탭도 기억해요(다음에 열 때 그 탭)
  useEffect(() => { savePlayTab(tab); }, [tab]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <Tabs value={tab} onValueChange={(v) => { if (isPlayTab(v)) setTab(v); }} className="min-h-0 flex-1 gap-0">
        <TabsContent value="assist" className="relative min-h-0 overflow-y-auto">
          <AssistTab session={assistSession} active={tab === "assist"} className="p-3" />
        </TabsContent>
        <TabsContent value="cheat" className="relative min-h-0 overflow-y-auto">
          <CheatContent session={cheatSession} active={tab === "cheat"} className="p-3" />
        </TabsContent>
        <TabsContent value="map" className="min-h-0">
          <PlayMapProvider>
            {connection === "connected" ? <MobileMapTab /> : <NotConnectedEmpty />}
          </PlayMapProvider>
        </TabsContent>
      </Tabs>
    </div>
  );
}
