import { useEffect, useState } from "react";
import { FolderCog, Play } from "lucide-react";
import { useGame } from "@/app/GameProvider";
import { useLive } from "@/app/LiveProvider";
import { checkGame, launchGame, launcherAvailable, loadGamePath, saveGamePath, type GameCheckResult } from "@/app/launcher";
import { gameKeyOf } from "./readPosition";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** 실행 뒤 `실행했어요`를 보여 주는 시간 */
const LAUNCHED_MS = 3000;

/**
 * 상단 `게임 실행` 버튼. 뷰어 서버(npm run dev / preview)에 실행 API가 있고 폴더 열기로 연 게임일 때만 보인다.
 * 처음엔 게임 폴더 위치를 묻고, 게임마다 기억해 다음부터 바로 실행한다.
 */
export function LaunchButton() {
  const { data } = useGame();
  const { supported, connection } = useLive();
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    let alive = true;
    void launcherAvailable().then((ok) => { if (alive) setAvailable(ok); });
    return () => { alive = false; };
  }, []);

  const gameKey = data ? gameKeyOf(data) : null;
  const [pathKey, setPathKey] = useState<string | null>(gameKey);
  const [savedPath, setSavedPath] = useState<string | null>(() => (gameKey ? loadGamePath(gameKey) : null));
  if (pathKey !== gameKey) {
    setPathKey(gameKey);
    setSavedPath(gameKey ? loadGamePath(gameKey) : null);
  }

  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [check, setCheck] = useState<GameCheckResult | null>(null);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [launchedAt, setLaunchedAt] = useState<number | null>(null);
  useEffect(() => {
    if (launchedAt === null) return;
    const id = setTimeout(() => setLaunchedAt(null), LAUNCHED_MS);
    return () => clearTimeout(id);
  }, [launchedAt]);

  if (!data || !gameKey || !supported || !available) return null;
  const openedTitle = data.system.gameTitle;
  const running = connection === "connected";

  const openDialog = (path: string, error: string | null) => {
    setInput(path);
    setCheck(null);
    setLaunchError(error);
    setOpen(true);
  };

  /** 실행하고 실패 문구를 돌려준다(성공이면 null). */
  const launch = async (path: string): Promise<string | null> => {
    setBusy(true);
    try {
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

  const onCheck = async () => {
    setBusy(true);
    setLaunchError(null);
    try {
      setCheck(await checkGame(input));
    } finally {
      setBusy(false);
    }
  };

  const onSaveAndLaunch = async () => {
    saveGamePath(gameKey, input);
    setSavedPath(input);
    const err = await launch(input);
    if (err === null) setOpen(false);
    else setLaunchError(err);
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
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>게임 폴더 위치</DialogTitle>
            <DialogDescription>
              탐색기에서 게임 폴더를 Shift+오른쪽 클릭 → "경로로 복사" 후 붙여 넣으세요.
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => { e.preventDefault(); void onCheck(); }}
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="game-path">게임 폴더</Label>
              <div className="flex gap-2">
                <Input
                  id="game-path"
                  value={input}
                  placeholder="C:\Games\MyGame"
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => { setInput(e.target.value); setCheck(null); setLaunchError(null); }}
                />
                <Button type="submit" variant="outline" disabled={busy || input.trim() === ""}>확인</Button>
              </div>
            </div>
            {check?.ok && (
              <Alert>
                <AlertDescription>
                  <p>「{check.title || "제목 없음"}」 찾았어요</p>
                  {check.title !== openedTitle && <p>지금 연 게임과 제목이 달라요</p>}
                </AlertDescription>
              </Alert>
            )}
            {check && !check.ok && (
              <Alert variant="destructive">
                <AlertDescription>{check.error}</AlertDescription>
              </Alert>
            )}
            {launchError !== null && (
              <Alert variant="destructive">
                <AlertDescription>{launchError}</AlertDescription>
              </Alert>
            )}
          </form>
          <DialogFooter>
            <Button disabled={busy || !check?.ok} onClick={() => void onSaveAndLaunch()}>
              <Play />저장하고 실행
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
