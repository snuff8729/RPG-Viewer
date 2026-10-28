import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useGame } from "@/app/GameProvider";
import { useLive } from "@/app/LiveProvider";
import { branchPath, foldTimeline } from "@/core/live/history";
import { lastSeqOf, readerItems, type ReaderItem } from "@/core/live/reader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { FaceImage } from "../script/FaceImage";
import { useAssetUrl } from "../script/useAssetUrl";
import { ChoiceNowCard } from "./ChoiceNowCard";
import { NowNextCard } from "./NowNextCard";
import { choiceTexts } from "./historyText";
import { initialReadSeq, saveReadSeq } from "./readPosition";
import { initialWindow, readStats } from "./readerWindow";

const PAGE = 300;

function MessageLines({ item }: { item: Extract<ReaderItem, { kind: "message" }> }) {
  return (
    <div className="flex gap-3">
      {item.face && <FaceImage name={item.face} index={item.faceIndex} />}
      <div className="min-w-0 flex-1 space-y-0.5">
        {item.speaker && <p className="text-sm font-medium text-muted-foreground">{item.speaker}</p>}
        {item.lines.map((l, i) => <p key={i} className="whitespace-pre-wrap break-words">{l || " "}</p>)}
      </div>
    </div>
  );
}

function Picture({ name }: { name: string }) {
  const url = useAssetUrl("pictures", name);
  if (url === undefined) return <Skeleton className="h-40 w-full" />;
  if (!url) return <p className="text-center text-sm text-muted-foreground">{name}</p>;
  return <img src={url} alt={name} title={name} loading="lazy" decoding="async" className="max-h-[60vh] w-full object-contain" />;
}

const Item = memo(function Item({ item }: { item: ReaderItem }) {
  switch (item.kind) {
    case "chapter":
      return <p className="py-2 text-center text-sm text-muted-foreground">{item.text}</p>;
    case "message":
      if (item.repeat !== undefined) {
        return (
          <Collapsible>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="text-muted-foreground">↻ 같은 대화 다시 봄 ×{item.repeat}</Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-1 text-muted-foreground"><MessageLines item={item} /></CollapsibleContent>
          </Collapsible>
        );
      }
      return <MessageLines item={item} />;
    case "scroll":
      return (
        <div className="space-y-0.5 text-center">
          {item.lines.map((l, i) => <p key={i} className="whitespace-pre-wrap break-words">{l || " "}</p>)}
        </div>
      );
    case "picture":
      return <Picture name={item.name} />;
    case "choice":
      return <p className="font-medium">▶ 고른 것: "{item.label}"</p>;
    case "battle":
      return <p className="text-center text-sm text-muted-foreground">⚔ 전투</p>;
  }
}, (a, b) => a.item === b.item || JSON.stringify(a.item) === JSON.stringify(b.item));

/** 입력 중이거나 목록·대화상자 안에 포커스가 있으면 Space/↓를 가로채지 않는다. */
function typingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable) return true;
  const tag = t.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return t.closest("[role=dialog],[role=listbox],[role=menu],[contenteditable=true]") !== null;
}

