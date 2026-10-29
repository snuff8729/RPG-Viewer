import { useCallback, useEffect, useRef, useState } from "react";
import { useGame } from "./GameProvider";
import { fetchSharedSession, REMOTE_CHECK_MS } from "./share";

/**
 * 휴대폰 보기: PC가 공유한 게임을 열고(쓰기는 게임 보조·치트·게임 설정 파일만), 몇 초마다 공유 상태를 다시 본다.
 * - 꺼짐·기간 끝·QR 바뀜이면 서버가 준 문구(error)
 * - PC가 다른 게임을 열어 공유 게임이 바뀌면 그 게임을 다시 연다
 */
export function useRemoteGame(enabled: boolean): { error: string | null; retry: () => void } {
  const { openRemote } = useGame();
  const [error, setError] = useState<string | null>(null);
  const openedId = useRef<string | null>(null);
  const busy = useRef(false);

  const check = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const r = await fetchSharedSession();
      if (!r.ok) { setError(r.error); return; }
      setError(null);
      if (r.session.id !== openedId.current) {
        openedId.current = r.session.id;
        await openRemote(r.session);
      }
    } finally {
      busy.current = false;
    }
  }, [openRemote]);

  useEffect(() => {
    if (!enabled) return;
    void check();
    const id = setInterval(() => { if (document.visibilityState === "visible") void check(); }, REMOTE_CHECK_MS);
    // 홈 화면에서 다시 열거나 화면을 켜면 바로 확인
    const onVisible = () => { if (document.visibilityState === "visible") void check(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onVisible); };
  }, [enabled, check]);

  const retry = useCallback(() => { void check(); }, [check]);
  return { error, retry };
}
