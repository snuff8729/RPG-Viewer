import { useMemo } from "react";
import { ChevronRight, TriangleAlert } from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useGame } from "@/app/GameProvider";
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
        {errs && (
          <Tooltip>
            <TooltipTrigger asChild>
              <TriangleAlert className="ml-auto size-4 shrink-0 text-destructive" aria-label="오류" />
            </TooltipTrigger>
            <TooltipContent>{errs.join("\n")}</TooltipContent>
          </Tooltip>
        )}
      </>
    );
    if (!hasContent) {
      return <Item key={m.id}><Btn>{label}</Btn></Item>;
    }
    return (
      <Collapsible key={m.id} asChild className="group/collapsible">
        <Item>
          <CollapsibleTrigger asChild>
            <Btn>
              <ChevronRight className="transition-transform group-data-[state=open]/collapsible:rotate-90" />
              {label}
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
