import { useContext } from "react";
import { Check, ChevronRight } from "lucide-react";
import type { ScriptNode } from "@/core/types";
import { useLive } from "@/app/LiveProvider";
import { seenKey } from "@/core/live/coverage";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ScriptLocation } from "./ScriptLocation";

type Other = Extract<ScriptNode, { kind: "other" }>;

function RanMark() {
  return <Check className="ml-1 inline size-3.5 align-text-bottom" role="img" aria-label="실행한 플러그인 명령" />;
}

export function OtherNode({ node }: { node: Other }) {
  const { coverage } = useLive();
  const loc = useContext(ScriptLocation);
  const ranSet = coverage.pluginRan instanceof Set ? coverage.pluginRan : null;
  /** 플러그인 명령(356/357)이 실행된 적 있는가 */
  const ran = node.commands.map((c, i) => {
    const cmd = node.cmds?.[i];
    return !!loc && !!ranSet && (c.code === 356 || c.code === 357) && typeof cmd === "number" && ranSet.has(seenKey(loc, cmd));
  });
  const ranCount = ran.filter(Boolean).length;
  return (
    <Collapsible className="rounded-md border border-dashed">
      <CollapsibleTrigger className="group flex w-full items-center gap-1 px-3 py-1.5 text-xs text-muted-foreground">
        <ChevronRight className="size-3 transition-transform group-data-[state=open]:rotate-90" />
        기타 명령 {node.commands.length}개
        {ranCount > 0 && <>{" · "}플러그인 실행함 {ranCount}<RanMark /></>}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="space-y-0.5 border-t border-dashed px-3 py-2 font-mono text-xs text-muted-foreground">
          {node.commands.map((c, i) => (
            <li key={i} className="break-all">코드 {c.code}: {JSON.stringify(c.parameters)}{ran[i] && <RanMark />}</li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}
