import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { loadGame, type LoadResult } from "@/core/loader/loadGame";
import { buildIndex } from "@/core/index/buildIndex";
import { AssetStore } from "@/core/assets/assets";
import { DirectoryHandleFolder, FileListFolder } from "@/core/fs/browserFolders";
import type { GameFolder } from "@/core/fs/folder";
import type { GameData, GameIndex } from "@/core/types";
import { saveRecent } from "./recent";

export interface GameState {
  status: "idle" | "loading" | "ready" | "error";
  data?: GameData;
  index?: GameIndex;
  assets?: AssetStore;
  error?: LoadResult;
}
export interface GameContextValue extends GameState {
  openHandle(h: FileSystemDirectoryHandle): Promise<void>;
  openFiles(f: FileList): Promise<void>;
}

const GameContext = createContext<GameContextValue | null>(null);

export function GameProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GameState>({ status: "idle" });

  const open = useCallback(async (folder: GameFolder): Promise<boolean> => {
    setState({ status: "loading" });
    try {
      const result = await loadGame(folder);
      if (!result.ok) { setState({ status: "error", error: result }); return false; }
      const index = buildIndex(result.data);
      setState({ status: "ready", data: result.data, index, assets: new AssetStore(folder, result.data) });
      return true;
    } catch (e) {
      setState({ status: "error", error: { ok: false, reason: "notFound", searched: [e instanceof Error ? e.message : String(e)] } });
      return false;
    }
  }, []);

  const openHandle = useCallback(async (h: FileSystemDirectoryHandle) => {
    if (await open(new DirectoryHandleFolder(h))) await saveRecent(h);
  }, [open]);
  const openFiles = useCallback(async (f: FileList) => { await open(new FileListFolder(f)); }, [open]);

  const value = useMemo(() => ({ ...state, openHandle, openFiles }), [state, openHandle, openFiles]);
  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useGame(): GameContextValue {
  const v = useContext(GameContext);
  if (!v) throw new Error("useGame must be used within GameProvider");
  return v;
}
