import { useState } from "react";
import { ArchiveRestore, Ellipsis, FolderCog, Play, Settings2, Smartphone } from "lucide-react";
import { useGame } from "@/app/GameProvider";
import { isRemoteView } from "@/app/share";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { GameSettingsSheet } from "../addons/GameSettingsSheet";
import { openGameSettings } from "../addons/gameSettingsOpen";
import { BackupButton } from "./BackupButton";
import { useBackupControls } from "./BackupControls";
import { useGameLauncher } from "./LaunchButton";
import { ShareDialog } from "./ShareButton";
import { useLauncherAvailable } from "./useGamePath";

/**
 * 플레이 화면 `⋯` 메뉴: 게임 실행·휴대폰으로 보기·백업·게임 설정. 메뉴에서 고르면 창(Dialog·Sheet)을 연다 — 창들은 메뉴 밖에 늘 둔다
 * (백업은 자동 백업 지켜보기도 하므로). 휴대폰 보기에서는 게임 설정만(실행·공유·백업은 PC에서).
 */
export function PlayMenu() {
  const remote = isRemoteView();
  const { data } = useGame();
  const launcher = useGameLauncher();
  const serverAvailable = useLauncherAvailable();
  const backup = useBackupControls();
  const [shareOpen, setShareOpen] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);
  const canShare = !remote && serverAvailable && !!data;
  const canLaunch = !remote && launcher.visible;

  return (
    <>
      {!remote && launcher.status}
      {/* 메뉴에서 창을 여는 shadcn 예시처럼 modal={false}: 메뉴가 닫히며 포커스를 뺏지 않게 */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="더보기"><Ellipsis /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {(canLaunch || canShare || backup) && (
            <>
              <DropdownMenuGroup>
                {canLaunch && (
                  <DropdownMenuItem disabled={launcher.running || launcher.busy} onSelect={launcher.launch}>
                    <Play />{launcher.running ? "게임 실행 중" : "게임 실행"}
                  </DropdownMenuItem>
                )}
                {canLaunch && launcher.canChangePath && (
                  <DropdownMenuItem onSelect={launcher.changePath}><FolderCog />게임 위치 바꾸기</DropdownMenuItem>
                )}
                {canShare && <DropdownMenuItem onSelect={() => setShareOpen(true)}><Smartphone />휴대폰으로 보기</DropdownMenuItem>}
                {backup && <DropdownMenuItem onSelect={() => setBackupOpen(true)}><ArchiveRestore />백업</DropdownMenuItem>}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuGroup>
            <DropdownMenuItem onSelect={openGameSettings}><Settings2 />게임 설정</DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {canLaunch && launcher.dialog}
      {canShare && <ShareDialog open={shareOpen} onOpenChange={setShareOpen} />}
      {!remote && <BackupButton trigger={false} open={backupOpen} onOpenChange={setBackupOpen} />}
      <GameSettingsSheet trigger={false} />
    </>
  );
}
