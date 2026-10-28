import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { useGame } from "@/app/GameProvider";
import { useLive, useLiveStatus } from "@/app/LiveProvider";
import { fetchRunning } from "@/app/backups";
import { deleteBranches, gameRunningBlock, latestBackupTime, planRequest, undoLastDeletion, type DeleteRequest } from "@/app/logEdit";
import { isWritableFolder } from "@/core/fs/folder";
import { byteLength } from "@/core/live/logMaintenance";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { formatBytes } from "./formatBytes";
import { gameKeyOf } from "./readPosition";
import { shortDateTime } from "./branchText";
import { useGamePath, useLauncherAvailable } from "./useGamePath";

const DELETE_NOTE = "본 기록(안 본 내용 계산)은 그대로 유지돼요. 지운 갈래의 대사는 다시 볼 수 없어요. 지우기 전에 기록 파일을 자동으로 백업해요.";
const NO_FOLDER = "이 게임 폴더에는 쓸 수 없어요";
const NO_WRITE = "쓰기 권한이 필요해요";

/** 기록 파일을 고치는 데 필요한 것: 쓸 수 있는 폴더, 게임이 꺼져 있는지 확인. */
function useLogEditor() {
  const { data, folder } = useGame();
  const { connection, reloadLog } = useLive();
  const launcher = useLauncherAvailable();
  const { path: gamePath } = useGamePath(data ? gameKeyOf(data) : null);
  const wfolder = folder && isWritableFolder(folder) ? folder : null;
  const dataRoot = data?.dataRoot ?? null;
  const connected = connection === "connected";
  const checkStopped = () => gameRunningBlock(connected, { launcher, gamePath, fetchRunning });
  return { data, wfolder, dataRoot, checkStopped, reloadLog, connected, launcher, gamePath };
}

/** 열릴 때 게임이 켜져 있는지 확인(막는 이유 또는 null, 확인 중이면 undefined). */
function useBlockOnOpen(open: boolean, check: () => Promise<string | null>, deps: unknown[]): string | null | undefined {
  const [state, setState] = useState<{ key: string; block: string | null } | null>(null);
  const key = JSON.stringify([open, ...deps]);
  // check는 렌더마다 새 함수지만 deps로 정해진다 — 최신 것을 ref로 읽는다
  const checkRef = useRef(check);
  useEffect(() => { checkRef.current = check; });
  useEffect(() => {
    if (!open) return;
    let alive = true;
    void checkRef.current().then(block => { if (alive) setState({ key, block }); });
    return () => { alive = false; };
  }, [open, key]);
  return state?.key === key ? state.block : undefined;
}

/**
 * 갈래 영구 삭제 확인 창. request가 null이면 닫힘. nameOf: 대표 갈래 id → 화면 이름.
 * 미리보기는 뷰어가 읽은 기록으로, 실제 삭제는 그때 파일을 다시 읽어 같은 규칙으로 계획한다.
 */
