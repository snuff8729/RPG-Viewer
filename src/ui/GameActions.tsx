import { useState } from "react";
import { ChevronDown, FolderOpen, Pin, PinOff } from "lucide-react";
import { useGame } from "@/app/GameProvider";
import { loadHandle, pinGame, useRecentGames } from "@/app/recent";
import type { RecentItem } from "@/app/recentList";
import { openFolderOnServer } from "@/app/serverFolder";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { isRemoteView } from "@/app/share";

/** 이름 메뉴와 관리의 게임 바꾸기가 같은 최근 게임·고정 동작을 써요. */
export function GameActions({ menu = false }: { menu?: boolean }) {
  const { data, recentKey, close, openServer, openHandle } = useGame();
  const recent = useRecentGames();
  const current = recent.find(it => it.key === recentKey);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reopen = async (it: RecentItem) => {
    setError(null); setBusy(true);
    try {
      if (it.kind === "server") {
        const r = await openFolderOnServer(it.path!);
        if (!r.ok) { setError(r.error); return; }
        if ("session" in r) await openServer(r.session);
      } else {
        const handle = await loadHandle(it.key) as (FileSystemDirectoryHandle & { requestPermission?: (o: { mode: "read" }) => Promise<PermissionState> }) | null;
        if (!handle || (await handle.requestPermission?.({ mode: "read" })) !== "granted") { setError("게임 폴더를 다시 열어 주세요."); return; }
        await openHandle(handle);
      }
      window.location.hash = "#/play";
    } catch { setError("게임을 열지 못했어요. 게임 폴더를 다시 골라 주세요."); }
    finally { setBusy(false); }
  };
  const pinLabel = current?.pinned ? "고정 풀기" : "게임 고정";
  const PinIcon = current?.pinned ? PinOff : Pin;
  const title = data?.system.gameTitle || "제목 없는 게임";
  if (isRemoteView()) return <span className="min-w-0 truncate text-sm font-semibold">{title}</span>;
  if (menu) return <DropdownMenu modal={false}>
    <DropdownMenuTrigger asChild><Button variant="ghost" size="sm" className="min-w-0 shrink px-1"><span className="truncate">{title}</span><ChevronDown /></Button></DropdownMenuTrigger>
    <DropdownMenuContent align="start" className="max-w-72">
      <DropdownMenuGroup>
        {current && <DropdownMenuItem onSelect={() => pinGame(current.key, !current.pinned)}><PinIcon />{pinLabel}</DropdownMenuItem>}
        <DropdownMenuItem onSelect={close}><FolderOpen />다른 게임 열기</DropdownMenuItem>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuGroup><DropdownMenuLabel>최근 게임</DropdownMenuLabel>{recent.slice(0, 5).map(it => <DropdownMenuItem key={it.key} disabled={busy} onSelect={() => void reopen(it)}><span className="truncate">{it.title || it.name}</span></DropdownMenuItem>)}</DropdownMenuGroup>
      {error && <DropdownMenuLabel className="text-destructive">{error}</DropdownMenuLabel>}
    </DropdownMenuContent>
  </DropdownMenu>;
  return <div className="space-y-4"><div className="flex flex-wrap gap-2"><Button onClick={close}><FolderOpen />다른 게임 열기</Button>{current && <Button variant="outline" onClick={() => pinGame(current.key, !current.pinned)}><PinIcon />{pinLabel}</Button>}</div>{error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}</div>;
}
