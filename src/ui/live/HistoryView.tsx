import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useGame } from "@/app/GameProvider";
import { useLive } from "@/app/LiveProvider";
import { branchLabel, branchPath, foldTimeline } from "@/core/live/history";
import { locationKey } from "@/core/index/locations";
import { findNodePathByCmd } from "@/core/interpret/interpret";
import type { Location } from "@/core/types";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { openPage } from "../navigation";
import { highlightNode } from "../highlight";
import { ChoiceNowCard } from "./ChoiceNowCard";
import { NowNextCard } from "./NowNextCard";
import { TimelineItem, type TimelineCtx } from "./TimelineItem";
import { choiceTexts } from "./historyText";
import { ALL_KINDS, filterItems, loadKinds, saveKinds, type Kind } from "./historyFilter";

const PAGE = 500;
const KIND_LABELS: [Kind, string][] = [
  ["message", "대사"], ["choice", "선택"], ["picture", "그림"], ["transfer", "이동"],
  ["battle", "전투"], ["state", "상태 변경"], ["save", "저장·불러오기"],
];

/** 기록 탭 — 회차·갈래·종류 선택, 스크롤되는 타임라인, 하단 고정 카드. */
export function HistoryView() {
  const { data, index } = useGame();
  const { records, model, noisy, uncertainSeqs, changedSeqs, latestBranch, connection, install } = useLive();
  const [picked, setPicked] = useState<number | null>(null);
  const [shown, setShown] = useState(PAGE);
  const [kinds, setKinds] = useState<Set<Kind>>(loadKinds);
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

  const filtered = useMemo(() => filterItems(items, kinds), [items, kinds]);

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

  // 타임라인 영역이 바닥 근처(80px 이내)일 때만 새 기록에 맞춰 스크롤
  const scroller = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  const [fresh, setFresh] = useState(0);
  const prevLen = useRef(0);
  const prevKey = useRef("");
  const scrollToBottom = useCallback(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
    nearBottom.current = true;
    setAtBottom(true);
    setFresh(0);
  }, []);
  const onScroll = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight <= 80;
    nearBottom.current = near;
    setAtBottom(near);
    if (near) setFresh(0);
  }, []);
  useLayoutEffect(() => {
    const key = `${selected}|${[...kinds].join(",")}`;
    const grew = filtered.length - prevLen.current;
    const reset = key !== prevKey.current;
    prevKey.current = key;
    prevLen.current = filtered.length;
    if (reset || nearBottom.current) scrollToBottom();
    else if (grew > 0) setFresh(n => n + grew);
  }, [filtered.length, selected, kinds, scrollToBottom]);

  const onKinds = (v: string[]) => {
    const next = new Set(ALL_KINDS.filter(k => v.includes(k)));
    setKinds(next);
    saveKinds(next);
    setShown(PAGE);
  };

  if (!data) return null;
  const empty = records.length === 0 || selected === null;
  const installed = install?.state === "installed" && connection !== "noPlugin";
  const ctx: TimelineCtx | null = empty ? null : {
    data, model, selected, choiceText, onJump,
    onSelect: (id) => { setPicked(id); setShown(PAGE); },
  };
  const visible = filtered.slice(Math.max(0, filtered.length - shown));

  return (
    // 헤더(h-12) + main 위아래 패딩(p-4)을 뺀 높이
    <div className="flex h-[calc(100svh-5rem)] flex-col gap-3">
      {!empty && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
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
          <ToggleGroup type="multiple" variant="outline" size="sm" value={[...kinds]} onValueChange={onKinds}>
            {KIND_LABELS.map(([k, label]) => <ToggleGroupItem key={k} value={k}>{label}</ToggleGroupItem>)}
          </ToggleGroup>
        </div>
      )}
      <div className="relative min-h-0 flex-1">
        <div ref={scroller} onScroll={onScroll} className="h-full space-y-1 overflow-y-auto pr-1">
          {ctx ? (
            <>
              {visible.length < filtered.length && (
                <Button variant="outline" size="sm" onClick={() => setShown(s => s + PAGE)}>이전 기록 더 보기</Button>
              )}
              {visible.map((item, i) => <TimelineItem key={`${filtered.length - visible.length + i}`} item={item} ctx={ctx} />)}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              {installed ? "게임을 실행해 새 게임을 시작하거나 세이브를 불러오세요" : "플러그인을 설치하면 플레이 기록이 여기에 쌓여요"}
            </p>
          )}
        </div>
        {!atBottom && (
          <Button size="sm" className="absolute right-4 bottom-3 shadow-md" onClick={scrollToBottom}>
            {fresh > 0 ? `최신으로 · 새 ${fresh}` : "최신으로"}
          </Button>
        )}
      </div>
      <div className="max-h-[50%] shrink-0 space-y-2 overflow-y-auto empty:hidden">
        <NowNextCard />
        <ChoiceNowCard />
      </div>
    </div>
  );
}
