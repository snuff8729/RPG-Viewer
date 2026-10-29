import type { GameFolder } from "@/core/fs/folder";
import { isWritableFolder } from "@/core/fs/folder";
import { livePaths } from "@/core/live/installer";
import type { AddonState } from "@/core/addons/registry";
import { addonsJson, parseAddonFile, type AddonFile } from "@/core/addons/settings";

/** 애드온 설정을 담는 저장소(브라우저 localStorage 모양) */
export interface KeyStorage { getItem(k: string): string | null; setItem(k: string, v: string): void }

/** 게임 폴더의 애드온 설정 파일 */
export const addonsFile = (dataRoot: string): string => `${livePaths(dataRoot).logDir}/addons.json`;
export const addonsStorageKey = (gameKey: string): string => `rpgv.addons.${gameKey}`;

function storageOf(): KeyStorage | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

/**
 * 게임별 애드온 설정(켜짐 상태·그림 구분)을 읽는다: 게임 폴더 rpg-viewer/addons.json → (없거나 못 읽으면) localStorage → 모두 꺼짐.
 * 예외를 던지지 않는다.
 */
export async function loadAddonFile(
  folder: GameFolder | null | undefined, dataRoot: string, gameKey: string, storage: KeyStorage | null = storageOf(),
): Promise<AddonFile> {
  const fromFile = await readAddonFolderFile(folder, dataRoot);
  if (fromFile) return fromFile;
  try {
    return parseAddonFile(storage?.getItem(addonsStorageKey(gameKey))) ?? { state: {}, pictureRoles: {} };
  } catch {
    return { state: {}, pictureRoles: {} };
  }
}

/** 게임별 애드온 켜짐 상태만 읽는다(loadAddonFile). */
export async function loadAddonState(
  folder: GameFolder | null | undefined, dataRoot: string, gameKey: string, storage: KeyStorage | null = storageOf(),
): Promise<AddonState> {
  return (await loadAddonFile(folder, dataRoot, gameKey, storage)).state;
}

/**
 * 게임별 애드온 설정을 쓴다: localStorage에는 언제나, 쓸 수 있는 게임 폴더면 rpg-viewer/addons.json에도.
 * 폴더에 썼으면 true. 쓰기 권한 요청은 부르는 쪽이 클릭 핸들러 안에서 미리 한다. 예외를 던지지 않는다.
 */
export async function saveAddonFile(
  folder: GameFolder | null | undefined, dataRoot: string, gameKey: string, file: AddonFile, storage: KeyStorage | null = storageOf(),
): Promise<boolean> {
  const body = addonFileText(file);
  try { storage?.setItem(addonsStorageKey(gameKey), body); } catch { /* 저장 못 해도 동작 */ }
  if (!folder || !isWritableFolder(folder)) return false;
  try { return await folder.writeText(addonsFile(dataRoot), body); } catch { return false; }
}

/** 설정 파일 본문(같은 설정이면 같은 글) */
export function addonFileText(file: AddonFile): string {
  return addonsJson(file.state, file.pictureRoles, file.noticeHooks, file.spriteRoles, file.adapters, file.storyProgress, file.adapterOptions, file.hiddenImages);
}

/** 게임 폴더의 설정 파일을 읽는다(없거나 깨졌거나 못 읽으면 null). 예외를 던지지 않는다. */
export async function readAddonFolderFile(folder: GameFolder | null | undefined, dataRoot: string): Promise<AddonFile | null> {
  if (!folder) return null;
  try { return parseAddonFile(await folder.readText(addonsFile(dataRoot))); } catch { return null; }
}

/**
 * 읽고-고쳐-쓰기로 저장한다: PC와 휴대폰 보기가 같은 rpg-viewer/addons.json을 쓰므로, 지금 폴더의 파일(다른 뷰어가 바꿨을 수 있다)에
 * 이번 변경(change)만 적용해 쓴다. 폴더 파일이 없거나 못 쓰는 폴더면 fallback에 적용한다. 예외를 던지지 않는다.
 */
export async function updateAddonFile(
  folder: GameFolder | null | undefined, dataRoot: string, gameKey: string, fallback: AddonFile, change: (prev: AddonFile) => AddonFile,
  storage: KeyStorage | null = storageOf(),
): Promise<{ file: AddonFile; inFolder: boolean }> {
  const writable = !!folder && isWritableFolder(folder);
  const onDisk = writable ? await readAddonFolderFile(folder, dataRoot) : null;
  let file: AddonFile;
  try { file = change(onDisk ?? fallback); } catch { file = fallback; }
  const inFolder = await saveAddonFile(writable ? folder : null, dataRoot, gameKey, file, storage);
  return { file, inFolder };
}

/** 켜짐 상태만 쓴다(그림 구분 없음). */
export async function saveAddonState(
  folder: GameFolder | null | undefined, dataRoot: string, gameKey: string, state: AddonState, storage: KeyStorage | null = storageOf(),
): Promise<boolean> {
  return saveAddonFile(folder, dataRoot, gameKey, { state, pictureRoles: {} }, storage);
}
