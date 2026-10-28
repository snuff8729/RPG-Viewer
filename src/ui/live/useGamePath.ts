import { useEffect, useState } from "react";
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

/** 게임마다 기억한 게임 폴더 경로. 다른 버튼에서 바꿔도 따라간다. */
export function useGamePath(gameKey: string | null): [string | null, (path: string) => void] {
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
