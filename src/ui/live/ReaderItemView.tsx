import { memo, useLayoutEffect, useRef, useState } from "react";
import type { ReaderItem } from "@/core/live/reader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { EyeOff, Volume2 } from "lucide-react";
import { useReaderItemState } from "./readerItemState";
import { useReaderVoice } from "./readerVoiceContext";
import { FaceImage } from "../script/FaceImage";
import { AssetPlaceholder, TextPictureNote } from "../script/AssetPlaceholder";
import { useAssetBitmap } from "../script/useAssetBitmap";
import { PictureViewport } from "../addons/PictureViewport";
import { PluginLine } from "./PluginLine";
import { NEVER_HIDDEN, ReaderHideContext, useLineHidden } from "./readerHide";
import { sameShot, type ScreenShot } from "@/core/addons/screenPictures";
import { sameMotion } from "@/core/addons/pictureMotion";
import { ScreenPictures } from "../addons/ScreenPictures";
import { CutinPictures } from "../addons/CutinPictures";
import { useScreenPicturesShown } from "../addons/screenDisplay";
import { BATTLE_RESULT_LABEL } from "./battleDisplay";
import { BattleActionLine } from "./BattleActionLine";
import { NoticeLine } from "./NoticeLine";
import { isRepeatOpen, setRepeatOpen } from "./repeatOpen";
import { battleActionLabel, type BattleAction } from "@/core/live/battleLine";
import { ReaderMessageText, ReaderScrollText } from "./RichMessageText";

function MessageLines({ item }: { item: Extract<ReaderItem, { kind: "message" }> }) {
  const voice = useReaderVoice();
  return (
    <div className="flex gap-3">
      {item.face && <FaceImage name={item.face} index={item.faceIndex} />}
      <div className="min-w-0 flex-1 space-y-0.5">
        <ReaderMessageText item={item} />
      </div>
      {voice.sounds(item).length > 0 && (
        <Button variant="ghost" size="icon-xs" aria-label="음성 재생" title="음성 재생" onClick={() => voice.play(item)}><Volume2 /></Button>
      )}
    </div>
  );
}

function Picture({ item }: { item: Extract<ReaderItem, { kind: "picture" }> }) {
  if (!item.name) return item.caption ? <TextPictureNote caption={item.caption} pictureId={item.pictureId} className="text-center" /> : null;
  return <PictureViewport><PictureBody item={item} /></PictureViewport>;
}

function PictureBody({ item }: { item: Extract<ReaderItem, { kind: "picture" }> }) {
  const { name } = item;
  const a = useAssetBitmap("pictures", name);
  if (a.status === "loading") return <Skeleton className="h-40 w-full" />;
  if (a.status !== "ok") {
    return <AssetPlaceholder view={a} kind="pictures" name={name} pictureId={item.pictureId} className="mx-auto w-fit max-w-full" />;
  }
  return <PictureCanvas image={a.image} name={name} />;
}

function PictureCanvas({ image, name }: { image: ImageBitmap; name: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    canvas.width = image.width; canvas.height = image.height;
    canvas.getContext("2d")?.drawImage(image, 0, 0);
    return () => { canvas.width = canvas.height = 0; };
  }, [image]);
  return <canvas ref={ref} width={0} height={0} role="img" aria-label={name} title={name} className="max-h-[60vh] w-full object-contain" />;
}

/** 화면 그림 따라 그리기: 이 대사에서 새로 보일 이벤트 그림·스탠딩(`그림 보기`를 껐으면 숨긴다). */
function Screen({ shot }: { shot: ScreenShot }) {
  const [shown] = useScreenPicturesShown();
  return shown ? <div className="mb-3"><ScreenPictures shot={shot} /></div> : null;
}

/** 컷인(대사 사이에 잠깐 띄웠다 지운 그림, `그림 보기`를 껐으면 숨긴다). 전투 안에서는 전투 기록을 접어도 보인다. */
function Cutin({ item }: { item: Extract<ReaderItem, { kind: "cutin" }> }) {
  const [shown] = useScreenPicturesShown();
  return shown ? <div className="mb-3"><CutinPictures frames={item.frames} best={item.best} stateKey={item.key} motion={item.motion} /></div> : null;
}

/** 플러그인 명령 줄(보일지는 숨김 규칙이 정한다 — 명령별 메뉴 대신 읽기 줄 메뉴) */
function ReaderPlugin({ item }: { item: Extract<ReaderItem, { kind: "plugin" }> }) {
  return <PluginLine text={item.text} raw={item.raw} name={item.name} tech={item.tech} menu={false} />;
}

