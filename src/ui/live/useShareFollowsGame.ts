import { useEffect } from "react";
import { useGame } from "@/app/GameProvider";
import { shareGame } from "@/app/share";
import { gameKeyOf } from "./readPosition";
import { useGamePath, useLauncherAvailable } from "./useGamePath";

/**
 * PC가 게임을 열 때마다(경로를 알면) 휴대폰 보기의 공유 게임을 바꾼다. 꺼져 있으면 서버가 무시한다.
 * 휴대폰은 공유 상태를 주기적으로 확인하다가 게임이 바뀌면 다시 연다.
 */
export function useShareFollowsGame(enabled: boolean): void {
  const { data } = useGame();
  const available = useLauncherAvailable();
  const { path } = useGamePath(data ? gameKeyOf(data) : null);
  useEffect(() => {
    if (!enabled || !available || !path) return;
    void shareGame(path);
  }, [enabled, available, path, data]);
}
