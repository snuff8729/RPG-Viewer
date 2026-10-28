import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useGame } from "./GameProvider";
import { loadAddonState, saveAddonState } from "./addons";
import { isWritableFolder } from "@/core/fs/folder";
import { addonControlFlags, type AddonId, type AddonState } from "@/core/addons/registry";
import { gameKeyOf } from "@/ui/live/readPosition";

/** 게임별 애드온(부가 기능) 켜짐 상태. */
export interface AddonsValue {
  state: AddonState;
  /** 이 게임에서 켜져 있는가 */
  isOn(id: AddonId): boolean;
  /** 켜고 끈다. 클릭 핸들러 안에서 부를 것(게임 폴더 쓰기 권한 요청). */
  setOn(id: AddonId, on: boolean): void;
  /** 켜진 애드온이 control.json에 싣는 값 */
  controlFlags: Record<string, unknown>;
  /** 설정이 게임 폴더(rpg-viewer/addons.json)에 저장되는가(아니면 이 브라우저에만) */
  savedInFolder: boolean;
}

const EMPTY: AddonState = {};
const NONE: AddonsValue = { state: EMPTY, isOn: () => false, setOn: () => {}, controlFlags: {}, savedInFolder: false };
const AddonsContext = createContext<AddonsValue | null>(null);

export function AddonsProvider({ children }: { children: ReactNode }) {
  const { status, data, folder } = useGame();
  const ready = status === "ready" && !!data && !!folder;
  const gameKey = ready ? gameKeyOf(data) : null;
  const dataRoot = data?.dataRoot ?? "";
  const [loaded, setLoaded] = useState<{ key: string; state: AddonState; inFolder: boolean } | null>(null);
  const latest = useRef({ folder, dataRoot, gameKey, loaded });
  useEffect(() => { latest.current = { folder, dataRoot, gameKey, loaded }; });

  useEffect(() => {
    if (!ready || gameKey === null) return;
    let cancelled = false;
    loadAddonState(folder, dataRoot, gameKey).then((state) => {
      if (!cancelled) setLoaded({ key: gameKey, state, inFolder: isWritableFolder(folder) });
    });
    return () => { cancelled = true; };
  }, [ready, folder, dataRoot, gameKey]);

  const current = loaded && loaded.key === gameKey ? loaded : null;
  const state = current?.state ?? EMPTY;

  const setOn = useCallback((id: AddonId, on: boolean) => {
    const { folder: f, dataRoot: root, gameKey: key } = latest.current;
    if (key === null) return;
    // 쓰기 권한은 클릭 안에서 요청한다
    const perm = f && isWritableFolder(f) ? f.requestWrite().catch(() => false) : Promise.resolve(false);
    const prev = latest.current.loaded;
    const next: AddonState = { ...(prev && prev.key === key ? prev.state : EMPTY), [id]: on };
    const nextLoaded = { key, state: next, inFolder: prev?.inFolder ?? false };
    latest.current = { ...latest.current, loaded: nextLoaded };
    setLoaded(nextLoaded);
    void perm.then(async (granted) => {
      const ok = await saveAddonState(granted ? f : null, root, key, next);
      setLoaded((p) => (p && p.key === key && p.state === next ? { ...p, inFolder: ok } : p));
    });
  }, []);

  const value = useMemo<AddonsValue>(() => ({
    state,
    isOn: (id) => state[id] === true,
    setOn,
    controlFlags: addonControlFlags(state),
    savedInFolder: current?.inFolder ?? false,
  }), [state, setOn, current?.inFolder]);

  return <AddonsContext.Provider value={value}>{children}</AddonsContext.Provider>;
}

/** 게임별 애드온 상태. AddonsProvider 밖에서는 모두 꺼짐. */
// eslint-disable-next-line react-refresh/only-export-components
export function useAddons(): AddonsValue {
  return useContext(AddonsContext) ?? NONE;
}
