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
  if (folder) {
    try {
      const fromFile = parseAddonFile(await folder.readText(addonsFile(dataRoot)));
      if (fromFile) return fromFile;
    } catch { /* localStorage로 */ }
  }
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
  const body = addonsJson(file.state, file.pictureRoles, file.noticeHooks, file.spriteRoles, file.adapters);
  try { storage?.setItem(addonsStorageKey(gameKey), body); } catch { /* 저장 못 해도 동작 */ }
  if (!folder || !isWritableFolder(folder)) return false;
  try { return await folder.writeText(addonsFile(dataRoot), body); } catch { return false; }
}

/** 켜짐 상태만 쓴다(그림 구분 없음). */
export async function saveAddonState(
  folder: GameFolder | null | undefined, dataRoot: string, gameKey: string, state: AddonState, storage: KeyStorage | null = storageOf(),
): Promise<boolean> {
  return saveAddonFile(folder, dataRoot, gameKey, { state, pictureRoles: {} }, storage);
}
