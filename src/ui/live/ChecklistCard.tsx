import type { Ref } from "react";
import { ChevronRight, MapPin } from "lucide-react";
import { hintBody, type ChecklistEvent, type LockedPage } from "@/core/live/mapChecklist";
import { openPage } from "@/ui/navigation";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { HowToView } from "./HowToView";
import { eventStyle } from "./sectionStyle";

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
      {lp.shadowed && (
        <p className="text-xs text-muted-foreground">더 뒤 페이지가 먼저 나와서 지금은 안 나와요 — 그 페이지의 조건이 바뀌면 나와요</p>
      )}
    </div>
  );
}

export function ChecklistCard({ ev, number, highlighted, selected, route, onLocate, ref }: {
  ev: ChecklistEvent; /** 맵 번호(1부터, 고정). 이야기·자동 진행은 없음 */ number?: number; highlighted: boolean;
  /** 맵에서 고른 이벤트 */
  selected?: boolean;
  /** 고른 이벤트까지 가는 길 설명. null = 길을 못 찾음, undefined = 보여주지 않음 */
  route?: string | null;
  /** `위치 보기`: 맵에서 이 이벤트를 고르고 가운데로 */
  onLocate?: () => void;
  ref?: Ref<HTMLDivElement>;
}) {
  const st = eventStyle(ev);
  const target = ev.location ?? ev.locked[0]?.location ?? null;
  const lockedPages = ev.locked.length;
  /** 조사·대화 가능 카드와 아직 안 해 본 조사 지점에 보이는 플러그인 명령 글 */
  // (이게 뭔지 줄에 이미 그 글이 나오면 다시 쓰지 않는다)
  const hint = (ev.section === "talk" || ev.untried) && ev.pluginHint && !ev.describe.includes(hintBody(ev.pluginHint).slice(0, 20))
    ? ev.pluginHint : undefined;
  return (
    <Card ref={ref} className={cn("gap-3 border-l-4 py-4 transition-shadow", st.border, selected && "ring-1 ring-ring", highlighted && "ring-2 ring-ring")}>
      <CardHeader className="px-4">
        <CardTitle className="flex flex-wrap items-center gap-2">
          <st.Icon className={cn("size-4 shrink-0", st.text)} aria-hidden />
          <span>{number != null ? `${number}. ` : ""}{ev.title}</span>
          <Badge variant="outline" className={cn(st.text, st.border)}>{st.label}</Badge>
          {ev.exit && <Badge variant="outline" className={cn(st.text, st.border)}>→ {ev.exit.mapName}</Badge>}
          {ev.moves && <Badge variant="secondary">돌아다님</Badge>}
          {ev.untried && <Badge>아직 안 해 봄</Badge>}
          {ev.unseen > 0 && <Badge>새 대화 {ev.unseen}</Badge>}
          {ev.unpicked > 0 && <Badge>선택지 {ev.unpicked}</Badge>}
          {ev.section !== "repeat" && ev.repeat.length > 0 && <Badge variant="secondary">반복하면 달라짐</Badge>}
          {ev.auto && <Badge variant="outline">자동</Badge>}
          {lockedPages > 0 && <Badge variant="outline">잠긴 내용 {lockedPages}</Badge>}
        </CardTitle>
        <CardDescription>
          {ev.name && ev.name !== ev.title ? `${ev.name} · ` : ""}({ev.x}, {ev.y})
        </CardDescription>
        {ev.describe && <p className="text-sm">{ev.describe}</p>}
        {route !== undefined && (
          <p className={cn("text-sm font-medium", route === null && "text-muted-foreground")}>
            {route === null ? "갈 수 있는 길을 못 찾았어요" : `가는 길: ${route}`}
          </p>
        )}
      </CardHeader>
      {(ev.repeat.length > 0 || lockedPages > 0 || ev.gains.length > 0 || hint) && (
        <CardContent className="space-y-2 px-4">
          {ev.gains.length > 0 && (
            <ul className="space-y-0.5 text-sm">
              {ev.gains.map((g, i) => <li key={i}>{g}</li>)}
            </ul>
          )}
          {hint && <p className="text-sm text-muted-foreground">플러그인: {hint}</p>}
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
      {(target || onLocate) && (
        <CardFooter className="gap-2 px-4">
          {onLocate && (
            <Button variant="outline" size="sm" onClick={onLocate}><MapPin />위치 보기</Button>
          )}
          {target && <Button variant="outline" size="sm" onClick={() => openPage(target)}>탐색기에서 보기</Button>}
        </CardFooter>
      )}
    </Card>
  );
}
