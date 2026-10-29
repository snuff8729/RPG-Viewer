import { useMemo } from "react";
import { BookOpen, EyeOff, FolderOpen, FolderTree, Gamepad2, History, MapPin, Search, Stethoscope, type LucideIcon } from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader,
  SidebarMenu, SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useGame } from "@/app/GameProvider";
import { useLive } from "@/app/LiveProvider";
import { formatRoute, type Route } from "@/app/route";
import { isRemoteView } from "@/app/share";
import { reachableCount } from "@/core/live/missingGroups";
import { useDiagnosis } from "@/app/DiagnosisProvider";
import { attentionCount } from "@/core/diagnose";
import { ErrorsBadge } from "./ErrorsBadge";
import { ConnectionBadge } from "./live/ConnectionBadge";
import { NowGroup } from "./live/NowGroup";
import { PlacesGroup } from "./live/PlacesGroup";
import { useMapChecklist } from "./live/useMapChecklist";
import { useMissingGroups } from "./live/useMissingGroups";
import { VIEW_NAMES, viewOf, type ViewKind } from "./views";

const NAV: { view: ViewKind; route: Route; icon: LucideIcon }[] = [
  { view: "play", route: { kind: "play" }, icon: Gamepad2 },
  { view: "read", route: { kind: "read" }, icon: BookOpen },
  { view: "here", route: { kind: "here" }, icon: MapPin },
  { view: "history", route: { kind: "history" }, icon: History },
  { view: "missing", route: { kind: "missing" }, icon: EyeOff },
  { view: "explore", route: { kind: "home" }, icon: FolderTree },
  { view: "diagnose", route: { kind: "diagnose" }, icon: Stethoscope },
];

export function AppSidebar({ route, follow, onFollowChange, onOpenMissing, onSearch, onClose }: {
  route: Route;
  follow: boolean; onFollowChange: (v: boolean) => void;
  /** 못 본 것으로 이동(검색어를 미리 채움) */
  onOpenMissing: (query: string) => void;
  onSearch: () => void; onClose: () => void;
}) {
  const { data } = useGame();
  const { connection } = useLive();
  const connected = connection === "connected";
  const checklist = useMapChecklist();
  const groups = useMissingGroups();
  // 연결 중이면 지금 갈 수 있는 이벤트 수, 아니면 전체 이벤트 그룹 수
  const missingCount = useMemo(
    () => (connected ? reachableCount(groups) : groups.reduce((s, g) => s + g.events.length, 0)),
    [connected, groups],
  );
  const { report } = useDiagnosis();
  const diagnoseCount = report ? attentionCount(report) : 0;
  const active = viewOf(route);
  const badge = (v: ViewKind): number | null =>
    v === "here" ? (checklist ? checklist.remaining : null) : v === "missing" ? missingCount
      : v === "diagnose" ? (diagnoseCount > 0 ? diagnoseCount : null) : null;

  return (
    <Sidebar>
      <SidebarHeader>
        <div className="flex flex-col gap-1.5 px-2 py-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-semibold">{data?.system.gameTitle}</span>
            {data && <Badge variant="secondary" className="shrink-0">{data.engine}</Badge>}
          </div>
          <div><ConnectionBadge /></div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>보기</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV.map(({ view, route: r, icon: Icon }) => {
                const n = badge(view);
                return (
                  <SidebarMenuItem key={view}>
                    <SidebarMenuButton asChild isActive={active === view}>
                      <a
                        href={formatRoute(r)}
                        // 못 본 것은 "가 볼 만한 곳"이 채운 검색어를 비우고 연다
                        onClick={view === "missing" ? (e) => { e.preventDefault(); onOpenMissing(""); } : undefined}
                      >
                        <Icon />
                        <span>{VIEW_NAMES[view]}</span>
                      </a>
                    </SidebarMenuButton>
                    {n !== null && <SidebarMenuBadge>{n}</SidebarMenuBadge>}
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <NowGroup follow={follow} onFollowChange={onFollowChange} />
        <PlacesGroup onOpenMissing={onOpenMissing} />
        {!connected && <p className="px-4 text-xs text-muted-foreground">게임에 연결하면 지금 할 것을 보여줘요</p>}
      </SidebarContent>
      <SidebarFooter>
        <Button variant="outline" size="sm" className="justify-start" onClick={onSearch}>
          <Search />
          검색
          <span className="ml-auto text-xs text-muted-foreground">Ctrl+K</span>
        </Button>
        <div className="flex items-center gap-2">
          <ErrorsBadge />
          {/* 휴대폰 보기는 PC가 연 게임만 본다 */}
          {!isRemoteView() && <Button variant="ghost" size="sm" className="ml-auto" onClick={onClose}><FolderOpen />다른 게임 열기</Button>}
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
