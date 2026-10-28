import { ChevronRight } from "lucide-react";
import type { Ref, ScriptNode } from "@/core/types";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { RefBadge } from "@/ui/RefBadge";

type Block = Extract<ScriptNode, { kind: "choices" | "conditional" | "loop" }>;

function Header({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-2 border-b bg-muted/50 px-3 py-1.5 text-sm font-medium">{children}</div>;
}

type RenderBody = (nodes: ScriptNode[], basePath: number[]) => React.ReactNode;

function Branch({ label, body, bp, renderBody }: { label: string; body: ScriptNode[]; bp: number[]; renderBody: RenderBody }) {
  const empty = body.length === 0;
  return (
    <Collapsible defaultOpen={!empty} className="px-3 py-2">
      <CollapsibleTrigger className="group flex items-center gap-1 text-sm font-medium">
        <ChevronRight className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />
        {label}
        {empty && <span className="font-normal text-muted-foreground">(대사 없음)</span>}
      </CollapsibleTrigger>
      <CollapsibleContent className="ml-1 mt-2 border-l-2 pl-3">{renderBody(body, bp)}</CollapsibleContent>
    </Collapsible>
  );
}

export function BlockNode({ node, path, onRefClick, renderBody }: {
  node: Block;
  /** 이 노드 자신의 경로 */
  path: number[];
  onRefClick?: (ref: Ref) => void;
  renderBody: RenderBody;
}) {
  if (node.kind === "choices") {
    return (
      <div className="rounded-md border">
        <Header>선택지</Header>
        {node.branches.map((b, i) => (
          <Branch key={i} label={`"${b.label}"`} body={b.body} bp={[...path, i]} renderBody={renderBody} />
        ))}
        {node.cancelBranch && <Branch label="취소했을 때" body={node.cancelBranch} bp={[...path, -1]} renderBody={renderBody} />}
      </div>
    );
  }
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