/** 숨김 규칙으로 숨긴 줄이 이어진 자리: `숨긴 문구 N줄`, 누르면 잠깐 펼쳐 본다 */
function HiddenLines({ item }: { item: Extract<ReaderItem, { kind: "hidden" }> }) {
  const [open, setOpen] = useReaderItemState<boolean>("hidden:" + item.key, false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="xs" className="text-muted-foreground">
          <EyeOff />
          숨긴 문구 {item.items.length}줄
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 pt-2 opacity-70">
        <ReaderHideContext.Provider value={NEVER_HIDDEN}>
          {item.items.map(x => <ReaderItemView key={x.key} item={x} />)}
        </ReaderHideContext.Provider>
      </CollapsibleContent>
    </Collapsible>
  );
}

type BattleReaderItem = Extract<ReaderItem, { kind: "battle" }>;
type BattleLogItem = Extract<ReaderItem, { kind: "battlelog" | "notice" }>;

const isLogLine = (it: ReaderItem): it is BattleLogItem => it.kind === "battlelog" || it.kind === "notice";

/** 이어진 전투 로그 줄·알림 문구는 한 덩어리로(촘촘하게, 순서대로) */
function groupLog(items: ReaderItem[]): (ReaderItem | BattleLogItem[])[] {
  const out: (ReaderItem | BattleLogItem[])[] = [];
  for (const it of items) {
    const last = out[out.length - 1];
    if (isLogLine(it) && Array.isArray(last)) last.push(it);
    else out.push(isLogLine(it) ? [it] : it);
  }
  return out;
}

/** 전투 로그 줄 하나(펼쳤을 때) 또는 알림 문구 */
function LogLine({ line }: { line: BattleLogItem }) {
  if (line.kind === "notice") return <NoticeLine text={line.text} source={line.source} kind={line.noticeKind} />;
  return (
    <div>
      {line.screen && <Screen shot={line.screen} />}
      {line.action ? <BattleActionLine action={line.action} /> : <p className="whitespace-pre-wrap break-words">{line.text}</p>}
    </div>
  );
}

/**
 * 전투 묶음 안: 대사·그림·알림 문구(캐릭터 대사 등)는 늘 보이고, 전투 로그 줄은 펼쳤을 때만
 * (줄의 화면 그림은 접혀 있어도 보인다).
 */
