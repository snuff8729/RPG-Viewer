import { useMemo, useState } from "react";
import { useGame } from "@/app/GameProvider";
import { useLive } from "@/app/LiveProvider";
import { locationKey, pageLocation } from "@/core/index/locations";
import { findNodePathByCmd, nodesAt } from "@/core/interpret/interpret";
import { pageList } from "@/core/live/mismatch";
import { remainingNodes, untilStop } from "@/core/live/remaining";
import type { ScriptNode } from "@/core/types";
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
  const [more, setMore] = useState(false);
  const choice = live?.choice;
  const choiceKey = choice ? `${choice.src ? locationKey(choice.src) : ""}#${choice.cmd}` : null;
  // 새(직전과 다른) 선택지가 떠오르면 자동으로 펼친다. 마지막으로 본 선택지를 기억하므로
  // 재연결 등으로 잠깐 null이 됐다 같은 선택지로 돌아와도 사용자가 접은 카드를 다시 열지 않는다.
  const [seenChoice, setSeenChoice] = useState<string | null>(null);
  if (choiceKey !== null && choiceKey !== seenChoice) {
    setSeenChoice(choiceKey);
    setOpen(true);
  }
  const running = live?.running ?? null;
  const runningCmd = live?.runningCmd;
  const key = running ? locationKey(running) : null;
  // TemplateEvent 원래 페이지 실행 중이면 그것을 부른 템플릿 페이지 항목 안의 펼친 노드를 쓴다.
  const entryKey = running ? locationKey(pageLocation(running)) : null;
  const entry = useMemo(
    () => (entryKey ? index?.pages.find(p => locationKey(p.location) === entryKey) : undefined),
    [index, entryKey],
  );
  // running은 live마다 새 객체일 수 있어 같은 위치면 처음 객체를 계속 쓴다(아래 계산을 다시 하지 않게).
  const [runningLoc, setRunningLoc] = useState(running);
  if (running !== runningLoc && (running === null || runningLoc === null || locationKey(running) !== locationKey(runningLoc))) {
    setRunningLoc(running);
  }
  const runNodes = useMemo(
    () => (entry && runningLoc ? nodesAt(entry.nodes, entry.location, runningLoc) : null),
    [entry, runningLoc],
  );
  const list = useMemo(
    () => (data && runningLoc ? pageList(data, runningLoc) ?? undefined : undefined),
    [data, runningLoc],
  );
  const hasCmd = typeof runningCmd === "number";
  const nodes = useMemo(
    // runningCmd는 엔진의 _index(실행 중 명령의 다음 칸)라 1을 뺀다
    () => (runNodes && hasCmd ? remainingNodes(runNodes, runningCmd - 1, list) : []),
    [runNodes, hasCmd, runningCmd, list],
  );
  const upto = useMemo(() => untilStop(nodes), [nodes]);
  // 멈춤 전 노드가 길면 대사(message/scroll) 5개까지만 보이고 나머지는 "더 보기"
  const { shown, hidden } = useMemo(() => {
    let seen = 0;
    let cut = upto.nodes.length;
    for (let i = 0; i < upto.nodes.length; i++) {
      const k = upto.nodes[i].kind;
      if (k === "message" || k === "scroll") {
        if (seen === 5) { cut = i; break; }
        seen++;
      }
    }
    const rest = upto.nodes.slice(cut);
    return { shown: upto.nodes.slice(0, cut), hidden: rest.filter(n => n.kind === "message" || n.kind === "scroll").length };
  }, [upto]);
  // 다음 멈춤 지점이 바뀌면 더 보기를 접는다
  const stopCmd = (upto.stop?.node as { cmd?: number } | undefined)?.cmd;
  const resetKey = `${key}#${stopCmd ?? ""}#${upto.stop?.kind ?? ""}`;
  const [seenStop, setSeenStop] = useState(resetKey);
  if (seenStop !== resetKey) { setSeenStop(resetKey); setMore(false); }
  if (!running || !entry) return null;
  // runningCmd가 아예 없으면 구버전 플러그인, null이면 보여줄 위치가 없음
  const outdated = runningCmd === undefined;
  if (!outdated && nodes.length === 0) return null;

  const stop = upto.stop;
  const stopText = stop?.node.kind === "choices"
    ? `⤷ 여기서 선택지 (${stop.node.branches.length}개)`
    : stop?.node.kind === "transfer"
      ? `⤷ 여기서 이동: ${stop.node.mapId === null ? "(변수로 지정한 맵)" : data?.mapInfos?.[stop.node.mapId]?.name || `#${stop.node.mapId}`}`
      : null;
  const stopLabel = stop?.kind === "choices" ? "다음 선택지까지" : stop?.kind === "transfer" ? "다음 이동까지" : "페이지 끝까지";
  const visible: ScriptNode[] = more ? upto.nodes : shown;
  const first = nodes[0] as { cmd?: unknown } | undefined;
  const onView = () => {
    openPage(entry.location);
    const path = typeof first?.cmd === "number" && runningLoc
      ? findNodePathByCmd(entry.nodes, first.cmd, { base: entry.location, target: runningLoc }) : null;
    if (path) highlightNode(locationKey(entry.location), path);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>다음 대사</CardTitle>
        <CardDescription>{entry.path} · {stopLabel}</CardDescription>
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
              <ScriptView nodes={visible} basePath={NOW_BASE_PATH} location={runningLoc ?? entry.location} />
            </ScrollArea>
            {hidden > 0 && !more && (
              <Button variant="ghost" size="sm" onClick={() => setMore(true)}>더 보기 ({hidden}줄)</Button>
            )}
            {stopText && <p className="text-xs text-muted-foreground">{stopText}</p>}
            <Button variant="outline" size="sm" onClick={onView}>탐색기에서 보기</Button>
          </>
        )}
      </CardContent>}
    </Card>
  );
}
