import type { ReactNode } from "react";
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
import { PlayMapContext, usePlayMap, usePlayMapController } from "./usePlayMapState";

/** 한 줄 설명: 이동이면 어디로, 아니면 이게 뭔지 */
function rowHint(ev: ChecklistEvent): string {
  return ev.exit ? `→ ${ev.exit.mapName}` : ev.describe;
}

/** 맵 조각(MapPicture·TodoList)이 함께 쓰는 상태(고른 이벤트·맵 초점). 조각들을 다른 칸에 둘 때는 둘 다 이 아래에 둔다. */
export function PlayMapProvider({ children }: { children: ReactNode }) {
  const state = usePlayMapController();
  return <PlayMapContext.Provider value={state}>{children}</PlayMapContext.Provider>;
}

/** 작은 맵 그림(내 위치를 따라감). 점을 누르면 고르고 목록에서 그 줄을 보인다. 게임이 연결되지 않았으면 안내. */
export function MapPicture() {
  const { here, focus, pick } = usePlayMap();
  if (!here.live || !here.checklist) return <HereNotConnected />;
  return <HereMapArea here={here} focus={focus} onPick={pick} compact />;
}

/** `지금 해 볼 것` 목록. 줄을 누르면 맵에서 고르고 길을 보여준다. 게임이 연결되지 않았으면 그리지 않는다. */
export function TodoList({ className }: { className?: string }) {
  const { here, rows, choose, rowRefs } = usePlayMap();
  const { live, checklist, numbers, selected, routeText } = here;
  if (!live || !checklist) return null;
  return (
    <div className={cn("flex min-h-0 flex-col gap-1", className)}>
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
  );
}

/** 다음 스토리 카드(맵 조각과 상태를 나누지 않는다. PlayMapProvider 없이도 쓸 수 있다). */
export function NextStory({ compact = true }: { compact?: boolean }) {
  return <NextStoryCard compact={compact} />;
}

function PlayMapLayout({ story }: { story: boolean }) {
  const { here } = usePlayMap();
  if (!here.live || !here.checklist) return <div className="p-3"><HereNotConnected /></div>;
  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-2">
      {story && (
        <div className="max-h-[40%] shrink-0 overflow-y-auto">
          <NextStory />
        </div>
      )}
      <div className="min-h-32 flex-1">
        <MapPicture />
      </div>
      <TodoList className="max-h-[45%] shrink-0" />
    </div>
  );
}

/**
 * 플레이 화면의 맵 패널: 작은 맵(내 위치를 따라감)과 지금 해 볼 것만 한 줄씩. 줄을 누르면 맵에서 고르고 길을 보여준다.
 * story=false면 다음 스토리 카드를 빼고 맵에 자리를 준다(휴대폰은 스토리 탭에 따로 둔다).
 * 조각(MapPicture · TodoList · NextStory)을 다른 칸에 나눠 둘 때는 PlayMapProvider로 감싸 직접 놓는다.
 */
export function PlayMap({ story = true }: { story?: boolean }) {
  return (
    <PlayMapProvider>
      <PlayMapLayout story={story} />
    </PlayMapProvider>
  );
}
