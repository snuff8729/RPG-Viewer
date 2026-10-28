import { Fragment, useEffect, useRef, useState } from "react";
import { GameProvider, useGame } from "@/app/GameProvider";
import { formatRoute, useRoute } from "@/app/route";
import { locationKey } from "@/core/index/locations";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import {
  Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { TooltipProvider } from "@/components/ui/tooltip";
import { StartScreen } from "@/ui/StartScreen";
import { AppSidebar } from "@/ui/AppSidebar";
import { EventView } from "@/ui/EventView";
import { ExplorerView } from "@/ui/ExplorerView";
import { useExplorerState } from "@/ui/useExplorerState";
import { SearchDialog } from "@/ui/SearchDialog";
import { VIEW_NAMES, viewOf } from "@/ui/views";
import { LiveProvider, useLive } from "@/app/LiveProvider";
import { AddonsProvider } from "@/app/AddonsProvider";
import { GameSettingsSheet } from "@/ui/addons/GameSettingsSheet";
import { popupGameKey } from "@/app/popup";
import { useAutoReopen } from "@/app/useAutoReopen";
import { PlayView } from "@/ui/live/PlayView";
import { loadPlaySidebar, savePlaySidebar } from "@/ui/live/playLayout";
import { AssistPanel } from "@/ui/live/AssistPanel";
import { CheatSheet } from "@/ui/live/cheat/CheatSheet";
import { LaunchButton } from "@/ui/live/LaunchButton";
import { PinGameButton } from "@/ui/PinGameButton";
import { BackupButton } from "@/ui/live/BackupButton";
import { HistoryView } from "@/ui/live/HistoryView";
import { ReaderView } from "@/ui/live/ReaderView";
import { MissingView } from "@/ui/live/MissingView";
import { HereView } from "@/ui/live/HereView";
import { DiagnosisProvider } from "@/app/DiagnosisProvider";
import { DiagnoseView } from "@/ui/diagnose/DiagnoseView";
import { DiagnoseBanner } from "@/ui/diagnose/DiagnoseBanner";

function Shell() {
  const { status, data, index, close } = useGame();
  const [route] = useRoute();
  const [searchOpen, setSearchOpen] = useState(false);
  /** 게임 속 맵을 찾아보기에서 펼쳐 따라간다 */
  const [follow, setFollow] = useState(true);
  const [explorer, setExplorer] = useExplorerState(route, follow);
  /** 못 본 것 화면에 미리 채울 검색어. n이 바뀌면 화면을 다시 마운트한다. */
  const [missingSeed, setMissingSeed] = useState({ n: 0, query: "" });
  const ready = status === "ready";
  const { connection } = useLive();
  /** 따로 띄운 플레이 창이면 다시 열 게임 key */
  const [popupKey] = useState(() => popupGameKey(window.location.search));
  useAutoReopen(popupKey);
  const isPlay = route.kind === "play";
  /** 사이드바 펼침: 플레이 화면은 따로 기억한다(처음엔 접힘) */
  const [navOpen, setNavOpen] = useState(true);
  const [playNavOpen, setPlayNavOpen] = useState(loadPlaySidebar);
  const onNavOpen = (v: boolean) => {
    if (isPlay) { setPlayNavOpen(v); savePlaySidebar(v); } else setNavOpen(v);
  };

  // 게임을 열고 처음 연결되면 플레이 화면으로(다른 화면을 이미 골랐으면 그대로)
  const playFor = useRef<unknown>(null);
  useEffect(() => {
    if (!ready || connection !== "connected" || playFor.current === data) return;
    playFor.current = data;
    const h = window.location.hash;
    if (h === "" || h === "#" || h === "#/") window.location.replace(formatRoute({ kind: "play" }));
  }, [ready, connection, data]);

  useEffect(() => {
    if (!ready) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "k" || e.code === "KeyK")) {
        e.preventDefault();
        setSearchOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ready]);

  if (status !== "ready" || !data || !index) return <StartScreen />;

  const entry = route.kind === "page"
    ? index.pages.find((p) => locationKey(p.location) === locationKey(route.location))
    : undefined;
  const crumbs = entry ? entry.path.split(" › ") : [];
  const openMissing = (query: string) => {
    setMissingSeed((s) => ({ n: s.n + 1, query }));
    window.location.hash = formatRoute({ kind: "missing" });
  };

  if (popupKey !== null && isPlay) return <PlayView popup />;

  return (
    <SidebarProvider open={isPlay ? playNavOpen : navOpen} onOpenChange={onNavOpen}>
      <AppSidebar
        route={route}
        follow={follow}
        onFollowChange={setFollow}
        onOpenMissing={openMissing}
        onSearch={() => setSearchOpen(true)}
        onClose={() => { setSearchOpen(false); close(); }}
      />
      <SidebarInset>
        {isPlay ? <PlayView /> : (<>
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger />
          <Separator orientation="vertical" className="h-4" />
          <Breadcrumb className="min-w-0">
            <BreadcrumbList className="flex-nowrap">
              {route.kind === "page" ? (
                <>
                  <BreadcrumbItem className="shrink-0">
                    <BreadcrumbLink href={formatRoute({ kind: "home" })}>{VIEW_NAMES.explore}</BreadcrumbLink>
                  </BreadcrumbItem>
                  {crumbs.map((c, i) => (
                    <Fragment key={i}>
                      <BreadcrumbSeparator />
                      <BreadcrumbItem className="min-w-0">
                        <BreadcrumbPage className={`truncate ${i === crumbs.length - 1 ? "" : "font-normal text-muted-foreground"}`}>{c}</BreadcrumbPage>
                      </BreadcrumbItem>
                    </Fragment>
                  ))}
                </>
              ) : (
                <BreadcrumbItem><BreadcrumbPage>{VIEW_NAMES[viewOf(route)]}</BreadcrumbPage></BreadcrumbItem>
              )}
            </BreadcrumbList>
          </Breadcrumb>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <PinGameButton />
            <LaunchButton />
            <BackupButton />
            <AssistPanel />
            <CheatSheet />
            <GameSettingsSheet />
          </div>
        </header>
        <main className="flex-1 p-4">
          {route.kind !== "diagnose" && <DiagnoseBanner />}
          {route.kind === "home" && <ExplorerView state={explorer} onStateChange={setExplorer} />}
          {route.kind === "page" && <EventView route={route} />}
          {route.kind === "read" && <ReaderView />}
          {route.kind === "here" && <HereView />}
          {route.kind === "history" && <HistoryView />}
          {route.kind === "missing" && <MissingView key={missingSeed.n} initialQuery={missingSeed.query} />}
          {route.kind === "diagnose" && <DiagnoseView />}
        </main>
        </>)}
      </SidebarInset>
      <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
    </SidebarProvider>
  );
}

export default function App() {
  return (
    <TooltipProvider>
      <GameProvider>
        <AddonsProvider>
          <LiveProvider>
            <DiagnosisProvider>
              <Shell />
            </DiagnosisProvider>
          </LiveProvider>
        </AddonsProvider>
      </GameProvider>
    </TooltipProvider>
  );
}
