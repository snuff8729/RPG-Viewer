import { useEffect, useState } from "react";
import { useGame } from "@/app/GameProvider";
import { launcherAvailable, loadGamePath, onGamePathChanged, saveGamePath } from "@/app/launcher";

/** 뷰어 서버에 게임 실행·백업 API가 있는지. */
export function useLauncherAvailable(): boolean {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    let alive = true;
    void launcherAvailable().then((ok) => { if (alive) setAvailable(ok); });
    return () => { alive = false; };
  }, []);
  return available;
}

/**
 * 실행·백업이 쓸 게임 폴더 경로. 뷰어 서버로 연 게임이면 그 실제 경로를 그대로 쓰고(묻지 않는다, fromServer),
 * 브라우저로 연 게임이면 게임마다 기억한 경로(없으면 null → 경로 입력 창).
 */
export function useGamePath(gameKey: string | null): { path: string | null; save: (path: string) => void; fromServer: boolean } {
  const { gamePath } = useGame();
  const [saved, save] = useSavedGamePath(gameKey);
  return gamePath ? { path: gamePath, save, fromServer: true } : { path: saved, save, fromServer: false };
}

/** 게임마다 기억한 게임 폴더 경로. 다른 버튼에서 바꿔도 따라간다. */
function useSavedGamePath(gameKey: string | null): [string | null, (path: string) => void] {
  const [state, setState] = useState(() => ({ key: gameKey, path: gameKey ? loadGamePath(gameKey) : null }));
  let current = state;
  if (state.key !== gameKey) {
    current = { key: gameKey, path: gameKey ? loadGamePath(gameKey) : null };
    setState(current);
  }
  useEffect(() => onGamePathChanged(() => {
    if (gameKey) {
      const p = loadGamePath(gameKey);
      if (p !== null) setState({ key: gameKey, path: p });
    }
  }), [gameKey]);
  const save = (path: string) => {
    if (!gameKey) return;
    setState({ key: gameKey, path });
    saveGamePath(gameKey, path);
  };
  return [current.path, save];
}
