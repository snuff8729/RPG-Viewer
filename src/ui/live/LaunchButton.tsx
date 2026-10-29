import { useEffect, useState, type ReactNode } from "react";
import { FolderCog, Play } from "lucide-react";
import { useGame } from "@/app/GameProvider";
import { useLive } from "@/app/LiveProvider";
import { launchGame } from "@/app/launcher";
import { loadAutoBackup, makeBackup, notifyBackupsChanged } from "@/app/backups";
import { gameKeyOf } from "./readPosition";
import { GamePathDialog } from "./GamePathDialog";
import { useGamePath, useLauncherAvailable } from "./useGamePath";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** 실행 뒤 `실행했어요`를 보여 주는 시간 */
const LAUNCHED_MS = 3000;

export interface GameLauncher {
  /** 실행할 수 있는 곳인지(뷰어 서버·게임 연결 지원). false면 아무것도 그리지 않는다. */
  visible: boolean;
  running: boolean;
  busy: boolean;
  /** 실행(위치를 모르면 위치부터 묻는다). 클릭·메뉴 선택에서 부른다. */
  launch(): void;
  /** 위치를 직접 정한 게임이면 위치 바꾸기를 보인다 */
  canChangePath: boolean;
  changePath(): void;
  /** `실행했어요`·실패 글(없으면 null) */
  status: ReactNode;
  /** 위치 창. 화면에 늘 그려 둔다(메뉴 안이 아니라 바깥에). */
  dialog: ReactNode;
}

/**
 * 게임 실행(버튼이나 ⋯ 메뉴가 같이 쓴다). 뷰어 서버(npm run dev / preview)에 실행 API가 있고 폴더 열기로 연 게임일 때만 보인다.
 * 처음엔 게임 폴더 위치를 묻고, 게임마다 기억해 다음부터 바로 실행한다.
 * 자동 백업이 켜져 있으면 실행 직전에 세이브 폴더를 백업한다.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useGameLauncher(): GameLauncher {
  const { data } = useGame();
  const { supported, connection } = useLive();
  const available = useLauncherAvailable();
  const gameKey = data ? gameKeyOf(data) : null;
  const { path: savedPath, save: setSavedPath, fromServer } = useGamePath(gameKey);
  const [launchError, setLaunchError] = useState<string | null>(null);

  const [dialog, setDialog] = useState<{ open: boolean; path: string; error: string | null }>({ open: false, path: "", error: null });
  const [busy, setBusy] = useState(false);
  const [launchedAt, setLaunchedAt] = useState<number | null>(null);
  useEffect(() => {
    if (launchedAt === null) return;
    const id = setTimeout(() => setLaunchedAt(null), LAUNCHED_MS);
    return () => clearTimeout(id);
  }, [launchedAt]);

  const running = connection === "connected";
  if (!data || !gameKey || !supported || !available) {
    return { visible: false, running, busy, launch: () => {}, canChangePath: false, changePath: () => {}, status: null, dialog: null };
  }

  const openDialog = (path: string, error: string | null) => setDialog({ open: true, path, error });

  /** 실행하고 실패 문구를 돌려준다(성공이면 null). */
  const launch = async (path: string): Promise<string | null> => {
    setBusy(true);
    try {
      if (loadAutoBackup(gameKey)) {
        // 백업이 안 돼도 실행은 막지 않는다(백업 창에서 오류를 볼 수 있다).
        const b = await makeBackup(path, "auto", "게임 실행 전");
        if (b.ok) notifyBackupsChanged();
      }
      const r = await launchGame(path);
      if (!r.ok) return r.error ?? "실행하지 못했어요";
      setLaunchedAt(Date.now());
      return null;
    } finally {
      setBusy(false);
    }
  };

  const onMainClick = async () => {
    setLaunchError(null);
    if (savedPath === null) { openDialog("", null); return; }
    const err = await launch(savedPath);
    // 뷰어 서버로 연 게임은 경로를 이미 알므로 묻지 않고 오류만 보여 준다.
    if (err !== null) {
      if (fromServer) setLaunchError(err);
      else openDialog(savedPath, err);
    }
  };

  const status = launchedAt !== null
    ? <span className="text-sm text-muted-foreground">실행했어요</span>
    : launchError !== null ? <span className="text-sm text-destructive">{launchError}</span> : null;
  const dialogEl = (
    <GamePathDialog
      open={dialog.open}
      onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
      initialPath={dialog.path}
      initialError={dialog.error}
      openedTitle={data.system.gameTitle}
      confirmLabel="저장하고 실행"
      confirmIcon={<Play />}
      onConfirm={async (path) => {
        setSavedPath(path);
        return launch(path);
      }}
    />
  );
  return {
    visible: true, running, busy, launch: () => void onMainClick(),
    canChangePath: savedPath !== null && !fromServer, changePath: () => { if (savedPath !== null) openDialog(savedPath, null); },
    status, dialog: dialogEl,
  };
}

/**
 * 상단 `게임 실행` 버튼. 뷰어 서버(npm run dev / preview)에 실행 API가 있고 폴더 열기로 연 게임일 때만 보인다.
 */
export function LaunchButton() {
  const g = useGameLauncher();
  if (!g.visible) return null;
  return (
    <>
      {g.status}
      <Button variant="outline" size="sm" disabled={g.running || g.busy} onClick={g.launch}>
        <Play />{g.running ? "실행 중" : "게임 실행"}
      </Button>
      {g.canChangePath && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="위치 바꾸기" onClick={g.changePath}>
              <FolderCog />
            </Button>
          </TooltipTrigger>
          <TooltipContent>위치 바꾸기</TooltipContent>
        </Tooltip>
      )}
      {g.dialog}
    </>
  );
}
