import { useEffect, useMemo, useState, type ReactNode, type RefObject } from "react";
import { Bookmark as BookmarkIcon, Check, ChevronRight, CornerDownRight, MoreHorizontal } from "lucide-react";
import type { Bookmark } from "@/core/live/readerFile";
import {
  chapterVarCandidates, durationLabel, partIndexAt, partTitle, sceneTitle, valueFlow, variableName, whenLabel,
  type ChapterHead, type ChapterPart, type Chapters, type ChapterScene, type ChapterVarCandidate,
} from "@/core/live/chapters";
import type { ReaderItem } from "@/core/live/reader";
import { firstSeqOf } from "@/core/live/readerNav";
import type { LogRecord } from "@/core/live/types";
import type { GameData } from "@/core/types";
import { formatText } from "@/core/text/escape";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

/** 목차 서랍: PC는 오른쪽 Sheet, 휴대폰은 아래 Drawer */
export function ReaderTocShell({ open, onOpenChange, mobile, children }: {
  open: boolean; onOpenChange: (open: boolean) => void; mobile: boolean; children: ReactNode;
}) {
  if (mobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>목차</DrawerTitle>
            <DrawerDescription>원하는 곳으로 바로 가요.</DrawerDescription>
          </DrawerHeader>
          <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-4 pb-6">{children}</div>
        </DrawerContent>
      </Drawer>
    );
  }
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>목차</SheetTitle>
          <SheetDescription>원하는 곳으로 바로 가요.</SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-6">{children}</div>
      </SheetContent>
    </Sheet>
  );
}

/** 맨 위 고정: 처음 / 읽던 곳 / 맨 끝 */
export function TocJumps({ onFirst, onReading, onLast, disabled }: {
  onFirst: () => void; onReading: () => void; onLast: () => void; disabled?: boolean;
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <Button variant="outline" size="sm" onClick={onFirst} disabled={disabled}>처음</Button>
      <Button variant="outline" size="sm" onClick={onReading} disabled={disabled}>읽던 곳</Button>
      <Button variant="outline" size="sm" onClick={onLast} disabled={disabled}>맨 끝</Button>
    </div>
  );
}

/** 목차의 한 묶음 제목(작은 글) */
export function TocHeading({ children }: { children: ReactNode }) {
  return <p className="text-xs font-medium text-muted-foreground">{children}</p>;
}

export interface BookmarkRow {
  bookmark: Bookmark;
  /** 위치 설명(묶음 제목·다른 갈래 등) */
  where: string;
  /** 기록에서 사라진 줄 */
  missing: boolean;
}

