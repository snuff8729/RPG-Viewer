import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useGame } from "@/app/GameProvider";
import { useLive } from "@/app/LiveProvider";
import { openPage } from "../navigation";
import { mapInteractables } from "@/core/live/interactable";

const MARK = { talk: "●", auto: "⚡", none: "○" } as const;

/** 사이드바 맨 위 "지금" 그룹. 연결되지 않았으면 아무것도 그리지 않는다. */
export function NowGroup({ showEmpty, follow, onFollowChange }: {
  showEmpty: boolean; follow: boolean; onFollowChange: (v: boolean) => void;
}) {
  const { data, index } = useGame();
  const { live, connection, coverage } = useLive();
  const [onlyNew, setOnlyNew] = useState(false);
  const events = useMemo(
    () => (data && index && live ? mapInteractables(data, index, coverage, live, live.mapId) : []),
    [data, index, coverage, live],
  );

  if (connection !== "connected" || !live || !data) return null;
  const mapName = data.mapInfos[live.mapId]?.name || `#${live.mapId}`;
  const shown = events.filter((e) => (e.mark !== "none" || showEmpty) && (!onlyNew || e.isNew));

  return (
    <SidebarGroup>
      <div className="flex items-center justify-between pr-2">
        <SidebarGroupLabel>지금</SidebarGroupLabel>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <Label htmlFor="only-new" className="text-xs font-normal">안 본 것만</Label>
            <Switch id="only-new" checked={onlyNew} onCheckedChange={setOnlyNew} />
          </div>
          <div className="flex items-center gap-1.5">
          <Label htmlFor="follow-live" className="text-xs font-normal">따라가기</Label>
          <Switch id="follow-live" checked={follow} onCheckedChange={onFollowChange} />
          </div>
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
                {e.unseen > 0 && <Badge variant="secondary" className="ml-auto shrink-0 text-xs">새 대화</Badge>}
                {e.unpicked > 0 && (
                  <Badge variant="secondary" className={`shrink-0 text-xs ${e.unseen > 0 ? "" : "ml-auto"}`}>선택지 {e.unpicked}</Badge>
                )}
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
