import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Info } from "lucide-react";
import { useGame } from "@/app/GameProvider";
import { useLive } from "@/app/LiveProvider";
import { livePositions, withLivePositions } from "@/core/live/positions";
import { routeTo, standTiles } from "@/core/map/route";
import type { ChecklistEvent } from "@/core/live/mapChecklist";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { ChecklistCard } from "./ChecklistCard";
import { MapCanvas } from "./MapCanvas";
import { MapGrid } from "./MapGrid";
import { blockersFor, currentEvents, mapMarkers, mapNumbers, pagesKey, targetOf, type LiveEventEntry } from "./mapEvents";
import { eventStyle, sectionStyle, type SectionStyle } from "./sectionStyle";
import { useMapChecklist } from "./useMapChecklist";
import { useMapTiles } from "./useMapTiles";

const HIGHLIGHT_MS = 1500;
/** 다 봄 (다시 가능)이 이보다 많으면 처음엔 접어 둔다 */
const TALK_FOLD = 8;
type GroupKey = ChecklistEvent["section"] | "story";
/** 목록 구역 순서. 이야기·자동 진행(story)은 구역과 상관없이 따로 모은다 */
const GROUP_KEYS: GroupKey[] = ["now", "item", "repeat", "exit", "talk", "locked", "story", "done"];
const groupOf = (e: ChecklistEvent): GroupKey => (e.story ? "story" : e.section);
const groupStyle = (k: GroupKey): SectionStyle => (k === "story" ? eventStyle({ section: "locked", story: true }) : sectionStyle(k));

type CardRefs = Map<number, HTMLDivElement>;

function Cards({ events, numbers, refs, highlight, selected, route, onLocate }: {
  events: ChecklistEvent[]; numbers: Map<number, number>; refs: CardRefs; highlight: number | null;
  selected: number | null;
  /** 고른 카드에 보일 길 설명(ChecklistCard의 route) */
  route: string | null | undefined;
  onLocate: (ev: ChecklistEvent) => void;
}) {
  return (
    <div className="space-y-3">
      {events.map((ev) => (
        <ChecklistCard
          key={ev.eventId}
          ev={ev}
          number={numbers.get(ev.eventId)}
          highlighted={highlight === ev.eventId}
          selected={selected === ev.eventId}
          route={selected === ev.eventId ? route : undefined}
          onLocate={() => onLocate(ev)}
          ref={(el) => { if (el) refs.set(ev.eventId, el); else refs.delete(ev.eventId); }}
        />
      ))}
    </div>
  );
}

