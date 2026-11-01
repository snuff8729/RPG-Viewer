import { useMemo, useState, type ReactNode } from "react";
import { ChevronRight, Ellipsis, MapPin } from "lucide-react";
import type { ChecklistEvent } from "@/core/live/mapChecklist";
import { mapEncounters } from "@/core/live/enemies";
import { useGame } from "@/app/GameProvider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Item, ItemActions, ItemContent, ItemGroup, ItemMedia } from "@/components/ui/item";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { openPage } from "@/ui/navigation";
import { terms } from "@/ui/terms";
import { ChecklistCard } from "./ChecklistCard";
import { EncounterCard } from "./EncounterCard";
import { HereMapArea } from "./HereMapArea";
import { HereNotConnected } from "./HereNotConnected";
import { LEGEND_KEYS, legendKeyOf, useMapLegend, type LegendKey } from "./mapLegendState";
import { openMissingFor } from "./missingFilter";
import { NextStoryCard } from "./NextStoryCard";
import { gameKeyOf } from "./readPosition";
import { eventStyle, sectionStyle, storyStyle, type SectionStyle } from "./sectionStyle";
import { placesToGo } from "./sidebarItems";
import { useMissingGroups } from "./useMissingGroups";
import { PlayMapContext, usePlayMap, usePlayMapController } from "./usePlayMapState";

/** 구역 칩·목록 묶음의 순서. storyEvents = 이야기·자동 진행(맵에는 그리지 않아요) */
type ChipKey = Extract<LegendKey, ChecklistEvent["section"] | "storyEvents">;
const CHIP_KEYS: ChipKey[] = ["now", "item", "repeat", "exit", "enemy", "talk", "locked", "storyEvents", "done"];
const CHIP_LABEL: Record<ChipKey, string> = {
  now: "안 본 내용", item: "아이템", repeat: "반복", exit: "이동", enemy: "적", talk: "다시 가능", locked: "잠김", storyEvents: "이야기", done: "다 봄",
};
const chipOf = (e: ChecklistEvent): ChipKey => (e.story ? "storyEvents" : e.section);
const chipStyle = (k: ChipKey): SectionStyle => (k === "storyEvents" ? storyStyle : sectionStyle(k));
/** 처음에 접어 두는 묶음(다 봄 (다시 가능)은 많을 때만) */
const TALK_FOLD = 8;

/** 한 줄 설명: 이동이면 어디로, 아니면 이게 뭔지 */
function rowHint(ev: ChecklistEvent): string {
  return ev.exit ? `→ ${ev.exit.mapName}` : ev.describe;
}

/** 줄 오른쪽에 붙이는 짧은 이유(안 본 대사·선택지·아이템) */
function rowReason(ev: ChecklistEvent): string {
  return [
    ev.untried ? "아직 안 해 봄" : "",
    ev.unseen > 0 ? `안 본 대사 ${ev.unseen}` : "",
    ev.unpicked > 0 ? `선택지 ${ev.unpicked}` : "",
    ev.gains.length > 0 ? "아이템" : "",
  ].filter(Boolean).join(" · ");
}

/** 맵 조각(구역 칩·맵 그림·목록)이 함께 쓰는 상태. 조각들을 다른 칸에 둘 때는 모두 이 아래에 둔다. */
export function PlayMapProvider({ children }: { children: ReactNode }) {
  const state = usePlayMapController();
  return <PlayMapContext.Provider value={state}>{children}</PlayMapContext.Provider>;
}

/** 게임별 구역 칩(범례) 상태 */
function useLegend() {
  const { data } = useGame();
  return useMapLegend(data ? gameKeyOf(data) : "");
}

