import { useDefaultLayout } from "react-resizable-panels";
import { useCompact } from "@/hooks/use-compact";
import { useLive } from "@/app/LiveProvider";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { AssistFavoritesBar } from "./AssistFavoritesBar";
import { MapColumn } from "./PlayMapColumn";
import { safeStore } from "./playLayout";
import { PopoutButton, PoppedOutNotice, useModulePoppedOut } from "./PopoutControls";
import { ToolsColumn } from "./PlayTools";
import { MobilePlayView } from "./MobilePlayView";

const layoutStore = safeStore();
function PlayPanels() {
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({ id: "rpgv.play2.side", storage: layoutStore });
  return <ResizablePanelGroup orientation="horizontal" defaultLayout={defaultLayout} onLayoutChanged={onLayoutChanged}>
    <ResizablePanel id="map" defaultSize="50%" minSize="25%"><MapColumn actions={<PopoutButton module="map" />} layoutId="rpgv.play2.map.side" /></ResizablePanel>
    <ResizableHandle withHandle />
    <ResizablePanel id="tools" defaultSize="50%" minSize={340}><ToolsColumn /></ResizablePanel>
  </ResizablePanelGroup>;
}
/** 단위 2에서는 기존 모듈 내용을 공통 머리줄 아래에 둬요. */
export function PlayView() {
  const compact = useCompact();
  const { connection } = useLive();
  const mapOut = useModulePoppedOut("map");
  return <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
    {connection === "connected" && <AssistFavoritesBar size="sm" className="shrink-0 border-b px-3 py-2" />}
    {compact ? <MobilePlayView /> : <>
      {mapOut && <PoppedOutNotice module="map" variant="strip" />}
      <div className="min-h-0 flex-1">{mapOut ? <ToolsColumn /> : <PlayPanels />}</div>
    </>}
  </div>;
}
