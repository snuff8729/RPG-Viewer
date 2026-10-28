import { useContext } from "react";
import { Check } from "lucide-react";
import type { ScriptNode } from "@/core/types";
import { useLive } from "@/app/LiveProvider";
import { seenKey } from "@/core/live/coverage";
import { cn } from "@/lib/utils";
import { FaceImage } from "./FaceImage";
import { ScriptLocation } from "./ScriptLocation";

type Msg = Extract<ScriptNode, { kind: "message" }>;
type Scroll = Extract<ScriptNode, { kind: "scroll" }>;

function useSeen(cmd: number): boolean {
  const { coverage } = useLive();
  const loc = useContext(ScriptLocation);
  return !!loc && coverage.seen.has(seenKey(loc, cmd));
}

function SeenMark() {
  return <Check className="ml-1 inline size-3.5 align-text-bottom text-muted-foreground" aria-label="본 대사" />;
}

export function MessageNode({ node }: { node: Msg }) {
  const seen = useSeen(node.cmd);
  return (
    <div className="flex gap-3">
      <div className="size-10 shrink-0">
        {node.face && <FaceImage name={node.face.name} index={node.face.index} />}
      </div>
      <div className="min-w-0 flex-1">
        {node.speaker && <div className="text-sm font-semibold">{node.speaker}</div>}
        <div className={cn("whitespace-pre-line", !node.face && !node.speaker && "italic text-muted-foreground")}>
          {node.lines.join("\n")}
          {seen && <SeenMark />}
        </div>
      </div>
    </div>
  );
}

export function ScrollNode({ node }: { node: Scroll }) {
  const seen = useSeen(node.cmd);
  return (
    <div className="rounded-md border bg-muted/50 p-4 text-center whitespace-pre-line">
      {node.lines.join("\n")}
      {seen && <SeenMark />}
    </div>
  );
}