/** 칩 줄 끝 `⋯`: 벽 표시·적 피해서 길 찾기, 그리고 맵에만 있는 표시(내 위치·다음 스토리·생성 이벤트·적 나오는 구역) */
function MapMoreMenu() {
  const { here, showWalls, setShowWalls } = usePlayMap();
  const { data } = useGame();
  const [hidden, setShown] = useLegend();
  const mapId = here.checklist?.mapId;
  const regions = useMemo(() => (data && mapId != null ? (mapEncounters(data, mapId)?.regions.length ?? 0) > 0 : false), [data, mapId]);
  const item = (key: LegendKey, label: string) => (
    <DropdownMenuCheckboxItem checked={!hidden.has(key)} onCheckedChange={(on) => setShown(key, on)} onSelect={(e) => e.preventDefault()}>
      {label}
    </DropdownMenuCheckboxItem>
  );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="shrink-0" aria-label="맵 표시 설정"><Ellipsis /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuCheckboxItem checked={showWalls} onCheckedChange={setShowWalls} onSelect={(e) => e.preventDefault()}>벽 표시</DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem checked={here.avoidEnemies} onCheckedChange={here.setAvoidEnemies} onSelect={(e) => e.preventDefault()}>
          적 피해서 길 찾기
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-muted-foreground">맵에 보이기</DropdownMenuLabel>
        {item("player", "내 위치")}
        {item("story", "다음 스토리 표시")}
        {item("spawn", "알 수 없는 생성 이벤트")}
        {regions && item("regions", "적 나오는 구역")}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * 구역 칩 줄(맵 위): 구역마다 색 점 + 이름 + 개수. 누르면 맵 표시와 목록에서 그 구역을 켜고 꺼요(범례 = 거르개).
 * 개수가 0인 구역은 숨겨요. 줄 끝에 `⋯` 메뉴와 actions(예: 새 창으로 떼기).
 */
export function MapChips({ actions, className }: { actions?: ReactNode; className?: string }) {
  const { here } = usePlayMap();
  const [hidden, , setVisible] = useLegend();
  const counts = useMemo(() => {
    const m = new Map<ChipKey, number>();
    for (const e of here.listed) {
      // 알 수 없는 생성 이벤트는 ⋯ 메뉴가 맡아요
      if (!e.story && legendKeyOf(e) === "spawn") continue;
      m.set(chipOf(e), (m.get(chipOf(e)) ?? 0) + 1);
    }
    return m;
  }, [here.listed]);
  const shown = CHIP_KEYS.filter((k) => (counts.get(k) ?? 0) > 0);
  const onChange = (v: string[]) => {
    // 숨긴(개수 0) 칩과 칩이 아닌 표시는 그대로 두고, 보이는 칩만 바꿔요
    const on = new Set(v);
    setVisible(LEGEND_KEYS.filter((k) => (shown as LegendKey[]).includes(k) ? on.has(k) : !hidden.has(k)));
  };
  return (
    <div className={cn("flex min-w-0 shrink-0 items-center gap-1", className)}>
      <ToggleGroup
        type="multiple" variant="outline" size="sm" spacing={1}
        className="min-w-0 flex-1 justify-start overflow-x-auto py-0.5 [&>*]:shrink-0"
        aria-label="구역 (누르면 맵과 목록에서 숨기거나 보여요)"
        value={shown.filter((k) => !hidden.has(k))}
        onValueChange={onChange}
      >
        {shown.map((k) => {
          const st = chipStyle(k);
          return (
            <ToggleGroupItem key={k} value={k} title={st.label} className="font-normal">
              <span className={cn("size-2 rounded-full", st.bg)} aria-hidden />
              {CHIP_LABEL[k]}
              <span className="tabular-nums opacity-70">{counts.get(k)}</span>
            </ToggleGroupItem>
          );
        })}
      </ToggleGroup>
      <MapMoreMenu />
      {actions}
    </div>
  );
}

/** 맵 그림(내 위치를 따라감, 칸을 채움). 점을 누르면 고르고 목록에서 그 줄을 보여요. 게임이 연결되지 않았으면 안내. */
export function MapPicture() {
  const { here, focus, pick, showWalls } = usePlayMap();
  if (!here.live || !here.checklist) return <HereNotConnected />;
  return <HereMapArea here={here} focus={focus} onPick={pick} showWalls={showWalls} />;
}

/** 이벤트 하나의 자세한 내용(남은 대사·조건 만드는 법·잠긴 페이지)을 Sheet로 */
function HowToSheet({ ev, onOpenChange }: { ev: ChecklistEvent | null; onOpenChange: (open: boolean) => void }) {
  const { here } = usePlayMap();
  return (
    <Sheet open={ev !== null} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>어떻게 하나요</SheetTitle>
          <SheetDescription>남은 내용과 조건을 만드는 법을 살펴봐요.</SheetDescription>
        </SheetHeader>
        {ev && (
          <div className="px-4 pb-4">
            <ChecklistCard ev={ev} number={here.numbers.get(ev.eventId)} highlighted={false} />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function TodoRow({ ev, onChoose, onHowTo }: { ev: ChecklistEvent; onChoose?: (ev: ChecklistEvent) => void; onHowTo: (ev: ChecklistEvent) => void }) {
  const { here, choose, rowRefs } = usePlayMap();
  const st = eventStyle(ev);
  const n = here.numbers.get(ev.eventId);
  const on = here.selected === ev.eventId;
  const reason = rowReason(ev);
  const target = ev.location ?? ev.locked[0]?.location ?? null;
  return (
    <Item
      size="xs" variant={on ? "muted" : "default"} className="flex-nowrap"
      ref={(el: HTMLDivElement | null) => { if (el) rowRefs.set(ev.eventId, el); else rowRefs.delete(ev.eventId); }}
    >
      <button
        type="button" aria-pressed={on} className="flex min-w-0 flex-1 items-center gap-2 text-left"
        onClick={() => { choose(ev); onChoose?.(ev); }}
      >
        <ItemMedia>
          <Badge variant="outline" className={cn("min-w-6 justify-center tabular-nums", st.text, st.border)}>{n ?? "·"}</Badge>
        </ItemMedia>
        <ItemContent className="min-w-0">
          <p className="truncate text-sm">
            <span className="font-medium">{ev.title}</span>
            {rowHint(ev) && <span className="text-muted-foreground"> · {rowHint(ev)}</span>}
          </p>
          {reason && <p className="truncate text-xs text-muted-foreground">{reason}</p>}
          {on && here.routeText !== undefined && (
            <p className={cn("text-xs", here.routeText === null ? "text-muted-foreground" : "font-medium")}>
              {here.routeText === null ? "갈 수 있는 길을 못 찾았어요" : `가는 길: ${here.routeText}`}
            </p>
          )}
        </ItemContent>
      </button>
      <ItemActions>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-xs" aria-label={`${ev.title} 더 보기`}><Ellipsis /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => onHowTo(ev)}>어떻게 하나요</DropdownMenuItem>
            <DropdownMenuItem disabled={!target} onSelect={() => { if (target) openPage(target); }}>찾아보기에서 보기</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </ItemActions>
    </Item>
  );
}

/** 다른 맵: 해 볼 것이 남은 다른 맵. 누르면 찾아보기 › 못 본 것을 그 맵으로 거른 상태로 열어요. */
function OtherMaps() {
  const groups = useMissingGroups();
  const places = useMemo(() => placesToGo(groups), [groups]);
  if (places.length === 0) return null;
  return (
    <section className="flex flex-col gap-1">
      <h3 className="px-1 text-sm font-semibold">다른 맵</h3>
      <ItemGroup className="gap-0.5">
        {places.map((p) => (
          <Item key={p.mapId} size="xs" asChild>
            <button type="button" className="text-left hover:bg-muted" onClick={() => openMissingFor(p.name)}>
              <ItemMedia><MapPin className="size-4 text-muted-foreground" /></ItemMedia>
              <ItemContent className="min-w-0"><p className="truncate text-sm">{p.name}</p></ItemContent>
              <ItemActions><Badge variant="secondary" className="tabular-nums">{p.count}</Badge><ChevronRight className="size-4" /></ItemActions>
            </button>
          </Item>
        ))}
      </ItemGroup>
    </section>
  );
}

/**
 * 맵 아래 목록: 다음 스토리 카드 → 해 볼 것 N(구역별 묶음, 색 점 제목) → 이 맵에서 나오는 적 → 다른 맵.
 * 줄을 누르면 맵이 그 점으로, 맵 점을 누르면 목록이 그 줄로. 줄 `⋯`: 어떻게 하나요 / 찾아보기에서 보기.
 * onChoose = 줄을 고른 뒤(휴대폰에서 Drawer를 닫아 맵을 보이기).
 */
export function MapList({ onChoose, className }: { onChoose?: (ev: ChecklistEvent) => void; className?: string }) {
  const { here, rows } = usePlayMap();
  const [open, setOpen] = useState<Partial<Record<ChipKey, boolean>>>({});
  const [howTo, setHowTo] = useState<ChecklistEvent | null>(null);
  const [storyHow, setStoryHow] = useState(false);
  const { checklist, selected } = here;
  if (!here.live || !checklist) return null;
  const groups = new Map<ChipKey, ChecklistEvent[]>(CHIP_KEYS.map((k) => [k, []]));
  for (const e of rows) groups.get(chipOf(e))?.push(e);
  const foldable: Partial<Record<ChipKey, boolean>> = {
    talk: (groups.get("talk")?.length ?? 0) > TALK_FOLD, storyEvents: true, done: true, locked: true,
  };
  const selectedGroup = selected != null ? rows.find((e) => e.eventId === selected) : undefined;
  const isOpen = (k: ChipKey) => (selectedGroup && chipOf(selectedGroup) === k) || (open[k] ?? !foldable[k]);
  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <NextStoryCard
        compact
        action={<Button variant="outline" size="sm" className="self-start" onClick={() => setStoryHow(true)}>어떻게 하나요</Button>}
      />
      <Sheet open={storyHow} onOpenChange={setStoryHow}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>어떻게 하나요</SheetTitle>
            <SheetDescription>다음 스토리로 가려면 먼저 할 일과 가는 길이에요.</SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-4"><NextStoryCard /></div>
        </SheetContent>
      </Sheet>
      <section className="flex flex-col gap-3">
        <h3 className="flex items-center gap-2 px-1 text-sm font-semibold">
          {terms.todo(checklist.remaining)}
        </h3>
        {checklist.events.length === 0 && <p className="px-1 text-xs text-muted-foreground">이 맵에는 볼 만한 이벤트가 없어요</p>}
        {checklist.events.length > 0 && checklist.remaining === 0 && <p className="px-1 text-xs text-muted-foreground">이 맵에서 할 것을 다 했어요</p>}
        {CHIP_KEYS.map((k) => {
          const evs = groups.get(k) ?? [];
          if (evs.length === 0) return null;
          const st = chipStyle(k);
          const heading = (
            <>
              <span className={cn("size-2 shrink-0 rounded-full", st.bg)} aria-hidden />
              {st.label}
              <span className="font-normal text-muted-foreground tabular-nums">{evs.length}</span>
            </>
          );
          const list = (
            <ItemGroup role="group" aria-label={st.label} className="gap-0.5">
              {evs.map((ev) => <TodoRow key={ev.eventId} ev={ev} onChoose={onChoose} onHowTo={setHowTo} />)}
            </ItemGroup>
          );
          if (!foldable[k]) {
            return (
              <div key={k} className="flex flex-col gap-1">
                <h4 className="flex items-center gap-1.5 px-1 text-xs font-medium">{heading}</h4>
                {list}
              </div>
            );
          }
          return (
            <Collapsible key={k} open={isOpen(k)} onOpenChange={(v) => setOpen((o) => ({ ...o, [k]: v }))} className="flex flex-col gap-1">
              <CollapsibleTrigger className="group flex items-center gap-1.5 px-1 text-xs font-medium">
                <ChevronRight className="size-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-90" />
                {heading}
              </CollapsibleTrigger>
              <CollapsibleContent>{list}</CollapsibleContent>
            </Collapsible>
          );
        })}
      </section>
      <EncounterCard mapId={checklist.mapId} />
      <OtherMaps />
      <HowToSheet ev={howTo} onOpenChange={(o) => { if (!o) setHowTo(null); }} />
    </div>
  );
}
