import { Pin, PinOff, X } from "lucide-react";
import { forgetGame, pinGame } from "@/app/recent";
import { splitRecent, type RecentItem } from "@/app/recentList";
import { Button } from "@/components/ui/button";
import {
  Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle,
} from "@/components/ui/item";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const timeFormat = new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

function describe(it: RecentItem): string {
  const where = it.kind === "server" ? it.path ?? it.name : it.name;
  return it.openedAt > 0 ? `${where} · ${timeFormat.format(new Date(it.openedAt))}` : where;
}

function IconAction({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={label} onClick={onClick}>{children}</Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function Row({ it, canOpen, busy, onOpen }: { it: RecentItem; canOpen: boolean; busy: boolean; onOpen: (it: RecentItem) => void }) {
  return (
    <Item variant="outline" size="sm">
      <ItemContent className="min-w-0">
        <ItemTitle className="max-w-full truncate">{it.title || it.name}</ItemTitle>
        <ItemDescription className="truncate" title={it.kind === "server" ? it.path : undefined}>{describe(it)}</ItemDescription>
      </ItemContent>
      <ItemActions>
        <Button variant="outline" size="sm" disabled={!canOpen || busy} onClick={() => onOpen(it)}>열기</Button>
        <IconAction label={it.pinned ? "고정 해제" : "고정"} onClick={() => pinGame(it.key, !it.pinned)}>
          {it.pinned ? <PinOff /> : <Pin />}
        </IconAction>
        <IconAction label="목록에서 지우기" onClick={() => forgetGame(it.key)}><X /></IconAction>
      </ItemActions>
    </Item>
  );
}

/**
 * 시작 화면의 고정·최근 게임 목록. 고정한 게임은 밀려나지 않고, 최근은 고정 안 한 것 중 5개.
 * 서버 경로 항목은 뷰어 서버가 있을 때만 열 수 있다.
 */
export function RecentGames({ items, serverAvailable, busy, onOpen }: {
  items: RecentItem[];
  serverAvailable: boolean;
  busy: boolean;
  onOpen: (it: RecentItem) => void;
}) {
  const { pinned, recent } = splitRecent(items);
  const canOpen = (it: RecentItem) => it.kind === "handle" || serverAvailable;
  const section = (label: string, list: RecentItem[]) => list.length > 0 && (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <ItemGroup className="gap-2">
        {list.map((it) => <Row key={it.key} it={it} canOpen={canOpen(it)} busy={busy} onOpen={onOpen} />)}
      </ItemGroup>
    </div>
  );
  if (pinned.length === 0 && recent.length === 0) return null;
  return (
    <div className="flex flex-col gap-4">
      {section("고정", pinned)}
      {section("최근 게임", recent)}
    </div>
  );
}
