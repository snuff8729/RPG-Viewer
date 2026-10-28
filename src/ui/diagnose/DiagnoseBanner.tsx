import { useState } from "react";
import { Stethoscope } from "lucide-react";
import { useDiagnosis } from "@/app/DiagnosisProvider";
import { useGame } from "@/app/GameProvider";
import { formatRoute } from "@/app/route";
import { attentionCount } from "@/core/diagnose";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { gameKeyOf } from "@/ui/live/readPosition";

const KEY = "rpgv.diagnose.seen:";

function seen(gameKey: string): boolean {
  try { return localStorage.getItem(KEY + gameKey) === "1"; } catch { return false; }
}
function markSeen(gameKey: string): void {
  try { localStorage.setItem(KEY + gameKey, "1"); } catch { /* 이 브라우저에선 못 기억 */ }
}

/** 게임을 처음 열었을 때 한 번: 진단 결과 알림(보기·닫기를 누르면 이 게임에서는 다시 안 뜬다) */
export function DiagnoseBanner() {
  const { data } = useGame();
  const { report } = useDiagnosis();
  const key = data ? gameKeyOf(data) : null;
  const [closed, setClosed] = useState<string | null>(null);
  if (!report || key === null || closed === key || seen(key)) return null;
  const n = attentionCount(report);
  const close = () => { markSeen(key); setClosed(key); };
  return (
    <Alert className="mb-4">
      <Stethoscope />
      <AlertTitle>{n > 0 ? `이 게임을 분석했어요 — 확인할 것 ${n}개` : "이 게임을 분석했어요 — 특별히 확인할 것이 없어요"}</AlertTitle>
      <AlertDescription>게임 진단에서 추천 설정을 한 번에 켤 수 있어요.</AlertDescription>
      <AlertAction className="flex gap-1">
        <Button size="sm" asChild>
          <a href={formatRoute({ kind: "diagnose" })} onClick={close}>보기</a>
        </Button>
        <Button size="sm" variant="ghost" onClick={close}>닫기</Button>
      </AlertAction>
    </Alert>
  );
}
