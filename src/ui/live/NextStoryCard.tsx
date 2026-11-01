import type { ReactNode } from "react";
import { ChevronRight, Flag } from "lucide-react";
import type { Confidence, StoryStep } from "@/core/story/nextStep";
import { CONFIDENCE_LABEL, KIND_LABEL, pathText, stepTitle } from "@/core/story/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { keyText, storyValue } from "@/core/story/progress";
import { openGameSettings } from "../addons/gameSettingsOpen";
import { openPage } from "../navigation";
import { useLive } from "@/app/LiveProvider";
import { useNextStory } from "./useNextStory";

const CONF_VARIANT: Record<Confidence, "default" | "secondary" | "outline"> = { high: "default", mid: "secondary", low: "outline" };

function ConfidenceBadge({ c }: { c: Confidence }) {
  return <Badge variant={CONF_VARIANT[c]}>확신 {CONFIDENCE_LABEL[c]}</Badge>;
}

/** 한 단계: 할 일, 바뀌는 것, 고를 선택지, 먼저 할 일, 가는 길 */
function StepBody({ s, compact }: { s: StoryStep; compact: boolean }) {
  const path = pathText(s.path);
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <p className="text-sm font-medium break-words">{stepTitle(s)}</p>
      <p className="text-xs text-muted-foreground">
        {KIND_LABEL[s.kind]} · {s.effect}{s.availableNow ? " · 지금 할 수 있어요" : " · 아직은 안 돼요"}
      </p>
      {s.choice && <p className="text-xs">선택지에서 “{s.choice}” 고르기</p>}
      {s.prereqs.length > 0 && (
        <div className="text-xs">
          <p className="text-muted-foreground">먼저 할 일:</p>
          <ol className="list-decimal pl-5">
            {s.prereqs.slice(0, compact ? 2 : 5).map((p, i) => (
              <li key={i} className="break-words">
                {p.where} — {p.action}{p.choiceLabel ? ` (“${p.choiceLabel}” 고르기)` : ""}
              </li>
            ))}
          </ol>
        </div>
      )}
      {path && <p className="text-xs font-medium">가는 길: {path}</p>}
      {!compact && (
        <div>
          <Button variant="link" size="sm" className="h-auto p-0" onClick={() => openPage(s.location)}>대사 보기</Button>
        </div>
      )}
    </div>
  );
}

const MAIN = "main";

/** `다음 스토리` 카드(플레이 화면·이 맵): 본편(또는 고른 서브 미션)을 앞으로 보내는 가장 그럴듯한 행동과 다른 후보, 진행 기준. */
export function NextStoryCard({ compact = false, action }: { compact?: boolean; /** 카드 안 끝에 둘 것(예: 어떻게 하나요) */ action?: ReactNode }) {
  const { story, mode, sides, follow, setFollow } = useNextStory();
  const { connection, live } = useLive();
  if (connection !== "connected" || !live) return null;
  const [best, ...alts] = story?.steps ?? [];
  const side = mode === "side";
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5"><Flag className="size-4" aria-hidden />{side ? "서브 미션" : "다음 스토리"}</CardTitle>
        {best && <CardAction><ConfidenceBadge c={best.confidence} /></CardAction>}
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {sides.length > 0 && (
          <Select value={follow ?? MAIN} onValueChange={(v) => setFollow(v === MAIN ? null : v)}>
            <SelectTrigger size="sm" className="w-full" aria-label="따라갈 이야기">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={MAIN}>본편</SelectItem>
              {sides.map((c) => (
                <SelectItem key={keyText(c.key)} value={keyText(c.key)}>{c.label} = {storyValue(c.key, live)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {best ? <StepBody s={best} compact={compact} /> : side ? (
          <p className="text-sm font-medium">이 미션의 다음 할 일을 찾지 못했어요</p>
        ) : (
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium">다음 스토리를 찾지 못했어요</p>
            <p className="text-xs text-muted-foreground">게임 맞춤 설정에서 스토리 진행 기준(진행 변수)을 골라 보세요.</p>
          </div>
        )}
        {alts.length > 0 && (
          <Collapsible>
            <CollapsibleTrigger className="group flex items-center gap-1 text-xs text-muted-foreground">
              <ChevronRight className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />
              다른 후보 {alts.length}개
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2 flex flex-col gap-3">
              {alts.map((s, i) => (
                <div key={i} className="flex items-start gap-2">
                  <ConfidenceBadge c={s.confidence} />
                  <StepBody s={s} compact={compact} />
                </div>
              ))}
            </CollapsibleContent>
          </Collapsible>
        )}
        {action}
      </CardContent>
      <CardFooter className="flex flex-wrap items-center gap-x-2 border-t py-2 text-xs text-muted-foreground">
        {side ? <span>{story ? `미션 기준: ${story.label} = ${story.value}` : "미션 기준을 읽지 못했어요"}</span> : (
          <>
            <span>{story ? `스토리 기준: ${story.label} = ${story.value}` : "스토리 기준을 찾지 못했어요"}</span>
            <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={openGameSettings}>{story ? "바꾸기" : "고르기"}</Button>
          </>
        )}
      </CardFooter>
    </Card>
  );
}
