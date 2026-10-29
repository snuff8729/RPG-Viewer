import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { loadGame, type LoadResult } from "@/core/loader/loadGame";
import { buildIndex } from "@/core/index/buildIndex";
import { AssetStore } from "@/core/assets/assets";
import { DirectoryHandleFolder, FileListFolder } from "@/core/fs/browserFolders";
import type { GameFolder } from "@/core/fs/folder";
import type { GameData, GameIndex } from "@/core/types";
import { rememberGame } from "./recent";
import { recentKey, type RecentInput } from "./recentList";
import { ServerFolder, type ServerSession } from "./serverFolder";

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
  /** 뷰어 서버로 연 게임의 실제 폴더 경로(실행·백업이 그대로 쓴다). 브라우저로 열었으면 없음. */
  gamePath?: string;
  /** 최근·고정 목록에서 이 게임의 key(다시 열 수 있게 연 게임만). */
  recentKey?: string;
  error?: OpenError;
}
export interface GameContextValue extends GameState {
  openHandle(h: FileSystemDirectoryHandle): Promise<void>;
  openFiles(f: FileList): Promise<void>;
  /** 뷰어 서버가 연 폴더(실제 경로를 안다). */
  openServer(session: ServerSession): Promise<boolean>;
  /** 휴대폰 보기: PC가 공유한 게임을 연다(읽기 + 게임 보조·치트·게임 설정 파일만 쓰기, 최근 목록·실행 경로에 남기지 않는다). */
  openRemote(session: ServerSession): Promise<boolean>;
  /** 열린 게임을 닫고 시작 화면으로 돌아간다(주소의 해시도 지운다). */
  close(): void;
}

const GameContext = createContext<GameContextValue | null>(null);

export function GameProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GameState>({ status: "idle" });

  /** 연다. source가 있으면 최근 게임으로 기억한다(다시 열 수 없는 파일 목록은 없음). */
  const open = useCallback(async (
    folder: GameFolder,
    source?: { kind: "server"; path: string; name: string } | { kind: "handle"; handle: FileSystemDirectoryHandle },
  ): Promise<boolean> => {
    setState({ status: "loading" });
    try {
      const result = await loadGame(folder);
      if (!result.ok) { setState({ status: "error", error: result }); return false; }
      const index = buildIndex(result.data);
      const title = result.data.system.gameTitle;
      // ui/live/readPosition.ts의 gameKeyOf와 같은 모양.
      const gameKey = `${title}|${result.data.dataRoot}`;
      const input: RecentInput | null = !source ? null
        : source.kind === "server" ? { kind: "server", path: source.path, name: source.name, title, gameKey }
          : { kind: "handle", name: source.handle.name, title, gameKey };
      setState({
        status: "ready", data: result.data, index, assets: new AssetStore(folder, result.data), folder,
        ...(source?.kind === "server" ? { gamePath: source.path } : {}),
        ...(input ? { recentKey: recentKey(input) } : {}),
      });
      if (input) await rememberGame(input, source?.kind === "handle" ? source.handle : undefined);
      return true;
    } catch (e) {
      setState({ status: "error", error: { ok: false, reason: "internal", message: e instanceof Error ? e.message : String(e) } });
      return false;
    }
  }, []);

  const openHandle = useCallback(async (h: FileSystemDirectoryHandle) => {
    await open(new DirectoryHandleFolder(h), { kind: "handle", handle: h });
  }, [open]);
  const openFiles = useCallback(async (f: FileList) => { await open(new FileListFolder(f)); }, [open]);
  const openServer = useCallback(
    (session: ServerSession) => open(new ServerFolder(session), { kind: "server", path: session.root, name: session.name }),
    [open],
  );
  const openRemote = useCallback(
    (session: ServerSession) => open(new ServerFolder(session, undefined, { remote: true })),
    [open],
  );
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

  const value = useMemo(
    () => ({ ...state, openHandle, openFiles, openServer, openRemote, close }),
    [state, openHandle, openFiles, openServer, openRemote, close],
  );
  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useGame(): GameContextValue {
  const v = useContext(GameContext);
  if (!v) throw new Error("useGame must be used within GameProvider");
  return v;
}
