import { memo, useState, type ReactNode } from "react";
import { branchLabel, representative } from "@/core/live/history";
import type { HistoryItem, HistoryModel, LogRecord, RecordOf } from "@/core/live/types";
import { formatText } from "@/core/text/escape";
import type { GameData, Location } from "@/core/types";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { troopName } from "@/core/live/reader";
import { BATTLE_RESULT_LABEL } from "./battleDisplay";
import { BattleActionLine } from "./BattleActionLine";
import { NoticeLine } from "./NoticeLine";
import { noticeRecordKind, noticeSourceLabel } from "@/core/addons/notices";
import { battleActionOf, battleLogText } from "@/core/live/battleLine";
import { explainRecord, reasonLabel } from "@/core/live/mismatch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { FaceImage } from "../script/FaceImage";
import { battleText, pickedFallbackText, reasonText, stateChangeText, transferText } from "./historyText";
import { classifyPluginRecord, pluginKey } from "@/core/live/pluginText";
import { PluginLine } from "./PluginLine";
import { usePluginOverrides } from "./pluginDisplay";
import { RichText } from "./RichMessageText";

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
          {r.speaker && <div className="whitespace-pre-line font-semibold"><RichText text={r.speaker} data={ctx.data} colorsOnly /></div>}
          <div className="whitespace-pre-line"><RichText text={r.text} data={ctx.data} /></div>
        </div>
      </div>
    </Line>
  );
}

/** 플러그인 명령 기록(숨길 기술 명령은 HistoryView가 이미 걸러 냈다) */
function PluginRecordLine({ r, data }: { r: RecordOf<"plugin">; data: GameData }) {
  const { overrides } = usePluginOverrides();
  const c = classifyPluginRecord(r, overrides);
  const raw = typeof r.text === "string" ? r.text : "";
  return <PluginLine text={c.kind === "text" ? formatText(c.text, data) : raw} raw={raw} name={pluginKey(r)} tech={c.kind === "tech"} />;
}

