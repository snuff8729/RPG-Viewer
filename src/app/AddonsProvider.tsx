import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useGame } from "./GameProvider";
import { loadAddonFile, saveAddonFile } from "./addons";
import { isWritableFolder } from "@/core/fs/folder";
import { addonControlFlags, type AddonId, type AddonState } from "@/core/addons/registry";
import type { AddonFile } from "@/core/addons/settings";
import type { PictureRole, PictureRoles } from "@/core/addons/screenPictures";
import { gameKeyOf } from "@/ui/live/readPosition";

/** 게임별 애드온(부가 기능) 켜짐 상태와 화면 그림 구분. */
export interface AddonsValue {
  state: AddonState;
  /** 이 게임에서 켜져 있는가 */
  isOn(id: AddonId): boolean;
  /** 켜고 끈다. 클릭 핸들러 안에서 부를 것(게임 폴더 쓰기 권한 요청). */
  setOn(id: AddonId, on: boolean): void;
  /** 화면 그림 따라 그리기: 그림 번호 → 직접 고른 구분(자동이면 없음) */
  pictureRoles: PictureRoles;
  /** 그림 번호들의 구분을 정한다(null = 자동). 선택 핸들러 안에서 부를 것. */
  setPictureRole(ids: number[], role: PictureRole | null): void;
  /** 켜진 애드온이 control.json에 싣는 값 */
  controlFlags: Record<string, unknown>;
  /** 설정이 게임 폴더(rpg-viewer/addons.json)에 저장되는가(아니면 이 브라우저에만) */
  savedInFolder: boolean;
}

const EMPTY: AddonState = {};
const NO_ROLES: PictureRoles = {};
const EMPTY_FILE: AddonFile = { state: EMPTY, pictureRoles: NO_ROLES };
const NONE: AddonsValue = {
  state: EMPTY, isOn: () => false, setOn: () => {}, pictureRoles: NO_ROLES, setPictureRole: () => {}, controlFlags: {}, savedInFolder: false,
};
const AddonsContext = createContext<AddonsValue | null>(null);

interface Loaded { key: string; file: AddonFile; inFolder: boolean }

export function AddonsProvider({ children }: { children: ReactNode }) {
  const { status, data, folder } = useGame();
  const ready = status === "ready" && !!data && !!folder;
  const gameKey = ready ? gameKeyOf(data) : null;
  const dataRoot = data?.dataRoot ?? "";
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const latest = useRef({ folder, dataRoot, gameKey, loaded });
  useEffect(() => { latest.current = { folder, dataRoot, gameKey, loaded }; });

  useEffect(() => {
    if (!ready || gameKey === null) return;
    let cancelled = false;
    loadAddonFile(folder, dataRoot, gameKey).then((file) => {
      if (!cancelled) setLoaded({ key: gameKey, file, inFolder: isWritableFolder(folder) });
    });
    return () => { cancelled = true; };
  }, [ready, folder, dataRoot, gameKey]);

  const current = loaded && loaded.key === gameKey ? loaded : null;
  const state = current?.file.state ?? EMPTY;
  const pictureRoles = current?.file.pictureRoles ?? NO_ROLES;

  /** 설정을 바꿔 저장한다(쓰기 권한은 클릭 안에서 요청한다) */
  const update = useCallback((change: (prev: AddonFile) => AddonFile) => {
    const { folder: f, dataRoot: root, gameKey: key } = latest.current;
    if (key === null) return;
    const perm = f && isWritableFolder(f) ? f.requestWrite().catch(() => false) : Promise.resolve(false);
    const prev = latest.current.loaded;
    const next = change(prev && prev.key === key ? prev.file : EMPTY_FILE);
    const nextLoaded: Loaded = { key, file: next, inFolder: prev?.inFolder ?? false };
    latest.current = { ...latest.current, loaded: nextLoaded };
    setLoaded(nextLoaded);
    void perm.then(async (granted) => {
      const ok = await saveAddonFile(granted ? f : null, root, key, next);
      setLoaded((p) => (p && p.key === key && p.file === next ? { ...p, inFolder: ok } : p));
    });
  }, []);

  const setOn = useCallback((id: AddonId, on: boolean) => {
    update((prev) => ({ ...prev, state: { ...prev.state, [id]: on } }));
  }, [update]);

  const setPictureRole = useCallback((ids: number[], role: PictureRole | null) => {
    update((prev) => {
      const roles: PictureRoles = { ...prev.pictureRoles };
      for (const id of ids) {
        if (role === null) delete roles[id];
        else roles[id] = role;
      }
      return { ...prev, pictureRoles: roles };
    });
  }, [update]);

  const value = useMemo<AddonsValue>(() => ({
    state,
    isOn: (id) => state[id] === true,
    setOn,
    pictureRoles,
    setPictureRole,
    controlFlags: addonControlFlags(state),
    savedInFolder: current?.inFolder ?? false,
  }), [state, setOn, pictureRoles, setPictureRole, current?.inFolder]);

  return <AddonsContext.Provider value={value}>{children}</AddonsContext.Provider>;
}

/** 게임별 애드온 상태. AddonsProvider 밖에서는 모두 꺼짐. */
// eslint-disable-next-line react-refresh/only-export-components
export function useAddons(): AddonsValue {
  return useContext(AddonsContext) ?? NONE;
}
