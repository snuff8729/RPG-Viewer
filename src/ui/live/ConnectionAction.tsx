import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useLive } from "@/app/LiveProvider";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { actionLabel, connectionGuide, installResultText, type ConnectionGuide, type GuideAction } from "./connectionGuide";
import { useGameLauncher } from "./LaunchButton";
import { useConnectionStatus } from "./useConnectionStatus";

export interface ConnectionAction {
  status: ReturnType<typeof useConnectionStatus>;
  /** 지금 할 단계(연결됐으면 null) */
  guide: ConnectionGuide | null;
  busy: boolean;
  run(action: GuideAction): void;
  /** 게임을 실행할 수 있는 곳인지(뷰어 서버·폴더 열기로 연 게임) */
  canLaunch: boolean;
  /** 직접 정한 게임 위치가 있으면 바꿀 수 있어요 */
  canChangePath: boolean;
  changePath(): void;
  /** 게임 위치 창(실행할 때 위치를 모르면 열려요). 화면에 늘 그려 둬요. */
  dialog: ReactNode;
}

/**
 * 설치·업데이트·게임 실행을 한곳에서: 머리줄 연결 상태, 연결 안내, 위쪽 알림 줄, 보조 업데이트 알림이 같이 써요.
 * 결과는 토스트로 알려요(화면 배치를 밀지 않게).
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useConnectionAction(): ConnectionAction {
  const status = useConnectionStatus();
  const launcher = useGameLauncher();
  const { doInstall, install, bundledVersion } = useLive();
  const [busy, setBusy] = useState(false);
  const [justInstalled, setJustInstalled] = useState<"install" | "update" | null>(null);

  const guide = connectionGuide(status.state, {
    remote: status.remote,
    canLaunch: launcher.visible,
    justInstalled,
    installedVersion: install?.state === "installed" ? install.version : null,
    bundledVersion,
  });

  const installNow = async (kind: "install" | "update") => {
    setBusy(true);
    try {
      const r = await doInstall();
      if (r.ok) {
        setJustInstalled(kind);
        toast.success(installResultText(kind, true));
      } else {
        toast.error(installResultText(kind, false, r.message));
      }
    } finally {
      setBusy(false);
    }
  };

  const run = (action: GuideAction) => {
    if (action === "install" || action === "update") void installNow(action);
    else if (action === "launch") launcher.launch();
    else window.location.hash = "#/manage/connection";
  };

  return {
    status, guide, busy: busy || launcher.busy, run,
    canLaunch: launcher.visible, canChangePath: launcher.canChangePath, changePath: launcher.changePath,
    dialog: launcher.dialog,
  };
}

/** 안내의 버튼 하나(누르는 동안 Spinner) */
export function ConnectionActionButton({
  action,
  ctl,
  size = "default",
}: {
  action: GuideAction;
  ctl: ConnectionAction;
  size?: "default" | "sm";
}) {
  if (action === "manage") {
    return (
      <Button size={size} variant="outline" asChild>
        <a href="#/manage/connection">{actionLabel(action)}</a>
      </Button>
    );
  }
  return (
    <Button size={size} disabled={ctl.busy} onClick={() => ctl.run(action)}>
      {ctl.busy && <Spinner />}
      {actionLabel(action)}
    </Button>
  );
}