/** 읽기 탭 — 최신 갈래에서 실제로 지나간 대사·그림·고른 선택을 소설처럼 순서대로. */
export function ReaderView() {
  const { data } = useGame();
  const { records, model, noisy, uncertainSeqs, changedSeqs, latestBranch, live } = useLive();
  const branch = latestBranch;
  const gameKey = data ? `${data.system.gameTitle}|${data.dataRoot}` : "";
  const posKey = `${gameKey}.${branch}`;

  const path = useMemo(() => (branch === null ? [] : branchPath(records, model, branch)), [records, model, branch]);
  const items = useMemo(() => {
    if (!data || branch === null) return [];
    const folded = foldTimeline(path, model, { uncertainSeqs, changedSeqs, noisy });
    return readerItems(folded, data, choiceTexts(path, data), model);
  }, [data, branch, path, model, noisy, uncertainSeqs, changedSeqs]);

  // 읽은 위치: 갈래가 바뀌면 저장소(+조상 갈래)에서 다시 읽는다
  const [pos, setPos] = useState(() => ({ key: posKey, seq: branch === null ? -1 : initialReadSeq(gameKey, branch, path) }));
  let readSeq = pos.seq;
  if (pos.key !== posKey) {
    readSeq = branch === null ? -1 : initialReadSeq(gameKey, branch, path);
    setPos({ key: posKey, seq: readSeq });
  }
  const markRead = useCallback((seq: number) => {
    setPos(p => (p.key === posKey && seq > p.seq ? { key: p.key, seq } : p));
  }, [posKey]);
  useEffect(() => {
    if (branch !== null && pos.key === posKey && pos.seq >= 0) saveReadSeq(gameKey, branch, pos.seq);
  }, [pos, posKey, gameKey, branch]);

  // 마지막으로 읽은 항목 위치와 그 뒤 새 대사 수(↻ 다시 본 대화는 세지 않는다)
  const stats = useMemo(() => readStats(items, readSeq), [items, readSeq]);
  const { lastReadIdx, firstUnreadIdx, unread } = stats;

  // 그리는 창(뒤에서부터 shown개)과 처음 위치. 갈래마다 처음 한 번 정한다(readerWindow.initialWindow).
  // armed가 false면 사용자가 스크롤하거나 다음을 누르기 전까지 읽음 표시를 하지 않는다.
  const [win, setWin] = useState<{ key: string | null; shown: number; at: "bottom" | "item" | "top"; armed: boolean }>(
    { key: null, shown: PAGE, at: "bottom", armed: true },
  );
  let curWin = win;
  if (items.length > 0 && win.key !== posKey) {
    curWin = { key: posKey, ...initialWindow(items.length, stats, readSeq, PAGE) };
    setWin(curWin);
  }
  const shown = curWin.shown;
  const armed = curWin.armed;
  const arm = useCallback(() => setWin(w => (w.armed ? w : { ...w, armed: true })), []);
  const start = Math.max(0, items.length - shown);
  const visible = items.slice(start);

  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  /** 맨 아래 + 다 읽은 상태 — 새 항목이 오면 따라간다 */
  const follow = useRef(true);
  const positioned = useRef<string | null>(null);
  const prevLen = useRef(0);

  const scrollToBottom = useCallback(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
    nearBottom.current = true;
    setAtBottom(true);
  }, []);
  const onScroll = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight <= 80;
    nearBottom.current = near;
    setAtBottom(near);
  }, []);
  /** 항목을 읽기 영역 위쪽으로. 그 항목이 없으면 false */
  const scrollToKey = useCallback((key: string): boolean => {
    const el = scroller.current;
    const target = el?.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`);
    if (!el || !target) return false;
    el.scrollTop += target.getBoundingClientRect().top - el.getBoundingClientRect().top - 8;
    onScroll();
    return true;
  }, [onScroll]);
  /** idx 항목 바로 앞이 장면 구분이면 그것부터 보이게 */
  const keyFrom = useCallback((idx: number) => (idx > 0 && items[idx - 1].kind === "chapter" ? items[idx - 1].key : items[idx].key), [items]);

  // 갈래마다 처음 한 번 읽던 위치로, 그 뒤엔 다 읽고 맨 아래일 때만 새 항목을 따라간다
  useLayoutEffect(() => {
    if (items.length === 0 || win.key !== posKey) return;
    const grew = items.length - prevLen.current;
    prevLen.current = items.length;
    if (positioned.current !== posKey) {
      positioned.current = posKey;
      // 다 읽었으면 맨 아래, 읽던 곳이 있으면 첫 안 읽은 항목, 처음 읽으면 창의 맨 위
      if (win.at === "bottom") scrollToBottom();
      else if (win.at === "item" && firstUnreadIdx >= start) scrollToKey(keyFrom(firstUnreadIdx));
      else { const el = scroller.current; if (el) el.scrollTop = 0; onScroll(); }
      return;
    }
    if (grew <= 0) return;
    // follow.current는 아래 레이아웃 효과가 "직전 커밋"의 상태(맨 아래 + 새 대사 0)로 맞춰 둔 값이다.
    // 이 효과가 먼저 선언돼 먼저 실행되므로, 여기서 읽는 값은 새 항목이 들어오기 전의 따라가기 여부다.
    // (순서를 바꾸면 새 항목 때문에 unread > 0이 되어 따라가기가 항상 꺼진다.)
    if (follow.current) scrollToBottom();
    // 읽는 중이면 보이는 창의 시작을 그대로 둔다(창이 밀리지 않게)
    else setWin(w => ({ ...w, shown: w.shown + grew }));
  }, [items.length, win.key, win.at, posKey, firstUnreadIdx, start, keyFrom, scrollToKey, scrollToBottom, onScroll]);
  // 반드시 위 효과 뒤에 둔다(위 주석 참고)
  useLayoutEffect(() => {
    follow.current = atBottom && unread === 0;
  }, [atBottom, unread]);

  // "이전 대사 더 보기"로 앞쪽에 항목이 붙어도 읽던 위치를 유지
  const anchor = useRef<{ h: number; top: number } | null>(null);
  /** 창을 넓힌 뒤 위로 올릴 항목(다음 버튼이 창 밖 항목을 가리킬 때) */
  const pendingKey = useRef<string | null>(null);
  const showMore = () => {
    const el = scroller.current;
    if (el) anchor.current = { h: el.scrollHeight, top: el.scrollTop };
    setWin(w => ({ ...w, shown: w.shown + PAGE }));
  };
  useLayoutEffect(() => {
    const el = scroller.current;
    const a = anchor.current;
    anchor.current = null;
    if (el && a) el.scrollTop = a.top + (el.scrollHeight - a.h);
    const k = pendingKey.current;
    pendingKey.current = null;
    if (k) scrollToKey(k);
  }, [win.shown, scrollToKey]);

  // 영역 크기나 내용 높이(그림 로딩·카드 펼침)가 바뀌면, 따라가는 중일 때만 아래에 붙인다
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (follow.current) el.scrollTop = el.scrollHeight;
      onScroll();
    });
    ro.observe(el);
    if (content.current) ro.observe(content.current);
    return () => ro.disconnect();
  }, [onScroll]);

  // 읽음 표시: 항목의 아래 끝이 읽기 영역 아래 끝 위로 올라오면 읽은 것
  const visibleKeys = visible.map(it => it.key).join(",");
  useEffect(() => {
    const el = scroller.current;
    if (!el || !armed || typeof IntersectionObserver === "undefined" || positioned.current !== posKey) return;
    const io = new IntersectionObserver(entries => {
      let max = -1;
      for (const e of entries) {
        const root = e.rootBounds ?? el.getBoundingClientRect();
        if (e.boundingClientRect.bottom <= root.bottom + 1) {
          const s = Number((e.target as HTMLElement).dataset.seq);
          if (Number.isInteger(s) && s > max) max = s;
        }
      }
      if (max >= 0) markRead(max);
    }, { root: el, threshold: [0, 0.5, 1] });
    el.querySelectorAll("[data-seq]").forEach(n => io.observe(n));
    return () => io.disconnect();
  }, [visibleKeys, posKey, armed, markRead]);

  /** 다음 안 읽은 항목을 위로 올리고 그 앞까지 읽음 처리 */
  const next = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    arm();
    let idx = firstUnreadIdx;
    const rectOf = (key: string) => {
      const t = el.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`);
      if (!t) return null;
      const r = t.getBoundingClientRect(), v = el.getBoundingClientRect();
      return { top: r.top - v.top, bottom: r.bottom - v.top };
    };
    // 이미 맨 위에 올라와 있는 항목: 화면보다 길어 끝이 아직 아래에 있으면 한 화면(90%)씩 내리고,
    // 끝까지 보였으면 그 항목도 읽고 다음으로
    while (idx >= 0) {
      const head = rectOf(keyFrom(idx));
      if (head === null || head.top > 16) break;
      const own = rectOf(items[idx].key);
      if (own && own.bottom > el.clientHeight + 1) {
        el.scrollTop += Math.min(el.clientHeight * 0.9, own.bottom - el.clientHeight + 8);
        onScroll();
        return;
      }
      const s = lastSeqOf(items[idx]);
      if (s !== null) markRead(s);
      let n = -1;
      for (let j = idx + 1; j < items.length; j++) if (lastSeqOf(items[j]) !== null) { n = j; break; }
      idx = n;
    }
    if (idx < 0) { scrollToBottom(); return; }
    for (let j = idx - 1; j >= 0; j--) {
      const s = lastSeqOf(items[j]);
      if (s !== null) { markRead(s); break; }
    }
    if (idx < start) {
      pendingKey.current = keyFrom(idx);
      setWin(w => ({ ...w, shown: items.length - idx + 5 }));
    } else scrollToKey(keyFrom(idx));
  }, [firstUnreadIdx, items, start, keyFrom, arm, markRead, scrollToKey, scrollToBottom, onScroll]);

  useEffect(() => {
    let spaceDown = false;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.isComposing) return;
      if (e.key !== " " && e.key !== "ArrowDown") return;
      if (typingTarget(e.target)) return;
      e.preventDefault();
      if (e.key === " ") spaceDown = true;
      next();
    };
    // 버튼에 포커스가 있으면 Space를 뗄 때 그 버튼이 눌리므로 막는다
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === " " && spaceDown) { spaceDown = false; e.preventDefault(); }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("keyup", onKeyUp); };
  }, [next]);

  if (!data) return null;
  const empty = items.length === 0 && !live?.choice;

  return (
    // 헤더(h-12) + main 위아래 패딩(p-4)을 뺀 높이
    <div className="flex h-[calc(100svh-5rem)] flex-col gap-3">
      <div ref={scroller} onScroll={onScroll} onWheel={arm} onTouchMove={arm} onPointerDown={arm} onKeyDown={arm} className="min-h-0 flex-1 overflow-y-auto">
        <div ref={content} className="mx-auto max-w-2xl space-y-4 px-2 py-4 text-base leading-relaxed">
          {empty ? (
            <p className="text-center text-sm text-muted-foreground">게임을 진행하면 지나간 대사가 여기에 쌓여요</p>
          ) : (
            <>
              {start > 0 && (
                <div className="flex justify-center">
                  <Button variant="outline" size="sm" onClick={showMore}>이전 대사 더 보기</Button>
                </div>
              )}
              {visible.map((item, i) => {
                const seq = lastSeqOf(item);
                return (
                  <div key={item.key}>
                    <div data-key={item.key} data-seq={seq ?? undefined}><Item item={item} /></div>
                    {start + i === lastReadIdx && unread > 0 && (
                      <div className="mt-4 flex items-center gap-3 text-xs text-muted-foreground">
                        <Separator className="flex-1" />
                        <span className="shrink-0">여기까지 읽음 · 새 대사 {unread}</span>
                        <Separator className="flex-1" />
                      </div>
                    )}
                  </div>
                );
              })}
              <ChoiceNowCard />
              {live?.running && (
                <Collapsible>
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="sm" className="text-muted-foreground">다음에 나올 대사</Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="pt-2"><NowNextCard /></CollapsibleContent>
                </Collapsible>
              )}
            </>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center justify-center gap-2">
        <Button size="sm" onClick={next} disabled={items.length === 0}>↓ 다음 (Space)</Button>
        <Button variant="outline" size="sm" onClick={() => { arm(); scrollToBottom(); }} disabled={atBottom}>맨 아래로</Button>
        {unread > 0 && <Badge variant="secondary">새 대사 {unread}</Badge>}
      </div>
    </div>
  );
}
