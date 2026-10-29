import { type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLive, useLiveData } from "@/app/LiveProvider";
import { useAddons } from "@/app/AddonsProvider";
import { usePictureContext } from "../addons/pictureContext";
import { useScreenPicturesShown } from "../addons/screenDisplay";
import { branchLabel, representative } from "@/core/live/history";
import { BranchPathCache, MenuFilterCache, PathFactsCache, ScenesCache } from "@/core/live/readerPath";
import { lastSeqOf, ReaderItemsBuilder, type ReaderItem } from "@/core/live/reader";
import { firstSeqOf, hasSeq, indexOfSeq, itemSummary } from "@/core/live/readerNav";
import { ChaptersCache, partIndexAt, partTitle } from "@/core/live/chapters";
import { ReaderDisplayCache, type DisplayConfig } from "@/core/live/readerDisplay";
import type { Bookmark } from "@/core/live/readerFile";
import { menuCommonEventsOf } from "@/core/live/menuScenes";
import { useReaderFile } from "@/app/ReaderFileProvider";
import { ChevronsDown, Info, ListTree, Settings2, X } from "lucide-react";
import { ReaderPosition, ReaderTocShell, TocBookmarks, TocChapterVar, TocJumps, TocParts, type BookmarkRow } from "./ReaderToc";
import { ReaderLineMenu, type LineAction } from "./ReaderLineMenu";
import { openGameSettings } from "../addons/gameSettingsOpen";
import { dismissLayeredHint, layeredHintDismissed } from "./layeredHint";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { BranchPicker } from "./BranchPicker";
import { ChoiceFlowView } from "./ChoiceFlowView";
import { ChoiceNowCard } from "./ChoiceNowCard";
import { NowNextCard } from "./NowNextCard";
import { ChoiceTextsCache } from "./historyText";
import { gameKeyOf, initialReadSeq, saveReadSeq } from "./readPosition";
import {
  extendDown, extendUp, grownRange, initialView, rangeShowing, readStats, sameRange, tailRange, trimToTail,
  type InitialView, type ReadRange, type ReadStats,
} from "./readerWindow";
import { ReaderItemView } from "./ReaderItemView";
import { loadAutoFollow, saveAutoFollow } from "./autoFollow";
import { usePluginOverrides, usePluginShowAll } from "./pluginDisplay";
import { useBattlesShown } from "./battleDisplay";
import { useHiddenNoticeKinds, useNoticesShown } from "./noticeDisplay";
import { NoticeKindsMenu } from "./NoticeKindsMenu";
import { isReaderMode, loadReaderMode, saveReaderMode, type ReaderMode } from "./readerMode";
import { isRemoteView } from "@/app/share";
import { cn } from "@/lib/utils";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";

const PAGE = 300;
const EMPTY_RANGE: ReadRange = { start: 0, end: 0 };
const EMPTY_IDS: number[] = [];

/** 입력 중이거나 목록·대화상자 안에 포커스가 있으면 Space/↓를 가로채지 않는다. */
function typingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable) return true;
  const tag = t.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return t.closest("[role=dialog],[role=listbox],[role=menu],[contenteditable=true]") !== null;
}

/** 구간이 바뀐 뒤(다음 커밋) 할 스크롤 */
type AfterRange = { kind: "anchor"; h: number; top: number } | { kind: "key"; key: string } | { kind: "bottom" };

/** 그리는 구간과 처음 위치(갈래마다 처음 한 번 initialView로 정한다). total은 구간을 맞춰 둔 항목 수. */
type View = InitialView & { total: number };

/** 뷰어 창에 포커스가 있는가(게임 창에서 넘기는 중이면 false). */
function hasFocus(): boolean {
  try { return typeof document === "undefined" || document.hasFocus(); } catch { return true; }
}

/**
 * 항목이 처음 생기면 initialView(포커스가 없으면 다 읽은 경우도 사용자 동작 전까지 읽음 표시 안 함),
 * 항목 수가 바뀌면 grownRange. 바뀔 게 없으면 v 그대로.
 */
function syncView(v: View | null, total: number, stats: ReadStats, readSeq: number): View | null {
  if (v === null) {
    if (total === 0) return null;
    const iv = initialView(total, stats, readSeq, PAGE);
    return { total, ...iv, armed: iv.armed && hasFocus() };
  }
  if (v.total === total) return v;
  return { ...v, total, range: grownRange(v.range, v.total, total, PAGE) };
}

/**
 * 전체 읽기 — 고른 갈래에서 실제로 지나간 대사·그림·고른 선택을 소설처럼 순서대로(읽은 위치는 갈래별).
 * 기록을 끝까지 한 번 읽기 전(caughtUp 전)에는 경로가 앞부분뿐이라 읽은 위치·구간을 정하지 않고 로딩만 보여준다.
 * 갈래·게임·기록 초기화(logEpoch)가 바뀌면 본문을 새로 마운트해 읽은 위치·구간·대기 중 스크롤을 모두 처음부터 정한다.
 */
/** 읽기 본문 공용 설정: 자동으로 맨 아래로(ReaderView가 갖고, 휴대폰에서는 보기 설정 서랍에서 바꾼다)와 휴대폰 배치 */
interface BodyOpts {
  autoFollow: boolean;
  onAutoFollow: (on: boolean) => void;
  /** 본문이 걸어 두는 손잡이: 자동으로 맨 아래로를 켠 순간 맨 아래로(떼면 null) */
  onFollowOn: (fn: (() => void) | null) => void;
  mobile: boolean;
  /** 다른 갈래의 북마크로 갈 때: 그 갈래로 바꾸고 jump로 그 줄을 알려 준다 */
  onJumpBranch: (branch: number, seq: number) => void;
  /** 갈래를 바꾼 뒤 갈 줄(그 갈래 본문이 처음 그려진 뒤 한 번) */
  jump: PendingJump | null;
  /** jump를 썼다(다시 이 갈래를 열 때 또 가지 않게) */
  onJumpDone: (n: number) => void;
}

