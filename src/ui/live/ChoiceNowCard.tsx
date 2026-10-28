import { useLive } from "@/app/LiveProvider";
import { useGame } from "@/app/GameProvider";
import { pickKey } from "@/core/live/coverage";
import { branchLabel } from "@/core/live/history";
import type { PickInfo } from "@/core/live/types";
import { formatText } from "@/core/text/escape";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const CANCEL = -2;

/** 지금 떠 있는 선택지와, 어느 갈래에서 어떤 걸 골랐었는지. */
export function ChoiceNowCard() {
  const { live, coverage, model } = useLive();
  const { data } = useGame();
  const choice = live?.choice;
  if (!choice || !data) return null;
  const picks = choice.src ? coverage.picks.get(pickKey(choice.src, choice.cmd)) ?? [] : [];

  const row = (key: number, label: string, mine: PickInfo[]) => {
    // 같은 갈래에서 여러 번 고른 건 배지 하나로(BlockNode와 같은 `✓ {run}회차 갈래 {n}`)
    const labels = [...new Set(mine.map(p => branchLabel(model, p.branch)))];
    const after = [...new Set(mine.flatMap(p => p.aftermath))];
    return (
      <div key={key} className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{label}</span>
          {labels.length === 0
            ? <span className="text-xs text-muted-foreground">아직 안 고름</span>
            : labels.map(l => <Badge key={l} variant="secondary">✓ {l}</Badge>)}
        </div>
        {after.length > 0 && <p className="text-xs text-muted-foreground">{after.join(" · ")}</p>}
      </div>
    );
  };

  const cancelled = picks.filter(p => p.picked === CANCEL);
  return (
    <Card size="sm">
      <CardHeader><CardTitle>지금 선택지</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {choice.options.map((opt, i) => row(i, formatText(opt, data), picks.filter(p => p.picked === i)))}
        {cancelled.length > 0 && row(CANCEL, "취소", cancelled)}
      </CardContent>
    </Card>
  );
}
