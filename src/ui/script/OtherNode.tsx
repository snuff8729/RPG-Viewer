import { ChevronRight } from "lucide-react";
import type { ScriptNode } from "@/core/types";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

type Other = Extract<ScriptNode, { kind: "other" }>;

export function OtherNode({ node }: { node: Other }) {
  return (
    <Collapsible className="rounded-md border border-dashed">
      <CollapsibleTrigger className="group flex w-full items-center gap-1 px-3 py-1.5 text-xs text-muted-foreground">
        <ChevronRight className="size-3 transition-transform group-data-[state=open]:rotate-90" />
        기타 명령 {node.commands.length}개
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="space-y-0.5 border-t border-dashed px-3 py-2 font-mono text-xs text-muted-foreground">
          {node.commands.map((c, i) => (
            <li key={i} className="break-all">코드 {c.code}: {JSON.stringify(c.parameters)}</li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}
