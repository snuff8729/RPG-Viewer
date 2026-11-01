import { isRemoteView } from "@/app/share";
import { useState } from "react";
import { ChevronDown, ClipboardCopy, RefreshCw, Wand2 } from "lucide-react";
import { useDiagnosis } from "@/app/DiagnosisProvider";
import {
  attentionCount, DIAGNOSE_AREAS, recommendedActions, reportMarkdown, type DiagnoseFinding, type DiagnoseStatus,
} from "@/core/diagnose";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { AiHandoff } from "./AiHandoff";
import { useApplyDiagnosis } from "./useApplyDiagnosis";

const LABEL: Record<DiagnoseStatus, string> = { ok: "괜찮아요", "auto-fixed": "자동 처리", "needs-addon": "확인 필요", unsupported: "문제", unknown: "확인 필요" };

const BADGE: Record<DiagnoseStatus, "success" | "secondary" | "destructive" | "warning"> = {
  ok: "success", "auto-fixed": "secondary", "needs-addon": "warning", unsupported: "destructive", unknown: "warning",
};

function FindingItem({ f, onApply, busy }: { f: DiagnoseFinding; onApply: () => void; busy: boolean }) {
  const canApply = f.status === "needs-addon" && !!f.action && f.action.kind !== "none";
  return (
    <Item variant="outline" size="sm" className="items-start">
      <ItemContent>
        <ItemTitle className="flex flex-wrap items-center gap-2">
          <Badge variant={BADGE[f.status]}>{LABEL[f.status]}</Badge>
          {f.title}
        </ItemTitle>
        <ItemDescription className="line-clamp-none">{f.detail}</ItemDescription>
        {f.evidence.length > 0 && (
          <Collapsible>
            <CollapsibleTrigger asChild>
              <Button variant="link" size="sm" className="h-auto px-0 text-muted-foreground">
                근거 {f.evidence.length}개 <ChevronDown />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ul className="mt-1 flex flex-col gap-0.5 text-xs text-muted-foreground">
                {f.evidence.map((e, i) => <li key={i} className="break-all">{e}</li>)}
              </ul>
            </CollapsibleContent>
          </Collapsible>
        )}
      </ItemContent>
      {canApply && (
        <ItemActions>
          <Button size="sm" variant="outline" disabled={busy} onClick={onApply}>적용</Button>
        </ItemActions>
      )}
    </Item>
  );
}

/** `게임 진단` 화면: 이 게임에서 특별한 것과 뷰어가 할 일 */
export function DiagnoseView() {
  const { report, loading, rerun } = useDiagnosis();
  const apply = useApplyDiagnosis();
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
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
  const n = attentionCount(report);
  const run = (list: typeof actions) => {
    setBusy(true);
    setNote(null);
    void apply(list)
      .then((msg) => setNote({ ok: true, text: msg ?? "추천 설정을 적용했어요. 켠 뒤에 나오는 장면부터 기록돼요." }))
      .catch(() => setNote({ ok: false, text: "설정을 적용하지 못했어요." }))
      .finally(() => setBusy(false));
  };
  const copy = () => {
    const text = reportMarkdown(report);
    void navigator.clipboard.writeText(text)
      .then(() => setNote({ ok: true, text: "개발용 보고서를 복사했어요. Claude Code에 붙여 넣으면 돼요." }))
      .catch(() => setNote({ ok: false, text: "복사하지 못했어요. 브라우저가 클립보드를 막았을 수 있어요." }));
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>{n > 0 ? `확인할 것 ${n}개` : "특별히 확인할 것이 없어요"}</CardTitle>
          <CardDescription>
            게임 데이터와 플러그인을 스스로 살펴본 결과예요.
            {report.used.log
              ? ` 플레이 기록 ${report.used.logRecords.toLocaleString()}줄도 함께 봤어요.`
              : " 게임을 조금 플레이한 뒤 다시 분석하면 더 정확해요."}
          </CardDescription>
          <CardAction>
            <Button variant="ghost" size="sm" disabled={loading} onClick={rerun}><RefreshCw />다시 분석</Button>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button disabled={busy || actions.length === 0} onClick={() => run(actions)}>
            <Wand2 />추천 설정 모두 적용{actions.length > 0 ? ` (${actions.length})` : ""}
          </Button>
          <Button variant="outline" onClick={copy}><ClipboardCopy />개발용 보고서 복사</Button>
          {isRemoteView() ? <p className="w-full text-sm text-muted-foreground">AI 기능은 PC에서 해 주세요.</p> : <div className="flex w-full flex-col gap-2"><p className="text-sm text-muted-foreground">AI에게 맡기기는 가린 사본을 만들고, AI 답변 풀어보기는 가린 글을 원래 글로 바꿔요.</p><div className="flex flex-wrap gap-2"><AiHandoff /></div></div>}
        </CardContent>
      </Card>
      {note && (
        <Alert variant={note.ok ? "default" : "destructive"}>
          <AlertDescription className="whitespace-pre-line">{note.text}</AlertDescription>
        </Alert>
      )}
      {DIAGNOSE_AREAS.map((area) => {
        const list = report.findings.filter((f) => f.area === area);
        if (list.length === 0) return null;
        return (
          <Card key={area} size="sm">
            <CardHeader>
              <CardTitle>{area}</CardTitle>
            </CardHeader>
            <CardContent>
              <ItemGroup className="gap-2">
                {list.map((f) => (
                  <FindingItem key={f.id} f={f} busy={busy} onApply={() => { if (f.action) run([f.action]); }} />
                ))}
              </ItemGroup>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
