import { useEffect, useState } from "react";
import { ChevronRight, Info } from "lucide-react";
import { useLive } from "@/app/LiveProvider";
import type { ChecklistEvent, Section } from "@/core/live/mapChecklist";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChecklistCard } from "./ChecklistCard";
import { MapGrid } from "./MapGrid";
import { useMapChecklist } from "./useMapChecklist";

const HIGHLIGHT_MS = 1500;
const SECTIONS: [Exclude<Section, "done">, string][] = [
  ["now", "지금 할 수 있어요"],
  ["repeat", "반복하면 달라져요"],
  ["locked", "아직 잠겨 있어요"],
];

type CardRefs = Map<number, HTMLDivElement>;

function Cards({ events, refs, highlight }: { events: ChecklistEvent[]; refs: CardRefs; highlight: number | null }) {
  return (
    <div className="space-y-3">
      {events.map((ev) => (
        <ChecklistCard
          key={ev.eventId}
          ev={ev}
          highlighted={highlight === ev.eventId}
          ref={(el) => { if (el) refs.set(ev.eventId, el); else refs.delete(ev.eventId); }}
        />
      ))}
    </div>
  );
}

/** 이 맵 탭: 지금 있는 맵에서 할 수 있는 것·반복하면 달라지는 것·잠긴 것·다 본 것. */
export function HereView() {
  const { connection, live } = useLive();
  const checklist = useMapChecklist();
  // 카드 DOM 맵(바뀌지 않는 객체 하나)
  const [refs] = useState<CardRefs>(() => new Map());
  const [doneOpen, setDoneOpen] = useState(false);
  /** n: 같은 점을 다시 눌러도 스크롤·강조가 다시 일어나게 */
  const [pick, setPick] = useState<{ id: number; n: number } | null>(null);
  const [highlight, setHighlight] = useState<number | null>(null);

  useEffect(() => {
    if (!pick) return;
    // 다 봤어요 구역을 방금 펼쳤다면 카드가 그려진 뒤에 찾는다
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

  const bySection = (s: Section) => checklist.events.filter((e) => e.section === s);
  const done = bySection("done");
  const onPick = (id: number) => {
    if (done.some((e) => e.eventId === id)) setDoneOpen(true);
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
      <MapGrid width={checklist.width} height={checklist.height} events={checklist.events} player={{ x: live.x, y: live.y }} onPick={onPick} />
      {checklist.events.length === 0 && <p className="text-sm text-muted-foreground">이 맵에는 볼 만한 이벤트가 없어요</p>}
      {SECTIONS.map(([s, label]) => {
        const evs = bySection(s);
        if (evs.length === 0) return null;
        return (
          <section key={s} className="space-y-2">
            <h3 className="text-sm font-semibold">{label} <span className="font-normal text-muted-foreground">({evs.length})</span></h3>
            <Cards events={evs} refs={refs} highlight={highlight} />
          </section>
        );
      })}
      {done.length > 0 && (
        <Collapsible open={doneOpen} onOpenChange={setDoneOpen}>
          <CollapsibleTrigger className="group flex items-center gap-1 text-sm font-semibold">
            <ChevronRight className="size-4 shrink-0 transition-transform group-data-[state=open]:rotate-90" />
            다 봤어요 ({done.length})
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2">
            <Cards events={done} refs={refs} highlight={highlight} />
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
