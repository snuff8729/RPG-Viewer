import { useState } from "react";
import { useLive } from "@/app/LiveProvider";
import { locationKey } from "@/core/index/locations";
import type { EvalStatus, MissingItem } from "@/core/live/types";
import { openPage } from "@/ui/navigation";
import { highlightNode } from "@/ui/highlight";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { filterReachable, pageSlice, splitMissing, PAGE_SIZE } from "./missingItems";

const MARK: Record<EvalStatus, string> = { met: "✓", unmet: "✗", unknown: "?" };

function go(m: MissingItem) {
  openPage(m.entry.location);
  highlightNode(locationKey(m.entry.location), m.nodePath);
}

function Item({ m }: { m: MissingItem }) {
  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={() => go(m)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(m); } }}
      className="cursor-pointer gap-1 px-3 py-2 hover:bg-accent"
    >
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold">{m.label}</span>
        {m.onCurrentMap && <Badge>지금 이 맵</Badge>}
      </div>
      <div className="text-xs text-muted-foreground">{m.entry.path}</div>
      {m.requirements.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {m.requirements.map((r, i) => (
            <Badge
              key={i}
              variant={r.status === "met" ? "secondary" : "outline"}
              className={r.status === "unknown" ? "text-muted-foreground" : undefined}
            >
              {MARK[r.status]} {r.text}
            </Badge>
          ))}
        </div>
      )}
    </Card>
  );
}

function Section({ title, items }: { title: string; items: MissingItem[] }) {
  const [pages, setPages] = useState(1);
  const shown = pageSlice(items, pages);
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">{title} ({items.length})</h3>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">없음</p>
      ) : (
        <div className="space-y-2">
          {shown.map((m, i) => <Item key={`${locationKey(m.entry.location)}:${m.nodePath.join(".")}:${i}`} m={m} />)}
          {shown.length < items.length && (
            <Button variant="outline" size="sm" onClick={() => setPages((p) => p + 1)}>
              더 보기 ({Math.min(PAGE_SIZE, items.length - shown.length)}개)
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

export function MissingView() {
  const { missing, connection } = useLive();
  const [reachableOnly, setReachableOnly] = useState(false);
  const { choices, pages } = splitMissing(filterReachable(missing, reachableOnly));
  const offline = connection === "noPlugin" || connection === "waiting";
  return (
    <div className="space-y-4 p-1">
      <div className="flex items-center gap-2">
        <Switch id="missing-reachable" checked={reachableOnly} onCheckedChange={setReachableOnly} />
        <Label htmlFor="missing-reachable">지금 갈 수 있는 것만</Label>
      </div>
      {offline && <p className="text-xs text-muted-foreground">게임에 연결되면 조건 충족 여부가 표시돼요</p>}
      <Section key={`c${reachableOnly}`} title="안 고른 선택지 항목" items={choices} />
      <Section key={`p${reachableOnly}`} title="안 본 대사가 있는 페이지" items={pages} />
    </div>
  );
}
