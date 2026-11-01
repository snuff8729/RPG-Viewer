import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useGame } from "@/app/GameProvider";
import { useLive } from "@/app/LiveProvider";
import {
  fetchBackups,
  fetchRunning,
  isEmptyBackup,
  KIND_LABEL,
  loadAutoBackup,
  makeBackup,
  notifyBackupsChanged,
  onBackupsChanged,
  removeBackup,
  restoreAndRestart,
  saveAutoBackup,
  type BackupList,
  type BackupMeta,
} from "@/app/backups";
import { gameKeyOf } from "./readPosition";
import { useGamePath, useLauncherAvailable } from "./useGamePath";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const timeFormat = new Intl.DateTimeFormat("ko-KR", {
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : timeFormat.format(d);
}

type Confirm =
  { kind: "restore"; backup: BackupMeta; running: boolean; launch: boolean } | { kind: "delete"; backup: BackupMeta };

export function BackupSection() {
  const { data } = useGame();
  const { supported, connection } = useLive();
  const available = useLauncherAvailable();
  const gameKey = data ? gameKeyOf(data) : null;
  const { path } = useGamePath(gameKey);
  const connected = connection === "connected";

  const [autoState, setAutoState] = useState(() => ({ key: gameKey, on: gameKey ? loadAutoBackup(gameKey) : true }));
  let auto = autoState.on;
  if (autoState.key !== gameKey) {
    auto = gameKey ? loadAutoBackup(gameKey) : true;
    setAutoState({ key: gameKey, on: auto });
  }

  const [list, setList] = useState<BackupList | null>(null);
  const backups = list?.backups ?? null;
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const reload = useCallback(async () => {
    if (!path) return;
    const r = await fetchBackups(path);
    if (r.ok) setList(r);
    else setError(r.error);
  }, [path]);

  useEffect(() => {
    if (!path || !available || !supported) return;
    let alive = true;
    void fetchBackups(path).then((r) => {
      if (!alive) return;
      if (r.ok) setList(r);
      else setError(r.error);
    });
    const off = onBackupsChanged(() => void reload());
    return () => {
      alive = false;
      off();
    };
  }, [path, reload, available, supported]);

  if (!data || !gameKey) return null;
  if (!supported || !available)
    return (
      <Alert>
        <AlertDescription>뷰어 서버에서 게임 폴더를 열면 세이브 백업을 쓸 수 있어요.</AlertDescription>
      </Alert>
    );

  const run = async (fn: (p: string) => Promise<void>) => {
    if (!path) return;
    setBusy(true);
    setError(null);
    try {
      await fn(path);
    } finally {
      setBusy(false);
    }
  };

  const onBackupNow = () =>
    run(async (p) => {
      const r = await makeBackup(p, "manual", "직접 백업", name.trim() || undefined);
      if (!r.ok) {
        toast.error(`백업하지 못했어요: ${r.error}`);
        return;
      }
      notifyBackupsChanged();
      setName("");
      toast.success(r.skipped ? "바뀐 게 없어서 지난 백업을 그대로 둬요" : "백업했어요");
      await reload();
    });

  const onAskRestore = (backup: BackupMeta) =>
    run(async (p) => {
      const r = await fetchRunning(p);
      const running = connected || (r.ok && r.running);
      setConfirm({ kind: "restore", backup, running, launch: true });
    });

  const onRestore = (c: Extract<Confirm, { kind: "restore" }>) =>
    run(async (p) => {
      const r = await restoreAndRestart(p, c.backup.id, c.running || c.launch);
      if (!r.ok) toast.error(r.error ? `복원하지 못했어요: ${r.error}` : "복원하지 못했어요");
      else if (r.error) toast.error(`복원했지만 게임을 다시 실행하지 못했어요: ${r.error}`);
      else toast.success(r.relaunched ? "복원하고 게임을 실행했어요" : "복원했어요");
      notifyBackupsChanged();
      await reload();
    });

  const onDelete = (backup: BackupMeta) =>
    run(async (p) => {
      const r = await removeBackup(p, backup.id);
      if (!r.ok) toast.error(`지우지 못했어요: ${r.error}`);
      else toast.success("지웠어요");
      await reload();
    });

  const onAutoChange = (on: boolean) => {
    saveAutoBackup(gameKey, on);
    setAutoState({ key: gameKey, on });
    window.dispatchEvent(new Event("rpgv:auto-backup"));
  };

  return (
    <>
      <div className="space-y-4">
        {!path && (
          <Button variant="outline" asChild>
            <a href="#/manage/connection">연결·실행에서 게임 위치를 알려 주세요</a>
          </Button>
        )}
        <p className="text-sm text-muted-foreground">세이브 폴더 전체를 저장하고 복원해요.</p>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void onBackupNow();
            }}
          >
            <Input
              aria-label="백업 이름"
              value={name}
              placeholder="이름 (선택)"
              maxLength={100}
              onChange={(e) => setName(e.target.value)}
            />
            <Button type="submit" disabled={busy || !path}>
              지금 백업
            </Button>
          </form>
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <Label htmlFor="auto-backup">자동 백업</Label>
              <p className="text-xs text-muted-foreground">게임 실행 전과 게임이 저장한 뒤에 자동으로 백업해요</p>
            </div>
            <Switch id="auto-backup" checked={auto} onCheckedChange={onAutoChange} />
          </div>
          {error !== null && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {list?.saveDir !== undefined && <p className="text-xs text-muted-foreground">세이브 폴더: {list.saveDir}</p>}
          {list?.saveFilesMissing === true && (
            <Alert>
              <AlertDescription>세이브 파일을 찾지 못했어요</AlertDescription>
            </Alert>
          )}
          <Separator />
          {!path ? (
            <p className="text-sm text-muted-foreground">게임 폴더 위치를 정하면 백업 목록을 볼 수 있어요.</p>
          ) : backups === null ? (
            <p className="text-sm text-muted-foreground">불러오는 중…</p>
          ) : backups.length === 0 ? (
            <p className="text-sm text-muted-foreground">아직 백업이 없어요</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>시각</TableHead>
                  <TableHead>종류</TableHead>
                  <TableHead>내용</TableHead>
                  <TableHead className="text-right">파일</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {backups.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell>{formatTime(b.createdAt)}</TableCell>
                    <TableCell>
                      <Badge variant={b.kind === "manual" ? "default" : b.kind === "safety" ? "outline" : "secondary"}>
                        {KIND_LABEL[b.kind]}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-40 truncate whitespace-normal">{b.name ?? b.reason}</TableCell>
                    <TableCell className="text-right">
                      {isEmptyBackup(b) ? <Badge variant="outline">비어 있음</Badge> : b.fileCount}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button variant="outline" size="xs" disabled={busy} onClick={() => void onAskRestore(b)}>
                          복원
                        </Button>
                        <Button
                          variant="ghost"
                          size="xs"
                          disabled={busy}
                          onClick={() => setConfirm({ kind: "delete", backup: b })}
                        >
                          삭제
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </div>
      <AlertDialog
        open={confirm !== null}
        onOpenChange={(o) => {
          if (!o) setConfirm(null);
        }}
      >
        <AlertDialogContent size="sm">
          {confirm?.kind === "restore" && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>{formatTime(confirm.backup.createdAt)} 백업으로 복원</AlertDialogTitle>
                <AlertDialogDescription>
                  {confirm.running
                    ? "게임을 강제로 끄고 복원한 뒤 다시 실행해요. 저장하지 않은 진행은 사라져요."
                    : "지금 세이브 폴더를 이 백업과 똑같이 바꿔요. 지금 상태는 「복원 전」 백업으로 남겨요."}
                </AlertDialogDescription>
              </AlertDialogHeader>
              {!confirm.running && (
                <div className="flex items-center justify-between gap-4">
                  <Label htmlFor="restore-launch">복원 후 게임 실행</Label>
                  <Switch
                    id="restore-launch"
                    checked={confirm.launch}
                    onCheckedChange={(launch) => setConfirm({ ...confirm, launch })}
                  />
                </div>
              )}
              <AlertDialogFooter>
                <AlertDialogCancel>취소</AlertDialogCancel>
                <AlertDialogAction
                  variant={confirm.running ? "destructive" : "default"}
                  onClick={() => void onRestore(confirm)}
                >
                  {confirm.running ? "끄고 복원" : "복원"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
          {confirm?.kind === "delete" && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>백업 삭제</AlertDialogTitle>
                <AlertDialogDescription>
                  {formatTime(confirm.backup.createdAt)} 백업을 지워요. 되돌릴 수 없어요.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>취소</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={() => void onDelete(confirm.backup)}>
                  삭제
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
