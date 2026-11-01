import { useEffect, useRef, useState } from "react";
import { useGame } from "@/app/GameProvider";
import { useLive } from "@/app/LiveProvider";
import { isRemoteView } from "@/app/share";
import { fetchSaveState, initialWatch, nextWatch, makeBackup, notifyBackupsChanged, POLL_MS, loadAutoBackup, type WatchState } from "@/app/backups";
import { useGamePath, useLauncherAvailable } from "./useGamePath";
import { gameKeyOf } from "./readPosition";
function useAutoBackupWatcher(path: string | null, enabled: boolean, running: boolean) {
  const watch = useRef<WatchState>(initialWatch);
  useEffect(() => {
    if (!path || !enabled || !running) return;
    watch.current = initialWatch;
    let alive = true;
    let busy = false;
    const tick = async () => {
      if (busy) return;
      busy = true;
      try {
        const s = await fetchSaveState(path);
        if (!alive || !s.ok) return;
        const step = nextWatch(watch.current, s.signature, Date.now());
        watch.current = step.state;
        if (step.backup) {
          const b = await makeBackup(path, "auto", "게임 저장 후");
          if (b.ok && !b.skipped) notifyBackupsChanged();
        }
      } finally {
        busy = false;
      }
    };
    const id = setInterval(() => void tick(), POLL_MS);
    return () => { alive = false; clearInterval(id); };
  }, [path, enabled, running]);
}

/** 앱에서 한 번만 마운트해요. 설정 화면이 닫혀 있어도 감시해요. */
export function AutoBackupWatcher() {
  const { data } = useGame();
  const { supported, connection } = useLive();
  const available = useLauncherAvailable();
  const key = data ? gameKeyOf(data) : null;
  const { path } = useGamePath(key);
  const [, refresh] = useState(0);
  useEffect(() => {
    const on = () => refresh(n => n + 1);
    window.addEventListener("rpgv:auto-backup", on);
    window.addEventListener("storage", on);
    return () => { window.removeEventListener("rpgv:auto-backup", on); window.removeEventListener("storage", on); };
  }, []);
  // 모듈 창에는 별도의 감시기를 만들지 않아요.
  const main = !new URLSearchParams(window.location.search).has("module");
  useAutoBackupWatcher(path, !!key && loadAutoBackup(key) && supported && available && !isRemoteView() && main, connection === "connected");
  return null;
}
