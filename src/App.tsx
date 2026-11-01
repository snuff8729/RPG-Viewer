import { useEffect, useState } from "react";
import { ThemeProvider } from "@/app/ThemeProvider";
import { GameProvider, useGame } from "@/app/GameProvider";
import { useRoute } from "@/app/route";
import { TooltipProvider } from "@/components/ui/tooltip";
import { StartScreen } from "@/ui/StartScreen";
import { SearchDialog } from "@/ui/SearchDialog";
import { AppHeader } from "@/ui/AppHeader";
import { BottomNavigation } from "@/ui/BottomNavigation";
import { MoreView } from "@/ui/MoreView";
import { BrowseView } from "@/ui/BrowseView";
import { ManageView } from "@/ui/manage/ManageView";
import { useExplorerState } from "@/ui/useExplorerState";
import { LiveProvider } from "@/app/LiveProvider";
import { AddonsProvider } from "@/app/AddonsProvider";
import { FavoritesProvider } from "@/app/FavoritesProvider";
import { ReaderFileProvider } from "@/app/ReaderFileProvider";
import { parseModuleWindow } from "@/app/popout";
import { ModuleWindow } from "@/ui/live/ModuleWindow";
import { useAutoReopen } from "@/app/useAutoReopen";
import { PlayView } from "@/ui/live/PlayView";
import { BackupHotkeys } from "@/ui/live/BackupHotkeys";
import { AutoBackupWatcher } from "@/ui/live/AutoBackupWatcher";
import { useShareFollowsGame } from "@/ui/live/useShareFollowsGame";
import { isRemoteView } from "@/app/share";
import { useRemoteGame } from "@/app/useRemoteGame";
import { RemoteScreen } from "@/ui/RemoteScreen";
import { DiagnosisProvider } from "@/app/DiagnosisProvider";

function Shell() {
  const { status, data, index } = useGame();
  const [route] = useRoute();
  const [searchOpen, setSearchOpen] = useState(false);
  const [explorer, setExplorer] = useExplorerState(route, true);
  const [moduleWin] = useState(() => parseModuleWindow(window.location.search));
  useAutoReopen(moduleWin?.game ?? null);
  const remote = isRemoteView();
  const remoteGame = useRemoteGame(remote);
  useShareFollowsGame(!remote && status === "ready");
  useEffect(() => {
    if (status !== "ready") return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "k" || e.code === "KeyK")) {
        e.preventDefault(); setSearchOpen(o => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [status]);
  if (remote) {
    const loadError = status === "error" ? "게임을 열지 못했어요. PC에서 게임이 열려 있는지 확인해 주세요." : null;
    const err = remoteGame.error ?? loadError;
    if (err !== null || status !== "ready" || !data || !index) return <RemoteScreen error={err} onRetry={remoteGame.retry} />;
  }
  if (moduleWin && !remote && (route.kind === "play")) return <><ModuleWindow {...moduleWin} /><SearchDialog open={searchOpen} onOpenChange={setSearchOpen} /></>;
  if (status !== "ready" || !data || !index) return <StartScreen />;
  return <div className="flex h-svh min-w-0 flex-col overflow-hidden">
    <AppHeader route={route} onSearch={() => setSearchOpen(true)} />
    <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
      {route.kind === "play" && <PlayView />}
      {(route.kind === "browse" || route.kind === "page") && <BrowseView route={route} state={explorer} onStateChange={setExplorer} />}
      {route.kind === "manage" && <ManageView section={route.section} />}
      {route.kind === "more" && <MoreView onSearch={() => setSearchOpen(true)} />}
    </main>
    <BottomNavigation route={route} />
    <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
  </div>;
}

export default function App() {
  return (
    <ThemeProvider><TooltipProvider>
      <GameProvider>
        <AddonsProvider>
          <LiveProvider>
            {/* 게임 창 단축키의 백업·복원(PC만, 화면에 그리지 않음) */}
            <BackupHotkeys />
            <AutoBackupWatcher />
            <FavoritesProvider>
              <ReaderFileProvider>
                <DiagnosisProvider>
                  <Shell />
                </DiagnosisProvider>
              </ReaderFileProvider>
            </FavoritesProvider>
          </LiveProvider>
        </AddonsProvider>
      </GameProvider>
    </TooltipProvider></ThemeProvider>
  );
}
