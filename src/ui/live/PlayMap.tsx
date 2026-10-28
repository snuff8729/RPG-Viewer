import { useMemo, useState } from "react";
import type { ChecklistEvent } from "@/core/live/mapChecklist";
import { formatRoute } from "@/app/route";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Item, ItemContent, ItemGroup, ItemMedia } from "@/components/ui/item";
import { cn } from "@/lib/utils";
import { HereMapArea } from "./HereMapArea";
import { HereNotConnected } from "./HereNotConnected";
import { NextStoryCard } from "./NextStoryCard";
import { eventStyle } from "./sectionStyle";
import { actionableItems } from "./sidebarItems";
import { useHereMap } from "./useHereMap";

/** 한 줄 설명: 이동이면 어디로, 아니면 이게 뭔지 */
function rowHint(ev: ChecklistEvent): string {
  return ev.exit ? `→ ${ev.exit.mapName}` : ev.describe;
}

/** 플레이 화면의 맵 패널: 작은 맵(내 위치를 따라감)과 지금 해 볼 것만 한 줄씩. 줄을 누르면 맵에서 고르고 길을 보여준다. */
export function PlayMap() {
  const here = useHereMap();
  const { live, checklist, listed, numbers, selected, select, routeText } = here;
  const [focus, setFocus] = useState<{ x: number; y: number; n: number } | null>(null);
  const [rowRefs] = useState(() => new Map<number, HTMLElement>());
  const rows = useMemo(() => actionableItems(listed), [listed]);

  if (!live || !checklist) return <div className="p-3"><HereNotConnected /></div>;

  const choose = (ev: ChecklistEvent) => {
    select(ev.eventId);
    setFocus((f) => ({ x: ev.x, y: ev.y, n: (f?.n ?? 0) + 1 }));
  };
  const onPick = (id: number) => {
    select(id);
    rowRefs.get(id)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-2">
      <div className="max-h-[40%] shrink-0 overflow-y-auto">
        <NextStoryCard compact />
      </div>
      <div className="min-h-32 flex-1">
        <HereMapArea here={here} focus={focus} onPick={onPick} compact />
      </div>
      <div className="flex max-h-[45%] min-h-0 shrink-0 flex-col gap-1">
        <div className="flex items-center gap-2 px-1">
          <span className="text-sm font-semibold">지금 해 볼 것</span>
          <Badge variant="secondary">{rows.length}</Badge>
          <Button variant="link" size="sm" className="ml-auto h-auto p-0" asChild>
            <a href={formatRoute({ kind: "here" })}>자세히</a>
          </Button>
        </div>
        {rows.length === 0 ? (
          <p className="px-1 text-xs text-muted-foreground">이 맵에서 할 것을 다 했어요</p>
        ) : (
          <ItemGroup role="group" aria-label="지금 해 볼 것" className="min-h-0 gap-0.5 overflow-y-auto has-data-[size=xs]:gap-0.5">
            {rows.map((ev) => {
              const st = eventStyle(ev);
              const n = numbers.get(ev.eventId);
              const on = selected === ev.eventId;
              return (
                <Item
                  key={ev.eventId}
                  size="xs"
                  variant={on ? "muted" : "default"}
                  asChild
                  ref={(el: HTMLElement | null) => { if (el) rowRefs.set(ev.eventId, el); else rowRefs.delete(ev.eventId); }}
                >
                  <button type="button" aria-pressed={on} className="flex-nowrap text-left hover:bg-muted" onClick={() => choose(ev)}>
                    <ItemMedia className="gap-1.5">
                      <Badge variant="outline" className={cn("min-w-6 justify-center tabular-nums", st.text, st.border)}>{n ?? "·"}</Badge>
                      <st.Icon className={cn("size-4", st.text)} aria-label={st.label} />
                    </ItemMedia>
                    <ItemContent className="min-w-0">
                      <p className="truncate text-sm">
                        <span className="font-medium">{ev.title}</span>
                        {rowHint(ev) && <span className="text-muted-foreground"> · {rowHint(ev)}</span>}
                      </p>
                      {on && routeText !== undefined && (
                        <p className={cn("text-xs", routeText === null ? "text-muted-foreground" : "font-medium")}>
                          {routeText === null ? "갈 수 있는 길을 못 찾았어요" : `가는 길: ${routeText}`}
                        </p>
                      )}
                    </ItemContent>
                  </button>
                </Item>
              );
            })}
          </ItemGroup>
        )}
      </div>
    </div>
  );
}
