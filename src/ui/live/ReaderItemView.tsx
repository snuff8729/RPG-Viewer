import { memo, useState } from "react";
import type { ReaderItem } from "@/core/live/reader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { FaceImage } from "../script/FaceImage";
import { AssetPlaceholder, TextPictureNote } from "../script/AssetPlaceholder";
import { useAsset } from "../script/useAssetUrl";
import { PluginLine } from "./PluginLine";
import { usePluginShowAll } from "./pluginDisplay";
import { sameShot, type ScreenShot } from "@/core/addons/screenPictures";
import { ScreenPictures } from "../addons/ScreenPictures";
import { useScreenPicturesShown } from "../addons/screenDisplay";
import { BATTLE_RESULT_LABEL } from "./battleDisplay";
import { BattleActionLine } from "./BattleActionLine";
import { battleActionLabel, type BattleAction } from "@/core/live/battleLine";

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
  if (!name) return item.caption ? <TextPictureNote caption={item.caption} pictureId={item.pictureId} className="text-center" /> : null;
  if (a.status === "loading") return <Skeleton className="h-40 w-full" />;
  if (a.status !== "ok") {
    return <AssetPlaceholder view={a} kind="pictures" name={name} pictureId={item.pictureId} className="mx-auto w-fit max-w-full" />;
  }
  return <img src={a.url} alt={name} title={name} loading="lazy" decoding="async" className="max-h-[60vh] w-full object-contain" />;
}

/** 화면 그림 따라 그리기: 이 대사에서 새로 보일 이벤트 그림·스탠딩(`그림 보기`를 껐으면 숨긴다). */
function Screen({ shot }: { shot: ScreenShot }) {
  const [shown] = useScreenPicturesShown();
  return shown ? <div className="mb-3"><ScreenPictures shot={shot} /></div> : null;
}

/** 플러그인 명령 줄. 기술 명령은 `플러그인 명령 모두 보기`를 켰을 때만. */
function ReaderPlugin({ item }: { item: Extract<ReaderItem, { kind: "plugin" }> }) {
  const [showAll] = usePluginShowAll();
  if (item.tech && !showAll) return null;
  return <PluginLine text={item.text} raw={item.raw} name={item.name} tech={item.tech} />;
}

type BattleReaderItem = Extract<ReaderItem, { kind: "battle" }>;
type BattleLogItem = Extract<ReaderItem, { kind: "battlelog" }>;

/** 이어진 전투 로그 줄은 한 덩어리로(촘촘하게) */
function groupLog(items: ReaderItem[]): (ReaderItem | BattleLogItem[])[] {
  const out: (ReaderItem | BattleLogItem[])[] = [];
  for (const it of items) {
    const last = out[out.length - 1];
    if (it.kind === "battlelog" && Array.isArray(last)) last.push(it);
    else out.push(it.kind === "battlelog" ? [it] : it);
  }
  return out;
}

/** 전투 묶음 안: 대사·그림은 늘 보이고, 전투 로그 줄은 펼쳤을 때만(줄의 화면 그림은 접혀 있어도 보인다). */
function BattleBody({ item }: { item: BattleReaderItem }) {
  const [logOpen, setLogOpen] = useState(false);
  return (
    <div className="space-y-3">
      {item.logLines > 0 && (
        <Button variant="ghost" size="sm" className="text-muted-foreground" aria-expanded={logOpen} onClick={() => setLogOpen(o => !o)}>
          {logOpen ? "전투 기록 접기" : `전투 기록 ${item.logLines}줄`}
        </Button>
      )}
      {item.screen && <Screen shot={item.screen} />}
      {groupLog(item.items).map(g => {
        if (!Array.isArray(g)) return <ReaderItemView key={g.key} item={g} />;
        if (!logOpen) {
          const shots = g.filter(l => l.screen);
          return shots.length > 0 ? <div key={g[0].key}>{shots.map(l => <Screen key={l.key} shot={l.screen!} />)}</div> : null;
        }
        return (
          <div key={g[0].key} className="space-y-0.5 text-sm leading-snug text-muted-foreground">
            {g.map(l => (
              <div key={l.key}>
                {l.screen && <Screen shot={l.screen} />}
                {l.action ? <BattleActionLine action={l.action} /> : <p className="whitespace-pre-wrap break-words">{l.text}</p>}
              </div>
            ))}
          </div>
        );
      })}
      {logOpen && item.dropped > 0 && <p className="text-xs text-muted-foreground">줄이 많아 {item.dropped}줄은 기록하지 않았어요</p>}
      {item.endScreen && <Screen shot={item.endScreen} />}
      {item.rewards && <p className="text-sm text-muted-foreground">{item.rewards}</p>}
    </div>
  );
}

/** 전투 한 번: 머리(적 무리·결과) + 안의 대사·그림, `전투 기록 N줄`로 로그 펼치기. 다시 본 같은 전투는 통째로 접는다. */
function BattleBlock({ item }: { item: BattleReaderItem }) {
  const label = item.result ? BATTLE_RESULT_LABEL[item.result] : item.ended ? "끝남" : "진행 중";
  const variant = item.result === "win" ? "default" : item.result === "lose" ? "destructive" : "secondary";
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>⚔ 전투: {item.troop}</CardTitle>
        {item.repeat > 0 && <CardDescription>↻ 같은 전투 다시 봄 ×{item.repeat}</CardDescription>}
        <CardAction><Badge variant={variant}>{label}</Badge></CardAction>
      </CardHeader>
      {(item.repeat === 0 ? item.items.length > 0 || item.logLines > 0 || item.rewards || item.screen || item.endScreen : true) && (
        <CardContent>
          {item.repeat > 0 ? (
            <Collapsible>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="text-muted-foreground">펼쳐 보기</Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-2"><BattleBody item={item} /></CollapsibleContent>
            </Collapsible>
          ) : <BattleBody item={item} />}
        </CardContent>
      )}
    </Card>
  );
}

/** 읽기 항목 하나(대사·그림·고른 선택·장면 구분·전투). 전체 읽기와 선택 흐름이 함께 쓴다. */
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
      return item.screen ? <><Screen shot={item.screen} /><MessageLines item={item} /></> : <MessageLines item={item} />;
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
      return <BattleBlock item={item} />;
    case "battlelog":
      return <>{item.screen && <Screen shot={item.screen} />}{item.action ? <BattleActionLine action={item.action} /> : <p className="text-sm text-muted-foreground">{item.text}</p>}</>;
  }
}, (a, b) => sameItem(a.item, b.item));

function sameAction(a: BattleAction | undefined, b: BattleAction | undefined): boolean {
  if (!a || !b) return a === b;
  return battleActionLabel(a) === battleActionLabel(b) && a.enemy === b.enemy && a.targets.join("|") === b.targets.join("|");
}

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
      return a.repeat === m.repeat && sameShot(a.screen, m.screen) && a.speaker === m.speaker && a.face === m.face && a.faceIndex === m.faceIndex && sameLines(a.lines, m.lines);
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
    case "battle": {
      const p = b as typeof a;
      return a.seq === p.seq && a.result === p.result && a.ended === p.ended && a.logLines === p.logLines && a.dropped === p.dropped
        && a.rewards === p.rewards && a.repeat === p.repeat && a.troop === p.troop && sameShot(a.screen, p.screen) && sameShot(a.endScreen, p.endScreen)
        && a.items.length === p.items.length && a.items.every((x, i) => sameItem(x, p.items[i]));
    }
    case "battlelog": {
      const p = b as typeof a;
      return a.text === p.text && sameShot(a.screen, p.screen) && sameAction(a.action, p.action);
    }
  }
}
