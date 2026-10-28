import { memo } from "react";
import type { ReaderItem } from "@/core/live/reader";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { FaceImage } from "../script/FaceImage";
import { useAssetUrl } from "../script/useAssetUrl";

function MessageLines({ item }: { item: Extract<ReaderItem, { kind: "message" }> }) {
  return (
    <div className="flex gap-3">
      {item.face && <FaceImage name={item.face} index={item.faceIndex} />}
      <div className="min-w-0 flex-1 space-y-0.5">
        {item.speaker && <p className="text-sm font-medium text-muted-foreground">{item.speaker}</p>}
        {item.lines.map((l, i) => <p key={i} className="whitespace-pre-wrap break-words">{l || " "}</p>)}
      </div>
    </div>
  );
}

function Picture({ name }: { name: string }) {
  const url = useAssetUrl("pictures", name);
  if (url === undefined) return <Skeleton className="h-40 w-full" />;
  if (!url) return <p className="text-center text-sm text-muted-foreground">{name}</p>;
  return <img src={url} alt={name} title={name} loading="lazy" decoding="async" className="max-h-[60vh] w-full object-contain" />;
}

/** 읽기 항목 하나(대사·그림·고른 선택·장면 구분). 전체 읽기와 선택 흐름이 함께 쓴다. */
export const ReaderItemView = memo(function ReaderItemView({ item }: { item: ReaderItem }) {
  switch (item.kind) {
    case "chapter":
      return <p className="py-2 text-center text-sm text-muted-foreground">{item.text}</p>;
    case "message":
      if (item.repeat !== undefined) {
        return (
          <Collapsible>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="text-muted-foreground">↻ 같은 대화 다시 봄 ×{item.repeat}</Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-1 text-muted-foreground"><MessageLines item={item} /></CollapsibleContent>
          </Collapsible>
        );
      }
      return <MessageLines item={item} />;
    case "scroll":
      return (
        <div className="space-y-0.5 text-center">
          {item.lines.map((l, i) => <p key={i} className="whitespace-pre-wrap break-words">{l || " "}</p>)}
        </div>
      );
    case "picture":
      return <Picture name={item.name} />;
    case "choice":
      return <p className="font-medium">▶ 고른 것: "{item.label}"</p>;
    case "battle":
      return <p className="text-center text-sm text-muted-foreground">⚔ 전투</p>;
  }
}, (a, b) => a.item === b.item || JSON.stringify(a.item) === JSON.stringify(b.item));
