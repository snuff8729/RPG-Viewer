import { useEffect, useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { useLive } from "@/app/LiveProvider";
import { locationKey } from "@/core/index/locations";
import { viewGroups, type MissingEventGroup, type MissingGroup, type MissingView as View } from "@/core/live/missingGroups";
import type { EvalStatus, MissingItem } from "@/core/live/types";
import { openPage } from "@/ui/navigation";
import { highlightNode } from "@/ui/highlight";
import { clearMissingQuery, peekMissingQuery } from "./missingFilter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Item, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { terms } from "@/ui/terms";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useMissingGroups } from "./useMissingGroups";

const MARK: Record<EvalStatus, string> = { met: "✓", unmet: "✗", unknown: "?" };
const GROUP_STEP = 50;
const VIEWS: [View, string][] = [["now", terms.thisMap], ["reachable", "갈 수 있는 것"], ["all", "전체"]];
/** 이벤트 줄에 처음 보이는 미리보기 수 */
const PREVIEW_COUNT = 2;
const UNKNOWN_HINT = "지금은 판단할 수 없는 조건이에요(게임과 연결되지 않았거나 플러그인 스크립트 같은 조건)";

/** `선택지 N · 대사 N` (0인 쪽 생략) */
function countText(choice: number, page: number): string {
  return [choice > 0 ? `선택지 ${choice}` : "", page > 0 ? `대사 ${page}` : ""].filter(Boolean).join(" · ");
}

function go(m: MissingItem) {
  openPage(m.entry.location);
  highlightNode(locationKey(m.entry.location), m.nodePath);
}

/** 조건 하나: ✓ 됨 · ✗ 아직 · ? 모름(Tooltip으로 뜻) */
function Requirement({ r }: { r: MissingItem["requirements"][number] }) {
  const badge = (
    <Badge
      variant={r.status === "met" ? "secondary" : "outline"}
      className={cn("h-auto whitespace-normal wrap-anywhere", r.status === "unknown" && "text-muted-foreground")}
    >
      {MARK[r.status]} {r.text}
    </Badge>
  );
  if (r.status !== "unknown") return badge;
  return (
    <Tooltip>
      <TooltipTrigger asChild><span className="inline-flex">{badge}</span></TooltipTrigger>
      <TooltipContent>{UNKNOWN_HINT}</TooltipContent>
    </Tooltip>
  );
}

/** 이벤트 줄 안의 대사·선택지 미리보기 한 줄: 누르면 그 대사로 가요 */
function Preview({ m }: { m: MissingItem }) {
  return (
    <div className="space-y-1">
      <button
        type="button" onClick={() => go(m)}
        className="block w-full cursor-pointer rounded-md px-2 py-1 text-left text-sm text-muted-foreground outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="line-clamp-2 wrap-anywhere">{m.kind === "choice" ? "선택지 · " : ""}{m.label}</span>
      </button>
      {m.requirements.length > 0 && (
        <div className="flex flex-wrap gap-1 px-2">
          {m.requirements.map((r, i) => <Requirement key={i} r={r} />)}
        </div>
      )}
    </div>
  );
}

/** 이벤트 한 줄(맵 → 이벤트 두 단계까지만): 이름·개수·위치, 안에 못 본 대사 미리보기 */
function EventRow({ e }: { e: MissingEventGroup }) {
  const [all, setAll] = useState(false);
  const shown = all ? e.items : e.items.slice(0, PREVIEW_COUNT);
  return (
    <Item variant="outline" size="sm" className="items-start">
      <ItemContent className="min-w-0 gap-1">
        <ItemTitle className="flex-wrap">
          <button type="button" className="cursor-pointer text-left wrap-anywhere hover:underline" onClick={() => e.items[0] && go(e.items[0])}>
            {e.entry.title}
          </button>
          {e.active === true && <Badge>지금 페이지</Badge>}
          <span className="text-xs font-normal text-muted-foreground">{countText(e.choiceCount, e.pageCount)}</span>
        </ItemTitle>
        <ItemDescription className="wrap-anywhere">{e.entry.path}</ItemDescription>
        <div className="space-y-1 pt-1">
          {shown.map((m, i) => <Preview key={`${m.nodePath.join(".")}:${i}`} m={m} />)}
          {e.items.length > PREVIEW_COUNT && (
            <Button variant="ghost" size="xs" onClick={() => setAll((a) => !a)}>
              {all ? "줄이기" : `${e.items.length - PREVIEW_COUNT}개 더 보기`}
            </Button>
          )}
        </div>
      </ItemContent>
    </Item>
  );
}

function GroupBlock({ g, open, onOpenChange }: { g: MissingGroup; open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange} className="rounded-md border">
      <CollapsibleTrigger className="group flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-semibold">
        <ChevronRight className="size-4 shrink-0 transition-transform group-data-[state=open]:rotate-90" />
        <span className="min-w-0 wrap-anywhere">{g.name}</span>
        <span className="text-xs font-normal text-muted-foreground">{countText(g.choiceCount, g.pageCount)}</span>
        {g.current && <Badge>지금 여기</Badge>}
      </CollapsibleTrigger>
      {/* 접힌 그룹은 CollapsibleContent가 내용을 렌더하지 않는다 */}
      <CollapsibleContent className="space-y-2 border-t p-2">
        {g.events.map((e) => <EventRow key={e.key} e={e} />)}
      </CollapsibleContent>
    </Collapsible>
  );
}

