import { useEffect, useRef, useState } from "react";
import { BookOpenText, FolderOpen, Map as MapIcon, Zap } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { useGame } from "@/app/GameProvider";
import { loadHandle, useRecentGames } from "@/app/recent";
import type { RecentItem } from "@/app/recentList";
import { RecentGames } from "./RecentGames";
import { fsApiInfo, openFolderOnServer, pickFolderOnServer, type FsApiInfo } from "@/app/serverFolder";
import { fsAccessSupport, type FsAccessWindow } from "./fsAccess";

type PickerWindow = Window & { showDirectoryPicker?: (o?: { mode?: "read" }) => Promise<FileSystemDirectoryHandle> };
type PermHandle = FileSystemDirectoryHandle & { requestPermission?: (d: { mode: "read" }) => Promise<PermissionState> };

export function StartScreen() {
  const { status, error, openHandle, openFiles, openServer } = useGame();
  const recent = useRecentGames();
  const [server, setServer] = useState<FsApiInfo>({ available: false, pick: false });
  /** 기본 폴더 선택 창이 실패하면 이후엔 브라우저 선택 창을 쓴다. */
  const [nativeFailed, setNativeFailed] = useState(false);
  const [picking, setPicking] = useState(false);
  const [denied, setDenied] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const native = server.pick && !nativeFailed;
  const access = fsAccessSupport(window as unknown as FsAccessWindow);

  useEffect(() => {
    void fsApiInfo().then(setServer);
  }, []);

  const browserPick = async () => {
    const w = window as PickerWindow;
    if (w.showDirectoryPicker) {
      let h: FileSystemDirectoryHandle;
      try { h = await w.showDirectoryPicker({ mode: "read" }); } catch { return; /* 취소 */ }
      await openHandle(h);
    } else {
      inputRef.current?.click();
    }
  };

  const pick = async () => {
    setDenied(false);
    setOpenError(null);
    if (!native) { await browserPick(); return; }
    setPicking(true);
    let r: Awaited<ReturnType<typeof pickFolderOnServer>>;
    try { r = await pickFolderOnServer(); } finally { setPicking(false); }
    if (!r.ok) {
      if (r.pickerFailed) { setNativeFailed(true); setOpenError(`${r.error}. 다시 누르면 브라우저 창으로 열어요.`); }
      else setOpenError(r.error);
      return;
    }
    if ("cancelled" in r) return;
    await openServer(r.session);
  };

  const reopen = async (it: RecentItem) => {
    setDenied(false);
    setOpenError(null);
    if (it.kind === "server") {
      if (!it.path) return;
      setPicking(true);
      let r: Awaited<ReturnType<typeof openFolderOnServer>>;
      try { r = await openFolderOnServer(it.path); } finally { setPicking(false); }
      if (!r.ok) { setOpenError(r.error); return; }
      if ("session" in r) await openServer(r.session);
      return;
    }
    const handle = await loadHandle(it.key);
    if (!handle) { setOpenError("폴더 정보를 찾을 수 없어요. 게임 폴더를 다시 골라 주세요."); return; }
    try {
      const perm = await (handle as PermHandle).requestPermission?.({ mode: "read" });
      if (perm !== "granted") { setDenied(true); return; }
    } catch { setDenied(true); return; }
    await openHandle(handle);
  };

  const showAccessWarning = access.message !== null && !native;

  return (
    <div className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>RPG Viewer</CardTitle>
          <CardDescription>RPG Maker MV/MZ 게임 옆에 띄워 두고 같이 쓰는 도우미예요.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {/* 이 앱으로 할 수 있는 것 세 줄 */}
          <ul className="flex flex-col gap-1.5 text-sm">
            <li className="flex items-center gap-2"><MapIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />게임하면서 맵·해 볼 것 보기</li>
            <li className="flex items-center gap-2"><Zap className="size-4 shrink-0 text-muted-foreground" aria-hidden />보조·치트로 편하게</li>
            <li className="flex items-center gap-2"><BookOpenText className="size-4 shrink-0 text-muted-foreground" aria-hidden />놓친 대사 다시 읽기</li>
          </ul>
          {status === "loading" ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          ) : (
            <>
              {showAccessWarning && (
                <Alert>
                  <AlertDescription>{access.message}</AlertDescription>
                </Alert>
              )}
              <Button onClick={() => void pick()} disabled={picking}>
                <FolderOpen />
                {picking ? "폴더 선택 창에서 고르는 중…" : "게임 폴더 열기"}
              </Button>
              <p className="text-xs text-muted-foreground">
                Game.exe가 들어 있는 폴더(안에 www 또는 js 폴더가 있는 곳)를 골라 주세요.
              </p>
              <RecentGames
                items={recent}
                serverAvailable={server.available}
                busy={picking}
                onOpen={(it) => void reopen(it)}
              />
            </>
          )}
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            {...({ webkitdirectory: "" } as Record<string, string>)}
            multiple
            onChange={(e) => { if (e.target.files?.length) void openFiles(e.target.files); e.target.value = ""; }}
          />
          {denied && (
            <Alert variant="destructive">
              <AlertDescription>권한이 거부되었어요. 폴더를 다시 선택해 주세요.</AlertDescription>
            </Alert>
          )}
          {openError !== null && (
            <Alert variant="destructive">
              <AlertDescription>{openError}</AlertDescription>
            </Alert>
          )}
          {status === "error" && error && !error.ok && (
            <Alert variant="destructive">
              {error.reason === "notFound" ? (
                <>
                  <AlertTitle>MV/MZ 게임 폴더가 아니에요</AlertTitle>
                  <AlertDescription>
                    <ul className="list-disc pl-4">
                      {error.searched.map((s) => <li key={s}>{s}</li>)}
                    </ul>
                  </AlertDescription>
                </>
              ) : error.reason === "internal" ? (
                <>
                  <AlertTitle>게임을 여는 중 오류가 발생했어요</AlertTitle>
                  <AlertDescription>{error.message}</AlertDescription>
                </>
              ) : (
                <AlertTitle>지원하지 않는 암호화 방식이에요 ({error.file})</AlertTitle>
              )}
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
