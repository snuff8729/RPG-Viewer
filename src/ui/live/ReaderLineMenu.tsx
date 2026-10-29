import { memo } from "react";
import { Bookmark, MoreHorizontal } from "lucide-react";
import type { ReaderItem } from "@/core/live/reader";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** 읽기 줄 메뉴에서 고른 것 */
export type LineAction = { kind: "bookmark" };

/**
 * 읽기 줄 하나의 작은 메뉴(⋯). PC는 줄에 마우스를 올리면, 휴대폰은 늘 흐리게 보인다.
 * onAction은 같은 함수를 계속 넘길 것(줄을 다시 그리지 않게).
 */
export const ReaderLineMenu = memo(function ReaderLineMenu({ item, onAction }: {
  item: ReaderItem; onAction: (item: ReaderItem, action: LineAction) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="이 줄 메뉴"
          className="shrink-0 text-muted-foreground opacity-0 group-hover/line:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 pointer-coarse:opacity-60"
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem onSelect={() => onAction(item, { kind: "bookmark" })}>
          <Bookmark />
          여기 북마크
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
});
