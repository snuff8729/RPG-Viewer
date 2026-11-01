import { useContext } from "react";
import { ArrowUpRight } from "lucide-react";
import type { Condition, Location, Ref } from "@/core/types";
import { Badge } from "@/components/ui/badge";
import { useLive } from "@/app/LiveProvider";
import { evaluate } from "@/core/live/evaluate";
import { REF_CHIP, REF_WRAP as WRAP } from "./refChip";
import { conditionIcon, liveHintsEnabled } from "@/ui/live/annotations";
import { ScriptLocation } from "@/ui/script/ScriptLocation";

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
