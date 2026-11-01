import { isRemoteView } from "@/app/share";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { AlertTriangle, ChevronDown, CircleCheck, CircleHelp, ClipboardCopy, Info, RefreshCw, Wand2, XCircle } from "lucide-react";
import { useDiagnosis } from "@/app/DiagnosisProvider";
import { useGame } from "@/app/GameProvider";
import { recommendedActions, reportMarkdown, type DiagnoseFinding } from "@/core/diagnose";
import type { LoadError, MapInfo } from "@/core/types";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { casual } from "@/ui/terms";
import { AiHandoff } from "./AiHandoff";
import { useApplyDiagnosis } from "./useApplyDiagnosis";

const DATA_FILE: Record<string, string> = {
  Actors: "캐릭터", Classes: "직업", Skills: "스킬", Items: "아이템", Weapons: "무기", Armors: "방어구", Enemies: "적",
  Troops: "적 무리", States: "상태", Animations: "애니메이션", Tilesets: "타일셋", CommonEvents: "공통 이벤트",
  MapInfos: "맵 목록", System: "게임 기본 정보",
};

/** 불러오기 오류를 사용자가 알아들을 한 문장으로 */
function loadErrorSentence(e: LoadError, mapInfos?: readonly (MapInfo | null)[]): { title: string; detail: string } {
  if (e.mapId !== undefined) {
    const name = mapInfos?.[e.mapId]?.name;
    const map = `맵 ${e.mapId}번${name ? `(${name})` : ""}`;
    if (e.message.includes("템플릿 이벤트")) {
      return { title: `${map}의 이벤트 일부를 맞추지 못했어요`, detail: "그 이벤트는 원래 모습과 다르게 보일 수 있어요. 다른 내용은 그대로 볼 수 있어요." };
    }
    return { title: `${map} 파일을 읽지 못했어요`, detail: "이 맵은 볼 수 없어요. 다른 맵은 그대로 볼 수 있어요." };
  }
  if (e.file.endsWith("log.jsonl")) {
    return { title: "플레이 기록 일부가 깨져 있어요", detail: "깨진 줄만 건너뛰었어요. 나머지 기록은 그대로 볼 수 있어요." };
  }
  const base = e.file.split("/").pop()?.replace(/\.json$/i, "") ?? e.file;
  const what = DATA_FILE[base];
  return {
    title: what ? `${what} 파일을 읽지 못했어요` : `${e.file} 파일을 읽지 못했어요`,
    detail: what ? `${what} 정보는 볼 수 없어요. 나머지는 그대로 볼 수 있어요.` : "이 파일의 내용은 볼 수 없어요. 나머지는 그대로 볼 수 있어요.",
  };
}

/** 할 일 칸에서 상태별로 덧붙이는 한 줄 */
const HINT: Partial<Record<DiagnoseFinding["status"], string>> = {
  unknown: "지금은 그대로 봐도 돼요. 읽다가 이상한 곳이 보이면 아래 ‘문제가 계속되면’을 써 주세요.",
  unsupported: "이 부분은 아직 뷰어가 보여 주지 못해요. 꼭 필요하면 아래 ‘문제가 계속되면’을 써 주세요.",
};

const canApply = (f: DiagnoseFinding) => f.status === "needs-addon" && !!f.action && f.action.kind !== "none";

