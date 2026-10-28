import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { ChecklistEvent } from "@/core/live/mapChecklist";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { ChecklistCard } from "./ChecklistCard";
import { EncounterCard } from "./EncounterCard";
import { HereMapArea } from "./HereMapArea";
import { HereNotConnected } from "./HereNotConnected";
import { eventStyle, sectionStyle, type SectionStyle } from "./sectionStyle";
import { useHereMap } from "./useHereMap";

const HIGHLIGHT_MS = 1500;
/** 다 봄 (다시 가능)이 이보다 많으면 처음엔 접어 둔다 */
const TALK_FOLD = 8;
type GroupKey = ChecklistEvent["section"] | "story";
/** 목록 구역 순서. 이야기·자동 진행(story)은 구역과 상관없이 따로 모은다 */
const GROUP_KEYS: GroupKey[] = ["now", "item", "repeat", "exit", "enemy", "talk", "locked", "story", "done"];
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
  const here = useHereMap();
  const { live, checklist, listed, numbers, selected, select, routeText } = here;
  // 카드 DOM 맵(바뀌지 않는 객체 하나)
  const [refs] = useState<CardRefs>(() => new Map());
  /** 접을 수 있는 구역을 사용자가 펼치거나 접은 상태(없으면 기본값) */
  const [open, setOpen] = useState<Partial<Record<GroupKey, boolean>>>({});
  /** n: 같은 점을 다시 눌러도 스크롤·강조가 다시 일어나게 */
  const [pick, setPick] = useState<{ id: number; n: number } | null>(null);
  const [highlight, setHighlight] = useState<number | null>(null);
  const [focus, setFocus] = useState<{ x: number; y: number; n: number } | null>(null);

  useEffect(() => {
    if (!pick) return;
    // 접힌 구역을 방금 펼쳤다면 카드가 그려진 뒤에 찾는다
    const raf = requestAnimationFrame(() => refs.get(pick.id)?.scrollIntoView({ block: "center", behavior: "smooth" }));
    const t = window.setTimeout(() => setHighlight(null), HIGHLIGHT_MS);
    return () => { cancelAnimationFrame(raf); window.clearTimeout(t); };
  }, [pick, refs]);

  if (!live || !checklist) return <HereNotConnected />;

  const groups = new Map<GroupKey, ChecklistEvent[]>(GROUP_KEYS.map((k) => [k, []]));
  for (const e of listed) groups.get(groupOf(e))?.push(e);
  /** 접을 수 있는 구역과 처음에 접혀 있는지 */
  const foldable: Partial<Record<GroupKey, boolean>> = {
    talk: (groups.get("talk")?.length ?? 0) > TALK_FOLD, story: true, done: true,
  };
  const isOpen = (k: GroupKey) => open[k] ?? !foldable[k];
  const setGroupOpen = (k: GroupKey, v: boolean) => setOpen((o) => ({ ...o, [k]: v }));
  const onLocate = (ev: ChecklistEvent) => {
    select(ev.eventId);
    setFocus((f) => ({ x: ev.x, y: ev.y, n: (f?.n ?? 0) + 1 }));
  };
  const onPick = (id: number) => {
    const ev = listed.find((e) => e.eventId === id);
    if (ev && !isOpen(groupOf(ev))) setGroupOpen(groupOf(ev), true);
    select(id);
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
      <HereMapArea here={here} focus={focus} onPick={onPick} />
      <EncounterCard mapId={checklist.mapId} />
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