/** 이 맵 탭: 지금 있는 맵의 안 본 내용·아이템·반복하면 달라지는 것·조사할 곳·잠긴 것·이야기 진행 조건·다 본 것. */
export function HereView() {
  const { connection, live } = useLive();
  const checklist = useMapChecklist();
  // 카드 DOM 맵(바뀌지 않는 객체 하나)
  const [refs] = useState<CardRefs>(() => new Map());
  /** 접을 수 있는 구역을 사용자가 펼치거나 접은 상태(없으면 기본값) */
  const [open, setOpen] = useState<Partial<Record<GroupKey, boolean>>>({});
  /** n: 같은 점을 다시 눌러도 스크롤·강조가 다시 일어나게 */
  const [pick, setPick] = useState<{ id: number; n: number } | null>(null);
  const [highlight, setHighlight] = useState<number | null>(null);
  const { data } = useGame();
  const mapId = checklist?.mapId ?? null;
  const tilesState = useMapTiles(mapId);
  const tiles = tilesState.status === "ready" ? tilesState.tiles : null;
  const mapData = mapId != null ? data?.maps.get(mapId) : undefined;
  // 활성 페이지·이벤트 위치가 바뀔 때만 이벤트 그림·길막음을 다시 계산한다
  const livePages = live && live.mapId === mapId ? live.events : null;
  const pk = livePages ? pagesKey(livePages) : "";
  const [pagesFor, setPagesFor] = useState<{ pk: string; pages: LiveEventEntry[] }>({ pk: "", pages: [] });
  if (pagesFor.pk !== pk) setPagesFor({ pk, pages: livePages ?? [] });
  const current = useMemo(() => currentEvents(mapData, pagesFor.pages), [mapData, pagesFor]);
  /** 체크리스트 이벤트를 지금 위치(돌아다니는 NPC)로 */
  const listed = useMemo(
    () => (checklist ? withLivePositions(checklist.events, livePositions(pagesFor.pages)) : []),
    [checklist, pagesFor],
  );
  /** 맵에서 고른 이벤트(맵이 바뀌면 풀린다) */
  const [sel, setSel] = useState<{ mapId: number; id: number } | null>(null);
  const selected = sel && sel.mapId === mapId ? sel.id : null;
  const [focus, setFocus] = useState<{ x: number; y: number; n: number } | null>(null);
  const selectedEv = selected != null ? listed.find((e) => e.eventId === selected) : undefined;
  const px = live?.x ?? 0, py = live?.y ?? 0;
  const route = useMemo(() => {
    if (!tiles || !selectedEv) return null;
    const stands = standTiles(targetOf(mapData, selectedEv), tiles.map, tiles.tileset);
    return routeTo(tiles.map, tiles.tileset, { x: px, y: py }, stands, blockersFor(current, selectedEv.eventId));
  }, [tiles, selectedEv, mapData, current, px, py]);

  useEffect(() => {
    if (!pick) return;
    // 접힌 구역을 방금 펼쳤다면 카드가 그려진 뒤에 찾는다
    const raf = requestAnimationFrame(() => refs.get(pick.id)?.scrollIntoView({ block: "center", behavior: "smooth" }));
    const t = window.setTimeout(() => setHighlight(null), HIGHLIGHT_MS);
    return () => { cancelAnimationFrame(raf); window.clearTimeout(t); };
  }, [pick, refs]);

  if (connection !== "connected" || !live) {
    return (
      <Alert>
        <Info />
        <AlertDescription>게임에 연결하면 지금 있는 맵을 보여줘요.</AlertDescription>
      </Alert>
    );
  }
  if (!checklist) return <p className="text-sm text-muted-foreground">지금 맵 정보를 찾을 수 없어요</p>;

  const groups = new Map<GroupKey, ChecklistEvent[]>(GROUP_KEYS.map((k) => [k, []]));
  for (const e of listed) groups.get(groupOf(e))?.push(e);
  // 맵 데이터로 정한 고정 번호(확인해도 안 바뀐다). 맵 점과 카드 제목이 같이 쓴다
  const numbers = mapNumbers(listed);
  /** 접을 수 있는 구역과 처음에 접혀 있는지 */
  const foldable: Partial<Record<GroupKey, boolean>> = {
    talk: (groups.get("talk")?.length ?? 0) > TALK_FOLD, story: true, done: true,
  };
  const isOpen = (k: GroupKey) => open[k] ?? !foldable[k];
  const setGroupOpen = (k: GroupKey, v: boolean) => setOpen((o) => ({ ...o, [k]: v }));
  const onLocate = (ev: ChecklistEvent) => {
    setSel({ mapId: checklist.mapId, id: ev.eventId });
    setFocus((f) => ({ x: ev.x, y: ev.y, n: (f?.n ?? 0) + 1 }));
  };
  /** 고른 카드의 길 설명: 타일을 못 읽으면 보여주지 않는다 */
  const routeText = tiles ? (route?.text ?? null) : undefined;
  const onPick = (id: number) => {
    const ev = listed.find((e) => e.eventId === id);
    if (ev && !isOpen(groupOf(ev))) setGroupOpen(groupOf(ev), true);
    setSel({ mapId: checklist.mapId, id });
    setHighlight(id);
    setPick((p) => ({ id, n: (p?.n ?? 0) + 1 }));
  };

  return (
    <div className="space-y-4 p-1">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">{checklist.mapName}</h2>
        <span className="text-sm text-muted-foreground">내 위치 ({live.x}, {live.y})</span>
        <Badge variant={checklist.remaining > 0 ? "default" : "secondary"}>할 것 {checklist.remaining}개 남음</Badge>
      </div>
      {tilesState.status === "loading" && <Skeleton className="h-[min(60vh,32rem)] w-full" />}
      {tiles && (
        <MapCanvas
          tiles={tiles}
          events={current}
          listed={listed}
          numbers={numbers}
          player={{ x: live.x, y: live.y }}
          route={route}
          selected={selected}
          focus={focus}
          onPick={onPick}
        />
      )}
      {tilesState.status === "failed" && (
        <MapGrid width={checklist.width} height={checklist.height} events={mapMarkers(listed, false)} player={{ x: live.x, y: live.y }} numbers={numbers} onPick={onPick} />
      )}
      {checklist.events.length === 0 && <p className="text-sm text-muted-foreground">이 맵에는 볼 만한 이벤트가 없어요</p>}
      {GROUP_KEYS.map((key) => {
        const evs = groups.get(key) ?? [];
        if (evs.length === 0) return null;
        const st = groupStyle(key);
        const done = key === "done";
        const title = (
          <>
            {!done && <st.Icon className="size-4 shrink-0" aria-hidden />}
            {done ? "다 봤어요" : st.label} <span className="font-normal text-muted-foreground">({evs.length})</span>
          </>
        );
        const cards = <Cards events={evs} numbers={numbers} refs={refs} highlight={highlight} selected={selected} route={routeText} onLocate={onLocate} />;
        if (!foldable[key]) {
          return (
            <section key={key} className="space-y-2">
              <h3 className={cn("flex items-center gap-1.5 text-sm font-semibold", st.text)}>{title}</h3>
              {cards}
            </section>
          );
        }
        return (
          <Collapsible key={key} open={isOpen(key)} onOpenChange={(v) => setGroupOpen(key, v)}>
            <CollapsibleTrigger className={cn("group flex items-center gap-1.5 text-sm font-semibold", !done && st.text)}>
              <ChevronRight className="size-4 shrink-0 transition-transform group-data-[state=open]:rotate-90" />
              {title}
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2">{cards}</CollapsibleContent>
          </Collapsible>
        );
      })}
    </div>
  );
}
