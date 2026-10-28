import { ListFilter } from "lucide-react";
import { NOTICE_KIND_LABELS, NOTICE_KINDS } from "@/core/addons/notices";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NoticeIcon } from "./NoticeLine";
import { useHiddenNoticeKinds } from "./noticeDisplay";

/** `알림 종류` 메뉴: 업적·획득·퀘스트·알림을 종류별로 보이기/숨기기(브라우저에 기억, 읽기·기록 공유) */
export function NoticeKindsMenu({ disabled }: { disabled?: boolean }) {
  const [hidden, setShown] = useHiddenNoticeKinds();
  const count = NOTICE_KINDS.length - hidden.size;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm" disabled={disabled}>
          <ListFilter />
          알림 종류{hidden.size > 0 ? ` (${count}/${NOTICE_KINDS.length})` : ""}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        <DropdownMenuLabel>보일 알림</DropdownMenuLabel>
        {NOTICE_KINDS.map((k) => (
          <DropdownMenuCheckboxItem
            key={k}
            checked={!hidden.has(k)}
            onCheckedChange={(v) => setShown(k, v === true)}
            onSelect={(e) => e.preventDefault()}
          >
            <NoticeIcon kind={k} text={k === "gain" ? "gold" : ""} className="text-muted-foreground" />
            {NOTICE_KIND_LABELS[k]}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
