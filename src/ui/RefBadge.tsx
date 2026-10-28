import type { Condition, Ref } from "@/core/types";
import { Badge } from "@/components/ui/badge";

const CLICKABLE = new Set(["switch", "variable", "item", "weapon", "armor"]);

export function RefBadge({ condition, onRefClick }: { condition: Condition; onRefClick?: (ref: Ref) => void }) {
  const ref = condition.refs.find((r) => CLICKABLE.has(r.type));
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
