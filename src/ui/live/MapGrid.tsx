import type { ChecklistEvent, Section } from "@/core/live/mapChecklist";
import { Card, CardContent } from "@/components/ui/card";

/** 구역별 점 색(테마 CSS 변수) */
const DOT: Record<Section, string> = {
  now: "fill-primary",
  repeat: "fill-primary/60",
  locked: "fill-muted-foreground",
  done: "fill-border",
};
const LEGEND: [Section, string, string][] = [
  ["now", "지금 할 수 있음", "bg-primary"],
  ["repeat", "반복하면 달라짐", "bg-primary/60"],
  ["locked", "잠김", "bg-muted-foreground"],
  ["done", "다 봄", "bg-border"],
];
const GRID_MAX = 60;

function GridLines({ width, height }: { width: number; height: number }) {
  let d = "";
  for (let x = 1; x < width; x++) d += `M${x} 0V${height}`;
  for (let y = 1; y < height; y++) d += `M0 ${y}H${width}`;
  return <path d={d} className="fill-none stroke-border" strokeWidth={1} vectorEffect="non-scaling-stroke" />;
}

/** 맵 크기만큼의 위치 그림: 이벤트 점(구역 색)과 플레이어 고리. 점을 누르면 onPick(eventId). */
export function MapGrid({ width, height, events, player, onPick }: {
  width: number; height: number; events: ChecklistEvent[]; player: { x: number; y: number };
  onPick: (eventId: number) => void;
}) {
  if (!(width > 0 && height > 0)) return null;
  const r = Math.max(0.4, Math.max(width, height) / 100);
  return (
    <Card className="gap-2 py-3">
      <CardContent className="space-y-2 px-3">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="xMidYMid meet"
          className="block h-auto max-h-60 w-full"
          role="img"
          aria-label="맵 위치"
        >
          <rect width={width} height={height} className="fill-muted" />
          {width <= GRID_MAX && height <= GRID_MAX && <GridLines width={width} height={height} />}
          {events.map((ev) => (
            <circle
              key={ev.eventId}
              cx={ev.x + 0.5}
              cy={ev.y + 0.5}
              r={r}
              className={`${DOT[ev.section]} cursor-pointer stroke-background`}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
              role="button"
              tabIndex={0}
              aria-label={ev.title}
              onClick={() => onPick(ev.eventId)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(ev.eventId); } }}
            >
              <title>{ev.name ? `${ev.name} — ${ev.title}` : ev.title}</title>
            </circle>
          ))}
          <circle
            cx={player.x + 0.5}
            cy={player.y + 0.5}
            r={r * 1.6}
            className="pointer-events-none fill-none stroke-foreground"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          >
            <title>내 위치</title>
          </circle>
        </svg>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {LEGEND.map(([k, label, bg]) => (
            <span key={k} className="flex items-center gap-1"><span className={`size-2 rounded-full ${bg}`} />{label}</span>
          ))}
          <span className="flex items-center gap-1"><span className="size-2 rounded-full border-2 border-foreground" />내 위치</span>
        </div>
      </CardContent>
    </Card>
  );
}
