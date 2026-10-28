import { useMemo, useState } from "react";
import { useGame } from "@/app/GameProvider";
import { useLive } from "@/app/LiveProvider";
import { choiceFlow, type FlowItem } from "@/core/live/choiceFlow";
import { branchLabel, branchPath, foldTimeline } from "@/core/live/history";
import { readerItems } from "@/core/live/reader";
import { useAddons } from "@/app/AddonsProvider";
import { hiddenImageMatcher } from "@/core/addons/hiddenImages";
import { DEFAULT_SCREEN, withoutMenuScreens } from "@/core/addons/screenPictures";
import { menuCommonEventsOf } from "@/core/live/menuScenes";
import { useNoticesShown } from "./noticeDisplay";
import type { HistoryModel } from "@/core/live/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ReaderItemView } from "./ReaderItemView";
import { useBattlesShown } from "./battleDisplay";
import { usePluginOverrides } from "./pluginDisplay";
import { choiceTexts } from "./historyText";

/** `대사 {N}줄 · 그림 {N}` — 0인 쪽은 뺀다. */
function segmentSummary(messages: number, pictures: number): string {
  const parts: string[] = [];
  if (messages > 0) parts.push(`대사 ${messages}줄`);
  if (pictures > 0) parts.push(`그림 ${pictures}`);
  return parts.join(" · ");
}

function Segment({ item }: { item: Extract<FlowItem, { kind: "segment" }> }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>{segmentSummary(item.messages, item.pictures)}</span>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="text-muted-foreground">{open ? "▾ 접기" : "▸ 펼쳐 읽기"}</Button>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent className="space-y-4 pt-2">
        {item.items.map(it => <ReaderItemView key={it.key} item={it} />)}
      </CollapsibleContent>
    </Collapsible>
  );
}

function ChoicePoint({ item }: { item: Extract<FlowItem, { kind: "choice" }> }) {
  const q = item.question;
  const title = q ? `◆ ${q.speaker ? `${q.speaker}: ` : ""}"${q.text}"` : "◆ 선택지";
  return (
    <Card size="sm">
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent className="space-y-1.5">
        {item.options.map((o, i) => (
          <div key={i} className="flex flex-wrap items-center gap-1.5">
            {o.picked
              ? <span className="font-medium">▶ 고른 것: "{o.label}"</span>
              : <span className="text-muted-foreground">안 고름: "{o.label}"</span>}
            {o.elsewhere.map(b => <Badge key={b} variant="secondary">✓ {b}</Badge>)}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function Fork({ item, model, branch, onSelect }: {
  item: Extract<FlowItem, { kind: "fork" }>; model: HistoryModel; branch: number; onSelect: (id: number) => void;
}) {
  return (
    <div className="space-y-2 text-center">
      <p className="text-sm text-muted-foreground">💾 여기서 세이브를 불러와 다른 갈래로</p>
      <div className="flex flex-wrap justify-center gap-2">
        {item.branches.map(id => (
          <Button key={id} variant="outline" size="sm" disabled={id === branch} onClick={() => onSelect(id)}>
            {branchLabel(model, id)}
          </Button>
        ))}
      </div>
    </div>
  );
}

/**
 * 선택 흐름 — 고른 갈래를 처음부터, 대사 구간은 한 줄 요약으로 접고 선택 지점·갈라짐을 드러낸다.
 * 읽음 표시·자동 따라가기·Space 처리는 하지 않는다.
 */
export function ChoiceFlowView({ branch, onSelectBranch }: { branch: number; onSelectBranch: (id: number) => void }) {
  const { data } = useGame();
  const { records, model, noisy, uncertainSeqs, changedSeqs, coverage } = useLive();
  const { overrides } = usePluginOverrides();
  const [battlesShown] = useBattlesShown();
  const [noticesShown] = useNoticesShown();
  const { hiddenImages, menuPicturesShown } = useAddons();

  const flow = useMemo(() => {
    if (!data) return [];
    // 메뉴 화면 그림은 어댑터의 `메뉴 화면 그림도 기록`을 켰을 때만
    const path = withoutMenuScreens(branchPath(records, model, branch), menuPicturesShown, menuCommonEventsOf(data.menuCommonEvents, data.commonEvents));
    const folded = foldTimeline(path, model, { uncertainSeqs, changedSeqs, noisy, isHiddenImage: hiddenImageMatcher(hiddenImages) });
    const choiceText = choiceTexts(path, data);
    // 읽기에서 숨긴 그림은 다시 쌓은 화면에서도 뺀다
    const ctx = { screen: data.screenSize ?? DEFAULT_SCREEN, hidden: hiddenImageMatcher(hiddenImages) };
    const reader = readerItems(folded, data, choiceText, model, overrides, null, { battles: battlesShown, notices: noticesShown, compose: { ctx } });
    return choiceFlow({ items: folded, reader, data, model, coverage, branch, choiceText });
  }, [data, records, model, branch, noisy, uncertainSeqs, changedSeqs, coverage, overrides, battlesShown, noticesShown, hiddenImages, menuPicturesShown]);

  if (!data) return null;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {/* 갈래가 바뀌면 펼침 상태를 처음으로 */}
      <div key={branch} className="mx-auto max-w-2xl space-y-4 px-2 py-4 text-base leading-relaxed">
        <p className="text-center text-sm text-muted-foreground">— {branchLabel(model, branch)} · 처음부터 —</p>
        {flow.map(item => {
          switch (item.kind) {
            case "chapter": return <ReaderItemView key={item.key} item={item} />;
            case "segment": return <Segment key={item.key} item={item} />;
            case "choice": return <ChoicePoint key={item.key} item={item} />;
            case "fork": return <Fork key={item.key} item={item} model={model} branch={branch} onSelect={onSelectBranch} />;
          }
        })}
      </div>
    </div>
  );
}
