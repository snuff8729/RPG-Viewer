import { useState } from "react";
import { useLive } from "@/app/LiveProvider";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useGameLauncher } from "./LaunchButton";
import { useConnectionStatus } from "./useConnectionStatus";
import { terms } from "@/ui/terms";

/** 연결 상태와 빈 화면에서 같은 다음 동작을 사용해요. */
export function ConnectionNextAction() {
  const status = useConnectionStatus();
  const launcher = useGameLauncher();
  const { doInstall } = useLive();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const install = async () => {
    setBusy(true);
    try {
      const r = await doInstall();
      setNote(r.ok ? "설치했어요. 게임을 다시 실행해 주세요." : r.message);
    } finally {
      setBusy(false);
    }
  };
  const needsInstall = status.state === "install" || status.state === "update";
  return (
    <div className="space-y-2">
      {status.remote && !status.connected && <p className="text-sm text-muted-foreground">{terms.pcOnly}</p>}
      {!status.remote && needsInstall && (
        <Button disabled={busy} onClick={() => void install()}>
          {status.state === "update" ? "업데이트" : "플러그인 설치"}
        </Button>
      )}
      {!status.remote && status.state === "off" && launcher.visible && (
        <Button disabled={launcher.busy} onClick={launcher.launch}>
          게임 실행
        </Button>
      )}
      {status.state === "unsupported" && (
        <Button asChild>
          <a href="#/manage/connection">관리로</a>
        </Button>
      )}
      {note && (
        <Alert>
          <AlertDescription>{note}</AlertDescription>
        </Alert>
      )}
      {launcher.status}
      {launcher.dialog}
    </div>
  );
}

export function ConnectionStatusButton() {
  const status = useConnectionStatus();
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="shrink-0 gap-1.5">
          <span aria-hidden className={`size-2 rounded-full ${status.dot}`} />
          {status.text}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="space-y-3">
        <p className="text-sm">{status.description}</p>
        <ConnectionNextAction />
        <Button variant="link" className="h-auto p-0" asChild>
          <a href="#/manage/connection" onClick={() => setOpen(false)}>
            관리에서 자세히
          </a>
        </Button>
      </PopoverContent>
    </Popover>
  );
}
