import { useMemo } from "react";
import { List } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useGame } from "@/app/GameProvider";
import { useLive } from "@/app/LiveProvider";
import { formatRoute } from "@/app/route";
import { openPage } from "../navigation";
import { nowItems } from "./sidebarItems";
import { sectionStyle } from "./sectionStyle";
import { useMapChecklist } from "./useMapChecklist";

/** 사이드바 "지금": 이 맵에서 지금 할 것. 연결되지 않았으면 아무것도 그리지 않는다. */
export function NowGroup({ follow, onFollowChange }: { follow: boolean; onFollowChange: (v: boolean) => void }) {
  const { data } = useGame();
  const { live, connection } = useLive();
  const checklist = useMapChecklist();
  const items = useMemo(() => nowItems(checklist), [checklist]);

  if (connection !== "connected" || !live || !data) return null;
  const mapName = data.mapInfos[live.mapId]?.name || `#${live.mapId}`;

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
        {items.length === 0 && <p className="px-2 pb-1 text-xs text-muted-foreground">이 맵에서 할 것을 다 했어요</p>}
        <SidebarMenu>
          {items.map((e) => {
            const st = sectionStyle(e.section);
            return (
            <SidebarMenuItem key={e.eventId}>
              <SidebarMenuButton onClick={() => openPage(e.location)}>
                <st.Icon className={st.text} aria-label={st.label} />
                <span className="truncate">{e.title}</span>
                <span className="ml-auto flex shrink-0 gap-1">
                  {e.section === "now" && e.unseen > 0 && <Badge variant="secondary" className="text-xs">새 대화</Badge>}
                  {e.section === "now" && e.unpicked > 0 && <Badge variant="secondary" className="text-xs">선택지 {e.unpicked}</Badge>}
                  {e.section === "repeat" && <Badge variant="outline" className="text-xs">반복</Badge>}
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            );
          })}
          {checklist && (
            <SidebarMenuItem>
              <SidebarMenuButton asChild className="text-muted-foreground">
                <a href={formatRoute({ kind: "here" })}>
                  <List />
                  <span>이 맵 전체 보기 ({checklist.remaining})</span>
                </a>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
