import { memo } from "react";
import { Bookmark, EyeOff, MoreHorizontal } from "lucide-react";
import type { ReaderItem } from "@/core/live/reader";
import type { HideRuleInput } from "@/core/live/readerFile";
import { hideChoicesOf } from "@/core/live/hideRules";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { hideTypeLabel } from "./readerHide";

/** 읽기 줄 메뉴에서 고른 것 */
export type LineAction = { kind: "bookmark" } | { kind: "hide"; rule: HideRuleInput };

/** 열렸을 때만 만드는 메뉴 내용(숨김 고르기는 줄 글을 정리해야 해서) */
function LineMenuItems({ item, onAction }: { item: ReaderItem; onAction: (item: ReaderItem, action: LineAction) => void }) {
  const choices = hideChoicesOf(item, hideTypeLabel);
  return (
    <>
      <DropdownMenuItem onSelect={() => onAction(item, { kind: "bookmark" })}>
        <Bookmark />
        여기 북마크
      </DropdownMenuItem>
      {choices.length > 0 && <DropdownMenuSeparator />}
      {choices.map((c) => (
        <DropdownMenuItem key={c.label} onSelect={() => onAction(item, { kind: "hide", rule: c.rule })}>
          <EyeOff />
          {c.label}
        </DropdownMenuItem>
      ))}
    </>
  );
}

/**
 * 읽기 줄 하나의 작은 메뉴(⋯): 여기 북마크, 이 문장 / 숫자만 다른 문장 / 이 종류 숨기기.
 * PC는 줄에 마우스를 올리면, 휴대폰은 늘 흐리게 보인다. onAction은 같은 함수를 계속 넘길 것(줄을 다시 그리지 않게).
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
      <DropdownMenuContent align="end" className="w-64">
        <LineMenuItems item={item} onAction={onAction} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
});
