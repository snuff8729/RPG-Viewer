import { useMemo } from "react";
import {
  SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarMenu, SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useLive } from "@/app/LiveProvider";
import { placesToGo } from "./sidebarItems";
import { useMissingGroups } from "./useMissingGroups";

/** 사이드바 "가 볼 만한 곳": 지금 갈 수 있는 못 본 것이 있는 다른 맵. 연결 중이고 하나라도 있을 때만 그린다. */
export function PlacesGroup({ onOpenMissing }: { onOpenMissing: (query: string) => void }) {
  const { connection } = useLive();
  const groups = useMissingGroups();
  const places = useMemo(() => placesToGo(groups), [groups]);
  if (connection !== "connected" || places.length === 0) return null;
  return (
    <SidebarGroup>
      <SidebarGroupLabel>가 볼 만한 곳</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {places.map((p) => (
            <SidebarMenuItem key={p.mapId}>
              <SidebarMenuButton onClick={() => onOpenMissing(p.name)}>
                <span className="truncate">{p.name}</span>
              </SidebarMenuButton>
              <SidebarMenuBadge>{p.count}</SidebarMenuBadge>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
