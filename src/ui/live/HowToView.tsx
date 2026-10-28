import { useMemo, useState } from "react";
import { useGame } from "@/app/GameProvider";
import { useLive } from "@/app/LiveProvider";
import { atomKey, type Req, type Writer } from "@/core/deps/graph";
import { howTo, type HowTo, type HowToEnd, type HowToStep } from "@/core/deps/howTo";
import { locationKey } from "@/core/index/locations";
import { conditionsKey } from "@/core/live/interactable";
import type { LiveSnapshot } from "@/core/live/types";
import type { GameData } from "@/core/types";
import { openPage } from "@/ui/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useConditionsLive } from "./useConditionsLive";

const CACHE_LIMIT = 500;
/** 데이터별 (요구 + 시작 쓰는 곳 + 조건 상태) → 결과. 펼쳤다 접었다 해도 다시 계산하지 않는다. */
const cache = new WeakMap<GameData, Map<string, HowTo>>();

function cachedHowTo(req: Req, data: GameData, live: LiveSnapshot, from?: Writer): HowTo {
  const key = [atomKey(req.atom), JSON.stringify(req.test), from ? `${from.ctx}:${from.cmd}` : "", conditionsKey(live)].join("|");
  let m = cache.get(data);
  if (!m) { m = new Map(); cache.set(data, m); }
  const hit = m.get(key);
  if (hit) return hit;
  const r = howTo(req, data, live, from ? { from } : undefined);
  if (m.size >= CACHE_LIMIT) m.clear();
  m.set(key, r);
  return r;
}

const OPAQUE_TEXT: Record<"plugin" | "script" | "noWriter", string> = {
  noWriter: "여기서부터는 데이터로 알 수 없어요 (바꾸는 곳 없음 — 플러그인이나 스크립트일 수 있어요)",
  script: "여기서부터는 데이터로 알 수 없어요 (스크립트)",
  plugin: "여기서부터는 데이터로 알 수 없어요 (플러그인 명령)",
};

function StepLine({ step }: { step: HowToStep }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <Button variant="link" size="sm" className="h-auto p-0" onClick={() => openPage(step.location)}>{step.where}</Button>
      <span>{step.action}</span>
      {step.choiceLabel !== undefined && <Badge variant="outline">선택지 “{step.choiceLabel}” 골랐을 때</Badge>}
      {step.availableNow && <Badge>지금 할 수 있음</Badge>}
      {step.repeatNeeded && <Badge variant="secondary">반복 필요</Badge>}
    </div>
  );
}

const candKey = (s: HowToStep) => `${s.writer.ctx}:${s.writer.at ? `${locationKey(s.writer.at)}:` : ""}${s.writer.cmd}`;

function Fork({ end }: { end: Extract<HowToEnd, { kind: "fork" }> }) {
  // 후보 순서는 live가 바뀌면 달라질 수 있어, 고른 후보를 위치가 아니라 쓰는 곳(문맥 + 명령)으로 기억한다.
  const [picked, setPicked] = useState<string | null>(null);
  const cand = picked !== null ? end.candidates.find(s => candKey(s) === picked) : undefined;
  return (
    <div className="space-y-2">
      <p className="text-muted-foreground">먼저 아래 중 한 곳에서 만들어야 해요. 골라서 이어 보세요.</p>
      <div className="flex flex-wrap gap-2">
        {end.candidates.map((s) => (
          <Button
            key={candKey(s)}
            variant={picked === candKey(s) ? "secondary" : "outline"}
            size="sm"
            className="h-auto whitespace-normal py-1 text-left"
            onClick={() => setPicked(picked === candKey(s) ? null : candKey(s))}
          >
            {s.where} · {s.action}{s.availableNow ? " (지금 할 수 있음)" : ""}
          </Button>
        ))}
        {end.more > 0 && <span className="self-center text-muted-foreground">외 {end.more}곳</span>}
      </div>
      {cand && (
        <div className="border-l-2 pl-3">
          <HowToView req={end.req} from={cand.writer} />
        </div>
      )}
    </div>
  );
}

function EndBlock({ end }: { end: HowToEnd }) {
  switch (end.kind) {
    case "done": return null;
    case "fork": return <Fork end={end} />;
    case "opaque": return <p className="text-muted-foreground">{OPAQUE_TEXT[end.reason]}</p>;
    case "depthLimit": return <p className="text-muted-foreground">너무 길어서 여기까지만 보여줘요</p>;
    case "cycle": return <p className="text-muted-foreground">서로 맞물린 조건이라 여기서 멈춰요</p>;
  }
}

/**
 * 조건 하나를 만드는 방법. 펼쳤을 때만 마운트되므로 그때 처음 계산한다.
 * 끝 상태(갈림길·알 수 없음 등)는 단계 1보다 먼저 풀어야 하는 것이라 목록 위에 보여준다.
 */
export function HowToView({ req, from }: { req: Req; from?: Writer }) {
  const { data } = useGame();
  const { live } = useLive();
  const condLive = useConditionsLive(live);
  const result = useMemo(
    () => (data && condLive ? cachedHowTo(req, data, condLive, from) : null),
    [req, data, condLive, from],
  );
  if (!result) return null;
  const { steps, end } = result;
  if (steps.length === 0 && end.kind === "done") return <p className="text-sm text-muted-foreground">이미 됐어요</p>;
  return (
    <div className="space-y-2 text-sm">
      <EndBlock end={end} />
      {steps.length > 0 && (
        <ol className="list-decimal space-y-1 pl-5">
          {steps.map((s, i) => <li key={`${s.writer.ctx}:${s.writer.cmd}:${i}`}><StepLine step={s} /></li>)}
        </ol>
      )}
    </div>
  );
}
