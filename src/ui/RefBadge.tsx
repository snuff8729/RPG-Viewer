import type { Condition, Ref } from "@/core/types";
import { Badge } from "@/components/ui/badge";

const CLICKABLE = new Set(["switch", "variable", "item", "weapon", "armor"]);

/** 상호참조 시트를 열 수 있는 첫 번째 ref */
export function firstClickableRef(refs: Ref[]): Ref | undefined {
  return refs.find((r) => CLICKABLE.has(r.type));
}

export function RefBadge({ condition, onRefClick }: { condition: Condition; onRefClick?: (ref: Ref) => void }) {
  const ref = firstClickableRef(condition.refs);
  if (ref && onRefClick) {
    return (
      <Badge asChild variant="secondary">
        <button type="button" className="cursor-pointer hover:bg-secondary/80" onClick={() => onRefClick(ref)}>
          {condition.text}
        </button>
      </Badge>
    );
  }
  return <Badge variant="secondary">{condition.text}</Badge>;
}