/** 북마크 하나: 누르면 이동, 메뉴에서 이름 바꾸기·지우기 */
function BookmarkLine({ row, onGo, onRename, onRemove }: {
  row: BookmarkRow; onGo: () => void; onRename: (name: string) => void; onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(row.bookmark.name);
  const save = () => {
    setEditing(false);
    const v = draft.trim();
    if (v && v !== row.bookmark.name) onRename(v);
  };
  return (
    <li className="flex items-center gap-1">
      {editing ? (
        <Input
          autoFocus
          value={draft}
          maxLength={40}
          aria-label="북마크 이름"
          className="h-8 flex-1"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            else if (e.key === "Escape") { e.stopPropagation(); setEditing(false); setDraft(row.bookmark.name); }
          }}
        />
      ) : (
        <Button
          variant="ghost"
          className={cn("h-auto min-w-0 flex-1 justify-start gap-2 py-1.5 text-left whitespace-normal", row.missing && "opacity-50")}
          disabled={row.missing}
          onClick={onGo}
        >
          <BookmarkIcon className="text-muted-foreground" />
          <span className="min-w-0 flex-1">
            <span className="block truncate">{row.bookmark.name}</span>
            <span className="block truncate text-xs font-normal text-muted-foreground">
              {row.missing ? "찾을 수 없음" : row.where}
            </span>
          </span>
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label={`북마크(${row.bookmark.name}) 메뉴`}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => { setDraft(row.bookmark.name); setEditing(true); }}>이름 바꾸기</DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={onRemove}>지우기</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

/** 북마크 목록(없으면 만드는 법 안내) */
export function TocBookmarks({ rows, onGo, onRename, onRemove }: {
  rows: BookmarkRow[]; onGo: (b: Bookmark) => void; onRename: (id: string, name: string) => void; onRemove: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <TocHeading>북마크</TocHeading>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">읽기 줄의 메뉴(⋯)에서 `여기 북마크`를 누르면 여기에 생겨요.</p>
      ) : (
        <ul className="flex flex-col">
          {rows.map((r) => (
            <BookmarkLine
              key={r.bookmark.id}
              row={r}
              onGo={() => onGo(r.bookmark)}
              onRename={(name) => onRename(r.bookmark.id, name)}
              onRemove={() => onRemove(r.bookmark.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- 자동 목차

const sceneSubtitle = (s: ChapterScene, data: GameData | null | undefined): string => {
  let text = s.firstText;
  try { if (data) text = formatText(text, data); } catch { /* 원문 */ }
  const line = text.split("\n").map((l) => l.replace(/\s+/g, " ").trim()).find((l) => l !== "") ?? "";
  const chars = [...line];
  return chars.length > 40 ? `${chars.slice(0, 40).join("")}…` : line;
};

/** 장면 한 줄: 제목(맵 · 이벤트)과 첫 대사, 다시 본 장면·읽음 표시 */
function TocScene({ scene, data, read, onGo }: { scene: ChapterScene; data: GameData | null | undefined; read: boolean; onGo: () => void }) {
  return (
    <li>
      <Button variant="ghost" className="h-auto w-full justify-start gap-2 py-1.5 text-left font-normal whitespace-normal" onClick={onGo}>
        <span className={cn("min-w-0 flex-1", (read || scene.again) && "text-muted-foreground")}>
          <span className="block truncate font-medium">{sceneTitle(scene.src, data)}</span>
          <span className="block truncate text-xs text-muted-foreground">{sceneSubtitle(scene, data)}</span>
        </span>
        {scene.again && <Badge variant="outline" className="shrink-0">다시 본 장면</Badge>}
        {read && <Check className="shrink-0 text-muted-foreground" aria-label="읽음" />}
      </Button>
    </li>
  );
}

/** 큰 단위 하나(접기): 제목·길이·장면 수, 펼치면 장면 목록 */
function TocPart({ part, scenes, varId, data, readSeq, defaultOpen, onGo }: {
  part: ChapterPart; scenes: ChapterScene[]; varId: number | null; data: GameData | null | undefined; readSeq: number;
  defaultOpen: boolean; onGo: (seq: number) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const meta = [varId === null ? durationLabel(part.lastT - part.t) : whenLabel(part.t), scenes.length > 0 ? `장면 ${scenes.length}` : ""]
    .filter(Boolean).join(" · ");
  const read = part.lastSeq <= readSeq;
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="flex items-center gap-1">
        <CollapsibleTrigger asChild>
          <Button variant="ghost" className="h-auto min-w-0 flex-1 justify-start gap-2 py-1.5 text-left whitespace-normal">
            <ChevronRight className={cn("text-muted-foreground transition-transform", open && "rotate-90")} />
            <span className={cn("min-w-0 flex-1", read && "text-muted-foreground")}>
              <span className="block truncate">{partTitle(part, varId, data)}</span>
              {meta && <span className="block truncate text-xs font-normal text-muted-foreground">{meta}</span>}
            </span>
          </Button>
        </CollapsibleTrigger>
        <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label="이 묶음 처음으로 가기" onClick={() => onGo(part.seq)}>
          <CornerDownRight />
        </Button>
      </div>
      <CollapsibleContent>
        {scenes.length === 0 ? (
          <p className="py-1 pl-8 text-sm text-muted-foreground">긴 대화 없음</p>
        ) : (
          <ul className="flex flex-col pl-6">
            {scenes.map((s) => <TocScene key={s.seq} scene={s} data={data} read={s.lastSeq <= readSeq} onGo={() => onGo(s.seq)} />)}
          </ul>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

/** 자동 목차: 플레이 묶음(또는 변수 값)별로 접은 장면 목록. 읽던 곳이 든 묶음만 펼쳐 둔다. */
export function TocParts({ chapters, data, readSeq, onGo }: {
  chapters: Chapters; data: GameData | null | undefined; readSeq: number; onGo: (seq: number) => void;
}) {
  const { parts, scenes, varId } = chapters;
  const byPart = useMemo(() => {
    const m = new Map<number, ChapterScene[]>();
    for (const s of scenes) {
      let list = m.get(s.part);
      if (!list) m.set(s.part, list = []);
      list.push(s);
    }
    return m;
  }, [scenes]);
  const reading = Math.max(0, partIndexAt(parts, Math.max(readSeq, 0)));
  if (parts.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <TocHeading>
        {varId === null ? `플레이 묶음 ${parts.length}개 · 장면 ${scenes.length}개` : `「${variableName(data, varId)}」로 나눔 · 장면 ${scenes.length}개`}
      </TocHeading>
      {parts.map((p, i) => (
        <TocPart
          key={`${varId ?? "t"}.${p.seq}`}
          part={p}
          scenes={byPart.get(i) ?? []}
          varId={varId}
          data={data}
          readSeq={readSeq}
          defaultOpen={i === reading}
          onGo={onGo}
        />
      ))}
    </div>
  );
}

/** `날짜 변수로 나누기`: 펼칠 때 후보를 찾는다. 고르면 큰 단위가 그 변수 값이 바뀌는 곳마다 나뉜다. */
export function TocChapterVar({ path, data, varId, onPick }: {
  path: readonly LogRecord[]; data: GameData | null | undefined; varId: number | null; onPick: (id: number | null) => void;
}) {
  const [cands, setCands] = useState<ChapterVarCandidate[] | null>(null);
  const onOpenChange = (open: boolean) => { setCands(open ? chapterVarCandidates(path, data) : null); };
  return (
    <Collapsible open={cands !== null} onOpenChange={onOpenChange}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm" className="w-full justify-start text-muted-foreground">
          <ChevronRight className={cn("transition-transform", cands !== null && "rotate-90")} />
          날짜 변수로 나누기{varId !== null && ` · 「${variableName(data, varId)}」`}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-1 pt-1">
        <p className="px-2 text-xs text-muted-foreground">
          게임의 날짜·진행 변수를 고르면 그 값이 바뀌는 곳마다 나눠요. 거의 오르기만 하고 가끔 바뀌는 변수를 보여 줘요.
        </p>
        <Button variant={varId === null ? "secondary" : "ghost"} size="sm" className="justify-start" onClick={() => onPick(null)}>
          {varId === null ? <Check /> : <span className="size-3.5 shrink-0" />}
          자동(플레이 시간)
        </Button>
        {cands !== null && cands.length === 0 && <p className="px-2 text-sm text-muted-foreground">알맞은 변수를 찾지 못했어요.</p>}
        {cands?.map((c) => (
          <Button
            key={c.id}
            variant={varId === c.id ? "secondary" : "ghost"}
            className="h-auto justify-start gap-2 py-1.5 text-left font-normal whitespace-normal"
            onClick={() => onPick(c.id)}
          >
            {varId === c.id ? <Check /> : <span className="size-4 shrink-0" />}
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{c.name}</span>
              <span className="block truncate text-xs text-muted-foreground">바뀐 횟수 {c.changes} · {valueFlow(c.values)}</span>
            </span>
          </Button>
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * 화면 위 지금 위치 한 줄(`10월 28일 밤 10:05 · 37%`): 읽기 영역 맨 위에 보이는 항목의 큰 단위와 전체 중 위치.
 * 스크롤할 때 한 프레임에 한 번만 본다(항목 노드는 순서대로라 이분 탐색).
 */
export function ReaderPosition({ scroller, items, start, end, heads, varId, data, className }: {
  scroller: RefObject<HTMLDivElement | null>; items: readonly ReaderItem[]; start: number; end: number;
  heads: readonly ChapterHead[]; varId: number | null; data: GameData | null | undefined; className?: string;
}) {
  const [topKey, setTopKey] = useState<string | null>(null);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const nodes = el.querySelectorAll<HTMLElement>("[data-key]");
      if (nodes.length === 0) { setTopKey(null); return; }
      const top = el.getBoundingClientRect().top + 1;
      let lo = 0, hi = nodes.length - 1, ans = nodes.length - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (nodes[mid].getBoundingClientRect().bottom > top) { ans = mid; hi = mid - 1; } else lo = mid + 1;
      }
      setTopKey(nodes[ans].dataset.key ?? null);
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(update); };
    raf = requestAnimationFrame(update);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => { el.removeEventListener("scroll", onScroll); cancelAnimationFrame(raf); };
  }, [scroller, start, end]);
  let idx = -1;
  for (let i = start; i < end && i < items.length; i++) if (items[i].key === topKey) { idx = i; break; }
  if (idx < 0 || items.length === 0) return null;
  const seq = firstSeqOf(items[idx]);
  const h = seq === null ? -1 : partIndexAt(heads, seq);
  const pct = Math.round((idx / Math.max(1, items.length - 1)) * 100);
  const title = h >= 0 ? partTitle(heads[h], varId, data) : "";
  return <p className={cn("truncate text-sm text-muted-foreground", className)}>{title ? `${title} · ${pct}%` : `${pct}%`}</p>;
}
