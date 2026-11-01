import { Fragment, useState, type ReactNode } from "react";
import { checkGame, type GameCheckResult } from "@/app/launcher";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface GamePathDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 열 때 채워 둘 경로 */
  initialPath: string;
  /** 열 때 보여 줄 오류(예: 실행 실패) */
  initialError: string | null;
  openedTitle: string;
  confirmLabel: string;
  confirmIcon?: ReactNode;
  /** 확인한 경로로 진행. 실패 문구를 돌려주면 창에 남는다(성공이면 null). */
  onConfirm: (path: string) => Promise<string | null>;
}

/** 게임 폴더 위치를 묻는 창(게임 실행·백업이 함께 쓴다). 열 때마다 key를 바꿔 새로 마운트한다. */
export function GamePathDialog(props: GamePathDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open && <GamePathForm {...props} />}
    </Dialog>
  );
}

export function GamePathForm({ initialPath, initialError, openedTitle, confirmLabel, confirmIcon, onConfirm, onOpenChange, inline = false }: GamePathDialogProps & { inline?: boolean }) {
  const [input, setInput] = useState(initialPath);
  const [check, setCheck] = useState<GameCheckResult | null>(null);
  const [error, setError] = useState<string | null>(initialError);
  const [busy, setBusy] = useState(false);

  const onCheck = async () => {
    setBusy(true);
    setError(null);
    try {
      setCheck(await checkGame(input));
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = async () => {
    setBusy(true);
    try {
      const err = await onConfirm(input);
      if (err === null) onOpenChange(false);
      else setError(err);
    } finally {
      setBusy(false);
    }
  };

  const Content = inline ? Fragment : DialogContent;
  return (
    <Content>
      {!inline && <DialogHeader>
        <DialogTitle>게임 폴더 위치</DialogTitle>
        <DialogDescription>
          탐색기에서 게임 폴더를 Shift+오른쪽 클릭 → "경로로 복사" 후 붙여 넣으세요.
        </DialogDescription>
      </DialogHeader>}
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
              onChange={(e) => { setInput(e.target.value); setCheck(null); setError(null); }}
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
        {error !== null && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </form>
      <div className="flex justify-end">
        <Button disabled={busy || !check?.ok} onClick={() => void onSubmit()}>
          {confirmIcon}{confirmLabel}
        </Button>
      </div>
    </Content>
  );
}
