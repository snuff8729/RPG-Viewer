import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useGame } from "./GameProvider";
import { addonFileText, loadAddonFile, readAddonFolderFile, updateAddonFile } from "./addons";
import { syncPictureWants } from "./pictureWants";
import { isWritableFolder } from "@/core/fs/folder";
import { addonControlFlags, type AddonId, type AddonState } from "@/core/addons/registry";
import { cleanStoryProgress, type AddonFile } from "@/core/addons/settings";
import { cleanNoticeHooks } from "@/core/addons/notices";
import { cleanHiddenImages } from "@/core/addons/hiddenImages";
import { keyText, parseKeyText, type StoryKey } from "@/core/story/progress";
import type { PictureRole, PictureRoles, SpriteRoles } from "@/core/addons/screenPictures";
import { gameKeyOf } from "@/ui/live/readPosition";
import { BUNDLED_ADAPTERS } from "./adapterBundle";
import type { BundledAdapter } from "@/core/adapters/bundle";
import { adapterControlFlags, applyAddonDefaults, defaultRoleOf, matchesGame, roleDefaultsOf } from "@/core/adapters/manifest";
import type { ScreenPicture } from "@/core/addons/screenPictures";

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
  /** 플러그인이 띄운 그림(1.10.0): 이름 열쇠 → 직접 고른 구분 */
  spriteRoles: SpriteRoles;
  /** 이름 열쇠들의 구분을 정한다(null = 자동). 선택 핸들러 안에서 부를 것. */
  setSpriteRole(keys: string[], role: PictureRole | null): void;
  /** 알림 문구 기록: 직접 추가한 함수 경로(Global.path.to.fn) */
  noticeHooks: string[];
  /** 직접 추가한 함수 경로를 바꾼다(쓸 수 없는 경로는 버린다). 클릭 핸들러 안에서 부를 것. */
  setNoticeHooks(paths: string[]): void;
  /** 직접 고른 이야기 진행 기준(없으면 자동) */
  storyProgress: StoryKey | null;
  /** 이야기 진행 기준을 정한다(null = 자동). 선택 핸들러 안에서 부를 것. */
  setStoryProgress(key: StoryKey | null): void;
  /** 켜진 애드온이 control.json에 싣는 값 */
  controlFlags: Record<string, unknown>;
  /** 설정이 게임 폴더(rpg-viewer/addons.json)에 저장되는가(아니면 이 브라우저에만) */
  savedInFolder: boolean;
  /** 이 게임에 맞는 게임 전용 어댑터(뷰어에 들어 있는 것 중) */
  adapters: readonly BundledAdapter[];
  /** 이 게임에서 켠 어댑터(맞는 것 중) */
  enabledAdapters: readonly BundledAdapter[];
  isAdapterOn(id: string): boolean;
  /** 어댑터를 켜고 끈다(켤 때 기본 애드온도 켠다). 클릭 핸들러 안에서 부를 것. 게임 쪽 확장 설치는 부르는 쪽이 한다. */
  setAdapterOn(id: string, on: boolean): void;
  /** 읽기에서 숨길 그림 이름(그대로 또는 `앞부분*`) */
  hiddenImages: string[];
  /** 숨길 그림 목록을 바꾼다(쓸 수 없는 것은 버린다). 클릭 핸들러 안에서 부를 것. */
  setHiddenImages(patterns: string[]): void;
  /** 켠 어댑터들이 정한 그림 기본 구분(없으면 null) */
  defaultRole: ((p: ScreenPicture) => PictureRole | null) | null;
  /** 어댑터 카드의 설정이 켜져 있는가(기본 꺼짐) */
  isAdapterOptionOn(adapterId: string, optionId: string): boolean;
  /** 어댑터 카드의 설정을 켜고 끈다. 클릭 핸들러 안에서 부를 것. */
  setAdapterOption(adapterId: string, optionId: string, on: boolean): void;
  /** 메뉴 화면 그림(screen 기록 scene "menu")도 읽기에 보이는가: 켠 어댑터의 `메뉴 화면 그림도 기록`이 켜졌을 때만 */
  menuPicturesShown: boolean;
}

