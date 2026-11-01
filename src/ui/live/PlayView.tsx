import { useState } from "react";
import { useDefaultLayout, usePanelRef } from "react-resizable-panels";
import { useCompact } from "@/hooks/use-compact";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { MapColumn } from "./PlayMapColumn";
import { safeStore } from "./playLayout";
import { PopoutButton, PoppedOutNotice, useModulePoppedOut } from "./PopoutControls";
import { CollapsedTools, ToolsColumn } from "./PlayTools";
import { MobilePlayView } from "./MobilePlayView";
import { QuickBar } from "./QuickBar";
import { useLive } from "@/app/LiveProvider";
import { NotConnectedEmpty } from "./NotConnectedEmpty";

const layoutStore = safeStore();
/** 접은 도구 칸 너비(px): 펼치기·탭 아이콘만 세로로 */
const TOOLS_COLLAPSED_PX = 48;

/** PC(900px 이상): 왼쪽 맵 칸 + 오른쪽 도구 칸. 크기·접힘은 기억해요. 도구 칸은 340px보다 좁아지지 않고 접을 수 있어요. */
function PlayPanels() {
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({ id: "rpgv.play3.side", storage: layoutStore });
  const tools = usePanelRef();
  const [collapsed, setCollapsed] = useState(false);
  const toggle = () => {
    const p = tools.current;
    if (!p) return;
    if (p.isCollapsed()) p.expand();
    else p.collapse();
  };
  return (
    <ResizablePanelGroup orientation="horizontal" defaultLayout={defaultLayout} onLayoutChanged={onLayoutChanged}>
      <ResizablePanel id="map" defaultSize="55%" minSize="25%">
        <MapColumn actions={<PopoutButton module="map" />} layoutId="rpgv.play3.map.below" />
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel
        id="tools" defaultSize="45%" minSize={340} collapsible collapsedSize={TOOLS_COLLAPSED_PX} panelRef={tools}
        onResize={(size) => setCollapsed(size.inPixels <= TOOLS_COLLAPSED_PX + 1)}
      >
        {collapsed ? <CollapsedTools onExpand={toggle} /> : <ToolsColumn onCollapse={toggle} />}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

/** 플레이: 머리줄 아래 위쪽 막대(평소·전투), 그 아래 PC 두 칸 또는 휴대폰 탭 배치(900px 미만). */
export function PlayView() {
  const compact = useCompact();
  const mapOut = useModulePoppedOut("map");
  const { connection } = useLive();
  // 연결 전에는 칸·탭마다 안내하지 않고 플레이 화면 전체에 지금 할 단계 하나만 보여요.
  if (connection !== "connected") {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <NotConnectedEmpty />
      </div>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <QuickBar />
      {compact ? (
        <MobilePlayView />
      ) : (
        <>
          {mapOut && <PoppedOutNotice module="map" variant="strip" />}
          <div className="min-h-0 flex-1">{mapOut ? <ToolsColumn /> : <PlayPanels />}</div>
        </>
      )}
    </div>
  );
}
