import { useState, type ReactNode } from "react";
import { Bookmark as BookmarkIcon, MoreHorizontal } from "lucide-react";
import type { Bookmark } from "@/core/live/readerFile";
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
