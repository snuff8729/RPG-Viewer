import type { ReactNode } from "react";
import { branchLabel } from "@/core/live/history";
import type { HistoryItem, HistoryModel, LogRecord, RecordOf } from "@/core/live/types";
import { formatText } from "@/core/text/escape";
import type { GameData, Location } from "@/core/types";
import { Badge } from "@/components/ui/badge";
import { explainRecord, reasonLabel } from "@/core/live/mismatch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { FaceImage } from "../script/FaceImage";
import { battleText, pickedFallbackText, reasonText, stateChangeText, transferText } from "./historyText";

export interface TimelineCtx {
  data: GameData;
  model: HistoryModel;
  selected: number;
  choiceText: Map<number, string>;
  onSelect(branchId: number): void;
  onJump(src: Location, cmd: number): void;
}

function Line({ ctx, src, cmd, uncertain, changed, rec, children }: { ctx: TimelineCtx; src?: Location | null; cmd?: number | null; uncertain?: boolean; changed?: boolean; rec?: LogRecord; children: ReactNode }) {
  const link = !uncertain && src && typeof cmd === "number";
  const m = (uncertain || changed) && rec ? explainRecord(rec, ctx.data) : null;
  return (
    <div className="flex items-start gap-2">
      <div
        className={cn("min-w-0 flex-1 rounded-md px-2 py-1 text-sm", link && "cursor-pointer hover:bg-muted")}
        onClick={link ? () => ctx.onJump(src, cmd) : undefined}
      >
        {children}
      </div>
      {(uncertain || changed) && (
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" className="mt-1 shrink-0">
              <Badge variant={uncertain ? "outline" : "secondary"}>{uncertain ? "위치 불확실" : "실행 중 변경됨"}</Badge>
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-80 text-sm">
            {m ? (
              <div className="flex flex-col gap-2">
                <div className="font-medium">{reasonLabel(m.reason)}</div>
                <div><div className="text-xs text-muted-foreground">기록</div><div className="whitespace-pre-line">{m.recorded}</div></div>
                <div><div className="text-xs text-muted-foreground">데이터</div><div className="whitespace-pre-line">{m.expected}</div></div>
              </div>
            ) : (
              <div>자세한 이유를 알 수 없어요</div>
            )}
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

function MessageLine({ r, ctx, uncertain, changed }: { r: RecordOf<"message">; ctx: TimelineCtx; uncertain?: boolean; changed?: boolean }) {
  return (
    <Line ctx={ctx} src={r.src} cmd={r.cmd} uncertain={uncertain} changed={changed} rec={r}>
      <div className="flex gap-3">
        <div className="size-10 shrink-0">{r.face && <FaceImage name={r.face} index={r.faceIndex} />}</div>
        <div className="min-w-0 flex-1">
          {r.speaker && <div className="font-semibold">{formatText(r.speaker, ctx.data)}</div>}
          <div className="whitespace-pre-line">{formatText(r.text, ctx.data)}</div>
        </div>
      </div>
    </Line>
  );
}

function RecordLine({ r, ctx, uncertain, changed }: { r: LogRecord; ctx: TimelineCtx; uncertain: boolean; changed: boolean }) {
  switch (r.type) {
    case "message": return <MessageLine r={r} ctx={ctx} uncertain={uncertain} changed={changed} />;
    case "scroll":
      return <Line ctx={ctx} src={r.src} cmd={r.cmd} uncertain={uncertain} changed={changed} rec={r}><div className="whitespace-pre-line text-muted-foreground">{formatText(r.text, ctx.data)}</div></Line>;
    case "choices": case "error": return null;
    case "choice":
      return <Line ctx={ctx} src={r.src} cmd={r.cmd} uncertain={uncertain} changed={changed} rec={r}>▶ 선택: "{ctx.choiceText.get(r.seq) ?? pickedFallbackText(r.picked)}"</Line>;
    case "picture": return <Line ctx={ctx} src={r.src} cmd={r.cmd} uncertain={uncertain} changed={changed} rec={r}>🖼 {r.name}</Line>;
    case "transfer": return <Line ctx={ctx}>{transferText(r, ctx.data)}</Line>;
    case "battle": return <Line ctx={ctx}>{battleText(r, ctx.data)}</Line>;
    case "save": return <Line ctx={ctx}>💾 저장 (슬롯 {r.slot})</Line>;
    case "load": return <Line ctx={ctx}>💾 불러오기 (슬롯 {r.slot})</Line>;
    case "branchStart":
      return (
        <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
          <div className="h-px flex-1 bg-border" />
          <span>{branchLabel(ctx.model, r.branch)} 시작 · {reasonText(r.reason)}</span>
          <div className="h-px flex-1 bg-border" />
        </div>
      );
    case "state":
      return <Line ctx={ctx} src={r.src} cmd={r.cmd} uncertain={uncertain} changed={changed} rec={r}><span className="text-muted-foreground">⚙ {r.changes.map(c => stateChangeText(c, ctx.data)).join(", ")}</span></Line>;
    default: return null;
  }
}

export function TimelineItem({ item, ctx }: { item: HistoryItem; ctx: TimelineCtx }) {
  switch (item.kind) {
    case "record": return <RecordLine r={item.record} ctx={ctx} uncertain={item.uncertain} changed={item.changed} />;
    case "repeat":
      return (
        <Collapsible>
          <CollapsibleTrigger asChild>
            <button type="button" className="w-full rounded-md px-2 py-1 text-left text-sm text-muted-foreground hover:bg-muted">↻ 같은 대화 다시 봄 ×{item.count}</button>
          </CollapsibleTrigger>
          <CollapsibleContent><MessageLine r={item.record} ctx={ctx} /></CollapsibleContent>
        </Collapsible>
      );
    case "stateGroup":
      return (
        <Collapsible>
          <CollapsibleTrigger asChild>
            <button type="button" className="w-full rounded-md px-2 py-1 text-left text-sm text-muted-foreground hover:bg-muted">⚙ 상태 변경 {item.count}개</button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ul className="space-y-0.5 px-2 pb-1 text-xs text-muted-foreground">
              {item.records.flatMap(r => r.changes.map((c, i) => <li key={`${r.seq}-${i}`}>{stateChangeText(c, ctx.data)}</li>))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      );
    case "fork":
      return (
        <div className="flex flex-wrap items-center gap-2 px-2 py-1 text-sm">
          <span className="text-muted-foreground">갈래 {item.branches.length}개 ⇄</span>
          {item.branches.map(id => (
            <Button key={id} size="xs" variant="outline" disabled={id === ctx.selected} onClick={() => ctx.onSelect(id)}>
              {branchLabel(ctx.model, id)}
            </Button>
          ))}
        </div>
      );
  }
}
