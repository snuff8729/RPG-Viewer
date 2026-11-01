import { useEffect, useState } from "react";
import { useLive, useLiveStatus } from "@/app/LiveProvider";
import type { InstallResult, InstallStatus } from "@/core/live/installer";
import { fsAccessSupport, type FsAccessWindow } from "../fsAccess";
import { formatBytes } from "./formatBytes";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

function statusLabel(s: InstallStatus | null): string {
  if (!s) return "확인 중";
  switch (s.state) {
    case "unsupported":
      return "지원 안 함";
    case "notInstalled":
      return "미설치";
    case "installed":
      return s.outdated ? "업데이트 필요" : "설치됨";
  }
}

type Outcome = { action: "install" | "uninstall"; result: InstallResult };

export function InstallSection() {
  const { supported, install, refreshInstall, doInstall, doUninstall, bundledVersion } = useLive();
  const { logStats } = useLiveStatus();
  const access = fsAccessSupport(window as unknown as FsAccessWindow);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  useEffect(() => {
    void refreshInstall();
  }, [refreshInstall]);

  const run = async (action: Outcome["action"]) => {
    setBusy(true);
    try {
      const result = action === "install" ? await doInstall() : await doUninstall();
      setOutcome({ action, result });
    } finally {
      setBusy(false);
    }
  };

  const installed = install?.state === "installed";
  const outdated = install?.state === "installed" && install.outdated;

  return (
    <div className="space-y-4">
      {!supported ? (
        <Alert>
          <AlertDescription>{access.message ?? "크롬이나 엣지에서 폴더 열기로 연 게임만 지원해요"}</AlertDescription>
        </Alert>
      ) : (
        <div className="flex flex-col gap-3 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">상태</span>
            <Badge variant="outline">{statusLabel(install)}</Badge>
            {install?.state === "installed" && (
              <span className="text-muted-foreground">
                설치된 버전 {install.version ?? "알 수 없음"} · 새 버전 {bundledVersion}
              </span>
            )}
          </div>
          {logStats && (
            <div className="text-muted-foreground">
              기록 크기 {formatBytes(logStats.bytes)} · {logStats.lines}줄
            </div>
          )}
          {install?.state === "unsupported" && (
            <Alert variant="destructive">
              <AlertDescription>{install.reason}</AlertDescription>
            </Alert>
          )}
          {outcome && (
            <Alert variant={outcome.result.ok ? "default" : "destructive"}>
              <AlertDescription>
                {outcome.result.ok
                  ? outcome.action === "install"
                    ? "설치했어요. 게임을 다시 시작하면 기록을 시작해요."
                    : "제거했어요. 게임을 다시 시작하면 적용돼요."
                  : outcome.result.message}
              </AlertDescription>
            </Alert>
          )}
        </div>
      )}
      {supported && install && install.state !== "unsupported" && (
        <div className="flex flex-wrap gap-2">
          {installed && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" disabled={busy}>
                  기록 플러그인 제거
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>기록 플러그인을 제거할까요?</AlertDialogTitle>
                  <AlertDialogDescription>
                    게임을 다시 시작하면 새 기록을 남기지 않아요. 이전 기록은 남아 있어요.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>취소</AlertDialogCancel>
                  <AlertDialogAction variant="destructive" onClick={() => void run("uninstall")}>
                    제거
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          {!installed && (
            <Button disabled={busy} onClick={() => void run("install")}>
              설치
            </Button>
          )}
          {outdated && (
            <Button disabled={busy} onClick={() => void run("install")}>
              업데이트
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
