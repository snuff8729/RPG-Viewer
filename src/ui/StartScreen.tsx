import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { useGame } from "@/app/GameProvider";
import { loadRecent } from "@/app/recent";
import { fsAccessSupport, type FsAccessWindow } from "./fsAccess";

type PickerWindow = Window & { showDirectoryPicker?: (o?: { mode?: "read" }) => Promise<FileSystemDirectoryHandle> };
type PermHandle = FileSystemDirectoryHandle & { requestPermission?: (d: { mode: "read" }) => Promise<PermissionState> };

export function StartScreen() {
  const { status, error, openHandle, openFiles } = useGame();
  const [recent, setRecent] = useState<FileSystemDirectoryHandle | null>(null);
  const [denied, setDenied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const access = fsAccessSupport(window as unknown as FsAccessWindow);

  useEffect(() => { void loadRecent().then(setRecent); }, []);

  const pick = async () => {
    setDenied(false);
    const w = window as PickerWindow;
    if (w.showDirectoryPicker) {
      let h: FileSystemDirectoryHandle;
      try { h = await w.showDirectoryPicker({ mode: "read" }); } catch { return; /* 취소 */ }
      await openHandle(h);
    } else {
      inputRef.current?.click();
    }
  };

  const reopen = async () => {
    if (!recent) return;
    setDenied(false);
    try {
      const perm = await (recent as PermHandle).requestPermission?.({ mode: "read" });
      if (perm !== "granted") { setDenied(true); return; }
    } catch { setDenied(true); return; }
    await openHandle(recent);
  };

  return (
    <div className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>RPG Viewer</CardTitle>
          <CardDescription>RPG Maker MV/MZ 게임 폴더를 열어 대사와 장면을 한눈에 보세요.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {status === "loading" ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          ) : (
            <>
              {access.message && (
                <Alert>
                  <AlertDescription>{access.message}</AlertDescription>
                </Alert>
              )}
              <Button onClick={pick}>게임 폴더 열기</Button>
              {recent && (
                <Button variant="outline" onClick={reopen}>최근 게임 다시 열기: {recent.name}</Button>
              )}
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
