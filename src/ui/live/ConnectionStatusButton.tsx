import { useState } from "react";
import { Ellipsis, FolderCog } from "lucide-react";
import { toast } from "sonner";
import { useLive, useLiveStatus } from "@/app/LiveProvider";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { terms } from "@/ui/terms";
import { ConnectionActionButton, useConnectionAction, type ConnectionAction } from "./ConnectionAction";
import { lastSeenText, panelAction } from "./connectionGuide";
import { formatBytes } from "./formatBytes";
import { statusLabel } from "./InstallSection";

/** 연결 상태 창 내용: 기록 플러그인 줄 · 게임 줄 · 지금 할 일(단추). 휴대폰 보기는 정보만. */
function ConnectionPanel({ ctl, onUninstall, onAction }: { ctl: ConnectionAction; onUninstall: () => void; onAction: () => void }) {
  const { install, bundledVersion, supported } = useLive();
  const { logStats, lastSeenT } = useLiveStatus();
  const [now] = useState(Date.now);
  const { status } = ctl;
  const installed = install?.state === "installed";
  const outdated = installed && install.outdated;
  const version = installed ? (outdated ? `${install.version ?? "?"} → ${bundledVersion}` : install.version) : null;
  const pluginInfo = [version, logStats ? `기록 ${formatBytes(logStats.bytes)}` : null].filter(Boolean).join(" · ");
  const action = panelAction(status.state, { remote: status.remote, canLaunch: ctl.canLaunch });
  const badgeVariant = !installed ? "outline" : outdated ? "warning" : "secondary";
  const gameLabel = status.state === "connected" ? terms.connected : status.state === "checking" ? terms.checking : terms.disconnected;
  const gameDot = status.state === "connected" ? "bg-success" : status.state === "checking" ? "bg-warning" : "bg-muted-foreground";
  return (
    <>
      <Item size="sm" className="px-1 py-1.5">
        <ItemContent className="min-w-0">
          <ItemTitle>
            {terms.plugin}
            <Badge variant={badgeVariant}>{supported ? statusLabel(install) : "지원 안 함"}</Badge>
          </ItemTitle>
          <ItemDescription className="truncate text-xs">
            {status.state === "unsupported" ? status.description : pluginInfo || status.description}
          </ItemDescription>
        </ItemContent>
        {installed && !status.remote && (
          <ItemActions>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="기록 플러그인 더보기">
                  <Ellipsis />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem variant="destructive" onSelect={onUninstall}>제거</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </ItemActions>
        )}
      </Item>
      <Separator />
      <Item size="sm" className="px-1 py-1.5">
        <ItemMedia>
          <span aria-hidden className={`size-2 rounded-full ${gameDot}`} />
        </ItemMedia>
        <ItemContent className="min-w-0">
          <ItemTitle>{gameLabel}</ItemTitle>
          <ItemDescription className="truncate text-xs">{lastSeenText(lastSeenT, now)}</ItemDescription>
        </ItemContent>
      </Item>
      {status.remote ? (
        <p className="px-1 text-xs text-muted-foreground">PC에서 할 수 있어요</p>
      ) : (
        (action || ctl.canChangePath) && (
          <>
            <Separator />
            <div className="flex items-center gap-2 px-1" onClickCapture={onAction}>
              {action && <ConnectionActionButton action={action} ctl={ctl} size="sm" />}
              {ctl.canChangePath && (
                <Button variant="ghost" size="sm" className="ml-auto" onClick={ctl.changePath}>
                  <FolderCog data-icon="inline-start" />
                  게임 위치 바꾸기
                </Button>
              )}
            </div>
          </>
        )
      )}
    </>
  );
}

/**
 * 머리줄 연결 상태 단추: 누르면 작은 창에서 기록 플러그인(설치·업데이트·제거)과 게임(실행·위치)을 바로 다뤄요.
 * 결과는 토스트로 알려요. 같은 내용을 관리 › 연결·실행에서도 다뤄요.
 */
export function ConnectionStatusButton() {
  const ctl = useConnectionAction();
  const { doUninstall } = useLive();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const { status } = ctl;
  const uninstall = async () => {
    const r = await doUninstall();
    if (r.ok) toast.success("제거했어요. 게임을 다시 시작하면 적용돼요.");
    else toast.error(r.message);
  };
  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="shrink-0 gap-1.5">
            <span aria-hidden className={`size-2 rounded-full ${status.dot}`} />
            {status.text}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" collisionPadding={8} className="w-88 max-w-[calc(100vw-1rem)] gap-1.5">
          <ConnectionPanel
            ctl={ctl}
            onUninstall={() => { setOpen(false); setConfirm(true); }}
            onAction={() => setOpen(false)}
          />
        </PopoverContent>
      </Popover>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>기록 플러그인을 제거할까요?</AlertDialogTitle>
            <AlertDialogDescription>게임을 다시 시작하면 새 기록을 남기지 않아요. 이전 기록은 남아 있어요.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void uninstall()}>제거</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {ctl.dialog}
    </>
  );
}
