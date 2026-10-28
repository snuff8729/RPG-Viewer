import { useEffect, useMemo, useState } from "react";
import { ChevronRight, TriangleAlert } from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useGame } from "@/app/GameProvider";
import { useLive } from "@/app/LiveProvider";
import { mapNewCounts } from "@/core/live/interactable";
import { useConditionsLive } from "./live/useConditionsLive";
import { NowGroup } from "./live/NowGroup";
import type { Route } from "@/app/route";
import type { Location, MapInfo, PageEntry } from "@/core/types";
import { openPage } from "./navigation";

interface EventItem { key: string; title: string; first: Location; pages: PageEntry[] }

function groupBy(pages: PageEntry[], keyOf: (l: Location) => string | null): EventItem[] {
  const m = new Map<string, EventItem>();
  for (const p of pages) {
    const key = keyOf(p.location);
    if (key === null) continue;
    const g = m.get(key);
    if (g) g.pages.push(p);
    else m.set(key, { key, title: p.title, first: p.location, pages: [p] });
  }
  return [...m.values()];
}

function isActiveFor(route: Route, item: EventItem): boolean {
  if (route.kind !== "page") return false;
  const l = route.location, f = item.first;
  if (l.source === "map" && f.source === "map") return l.mapId === f.mapId && l.eventId === f.eventId;
  if (l.source === "common" && f.source === "common") return l.commonEventId === f.commonEventId;
  if (l.source === "troop" && f.source === "troop") return l.troopId === f.troopId;
  return false;
}

function firstPage(loc: Location): Location {
  return loc.source === "common" ? loc : { ...loc, page: 0 };
}

