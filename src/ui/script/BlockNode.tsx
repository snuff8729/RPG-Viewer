import { useContext, useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { Ref, ScriptNode } from "@/core/types";
import { useLive } from "@/app/LiveProvider";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { pickKey } from "@/core/live/coverage";
import { branchLabel } from "@/core/live/history";
import { liveHintsEnabled } from "@/ui/live/annotations";
import { RefBadge } from "@/ui/RefBadge";
import { useForcedOpen } from "@/ui/highlight";
import { ScriptLocation } from "./ScriptLocation";

type Block = Extract<ScriptNode, { kind: "choices" | "conditional" | "loop" }>;

function Header({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-2 border-b bg-muted/50 px-3 py-1.5 text-sm font-medium">{children}</div>;
}

type RenderBody = (nodes: ScriptNode[], basePath: number[]) => React.ReactNode;

function Branch({ label, body, bp, renderBody, picks }: {
  label: string; body: ScriptNode[]; bp: number[]; renderBody: RenderBody;
  /** 선택지 분기일 때만: 이 분기를 고른 갈래 라벨들(빈 배열이면 아직 안 고름). */
  picks?: string[];
}) {
  const empty = body.length === 0;
  const [open, setOpen] = useState(!empty);
  const forced = useForcedOpen(bp);
  useEffect(() => { if (forced > 0) setOpen(true); }, [forced]);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="px-3 py-2">
      <CollapsibleTrigger className="group flex items-center gap-1 text-sm font-medium">
        <ChevronRight className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />
        {label}
        {empty && <span className="font-normal text-muted-foreground">(대사 없음)</span>}
        {picks && (picks.length > 0
          ? picks.map((l) => <Badge key={l} variant="secondary" className="ml-1">✓ {l}</Badge>)
          : <span className="ml-1 text-xs font-normal text-muted-foreground">아직 안 고름</span>)}
      </CollapsibleTrigger>
      <CollapsibleContent className="ml-1 mt-2 border-l-2 pl-3">{renderBody(body, bp)}</CollapsibleContent>
    </Collapsible>
  );
}

function ChoicesBlock({ node, path, renderBody }: {
  node: Extract<Block, { kind: "choices" }>; path: number[]; renderBody: RenderBody;
}) {
  const { coverage, model, connection } = useLive();
  const loc = useContext(ScriptLocation);
  const infos = loc ? coverage.picks.get(pickKey(loc, node.cmd)) : undefined;
  const picksFor = (idx: number): string[] | undefined => {
    if (!loc || !liveHintsEnabled(connection)) return undefined;
    const labels: string[] = [];
    for (const p of infos ?? []) {
      if (p.picked !== idx) continue;
      const l = branchLabel(model, p.branch);
      if (!labels.includes(l)) labels.push(l);
    }
    return labels;
  };
  return (
    <div className="rounded-md border">
      <Header>선택지</Header>
      {node.branches.map((b, i) => (
        <Branch key={i} label={`"${b.label}"`} body={b.body} bp={[...path, i]} renderBody={renderBody} picks={picksFor(i)} />
      ))}
      {node.cancelBranch && (
        <Branch label="취소했을 때" body={node.cancelBranch} bp={[...path, -1]} renderBody={renderBody} picks={picksFor(-2)} />
      )}
    </div>
  );
}

export function BlockNode({ node, path, onRefClick, renderBody }: {
  node: Block;
  /** 이 노드 자신의 경로 */
  path: number[];
  onRefClick?: (ref: Ref) => void;
  renderBody: RenderBody;
}) {
  if (node.kind === "choices") return <ChoicesBlock node={node} path={path} renderBody={renderBody} />;
  if (node.kind === "conditional") {
    return (
      <div className="rounded-md border">
        <Header>만약 <RefBadge condition={node.condition} onRefClick={onRefClick} /></Header>
        <Branch label="그렇다면" body={node.then} bp={[...path, 0]} renderBody={renderBody} />
        {node.else && <Branch label="아니라면" body={node.else} bp={[...path, 1]} renderBody={renderBody} />}
      </div>
    );
  }
  return (
    <div className="rounded-md border">
      <Header>반복</Header>
      <div className="px-3 py-2">{renderBody(node.body, [...path, 0])}</div>
    </div>
  );
}