/** 갈래를 바꾼 뒤 갈 줄. n은 같은 줄로 다시 가도 새 요청이 되게 하는 번호 */
interface PendingJump { branch: number; seq: number; n: number }

function FullReader({ branch, withLive, ...opts }: { branch: number | null; withLive: boolean } & BodyOpts) {
  const data = useLiveData();
  const { caughtUp, logEpoch } = useLive();
  if (!data) return null;
  if (!caughtUp) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-2 py-4" aria-busy="true">
        <p className="text-center text-sm text-muted-foreground">기록을 읽는 중이에요</p>
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="h-5 w-full" />
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-5 w-5/6" />
      </div>
    );
  }
  const gameKey = gameKeyOf(data);
  return <FullReaderBody key={`${gameKey}.${branch}.${logEpoch}`} gameKey={gameKey} branch={branch} withLive={withLive} {...opts} />;
}

/** withLive(최신 갈래)일 때만 끝에 지금 선택지·다음 대사 카드를 붙인다. */
function FullReaderBody({ gameKey, branch, withLive, autoFollow, onAutoFollow, onFollowOn, mobile, onJumpBranch, jump, onJumpDone }: { gameKey: string; branch: number | null; withLive: boolean } & BodyOpts) {
  const data = useLiveData();
  const { records, model, noisy, uncertainSeqs, changedSeqs, live: liveNow } = useLive();
  const readerFile = useReaderFile();
  const live = withLive ? liveNow : null;

  // 메뉴 화면 그림 기록(예전 기록)은 어댑터의 `메뉴 화면 그림도 기록`을 켰을 때만
  const { menuPicturesShown } = useAddons();
  const menuEvents = useMemo(() => menuCommonEventsOf(data?.menuCommonEvents, data?.commonEvents, data?.afterMenuCommonEvent), [data]);
  // 기록 전체를 훑는 것(갈래 경로·메뉴 그림 빼기·대사별 그림·선택 문구 등)은 새로 붙은 기록만으로 이어 만든다(core/live/readerPath)
  const [caches] = useState(() => ({
    branchPath: new BranchPathCache(), menu: new MenuFilterCache(), facts: new PathFactsCache(), scenes: new ScenesCache(), choices: new ChoiceTextsCache(),
    chapters: new ChaptersCache(), display: new ReaderDisplayCache(),
  }));
  const path = useMemo(
    () => (branch === null ? [] : caches.menu.get(caches.branchPath.get(records, model, branch), menuPicturesShown, menuEvents)),
    [caches, records, model, branch, menuPicturesShown, menuEvents],
  );
  const facts = useMemo(() => (data ? caches.facts.get(path, data) : null), [caches, path, data]);
  const { overrides } = usePluginOverrides();
  const [showAllPlugins] = usePluginShowAll();
  const [battlesShown] = useBattlesShown();
  const [noticesShown] = useNoticesShown();
  const [hiddenNoticeKinds] = useHiddenNoticeKinds();
  // 화면 그림 따라 그리기(이 게임에서 켰을 때만): 대사마다 그때 화면 그림
  const picturesOn = useAddons().isOn("screenPictures");
  const [screenShown, setScreenShown] = useScreenPicturesShown();
  // 그림 표시 명령 기록이 있으면(그림 따라 그리기가 꺼졌어도) 그림 명령으로 화면을 다시 쌓아 보인다
  const hasPictureRecords = facts?.hasPictureRecords ?? false;
  const pictureCtx = usePictureContext(records, picturesOn, hasPictureRecords);
  // 대사마다 보이는 이벤트 그림·스탠딩(화면 장식·숨김·가려진 그림 제외)
  const factsPictures = facts?.pictures ?? null;
  const pictures = useMemo(
    () => (picturesOn && pictureCtx && factsPictures ? caches.scenes.get(factsPictures, pictureCtx) : null),
    [caches, picturesOn, pictureCtx, factsPictures],
  );
  // 변수로 정한 그림 위치: 지금 게임의 같은 갈래 기록이면 지금 변수 값으로.
  // 그 그림 명령이 읽는 변수가 바뀔 때만 다시 만든다(다른 변수는 매초 바뀌어도 항목 전체를 다시 만들지 않는다).
  const liveBranch = liveNow?.branch ?? null;
  const varIds = facts?.varIds ?? EMPTY_IDS;
  const varsKey = liveNow && varIds.length > 0
    ? JSON.stringify(Object.fromEntries(varIds.map((id) => [String(id), liveNow.variables?.[String(id)]])))
    : "";
  const vars = useMemo(() => {
    if (liveBranch === null || !varsKey) return null;
    try { return { branch: liveBranch, values: JSON.parse(varsKey) as Record<string, number> }; } catch { return null; }
  }, [liveBranch, varsKey]);
  // 기록이 갈래 끝에 덧붙기만 했으면(보통) 앞에서 만든 항목을 두고 새 기록만 더 만든다(이어 만들기).
  // 갈래·설정·앞의 기록이 바뀌면 처음부터. 결과는 처음부터 만든 것과 언제나 같다.
  const [builder] = useState(() => new ReaderItemsBuilder());
  const built = useMemo(() => {
    if (!data || branch === null) return [];
    return builder.build(path, model, { uncertainSeqs, changedSeqs, noisy, isHiddenImage: pictureCtx?.hidden ?? null }, data, caches.choices.get(path, data), overrides, pictures, {
      battles: battlesShown, notices: noticesShown, hiddenNoticeKinds, compose: { ctx: pictureCtx, vars },
    });
  }, [builder, caches, data, branch, path, model, noisy, uncertainSeqs, changedSeqs, overrides, pictures, battlesShown, noticesShown, hiddenNoticeKinds, pictureCtx, vars]);
  // 자동 목차(플레이 묶음·장면, 또는 고른 날짜·진행 변수): 새 기록만 이어 계산한다(core/live/chapters)
  const { chapterVar } = readerFile;
  const chapters = useMemo(() => caches.chapters.get(path, chapterVar), [caches, path, chapterVar]);
  const { heads, varId } = chapters;
  const displayHeads = useMemo(() => heads.map((h) => ({
    seq: h.seq, item: { kind: "chapter", key: `p${h.seq}`, text: partTitle(h, varId, data), part: true } as ReaderItem,
  })), [heads, varId, data]);
  // 보일 항목: 큰 단위 제목 줄을 넣고, 기술 플러그인 명령은 `플러그인 명령 모두 보기`를 켰을 때만,
  // 기록 사이 화면 그림(1.10.0)은 `그림 보기`를 켰을 때만(앞부분이 같으면 이어 계산한다)
  const displayCfg = useMemo<DisplayConfig>(() => ({
    heads: displayHeads,
    drop: (it) => (!showAllPlugins && it.kind === "plugin" && it.tech) || (!screenShown && (it.kind === "screen" || it.kind === "cutin")),
  }), [displayHeads, showAllPlugins, screenShown]);
  const items = useMemo(() => caches.display.get(built, displayCfg), [caches, built, displayCfg]);
  // 그림을 겹쳐 캐릭터를 그리는 게임인데 그림 따라 그리기가 꺼져 있으면 한 번 안내한다(게임마다 닫기 기억)
  const [hintClosed, setHintClosed] = useState(() => layeredHintDismissed(gameKey));
  const layered = !picturesOn && (facts?.layered ?? false);
  const closeHint = () => { setHintClosed(true); dismissLayeredHint(gameKey); };
  const total = items.length;

  // 읽은 위치(마운트 때 저장소+조상 갈래에서 한 번 읽는다 — 갈래가 바뀌면 FullReader가 새로 마운트한다)
  const [readSeq, setReadSeq] = useState(() => (branch === null ? -1 : initialReadSeq(gameKey, branch, path, model)));
  const markRead = useCallback((seq: number) => setReadSeq(p => (seq > p ? seq : p)), []);
  useEffect(() => {
    if (branch !== null && readSeq >= 0) saveReadSeq(gameKey, branch, readSeq);
  }, [readSeq, gameKey, branch]);

  // 마지막으로 읽은 항목 위치와 그 뒤 새 대사 수(↻ 다시 본 대화는 세지 않는다)
  const stats = useMemo(() => readStats(items, readSeq), [items, readSeq]);
  const { lastReadIdx, firstUnreadIdx, unread } = stats;

  // 그리는 구간 [start, end). 처음 항목이 생길 때 한 번 정하고, 항목 수가 바뀌면 grownRange로 맞춘다(렌더 중 갱신).
  // armed가 false면 사용자가 스크롤하거나 다음을 누르기 전까지 읽음 표시를 하지 않는다.
  const [view, setView] = useState<View | null>(null);
  const cur = syncView(view, total, stats, readSeq);
  if (cur !== view) setView(cur);
  const range = cur?.range ?? EMPTY_RANGE;
  const armed = cur?.armed ?? false;
  const atEnd = range.end >= total;

  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  /** 맨 아래 + 다 읽음 + 구간이 끝까지 — 새 항목이 오면 따라간다 */
  const follow = useRef(false);
  const positioned = useRef(false);
  // 자동으로 맨 아래로: 켜면 새 항목이 올 때마다 위치·창 포커스·양과 상관없이 끝으로 간다
  const autoRef = useRef(autoFollow);
  useLayoutEffect(() => { autoRef.current = autoFollow; }, [autoFollow]);
  const prevLen = useRef(0);
  const armedRef = useRef(false);
  useLayoutEffect(() => { armedRef.current = armed; }, [armed]);

  const scrollToBottom = useCallback(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
    setAtBottom(true);
  }, []);
  const onScroll = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight <= 80);
  }, []);
  /** 항목을 읽기 영역 위쪽(margin px 아래)으로. 그 항목이 없으면 false */
  const scrollToKey = useCallback((key: string, margin = 8): boolean => {
    const el = scroller.current;
    const target = el?.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`);
    if (!el || !target) return false;
    el.scrollTop += target.getBoundingClientRect().top - el.getBoundingClientRect().top - margin;
    onScroll();
    return true;
  }, [onScroll]);
  /** idx 항목 바로 앞이 장면 구분이면 그것부터 보이게 */
  const keyFrom = useCallback((idx: number) => (idx > 0 && items[idx - 1].kind === "chapter" ? items[idx - 1].key : items[idx].key), [items]);

  // ── 읽음 표시 ────────────────────────────────────────────────
  // 스크롤 영역마다 IntersectionObserver 하나. 항목 노드는 ref 콜백으로 붙고 떨어질 때만 observe/unobserve한다.
  // 실제로 화면과 겹쳤던 항목만 읽음: 화면 안에서 아래 끝까지 보였거나, 화면에 보인 뒤 위로 지나간 항목.
  // 화면 밖에서 건너뛴 항목(몰아 들어온 대사 등)은 표시하지 않는다(읽은 위치는 최댓값이라 그 뒤를 읽으면 함께 읽음이 된다).
  const io = useRef<IntersectionObserver | null>(null);
  const nodes = useRef(new Set<HTMLElement>());
  const seen = useRef(new WeakSet<Element>());
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const obs = new IntersectionObserver(entries => {
      if (!armedRef.current) return;
      const root = el.getBoundingClientRect();
      let max = -1;
      for (const e of entries) {
        const b = e.boundingClientRect;
        let passed = false;
        if (e.isIntersecting) {
          seen.current.add(e.target);
          passed = b.bottom <= root.bottom + 1;
        } else {
          passed = b.bottom <= root.top + 1 && seen.current.has(e.target);
        }
        if (!passed) continue;
        const s = Number((e.target as HTMLElement).dataset.seq);
        if (Number.isInteger(s) && s > max) max = s;
      }
      if (max >= 0) markRead(max);
    }, { root: el, threshold: [0, 0.5, 1] });
    io.current = obs;
    nodes.current.forEach(n => obs.observe(n));
    return () => { obs.disconnect(); io.current = null; };
  }, [markRead]);
  const observeNode = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    nodes.current.add(node);
    io.current?.observe(node);
    return () => { nodes.current.delete(node); io.current?.unobserve(node); };
  }, []);

  /** 사용자 동작 뒤부터 읽음 표시. 켜는 순간 화면에 다 보이는 항목은 읽음. */
  const arm = useCallback(() => {
    if (armedRef.current) return;
    armedRef.current = true;
    setView(v => (v && !v.armed ? { ...v, armed: true } : v));
    const el = scroller.current;
    if (!el) return;
    const root = el.getBoundingClientRect();
    let max = -1;
    for (const n of nodes.current) {
      const r = n.getBoundingClientRect();
      if (r.bottom > root.top && r.top < root.bottom) seen.current.add(n);
      if (r.bottom > root.top && r.bottom <= root.bottom + 1) {
        const s = Number(n.dataset.seq);
        if (Number.isInteger(s) && s > max) max = s;
      }
    }
    if (max >= 0) markRead(max);
  }, [markRead]);
  /** 다음 사용자 동작까지 읽음 표시를 멈춘다. */
  const disarm = useCallback(() => {
    armedRef.current = false;
    setView(v => (v && v.armed ? { ...v, armed: false } : v));
  }, []);
  // 뷰어 창이 포커스를 잃으면(게임 창으로 감) 읽음 표시를 멈춘다. 돌아와도 사용자 동작(스크롤·다음·맨 아래로) 뒤부터.
  // 포커스 없이 뷰어 위에서 휠을 굴리는 것도 사용자 동작이라 그때부터는 지나간 항목을 읽음 처리한다.
  useEffect(() => {
    window.addEventListener("blur", disarm);
    return () => window.removeEventListener("blur", disarm);
  }, [disarm]);

  // ── 구간 바꾸기 ──────────────────────────────────────────────
  const after = useRef<AfterRange | null>(null);
  const runAfter = useCallback((a: AfterRange) => {
    const el = scroller.current;
    if (!el) return;
    if (a.kind === "anchor") { el.scrollTop = a.top + (el.scrollHeight - a.h); onScroll(); }
    else if (a.kind === "key") scrollToKey(a.key);
    else scrollToBottom();
  }, [onScroll, scrollToKey, scrollToBottom]);
  /** 구간을 바꾸고, 바뀐 내용이 그려진 뒤 a대로 스크롤. 구간이 그대로면 바로 스크롤. */
  const applyRange = useCallback((next: ReadRange, a: AfterRange | null) => {
    if (sameRange(next, range)) { if (a) runAfter(a); return; }
    after.current = a;
    setView(v => (v ? { ...v, range: next } : v));
  }, [range, runAfter]);
  useLayoutEffect(() => {
    const a = after.current;
    after.current = null;
    if (a) runAfter(a);
  }, [range.start, range.end, runAfter]);

  // ── 처음 위치와 따라가기 ─────────────────────────────────────
  // 갈래마다 처음 한 번 읽던 위치로, 그 뒤엔 다 읽고 맨 아래일 때만 새 항목을 따라간다.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!cur || !el) return;
    if (!positioned.current) {
      positioned.current = true;
      prevLen.current = total;
      // 다 읽었으면 맨 아래, 읽던 곳이 있으면 첫 안 읽은 항목, 처음 읽으면 구간의 맨 위(첫 항목)
      if (cur.at === "bottom") scrollToBottom();
      else if (cur.at === "item" && firstUnreadIdx >= range.start && firstUnreadIdx < range.end) scrollToKey(keyFrom(firstUnreadIdx));
      else { el.scrollTop = 0; onScroll(); }
      return;
    }
    const prev = prevLen.current;
    prevLen.current = total;
    // follow.current는 아래 레이아웃 효과가 "직전 커밋"의 상태(맨 아래 + 새 대사 0 + 구간이 끝까지)로 맞춰 둔 값이다.
    // 이 효과가 먼저 선언돼 먼저 실행되므로, 여기서 읽는 값은 새 항목이 들어오기 전의 따라가기 여부다.
    // (순서를 바꾸면 새 항목 때문에 unread > 0이 되어 따라가기가 항상 꺼진다.)
    if (total <= prev) return;
    // 자동으로 맨 아래로(켬): 구간을 끝으로 옮기고 맨 아래로. 읽음 표시는 건드리지 않는다
    // (화면에 안 보인 채 지나간 항목은 안 읽음으로 남아 수가 보인다).
    if (autoRef.current) { applyRange(tailRange(total, PAGE), { kind: "bottom" }); return; }
    if (!follow.current) return;
    // 뷰어 창에 포커스가 없으면(게임 창에서 넘기는 중) 따라가지 않는다 — 새 항목은 안 읽음으로 남고 수만 는다.
    if (!hasFocus()) { follow.current = false; return; }
    // 새 항목 높이가 한 화면을 넘으면(몰아 들어옴) 맨 아래 대신 첫 새 항목으로 가고 따라가기를 멈춘다.
    // 그 화면도 사용자가 움직이기 전까지는 읽음 표시하지 않는다(구분선·새 대사 수가 몰아 들어온 양을 보여준다).
    // 첫 새 항목이 그려지지 않았으면(구간 밖) 그것도 몰아 들어온 것으로 본다.
    const firstKey = items[prev].key;
    const first = el.querySelector<HTMLElement>(`[data-key="${CSS.escape(firstKey)}"]`);
    const firstTop = first ? first.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop : 0;
    if (!first || el.scrollHeight - firstTop > el.clientHeight) {
      follow.current = false;
      disarm();
      if (first) scrollToKey(firstKey, 48);
      else {
        after.current = { kind: "key", key: firstKey };
        setView(v => (v ? { ...v, range: rangeShowing(v.range, prev, total, PAGE) } : v));
      }
      return;
    }
    scrollToBottom();
    // 따라가는 중에는 끝에서 PAGE개만 남긴다(맨 아래라 앞쪽을 지워도 위치는 그대로)
    const trimmed = trimToTail(range, total, PAGE);
    if (!sameRange(trimmed, range)) {
      after.current = { kind: "bottom" };
      setView(v => (v ? { ...v, range: trimmed } : v));
    }
  }, [cur, total, items, range, firstUnreadIdx, keyFrom, scrollToKey, scrollToBottom, onScroll, disarm, applyRange]);
  // 반드시 위 효과 뒤에 둔다(위 주석 참고)
  useLayoutEffect(() => {
    follow.current = atBottom && unread === 0 && atEnd;
  }, [atBottom, unread, atEnd]);

  // 영역 크기나 내용 높이(그림 로딩·카드 펼침)가 바뀌면, 따라가는 중일 때만 아래에 붙인다
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (follow.current || autoRef.current) el.scrollTop = el.scrollHeight;
      onScroll();
    });
    ro.observe(el);
    if (content.current) ro.observe(content.current);
    return () => ro.disconnect();
  }, [onScroll]);

  const showEarlier = () => {
    const el = scroller.current;
    applyRange(extendUp(range, PAGE), el ? { kind: "anchor", h: el.scrollHeight, top: el.scrollTop } : null);
  };
  const showLater = () => applyRange(extendDown(range, total, PAGE), null);

  /** 맨 아래로: 끝 구간으로 옮기고 전부 읽음 처리 */
  const goBottom = useCallback(() => {
    arm();
    for (let j = total - 1; j >= 0; j--) {
      const s = lastSeqOf(items[j]);
      if (s !== null) { markRead(s); break; }
    }
    applyRange(tailRange(total, PAGE), { kind: "bottom" });
  }, [arm, total, items, markRead, applyRange]);

  /** 자동으로 맨 아래로를 켜는 순간 바로 맨 아래로 간다(읽음 처리는 하지 않음). ReaderView가 켤 때 부른다. */
  useLayoutEffect(() => {
    onFollowOn(() => { autoRef.current = true; applyRange(tailRange(total, PAGE), { kind: "bottom" }); });
    return () => onFollowOn(null);
  }, [onFollowOn, applyRange, total]);

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
    if (idx < 0) { goBottom(); return; }
    for (let j = idx - 1; j >= 0; j--) {
      const s = lastSeqOf(items[j]);
      if (s !== null) { markRead(s); break; }
    }
    // 구간 밖이면 그 항목 둘레로 구간을 옮긴 뒤 올린다
    applyRange(rangeShowing(range, idx, total, PAGE), { kind: "key", key: keyFrom(idx) });
  }, [firstUnreadIdx, items, total, range, keyFrom, arm, markRead, applyRange, goBottom, onScroll]);

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

  // ── 바로 가기(목차·북마크) ───────────────────────────────────
  const [tocOpen, setTocOpen] = useState(false);
  /** idx 항목으로 간다: 구간을 그 둘레로 다시 잡고 그 항목을 위로. 자동으로 맨 아래로는 끈다. */
  const jumpToIdx = useCallback((idx: number) => {
    if (idx < 0 || idx >= total) return;
    setTocOpen(false);
    if (autoRef.current) onAutoFollow(false);
    autoRef.current = false;
    follow.current = false;
    applyRange(rangeShowing(range, idx, total, PAGE), { kind: "key", key: keyFrom(idx) });
  }, [total, range, keyFrom, applyRange, onAutoFollow]);
  const jumpToSeq = useCallback((seq: number) => jumpToIdx(indexOfSeq(items, seq)), [items, jumpToIdx]);
  const goFirst = useCallback(() => jumpToIdx(0), [jumpToIdx]);
  /** 읽던 곳: 첫 안 읽은 항목(다 읽었으면 맨 끝) */
  const goReading = useCallback(() => {
    if (firstUnreadIdx >= 0) { jumpToIdx(firstUnreadIdx); return; }
    setTocOpen(false);
    applyRange(tailRange(total, PAGE), { kind: "bottom" });
  }, [firstUnreadIdx, jumpToIdx, applyRange, total]);
  /** 맨 끝: 자동으로 맨 아래로는 그대로 둔다(읽음 표시는 보이는 만큼만) */
  const goLast = useCallback(() => {
    setTocOpen(false);
    applyRange(tailRange(total, PAGE), { kind: "bottom" });
  }, [applyRange, total]);
  // 다른 갈래의 북마크로 갈래를 바꿨으면 처음 위치를 잡은 뒤 그 줄로 간다(한 번)
  const jumpDone = useRef<number | null>(null);
  useEffect(() => {
    if (!jump || jump.branch !== branch || jumpDone.current === jump.n || !cur || !positioned.current) return;
    jumpDone.current = jump.n;
    jumpToSeq(jump.seq);
    onJumpDone(jump.n);
  }, [jump, branch, cur, jumpToSeq, onJumpDone]);

  const { bookmarks, addBookmark, removeBookmark, renameBookmark, setChapterVar } = readerFile;
  const bookmarkRows = useMemo<BookmarkRow[]>(() => (tocOpen ? bookmarks.map((b) => {
    const missing = !model.branches.has(b.branch) || !hasSeq(records, b.seq);
    let where = "";
    if (b.branch !== branch) where = `다른 갈래 · ${branchLabel(model, b.branch)}`;
    else {
      const h = partIndexAt(heads, b.seq);
      if (h >= 0) where = partTitle(heads[h], varId, data);
    }
    return { bookmark: b, where, missing };
  }) : []), [tocOpen, bookmarks, model, records, branch, heads, varId, data]);
  const goBookmark = useCallback((b: Bookmark) => {
    if (b.branch === branch) jumpToSeq(b.seq);
    else { setTocOpen(false); onJumpBranch(b.branch, b.seq); }
  }, [branch, jumpToSeq, onJumpBranch]);

  // 줄 메뉴: 같은 함수를 계속 넘겨 줄을 다시 그리지 않게(값은 ref로 읽는다)
  const lineCtx = useRef({ branch, addBookmark });
  useLayoutEffect(() => { lineCtx.current = { branch, addBookmark }; }, [branch, addBookmark]);
  const onLineAction = useCallback((item: ReaderItem, action: LineAction) => {
    const c = lineCtx.current;
    if (action.kind === "bookmark") {
      const seq = firstSeqOf(item) ?? lastSeqOf(item);
      if (c.branch === null || seq === null) return;
      c.addBookmark({ branch: c.branch, seq, name: itemSummary(item, 20) });
    }
  }, []);

  // 본문 줄: 항목·구간·읽음 줄이 바뀔 때만 다시 만든다(게임 상태가 매초 바뀌어도 수백 줄을 다시 그리지 않게)
  const rangeStart = range.start, rangeEnd = range.end;
  const lines = useMemo(() => items.slice(rangeStart, rangeEnd).map((item, i) => {
    const seq = lastSeqOf(item);
    return (
      <div key={item.key}>
        <div data-key={item.key} data-seq={seq ?? undefined} ref={seq === null ? undefined : observeNode} className="group/line flex items-start gap-1">
          <div className="min-w-0 flex-1"><ReaderItemView item={item} /></div>
          {seq !== null && <ReaderLineMenu item={item} onAction={onLineAction} />}
        </div>
        {rangeStart + i === lastReadIdx && unread > 0 && (
          <div className="mt-4 flex items-center gap-3 text-xs text-muted-foreground">
            <Separator className="flex-1" />
            <span className="shrink-0">여기까지 읽음 · 새 대사 {unread}</span>
            <Separator className="flex-1" />
          </div>
        )}
      </div>
    );
  }), [items, rangeStart, rangeEnd, lastReadIdx, unread, observeNode, onLineAction]);

  if (!data) return null;
  const empty = total === 0 && !live?.choice;

  const tocButton = (
    <Button
      variant="outline"
      size={mobile ? "icon" : "sm"}
      className={mobile ? "absolute right-16 bottom-3 size-10 bg-background shadow-md" : undefined}
      aria-label="목차"
      onClick={() => setTocOpen(true)}
    >
      <ListTree />
      {!mobile && "목차"}
    </Button>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {!mobile && (
        <div className="mx-auto flex w-full max-w-2xl shrink-0 items-center gap-3 px-2">
          {tocButton}
          <ReaderPosition scroller={scroller} items={items} start={range.start} end={range.end} heads={heads} varId={varId} data={data} className="min-w-0 flex-1" />
        </div>
      )}
      {mobile && total > 0 && (
        <ReaderPosition scroller={scroller} items={items} start={range.start} end={range.end} heads={heads} varId={varId} data={data} className="shrink-0 px-2 text-center text-xs" />
      )}
      <ReaderTocShell open={tocOpen} onOpenChange={setTocOpen} mobile={mobile}>
        <TocJumps onFirst={goFirst} onReading={goReading} onLast={goLast} disabled={total === 0} />
        <TocBookmarks rows={bookmarkRows} onGo={goBookmark} onRename={renameBookmark} onRemove={removeBookmark} />
        <TocParts chapters={chapters} data={data} readSeq={readSeq} onGo={jumpToSeq} />
        <TocChapterVar path={path} data={data} varId={varId} onPick={setChapterVar} />
      </ReaderTocShell>
      {layered && !hintClosed && (
        <Alert className="mx-auto max-w-2xl shrink-0">
          <Info />
          <AlertDescription>
            이 게임은 그림 여러 장을 겹쳐서 캐릭터를 그려요. 게임 설정에서 '화면 그림 따라 그리기'를 켜면 게임 화면 그대로 기록돼요.
          </AlertDescription>
          <AlertAction className="flex gap-1">
            <Button size="xs" variant="outline" onClick={openGameSettings}>게임 설정</Button>
            <Button size="icon-xs" variant="ghost" aria-label="안내 닫기" onClick={closeHint}><X /></Button>
          </AlertAction>
        </Alert>
      )}
      <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={scroller} onScroll={onScroll} onWheel={arm} onTouchMove={arm} onPointerDown={arm} onKeyDown={arm} className="min-h-0 flex-1 overflow-y-auto">
        {/* 휴대폰: 아래에 떠 있는 버튼에 마지막 줄이 가리지 않게 아래 여백을 둔다 */}
        <div ref={content} className={cn("mx-auto max-w-2xl space-y-4 px-2 py-4 text-base leading-relaxed", mobile && "pb-20")}>
          {empty ? (
            <p className="text-center text-sm text-muted-foreground">게임을 진행하면 지나간 대사가 여기에 쌓여요</p>
          ) : (
            <>
              {range.start > 0 && (
                <div className="flex justify-center">
                  <Button variant="outline" size="sm" onClick={showEarlier}>이전 대사 더 보기</Button>
                </div>
              )}
              {lines}
              {!atEnd && (
                <div className="flex justify-center">
                  <Button variant="outline" size="sm" onClick={showLater}>다음 대사 더 보기</Button>
                </div>
              )}
              {atEnd && withLive && <ChoiceNowCard />}
              {atEnd && live?.running && (
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
      {/* 휴대폰: 맨 아래가 아닐 때만 떠 있는 다음·맨 아래로(나머지 설정은 보기 설정 서랍) */}
      {mobile && total > 0 && !(atBottom && atEnd && unread === 0) && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center gap-2">
          <Button className="pointer-events-auto h-10 shadow-md" onClick={next}>
            ↓ 다음{unread > 0 && <Badge variant="secondary">새 대사 {unread}</Badge>}
          </Button>
          <Button variant="outline" size="icon" className="pointer-events-auto size-10 bg-background shadow-md" aria-label="맨 아래로" onClick={goBottom}>
            <ChevronsDown />
          </Button>
        </div>
      )}
      {/* 휴대폰: 보기 설정(ReaderView, 오른쪽 아래) 옆의 목차 */}
      {mobile && tocButton}
      </div>
      {/* 좁은 화면(휴대폰)에서는 줄을 바꾼다 */}
      {!mobile && <div className="flex shrink-0 flex-wrap items-center justify-center gap-x-3 gap-y-2">
        <Button size="sm" onClick={next} disabled={total === 0}>
          ↓ 다음{!isRemoteView() && <span className="pointer-coarse:hidden"> (Space)</span>}
        </Button>
        <Button variant="outline" size="sm" onClick={goBottom} disabled={atBottom && atEnd && unread === 0}>맨 아래로</Button>
        {unread > 0 && <Badge variant="secondary">새 대사 {unread}</Badge>}
        <div className="flex items-center gap-2">
          <Switch id="reader-auto-follow" checked={autoFollow} onCheckedChange={onAutoFollow} />
          <Label htmlFor="reader-auto-follow">자동으로 맨 아래로</Label>
        </div>
        {(picturesOn || hasPictureRecords) && (
          <div className="flex items-center gap-2">
            <Switch id="reader-screen-pictures" checked={screenShown} onCheckedChange={setScreenShown} />
            <Label htmlFor="reader-screen-pictures">그림 보기</Label>
          </div>
        )}
      </div>}
    </div>
  );
}

/** 스위치 한 줄(휴대폰 보기 설정 서랍): 이름 왼쪽, 스위치 오른쪽 */
function SettingRow({ id, label, checked, onChange, children }: {
  id: string; label: string; checked: boolean; onChange: (on: boolean) => void; children?: ReactNode;
}) {
  return (
    <div className="flex min-h-10 items-center gap-3">
      <Label htmlFor={id} className="min-w-0 flex-1">{label}</Label>
      {children}
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

/**
 * 읽기 탭 — 회차·갈래 고르기와 보기 방식(전체 읽기 / 선택 흐름).
 * mobile(휴대폰 너비 플레이 화면)이면 위 도구 줄 대신 `보기 설정` 서랍에 모으고 본문이 화면을 거의 다 쓴다.
 */
export function ReaderView({ mobile = false }: { mobile?: boolean }) {
  const data = useLiveData();
  const { records, model, latestBranch } = useLive();
  // 사용자가 고르기 전엔 최신 갈래(새 갈래가 생기면 따라간다)
  const [picked, setPicked] = useState<number | null>(null);
  // 다른 갈래의 북마크로 갈 때: 갈래를 바꾸고 새 본문이 그 줄로 간다
  const [jump, setJump] = useState<PendingJump | null>(null);
  const onJumpBranch = useCallback((b: number, seq: number) => {
    setPicked(b);
    setJump((j) => ({ branch: b, seq, n: (j?.n ?? 0) + 1 }));
  }, []);
  const onJumpDone = useCallback((n: number) => setJump((j) => (j?.n === n ? null : j)), []);
  // 읽은 위치·갈래 고르기는 대표 갈래 id 기준(이어진 갈래 id가 들어와도 대표 갈래로)
  const selected = picked !== null && model.branches.has(picked) ? representative(model, picked) : latestBranch;
  const [mode, setMode] = useState<ReaderMode>(loadReaderMode);
  const [showAllPlugins, setShowAllPlugins] = usePluginShowAll();
  const [battlesShown, setBattlesShown] = useBattlesShown();
  const [noticesShown, setNoticesShown] = useNoticesShown();
  // 자동으로 맨 아래로(본문과 휴대폰 보기 설정 서랍이 함께 쓴다)
  const [autoFollow, setAutoFollow] = useState(loadAutoFollow);
  const followOn = useRef<(() => void) | null>(null);
  const onFollowOn = useCallback((fn: (() => void) | null) => { followOn.current = fn; }, []);
  const onAutoFollow = useCallback((on: boolean) => {
    setAutoFollow(on);
    saveAutoFollow(on);
    if (on) followOn.current?.();
  }, []);
  // 휴대폰 보기 설정 서랍의 `그림 보기`(본문 아래 줄과 같은 조건: 그림 따라 그리기를 켰거나 그림 표시 기록이 있을 때)
  const [screenShown, setScreenShown] = useScreenPicturesShown();
  const picturesOn = useAddons().isOn("screenPictures");
  const hasPictureRecords = useMemo(() => mobile && records.some(r => r.type === "picture" && r.op === undefined && !!r.name), [mobile, records]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // `알림 문구 보기`는 알림 문구 기록을 켰거나 기록에 알림 문구가 있을 때만
  const noticesOn = useAddons().isOn("notices");
  const hasNotices = useMemo(() => noticesOn || records.some(r => r.type === "notice"), [noticesOn, records]);
  const onMode = (v: string) => {
    if (!isReaderMode(v)) return; // 이미 눌린 항목을 다시 누르면 빈 값 — 무시
    setMode(v);
    saveReaderMode(v);
  };

  if (!data) return null;
  const hasBranch = records.length > 0 && selected !== null;
  const body = hasBranch && mode === "flow"
    ? <ChoiceFlowView branch={selected} onSelectBranch={setPicked} />
    : <FullReader branch={selected} withLive={selected === latestBranch} autoFollow={autoFollow} onAutoFollow={onAutoFollow} onFollowOn={onFollowOn} mobile={mobile} onJumpBranch={onJumpBranch} jump={jump} onJumpDone={onJumpDone} />;

  if (mobile) {
    return (
      <div className="relative flex h-full min-h-0 flex-col">
        {body}
        <Button
          variant="outline"
          size="icon"
          className="absolute right-3 bottom-3 size-10 bg-background shadow-md"
          aria-label="보기 설정"
          onClick={() => setSettingsOpen(true)}
        >
          <Settings2 />
        </Button>
        <Drawer open={settingsOpen} onOpenChange={setSettingsOpen}>
          <DrawerContent>
            <DrawerHeader>
              <DrawerTitle>보기 설정</DrawerTitle>
              <DrawerDescription>읽기 화면에 무엇을 어떻게 보일지 골라요.</DrawerDescription>
            </DrawerHeader>
            <div className="flex flex-col gap-3 overflow-y-auto px-4 pb-6">
              {hasBranch && (
                <>
                  <BranchPicker selected={selected} onSelect={setPicked} />
                  <ToggleGroup type="single" variant="outline" value={mode} onValueChange={onMode} className="w-full">
                    <ToggleGroupItem value="full" className="flex-1">전체 읽기</ToggleGroupItem>
                    <ToggleGroupItem value="flow" className="flex-1">선택 흐름</ToggleGroupItem>
                  </ToggleGroup>
                  <Separator />
                </>
              )}
              <SettingRow id="reader-m-auto-follow" label="자동으로 맨 아래로" checked={autoFollow} onChange={onAutoFollow} />
              {hasBranch && (
                <>
                  <SettingRow id="reader-m-plugin-all" label="플러그인 명령 모두 보기" checked={showAllPlugins} onChange={setShowAllPlugins} />
                  <SettingRow id="reader-m-battles" label="전투 기록 보기" checked={battlesShown} onChange={setBattlesShown} />
                  {hasNotices && (
                    <SettingRow id="reader-m-notices" label="알림 문구 보기" checked={noticesShown} onChange={setNoticesShown}>
                      <NoticeKindsMenu disabled={!noticesShown} />
                    </SettingRow>
                  )}
                </>
              )}
              {(picturesOn || hasPictureRecords) && (
                <SettingRow id="reader-m-screen-pictures" label="그림 보기" checked={screenShown} onChange={setScreenShown} />
              )}
            </div>
          </DrawerContent>
        </Drawer>
      </div>
    );
  }

  return (
    // 헤더(h-12) + main 위아래 패딩(p-4)을 뺀 높이
    <div className="flex h-[calc(100svh-5rem)] flex-col gap-3">
      {hasBranch && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <BranchPicker selected={selected} onSelect={setPicked} />
          <ToggleGroup type="single" variant="outline" size="sm" value={mode} onValueChange={onMode}>
            <ToggleGroupItem value="full">전체 읽기</ToggleGroupItem>
            <ToggleGroupItem value="flow">선택 흐름</ToggleGroupItem>
          </ToggleGroup>
          <div className="flex items-center gap-2">
            <Switch id="reader-plugin-all" checked={showAllPlugins} onCheckedChange={setShowAllPlugins} />
            <Label htmlFor="reader-plugin-all">플러그인 명령 모두 보기</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="reader-battles" checked={battlesShown} onCheckedChange={setBattlesShown} />
            <Label htmlFor="reader-battles">전투 기록 보기</Label>
          </div>
          {hasNotices && (
            <div className="flex items-center gap-2">
              <Switch id="reader-notices" checked={noticesShown} onCheckedChange={setNoticesShown} />
              <Label htmlFor="reader-notices">알림 문구 보기</Label>
              <NoticeKindsMenu disabled={!noticesShown} />
            </div>
          )}
        </div>
      )}
      {body}
    </div>
  );
}