function RecordLine({ r, ctx, uncertain, changed }: { r: LogRecord; ctx: TimelineCtx; uncertain: boolean; changed: boolean }) {
  switch (r.type) {
    case "message": return <MessageLine r={r} ctx={ctx} uncertain={uncertain} changed={changed} />;
    case "scroll":
      return <Line ctx={ctx} src={r.src} cmd={r.cmd} uncertain={uncertain} changed={changed} rec={r}><div className="whitespace-pre-line text-muted-foreground"><RichText text={r.text} data={ctx.data} /></div></Line>;
    case "choices": case "error": case "screen": return null;
    case "choice":
      return <Line ctx={ctx} src={r.src} cmd={r.cmd} uncertain={uncertain} changed={changed} rec={r}>▶ 선택: "{ctx.choiceText.get(r.seq) ?? pickedFallbackText(r.picked)}"</Line>;
    // 파일 이름 없는 그림 표시는 화면에 보이는 것이 없다(앞의 D_TEXT 플러그인 줄이 글을 보여 준다)
    case "picture": return r.name ? <Line ctx={ctx} src={r.src} cmd={r.cmd} uncertain={uncertain} changed={changed} rec={r}>🖼 {r.name}</Line> : null;
    case "plugin":
      return <Line ctx={ctx} src={r.src} cmd={r.cmd} uncertain={uncertain} changed={changed} rec={r}><PluginRecordLine r={r} data={ctx.data} /></Line>;
    case "transfer": return <Line ctx={ctx}>{transferText(r, ctx.data)}</Line>;
    case "battle": return <Line ctx={ctx}>{battleText(r, ctx.data)}</Line>;
    case "battlelog": {
      const action = battleActionOf(r, ctx.data);
      return <div className="px-2 text-xs leading-snug text-muted-foreground">{action ? <BattleActionLine action={action} /> : battleLogText(r.text, ctx.data)}</div>;
    }
    case "notice": {
      const text = formatText(typeof r.text === "string" && r.text ? r.text : typeof r.raw === "string" ? r.raw : "", ctx.data).trim();
      return text ? <NoticeLine text={text} source={noticeSourceLabel(r.source)} kind={noticeRecordKind(r)} className="px-2 py-0.5" /> : null;
    }
    case "save": return <Line ctx={ctx}>💾 저장 (슬롯 {r.slot})</Line>;
    case "load": return <Line ctx={ctx}>💾 불러오기 (슬롯 {r.slot})</Line>;
    case "branchStart":
      // 이어진 갈래(저장 → 종료 → 이어하기)는 새 갈래가 아니라 같은 이야기의 이어하기
      if (representative(ctx.model, r.branch) !== r.branch) {
        return (
          <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
            <div className="h-px flex-1 bg-border" />
            <span>— 이어하기 —</span>
            <div className="h-px flex-1 bg-border" />
          </div>
        );
      }
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

/** 같은 기록인가: 같은 객체이거나, 잦은 변수를 걸러 새로 만든 state 기록이 같은 변경들을 가리킬 때. */
function sameRecord(a: LogRecord, b: LogRecord): boolean {
  if (a === b) return true;
  if (a.type !== "state" || b.type !== "state" || a.seq !== b.seq || a.branch !== b.branch) return false;
  const x = a.changes, y = b.changes;
  return x.length === y.length && x.every((c, i) => c === y[i]);
}

/** foldTimeline은 매번 새 항목 객체를 만들므로, 내용(기록 참조) 기준으로 같은지 본다. */
function sameItem(a: HistoryItem, b: HistoryItem): boolean {
  if (a === b) return true;
  switch (a.kind) {
    case "record":
      return b.kind === "record" && a.uncertain === b.uncertain && a.changed === b.changed && sameRecord(a.record, b.record);
    case "repeat":
      return b.kind === "repeat" && a.count === b.count && a.record === b.record;
    case "stateGroup":
      return b.kind === "stateGroup" && a.count === b.count && a.records.length === b.records.length
        && a.records.every((r, i) => sameRecord(r, b.records[i]));
    case "battle":
      return b.kind === "battle" && a.start === b.start && a.end === b.end && a.repeat === b.repeat && a.logLines === b.logLines
        && a.items.length === b.items.length && a.items.every((x, i) => sameItem(x, b.items[i]));
    case "fork":
      return b.kind === "fork" && a.atSeq === b.atSeq && a.branches.length === b.branches.length
        && a.branches.every((id, i) => id === b.branches[i]);
  }
}

type BattleHistoryItem = Extract<HistoryItem, { kind: "battle" }>;

/** 전투 묶음 안: 대사·상태 변경·알림 문구 등은 늘 보이고, 전투 로그 줄은 `전투 기록 N줄`을 펼쳤을 때만. */
function BattleTimelineBody({ item, ctx }: { item: BattleHistoryItem; ctx: TimelineCtx }) {
  const [logOpen, setLogOpen] = useState(false);
  const shown = logOpen ? item.items : item.items.filter(it => !(it.kind === "record" && it.record.type === "battlelog"));
  const dropped = typeof item.end?.dropped === "number" ? item.end.dropped : 0;
  return (
    <div className="space-y-1">
      {item.logLines > 0 && (
        <Button variant="ghost" size="xs" className="text-muted-foreground" aria-expanded={logOpen} onClick={() => setLogOpen(o => !o)}>
          {logOpen ? "전투 기록 접기" : `전투 기록 ${item.logLines}줄`}
        </Button>
      )}
      {shown.map((it, i) => <TimelineItem key={i} item={it} ctx={ctx} />)}
      {logOpen && dropped > 0 && <p className="px-2 text-xs text-muted-foreground">줄이 많아 {dropped}줄은 기록하지 않았어요</p>}
    </div>
  );
}

function rewardsText(rw: RecordOf<"battle">["rewards"], data: GameData): string {
  if (!rw || typeof rw !== "object") return "";
  const parts: string[] = [];
  if (typeof rw.exp === "number" && rw.exp > 0) parts.push(`경험치 ${rw.exp}`);
  if (typeof rw.gold === "number" && rw.gold > 0) parts.push(`골드 ${rw.gold}`);
  const items = Array.isArray(rw.items) ? rw.items.filter(s => typeof s === "string" && s).map(s => formatText(s, data)) : [];
  if (items.length > 0) parts.push(`얻은 것: ${items.join(", ")}`);
  return parts.join(" · ");
}

/** 전투 한 번(기록 탭): 머리(적 무리·결과·보상) + 안의 기록. 다시 본 같은 전투는 통째로 접는다. */
function BattleTimeline({ item, ctx }: { item: BattleHistoryItem; ctx: TimelineCtx }) {
  const result = item.end?.result;
  const label = result === "win" && item.end?.skipped === true ? "건너뜀(이김)"
    : result && result in BATTLE_RESULT_LABEL ? BATTLE_RESULT_LABEL[result] : item.end ? "끝남" : "진행 중";
  const variant = result === "win" ? "default" : result === "lose" ? "destructive" : "secondary";
  const rewards = rewardsText(item.end?.rewards, ctx.data);
  return (
    <Card size="sm" className="my-1">
      <CardHeader>
        <CardTitle>⚔ 전투: {troopName(item.start, ctx.data)}</CardTitle>
        {(item.repeat > 0 || rewards) && (
          <CardDescription>{item.repeat > 0 ? `↻ 같은 전투 다시 봄 ×${item.repeat}` : rewards}</CardDescription>
        )}
        <CardAction><Badge variant={variant}>{label}</Badge></CardAction>
      </CardHeader>
      {item.items.length > 0 && (
        <CardContent>
          {item.repeat > 0 ? (
            <Collapsible>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="xs" className="text-muted-foreground">펼쳐 보기</Button>
              </CollapsibleTrigger>
              <CollapsibleContent><BattleTimelineBody item={item} ctx={ctx} /></CollapsibleContent>
            </Collapsible>
          ) : <BattleTimelineBody item={item} ctx={ctx} />}
        </CardContent>
      )}
    </Card>
  );
}

type TimelineItemProps = { item: HistoryItem; ctx: TimelineCtx };

/** 항목·ctx가 그대로면 다시 그리지 않는다(기록 탭은 최대 수백 개를 그린다). */
export const TimelineItem = memo(function TimelineItem({ item, ctx }: TimelineItemProps) {
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
    case "battle": return <BattleTimeline item={item} ctx={ctx} />;
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
}, (prev: TimelineItemProps, next: TimelineItemProps) => prev.ctx === next.ctx && sameItem(prev.item, next.item));
