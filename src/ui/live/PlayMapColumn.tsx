import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useDefaultLayout, usePanelRef } from "react-resizable-panels";
import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { terms } from "@/ui/terms";
import { NotConnectedEmpty } from "./NotConnectedEmpty";
import { MapChips, MapList, MapPicture, PlayMapProvider } from "./PlayMap";
import { safeStore } from "./playLayout";
import { usePlayMap } from "./usePlayMapState";

const layoutStore = safeStore();

/** 접었을 때 남는 목록 제목 줄 높이(px) */
const BAR_PX = 40;

function MapColumnBody({ actions, layoutId }: { actions?: ReactNode; layoutId: string }) {
  const { here } = usePlayMap();
  const connected = !!here.live && !!here.checklist;
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({ id: layoutId, storage: layoutStore });
  const below = usePanelRef();
  const [collapsed, setCollapsed] = useState(false);
  const toggle = () => {
    const p = below.current;
    if (!p) return;
    if (p.isCollapsed()) p.expand();
    else p.collapse();
  };

  if (!connected) return <NotConnectedEmpty />;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <MapChips actions={actions} className="border-b px-2 py-1.5" />
      <ResizablePanelGroup orientation="vertical" defaultLayout={defaultLayout} onLayoutChanged={onLayoutChanged} className="min-h-0 flex-1">
        <ResizablePanel id="picture" minSize={120}>
          <div className="h-full min-h-0 p-2">
            <MapPicture />
          </div>
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel
          id="below" defaultSize="40%" minSize={120} collapsible collapsedSize={BAR_PX} panelRef={below}
          onResize={(size) => setCollapsed(size.inPixels <= BAR_PX + 1)}
        >
          <div className="flex h-full min-h-0 flex-col">
            <div className="flex h-10 shrink-0 items-center gap-2 px-3">
              <span className="text-sm font-medium">{terms.todo(here.checklist?.remaining ?? 0)} · 다음 스토리</span>
              <Button variant="ghost" size="icon-sm" className="ml-auto" aria-label={collapsed ? "목록 펼치기" : "목록 접기"} onClick={toggle}>
                {collapsed ? <ChevronUp /> : <ChevronDown />}
              </Button>
            </div>
            {!collapsed && <MapList className="min-h-0 flex-1 overflow-y-auto px-2 pb-3" />}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

/**
 * 맵 칸(PC 플레이 화면 왼쪽·따로 띄운 맵 창): 위에 구역 칩 줄, 맵 그림이 칸을 채우고, 아래에 목록(다음 스토리·해 볼 것·다른 맵).
 * 아래 목록은 크기를 끌어 바꾸고 접을 수 있어요(크기·접힘 기억). 줄을 누르면 맵이 그 점으로, 맵 점을 누르면 목록이 그 줄로.
 * actions = 칩 줄 오른쪽 끝에 둘 것(예: 새 창으로 떼기).
 */
export function MapColumn({ actions, layoutId = "rpgv.play.mapColumn" }: { actions?: ReactNode; layoutId?: string }) {
  return (
    <PlayMapProvider>
      <MapColumnBody actions={actions} layoutId={layoutId} />
    </PlayMapProvider>
  );
}
