import type { ScriptNode } from "@/core/types";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { EMPTY_PICTURE_TIP, emptyPictureLabel, textPictureLabel } from "@/core/text/textPicture";
import { AssetPlaceholder } from "./AssetPlaceholder";
import { useAsset } from "./useAssetUrl";
import { PictureMotionPreview } from "./PictureMotionPreview";

type Pic = Extract<ScriptNode, { kind: "picture" }>;

export function PictureNode({ node }: { node: Pic }) {
  const a = useAsset("pictures", node.name);
  const url = a.status === "ok" ? a.url : null;
  if (!node.name && node.caption) {
    return <span className="text-sm break-words">🖼 {textPictureLabel(node.caption, node.pictureId)}</span>;
  }
  if (!node.name) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="text-sm text-muted-foreground">🖼 {emptyPictureLabel(node.pictureId)}</span>
        </TooltipTrigger>
        <TooltipContent>{EMPTY_PICTURE_TIP}</TooltipContent>
      </Tooltip>
    );
  }
  return (
    <div>
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
        <AssetPlaceholder view={a} kind="pictures" name={node.name} pictureId={node.pictureId} className="min-h-[68px] w-[120px]" />
      ) : (
        <div className="h-[68px] w-[120px] shrink-0 rounded-md bg-muted" />
      )}
      <span className="text-sm">🖼 그림 #{node.pictureId} 표시: {node.name}</span>
    </div>
    {/* 여기서 시작하는 그림 바꾸기·이동을 움직여 보인다 */}
    <PictureMotionPreview cmd={node.cmd} />
    </div>
  );
}