function BattleBody({ item }: { item: BattleReaderItem }) {
  const [logOpen, setLogOpen] = useReaderItemState<boolean>("battle-log:" + item.key, false);
  // 숨김 규칙에 맞는 안쪽 줄(전투 로그·알림·대사 등)은 뺀다
  const hidden = useLineHidden();
  const inner = item.items.filter(x => !hidden(x));
  const logLines = Math.max(0, item.logLines - item.items.filter(x => isLogLine(x) && hidden(x)).length);
  return (
    <div className="space-y-3">
      {logLines > 0 && (
        <Button variant="ghost" size="sm" className="text-muted-foreground" aria-expanded={logOpen} onClick={() => setLogOpen(o => !o)}>
          {logOpen ? "전투 기록 접기" : `전투 기록 ${logLines}줄`}
        </Button>
      )}
      {item.screen && <Screen shot={item.screen} />}
      {groupLog(inner).map(g => {
        if (!Array.isArray(g)) return <ReaderItemView key={g.key} item={g} />;
        if (!logOpen) {
          const kept = g.filter(l => l.kind === "notice" || l.screen);
          if (kept.length === 0) return null;
          return (
            <div key={g[0].key} className="space-y-0.5 text-sm leading-snug">
              {kept.map(l => l.kind === "notice"
                ? <NoticeLine key={l.key} text={l.text} source={l.source} kind={l.noticeKind} />
                : <Screen key={l.key} shot={l.screen!} />)}
            </div>
          );
        }
        return (
          <div key={g[0].key} className="space-y-0.5 text-sm leading-snug text-muted-foreground">
            {g.map(l => <LogLine key={l.key} line={l} />)}
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
  const [open, setOpen] = useReaderItemState<boolean>("battle:" + item.key, false);
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
            <Collapsible open={open} onOpenChange={setOpen}>
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

/**
 * 다시 본 같은 대화(접힘). 접힌 대화가 새 그림을 남겼으면 그 그림은 접힌 부분 밖에 보인다.
 * 펼치면 회차마다(`1회째`…) 그 대화의 대사·그림·알림·플러그인 글을 모두 보인다. 펼침 상태는 항목 key로 기억한다.
 */
function RepeatTalk({ item }: { item: Extract<ReaderItem, { kind: "message" }> }) {
  const [open, setOpen] = useState(() => isRepeatOpen(item.key));
  const occurrences = item.occurrences ?? [];
  return (
    <>
      {item.screen && <Screen shot={item.screen} />}
      <Collapsible open={open} onOpenChange={(on) => { setOpen(on); setRepeatOpen(item.key, on); }}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="text-muted-foreground">↻ 같은 대화 다시 봄 ×{item.repeat}</Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-3 pt-1 text-muted-foreground">
          {occurrences.length === 0 ? <MessageLines item={item} /> : occurrences.map((occ, i) => (
            <div key={occ[0]?.key ?? i} className="space-y-2">
              <Badge variant="outline">{i + 1}회째</Badge>
              {occ.map(x => <ReaderItemView key={x.key} item={x} />)}
            </div>
          ))}
        </CollapsibleContent>
      </Collapsible>
    </>
  );
}

/** 읽기 항목 하나(대사·그림·고른 선택·장면 구분·전투). 전체 읽기와 선택 흐름이 함께 쓴다. */
export const ReaderItemView = memo(function ReaderItemView({ item }: { item: ReaderItem }) {
  // 전투 안·다시 본 대화 안의 줄은 여기서 숨긴다(맨 위 줄은 읽기 화면이 `숨긴 문구 N줄`로 묶어 온다)
  const hidden = useLineHidden();
  if (item.kind !== "hidden" && hidden(item)) return null;
  const body = <ReaderItemBody item={item} />;
  if (item.kind === "chapter" || item.kind === "battle" || item.kind === "hidden" || (item.kind === "message" && item.repeat !== undefined)) return body;
  return <div data-reader-line={item.key}>{body}</div>;
}, (a, b) => sameItem(a.item, b.item));

function ReaderItemBody({ item }: { item: ReaderItem }) {
  switch (item.kind) {
    case "chapter":
      if (item.part) {
        return (
          <div className="flex items-center gap-3 pt-6 pb-2">
            <Separator className="flex-1" />
            <span className="shrink-0 text-sm font-medium">{item.text}</span>
            <Separator className="flex-1" />
          </div>
        );
      }
      return <p className="py-2 text-center text-sm text-muted-foreground">{item.text}</p>;
    case "message":
      if (item.repeat !== undefined) return <RepeatTalk item={item} />;
      return item.screen ? <><Screen shot={item.screen} /><MessageLines item={item} /></> : <MessageLines item={item} />;
    case "scroll":
      return (
        <div className="space-y-0.5 text-center">
          <ReaderScrollText item={item} />
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
    case "notice":
      return <NoticeLine text={item.text} source={item.source} kind={item.noticeKind} />;
    case "screen":
      return <Screen shot={item.screen} />;
    case "cutin":
      return <Cutin item={item} />;
    case "hidden":
      return <HiddenLines item={item} />;
  }
}

function sameAction(a: BattleAction | undefined, b: BattleAction | undefined): boolean {
  if (!a || !b) return a === b;
  return battleActionLabel(a) === battleActionLabel(b) && a.enemy === b.enemy && a.targets.join("|") === b.targets.join("|");
}

function sameOccurrences(a: ReaderItem[][] | undefined, b: ReaderItem[][] | undefined): boolean {
  if (!a || !b) return a === b;
  return a.length === b.length && a.every((occ, i) => occ.length === b[i].length && occ.every((x, j) => sameItem(x, b[i][j])));
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
    case "chapter": return a.text === (b as typeof a).text && a.part === (b as typeof a).part;
    case "hidden": {
      const h = b as typeof a;
      return a.seq === h.seq && a.items.length === h.items.length && a.items.every((x, i) => sameItem(x, h.items[i]));
    }
    case "message": {
      const m = b as typeof a;
      return a.rawText === m.rawText && a.rawSpeaker === m.rawSpeaker && a.repeat === m.repeat && sameShot(a.screen, m.screen) && a.speaker === m.speaker && a.face === m.face && a.faceIndex === m.faceIndex && sameLines(a.lines, m.lines)
        && a.voice === m.voice && sameOccurrences(a.occurrences, m.occurrences);
    }
    case "scroll": return a.rawText === (b as typeof a).rawText && sameLines(a.lines, (b as typeof a).lines);
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
    case "notice": {
      const p = b as typeof a;
      return a.text === p.text && a.source === p.source && a.noticeKind === p.noticeKind;
    }
    case "screen": return sameShot(a.screen, (b as typeof a).screen);
    case "cutin": {
      const p = b as typeof a;
      return a.best === p.best && a.frames.length === p.frames.length && a.frames.every((f, i) => sameShot(f, p.frames[i])) && sameMotion(a.motion, p.motion);
    }
  }
}
