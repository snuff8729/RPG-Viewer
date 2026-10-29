import { useRef } from "react";
import { useDefaultLayout } from "react-resizable-panels";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { AssistFavoritesBar } from "./AssistFavoritesBar";
import { ConnectionBadge } from "./ConnectionBadge";
import { MapColumn } from "./PlayMapColumn";
import { PlayMenu } from "./PlayMenu";
import { safeStore, type PlayLayout } from "./playLayout";
import { PlayTopBarMapName } from "./PlayTopBarMapName";
import { PopoutButton, PoppedOutNotice, useModulePoppedOut } from "./PopoutControls";
import { ToolsColumn } from "./PlayTools";
import { usePlayLayout } from "./usePlayLayout";
import { MobilePlayView } from "./MobilePlayView";
import { useIsMobile } from "@/hooks/use-mobile";

const layoutStore = safeStore();

/**
 * 맨 위: 첫 줄은 연결 상태·지금 맵·남은 것과 `⋯` 메뉴(실행·휴대폰으로 보기·백업·게임 설정),
 * 둘째 줄은 보조 즐겨찾기(왼쪽부터, 짧은 이름, 넘치면 줄 바꿈).
 */
function PlayTopBar({ popup }: { popup: boolean }) {
  return (
    <header className="flex shrink-0 flex-col border-b">
      <div className="flex h-12 items-center gap-3 px-3">
        {!popup && (
          <>
            <SidebarTrigger />
            <Separator orientation="vertical" className="h-4 data-vertical:self-center" />
          </>
        )}
        <ConnectionBadge />
        <PlayTopBarMapName />
        <div className="ml-auto flex items-center gap-2">
          <PlayMenu />
        </div>
      </div>
      <AssistFavoritesBar size="sm" className="px-3 pb-2" />
    </header>
  );
}

/** 맵 칸 + 도구 칸. 넓으면 나란히(맵 왼쪽), 좁으면 맵 위·도구 아래. 크기는 배치마다 따로 기억한다. */
function PlayPanels({ layout }: { layout: PlayLayout }) {
  const side = layout === "side";
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({ id: side ? "rpgv.play2.side" : "rpgv.play2.stacked", storage: layoutStore });
  return (
    <ResizablePanelGroup orientation={side ? "horizontal" : "vertical"} defaultLayout={defaultLayout} onLayoutChanged={onLayoutChanged}>
      <ResizablePanel id="map" defaultSize={side ? "50%" : "45%"} minSize={side ? "25%" : 240}>
        <MapColumn actions={<PopoutButton module="map" />} layoutId={side ? "rpgv.play2.map.side" : "rpgv.play2.map.stacked"} />
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel id="tools" defaultSize={side ? "50%" : "55%"} minSize={side ? 320 : 200}>
        <ToolsColumn />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

/**
 * 플레이 화면: 게임 옆에 두고 보는 맵 + 도구(치트·보조·읽기). 따로 띄운 창(popup)에서는 사이드바가 없다.
 * 휴대폰 너비(따로 띄운 창 제외)는 한 번에 한 패널 + 아래 탭(MobilePlayView).
 */
export function PlayView({ popup = false }: { popup?: boolean }) {
  const isMobile = useIsMobile();
  if (isMobile && !popup) return <MobilePlayView />;
  return <DesktopPlayView popup={popup} />;
}

function DesktopPlayView({ popup }: { popup: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const layout = usePlayLayout(ref);
  // 맵을 따로 창으로 뗐으면 도구 칸이 다 쓴다
  const mapOut = useModulePoppedOut("map");
  return (
    <div className="flex h-svh min-h-0 flex-col">
      <PlayTopBar popup={popup} />
      {mapOut && <PoppedOutNotice module="map" variant="strip" />}
      <div ref={ref} className="min-h-0 flex-1">
        {mapOut ? <ToolsColumn /> : <PlayPanels key={layout} layout={layout} />}
      </div>
    </div>
  );
}
