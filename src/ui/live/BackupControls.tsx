import { useEffect, useState, type ReactNode } from "react";
import { ArchiveRestore, Save } from "lucide-react";
import { useGame } from "@/app/GameProvider";
import { useLive } from "@/app/LiveProvider";
import { fetchBackups, latestRestorable, makeBackup, notifyBackupsChanged, restoreAndRestart, type BackupMeta } from "@/app/backups";
import { isRemoteView } from "@/app/share";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { AssistControlSize } from "./AssistControls";
import { assistFavoriteLabel } from "./assistItems";
import { gameKeyOf } from "./readPosition";
import { useGamePath, useLauncherAvailable } from "./useGamePath";

const timeFormat = new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
const formatTime = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : timeFormat.format(d);
};

/** 결과 글을 보이는 시간 */
const NOTE_MS = 4000;

/**
 * 백업·복원 버튼 하나씩을 쓸 수 있는지: 백업 창(BackupButton)과 같은 조건(PC의 뷰어 서버, 게임 연결 지원).
 * 휴대폰 보기에서는 쓰지 않는다(null). 게임 폴더 위치를 모르면 path = null(버튼은 꺼지고 백업 창에서 정하라고 안내).
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useBackupControls(): { path: string | null } | null {
  const { data } = useGame();
  const { supported } = useLive();
  const available = useLauncherAvailable();
  const gameKey = data ? gameKeyOf(data) : null;
  const { path } = useGamePath(gameKey);
  if (isRemoteView() || !data || !gameKey || !supported || !available) return null;
  return { path };
}

/** 잠깐 보이는 결과 글 */
function useNote(): [string | null, (s: string | null) => void] {
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    if (note === null) return;
    const id = setTimeout(() => setNote(null), NOTE_MS);
    return () => clearTimeout(id);
  }, [note]);
  return [note, setNote];
}

interface Props {
  size?: AssistControlSize;
  /** 버튼 바로 옆에 둘 것(예: 즐겨찾기 ☆) */
  favorite?: ReactNode;
}

const NO_PATH = "백업 창에서 게임 폴더 위치를 먼저 정해 주세요";

/** 버튼 + 결과 글(툴팁) + 옆에 둘 것 */
function BackupControlShell({ button, tip, favorite }: { button: ReactNode; tip: string | null; favorite?: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1">
      {tip === null ? button : (
        <Tooltip open>
          <TooltipTrigger asChild><span className="inline-flex">{button}</span></TooltipTrigger>
          <TooltipContent>{tip}</TooltipContent>
        </Tooltip>
      )}
      {favorite}
    </span>
  );
}

/** `지금 백업` 한 번 누르기(백업 창의 `지금 백업`과 같다, 이름 없이). 휴대폰 보기·백업을 못 쓰는 곳에서는 그리지 않는다. */
export function BackupNowButton({ size = "sm", favorite }: Props) {
  const ctl = useBackupControls();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useNote();
  if (!ctl) return null;
  const { path } = ctl;
  const onClick = async () => {
    if (!path) return;
    setBusy(true);
    try {
      const r = await makeBackup(path, "manual", "직접 백업");
      if (!r.ok) { setNote(`백업하지 못했어요: ${r.error}`); return; }
      notifyBackupsChanged();
      setNote(r.skipped ? "바뀐 게 없어서 지난 백업을 그대로 둬요" : "백업했어요");
    } finally {
      setBusy(false);
    }
  };
  const button = (
    <Button variant="outline" size={size} disabled={!path || busy} title={path ? undefined : NO_PATH} onClick={() => void onClick()}>
      <Save />{busy ? "백업 중…" : assistFavoriteLabel("backup")}
    </Button>
  );
  return <BackupControlShell button={button} tip={note} favorite={favorite} />;
}

/**
 * `마지막 백업으로 복원`: 게임 창 단축키 복원과 같은 백업(latestRestorable — 가장 최근의 직접·자동 백업)으로 되돌리고 게임을 다시 켠다.
 * 누르면 그 백업 시각을 보여 주고 한 번 더 묻는다. 휴대폰 보기·백업을 못 쓰는 곳에서는 그리지 않는다.
 */
export function RestoreLatestButton({ size = "sm", favorite }: Props) {
  const ctl = useBackupControls();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useNote();
  const [target, setTarget] = useState<BackupMeta | null>(null);
  if (!ctl) return null;
  const { path } = ctl;
  const onClick = async () => {
    if (!path) return;
    setBusy(true);
    try {
      const list = await fetchBackups(path);
      if (!list.ok) { setNote(`백업 목록을 읽지 못했어요: ${list.error}`); return; }
      const b = latestRestorable(list.backups);
      if (!b) { setNote("되돌릴 백업이 없어요"); return; }
      setTarget(b);
    } finally {
      setBusy(false);
    }
  };
  const onRestore = async (b: BackupMeta) => {
    if (!path) return;
    setBusy(true);
    try {
      const r = await restoreAndRestart(path, b.id, true);
      if (!r.ok) setNote(`복원하지 못했어요: ${r.error ?? "알 수 없는 오류"}`);
      else if (r.error) setNote(`복원했지만 게임을 다시 실행하지 못했어요: ${r.error}`);
      else setNote(r.relaunched ? "복원하고 게임을 실행했어요" : "복원했어요");
      notifyBackupsChanged();
    } finally {
      setBusy(false);
    }
  };
  const button = (
    <Button variant="outline" size={size} disabled={!path || busy} title={path ? undefined : NO_PATH} onClick={() => void onClick()}>
      <ArchiveRestore />{busy ? "복원 중…" : assistFavoriteLabel("restore")}
    </Button>
  );
  return (
    <>
      <BackupControlShell button={button} tip={note} favorite={favorite} />
      <AlertDialog open={target !== null} onOpenChange={(o) => { if (!o) setTarget(null); }}>
        <AlertDialogContent size="sm">
          {target && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>{formatTime(target.createdAt)} 백업으로 복원</AlertDialogTitle>
                <AlertDialogDescription>
                  게임이 켜져 있으면 끄고 복원한 뒤 다시 실행해요. 저장하지 않은 진행은 사라져요. 지금 상태는 「복원 전」 백업으로 남겨요.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>취소</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={() => void onRestore(target)}>복원</AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
