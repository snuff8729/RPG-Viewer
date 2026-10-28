import { memo } from "react";
import type { ReaderItem } from "@/core/live/reader";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { FaceImage } from "../script/FaceImage";
import { AssetPlaceholder, TextPictureNote } from "../script/AssetPlaceholder";
import { useAsset } from "../script/useAssetUrl";
import { PluginLine } from "./PluginLine";
import { usePluginShowAll } from "./pluginDisplay";

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

function Picture({ item }: { item: Extract<ReaderItem, { kind: "picture" }> }) {
  const { name } = item;
  const a = useAsset("pictures", name);
  if (!name) return <TextPictureNote caption={item.caption} className="text-center" />;
  if (a.status === "loading") return <Skeleton className="h-40 w-full" />;
  if (a.status !== "ok") {
    return <AssetPlaceholder view={a} kind="pictures" name={name} pictureId={item.pictureId} className="mx-auto w-fit max-w-full" />;
  }
  return <img src={a.url} alt={name} title={name} loading="lazy" decoding="async" className="max-h-[60vh] w-full object-contain" />;
}

/** 플러그인 명령 줄. 기술 명령은 `플러그인 명령 모두 보기`를 켰을 때만. */
function ReaderPlugin({ item }: { item: Extract<ReaderItem, { kind: "plugin" }> }) {
  const [showAll] = usePluginShowAll();
  if (item.tech && !showAll) return null;
  return <PluginLine text={item.text} raw={item.raw} name={item.name} tech={item.tech} />;
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
      return <Picture item={item} />;
    case "plugin":
      return <ReaderPlugin item={item} />;
    case "choice":
      return <p className="font-medium">▶ 고른 것: "{item.label}"</p>;
    case "battle":
      return <p className="text-center text-sm text-muted-foreground">⚔ 전투</p>;
  }
}, (a, b) => sameItem(a.item, b.item));

function sameLines(a: string[], b: string[]): boolean {
  return a.length === b.length && a[0] === b[0] && a[a.length - 1] === b[b.length - 1];
}

/**
 * 다시 그릴 필요가 있는지 가벼운 비교(파생할 때마다 항목 객체가 새로 만들어진다).
 * 같은 key(같은 기록 seq)면 내용은 거의 그대로이므로 key·종류·반복 수·줄 수·첫/끝 줄 등만 본다.
 */
function sameItem(a: ReaderItem, b: ReaderItem): boolean {
  if (a === b) return true;
  if (a.key !== b.key || a.kind !== b.kind) return false;
  switch (a.kind) {
    case "chapter": return a.text === (b as typeof a).text;
    case "message": {
      const m = b as typeof a;
      return a.repeat === m.repeat && a.speaker === m.speaker && a.face === m.face && a.faceIndex === m.faceIndex && sameLines(a.lines, m.lines);
    }
    case "scroll": return sameLines(a.lines, (b as typeof a).lines);
    case "picture": {
      const p = b as typeof a;
      return a.name === p.name && a.caption === p.caption && a.pictureId === p.pictureId;
    }
    case "plugin": {
      const p = b as typeof a;
      return a.text === p.text && a.tech === p.tech && a.name === p.name;
    }
    case "choice": return a.label === (b as typeof a).label;
    case "battle": return true;
  }
}
