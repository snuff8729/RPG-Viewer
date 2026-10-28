import { useMemo, useState } from "react";
import { useGame } from "@/app/GameProvider";
import { useLive } from "@/app/LiveProvider";
import { locationKey } from "@/core/index/locations";
import { findNodePathByCmd } from "@/core/interpret/interpret";
import { pageList } from "@/core/live/mismatch";
import { remainingNodes } from "@/core/live/remaining";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ScriptView } from "../script/ScriptView";
import { openPage } from "../navigation";
import { highlightNode } from "../highlight";

/** 탐색기 노드 경로(data-node-path·펼침 키)와 겹치지 않도록 쓰는 접두 경로 */
const NOW_BASE_PATH = [-100];

/** 지금 실행 중인 페이지에서 현재 대사/선택지 이후의 대본. */
export function NowNextCard() {
  const { live } = useLive();
  const { index, data } = useGame();
  const [open, setOpen] = useState(false);
  const choice = live?.choice;
  const choiceKey = choice ? `${choice.src ? locationKey(choice.src) : ""}#${choice.cmd}` : null;
  // 새 선택지가 떠오르면 자동으로 펼친다
  const [seenChoice, setSeenChoice] = useState<string | null>(null);
  if (choiceKey !== seenChoice) {
    setSeenChoice(choiceKey);
    if (choiceKey !== null) setOpen(true);
  }
  const running = live?.running ?? null;
  const runningCmd = live?.runningCmd;
  const key = running ? locationKey(running) : null;
  const entry = useMemo(
    () => (key ? index?.pages.find(p => locationKey(p.location) === key) : undefined),
    [index, key],
  );
  const list = useMemo(() => (data && entry ? pageList(data, entry.location) ?? undefined : undefined), [data, entry]);
  const hasCmd = typeof runningCmd === "number";
  const nodes = useMemo(
    // runningCmd는 엔진의 _index(실행 중 명령의 다음 칸)라 1을 뺀다
    () => (entry && hasCmd ? remainingNodes(entry.nodes, runningCmd - 1, list) : []),
    [entry, hasCmd, runningCmd, list],
  );
  if (!running || !entry) return null;
  // runningCmd가 아예 없으면 구버전 플러그인, null이면 보여줄 위치가 없음
  const outdated = runningCmd === undefined;
  if (!outdated && nodes.length === 0) return null;

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
        <CardAction>
          <Button variant="ghost" size="icon-sm" aria-label={open ? "접기" : "펼치기"} onClick={() => setOpen(o => !o)}>
            {open ? <ChevronDown /> : <ChevronUp />}
          </Button>
        </CardAction>
      </CardHeader>
      {open && <CardContent className="space-y-2">
        {outdated ? (
          <p className="text-sm text-muted-foreground">플러그인을 업데이트하면 이후 대사를 볼 수 있어요</p>
        ) : (
          <>
            <ScrollArea className="max-h-80 overflow-auto">
              {/* pageKey를 주지 않아 탐색기 강조 대상으로 잡히지 않는다 */}
              <ScriptView nodes={nodes} basePath={NOW_BASE_PATH} location={entry.location} />
            </ScrollArea>
            <Button variant="outline" size="sm" onClick={onView}>탐색기에서 보기</Button>
          </>
        )}
      </CardContent>}
    </Card>
  );
}