function Details({ lines }: { lines: string[] }) {
  if (lines.length === 0) return null;
  return (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <Button variant="link" size="sm" className="h-auto px-0 text-muted-foreground">
          자세히 <ChevronDown />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="mt-1 flex flex-col gap-0.5 text-xs text-muted-foreground">
          {lines.map((e, i) => <li key={i} className="break-all">{e}</li>)}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}

function Row({ icon, label, title, detail, hint, more, action }: {
  icon?: ReactNode; label?: string; title: string; detail?: string; hint?: string; more: string[]; action?: ReactNode;
}) {
  return (
    <Item variant="outline" size="sm" className="items-start">
      {icon && <ItemMedia variant="icon">{icon}</ItemMedia>}
      <ItemContent>
        {label && <span className="text-xs text-muted-foreground">{label}</span>}
        <ItemTitle>{title}</ItemTitle>
        {detail && <ItemDescription className="line-clamp-none">{detail}</ItemDescription>}
        {hint && <ItemDescription className="line-clamp-none">{hint}</ItemDescription>}
        <Details lines={more} />
      </ItemContent>
      {action && <ItemActions>{action}</ItemActions>}
    </Item>
  );
}

function FoldedGroup({ title, description, list }: { title: string; description?: string; list: DiagnoseFinding[] }) {
  if (list.length === 0) return null;
  return (
    <Collapsible asChild>
      <Card size="sm">
        <CardHeader>
          <CardTitle>{title} {list.length}개</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
          <CardAction>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="[&[data-state=open]>svg]:rotate-180">보기 <ChevronDown /></Button>
            </CollapsibleTrigger>
          </CardAction>
        </CardHeader>
        <CollapsibleContent asChild>
          <CardContent>
            <ItemGroup className="gap-2">
              {list.map((f) => (
                <Row key={f.id} label={f.area} title={f.title} detail={f.detail} more={f.evidence} />
              ))}
            </ItemGroup>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

const TODO_ORDER: Record<DiagnoseFinding["status"], number> = { "needs-addon": 0, unsupported: 1, unknown: 2, "auto-fixed": 3, ok: 4 };

/** `게임 진단` 화면: 할 일 위주로 — 결론, 할 일, 뷰어가 처리한 것, 확인 완료, 문제가 계속되면 */
export function DiagnoseView({ loadErrors = [] }: { loadErrors?: readonly LoadError[] }) {
  const { report, loading, rerun } = useDiagnosis();
  const { data } = useGame();
  const apply = useApplyDiagnosis();
  const [busy, setBusy] = useState(false);

  if (!report) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
        {!loading && <p className="text-sm text-muted-foreground">게임을 열면 진단해요.</p>}
      </div>
    );
  }

  const actions = recommendedActions(report);
  const todo = report.findings
    .filter((f) => f.status === "needs-addon" || f.status === "unsupported" || f.status === "unknown")
    .sort((a, b) => TODO_ORDER[a.status] - TODO_ORDER[b.status] || Number(canApply(b)) - Number(canApply(a)));
  const autoFixed = report.findings.filter((f) => f.status === "auto-fixed");
  const ok = report.findings.filter((f) => f.status === "ok");
  const todoCount = loadErrors.length + todo.length;
  const broken = loadErrors.length > 0 || todo.some((f) => f.status === "unsupported");

  const run = (list: typeof actions) => {
    setBusy(true);
    void apply(list)
      .then((msg) => toast.success(msg ?? "켰어요. 켠 뒤에 나오는 장면부터 더 잘 보여요.", { className: "whitespace-pre-line" }))
      .catch(() => toast.error("설정을 켜지 못했어요."))
      .finally(() => setBusy(false));
  };
  const copy = () => {
    void navigator.clipboard.writeText(reportMarkdown(report))
      .then(() => toast.success("개발용 보고서를 복사했어요. Claude Code에 붙여 넣으면 돼요."))
      .catch(() => toast.error("복사하지 못했어요. 브라우저가 클립보드를 막았을 수 있어요."));
  };

  let icon: ReactNode;
  let sentence: string;
  if (broken) {
    icon = <XCircle className="text-destructive" />;
    sentence = actions.length > 0
      ? `일부 내용은 볼 수 없고, 켜 두면 더 잘 보이는 설정이 ${actions.length}개 있어요.`
      : "일부 내용은 볼 수 없어요.";
  } else if (actions.length > 0) {
    icon = <AlertTriangle className="text-warning" />;
    sentence = `켜 두면 더 잘 보이는 설정이 ${actions.length}개 있어요.`;
  } else if (todoCount > 0) {
    icon = <Info className="text-info" />;
    sentence = `그대로 봐도 돼요. 뷰어가 확실히 모르는 것이 ${todoCount}개 있어요.`;
  } else {
    icon = <CircleCheck className="text-success" />;
    sentence = "이 게임은 그대로 잘 보여요. 할 일이 없어요.";
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-start gap-2 leading-snug [&_svg]:mt-0.5 [&_svg]:size-5 [&_svg]:shrink-0">
            {icon}
            <span>{sentence}</span>
          </CardTitle>
          <CardDescription>
            {report.used.log ? "게임 파일과 플레이 기록을 살펴본 결과예요." : "게임 파일을 살펴본 결과예요. 조금 플레이한 뒤 다시 확인하면 더 정확해요."}
          </CardDescription>
          <CardAction>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" disabled={loading} onClick={rerun}><RefreshCw />다시 확인</Button>
              </TooltipTrigger>
              <TooltipContent>게임이나 플러그인을 바꿨다면 눌러 주세요</TooltipContent>
            </Tooltip>
          </CardAction>
        </CardHeader>
        {actions.length > 0 && (
          <CardContent>
            <Button disabled={busy} onClick={() => run(actions)}><Wand2 />모두 켜기</Button>
          </CardContent>
        )}
      </Card>

      {todoCount > 0 && (
        <Card size="sm">
          <CardHeader>
            <CardTitle>할 일 {todoCount}개</CardTitle>
          </CardHeader>
          <CardContent>
            <ItemGroup className="gap-2">
              {loadErrors.map((e, i) => {
                const s = loadErrorSentence(e, data?.mapInfos);
                return (
                  <Row
                    key={`load-${i}`}
                    icon={<XCircle className="text-destructive" />}
                    label="파일"
                    title={s.title}
                    detail={s.detail}
                    more={[`${e.file}: ${casual(e.message)}`]}
                  />
                );
              })}
              {todo.map((f) => (
                <Row
                  key={f.id}
                  icon={f.status === "unsupported" ? <XCircle className="text-destructive" />
                    : f.status === "unknown" ? <CircleHelp className="text-info" />
                    : <AlertTriangle className="text-warning" />}
                  label={f.area}
                  title={f.title}
                  detail={f.detail}
                  hint={HINT[f.status]}
                  more={f.evidence}
                  action={canApply(f) && (
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => { if (f.action) run([f.action]); }}>켜기</Button>
                  )}
                />
              ))}
            </ItemGroup>
          </CardContent>
        </Card>
      )}

      <FoldedGroup
        title="뷰어가 알아서 처리한 것"
        description="따로 할 일은 없어요. 이 게임만의 방식을 뷰어가 맞춰 읽고 있어요."
        list={autoFixed}
      />
      <FoldedGroup title="확인 완료" list={ok} />

      <Card size="sm">
        <CardHeader>
          <CardTitle>문제가 계속되면</CardTitle>
          <CardDescription>대사가 빠지거나 그림이 이상하게 보이면, 뷰어가 이 게임을 잘 못 읽는 거예요.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {isRemoteView() ? <p className="text-sm text-muted-foreground">AI 기능은 PC에서 해 주세요.</p> : <AiHandoff />}
          <Button variant="link" size="sm" className="h-auto self-start px-0 text-muted-foreground" onClick={copy}>
            <ClipboardCopy />개발용 보고서 복사
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
