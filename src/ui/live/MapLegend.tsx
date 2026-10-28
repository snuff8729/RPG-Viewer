import type { Section } from "@/core/live/mapChecklist";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { sectionStyle } from "./sectionStyle";

/** 맵에 점으로 그리는 구역(범례 순서) */
const LEGEND: Section[] = ["now", "item", "repeat", "exit", "enemy", "talk", "locked", "done"];

/** 맵 아래 범례: 구역마다 색·아이콘·이름, 그리고 내 위치. */
export function MapLegend() {
  return (
    <div className="flex flex-wrap gap-1.5" aria-label="범례">
      {LEGEND.map((k) => {
        const st = sectionStyle(k);
        return (
          <Badge key={k} variant="outline" className={cn("gap-1 font-normal", st.border)}>
            <span className={cn("size-2 rounded-full", st.bg)} aria-hidden />
            <st.Icon className={st.text} aria-hidden />
            {st.label}
          </Badge>
        );
      })}
      <Badge variant="outline" className="gap-1 font-normal">
        <span className="size-2 rounded-full border-2 border-foreground" aria-hidden />
        내 위치
      </Badge>
    </div>
  );
}
