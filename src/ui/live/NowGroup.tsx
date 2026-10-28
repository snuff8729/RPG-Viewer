import { useMemo } from "react";
import { SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useGame } from "@/app/GameProvider";
import { useLive } from "@/app/LiveProvider";
import { openPage } from "../navigation";
import { nowEvents } from "./annotations";

const MARK = { talk: "●", auto: "⚡", none: "○" } as const;

/** 사이드바 맨 위 "지금" 그룹. 연결되지 않았으면 아무것도 그리지 않는다. */
export function NowGroup({ showEmpty, follow, onFollowChange }: {
  showEmpty: boolean; follow: boolean; onFollowChange: (v: boolean) => void;
}) {
  const { data, index } = useGame();
  const { live, connection } = useLive();
  const events = useMemo(() => (data && index ? nowEvents(data, index, live) : []), [data, index, live]);

  if (connection !== "connected" || !live || !data) return null;
  const mapName = data.mapInfos[live.mapId]?.name || `#${live.mapId}`;
  const shown = events.filter((e) => e.mark !== "none" || showEmpty);

  return (
    <SidebarGroup>
      <div className="flex items-center justify-between pr-2">
        <SidebarGroupLabel>지금</SidebarGroupLabel>
        <div className="flex items-center gap-1.5">
          <Label htmlFor="follow-live" className="text-xs font-normal">따라가기</Label>
          <Switch id="follow-live" checked={follow} onCheckedChange={onFollowChange} />
        </div>
      </div>
      <SidebarGroupContent>
        <p className="truncate px-2 pb-1 text-sm">{mapName} ({live.x}, {live.y})</p>
        <SidebarMenu>
          {shown.map((e) => (
            <SidebarMenuItem key={`${e.eventId}:${e.page}`}>
              <SidebarMenuButton onClick={() => openPage(e.location)}>
                <span aria-hidden className="w-4 shrink-0 text-center">{MARK[e.mark]}</span>
                <span className="truncate">{e.title}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
