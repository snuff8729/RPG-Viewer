import type { ScriptNode } from "@/core/types";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AssetPlaceholder } from "./AssetPlaceholder";
import { useAsset } from "./useAssetUrl";

type Pic = Extract<ScriptNode, { kind: "picture" }>;

export function PictureNode({ node }: { node: Pic }) {
  const a = useAsset("pictures", node.name);
  const url = a.status === "ok" ? a.url : null;
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
      ) : a.status === "missing" || a.status === "failed" ? (
        <AssetPlaceholder view={a} name={node.name} className="min-h-[68px] w-[120px]" />
      ) : (
        <div className="h-[68px] w-[120px] shrink-0 rounded-md bg-muted" />
      )}
      <span className="text-sm">🖼 그림 #{node.pictureId} 표시: {node.name}</span>
    </div>
  );
}
