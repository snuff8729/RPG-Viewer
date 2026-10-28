import { useEffect, useState } from "react";
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

/**
 * 상단 `게임 실행` 버튼. 뷰어 서버(npm run dev / preview)에 실행 API가 있고 폴더 열기로 연 게임일 때만 보인다.
 * 처음엔 게임 폴더 위치를 묻고, 게임마다 기억해 다음부터 바로 실행한다.
 * 자동 백업이 켜져 있으면 실행 직전에 세이브 폴더를 백업한다.
 */
export function LaunchButton() {
  const { data } = useGame();
  const { supported, connection } = useLive();
  const available = useLauncherAvailable();
  const gameKey = data ? gameKeyOf(data) : null;
  const [savedPath, setSavedPath] = useGamePath(gameKey);

  const [dialog, setDialog] = useState<{ open: boolean; path: string; error: string | null }>({ open: false, path: "", error: null });
  const [busy, setBusy] = useState(false);
  const [launchedAt, setLaunchedAt] = useState<number | null>(null);
  useEffect(() => {
    if (launchedAt === null) return;
    const id = setTimeout(() => setLaunchedAt(null), LAUNCHED_MS);
    return () => clearTimeout(id);
  }, [launchedAt]);

  if (!data || !gameKey || !supported || !available) return null;
  const running = connection === "connected";

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
    if (savedPath === null) { openDialog("", null); return; }
    const err = await launch(savedPath);
    if (err !== null) openDialog(savedPath, err);
  };

  return (
    <>
      {launchedAt !== null && <span className="text-sm text-muted-foreground">실행했어요</span>}
      <Button variant="outline" size="sm" disabled={running || busy} onClick={() => void onMainClick()}>
        <Play />{running ? "실행 중" : "게임 실행"}
      </Button>
      {savedPath !== null && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="위치 바꾸기" onClick={() => openDialog(savedPath, null)}>
              <FolderCog />
            </Button>
          </TooltipTrigger>
          <TooltipContent>위치 바꾸기</TooltipContent>
        </Tooltip>
      )}
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
    </>
  );
}
