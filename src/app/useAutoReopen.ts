import { useEffect, useRef } from "react";
import { useGame } from "./GameProvider";
import { findRecent, loadHandle } from "./recent";
import { openFolderOnServer } from "./serverFolder";

type PermHandle = FileSystemDirectoryHandle & { queryPermission?: (d: { mode: "read" }) => Promise<PermissionState> };

/**
 * 따로 띄운 플레이 창: 처음 한 번, 최근 게임 key로 같은 게임을 다시 연다.
 * 서버로 연 게임은 경로로, 브라우저로 연 게임은 이미 허락받았을 때만(창이 새로 묻지 않는다). 못 열면 시작 화면이 그대로 보인다.
 */
export function useAutoReopen(key: string | null): void {
  const { status, openServer, openHandle } = useGame();
  const tried = useRef(false);
  useEffect(() => {
    if (!key || tried.current || status !== "idle") return;
    tried.current = true;
    const it = findRecent(key);
    if (!it) return;
    void (async () => {
      try {
        if (it.kind === "server") {
          if (!it.path) return;
          const r = await openFolderOnServer(it.path);
          if (r.ok && "session" in r) await openServer(r.session);
          return;
        }
        const handle = await loadHandle(it.key);
        if (!handle) return;
        if ((await (handle as PermHandle).queryPermission?.({ mode: "read" })) !== "granted") return;
        await openHandle(handle);
      } catch { /* 시작 화면에서 직접 연다 */ }
    })();
  }, [key, status, openServer, openHandle]);
}