const EMPTY: AddonState = {};
const NO_ROLES: PictureRoles = {};
const NO_HOOKS: string[] = [];
const NO_SPRITE_ROLES: SpriteRoles = {};
const NO_HIDDEN: string[] = [];
const EMPTY_FILE: AddonFile = { state: EMPTY, pictureRoles: NO_ROLES };
const NONE: AddonsValue = {
  state: EMPTY, isOn: () => false, setOn: () => {}, pictureRoles: NO_ROLES, setPictureRole: () => {},
  spriteRoles: NO_SPRITE_ROLES, setSpriteRole: () => {}, noticeHooks: NO_HOOKS, setNoticeHooks: () => {},
  storyProgress: null, setStoryProgress: () => {}, controlFlags: {}, savedInFolder: false,
  adapters: [], enabledAdapters: [], isAdapterOn: () => false, setAdapterOn: () => {}, defaultRole: null,
  isAdapterOptionOn: () => false, setAdapterOption: () => {}, menuPicturesShown: false,
  hiddenImages: NO_HIDDEN, setHiddenImages: () => {},
};
const NO_OPTIONS: Record<string, Record<string, boolean>> = {};
/** 다른 뷰어가 바꾼 설정 파일을 확인하는 간격 */
const ADDONS_POLL_MS = 3000;
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

  // 게임을 열 때 한 번: 게임 폴더에 없는 그림 목록을 기록 플러그인에 넘긴다(rpg-viewer/missing-pictures.json, 쓸 수 있을 때만)
  useEffect(() => {
    if (!ready || !data || !folder) return;
    void syncPictureWants(folder, data);
  }, [ready, folder, data]);

  const current = loaded && loaded.key === gameKey ? loaded : null;
  const state = current?.file.state ?? EMPTY;
  const pictureRoles = current?.file.pictureRoles ?? NO_ROLES;
  const noticeHooks = current?.file.noticeHooks ?? NO_HOOKS;
  const spriteRoles = current?.file.spriteRoles ?? NO_SPRITE_ROLES;
  const hiddenImages = current?.file.hiddenImages ?? NO_HIDDEN;
  const adapterState = current?.file.adapters;
  const enabledPlugins = data?.enabledPlugins;
  const gameTitle = data?.system.gameTitle;
  const adapters = useMemo(
    () => BUNDLED_ADAPTERS.filter((a) => matchesGame(a.manifest, { plugins: enabledPlugins ?? [], gameTitle })),
    [enabledPlugins, gameTitle],
  );
  const enabledAdapters = useMemo(() => adapters.filter((a) => adapterState?.[a.manifest.id] === true), [adapters, adapterState]);
  const defaultRole = useMemo(() => {
    const d = roleDefaultsOf(enabledAdapters.map((a) => a.manifest));
    if (d.pictureRoles.length === 0 && d.spriteRoles.length === 0) return null;
    return (p: ScreenPicture) => defaultRoleOf(p, d);
  }, [enabledAdapters]);
  const adapterOptions = current?.file.adapterOptions ?? NO_OPTIONS;
  const adapterFlags = useMemo(
    () => adapterControlFlags(enabledAdapters.map((a) => a.manifest), (id, opt) => adapterOptions[id]?.[opt] === true),
    [enabledAdapters, adapterOptions],
  );
  const addonFlags = useMemo(() => addonControlFlags(state, { noticeHooks }), [state, noticeHooks]);
  const controlFlags = useMemo(() => ({ ...addonFlags, ...adapterFlags }), [addonFlags, adapterFlags]);
  const storyText = current?.file.storyProgress ?? null;
  const storyProgress = useMemo(() => parseKeyText(storyText), [storyText]);

  /** 저장을 하나씩(읽고-고쳐-쓰기가 서로 겹치지 않게). saving = 아직 끝나지 않은 저장 수 */
  const saveChain = useRef<Promise<void>>(Promise.resolve());
  const saving = useRef(0);

  /**
   * 설정을 바꿔 저장한다(쓰기 권한은 클릭 안에서 요청한다). 화면에는 바로 보이고, 저장은 폴더의 지금 파일에 이번 변경만 얹는다
   * — PC와 휴대폰 보기가 같은 addons.json을 바꿔도 서로의 변경을 지우지 않는다.
   */
  const update = useCallback((change: (prev: AddonFile) => AddonFile) => {
    const { folder: f, dataRoot: root, gameKey: key } = latest.current;
    if (key === null) return;
    const perm = f && isWritableFolder(f) ? f.requestWrite().catch(() => false) : Promise.resolve(false);
    const prev = latest.current.loaded;
    const base = prev && prev.key === key ? prev.file : EMPTY_FILE;
    const next = change(base);
    const nextLoaded: Loaded = { key, file: next, inFolder: prev?.inFolder ?? false };
    latest.current = { ...latest.current, loaded: nextLoaded };
    setLoaded(nextLoaded);
    saving.current++;
    saveChain.current = saveChain.current.then(async () => {
      try {
        const granted = await perm;
        const r = await updateAddonFile(granted ? f : null, root, key, next, granted ? change : (p) => p);
        // 그사이 다른 변경이 없을 때만 저장한 내용(다른 뷰어의 변경이 섞였을 수 있다)으로 맞춘다.
        setLoaded((p) => {
          if (!p || p.key !== key || p.file !== next) return p;
          const done: Loaded = { key, file: r.file, inFolder: r.inFolder };
          if (latest.current.loaded === p) latest.current = { ...latest.current, loaded: done };
          return done;
        });
      } finally {
        saving.current--;
      }
    }).catch(() => { /* 조용히 */ });
  }, []);

  // 다른 뷰어(PC·휴대폰 보기)가 바꾼 설정을 따라간다: 폴더의 파일을 몇 초마다 읽어, 저장 중이 아니고 내용이 다르면 받아들인다.
  useEffect(() => {
    if (!ready || gameKey === null || !folder || !isWritableFolder(folder)) return;
    let cancelled = false;
    const poll = async () => {
      if (document.visibilityState !== "visible" || saving.current > 0) return;
      const disk = await readAddonFolderFile(folder, dataRoot);
      if (cancelled || !disk || saving.current > 0) return;
      const cur = latest.current.loaded;
      if (!cur || cur.key !== gameKey || addonFileText(cur.file) === addonFileText(disk)) return;
      const done: Loaded = { key: gameKey, file: disk, inFolder: true };
      latest.current = { ...latest.current, loaded: done };
      setLoaded(done);
    };
    const id = setInterval(() => { void poll(); }, ADDONS_POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [ready, folder, dataRoot, gameKey]);

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

  const setSpriteRole = useCallback((keys: string[], role: PictureRole | null) => {
    update((prev) => {
      const roles: SpriteRoles = { ...(prev.spriteRoles ?? {}) };
      for (const k of keys) {
        if (role === null) delete roles[k];
        else roles[k] = role;
      }
      const next: AddonFile = { ...prev };
      if (Object.keys(roles).length > 0) next.spriteRoles = roles; else delete next.spriteRoles;
      return next;
    });
  }, [update]);

  const setAdapterOn = useCallback((id: string, on: boolean) => {
    const manifest = BUNDLED_ADAPTERS.find((a) => a.manifest.id === id)?.manifest ?? null;
    update((prev) => ({
      ...prev,
      state: on ? applyAddonDefaults(prev.state, manifest) : prev.state,
      adapters: { ...(prev.adapters ?? {}), [id]: on },
    }));
  }, [update]);

  const setAdapterOption = useCallback((adapterId: string, optionId: string, on: boolean) => {
    update((prev) => {
      const all = { ...(prev.adapterOptions ?? {}) };
      all[adapterId] = { ...(all[adapterId] ?? {}), [optionId]: on };
      return { ...prev, adapterOptions: all };
    });
  }, [update]);

  const setNoticeHooks = useCallback((paths: string[]) => {
    update((prev) => {
      const hooks = cleanNoticeHooks(paths);
      const next: AddonFile = { ...prev };
      if (hooks.length > 0) next.noticeHooks = hooks; else delete next.noticeHooks;
      return next;
    });
  }, [update]);

  const setStoryProgress = useCallback((key: StoryKey | null) => {
    update((prev) => {
      const next: AddonFile = { ...prev };
      const text = key ? cleanStoryProgress(keyText(key)) : null;
      if (text) next.storyProgress = text; else delete next.storyProgress;
      return next;
    });
  }, [update]);

  const setHiddenImages = useCallback((patterns: string[]) => {
    update((prev) => {
      const list = cleanHiddenImages(patterns);
      const next: AddonFile = { ...prev };
      if (list.length > 0) next.hiddenImages = list; else delete next.hiddenImages;
      return next;
    });
  }, [update]);

  const value = useMemo<AddonsValue>(() => ({
    state,
    isOn: (id) => state[id] === true,
    setOn,
    pictureRoles,
    setPictureRole,
    spriteRoles,
    setSpriteRole,
    noticeHooks,
    setNoticeHooks,
    storyProgress,
    setStoryProgress,
    controlFlags,
    savedInFolder: current?.inFolder ?? false,
    adapters,
    enabledAdapters,
    isAdapterOn: (id) => enabledAdapters.some((a) => a.manifest.id === id),
    setAdapterOn,
    defaultRole,
    isAdapterOptionOn: (id, opt) => adapterOptions[id]?.[opt] === true,
    setAdapterOption,
    menuPicturesShown: adapterFlags.captureMenuScenes === true,
    hiddenImages,
    setHiddenImages,
  }), [state, setOn, pictureRoles, setPictureRole, spriteRoles, setSpriteRole, noticeHooks, setNoticeHooks, storyProgress, setStoryProgress,
    controlFlags, current?.inFolder, adapters, enabledAdapters, setAdapterOn, defaultRole, adapterOptions, setAdapterOption, adapterFlags, hiddenImages, setHiddenImages]);

  return <AddonsContext.Provider value={value}>{children}</AddonsContext.Provider>;
}

/** 게임별 애드온 상태. AddonsProvider 밖에서는 모두 꺼짐. */
// eslint-disable-next-line react-refresh/only-export-components
export function useAddons(): AddonsValue {
  return useContext(AddonsContext) ?? NONE;
}
