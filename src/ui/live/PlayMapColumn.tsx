import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useDefaultLayout, usePanelRef } from "react-resizable-panels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MapPicture, NextStory, PlayMapProvider, TodoList } from "./PlayMap";
import { isMapBelowTab, loadMapBelowTab, safeStore, saveMapBelowTab, type MapBelowTab } from "./playLayout";
import { usePlayMap } from "./usePlayMapState";

const layoutStore = safeStore();

/** 접었을 때 남는 탭 줄 높이(px) */
const BAR_PX = 44;

function NotConnectedNote() {
  return <p className="px-1 text-xs text-muted-foreground">게임이 연결되면 보여요</p>;
}

function MapColumnBody({ actions, layoutId }: { actions?: ReactNode; layoutId: string }) {
  const { here, rows } = usePlayMap();
  const connected = !!here.live && !!here.checklist;
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({ id: layoutId, storage: layoutStore });
  const below = usePanelRef();
  const [collapsed, setCollapsed] = useState(false);
  const [tab, setTab] = useState<MapBelowTab>(loadMapBelowTab);

  const onTab = (v: string) => {
    if (!isMapBelowTab(v)) return;
    setTab(v);
    saveMapBelowTab(v);
    // 접힌 채로 탭을 누르면 펼친다
    if (below.current?.isCollapsed()) below.current.expand();
  };
  const toggle = () => {
    const p = below.current;
    if (!p) return;
    if (p.isCollapsed()) p.expand();
    else p.collapse();
  };

  return (
    <ResizablePanelGroup orientation="vertical" defaultLayout={defaultLayout} onLayoutChanged={onLayoutChanged}>
      <ResizablePanel id="picture" minSize={120}>
        <div className="h-full min-h-0 p-2">
          <MapPicture />
        </div>
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel
        id="below" defaultSize="32%" minSize={120} collapsible collapsedSize={BAR_PX} panelRef={below}
        onResize={(size) => setCollapsed(size.inPixels <= BAR_PX + 1)}
      >
        <Tabs value={tab} onValueChange={onTab} className="h-full min-h-0 gap-0">
          <div className="flex shrink-0 items-center gap-1 px-2 py-1.5">
            <TabsList>
              <TabsTrigger value="todo">
                해 볼 것{connected && <Badge variant="secondary" className="h-4 min-w-4 px-1 tabular-nums">{rows.length}</Badge>}
              </TabsTrigger>
              <TabsTrigger value="story">다음 스토리</TabsTrigger>
            </TabsList>
            <div className="ml-auto flex items-center gap-1">
              {actions}
              <Button variant="ghost" size="icon-sm" aria-label={collapsed ? "목록 펼치기" : "목록 접기"} onClick={toggle}>
                {collapsed ? <ChevronUp /> : <ChevronDown />}
              </Button>
            </div>
          </div>
          <TabsContent value="todo" className="flex min-h-0 flex-col px-2 pb-2">
            {connected ? <TodoList header={false} className="min-h-0 flex-1" /> : <NotConnectedNote />}
          </TabsContent>
          <TabsContent value="story" className="min-h-0 overflow-y-auto px-2 pb-2">
            {connected ? <NextStory /> : <NotConnectedNote />}
          </TabsContent>
        </Tabs>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

/**
 * 맵 칸(PC 플레이 화면 왼쪽·따로 띄운 맵 창): 맵 그림이 칸을 채우고, 아래에 `해 볼 것 N | 다음 스토리` 탭 칸.
 * 아래 칸은 크기를 끌어 바꾸고 접을 수 있다(크기·접힘·탭 기억). 해 볼 것 줄을 누르면 맵이 그 점으로, 맵 점을 누르면 목록이 그 줄로.
 * actions = 아래 탭 줄 오른쪽에 둘 것(예: 새 창으로 떼기).
 */
export function MapColumn({ actions, layoutId = "rpgv.play.mapColumn" }: { actions?: ReactNode; layoutId?: string }) {
  return (
    <PlayMapProvider>
      <MapColumnBody actions={actions} layoutId={layoutId} />
    </PlayMapProvider>
  );
}
