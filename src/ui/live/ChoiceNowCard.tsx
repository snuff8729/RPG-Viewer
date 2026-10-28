import { useLive } from "@/app/LiveProvider";
import { useGame } from "@/app/GameProvider";
import { pickKey } from "@/core/live/coverage";
import { branchLabel } from "@/core/live/history";
import { formatText } from "@/core/text/escape";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/** 지금 떠 있는 선택지와, 어느 갈래에서 어떤 걸 골랐었는지. */
export function ChoiceNowCard() {
  const { live, coverage, model } = useLive();
  const { data } = useGame();
  const choice = live?.choice;
  if (!choice || !data) return null;
  const picks = choice.src ? coverage.picks.get(pickKey(choice.src, choice.cmd)) ?? [] : [];
  return (
    <Card size="sm">
      <CardHeader><CardTitle>지금 선택지</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {choice.options.map((opt, i) => {
          const mine = picks.filter(p => p.picked === i);
          const after = [...new Set(mine.flatMap(p => p.aftermath))];
          return (
            <div key={i} className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{formatText(opt, data)}</span>
                {mine.length === 0
                  ? <span className="text-xs text-muted-foreground">아직 안 고름</span>
                  : mine.map(p => <Badge key={p.seq} variant="secondary">{branchLabel(model, p.branch)}</Badge>)}
              </div>
              {after.length > 0 && <p className="text-xs text-muted-foreground">{after.join(" · ")}</p>}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