export function AppSidebar({ route, showEmpty, onShowEmptyChange }: {
  route: Route; showEmpty: boolean; onShowEmptyChange: (v: boolean) => void;
}) {
  const { data, index } = useGame();
  const { live, connection, coverage } = useLive();
  const [follow, setFollow] = useState(true);
  const [openMaps, setOpenMaps] = useState<Set<number>>(new Set());

  // 현재 route의 맵과 그 상위 맵을 펼친다 (딥링크·검색 이동 대응).
  const activeMapId = route.kind === "page" && route.location.source === "map" ? route.location.mapId : null;
  // 따라가기가 켜져 있으면 게임 속 맵도 같은 방식으로 펼친다(맵이 바뀔 때만 다시 펼침).
  const liveMapId = follow && connection === "connected" && live ? live.mapId : null;
  useEffect(() => {
    if (!data) return;
    const parentOf = new Map<number, number>();
    for (const m of data.mapInfos) if (m) parentOf.set(m.id, m.parentId);
    const chain: number[] = [];
    for (const start of [activeMapId, liveMapId]) {
      for (let id: number | undefined = start ?? undefined; id !== undefined && id > 0 && !chain.includes(id); id = parentOf.get(id)) chain.push(id);
    }
    if (chain.length === 0) return;
    setOpenMaps((prev) => (chain.every((id) => prev.has(id)) ? prev : new Set([...prev, ...chain])));
  }, [activeMapId, liveMapId, data]);

  // 위치만 바뀐 스냅샷으로는 다시 세지 않는다(출현 조건 필드가 바뀔 때만)
  const condLive = useConditionsLive(live);
  const newCounts = useMemo(
    () => (data && index && condLive && connection === "connected"
      ? mapNewCounts(data, index, coverage, condLive) : new Map<number, number>()),
    [data, index, coverage, condLive, connection],
  );

  const model = useMemo(() => {
    if (!data || !index) return null;
    const visible = (it: EventItem) => showEmpty || it.pages.some((p) => p.hasDialogue);
    const mapEvents = new Map<number, EventItem[]>();
    for (const it of groupBy(index.pages, (l) => (l.source === "map" ? `${l.mapId}:${l.eventId}` : null))) {
      if (it.first.source !== "map") continue;
      const list = mapEvents.get(it.first.mapId) ?? [];
      list.push(it);
      mapEvents.set(it.first.mapId, list);
    }
    const infos = data.mapInfos.filter((m): m is MapInfo => !!m);
    const ids = new Set(infos.map((m) => m.id));
    const children = new Map<number, MapInfo[]>();
    for (const m of infos) {
      const parent = ids.has(m.parentId) && m.parentId !== m.id ? m.parentId : 0;
      const l = children.get(parent) ?? [];
      l.push(m);
      children.set(parent, l);
    }
    for (const l of children.values()) l.sort((a, b) => a.order - b.order || a.id - b.id);
    const errorsByMap = new Map<number, string[]>();
    for (const e of data.errors) {
      if (e.mapId === undefined) continue;
      const l = errorsByMap.get(e.mapId) ?? [];
      l.push(`${e.file}: ${e.message}`);
      errorsByMap.set(e.mapId, l);
    }
    const common = groupBy(index.pages, (l) => (l.source === "common" ? String(l.commonEventId) : null)).filter(visible);
    const troops = groupBy(index.pages, (l) => (l.source === "troop" ? String(l.troopId) : null)).filter(visible);
    return { visible, mapEvents, children, errorsByMap, common, troops };
  }, [data, index, showEmpty]);

  if (!model) return null;
  const { visible, mapEvents, children, errorsByMap, common, troops } = model;

  const mapShown = (m: MapInfo, seen: Set<number>): boolean => {
    if (seen.has(m.id)) return false;
    if (errorsByMap.has(m.id)) return true;
    if ((mapEvents.get(m.id) ?? []).some(visible)) return true;
    const next = new Set(seen).add(m.id);
    return (children.get(m.id) ?? []).some((c) => mapShown(c, next));
  };

  const renderMap = (m: MapInfo, sub: boolean, seen: Set<number>) => {
    if (!mapShown(m, seen)) return null;
    const next = new Set(seen).add(m.id);
    const errs = errorsByMap.get(m.id);
    const events = (mapEvents.get(m.id) ?? []).filter(visible);
    const kids = children.get(m.id) ?? [];
    const Item = sub ? SidebarMenuSubItem : SidebarMenuItem;
    const Btn = sub ? SidebarMenuSubButton : SidebarMenuButton;
    const hasContent = events.length > 0 || kids.length > 0;
    const label = (
      <>
        <span className="truncate">{m.name}</span>
        {m.id === data?.templateMapId ? (
          <Badge variant="outline" className="shrink-0 text-xs text-muted-foreground">템플릿</Badge>
        ) : null}
        {newCounts.get(m.id) ? (
          <Badge variant="outline" className="ml-auto shrink-0 text-xs">새 {newCounts.get(m.id)}</Badge>
        ) : null}
        {errs && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={0} role="img" aria-label="오류" className={newCounts.get(m.id) ? "shrink-0" : "ml-auto shrink-0"}>
                <TriangleAlert className="size-4 text-destructive" />
              </span>
            </TooltipTrigger>
            <TooltipContent className="whitespace-pre-line">{errs.join("\n")}</TooltipContent>
          </Tooltip>
        )}
      </>
    );
    if (!hasContent) {
      return <Item key={m.id}><Btn asChild><button type="button">{label}</button></Btn></Item>;
    }
    return (
      <Collapsible
        key={m.id}
        asChild
        className="group/collapsible"
        open={openMaps.has(m.id)}
        onOpenChange={(o) => setOpenMaps((prev) => { const n = new Set(prev); if (o) n.add(m.id); else n.delete(m.id); return n; })}
      >
        <Item>
          <CollapsibleTrigger asChild>
            <Btn asChild>
              <button type="button">
                <ChevronRight className="transition-transform group-data-[state=open]/collapsible:rotate-90" />
                {label}
              </button>
            </Btn>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <SidebarMenuSub>
              {events.map((it) => (
                <SidebarMenuSubItem key={it.key}>
                  <SidebarMenuSubButton asChild isActive={isActiveFor(route, it)}>
                    <button type="button" onClick={() => openPage(firstPage(it.first))}>
                      <span className="truncate">{it.title}</span>
                    </button>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              ))}
              {kids.map((c) => renderMap(c, true, next))}
            </SidebarMenuSub>
          </CollapsibleContent>
        </Item>
      </Collapsible>
    );
  };

  const flat = (items: EventItem[]) =>
    items.map((it) => (
      <SidebarMenuItem key={it.key}>
        <SidebarMenuButton isActive={isActiveFor(route, it)} onClick={() => openPage(firstPage(it.first))}>
          <span className="truncate">{it.title}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    ));

  return (
    <Sidebar>
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1">
          <Switch id="show-empty" checked={showEmpty} onCheckedChange={onShowEmptyChange} />
          <Label htmlFor="show-empty">대사 없는 항목 표시</Label>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <NowGroup showEmpty={showEmpty} follow={follow} onFollowChange={setFollow} />
        <SidebarGroup>
          <SidebarGroupLabel>맵</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{(children.get(0) ?? []).map((m) => renderMap(m, false, new Set()))}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>공통 이벤트</SidebarGroupLabel>
          <SidebarGroupContent><SidebarMenu>{flat(common)}</SidebarMenu></SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>전투</SidebarGroupLabel>
          <SidebarGroupContent><SidebarMenu>{flat(troops)}</SidebarMenu></SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
