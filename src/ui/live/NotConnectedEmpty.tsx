import { Fragment } from "react";
import { Check, ChevronRight, Download, Play, RefreshCw, Unplug } from "lucide-react";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent } from "@/components/ui/empty";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import type { GuideStepMark } from "./connectionGuide";
import { ConnectionActionButton, useConnectionAction } from "./ConnectionAction";

/** 작은 단계 표시: 끝낸 단계는 ✓, 지금 단계는 강조 */
function StepIndicator({ steps }: { steps: GuideStepMark[] }) {
  return (
    <ol className="mb-2 flex items-center justify-center gap-1" aria-label="연결 단계">
      {steps.map((s, i) => (
        <Fragment key={s.label}>
          {i > 0 && <ChevronRight aria-hidden className="size-3.5 text-muted-foreground" />}
          <li aria-current={s.current ? "step" : undefined}>
            <Badge variant={s.current ? "default" : s.done ? "secondary" : "outline"} className={cn(!s.current && !s.done && "text-muted-foreground")}>
              {s.done ? <Check data-icon="inline-start" className="text-success" /> : <span>{i + 1}</span>}
              {s.label}
            </Badge>
          </li>
        </Fragment>
      ))}
    </ol>
  );
}

/**
 * 게임과 연결되지 않았을 때 보이는 안내 하나: 지금 할 단계만(제목 · 한 문장 · 버튼 하나).
 * 단계: 기록 플러그인 설치·업데이트 → 게임 실행. 휴대폰 보기에서는 PC에서 하라고만 알려요.
 */
export function NotConnectedEmpty({ className }: { className?: string }) {
  const ctl = useConnectionAction();
  const g = ctl.guide;
  const action = g?.action ?? null;
  const icon = !g || g.spinner ? <Spinner /> : action === "install" ? <Download /> : action === "update" ? <RefreshCw /> : action === "launch" ? <Play /> : <Unplug />;
  return (
    <Empty className={cn("h-full", className)}>
      <EmptyHeader>
        {g?.steps && <StepIndicator steps={g.steps} />}
        <EmptyMedia variant="icon">{icon}</EmptyMedia>
        <EmptyTitle>{g?.title ?? "게임 정보를 기다리고 있어요"}</EmptyTitle>
        {g?.text && <EmptyDescription>{g.text}</EmptyDescription>}
      </EmptyHeader>
      {action && (
        <EmptyContent>
          <ConnectionActionButton action={action} ctl={ctl} />
        </EmptyContent>
      )}
      <Button variant="link" asChild>
        <a href="#/read">게임 없이 이야기 읽기 →</a>
      </Button>
      {ctl.dialog}
    </Empty>
  );
}
