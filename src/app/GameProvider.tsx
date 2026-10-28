import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { loadGame, type LoadResult } from "@/core/loader/loadGame";
import { buildIndex } from "@/core/index/buildIndex";
import { AssetStore } from "@/core/assets/assets";
import { DirectoryHandleFolder, FileListFolder } from "@/core/fs/browserFolders";
import type { GameFolder } from "@/core/fs/folder";
import type { GameData, GameIndex } from "@/core/types";
import { saveRecent } from "./recent";

/** 화면용 오류: 로더가 돌려준 실패 + 로드/색인 중 예기치 못한 예외(internal). */
export type OpenError =
  | Exclude<LoadResult, { ok: true }>
  | { ok: false; reason: "internal"; message: string };

export interface GameState {
  status: "idle" | "loading" | "ready" | "error";
  data?: GameData;
  index?: GameIndex;
  assets?: AssetStore;
  /** 열린 게임 폴더(ready일 때). 쓰기 가능 여부는 isWritableFolder로 확인. */
  folder?: GameFolder;
  error?: OpenError;
}
export interface GameContextValue extends GameState {
  openHandle(h: FileSystemDirectoryHandle): Promise<void>;
  openFiles(f: FileList): Promise<void>;
  /** 열린 게임을 닫고 시작 화면으로 돌아간다(주소의 해시도 지운다). */
  close(): void;
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
      setState({ status: "ready", data: result.data, index, assets: new AssetStore(folder, result.data), folder });
      return true;
    } catch (e) {
      setState({ status: "error", error: { ok: false, reason: "internal", message: e instanceof Error ? e.message : String(e) } });
      return false;
    }
  }, []);

  const openHandle = useCallback(async (h: FileSystemDirectoryHandle) => {
    if (await open(new DirectoryHandleFolder(h))) await saveRecent(h);
  }, [open]);
  const openFiles = useCallback(async (f: FileList) => { await open(new FileListFolder(f)); }, [open]);
  const close = useCallback(() => {
    setState({ status: "idle" });
    if (window.location.hash) {
      window.location.hash = "";
      history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  }, []);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as { __rpgViewer?: Record<string, unknown> };
    w.__rpgViewer = {
      openFolder: async (folder: GameFolder) => { await open(folder); },
      openFixture: async (name: "sample-mz" | "sample-mv") => {
        const { loadFixtureOverHttp } = await import("./devFixture");
        await open(await loadFixtureOverHttp(name));
      },
    };
    return () => { delete w.__rpgViewer; };
  }, [open]);

  const value = useMemo(() => ({ ...state, openHandle, openFiles, close }), [state, openHandle, openFiles, close]);
  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useGame(): GameContextValue {
  const v = useContext(GameContext);
  if (!v) throw new Error("useGame must be used within GameProvider");
  return v;
}