export function DeleteBranchesDialog({ request, onClose, nameOf }: {
  request: DeleteRequest | null; onClose: () => void; nameOf: (id: number) => string;
}) {
  const { records } = useLive();
  const { logStats } = useLiveStatus();
  const ed = useLogEditor();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = request !== null;
  const plan = useMemo(() => (request ? planRequest(records, request) : null), [records, request]);
  const block = useBlockOnOpen(open, ed.checkStopped, [ed.connected, ed.launcher, ed.gamePath]);

  const removedBytes = useMemo(
    () => (plan ? plan.dropped.reduce((n, r) => n + byteLength(JSON.stringify(r)) + 1, 0) : 0),
    [plan],
  );
  const before = logStats?.bytes ?? null;

  const close = () => { if (!busy) { setError(null); onClose(); } };
  const run = async (e: MouseEvent) => {
    e.preventDefault();
    if (!request || !ed.wfolder || ed.dataRoot === null || !ed.data) { setError(NO_FOLDER); return; }
    // 쓰기 권한은 클릭 안에서 바로 요청한다
    const granted = await ed.wfolder.requestWrite().catch(() => false);
    if (!granted) { setError(NO_WRITE); return; }
    setBusy(true);
    setError(null);
    const res = await deleteBranches(
      { folder: ed.wfolder, dataRoot: ed.dataRoot, data: ed.data, checkStopped: ed.checkStopped }, request,
    ).catch(() => ({ ok: false as const, message: "지우지 못했어요" }));
    setBusy(false);
    if (!res.ok) { setError(res.message); return; }
    ed.reloadLog();
    onClose();
  };

  const removedCount = plan?.removedBranches.length ?? 0;
  const nothing = !plan || plan.dropped.length === 0;
  return (
    <AlertDialog open={open} onOpenChange={o => { if (!o) close(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {request?.mode === "keep" ? "고정한 갈래만 남기고 영구 삭제할까요?" : "이 갈래를 영구 삭제할까요?"}
          </AlertDialogTitle>
          <AlertDialogDescription>{DELETE_NOTE}</AlertDialogDescription>
        </AlertDialogHeader>
        {plan && (
          <div className="space-y-2 text-sm">
            <ul className="list-disc space-y-1 pl-5">
              <li>지우는 갈래 {removedCount}개, 대사 {plan.removedLines}줄</li>
              {before !== null && (
                <li>기록 파일 {formatBytes(before)} → 약 {formatBytes(Math.max(0, before - removedBytes))}</li>
              )}
            </ul>
            {plan.dependents.length > 0 && (
              <Alert>
                <AlertDescription>
                  이 갈래에서 이어진 갈래도 같이 지워져요: {plan.dependents.map(nameOf).join(", ")}
                </AlertDescription>
              </Alert>
            )}
            {plan.partialBranches.length > 0 && (
              <div className="space-y-1">
                <p className="text-muted-foreground">앞부분만 남김(남기는 갈래가 이어 간 부분까지):</p>
                <ul className="list-disc space-y-1 pl-5">
                  {plan.partialBranches.map(p => (
                    <li key={p.id}>
                      {nameOf(p.id)}
                      {p.neededBy.length > 0 && <span className="text-muted-foreground"> — {p.neededBy.map(nameOf).join(", ")}에 필요</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
        {block && <Alert variant="destructive"><AlertDescription>{block}</AlertDescription></Alert>}
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>취소</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive" disabled={busy || nothing || block !== null || !ed.wfolder}
            onClick={e => { void run(e); }}
          >
            {busy ? "지우는 중…" : "영구 삭제"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** 마지막 영구 삭제 되돌리기 확인 창(가장 최근 백업으로). */
export function UndoDeleteDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ed = useLogEditor();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [latest, setLatest] = useState<{ t: number | null } | null>(null);
  const block = useBlockOnOpen(open, ed.checkStopped, [ed.connected, ed.launcher, ed.gamePath]);

  useEffect(() => {
    if (!open || !ed.wfolder || ed.dataRoot === null) return;
    let alive = true;
    void latestBackupTime(ed.wfolder, ed.dataRoot).then(t => { if (alive) setLatest({ t }); });
    return () => { alive = false; };
  }, [open, ed.wfolder, ed.dataRoot]);

  const close = () => { if (!busy) { setError(null); setLatest(null); onClose(); } };
  const run = async (e: MouseEvent) => {
    e.preventDefault();
    if (!ed.wfolder || ed.dataRoot === null) { setError(NO_FOLDER); return; }
    const granted = await ed.wfolder.requestWrite().catch(() => false);
    if (!granted) { setError(NO_WRITE); return; }
    setBusy(true);
    setError(null);
    const res = await undoLastDeletion({ folder: ed.wfolder, dataRoot: ed.dataRoot, checkStopped: ed.checkStopped })
      .catch(() => ({ ok: false as const, message: "되돌리지 못했어요" }));
    setBusy(false);
    if (!res.ok) { setError(res.message); return; }
    ed.reloadLog();
    setLatest(null);
    onClose();
  };

  const t = latest?.t ?? null;
  return (
    <AlertDialog open={open} onOpenChange={o => { if (!o) close(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>마지막 삭제를 되돌릴까요?</AlertDialogTitle>
          <AlertDialogDescription>
            {latest === null
              ? "백업을 찾는 중…"
              : t === null
                ? "되돌릴 백업이 없어요."
                : `${shortDateTime(t)}에 지우기 전 백업으로 기록 파일을 되돌려요. 그 뒤에 새로 플레이한 기록은 그대로 남아요.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {block && <Alert variant="destructive"><AlertDescription>{block}</AlertDescription></Alert>}
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>취소</AlertDialogCancel>
          <AlertDialogAction disabled={busy || t === null || block !== null || !ed.wfolder} onClick={e => { void run(e); }}>
            {busy ? "되돌리는 중…" : "되돌리기"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
