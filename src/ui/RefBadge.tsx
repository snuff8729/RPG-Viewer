import { useContext } from "react";
import { ArrowUpRight } from "lucide-react";
import type { Condition, Location, Ref } from "@/core/types";
import { Badge } from "@/components/ui/badge";
import { useLive } from "@/app/LiveProvider";
import { evaluate } from "@/core/live/evaluate";
import { cn } from "@/lib/utils";
import { conditionIcon, liveHintsEnabled } from "@/ui/live/annotations";
import { ScriptLocation } from "@/ui/script/ScriptLocation";

/** 긴 조건(스크립트 등)은 한 줄로 늘이지 않고 줄바꿈한다 */
const WRAP = "h-auto min-w-0 max-w-full shrink whitespace-normal wrap-anywhere";

/** 눌리는 참조 칩: 칩 전체가 단추(테두리 배지 + 오른쪽 ↗, 손가락 커서, hover 밑줄). 눌리지 않는 표시는 ↗를 쓰지 않아요. */
export const REF_CHIP = cn(WRAP, "cursor-pointer hover:bg-muted hover:underline");

const CLICKABLE = new Set(["switch", "variable", "item", "weapon", "armor"]);

/** 상호참조 시트를 열 수 있는 첫 번째 ref */
export function firstClickableRef(refs: Ref[]): Ref | undefined {
  return refs.find((r) => CLICKABLE.has(r.type));
}

export function RefBadge({ condition, onRefClick, location }: {
  condition: Condition; onRefClick?: (ref: Ref) => void; location?: Location;
}) {
  const { live, connection } = useLive();
  const ctxLoc = useContext(ScriptLocation);
  const loc = location ?? ctxLoc;
  const ctx = loc?.source === "map" ? { mapId: loc.mapId, eventId: loc.eventId } : {};
  const icon = liveHintsEnabled(connection) && condition.test ? conditionIcon(evaluate(condition.test, live, ctx)) : null;
  const text = icon ? `${icon} ${condition.text}` : condition.text;
  const ref = firstClickableRef(condition.refs);
  if (ref && onRefClick) {
    return (
      <Badge asChild variant="outline" className={REF_CHIP}>
        <button type="button" title="쓰는 곳 보기" onClick={() => onRefClick(ref)}>
          {text}
          <ArrowUpRight data-icon="inline-end" aria-hidden />
        </button>
      </Badge>
    );
  }
  return <Badge variant="secondary" className={WRAP}>{text}</Badge>;
}