function GroupList({ groups }: { groups: MissingGroup[] }) {
  const [limit, setLimit] = useState(GROUP_STEP);
  /** 사용자가 펼치거나 접은 그룹. 없으면 지금 맵 그룹만 펼친다. */
  const [openOverride, setOpenOverride] = useState<Map<string, boolean>>(() => new Map());
  if (groups.length === 0) return <p className="text-sm text-muted-foreground">여기에는 못 본 것이 없어요</p>;
  const shown = groups.slice(0, limit);
  return (
    <div className="space-y-2">
      {shown.map((g) => (
        <GroupBlock
          key={g.key}
          g={g}
          open={openOverride.get(g.key) ?? g.current}
          onOpenChange={(o) => setOpenOverride((prev) => new Map(prev).set(g.key, o))}
        />
      ))}
      {shown.length < groups.length && (
        <Button variant="outline" size="sm" onClick={() => setLimit((n) => n + GROUP_STEP)}>
          더 보기 ({Math.min(GROUP_STEP, groups.length - shown.length)}개)
        </Button>
      )}
    </div>
  );
}

/** initialQuery: 처음 채울 검색어. 없으면 맵 목록 "다른 맵"에서 넘긴 맵 이름(openMissingFor). */
export function MissingView({ initialQuery = "" }: { initialQuery?: string }) {
  const { connection } = useLive();
  const groups = useMissingGroups();
  const offline = connection !== "connected";
  /** 사용자가 고른 보기. 고르기 전엔 연결 상태를 따른다. */
  const [picked, setPicked] = useState<View | null>(null);
  // 연결이 없으면 지금 맵·갈 수 있는지 알 수 없어 "전체"만 보여요
  const view: View = offline ? "all" : picked ?? "reachable";
  const [query, setQuery] = useState(() => initialQuery || peekMissingQuery());
  useEffect(() => clearMissingQuery(), []);
  const shown = useMemo(() => viewGroups(groups, view, query), [groups, view, query]);
  return (
    <div className="space-y-4 p-1">
      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={view}
          onValueChange={(v) => { if (v) setPicked(v as View); }}
          aria-label="거르기"
        >
          {VIEWS.map(([v, label]) => offline && v !== "all" ? (
            <Tooltip key={v}>
              <TooltipTrigger asChild>
                <span className="inline-flex"><ToggleGroupItem value={v} disabled>{label}</ToggleGroupItem></span>
              </TooltipTrigger>
              <TooltipContent>{terms.notConnected}. 연결되면 {v === "now" ? "지금 있는 맵을" : "지금 갈 수 있는 것을"} 골라 볼 수 있어요</TooltipContent>
            </Tooltip>
          ) : <ToggleGroupItem key={v} value={v}>{label}</ToggleGroupItem>)}
        </ToggleGroup>
        <Input
          className="h-8 max-w-xs"
          placeholder="맵·이벤트 이름 검색"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {offline && <p className="text-xs text-muted-foreground">{terms.notConnected}. 연결되면 조건이 채워졌는지(✓·✗)도 보여요</p>}
      <GroupList key={`${view}|${query.trim()}`} groups={shown} />
    </div>
  );
}
