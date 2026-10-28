import type { Ref } from "react";
import { ChevronRight } from "lucide-react";
import type { ChecklistEvent, LockedPage } from "@/core/live/mapChecklist";
import { openPage } from "@/ui/navigation";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { HowToView } from "./HowToView";

/** `새 대화 N · 선택지 N` (0인 쪽 생략) */
function newText(unseen: number, unpicked: number): string {
  return [unseen > 0 ? `새 대화 ${unseen}` : "", unpicked > 0 ? `선택지 ${unpicked}` : ""].filter(Boolean).join(" · ");
}

function Toggle({ label, className }: { label: string; className?: string }) {
  return (
    <CollapsibleTrigger className={cn("group flex items-center gap-1 text-left text-sm font-medium", className)}>
      <ChevronRight className="size-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-90" />
      {label}
    </CollapsibleTrigger>
  );
}

function Locked({ lp }: { lp: LockedPage }) {
  return (
    <div className="space-y-1 rounded-md border p-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Button variant="link" size="sm" className="h-auto p-0 font-semibold" onClick={() => openPage(lp.location)}>p{lp.page + 1}</Button>
        <span className="text-xs text-muted-foreground">{newText(lp.unseen, lp.unpicked)}</span>
      </div>
      <ul className="space-y-1 text-sm">
        {lp.conditions.map((cd, i) => (
          <li key={i}>
            <span className={cd.met ? "text-muted-foreground" : undefined}>{cd.met ? "✓" : "✗"} {cd.text}</span>
            {!cd.met && cd.req && (
              <Collapsible className="mt-1 ml-4">
                <Toggle label="조건 만드는 법" className="text-xs text-muted-foreground" />
                {/* 접혀 있으면 내용이 마운트되지 않아 howTo도 계산하지 않는다 */}
                <CollapsibleContent className="mt-1">
                  <HowToView req={cd.req} />
                </CollapsibleContent>
              </Collapsible>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ChecklistCard({ ev, highlighted, ref }: { ev: ChecklistEvent; highlighted: boolean; ref?: Ref<HTMLDivElement> }) {
  const target = ev.location ?? ev.locked[0]?.location ?? null;
  const lockedPages = ev.locked.length;
  return (
    <Card ref={ref} className={cn("gap-3 py-4 transition-shadow", highlighted && "ring-2 ring-ring")}>
      <CardHeader className="px-4">
        <CardTitle className="flex flex-wrap items-center gap-2">
          <span>{ev.title}</span>
          {ev.unseen > 0 && <Badge>새 대화 {ev.unseen}</Badge>}
          {ev.unpicked > 0 && <Badge>선택지 {ev.unpicked}</Badge>}
          {ev.repeat.length > 0 && <Badge variant="secondary">반복하면 달라짐</Badge>}
          {ev.auto && <Badge variant="outline">자동</Badge>}
          {lockedPages > 0 && <Badge variant="outline">잠긴 내용 {lockedPages}</Badge>}
        </CardTitle>
        <CardDescription>
          {ev.name && ev.name !== ev.title ? `${ev.name} · ` : ""}({ev.x}, {ev.y})
        </CardDescription>
      </CardHeader>
      {(ev.repeat.length > 0 || lockedPages > 0) && (
        <CardContent className="space-y-2 px-4">
          {ev.repeat.length > 0 && (
            <ul className="space-y-0.5 text-sm">
              {ev.repeat.map((r, i) => <li key={i}>{r.text}{r.estimated ? " (추정)" : ""}</li>)}
            </ul>
          )}
          {lockedPages > 0 && (
            <Collapsible>
              <Toggle label="잠긴 내용 보기" />
              <CollapsibleContent className="mt-2 space-y-2">
                {ev.locked.map((lp) => <Locked key={lp.page} lp={lp} />)}
              </CollapsibleContent>
            </Collapsible>
          )}
        </CardContent>
      )}
      {target && (
        <CardFooter className="px-4">
          <Button variant="outline" size="sm" onClick={() => openPage(target)}>탐색기에서 보기</Button>
        </CardFooter>
      )}
    </Card>
  );
}
