import { useMemo } from "react";
import { useGame } from "@/app/GameProvider";
import { useLive } from "@/app/LiveProvider";
import { locationKey } from "@/core/index/locations";
import { findNodePathByCmd } from "@/core/interpret/interpret";
import { remainingNodes } from "@/core/live/remaining";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ScriptView } from "../script/ScriptView";
import { openPage } from "../navigation";
import { highlightNode } from "../highlight";

/** 지금 실행 중인 페이지에서 현재 대사/선택지 이후의 대본. */
export function NowNextCard() {
  const { live } = useLive();
  const { index } = useGame();
  const running = live?.running ?? null;
  const runningCmd = (live as { runningCmd?: number | null } | null)?.runningCmd;
  const key = running ? locationKey(running) : null;
  const entry = useMemo(
    () => (key ? index?.pages.find(p => locationKey(p.location) === key) : undefined),
    [index, key],
  );
  const hasCmd = typeof runningCmd === "number";
  const nodes = useMemo(
    // runningCmd는 엔진의 _index(실행 중 명령의 다음 칸)라 1을 뺀다
    () => (entry && hasCmd ? remainingNodes(entry.nodes, runningCmd - 1) : []),
    [entry, hasCmd, runningCmd],
  );
  if (!running || !entry) return null;

  const first = nodes[0] as { cmd?: unknown } | undefined;
  const onView = () => {
    openPage(entry.location);
    const path = typeof first?.cmd === "number" ? findNodePathByCmd(entry.nodes, first.cmd) : null;
    if (path) highlightNode(locationKey(entry.location), path);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>지금 이후</CardTitle>
        <CardDescription>{entry.path}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {!hasCmd ? (
          <p className="text-sm text-muted-foreground">플러그인을 업데이트하면 이후 대사를 볼 수 있어요</p>
        ) : (
          <>
            <ScrollArea className="max-h-80 overflow-auto">
              {/* pageKey를 주지 않아 탐색기 강조 대상으로 잡히지 않는다 */}
              <ScriptView nodes={nodes} basePath={[]} location={entry.location} />
            </ScrollArea>
            <Button variant="outline" size="sm" onClick={onView}>탐색기에서 보기</Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
