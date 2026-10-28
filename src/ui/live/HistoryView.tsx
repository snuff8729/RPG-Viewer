import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useGame } from "@/app/GameProvider";
import { useLive } from "@/app/LiveProvider";
import { branchLabel, branchPath, foldTimeline } from "@/core/live/history";
import { locationKey } from "@/core/index/locations";
import { findNodePathByCmd } from "@/core/interpret/interpret";
import type { Location } from "@/core/types";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { openPage } from "../navigation";
import { highlightNode } from "../highlight";
import { ChoiceNowCard } from "./ChoiceNowCard";
import { NowNextCard } from "./NowNextCard";
import { TimelineItem, type TimelineCtx } from "./TimelineItem";
import { choiceTexts } from "./historyText";

const PAGE = 500;

/** 기록 탭 — 회차·갈래 선택, 지금 선택지, 접힌 타임라인. */
export function HistoryView() {
  const { data, index } = useGame();
  const { records, model, noisy, uncertainSeqs, changedSeqs, latestBranch, connection, install } = useLive();
  const [picked, setPicked] = useState<number | null>(null);
  const [shown, setShown] = useState(PAGE);
  const selected = picked !== null && model.branches.has(picked) ? picked : latestBranch;

  // 경로는 한 번만 계산해 타임라인과 선택 문구가 함께 쓴다
  const path = useMemo(
    () => (selected === null ? [] : branchPath(records, model, selected)),
    [records, model, selected],
  );

  const items = useMemo(() => {
    if (selected === null) return [];
    return foldTimeline(path, model, { uncertainSeqs, changedSeqs, noisy });
  }, [path, selected, model, noisy, uncertainSeqs, changedSeqs]);

  const choiceText = useMemo(() => {
    if (!data || selected === null) return new Map<number, string>();
    return choiceTexts(path, data);
  }, [path, selected, data]);

  const onJump = useCallback((src: Location, cmd: number) => {
    const key = locationKey(src);
    const entry = index?.pages.find(p => locationKey(p.location) === key);
    openPage(src);
    const path = entry ? findNodePathByCmd(entry.nodes, cmd) : null;
    if (path) highlightNode(key, path);
  }, [index]);

  // 맨 아래 근처에 있을 때만 새 기록에 맞춰 스크롤
  const bottom = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  useEffect(() => {
    const check = () => {
      const el = bottom.current;
      if (el) nearBottom.current = el.getBoundingClientRect().top < window.innerHeight + 150;
    };
    document.addEventListener("scroll", check, true);
    return () => document.removeEventListener("scroll", check, true);
  }, []);
  useLayoutEffect(() => {
    if (nearBottom.current) bottom.current?.scrollIntoView({ block: "end" });
  }, [items.length]);

  if (!data) return null;
  if (records.length === 0 || selected === null) {
    const installed = install?.state === "installed" && connection !== "noPlugin";
    return (
      <div className="space-y-4">
        <NowNextCard />
        <ChoiceNowCard />
        <p className="text-sm text-muted-foreground">
          {installed ? "게임을 실행해 새 게임을 시작하거나 세이브를 불러오세요" : "플러그인을 설치하면 플레이 기록이 여기에 쌓여요"}
        </p>
      </div>
    );
  }

  const ctx: TimelineCtx = {
    data, model, selected, choiceText, onJump,
    onSelect: (id) => { setPicked(id); setShown(PAGE); },
  };
  const visible = items.slice(Math.max(0, items.length - shown));

  return (
    <div className="space-y-4">
      <Select value={String(selected)} onValueChange={(v) => { setPicked(Number(v)); setShown(PAGE); }}>
        <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
        <SelectContent>
          {model.runs.map(run => (
            <SelectGroup key={run.run}>
              <SelectLabel>{run.run}회차</SelectLabel>
              {run.branches.map(id => <SelectItem key={id} value={String(id)}>{branchLabel(model, id)}</SelectItem>)}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
      <NowNextCard />
      <ChoiceNowCard />
      <div className="space-y-1">
        {visible.length < items.length && (
          <Button variant="outline" size="sm" onClick={() => setShown(s => s + PAGE)}>이전 기록 더 보기</Button>
        )}
        {visible.map((item, i) => <TimelineItem key={`${items.length - visible.length + i}`} item={item} ctx={ctx} />)}
        <div ref={bottom} />
      </div>
    </div>
  );
}
