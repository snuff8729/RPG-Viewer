import { useEffect, useRef } from "react";
import { useGame } from "@/app/GameProvider";
import { useAssist } from "@/app/LiveProvider";
import { fetchBackups, latestRestorable, makeBackup, notifyBackupsChanged, restoreAndRestart } from "@/app/backups";
import { isRemoteFolder } from "@/app/serverFolder";
import { isRemoteView } from "@/app/share";
import { isWritableFolder } from "@/core/fs/folder";
import { livePaths } from "@/core/live/installer";
import { claimKeyRequest, keyRequestFresh, parseKeyRequest, RESTORE_NOTICE_MS, type KeyRequest } from "@/core/live/keyRequest";
import { gameKeyOf } from "./readPosition";
import { useGamePath, useLauncherAvailable } from "./useGamePath";

const POLL_MS = 500;

const timeFormat = new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
const formatTime = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : timeFormat.format(d);
};

let storage: Storage | null = null;
try { storage = typeof localStorage === "undefined" ? null : localStorage; } catch { storage = null; }

/**
 * 게임 창 단축키의 백업·복원(플러그인 1.21.0): 게임이 쓴 rpg-viewer/request.json을 지켜보다가 새 요청을 한 번 처리하고
 * 결과를 게임 화면에 띄운다(control.json keyReply). PC의 뷰어만(휴대폰 보기는 하지 않는다). 화면에 그리는 것은 없다.
 */
export function BackupHotkeys() {
  const { data, folder } = useGame();
  const { replyKeyRequest } = useAssist();
  const available = useLauncherAvailable();
  const gameKey = data ? gameKeyOf(data) : null;
  const { path } = useGamePath(gameKey);
  const wfolder = folder && isWritableFolder(folder) && !isRemoteFolder(folder) && !isRemoteView() ? folder : null;
  const requestFile = data ? livePaths(data.dataRoot).requestFile : null;

  /** 비동기 처리에서 읽는 최신 값 */
  const latest = useRef({ path, available, replyKeyRequest });
  useEffect(() => { latest.current = { path, available, replyKeyRequest }; });

  useEffect(() => {
    if (!wfolder || !requestFile) return;
    let alive = true;
    let busy = false;
    let lastModified: number | null = null;
    const seen = new Set<string>();

    const handle = async (req: KeyRequest) => {
      const reply = (text: string) => latest.current.replyKeyRequest(req.id, text);
      const { path: p, available: ok } = latest.current;
      if (!ok) { reply("이 RPG Viewer에서는 백업을 쓸 수 없어요"); return; }
      if (!p) { reply("먼저 RPG Viewer의 백업 창에서 게임 폴더를 정해 주세요"); return; }
      if (req.kind === "backup") {
        const r = await makeBackup(p, "manual", "게임 창 단축키");
        if (!r.ok) { reply(`백업하지 못했어요: ${r.error}`); return; }
        reply("백업했어요");
        notifyBackupsChanged();
        return;
      }
      const list = await fetchBackups(p);
      if (!list.ok) { reply(`복원하지 못했어요: ${list.error}`); return; }
      const b = latestRestorable(list.backups);
      if (!b) { reply("되돌릴 백업이 없어요"); return; }
      reply(`${formatTime(b.createdAt)} 백업으로 되돌리고 게임을 다시 켜요`);
      await new Promise((r) => setTimeout(r, RESTORE_NOTICE_MS));
      const r = await restoreAndRestart(p, b.id, true);
      if (!r.ok) reply(`복원하지 못했어요: ${r.error ?? "알 수 없는 오류"}`);
      notifyBackupsChanged();
    };

    const tick = async () => {
      if (!alive) return;
      try {
        const st = await wfolder.stat(requestFile);
        if (!alive || !st || st.lastModified === lastModified) return;
        lastModified = st.lastModified;
        const req = parseKeyRequest(await wfolder.readText(requestFile));
        if (!alive || !req || !keyRequestFresh(req, Date.now()) || !claimKeyRequest(req.id, seen, storage)) return;
        if (busy) { latest.current.replyKeyRequest(req.id, "앞의 요청을 처리하는 중이에요"); return; }
        busy = true;
        try { await handle(req); } finally { busy = false; }
      } catch {
        // 다음 주기에 다시
      }
    };
    const id = setInterval(() => void tick(), POLL_MS);
    return () => { alive = false; clearInterval(id); };
  }, [wfolder, requestFile]);

  return null;
}
