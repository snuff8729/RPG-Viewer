import { useEffect, useState } from "react";
import { useLive, useLiveStatus } from "@/app/LiveProvider";
import { toast } from "sonner";
import type { InstallStatus } from "@/core/live/installer";
import { installResultText } from "./connectionGuide";
import { fsAccessSupport, type FsAccessWindow } from "../fsAccess";
import { formatBytes } from "./formatBytes";
import { pluginNeedsAction } from "../manageAttention";
import { TriangleAlert } from "lucide-react";
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

// eslint-disable-next-line react-refresh/only-export-components
export function statusLabel(s: InstallStatus | null): string {
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

export function InstallSection() {
  const { supported, install, refreshInstall, doInstall, doUninstall, bundledVersion } = useLive();
  const { logStats } = useLiveStatus();
  const access = fsAccessSupport(window as unknown as FsAccessWindow);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void refreshInstall();
  }, [refreshInstall]);

  const installed = install?.state === "installed";
  const outdated = install?.state === "installed" && install.outdated;

  const run = async (action: "install" | "uninstall") => {
    setBusy(true);
    try {
      if (action === "install") {
        const kind = outdated ? "update" : "install";
        const r = await doInstall();
        if (r.ok) toast.success(installResultText(kind, true));
        else toast.error(installResultText(kind, false, r.message));
      } else {
        const r = await doUninstall();
        if (r.ok) toast.success("제거했어요. 게임을 다시 시작하면 적용돼요.");
        else toast.error(r.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const needed = supported && pluginNeedsAction(install);

  return (
    <div className="space-y-4">
      {needed && (
        <Alert className="flex items-center gap-2 border-warning/50 bg-warning/10">
          <span aria-hidden className="text-warning">
            <TriangleAlert className="size-4" />
          </span>
          <AlertDescription className="min-w-0 flex-1 text-foreground">
            {outdated ? "기록 플러그인을 업데이트해 주세요." : "기록 플러그인이 필요해요."}
          </AlertDescription>
          <Button size="sm" disabled={busy} onClick={() => void run("install")}>
            {outdated ? "업데이트" : "설치"}
          </Button>
        </Alert>
      )}
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
        </div>
      )}
      {supported && installed && (
        <div className="flex flex-wrap gap-2">
          {
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
          }
        </div>
      )}
    </div>
  );
}
