import { useRef } from "react";
import { ExternalLink } from "lucide-react";
import { useDefaultLayout } from "react-resizable-panels";
import { useGame } from "@/app/GameProvider";
import { useLive } from "@/app/LiveProvider";
import { PLAY_WINDOW_FEATURES, PLAY_WINDOW_NAME, playPopupUrl } from "@/app/popup";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { AssistPanel } from "./AssistPanel";
import { CheatSheet } from "./cheat/CheatSheet";
import { GameSettingsSheet } from "../addons/GameSettingsSheet";
import { BackupButton } from "./BackupButton";
import { ConnectionBadge } from "./ConnectionBadge";
import { LaunchButton } from "./LaunchButton";
import { ShareButton } from "./ShareButton";
import { isRemoteView } from "@/app/share";
import { PlayMap } from "./PlayMap";
import { safeStore, type PlayLayout } from "./playLayout";
import { ReaderView } from "./ReaderView";
import { useMapChecklist } from "./useMapChecklist";
import { usePlayLayout } from "./usePlayLayout";
import { MobilePlayView } from "./MobilePlayView";
import { useIsMobile } from "@/hooks/use-mobile";

const layoutStore = safeStore();

/** 위쪽 얇은 줄: 연결 상태·지금 맵·남은 것, 새 창으로 열기와 실행·백업·게임 보조. */
function PlayTopBar({ popup }: { popup: boolean }) {
  const { data, recentKey } = useGame();
  const { live, connection } = useLive();
  const checklist = useMapChecklist();
  const mapName = connection === "connected" && live && data ? (data.mapInfos[live.mapId]?.name || `#${live.mapId}`) : null;
  const openWindow = () => {
    window.open(playPopupUrl(window.location.pathname, recentKey), PLAY_WINDOW_NAME, PLAY_WINDOW_FEATURES)?.focus();
  };
  return (
    <header className="flex min-h-12 shrink-0 flex-wrap items-center gap-2 border-b px-3 py-1.5">
      {!popup && (
        <>
          <SidebarTrigger />
          <Separator orientation="vertical" className="h-4" />
        </>
      )}
      <ConnectionBadge />
      {mapName && <span className="min-w-0 truncate text-sm font-medium">{mapName}</span>}
      {checklist && <Badge variant={checklist.remaining > 0 ? "default" : "secondary"}>남은 것 {checklist.remaining}</Badge>}
      {/* 휴대폰 보기는 읽기만: 실행·백업·보조·치트·설정을 숨긴다 */}
      {!isRemoteView() && (
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {!popup && <Button variant="outline" size="sm" onClick={openWindow}><ExternalLink />새 창으로 열기</Button>}
          <LaunchButton />
          <ShareButton />
          <BackupButton />
          <AssistPanel />
          <CheatSheet />
          <GameSettingsSheet />
        </div>
      )}
    </header>
  );
}

/** 읽기·맵 패널. 넓으면 나란히(읽기 왼쪽), 좁으면 맵 위·읽기 아래. 크기는 배치마다 따로 기억한다. */
function PlayPanels({ layout }: { layout: PlayLayout }) {
  const side = layout === "side";
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({ id: side ? "rpgv.play.side" : "rpgv.play.stacked", storage: layoutStore });
  const reader = (
    <ResizablePanel id="reader" defaultSize="55%" minSize="20%">
      {/* 읽기 화면은 자기 높이를 창 높이로 정한다 — 패널 높이에 맞춘다 */}
      <div className="flex h-full min-h-0 flex-col px-3 pt-2 pb-3 *:h-full! *:min-h-0">
        <ReaderView />
      </div>
    </ResizablePanel>
  );
  const map = (
    <ResizablePanel id="map" defaultSize="45%" minSize={side ? "25%" : 160}>
      <PlayMap />
    </ResizablePanel>
  );
  return (
    <ResizablePanelGroup orientation={side ? "horizontal" : "vertical"} defaultLayout={defaultLayout} onLayoutChanged={onLayoutChanged}>
      {side ? reader : map}
      <ResizableHandle withHandle />
      {side ? map : reader}
    </ResizablePanelGroup>
  );
}

/**
 * 플레이 화면: 게임 옆에 두고 보는 읽기 + 맵. 따로 띄운 창(popup)에서는 사이드바·새 창 버튼이 없다.
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
  return (
    <div className="flex h-svh min-h-0 flex-col">
      <PlayTopBar popup={popup} />
      <div ref={ref} className="min-h-0 flex-1">
        <PlayPanels key={layout} layout={layout} />
      </div>
    </div>
  );
}
