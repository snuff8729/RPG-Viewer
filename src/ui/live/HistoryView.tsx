import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useGame } from "@/app/GameProvider";
import { useLive } from "@/app/LiveProvider";
import { branchLabel, branchPath, foldTimeline } from "@/core/live/history";
import { locationKey, pageLocation } from "@/core/index/locations";
import { findNodePathByCmd } from "@/core/interpret/interpret";
import type { Location } from "@/core/types";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { openPage } from "../navigation";
import { highlightNode } from "../highlight";
import { ChoiceNowCard } from "./ChoiceNowCard";
import { NowNextCard } from "./NowNextCard";
import { TimelineItem, type TimelineCtx } from "./TimelineItem";
import { choiceTexts } from "./historyText";
import { loadAutoFollow, saveAutoFollow } from "./autoFollow";
import { ALL_KINDS, filterItems, loadKinds, saveKinds, type Kind } from "./historyFilter";

const PAGE = 500;
const KIND_LABELS: [Kind, string][] = [
  ["message", "대사"], ["choice", "선택"], ["picture", "그림"], ["transfer", "이동"],
  ["battle", "전투"], ["state", "상태 변경"], ["save", "저장·불러오기"],
];

/**
 * 내용 키가 같으면 이전 값을 그대로 돌려준다(렌더 중 상태 갱신 패턴).
 * 기록이 늘 때마다 새로 만들어지지만 내용은 거의 같은 값(갈래 모델·선택 문구)을 ctx에 넣기 위해 쓴다.
 */
function useStableByKey<T>(value: T, key: string): T {
  const [kept, setKept] = useState({ key, value });
  if (kept.key !== key) setKept({ key, value });
  return kept.key === key ? kept.value : value;
}

/** 기록 탭 — 회차·갈래·종류 선택, 스크롤되는 타임라인, 하단 고정 카드. */
export function HistoryView() {
  const { data, index } = useGame();
  const { records, model, noisy, uncertainSeqs, changedSeqs, latestBranch, connection, install } = useLive();
  const [picked, setPicked] = useState<number | null>(null);
  const [shown, setShown] = useState(PAGE);
  const [kinds, setKinds] = useState<Set<Kind>>(loadKinds);
  const selected = picked !== null && model.branches.has(picked) ? picked : latestBranch;
  const empty = records.length === 0 || selected === null;

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

  const choiceTextNow = useMemo(() => {
    if (!data || selected === null) return new Map<number, string>();
    return choiceTexts(path, data);
  }, [path, selected, data]);
  // 항목이 다시 그려지지 않도록 ctx에 넣는 값은 내용이 바뀔 때만 참조를 바꾼다.
  // 선택 문구: 내용 그대로면 이전 Map. 갈래 모델: 항목은 갈래 이름(branchLabel = runs 구성)만 쓴다.
  const choiceTextKey = useMemo(() => JSON.stringify([...choiceTextNow]), [choiceTextNow]);
  const choiceText = useStableByKey(choiceTextNow, choiceTextKey);
  const runsKey = useMemo(() => JSON.stringify(model.runs), [model]);
  const labelModel = useStableByKey(model, runsKey);

  const onJump = useCallback((src: Location, cmd: number) => {
    // TemplateEvent 원래 페이지 기록이면 그것을 부른 템플릿 페이지를 열고 그 안의 펼친 노드를 찾는다.
    const page = pageLocation(src);
    const key = locationKey(page);
    const entry = index?.pages.find(p => locationKey(p.location) === key);
    openPage(page);
    const path = entry ? findNodePathByCmd(entry.nodes, cmd, { base: entry.location, target: src }) : null;
    if (path) highlightNode(key, path);
  }, [index]);

  // 타임라인 영역이 바닥 근처(80px 이내)일 때만 새 기록에 맞춰 스크롤
  const scroller = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const [autoFollow, setAutoFollow] = useState(loadAutoFollow);
  const autoRef = useRef(autoFollow);
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
  // "이전 기록 더 보기"로 앞쪽에 항목이 붙어도 읽던 위치를 유지
  const anchor = useRef<{ h: number; top: number } | null>(null);
  const showMore = () => {
    const el = scroller.current;
    if (el) anchor.current = { h: el.scrollHeight, top: el.scrollTop };
    setShown(s => s + PAGE);
  };
  useLayoutEffect(() => {
    const el = scroller.current;
    const a = anchor.current;
    anchor.current = null;
    if (el && a) el.scrollTop = a.top + (el.scrollHeight - a.h);
  }, [shown]);
  // 하단 카드가 접히고 펼쳐져 영역 높이가 바뀌면 바닥 여부를 다시 판단
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (nearBottom.current || autoRef.current) el.scrollTop = el.scrollHeight;
      onScroll();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [onScroll]);
  useLayoutEffect(() => {
    const key = `${selected}|${[...kinds].join(",")}`;
    const grew = filtered.length - prevLen.current;
    const reset = key !== prevKey.current;
    prevKey.current = key;
    prevLen.current = filtered.length;
    if (reset || nearBottom.current || autoRef.current) scrollToBottom();
    else if (grew > 0) {
      setFresh(n => n + grew);
      // 읽는 중이면 보이는 창의 시작을 그대로 두도록 새 항목 수만큼 넓힌다(창이 밀리지 않게)
      setShown(s => s + grew);
    }
  }, [filtered.length, selected, kinds, scrollToBottom]);

  const onAutoFollow = (on: boolean) => {
    setAutoFollow(on);
    autoRef.current = on;
    saveAutoFollow(on);
    if (on) scrollToBottom();
  };

  const onKinds = (v: string[]) => {
    const next = new Set(ALL_KINDS.filter(k => v.includes(k)));
    setKinds(next);
    saveKinds(next);
    setShown(PAGE);
  };

  const onSelect = useCallback((id: number) => { setPicked(id); setShown(PAGE); }, []);
  const ctx = useMemo<TimelineCtx | null>(
    () => (empty || !data || selected === null ? null : { data, model: labelModel, selected, choiceText, onJump, onSelect }),
    [empty, data, labelModel, selected, choiceText, onJump, onSelect],
  );

  if (!data) return null;
  const installed = install?.state === "installed" && connection !== "noPlugin";
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
          <div className="flex items-center gap-2">
            <Switch id="history-auto-follow" checked={autoFollow} onCheckedChange={onAutoFollow} />
            <Label htmlFor="history-auto-follow">자동으로 맨 아래로</Label>
          </div>
        </div>
      )}
      <div className="relative min-h-0 flex-1">
        <div ref={scroller} onScroll={onScroll} className="h-full space-y-1 overflow-y-auto pr-1">
          {ctx ? (
            <>
              {visible.length < filtered.length && (
                <Button variant="outline" size="sm" onClick={showMore}>이전 기록 더 보기</Button>
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
