import { Star } from "lucide-react";
import type { Section } from "@/core/live/mapChecklist";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { LEGEND_KEYS, type LegendKey } from "./mapLegendState";
import { sectionStyle, storyStyle } from "./sectionStyle";

/** 맵에 점으로 그리는 구역(범례 순서) */
const SECTIONS: Section[] = ["now", "item", "repeat", "exit", "enemy", "talk", "locked", "done"];

/**
 * 맵 범례: 항목마다 맵 표시와 같은 색의 점·아이콘·이름. 누르면 맵 표시와 목록의 같은 줄을 숨기거나 보인다.
 * hidden: 끈 항목, regions: 적 나오는 구역이 있는 맵인지.
 */
export function MapLegend({ hidden, onChange, regions = false }: {
  hidden: ReadonlySet<LegendKey>;
  onChange: (visible: LegendKey[]) => void;
  regions?: boolean;
}) {
  const visible = LEGEND_KEYS.filter((k) => !hidden.has(k));
  const done = sectionStyle("done");
  return (
    <ToggleGroup
      type="multiple"
      variant="outline"
      size="sm"
      spacing={1}
      className="w-full flex-wrap"
      aria-label="범례 (누르면 맵과 목록에서 숨기거나 보여요)"
      value={visible}
      onValueChange={(v) => onChange(v as LegendKey[])}
    >
      {SECTIONS.map((k) => {
        const st = sectionStyle(k);
        return (
          <ToggleGroupItem key={k} value={k} className="font-normal data-[state=off]:opacity-50">
            <span className={cn("size-2.5 rounded-full", st.bg, k === "done" && "opacity-45")} aria-hidden />
            <st.Icon className={st.text} aria-hidden />
            {st.label}
          </ToggleGroupItem>
        );
      })}
      <ToggleGroupItem value="player" className="font-normal data-[state=off]:opacity-50">
        <span className="size-2.5 rounded-full border-2 border-foreground bg-foreground/55" aria-hidden />
        내 위치
      </ToggleGroupItem>
      <ToggleGroupItem value="story" className="font-normal data-[state=off]:opacity-50">
        <Star className={cn(storyStyle.text, storyStyle.fill)} aria-hidden />
        다음 스토리
      </ToggleGroupItem>
      <ToggleGroupItem value="spawn" className="font-normal data-[state=off]:opacity-50">
        <span className={cn("size-1.5 rounded-full opacity-45", done.bg)} aria-hidden />
        알 수 없는 생성 이벤트
      </ToggleGroupItem>
      {regions && (
        <ToggleGroupItem value="regions" className="font-normal data-[state=off]:opacity-50">
          <span className="size-2.5 rounded-sm bg-section-enemy/35" aria-hidden />
          적 나오는 구역
        </ToggleGroupItem>
      )}
    </ToggleGroup>
  );
}
