import type { ScriptNode } from "@/core/types";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useAssetUrl } from "./useAssetUrl";

type Pic = Extract<ScriptNode, { kind: "picture" }>;

export function PictureNode({ node }: { node: Pic }) {
  const url = useAssetUrl("pictures", node.name);
  return (
    <div className="flex items-center gap-3">
      {url ? (
        <Dialog>
          <DialogTrigger asChild>
            <button type="button" className="shrink-0 cursor-zoom-in">
              <img src={url} alt={node.name} className="h-[68px] w-[120px] rounded-md object-cover" />
            </button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-fit">
            <DialogHeader><DialogTitle>{node.name}</DialogTitle></DialogHeader>
            <img src={url} alt={node.name} className="max-h-[80vh] max-w-full object-contain" />
          </DialogContent>
        </Dialog>
      ) : (
        <div className="flex h-[68px] w-[120px] shrink-0 items-center justify-center rounded-md bg-muted px-1 text-center text-xs text-muted-foreground break-all">
          {url === null ? node.name : null}
        </div>
      )}
      <span className="text-sm">🖼 그림 #{node.pictureId} 표시: {node.name}</span>
    </div>
  );
}
