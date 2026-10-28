import { useMemo, useState } from "react";
import { useLive } from "@/app/LiveProvider";
import { useGame } from "@/app/GameProvider";
import { locationKey } from "@/core/index/locations";
import { findNodePathByCmd } from "@/core/interpret/interpret";
import { pickKey } from "@/core/live/coverage";
import { branchLabel } from "@/core/live/history";
import { firstMessage } from "@/core/live/remaining";
import type { PickInfo } from "@/core/live/types";
import { formatText } from "@/core/text/escape";
import type { ScriptNode } from "@/core/types";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const CANCEL = -2;

/** 지금 떠 있는 선택지와, 어느 갈래에서 어떤 걸 골랐었는지. 항목당 한 줄, 누르면 미리보기. */
export function ChoiceNowCard() {
  const { live, coverage, model } = useLive();
  const { data, index } = useGame();
  const [expanded, setExpanded] = useState<{ key: string; row: number } | null>(null);
  const choice = live?.choice;
  const choiceKey = choice ? `${choice.src ? locationKey(choice.src) : ""}#${choice.cmd}` : null;
  const srcKey = choice?.src ? locationKey(choice.src) : null;
  const choicesNode = useMemo(() => {
    if (!choice || !srcKey) return null;
    const nodes = index?.pages.find(p => locationKey(p.location) === srcKey)?.nodes;
    if (!nodes) return null;
    const path = findNodePathByCmd(nodes, choice.cmd);
    if (!path) return null;
    // 경로를 따라 내려가 노드를 얻는다(walk의 경로 규칙을 모르므로 cmd로 직접 찾는다)
    const find = (l: ScriptNode[]): ScriptNode | null => {
      for (const n of l) {
        if (n.kind === "choices" && n.cmd === choice.cmd) return n;
        const subs: ScriptNode[][] = n.kind === "choices" ? [...n.branches.map(b => b.body), n.cancelBranch ?? []]
          : n.kind === "conditional" ? [n.then, n.else ?? []] : n.kind === "loop" ? [n.body] : [];
        for (const s of subs) { const r = find(s); if (r) return r; }
      }
      return null;
    };
    return find(nodes);
  }, [index, srcKey, choice]);
  if (!choice || !data) return null;
  const picks = choice.src ? coverage.picks.get(pickKey(choice.src, choice.cmd)) ?? [] : [];
  const open = expanded && expanded.key === choiceKey ? expanded.row : null;

  const preview = (body: ScriptNode[] | undefined): string | null => {
    const m = body ? firstMessage(body) : null;
    if (!m || m.kind !== "message") return null;
    const text = formatText(m.lines.join(" "), data);
    const who = m.speaker ? formatText(m.speaker, data) : "";
    return who ? `${who}: ${text}` : text;
  };

  const row = (key: number, label: string, mine: PickInfo[], body: ScriptNode[] | undefined) => {
    // 같은 갈래에서 여러 번 고른 건 배지 하나로(BlockNode와 같은 `✓ {run}회차 갈래 {n}`)
    const labels = [...new Set(mine.map(p => branchLabel(model, p.branch)))];
    const after = [...new Set(mine.flatMap(p => p.aftermath))];
    const line = open === key ? preview(body) : null;
    return (
      <div key={key} className="space-y-1">
        <button
          type="button"
          aria-expanded={open === key}
          className="flex w-full items-center gap-2 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => setExpanded(open === key ? null : { key: choiceKey ?? "", row: key })}
        >
          <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
          {labels.length === 0
            ? <span className="shrink-0 text-xs text-muted-foreground">아직 안 고름</span>
            : labels.map(l => <Badge key={l} variant="secondary" className="shrink-0">✓ {l}</Badge>)}
        </button>
        {open === key && (
          <div className="space-y-1 pl-3 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">이걸 고르면</p>
            {line && <p>{line}</p>}
            {after.length > 0 && <p>{after.join(" · ")}</p>}
          </div>
        )}
      </div>
    );
  };

  const cancelled = picks.filter(p => p.picked === CANCEL);
  const branches = choicesNode?.kind === "choices" ? choicesNode : null;
  return (
    <Card size="sm">
      <CardHeader><CardTitle>지금 선택지</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        {choice.options.map((opt, i) => row(i, formatText(opt, data), picks.filter(p => p.picked === i), branches?.branches[i]?.body))}
        {(branches?.cancelBranch || cancelled.length > 0) && row(CANCEL, "취소", cancelled, branches?.cancelBranch)}
      </CardContent>
    </Card>
  );
}
