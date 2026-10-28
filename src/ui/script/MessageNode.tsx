import type { ScriptNode } from "@/core/types";
import { cn } from "@/lib/utils";
import { FaceImage } from "./FaceImage";

type Msg = Extract<ScriptNode, { kind: "message" }>;
type Scroll = Extract<ScriptNode, { kind: "scroll" }>;

export function MessageNode({ node }: { node: Msg }) {
  return (
    <div className="flex gap-3">
      <div className="size-10 shrink-0">
        {node.face && <FaceImage name={node.face.name} index={node.face.index} />}
      </div>
      <div className="min-w-0 flex-1">
        {node.speaker && <div className="text-sm font-semibold">{node.speaker}</div>}
        <div className={cn("whitespace-pre-line", !node.face && "italic text-muted-foreground")}>
          {node.lines.join("\n")}
        </div>
      </div>
    </div>
  );
}

export function ScrollNode({ node }: { node: Scroll }) {
  return <div className="rounded-md border bg-muted/50 p-4 text-center whitespace-pre-line">{node.lines.join("\n")}</div>;
}
