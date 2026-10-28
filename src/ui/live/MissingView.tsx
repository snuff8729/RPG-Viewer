import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { useLive } from "@/app/LiveProvider";
import { locationKey } from "@/core/index/locations";
import { viewGroups, type MissingEventGroup, type MissingGroup, type MissingView as View } from "@/core/live/missingGroups";
import type { EvalStatus, MissingItem } from "@/core/live/types";
import { openPage } from "@/ui/navigation";
import { highlightNode } from "@/ui/highlight";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useMissingGroups } from "./useMissingGroups";

const MARK: Record<EvalStatus, string> = { met: "✓", unmet: "✗", unknown: "?" };
const GROUP_STEP = 50;
const VIEWS: [View, string][] = [["now", "지금 맵"], ["reachable", "갈 수 있는 것"], ["all", "전체"]];

/** `선택지 N · 대사 N` (0인 쪽 생략) */
function countText(choice: number, page: number): string {
  return [choice > 0 ? `선택지 ${choice}` : "", page > 0 ? `대사 ${page}` : ""].filter(Boolean).join(" · ");
}

function go(m: MissingItem) {
  openPage(m.entry.location);
  highlightNode(locationKey(m.entry.location), m.nodePath);
}

function Item({ m }: { m: MissingItem }) {
  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={() => go(m)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(m); } }}
      className="cursor-pointer gap-1 px-3 py-2 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="text-sm font-semibold">{m.label}</span>
      {m.requirements.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {m.requirements.map((r, i) => (
            <Badge
              key={i}
              variant={r.status === "met" ? "secondary" : "outline"}
              className={r.status === "unknown" ? "text-muted-foreground" : undefined}
            >
              {MARK[r.status]} {r.text}
            </Badge>
          ))}
        </div>
      )}
    </Card>
  );
}

function EventRow({ e }: { e: MissingEventGroup }) {
  return (
    <Collapsible className="rounded-md border">
      <CollapsibleTrigger className="group flex w-full items-start gap-1 px-3 py-1.5 text-left text-sm">
        <ChevronRight className="mt-0.5 size-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-90" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{e.entry.title}</span>
            {e.active === true && <Badge>지금 페이지</Badge>}
            <span className="text-xs text-muted-foreground">{countText(e.choiceCount, e.pageCount)}</span>
          </div>
          <div className="truncate text-xs text-muted-foreground">{e.entry.path}</div>
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 border-t p-2">
        {e.items.map((m, i) => <Item key={`${m.nodePath.join(".")}:${i}`} m={m} />)}
      </CollapsibleContent>
    </Collapsible>
  );
}

function GroupBlock({ g, open, onOpenChange }: { g: MissingGroup; open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange} className="rounded-md border">
      <CollapsibleTrigger className="group flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-semibold">
        <ChevronRight className="size-4 shrink-0 transition-transform group-data-[state=open]:rotate-90" />
        <span>{g.name}</span>
        <span className="text-xs font-normal text-muted-foreground">{countText(g.choiceCount, g.pageCount)}</span>
        {g.current && <Badge>지금 이 맵</Badge>}
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
  if (groups.length === 0) return <p className="text-sm text-muted-foreground">없음</p>;
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

export function MissingView() {
  const { connection } = useLive();
  const groups = useMissingGroups();
  const offline = connection !== "connected";
  /** 사용자가 고른 보기. 고르기 전엔 연결 상태를 따른다. */
  const [picked, setPicked] = useState<View | null>(null);
  const view: View = picked ?? (offline ? "all" : "reachable");
  const [query, setQuery] = useState("");
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
        >
          {VIEWS.map(([v, label]) => <ToggleGroupItem key={v} value={v}>{label}</ToggleGroupItem>)}
        </ToggleGroup>
        <Input
          className="h-8 max-w-xs"
          placeholder="맵·이벤트 이름 검색"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {offline && <p className="text-xs text-muted-foreground">게임에 연결되면 조건 충족 여부가 표시돼요</p>}
      <GroupList key={`${view}|${query.trim()}`} groups={shown} />
    </div>
  );
}
