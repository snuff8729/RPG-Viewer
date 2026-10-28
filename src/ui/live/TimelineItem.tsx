import type { ReactNode } from "react";
import { branchLabel } from "@/core/live/history";
import type { HistoryItem, HistoryModel, LogRecord, RecordOf } from "@/core/live/types";
import { formatText } from "@/core/text/escape";
import type { GameData, Location } from "@/core/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { FaceImage } from "../script/FaceImage";
import { battleText, reasonText, stateChangeText, transferText } from "./historyText";

export interface TimelineCtx {
  data: GameData;
  model: HistoryModel;
  selected: number;
  choiceText: Map<number, string>;
  onSelect(branchId: number): void;
  onJump(src: Location, cmd: number): void;
}

function Line({ ctx, src, cmd, uncertain, children }: { ctx: TimelineCtx; src?: Location | null; cmd?: number | null; uncertain?: boolean; children: ReactNode }) {
  const link = !uncertain && src && typeof cmd === "number";
  return (
    <div className="flex items-start gap-2">
      <div
        className={cn("min-w-0 flex-1 rounded-md px-2 py-1 text-sm", link && "cursor-pointer hover:bg-muted")}
        onClick={link ? () => ctx.onJump(src, cmd) : undefined}
      >
        {children}
      </div>
      {uncertain && <Badge variant="outline" className="mt-1 shrink-0">위치 불확실</Badge>}
    </div>
  );
}

function MessageLine({ r, ctx, uncertain }: { r: RecordOf<"message">; ctx: TimelineCtx; uncertain?: boolean }) {
  return (
    <Line ctx={ctx} src={r.src} cmd={r.cmd} uncertain={uncertain}>
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

function RecordLine({ r, ctx, uncertain }: { r: LogRecord; ctx: TimelineCtx; uncertain: boolean }) {
  switch (r.type) {
    case "message": return <MessageLine r={r} ctx={ctx} uncertain={uncertain} />;
    case "scroll":
      return <Line ctx={ctx} src={r.src} cmd={r.cmd} uncertain={uncertain}><div className="whitespace-pre-line text-muted-foreground">{formatText(r.text, ctx.data)}</div></Line>;
    case "choices": case "error": return null;
    case "choice":
      return <Line ctx={ctx} src={r.src} cmd={r.cmd} uncertain={uncertain}>▶ 선택: "{ctx.choiceText.get(r.seq) ?? `${r.picked + 1}번째 선택지`}"</Line>;
    case "picture": return <Line ctx={ctx} src={r.src} cmd={r.cmd} uncertain={uncertain}>🖼 {r.name}</Line>;
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
      return <Line ctx={ctx} src={r.src} cmd={r.cmd} uncertain={uncertain}><span className="text-muted-foreground">⚙ {r.changes.map(c => stateChangeText(c, ctx.data)).join(", ")}</span></Line>;
    default: return null;
  }
}

export function TimelineItem({ item, ctx }: { item: HistoryItem; ctx: TimelineCtx }) {
  switch (item.kind) {
    case "record": return <RecordLine r={item.record} ctx={ctx} uncertain={item.uncertain} />;
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
